"""Catch unbounded retries, wrong wire contracts and malformed model responses."""

import io
import json
import unittest
from urllib.error import HTTPError, URLError
from unittest.mock import patch

from support_agent.models import Chunk, Hit
from support_agent.ollama import Ollama


def reply(value):
    return io.BytesIO(json.dumps(value).encode())


class OllamaTests(unittest.TestCase):
    def test_embedding_wire_contract_and_timeout(self):
        def transport(request, *, timeout):
            self.assertEqual(request.full_url, "http://localhost:11434/api/embed")
            self.assertEqual(timeout, 8)
            self.assertEqual(json.loads(request.data),
                             {"model": "nomic-embed-text", "input": ["backups"],
                              "truncate": False})
            return reply({"embeddings": [[0.0, 1.0]]})
        with patch("support_agent.ollama.urlopen", transport):
            self.assertEqual(Ollama(timeout=8).embed(["backups"]), [[0.0, 1.0]])

    def test_transport_failures_have_at_most_two_attempts(self):
        with patch("support_agent.ollama.urlopen", side_effect=URLError("secret")) as call:
            with self.assertRaises(RuntimeError):
                Ollama().embed(["backups"])
            self.assertEqual(call.call_count, 2)

    def test_retry_recovers_transient_failure(self):
        with patch("support_agent.ollama.urlopen", side_effect=[
            TimeoutError(), reply({"embeddings": [[1.0, 0.0]]})
        ]):
            self.assertEqual(Ollama().embed(["backups"]), [[1.0, 0.0]])

    def test_http_client_errors_are_not_retried(self):
        error = HTTPError("http://localhost", 404, "missing model", {}, None)
        with patch("support_agent.ollama.urlopen", side_effect=error) as call:
            with self.assertRaises(RuntimeError):
                Ollama().embed(["backups"])
            self.assertEqual(call.call_count, 1)

    def test_invalid_vectors_are_rejected(self):
        for embeddings in [[], [[True]], [[float("nan")]], [[0.0, 0.0]],
                           [["x"]], [[1.0], [1.0, 2.0]]]:
            with self.subTest(embeddings=embeddings):
                with patch("support_agent.ollama.urlopen",
                           return_value=reply({"embeddings": embeddings})):
                    with self.assertRaises(ValueError):
                        Ollama().embed(["backups"])

    def test_chat_json_selection_contract(self):
        hit = Hit(Chunk("faq.md", "v1", "chunk-1", "FAQ", "kb://faq.md",
                        "Backups last 30 days."), 0.1)

        def transport(request, *, timeout):
            payload = json.loads(request.data)
            self.assertEqual(request.full_url, "http://localhost:11434/api/chat")
            self.assertFalse(payload["stream"])
            self.assertEqual(payload["format"], "json")
            self.assertEqual(payload["messages"][0]["role"], "system")
            self.assertNotIn("tools", payload)
            return reply({"message": {"role": "assistant", "content": json.dumps(
                {"chunk_id": "chunk-1", "quote": "Backups last 30 days."})}})
        with patch("support_agent.ollama.urlopen", transport):
            result = Ollama().select("backups?", [hit])
            self.assertEqual(result.chunk_id, "chunk-1")
            self.assertEqual(result.quote, "Backups last 30 days.")

    def test_malformed_or_oversized_responses_fail_without_retry(self):
        for response in [io.BytesIO(b"not json"), io.BytesIO(b"x" * 1_048_577),
                         reply({"message": {"content": "{}"}})]:
            with patch("support_agent.ollama.urlopen", return_value=response) as call:
                with self.assertRaises(ValueError):
                    Ollama().select("backups", [])
                self.assertEqual(call.call_count, 1)

    def test_invalid_timeout_and_remote_url_rejected(self):
        for kwargs in [{"timeout": 0}, {"timeout": 31},
                       {"base_url": "https://paid.example"},
                       {"base_url": "http://localhost:11434/redirect"}]:
            with self.assertRaises(ValueError):
                Ollama(**kwargs)
