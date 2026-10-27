"""Internal authenticated FastAPI boundary. No content-bearing access logs."""

import json
import logging
import os
import secrets
import time
from typing import Annotated
from uuid import UUID, uuid4

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, ConfigDict, Field, field_validator

from support_agent.models import Answer
from support_agent.runtime import Runtime, Settings, build_runtime

LOGGER = logging.getLogger("support_agent.requests")
AUTH = HTTPBearer(auto_error=False)


class MessageRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    message: str = Field(min_length=1, max_length=4000)

    @field_validator("message")
    @classmethod
    def nonblank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Message cannot be blank")
        return value


def create_app(runtime: Runtime | None = None, service_token: str | None = None) -> FastAPI:
    token = service_token or os.environ.get("AGENT_SERVICE_TOKEN", "")
    if len(token) < 32 or token.strip() != token or not token.isascii():
        raise ValueError("AGENT_SERVICE_TOKEN must contain at least 32 ASCII characters")
    resolved = runtime if runtime is not None else build_runtime(Settings.from_env())
    app = FastAPI(title="OrbitDesk internal agent", version="0.1.0")

    @app.middleware("http")
    async def correlation(request: Request, call_next):
        try:
            request_id = str(UUID(request.headers.get("X-Request-ID", "")))
        except ValueError:
            request_id = str(uuid4())
        started = time.monotonic()
        response = await call_next(request)
        response.headers["X-Request-ID"] = request_id
        LOGGER.info(
            json.dumps(
                {
                    "event": "http.completed",
                    "request_id": request_id,
                    "status": response.status_code,
                    "duration_ms": round((time.monotonic() - started) * 1000, 2),
                }
            )
        )
        return response

    def authorize(
        credentials: Annotated[
            HTTPAuthorizationCredentials | None,
            Depends(AUTH),
        ],
    ) -> None:
        supplied = credentials.credentials if credentials else ""
        if not secrets.compare_digest(supplied.encode(), token.encode()):
            raise HTTPException(
                status_code=401, detail="Unauthorized", headers={"WWW-Authenticate": "Bearer"}
            )

    @app.post("/agent/respond", response_model=Answer, dependencies=[Depends(authorize)])
    def respond(body: MessageRequest) -> Answer:
        return resolved.agent.respond(body.message)

    @app.get("/health/live")
    def live() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/health/ready")
    def ready() -> JSONResponse:
        try:
            available = resolved.ready()
        except Exception:
            available = False
        return JSONResponse(
            {"status": "ready" if available else "unavailable"},
            status_code=200 if available else 503,
        )

    return app
