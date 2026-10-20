"""Required local integration tests with actual Chroma and PDF parsing."""

import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from pypdf import PdfWriter
from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject

from support_agent.chroma import ChromaIndex
from support_agent.ingest import sync


class Embeddings:
    """Deterministic embeddings in tests only; real Chroma persistence is exercised."""

    def embed(self, texts):
        return [[1.0, 0.0] if "backups" in text.lower() else [0.0, 1.0] for text in texts]


class StorageTests(unittest.TestCase):
    def test_real_chroma_incremental_sync_and_query(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            sources = root / "knowledge"
            sources.mkdir()
            faq = sources / "backups.md"
            faq.write_text("# Backups\nOrbitDesk keeps backups for 30 days.")
            index = ChromaIndex.open(root / "index", Embeddings(), "test-model")
            self.assertEqual(sync(sources, index), {"updated": 1, "deleted": 0})
            self.assertEqual(sync(sources, index), {"updated": 0, "deleted": 0})
            self.assertIn("30 days", index.search("backups")[0].chunk.text)
            faq.write_text("# Backups\nOrbitDesk keeps backups for 60 days.")
            sync(sources, index)
            self.assertIn("60 days", index.search("backups")[0].chunk.text)
            reopened = ChromaIndex.open(root / "index", Embeddings(), "test-model")
            self.assertIn("60 days", reopened.search("backups")[0].chunk.text)
            with self.assertRaises(ValueError):
                ChromaIndex.open(root / "index", Embeddings(), "different-model")
            faq.unlink()
            self.assertEqual(sync(sources, index), {"updated": 0, "deleted": 1})
            self.assertEqual(index.search("backups"), [])

    def test_pdf_text_is_extracted_and_indexed(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            sources = root / "knowledge"
            sources.mkdir()
            writer = PdfWriter()
            page = writer.add_blank_page(width=612, height=792)
            font = DictionaryObject({NameObject("/Type"): NameObject("/Font"),
                                     NameObject("/Subtype"): NameObject("/Type1"),
                                     NameObject("/BaseFont"): NameObject("/Helvetica")})
            page[NameObject("/Resources")] = DictionaryObject({
                NameObject("/Font"): DictionaryObject({NameObject("/F1"): font})})
            stream = DecodedStreamObject()
            stream.set_data(b"BT /F1 12 Tf 72 720 Td (Daily backups last 30 days.) Tj ET")
            page[NameObject("/Contents")] = stream
            writer.write(sources / "faq.pdf")
            index = ChromaIndex.open(root / "index", Embeddings(), "test-model")
            sync(sources, index)
            hit = index.search("backups")[0]
            self.assertEqual(hit.chunk.document_id, "faq.pdf")
            self.assertIn("30 days", hit.chunk.text)
