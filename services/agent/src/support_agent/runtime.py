"""Production composition uses only actual local service adapters."""

import os
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Self

from support_agent.agent import Agent
from support_agent.chroma import ChromaIndex
from support_agent.ollama import Ollama
from support_agent.tickets import JsonTickets


@dataclass(frozen=True)
class Settings:
    knowledge_dir: Path
    tickets_file: Path
    chroma_dir: Path
    ollama_url: str
    ollama_model: str
    embedding_model: str
    ollama_timeout: float

    @classmethod
    def from_env(cls) -> Self:
        return cls(
            knowledge_dir=Path(os.environ.get("KNOWLEDGE_DIR", "data/knowledge")),
            tickets_file=Path(os.environ.get("TICKETS_FILE", "data/tickets.json")),
            chroma_dir=Path(os.environ.get("CHROMA_DIR", ".data/chroma")),
            ollama_url=os.environ.get("OLLAMA_URL", "http://localhost:11434"),
            ollama_model=os.environ.get("OLLAMA_MODEL", "qwen2.5:3b"),
            embedding_model=os.environ.get("EMBEDDING_MODEL", "nomic-embed-text"),
            ollama_timeout=float(os.environ.get("OLLAMA_TIMEOUT_SECONDS", "20")),
        )


@dataclass
class Runtime:
    agent: Agent
    ready: Callable[[], bool]


def build_index(settings: Settings) -> tuple[ChromaIndex, Ollama]:
    ollama = Ollama(
        base_url=settings.ollama_url, model=settings.ollama_model,
        embedding_model=settings.embedding_model, timeout=settings.ollama_timeout,
    )
    return ChromaIndex.open(settings.chroma_dir, ollama, settings.embedding_model), ollama


def build_runtime(settings: Settings) -> Runtime:
    index, ollama = build_index(settings)
    agent = Agent(index, ollama, JsonTickets(settings.tickets_file))

    def ready() -> bool:
        return index.ready() and ollama.ready()

    return Runtime(agent, ready)
