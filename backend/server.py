from __future__ import annotations

import asyncio
import json
import logging
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field

from backend.app_state import AppState
from backend.config import BenchmarkDefaults


class ChatMessage(BaseModel):
    model_config = ConfigDict(extra="ignore")

    role: str
    content: str


class ChatRequest(BaseModel):
    messages: list[ChatMessage]
    session_id: str | None = None
    max_tokens: int | None = Field(default=None, ge=1, le=4096)
    temperature: float | None = Field(default=None, ge=0.0, le=2.0)
    top_p: float | None = Field(default=None, ge=0.0, le=1.0)
    min_p: float | None = Field(default=None, ge=0.0, le=1.0)
    top_k: int | None = Field(default=None, ge=0, le=500)
    repeat_penalty: float | None = Field(default=None, ge=0.0, le=3.0)
    repeat_context_size: int | None = Field(default=None, ge=0, le=4096)
    stop_strings: list[str] | None = Field(default=None, max_length=8)
    enable_thinking: bool | None = None


class ModelSelectRequest(BaseModel):
    model_id: str
    format: str | None = None
    filename: str | None = None


class RuntimeSelectRequest(BaseModel):
    runtime: str
    model_id: str | None = None


class ModelSearchRequest(BaseModel):
    query: str = Field(min_length=1)


class ModelDeleteRequest(BaseModel):
    model_id: str | None = None
    model_path: str | None = None
    format: str | None = None


class SettingsRequest(BaseModel):
    max_tokens: int | None = Field(default=None, ge=1, le=4096)
    temperature: float | None = Field(default=None, ge=0.0, le=2.0)
    top_p: float | None = Field(default=None, ge=0.0, le=1.0)
    min_p: float | None = Field(default=None, ge=0.0, le=1.0)
    top_k: int | None = Field(default=None, ge=0, le=500)
    repeat_penalty: float | None = Field(default=None, ge=0.0, le=3.0)
    repeat_context_size: int | None = Field(default=None, ge=0, le=4096)
    stop_strings: list[str] | None = Field(default=None, max_length=8)
    enable_thinking: bool | None = None


class SessionResetRequest(BaseModel):
    session_id: str


class WorkspaceFileRequest(BaseModel):
    path: str


defaults = BenchmarkDefaults()
state = AppState()
app = FastAPI(title="MLX Studio", version="0.1.0")
logger = logging.getLogger("mlx_studio.server")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

frontend_dir = defaults.frontend_dir
app.mount("/static", StaticFiles(directory=frontend_dir), name="static")


@app.middleware("http")
async def disable_frontend_caching(request, call_next):
    response = await call_next(request)
    if request.url.path == "/" or request.url.path.startswith("/static/"):
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    return response


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(_, exc: RequestValidationError) -> JSONResponse:
    logger.warning("Request validation failed", extra={"errors": exc.errors()})
    return JSONResponse(
        status_code=422,
        content={
            "detail": "Request validation failed",
            "errors": exc.errors(),
        },
    )


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/status")
def status() -> dict[str, object]:
    return state.status()


@app.get("/api/activity")
def activity() -> dict[str, object]:
    return state.model_activity()


@app.get("/api/models")
def models() -> dict[str, object]:
    return {"models": state.available_models()}


@app.get("/api/models/local")
def local_models() -> dict[str, object]:
    return {"models": state.local_models()}


@app.get("/api/models/gguf")
def local_gguf_models() -> dict[str, object]:
    return {"models": state.local_gguf_models()}


@app.post("/api/runtime")
def switch_runtime(payload: RuntimeSelectRequest) -> dict[str, object]:
    try:
        return state.switch_runtime(payload.runtime, model_id=payload.model_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/models/select")
def select_model(payload: ModelSelectRequest) -> dict[str, object]:
    try:
        return state.preload_model(payload.model_id)
    except Exception as exc:  # noqa: BLE001 - surface model compatibility issues as 4xx
        logger.warning("Model selection failed for %s: %s", payload.model_id, exc)
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/models/unload")
def unload_model() -> dict[str, object]:
    return state.unload_model()


@app.post("/api/models/delete")
def delete_model(payload: ModelDeleteRequest) -> dict[str, object]:
    if not payload.model_id and not payload.model_path:
        raise HTTPException(status_code=400, detail="model_id or model_path is required")
    return state.delete_model(payload.model_id, model_path=payload.model_path, format=payload.format)


@app.post("/api/models/search")
def search_models(payload: ModelSearchRequest) -> dict[str, object]:
    return {"results": state.search_models(payload.query)}


@app.get("/api/models/files")
def model_files(model_id: str, format: str = "gguf") -> dict[str, object]:
    return {"files": state.model_files(model_id, format=format)}


@app.post("/api/models/download")
def download_model(payload: ModelSelectRequest) -> dict[str, object]:
    try:
        return state.download_model(payload.model_id, format=payload.format, filename=payload.filename)
    except Exception as exc:  # noqa: BLE001 - surface model compatibility issues as 4xx
        logger.warning("Model download failed for %s: %s", payload.model_id, exc)
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/models/download/cancel")
def cancel_download() -> dict[str, object]:
    return state.cancel_download()


@app.post("/api/settings")
def update_settings(payload: SettingsRequest) -> dict[str, object]:
    return state.update_settings(
        max_tokens=payload.max_tokens,
        temperature=payload.temperature,
        top_p=payload.top_p,
        min_p=payload.min_p,
        top_k=payload.top_k,
        repeat_penalty=payload.repeat_penalty,
        repeat_context_size=payload.repeat_context_size,
        stop_strings=payload.stop_strings,
        enable_thinking=payload.enable_thinking,
    )


@app.post("/api/chat")
def chat(payload: ChatRequest) -> dict[str, object]:
    if not payload.messages:
        raise HTTPException(status_code=400, detail="messages are required")
    messages = [message.model_dump() for message in payload.messages]
    try:
        return state.chat(
            messages,
            session_id=payload.session_id,
            max_tokens=payload.max_tokens,
            temperature=payload.temperature,
            top_p=payload.top_p,
            min_p=payload.min_p,
            top_k=payload.top_k,
            repeat_penalty=payload.repeat_penalty,
            repeat_context_size=payload.repeat_context_size,
            stop_strings=payload.stop_strings,
            enable_thinking=payload.enable_thinking,
        )
    except (RuntimeError, ValueError, FileNotFoundError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/chat/stream")
def chat_stream(payload: ChatRequest) -> StreamingResponse:
    if not payload.messages:
        raise HTTPException(status_code=400, detail="messages are required")
    messages = [message.model_dump() for message in payload.messages]

    async def stream() -> object:
        try:
            for event in state.stream_chat(
                messages,
                session_id=payload.session_id,
                max_tokens=payload.max_tokens,
                temperature=payload.temperature,
                top_p=payload.top_p,
                min_p=payload.min_p,
                top_k=payload.top_k,
                repeat_penalty=payload.repeat_penalty,
                repeat_context_size=payload.repeat_context_size,
                stop_strings=payload.stop_strings,
                enable_thinking=payload.enable_thinking,
            ):
                yield json.dumps(event, ensure_ascii=False) + "\n"
                await asyncio.sleep(0)
        except (asyncio.CancelledError, GeneratorExit):
            logger.info("Streaming response cancelled during shutdown or disconnect")
            return
        except (RuntimeError, ValueError, FileNotFoundError) as exc:
            logger.warning("Streaming request failed", extra={"detail": str(exc)})
            yield json.dumps({"type": "error", "message": str(exc)}, ensure_ascii=False) + "\n"
            return

    return StreamingResponse(stream(), media_type="application/x-ndjson")


@app.post("/api/session/reset")
def reset_session(payload: SessionResetRequest) -> dict[str, bool]:
    state.reset_session(payload.session_id)
    return {"ok": True}


@app.get("/api/workspace/files")
def workspace_files(query: str = "") -> dict[str, object]:
    return {"files": state.list_workspace_files(query=query)}


@app.post("/api/workspace/file")
def workspace_file(payload: WorkspaceFileRequest) -> dict[str, object]:
    try:
        return state.read_workspace_file(payload.path)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/")
def index() -> FileResponse:
    return FileResponse(Path(frontend_dir) / "index.html")
