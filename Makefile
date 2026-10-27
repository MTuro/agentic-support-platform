PYTHON ?= python3
AGENT_SRC = services/agent/src

.PHONY: setup test-core test lint typecheck ingest agent smoke-agent
setup:
	$(PYTHON) -m venv .venv
	.venv/bin/python -m pip install -e 'services/agent[dev]'

test-core:
	PYTHONPATH=$(AGENT_SRC) $(PYTHON) -m unittest discover -s services/agent/tests -p 'test_core_*.py' -v

test:
	PYTHONPATH=$(AGENT_SRC) $(PYTHON) -m pytest services/agent/tests -v

lint:
	$(PYTHON) -m ruff check services/agent
	$(PYTHON) -m ruff format --check services/agent

typecheck:
	$(PYTHON) -m mypy services/agent/src

ingest:
	PYTHONPATH=$(AGENT_SRC) $(PYTHON) -m support_agent.ingest

agent:
	PYTHONPATH=$(AGENT_SRC) $(PYTHON) -m uvicorn support_agent.api:create_app --factory --host 127.0.0.1 --port 8001 --no-access-log

smoke-agent:
	$(PYTHON) tests/smoke_agent.py

# M2 requires Node 22/24 and a real PostgreSQL DATABASE_URL.
.PHONY: api-setup api-build api-test api-lint api-typecheck api-migrate api-seed api smoke-api
api-setup:
	npm --prefix apps/api ci

api-build:
	npm --prefix apps/api run build

api-test:
	npm --prefix apps/api test

api-lint:
	npm --prefix apps/api run lint

api-typecheck:
	npm --prefix apps/api run typecheck

api-migrate:
	npm --prefix apps/api run migrate

api-seed:
	npm --prefix apps/api run seed

api:
	npm --prefix apps/api start

smoke-api:
	npm --prefix apps/api run smoke
