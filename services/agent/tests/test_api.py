"""Required FastAPI contract tests: no dependency skips."""

import json
import logging
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from uuid import UUID, uuid4

from fastapi.testclient import TestClient

from support_agent.agent import Agent
from support_agent.api import create_app
from support_agent.models import Chunk, Hit, Selection
from support_agent.runtime import Runtime
from support_agent.tickets import JsonTickets

TOKEN = "test-only-service-token-32-characters"


class Search:
    def search(self, question):
        return [Hit(Chunk("backups.md", "v1", "backup", "Backups", "kb://backups.md",
                          "OrbitDesk retains daily backups for 30 days."), 0.1)]


class Selector:
    def select(self, question, hits):
        return Selection("backup", "OrbitDesk retains daily backups for 30 days.")


class ApiTests(unittest.TestCase):
    def setUp(self):
        self.directory = TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        path = Path(self.directory.name) / "tickets.json"
        path.write_text(json.dumps([
            {"id": "TKT-1001", "status": "open", "summary": "Synthetic export issue"}
        ]))
        self.runtime = Runtime(Agent(Search(), Selector(), JsonTickets(path)), lambda: True)
        self.client = TestClient(create_app(self.runtime, TOKEN))
        self.headers = {"Authorization": "Bearer " + TOKEN}

    def test_faq_and_ticket_contracts(self):
        for question, route in [("How long are backups retained?", "rag"),
                                ("Status of TKT-1001?", "ticket")]:
            result = self.client.post("/agent/respond", json={"message": question},
                                      headers=self.headers)
            self.assertEqual(result.status_code, 200)
            body = result.json()
            self.assertEqual(body["route"], route)
            self.assertFalse(body["escalated"])
            if route == "rag":
                self.assertEqual(body["citations"][0]["quote"], body["answer"])
            else:
                self.assertEqual(body["ticket"]["status"], "open")

    def test_auth_and_input_validation(self):
        self.assertEqual(self.client.post("/agent/respond", json={"message": "backups"})
                         .status_code, 401)
        for message in ["", "   ", "x" * 4001, 123, None]:
            self.assertEqual(self.client.post("/agent/respond", json={"message": message},
                                              headers=self.headers).status_code, 422)
        self.assertEqual(self.client.post("/agent/respond",
                                          json={"message": "backups", "admin": True},
                                          headers=self.headers).status_code, 422)

    def test_readiness_and_liveness_have_distinct_status(self):
        self.runtime.ready = lambda: False
        self.assertEqual(self.client.get("/health/live").status_code, 200)
        self.assertEqual(self.client.get("/health/ready").status_code, 503)

    def test_request_ids_and_logs_do_not_leak_message_or_token(self):
        request_id = str(uuid4())
        headers = self.headers | {"X-Request-ID": request_id}
        with self.assertLogs("support_agent.requests", logging.INFO) as logs:
            result = self.client.post("/agent/respond", json={"message": "private backups"},
                                      headers=headers)
        self.assertEqual(result.headers["X-Request-ID"], request_id)
        serialized = " ".join(logs.output)
        self.assertNotIn("private backups", serialized)
        self.assertNotIn(TOKEN, serialized)
        self.assertIn(request_id, serialized)
        result = self.client.get("/health/live", headers={"X-Request-ID": "injected\ttext"})
        UUID(result.headers["X-Request-ID"])

    def test_dependency_failure_is_an_explicit_safe_decision(self):
        class Broken:
            def search(self, question):
                raise RuntimeError("secret dependency detail")
        self.runtime.agent.index = Broken()
        result = self.client.post("/agent/respond", json={"message": "backups"},
                                  headers=self.headers)
        self.assertEqual(result.status_code, 200)
        self.assertTrue(result.json()["escalated"])
        self.assertEqual(result.json()["reason"], "dependency_unavailable")
        self.assertNotIn("secret", result.text)

    def test_openapi_describes_the_implemented_route(self):
        schema = self.client.get("/openapi.json").json()
        operation = schema["paths"]["/agent/respond"]["post"]
        self.assertIn("security", operation)
        self.assertIn("200", operation["responses"])
