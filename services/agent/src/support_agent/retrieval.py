"""Conservative relevance checks in addition to vector similarity."""

import math
import re

from support_agent.models import Hit

STOPWORDS = frozenset(
    "a an the is are was were how what when where why can could do does i my your "
    "our me it its of to in on for and or with about long please tell have has "
    "orbitdesk support".split()
)


def terms(text: str) -> set[str]:
    return {
        word.rstrip("s")
        for word in re.findall(r"[a-z0-9]+", text.lower())
        if word not in STOPWORDS and len(word) > 2
    }


def relevant_hits(question: str, hits: list[Hit]) -> list[Hit]:
    keywords = terms(question)
    return [
        hit
        for hit in hits
        if math.isfinite(hit.distance)
        and 0 <= hit.distance <= 0.45
        and keywords.intersection(terms(hit.chunk.text))
    ]
