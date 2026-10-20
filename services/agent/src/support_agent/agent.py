"""Bounded routing; model output cannot create tools or citation metadata."""

import re

from support_agent.models import (
    Answer, Citation, QuoteSelector, Reason, SearchIndex, TicketStore,
)
from support_agent.retrieval import relevant_hits, terms

UNSAFE = re.compile(
    r"ignore\s+(?:all\s+)?(?:previous|prior|system)|system\s+prompt|"
    r"(?:api[ _-]?keys?|passwords?|secrets?)|developer\s+message",
    re.IGNORECASE,
)
HUMAN = re.compile(r"\b(human|operator|escalate|representative)\b", re.IGNORECASE)
TICKET = re.compile(r"(?<!\w)TKT-\d{4}(?!\w)", re.IGNORECASE)


def escalate(reason: Reason) -> Answer:
    return Answer(
        answer="I cannot confidently answer this request. Please contact a human support agent.",
        route="escalation", escalated=True, reason=reason,
    )


class Agent:
    def __init__(self, index: SearchIndex, selector: QuoteSelector, tickets: TicketStore):
        self.index = index
        self.selector = selector
        self.tickets = tickets

    def respond(self, message: str) -> Answer:
        if not isinstance(message, str) or not message.strip() or len(message) > 4000:
            raise ValueError("Message must contain 1–4000 characters")
        if UNSAFE.search(message):
            return escalate("unsafe_request")
        if HUMAN.search(message):
            return escalate("human_requested")
        ids = set(TICKET.findall(message.upper()))
        if ids or re.search(r"\bticket\b|TKT-", message, re.IGNORECASE):
            if len(ids) != 1:
                return escalate("invalid_ticket")
            try:
                ticket = self.tickets.get(next(iter(ids)))
            except (OSError, ValueError, RuntimeError):
                return escalate("dependency_unavailable")
            if ticket is None:
                return escalate("ticket_not_found")
            return Answer(
                answer=f"{ticket.id} is {ticket.status}: {ticket.summary}",
                route="ticket", ticket=ticket,
            )
        try:
            hits = relevant_hits(message, self.index.search(message))
            if not hits:
                return escalate("no_evidence")
            selection = self.selector.select(message, hits)
        except (OSError, ValueError, RuntimeError):
            return escalate("dependency_unavailable")
        for hit in hits:
            chunk = hit.chunk
            quote = selection.quote.strip()
            if (selection.chunk_id == chunk.chunk_id and 12 <= len(quote) <= 1200
                    and quote in chunk.text and terms(message).intersection(terms(quote))):
                return Answer(
                    answer=quote, route="rag",
                    citations=(Citation(
                        document_id=chunk.document_id, version=chunk.version,
                        chunk_id=chunk.chunk_id, title=chunk.title,
                        source=chunk.source, quote=quote,
                    ),),
                )
        return escalate("unsupported_generation")
