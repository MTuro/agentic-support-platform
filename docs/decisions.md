# Decisions and discovery

- Follow the supplied architecture instead of introducing a different framework.
  Keep the Python domain dependency-free so tests can run in restricted hosts;
  production HTTP uses FastAPI, production vectors use Chroma, and embeddings and
  quote selection use Ollama. Test doubles exist only under tests.
- Use Python 3.12 as the supported full-stack baseline. The supplied host has
  Python 3.14.8, Node 26.12.0, npm 12.2.1; dependency compatibility is not yet proven.
  No Docker, Ollama, psql, uv, globally installed pip, FastAPI, pytest or Chroma was
  found. `python -m venv .venv` bootstraps bundled pip locally.
- Network probe `curl -I --max-time 15 https://pypi.org/simple/fastapi/` failed
  with exit 6 (DNS). Both default and explicit-PyPI pip installation attempts
  returned no matching distribution. No network permission escalation or paid
  service is authorized/needed. Exact recovery commands are in README.
- No existing RAG MCP code was found in this repo or the available project roots;
  no external code has been copied. Standard package dependencies retain their
  own licenses. IBM watsonx Orchestrate is not integrated or tested.
- Superpowers was found at
  `/home/turo/.codex/.tmp/plugins/plugins/superpowers/skills/`; read
  using-superpowers, brainstorming, writing-plans, executing-plans,
  test-driven-development (including writing-good-tests), using-git-worktrees,
  and verification-before-completion. Ponytail was not found locally or among
  available tools. Ad Superpowers tools are marketing tools and are unrelated.
- The user's explicit autonomous implementation instruction overrides interactive
  skill design/plan approvals and repeated pauses. Execute inline, test first,
  verify before claiming completion. The repository has no initial commit, so a
  worktree cannot be created without manufacturing a baseline commit; use a feature
  branch in this otherwise empty checkout. Do not commit or publish automatically.
- Baseline: `git status --short` showed only the supplied untracked plan;
  `git log -1 --oneline` reported no commits. `python -m unittest discover -v`
  discovered zero tests and exited 5 on Python 3.14. There is no passing baseline
  suite to preserve. Dependency installation failures are environmental blockers,
  not evidence that FastAPI/Chroma/Ollama integration works.
- Consulted primary references for boundary contracts:
  [FastAPI testing](https://fastapi.tiangolo.com/tutorial/testing/),
  [Chroma records](https://docs.trychroma.com/docs/collections/add-data),
  [Ollama chat](https://docs.ollama.com/api/chat), and
  [Ollama embeddings](https://docs.ollama.com/api/embed).
