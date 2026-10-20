"""Real HTTP evaluation: requires an ingested Chroma index and live Ollama."""

import hashlib
import json
import os
import sys
from pathlib import Path
from time import monotonic
from urllib.request import Request, urlopen


def main() -> None:
    token = os.environ.get("AGENT_SERVICE_TOKEN", "")
    if len(token) < 32:
        raise SystemExit("Set AGENT_SERVICE_TOKEN before running smoke-agent")
    base = "http://127.0.0.1:8001"
    with urlopen(base + "/health/ready", timeout=90) as response:
        if response.status != 200:
            raise SystemExit("Agent is not ready")
    cases = json.loads(Path("data/evaluation.json").read_text())
    failures = 0
    for number, case in enumerate(cases, start=1):
        started = monotonic()
        request = Request(base + "/agent/respond", method="POST",
                          data=json.dumps({"message": case["message"]}).encode(),
                          headers={"Authorization": "Bearer " + token,
                                   "Content-Type": "application/json"})
        with urlopen(request, timeout=90) as response:
            body = json.load(response)
        passed = body["route"] == case["route"]
        if "contains" in case:
            passed = passed and case["contains"] in body["answer"]
        if "document_id" in case:
            source = (Path(os.environ.get("KNOWLEDGE_DIR", "data/knowledge"))
                      / case["document_id"]).read_bytes()
            version = hashlib.sha256(source).hexdigest()
            passed = passed and any(c["document_id"] == case["document_id"]
                                    and c["quote"] == body["answer"]
                                    and c["quote"] in source.decode("utf-8")
                                    and c["version"] == version
                                    for c in body["citations"])
        failures += not passed
        print(json.dumps({"case": number, "passed": bool(passed),
                          "latency_ms": round((monotonic() - started) * 1000, 2),
                          "actual_route": body["route"]}))
    print(json.dumps({"cases": len(cases), "failures": failures}))
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
