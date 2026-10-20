# Executable implementation checklist

**Goal:** Build the supplied platform in gated milestones.
**Architecture:** See [architecture.md](architecture.md); M1 first, then the public
API and relational storage, browser, events/ingestion scheduler, infrastructure, CI.
**Execution:** Superpowers executing-plans inline, with test-driven development
and verification-before-completion. Synthetic data only; local services only;
no mock final demo path; no paid services or cloud provisioning.

## M0 — Discovery and design

- [x] Inspect files, Git, skills, installed runtimes, reuse candidates, and tests.
- [x] Document interfaces, data model, request/error contracts and threat boundaries.
- [x] Record baseline commands, dependency constraints, decisions, and this checklist.

## M1 — Agent and RAG

- [x] Add tests in `services/agent/tests/test_core_domain.py` for FAQ citations,
  ticket routing/unknown IDs, uncertainty, injection, and dependency failures.
  Run `make test-core` before implementation and record the expected missing-feature
  failure; then implement `models.py`, `agent.py`, `tickets.py`, and `retrieval.py`.
- [x] Test stable IDs, bounded chunks, incremental replacement/deletion, missing
  documents, and failed updates before implementing `ingest.py` and `chroma.py`.
- [x] Test timeout/retry/invalid Ollama output in `test_core_ollama.py` before implementing
  `ollama.py`. Use deterministic transport doubles only in tests.
- [x] Implement `api.py`, dependency wiring in `runtime.py`, and explicit ingest CLI.
- [ ] Run `test_api.py` against the real FastAPI boundary using TestClient with injected
  domain dependencies, plus `test_storage.py` with real Chroma/PDF. These tests are
  written but cannot import missing packages; no dependency skips in the full target.
- [ ] Run `make test-core`, `make test`, `make lint`, `make typecheck`, and live
  `make ingest` / `make smoke-agent` with real Chroma/Ollama. M1 is complete only
  when API tests and a grounded FAQ plus synthetic ticket HTTP request pass.

## M2 — LoopBack and PostgreSQL

- [ ] Inspect M1 contracts; add `apps/api` strict TypeScript LoopBack service and
  versioned migrations for the schema in architecture.md.
- [ ] Write integration tests for create/send/read, invalid inputs, ownership,
  operator auth, agent outage, and retry idempotency; implement routes, storage,
  ticket ownership lookup, agent client, and durable escalations.
- [ ] Run API lint/typecheck/tests and real PostgreSQL + Python integration tests.
  Export and validate OpenAPI; proceed only with the full conversation flow passing.

## M3 — Angular

- [ ] Build accessible `apps/web` chat and operator dashboard using M2 contracts.
- [ ] Add loading/error, citations, history, escalation; Playwright grounded-answer
  and reload test against real API/agent; run build, lint, unit and e2e checks.

## M4 — Kafka and Airflow

- [ ] Add versioned event schemas, transactional outbox publisher, deduplicating
  consumer, and repeatable ingestion DAG. Prove event delivery and duplicate
  handling against local Kafka; run DAG ingestion twice and inspect stable index.

## M5 — Observability and infrastructure

- [ ] Add JSON logs, bounded-label Prometheus metrics, Grafana views, Dockerfiles,
  Compose with health checks/seed commands, K8s probes/resources/config/secrets refs.
- [ ] Run Compose smoke and K8s schema validation. Record resource usage and actual
  results; do not claim cluster deployment without a real local cluster run.

## M6 — CI and portfolio

- [ ] Add Python/TypeScript gates, browser e2e, image builds and security scanning.
- [ ] Validate documented setup from a clean checkout; capture real screenshots,
  measured evaluation results, demo script, trade-offs, and limitations.

At each gate update `docs/progress.md` with files, exact commands and observed
results. When blocked, continue independent work within that milestone, record
the failed attempts and exact recovery action, and leave its gate unchecked.
