# Implementation progress

## M0 — Complete

Created `docs/architecture.md`, `docs/decisions.md`, `docs/roadmap.md`, and this log.
Inspected the supplied plan, repository/Git, runtime commands, local skills, and
available tools. No source or reusable RAG implementation existed. No baseline
tests existed (`python -m unittest discover -v`: 0 tests, exit 5).

Runtime probes: Python 3.14.8, Node 26.12.0, npm 12.2.1. Docker/Ollama/psql/uv absent.
`python -m venv .venv` succeeded. Installing FastAPI/httpx/uvicorn/pytest/ruff/
Chroma/pypdf failed; explicit PyPI retry failed too. `curl` to PyPI exited 6,
could not resolve host. No dependencies downloaded. See decisions for skill usage.

Design review: the agent owns RAG decisions, M2 owns authorization/persistence;
escalation decisions are not claimed as queued; Chroma is only a vector store;
the final demo requires actual Ollama, Chroma and HTTP services. M1 tasks are
actionable independently with a dependency-free test layer.

## M1 — Implemented in part; acceptance blocked

Created Python domain models, routing/grounding, synthetic ticket tool, curated
Markdown/PDF ingestion, Chroma persistence, bounded Ollama adapter, FastAPI
service/auth/correlation logs/health endpoints, production composition, dependency
manifest, `.env.example`, Make targets, synthetic knowledge/tickets/evaluation cases,
README setup, and real HTTP smoke command. No fallback mocks exist in production.
Files live under `services/agent/src/support_agent`, `services/agent/tests`,
`data`, and `tests/smoke_agent.py`. Changes remain uncommitted on
`feat/agent-rag-vertical-slice`; the supplied plan is preserved.

Used Superpowers TDD: initial tests failed on missing domain modules, ingestion/
Ollama modules, and then the Chroma adapter before their implementations. Core
suite grew from 12 to 27 to 31 passing tests. Review found two adapter faults:
incomplete documents disappeared from sync inventory, and `max(0, NaN)` made an
invalid distance look relevant. Added regression tests, observed two failures,
fixed inventory to retain an empty version sentinel and explicitly rejected
non-finite distances. The resulting core suite passes 33 tests. Read and applied
Superpowers systematic-debugging guidance for these failures.

Commands and observed results on the implementation host:

| Command | Actual result |
| --- | --- |
| `make test-core` | 33 tests passed; exit 0 |
| `python -m compileall -q services/agent/src services/agent/tests tests` | Python compilation passed; exit 0 |
| Python `ast.parse` for all 17 Python files, `tomllib.loads` for pyproject and `json.loads` for fixtures | Parsed successfully; exit 0 |
| `make test` | Blocked: `No module named pytest`; make exit 2 |
| `PYTHONPATH=services/agent/src python -m unittest discover -s services/agent/tests -v` | 33 core tests pass; 2 module import errors (`fastapi`, `pypdf`); exit 1 |
| `make lint` | Blocked: `No module named ruff`; make exit 2 |
| `make typecheck` | Blocked: `No module named mypy`; make exit 2 |
| `make ingest` | Blocked: `No module named chromadb`; make exit 2 |
| `make agent` | Blocked: `No module named uvicorn`; make exit 2 |
| `make smoke-agent` | Exits with instruction to set a generated service token; make exit 2. Service/Ollama unavailable too; no live evaluation result claimed. |
| `.venv/bin/python -m pip --isolated install --index-url https://pypi.org/simple --retries 0 --timeout 5 fastapi` | Third install probe failed: no matching distribution; exit 1 |
| `git diff --check` | Exit 0; note all implementation files are new/untracked, so this is not a full content review |

Core doubles stand in only for external model/vector/transport dependencies in
tests. `test_api.py` contains six required FastAPI contract tests; `test_storage.py`
contains two required real Chroma/PDF integration tests, including reopen,
incremental replacement/deletion and model mismatch. They have not executed and
are not marked passing. No lint, mypy, real PDF/Chroma compatibility, live Ollama,
resource measurement, or full HTTP demo is claimed. Dependency bounds are not
a tested lockfile. Ruff formatting may still require normalization once installed.

### Recovery / exact next action

On a network-enabled local host with Python 3.12, run `make setup PYTHON=python3.12`,
activate `.venv`, configure a generated token using `.env.example`, and load it
into each shell as described in README. Install/start local Ollama and pull
`nomic-embed-text` and `qwen2.5:3b`. Run `make test`, `make lint`, `make typecheck`,
and fix any failures before `make ingest`, `make agent`, and `make smoke-agent`.
Only mark M1 complete after the real FAQ/ticket API flow and these checks pass.
The sandbox cannot restore package/network access or provision missing runtimes;
no permission escalation or cloud replacement was attempted.

Remaining design limitations: coarse chunk boundaries/lexical gating can reduce
recall; quote verification does not prove semantic correctness; curated documents
are required; ingestion is single-writer; readiness performs model requests and
may be slow; M1 escalation is not a persisted human queue and synthetic ticket
lookup has service auth only, not customer ownership. These boundaries are
documented and must not be presented as production-ready multi-tenant support.

## M2–M6 — Pending

Their acceptance gates depend on the M1 API slice. No completion claims yet.
