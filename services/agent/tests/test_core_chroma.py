"""Adapter tests; the real Chroma integration remains a separate required gate."""

import unittest

from support_agent.chroma import ChromaIndex
from support_agent.models import Chunk


class Embeddings:
    def embed(self, texts):
        return [[1.0, 0.0] for _ in texts]


class Collection:
    def __init__(self):
        self.records = {}
        self.fail = False

    def get(self, *, include, where=None):
        records = [
            (key, value)
            for key, value in self.records.items()
            if where is None or value[1]["document_id"] == where["document_id"]
        ]
        return {
            "ids": [key for key, _ in records],
            "documents": [v[0] for _, v in records],
            "metadatas": [v[1] for _, v in records],
        }

    def upsert(self, *, ids, documents, metadatas, embeddings):
        if self.fail:
            raise RuntimeError("private dependency error")
        for key, doc, meta in zip(ids, documents, metadatas, strict=True):
            self.records[key] = (doc, meta)

    def delete(self, *, ids=None, where=None):
        targets = ids if ids is not None else self.get(include=[], where=where)["ids"]
        for key in targets:
            self.records.pop(key, None)

    def count(self):
        return len(self.records)

    def query(self, *, query_embeddings, n_results, include):
        result = self.get(include=[])
        return {key: [value[:n_results]] for key, value in result.items()} | {
            "distances": [[0.1] * min(n_results, self.count())]
        }


class ChromaTests(unittest.TestCase):
    def setUp(self):
        self.collection = Collection()
        self.index = ChromaIndex(self.collection, Embeddings())
        self.old = Chunk("faq.md", "v1", "old", "FAQ", "kb://faq.md", "old backups")
        self.new = Chunk("faq.md", "v2", "new", "FAQ", "kb://faq.md", "new backups")

    def test_update_removes_obsolete_chunks_and_tracks_version(self):
        self.index.replace("faq.md", [self.old])
        self.index.replace("faq.md", [self.new])
        self.assertEqual(self.index.versions(), {"faq.md": "v2"})
        hits = self.index.search("backups")
        self.assertEqual([hit.chunk.text for hit in hits], ["new backups"])
        self.assertEqual(hits[0].chunk.source, "kb://faq.md")
        self.assertNotIn("old", self.collection.records)

    def test_failed_upsert_preserves_last_index(self):
        self.index.replace("faq.md", [self.old])
        self.collection.fail = True
        with self.assertRaises(RuntimeError):
            self.index.replace("faq.md", [self.new])
        self.assertEqual(self.index.versions(), {"faq.md": "v1"})

    def test_partial_update_is_not_treated_as_current(self):
        self.index.replace("faq.md", [self.old])
        meta = self.collection.records["old"][1].copy()
        meta.update(version="v2", chunk_count=2)
        self.collection.records["new"] = ("new text", meta)
        self.assertEqual(self.index.versions(), {"faq.md": ""})

    def test_invalid_distance_is_never_accepted_as_close_evidence(self):
        self.index.replace("faq.md", [self.old])
        original = self.collection.query

        def query(**kwargs):
            result = original(**kwargs)
            result["distances"] = [[float("nan")]]
            return result

        self.collection.query = query
        with self.assertRaises(RuntimeError):
            self.index.search("backups")

    def test_deletion_and_empty_search(self):
        self.index.replace("faq.md", [self.old])
        self.index.delete("faq.md")
        self.assertEqual(self.index.search("backups"), [])
        self.assertEqual(self.index.versions(), {})
