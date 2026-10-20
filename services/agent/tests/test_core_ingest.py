"""Catch lost updates, unstable identities, and stale source retention."""

import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from support_agent.ingest import chunk_document, sync


class MemoryIndex:
    """Test-only index that preserves ingestion side effects."""

    def __init__(self):
        self.documents = {}
        self.writes = 0

    def versions(self):
        return {key: chunks[0].version for key, chunks in self.documents.items()}

    def replace(self, document_id, chunks):
        self.writes += 1
        self.documents[document_id] = chunks

    def delete(self, document_id):
        self.documents.pop(document_id, None)


class IngestTests(unittest.TestCase):
    def setUp(self):
        self.directory = TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.index = MemoryIndex()

    def test_stable_chunk_ids_and_bounded_chunks_preserve_content(self):
        text = "# Backups\n\n" + "Daily backups last thirty days. " * 100
        first = chunk_document("faq/backups.md", text, "v1")
        second = chunk_document("faq/backups.md", text, "v1")
        self.assertEqual(first, second)
        self.assertGreater(len(first), 1)
        self.assertTrue(all(0 < len(c.text) <= 1000 for c in first))
        self.assertTrue(all(c.source == "kb://faq/backups.md" for c in first))
        self.assertEqual(len({c.chunk_id for c in first}), len(first))
        # No source characters may silently vanish at chunk boundaries.
        self.assertEqual("".join(c.text for c in first), text)
        changed = chunk_document("faq/backups.md", text, "v2")
        self.assertNotEqual(first[0].chunk_id, changed[0].chunk_id)

    def test_incremental_sync_replaces_updates_and_removes_deleted_sources(self):
        path = self.root / "backups.md"
        path.write_text("# Backups\nDaily backups last 30 days.")
        self.assertEqual(sync(self.root, self.index), {"updated": 1, "deleted": 0})
        old = self.index.documents["backups.md"][0]
        self.assertEqual(sync(self.root, self.index), {"updated": 0, "deleted": 0})
        self.assertEqual(self.index.writes, 1)
        path.write_text("# Backups\nDaily backups last 60 days.")
        sync(self.root, self.index)
        new = self.index.documents["backups.md"][0]
        self.assertNotEqual(old.version, new.version)
        self.assertEqual(new.document_id, old.document_id)
        self.assertIn("60 days", new.text)
        path.unlink()
        self.assertEqual(sync(self.root, self.index), {"updated": 0, "deleted": 1})
        self.assertEqual(self.index.documents, {})

    def test_empty_document_removes_old_chunks(self):
        path = self.root / "faq.md"
        path.write_text("# FAQ\nUseful answer")
        sync(self.root, self.index)
        path.write_text("   ")
        sync(self.root, self.index)
        self.assertEqual(self.index.documents, {})

    def test_missing_root_does_not_delete_index(self):
        path = self.root / "faq.md"
        path.write_text("# FAQ\nUseful answer")
        sync(self.root, self.index)
        with self.assertRaises(FileNotFoundError):
            sync(self.root / "missing", self.index)
        self.assertIn("faq.md", self.index.documents)

    def test_symlinks_outside_curated_root_are_rejected(self):
        with TemporaryDirectory() as external:
            outside = Path(external) / "private.md"
            outside.write_text("private content")
            (self.root / "link.md").symlink_to(outside)
            with self.assertRaises(ValueError):
                sync(self.root, self.index)
            self.assertEqual(self.index.documents, {})

    def test_failed_document_read_does_not_remove_other_sources(self):
        path = self.root / "faq.md"
        path.write_text("Useful answer")
        sync(self.root, self.index)
        path.unlink()
        (self.root / "bad.md").write_bytes(b"\xff\xfe")
        with self.assertRaises(UnicodeError):
            sync(self.root, self.index)
        self.assertIn("faq.md", self.index.documents)

    def test_invalid_chunk_size_rejected(self):
        for size in (0, -1, 1001):
            with self.assertRaises(ValueError):
                chunk_document("test.md", "test", "v1", size)

    def test_deleted_source_with_incomplete_index_is_removed(self):
        class Incomplete(MemoryIndex):
            def versions(self):
                return {key: "" for key in self.documents}

        index = Incomplete()
        index.documents["deleted.md"] = chunk_document("deleted.md", "old text", "v1")
        self.assertEqual(sync(self.root, index), {"updated": 0, "deleted": 1})
        self.assertEqual(index.documents, {})
