# OrbitDesk support platform

Implementation of [the supplied plan](CODEX_AI_CUSTOMER_SUPPORT_PLAN.md), using
synthetic SaaS support content. M0–M2 are complete. The LoopBack API persists
conversations and escalations in PostgreSQL, authorizes customers and operators,
and calls the Python agent for cited RAG and owned tickets. Validation: 43 Python
tests plus nine subtests, 12 API tests, lint/type checks, six M1 and four M2 real
HTTP smoke cases, and persistence after API restart. M3–M6 remain pending.

[Architecture and contracts](docs/architecture.md) · [Decisions](docs/decisions.md) ·
[Checklist](docs/roadmap.md) · [M2 API setup and contracts](docs/m2.md)

The M1 service routes between versioned knowledge retrieval, synthetic ticket
status, and an explicit escalation decision. Chroma stores vector chunks; Ollama
provides embeddings and selects verbatim evidence. Citation metadata comes from
the server. There are no model/vector fallback mocks in the production path.
The public M2 API persists escalation decisions in a durable human queue.

## Setup on a network-enabled local host

Use Python 3.12 and GNU Make. Install local Ollama separately. No cloud accounts
or paid services are required. Full dependency versions are bounded in
`services/agent/pyproject.toml`; there is no verified lockfile yet. Linux with
Python 3.12 is the intended supported environment; a clean-checkout verification
is still pending. Allow several GB of disk/RAM for local models; actual resource
requirements have not been measured. Docker and the rest of the platform are later
milestones, not required to start this agent service.

From the repository root:

```bash
make setup PYTHON=python3.12
source .venv/bin/activate
cp .env.example .env
# Edit .env and set AGENT_SERVICE_TOKEN to a random value generated with:
python -c 'import secrets; print(secrets.token_urlsafe(32))'
set -a
source .env
set +a
ollama serve
```

In another shell, activate the venv and load `.env` as above, then:

```bash
ollama pull nomic-embed-text
ollama pull qwen2.5:3b
make test
make lint
make typecheck
make ingest
make agent
```

Keep Ollama and the agent running; in a third shell with the same environment:

```bash
make smoke-agent
```

The smoke command makes real authenticated HTTP requests for FAQ citations,
ticket status, uncertainty, prompt injection and human escalation. It reports
actual case results and latency, and exits nonzero if any case fails. The recorded M1 acceptance run passed all six cases. `/docs` and `/openapi.json` describe the agent's
implemented contract. The public LoopBack contract is in
[apps/api/openapi.json](apps/api/openapi.json) and its `/openapi.json` endpoint.

Try a request without putting a credential into the source tree:

```bash
curl --fail-with-body http://127.0.0.1:8001/agent/respond \
  -H "Authorization: Bearer $AGENT_SERVICE_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"message":"How long are backups retained?"}'
```

Use `TKT-1001` for a synthetic ticket. The internal service must remain loopback
only. M2 adds customer identity and ticket ownership at the public API. It uses a shared
service token, not customer authentication. Set an unused `CHROMA_DIR` if changing
embedding models, then ingest again. Ingestion scans only reviewed Markdown/PDF
files, upserts changed sources and removes deleted ones. Emptying the configured
directory deliberately deletes its indexed sources. Do not run multiple ingestion
writers concurrently. Stop local processes with Ctrl-C; remove `.data/chroma`
only when deliberately resetting the disposable synthetic index.

## Verification without external packages

```bash
make test-core
python -m compileall -q services/agent/src services/agent/tests tests
```

Core tests use Python's standard `unittest` with deterministic test-only transport,
vector and model doubles. They exercise actual routing, validation, grounding,
chunking, sync behavior and adapter logic. They do **not** prove third-party
integration. `make test` requires pytest, FastAPI/httpx, Chroma and pypdf and does
not skip unavailable integrations. `make lint`/`make typecheck` require ruff/mypy.

Full acceptance requires local service access and the installed Ollama models.
Complete all M1 checks above before proceeding to M2. Do not replace these
services with mock APIs to satisfy the acceptance gate.

## Trade-offs and remaining scope

The first response path is extractive: a model-selected quote must occur in a
retrieved chunk and pass a relevance check. This sacrifices fluent synthesis and
semantic recall for auditable evidence; quote matching alone does not establish
answer correctness. Fixed-size chunks may split sentences. Curated documents and
the synthetic evaluation set are small, English-only examples. Injection filters
are deliberately limited and are not a substitute for tool permissions and data
authorization. Observed CPU FAQ latency was 13–35 seconds; distance thresholds still need broader evaluation.

Angular, Kafka, Airflow, Prometheus/Grafana, Compose, Kubernetes,
CI/CD, screenshots and the full end-to-end portfolio demo are pending milestones.
No IBM watsonx Orchestrate integration or cluster deployment is claimed.
