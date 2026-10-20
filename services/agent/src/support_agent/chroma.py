"""Chroma persistence; explicit embeddings prevent implicit model downloads."""

import math
from collections import defaultdict
from dataclasses import asdict
from pathlib import Path
from typing import Any, Protocol, Self

from support_agent.models import Chunk, Hit


class Embedder(Protocol):
    def embed(self, texts: list[str]) -> list[list[float]]: ...


class ChromaIndex:
    def __init__(self, collection: Any, embedder: Embedder):
        self.collection = collection
        self.embedder = embedder

    @classmethod
    def open(cls, path: Path, embedder: Embedder, embedding_model: str) -> Self:
        import chromadb
        from chromadb.config import Settings

        client = chromadb.PersistentClient(
            path=str(path), settings=Settings(anonymized_telemetry=False),
        )
        collection = client.get_or_create_collection(
            "orbitdesk-knowledge", embedding_function=None,
            metadata={"hnsw:space": "cosine", "embedding_model": embedding_model},
        )
        if (collection.metadata is None
                or collection.metadata.get("embedding_model") != embedding_model):
            raise ValueError("Embedding model changed: choose a new CHROMA_DIR and re-ingest")
        return cls(collection, embedder)

    def versions(self) -> dict[str, str]:
        records = self.collection.get(include=["metadatas"])
        grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for metadata in records["metadatas"] or []:
            grouped[metadata["document_id"]].append(metadata)
        # A crash after partial upsert leaves mixed versions/counts. Never regard
        # that as a successful sync; the next pass retries the entire document.
        return {
            doc: (rows[0]["version"]
                  if len({row["version"] for row in rows}) == 1
                  and all(row["chunk_count"] == len(rows) for row in rows)
                  else "")
            for doc, rows in grouped.items()
        }

    def replace(self, document_id: str, chunks: list[Chunk]) -> None:
        if not chunks or any(chunk.document_id != document_id for chunk in chunks):
            raise ValueError("Replacement requires nonempty chunks from one document")
        old = self.collection.get(where={"document_id": document_id}, include=[])["ids"]
        for offset in range(0, len(chunks), 16):
            batch = chunks[offset:offset + 16]
            embeddings = self.embedder.embed([chunk.text for chunk in batch])
            metadatas = []
            for chunk in batch:
                metadata: dict[str, str | int] = {
                    key: value for key, value in asdict(chunk).items()
                    if key not in {"text", "chunk_id"}
                }
                metadata["chunk_count"] = len(chunks)
                metadatas.append(metadata)
            self.collection.upsert(
                ids=[chunk.chunk_id for chunk in batch],
                documents=[chunk.text for chunk in batch], metadatas=metadatas,
                embeddings=embeddings,
            )
        stale = sorted(set(old) - {chunk.chunk_id for chunk in chunks})
        if stale:
            self.collection.delete(ids=stale)

    def delete(self, document_id: str) -> None:
        self.collection.delete(where={"document_id": document_id})

    def search(self, question: str) -> list[Hit]:
        try:
            count = self.collection.count()
            if count == 0:
                return []
            result = self.collection.query(
                query_embeddings=self.embedder.embed([question]),
                n_results=min(4, count), include=["documents", "metadatas", "distances"],
            )
            hits = []
            for chunk_id, text, metadata, distance in zip(
                result["ids"][0], result["documents"][0], result["metadatas"][0],
                result["distances"][0], strict=True,
            ):
                distance = float(distance)
                if not math.isfinite(distance) or distance < -0.000001:
                    raise ValueError("Invalid cosine distance")
                hits.append(Hit(Chunk(
                    document_id=metadata["document_id"], version=metadata["version"],
                    chunk_id=chunk_id, title=metadata["title"],
                    source=metadata["source"], text=text,
                ), max(0.0, distance)))
            return hits
        except Exception:
            # Driver errors must cross the domain boundary without private details.
            raise RuntimeError("Knowledge index unavailable") from None

    def ready(self) -> bool:
        return any(self.versions().values())
