"""Immutable domain contracts shared by HTTP, ingestion and adapters."""

from dataclasses import dataclass
from typing import Literal, Protocol

Route = Literal["rag", "ticket", "escalation"]
Reason = Literal[
    "no_evidence",
    "dependency_unavailable",
    "unsafe_request",
    "human_requested",
    "ticket_not_found",
    "invalid_ticket",
    "unsupported_generation",
]


@dataclass(frozen=True)
class Chunk:
    document_id: str
    version: str
    chunk_id: str
    title: str
    source: str
    text: str


@dataclass(frozen=True)
class Hit:
    chunk: Chunk
    distance: float


@dataclass(frozen=True)
class Selection:
    chunk_id: str
    quote: str


@dataclass(frozen=True)
class Citation:
    document_id: str
    version: str
    chunk_id: str
    title: str
    source: str
    quote: str


@dataclass(frozen=True)
class Ticket:
    id: str
    status: Literal["open", "in_progress", "resolved"]
    summary: str


@dataclass(frozen=True)
class Answer:
    answer: str
    route: Route
    citations: tuple[Citation, ...] = ()
    escalated: bool = False
    reason: Reason | None = None
    ticket: Ticket | None = None


class SearchIndex(Protocol):
    def search(self, question: str) -> list[Hit]: ...


class QuoteSelector(Protocol):
    def select(self, question: str, hits: list[Hit]) -> Selection: ...


class TicketStore(Protocol):
    def get(self, ticket_id: str) -> Ticket | None: ...


class DocumentIndex(Protocol):
    def versions(self) -> dict[str, str]: ...

    def replace(self, document_id: str, chunks: list[Chunk]) -> None: ...

    def delete(self, document_id: str) -> None: ...
