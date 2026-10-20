"""Explicit, incremental ingestion of a curated local knowledge directory."""

import hashlib
from pathlib import Path
from urllib.parse import quote

from support_agent.models import Chunk, DocumentIndex

MAX_SOURCE_BYTES = 10 * 1024 * 1024
MAX_EXTRACTED_CHARS = 2_000_000


def chunk_document(
    document_id: str, text: str, version: str, size: int = 1000,
) -> list[Chunk]:
    if not 1 <= size <= 1000:
        raise ValueError("Chunk size must be between 1 and 1000")
    if not text.strip():
        return []
    title = next((line.lstrip("# ") for line in text.splitlines() if line.strip()),
                 document_id)[:120]
    chunks = []
    for offset in range(0, len(text), size):
        chunk_id = hashlib.sha256(f"{document_id}\0{version}\0{offset}".encode()).hexdigest()
        chunks.append(Chunk(
            document_id=document_id, version=version, chunk_id=chunk_id,
            title=title, source="kb://" + quote(document_id, safe="/"),
            text=text[offset:offset + size],
        ))
    return chunks


def read_document(path: Path) -> tuple[str, str]:
    if path.stat().st_size > MAX_SOURCE_BYTES:
        raise ValueError("Knowledge source exceeds size limit")
    data = path.read_bytes()
    version = hashlib.sha256(data).hexdigest()
    if path.suffix.lower() == ".pdf":
        from pypdf import PdfReader

        text = "\n".join(page.extract_text() or "" for page in PdfReader(path).pages)
    else:
        text = data.decode("utf-8")
    if len(text) > MAX_EXTRACTED_CHARS:
        raise ValueError("Extracted document exceeds size limit")
    return version, text


def sync(root: Path, index: DocumentIndex) -> dict[str, int]:
    root = root.resolve(strict=True)
    if not root.is_dir():
        raise ValueError("Knowledge root must be a directory")
    existing = index.versions()
    desired: dict[str, list[Chunk]] = {}
    # Scan and parse everything before any mutation. A broken source must never
    # make an apparently empty scan delete the last known good index.
    for path in sorted(root.rglob("*")):
        if path.is_symlink():
            raise ValueError("Symlinks are not allowed in the curated knowledge root")
        if not path.is_file() or path.suffix.lower() not in {".md", ".pdf"}:
            continue
        document_id = path.relative_to(root).as_posix()
        version, text = read_document(path)
        desired[document_id] = chunk_document(document_id, text, version)
    updated = 0
    deleted = 0
    for document_id, chunks in desired.items():
        if chunks and existing.get(document_id) != chunks[0].version:
            index.replace(document_id, chunks)
            updated += 1
    for document_id in existing:
        if document_id not in desired or not desired[document_id]:
            index.delete(document_id)
            deleted += 1
    return {"updated": updated, "deleted": deleted}


def main() -> None:
    import json

    from support_agent.runtime import Settings, build_index

    settings = Settings.from_env()
    index, _ = build_index(settings)
    print(json.dumps(sync(settings.knowledge_dir, index)))


if __name__ == "__main__":
    main()
