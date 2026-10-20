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
