"""Read-only synthetic fixture; M2 replaces this with an authorized API tool."""

import json
import re
from pathlib import Path

from support_agent.models import Ticket

TICKET_ID = re.compile(r"TKT-\d{4}")


class JsonTickets:
    def __init__(self, path: Path):
        records = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(records, list):
            raise ValueError("Ticket seed must be a list")
        self._tickets: dict[str, Ticket] = {}
        for record in records:
            if (
                not isinstance(record, dict)
                or set(record) != {"id", "status", "summary"}
                or not isinstance(record["id"], str)
                or not TICKET_ID.fullmatch(record["id"])
                or record["status"] not in ("open", "in_progress", "resolved")
                or not isinstance(record["summary"], str)
                or not 1 <= len(record["summary"]) <= 200
                or record["id"] in self._tickets
            ):
                raise ValueError("Invalid or duplicate synthetic ticket")
            self._tickets[record["id"]] = Ticket(**record)

    def get(self, ticket_id: str) -> Ticket | None:
        if not TICKET_ID.fullmatch(ticket_id):
            raise ValueError("Invalid ticket ID")
        return self._tickets.get(ticket_id)
