from __future__ import annotations

import subprocess
import sys
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator

from backend.config import BenchmarkDefaults
from backend.model_store import ModelStore
from backend.core.runtime import Runtime, build_runtime, runtime_capabilities
from backend.settings_store import SettingsStore
from backend.workspace_store import WorkspaceStore


@dataclass
class ChatSettings:
    model_id: str
    max_tokens: int
    temperature: float
    top_p: float
    min_p: float
    top_k: int
    repeat_penalty: float
    repeat_context_size: int
    stop_strings: tuple[str, ...]
    enable_thinking: bool


class AppState:
    def __init__(self) -> None:
        defaults = BenchmarkDefaults()
        self.defaults = defaults
        self._runtime_name = defaults.runtime
        self._runtime_models: dict[str, str] = {
            "mlx": defaults.model_id,
            "llama_cpp": "",
            "mock": defaults.model_id,
        }
        self._settings_store = SettingsStore()
        persisted = self._settings_store.load()
        self._runtime: Runtime = build_runtime(defaults.runtime, defaults.model_id)
        self._lock = threading.RLock()
        self._model_store = ModelStore()
        self._workspace = WorkspaceStore(defaults.frontend_dir.parent)
        self._download_status: dict[str, object] = {
            "active": False,
            "phase": "idle",
            "model_id": None,
            "progress": None,
            "downloaded_bytes": 0,
            "total_bytes": None,
            "message": "",
        }
        self._download_stop = threading.Event()
        self._download_process: subprocess.Popen[str] | None = None
        self._download_cancelled = False
        self._settings = ChatSettings(
            model_id=defaults.model_id,
            max_tokens=int(persisted.get("max_tokens", defaults.max_tokens)),
            temperature=float(persisted.get("temperature", defaults.temperature)),
            top_p=float(persisted.get("top_p", defaults.top_p)),
            min_p=float(persisted.get("min_p", defaults.min_p)),
            top_k=int(persisted.get("top_k", defaults.top_k)),
            repeat_penalty=float(persisted.get("repeat_penalty", defaults.repeat_penalty)),
            repeat_context_size=int(persisted.get("repeat_context_size", defaults.repeat_context_size)),
            stop_strings=tuple(persisted.get("stop_strings", defaults.stop_strings)),
            enable_thinking=bool(persisted.get("enable_thinking", defaults.enable_thinking)),
        )

    def available_models(self) -> list[dict[str, object]]:
        if self._runtime_name == "llama_cpp":
            return self.local_gguf_models()
        known_ids = list(dict.fromkeys([*self.defaults.models, *(model["id"] for model in self._model_store.list_local_models())]))
        return [
            {
                "id": model_id,
                "cached": self._model_store.is_cached(model_id),
                "selected": model_id == self._settings.model_id,
                "loaded": model_id == self._settings.model_id and self._runtime.is_loaded(),
            }
            for model_id in known_ids
        ]

    def local_models(self) -> list[dict[str, object]]:
        local = self._model_store.list_local_models()
        for item in local:
            item["selected"] = item["id"] == self._settings.model_id
            item["loaded"] = item["id"] == self._settings.model_id and self._runtime.is_loaded()
        return local

    def local_gguf_models(self) -> list[dict[str, object]]:
        local = self._model_store.list_local_gguf_models()
        for item in local:
            item["selected"] = item["path"] == self._settings.model_id
            item["loaded"] = item["path"] == self._settings.model_id and self._runtime.is_loaded()
        return local

    def switch_runtime(self, runtime_name: str, model_id: str | None = None) -> dict[str, object]:
        with self._lock:
            if runtime_name not in {item["id"] for item in runtime_capabilities()}:
                raise ValueError(f"Unsupported runtime: {runtime_name}")

            if model_id is not None:
                self._runtime_models[runtime_name] = model_id

            next_model = self._runtime_models.get(runtime_name, "")
            self._runtime.unload()
            self._runtime_name = runtime_name
            self._runtime = build_runtime(runtime_name, next_model)
            self._settings.model_id = next_model
            return self.status()

    def preload_model(self, model_id: str) -> dict[str, object]:
        with self._lock:
            if self._runtime_name == "mlx":
                ready, error = self._model_store.mlx_model_status(model_id)
                if not ready:
                    raise ValueError(error or f"{model_id} is not compatible with the current MLX runtime.")

            previous_runtime = self._runtime
            previous_model_id = self._settings.model_id
            runtime_changed = model_id != previous_model_id
            candidate_runtime = previous_runtime if not runtime_changed else build_runtime(self._runtime_name, model_id)

            try:
                if runtime_changed:
                    previous_runtime.unload()
                candidate_runtime.load()
                candidate_runtime.warmup()
            except Exception as exc:  # noqa: BLE001 - normalize incompatible model failures
                if runtime_changed:
                    self._runtime = previous_runtime
                    self._settings.model_id = previous_model_id
                    self._runtime_models[self._runtime_name] = previous_model_id
                raise ValueError(self._format_model_error(model_id, exc)) from exc

            if runtime_changed:
                self._runtime = candidate_runtime
                self._settings.model_id = model_id
                self._runtime_models[self._runtime_name] = model_id

            return self.status()

    def unload_model(self) -> dict[str, object]:
        with self._lock:
            self._runtime.unload()
            return self.status()

    def delete_model(
        self,
        model_id: str | None = None,
        model_path: str | None = None,
        format: str | None = None,
    ) -> dict[str, object]:
        with self._lock:
            active_target = model_path or model_id
            if active_target == self._settings.model_id:
                self._runtime.unload()

            if format == "gguf" and model_path:
                self._model_store.delete_gguf(model_path)
            elif model_id:
                self._model_store.delete_model(model_id)

            return self.status()

    def search_models(self, query: str) -> list[dict[str, object]]:
        return self._model_store.search_models(query)

    def download_model(
        self,
        model_id: str,
        format: str | None = None,
        filename: str | None = None,
    ) -> dict[str, object]:
        with self._lock:
            if self._download_status["active"]:
                return dict(self._download_status)

            model_format = format or "mlx"
            total_bytes = self._model_store.model_size_bytes(model_id, format=model_format, filename=filename)
            baseline_bytes = self._model_store.cache_root_size()
            self._download_stop = threading.Event()
            self._download_cancelled = False
            self._download_status = {
                "active": True,
                "phase": "starting",
                "model_id": model_id,
                "format": model_format,
                "filename": filename,
                "progress": 0.0,
                "downloaded_bytes": 0,
                "total_bytes": total_bytes,
                "message": "Preparing download...",
            }

            self._download_process = subprocess.Popen(
                [
                    sys.executable,
                    "-m",
                    "backend.download_worker",
                    "--model-id",
                    model_id,
                    "--format",
                    model_format,
                    *(["--filename", filename] if filename else []),
                ],
                cwd=str(self.defaults.frontend_dir.parent),
                stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE,
                text=True,
            )

            monitor = threading.Thread(
                target=self._monitor_download_progress,
                args=(baseline_bytes, total_bytes),
                daemon=True,
            )
            monitor.start()

            watcher = threading.Thread(
                target=self._wait_for_download_process,
                args=(model_id, total_bytes, baseline_bytes),
                daemon=True,
            )
            watcher.start()
            return dict(self._download_status)

    def model_files(self, model_id: str, format: str = "gguf") -> list[dict[str, object]]:
        return self._model_store.list_model_files(model_id, format=format)

    def model_activity(self) -> dict[str, object]:
        with self._lock:
            return dict(self._download_status)

    def cancel_download(self) -> dict[str, object]:
        with self._lock:
            process = self._download_process
            if not process or not self._download_status["active"]:
                return dict(self._download_status)

            self._download_cancelled = True
            process.terminate()
            self._set_download_status(
                active=False,
                phase="cancelled",
                progress=None,
                message=f"Cancelled download for {self._download_status['model_id']}.",
            )
            self._download_stop.set()
            return dict(self._download_status)

    def chat(
        self,
        messages: list[dict[str, str]],
        max_tokens: int | None = None,
        temperature: float | None = None,
        top_p: float | None = None,
        min_p: float | None = None,
        top_k: int | None = None,
        repeat_penalty: float | None = None,
        repeat_context_size: int | None = None,
        stop_strings: list[str] | None = None,
        enable_thinking: bool | None = None,
        session_id: str | None = None,
    ) -> dict[str, object]:
        with self._lock:
            result = self._runtime.generate_messages(
                messages,
                max_tokens=max_tokens or self._settings.max_tokens,
                temperature=self._settings.temperature if temperature is None else temperature,
                top_p=self._settings.top_p if top_p is None else top_p,
                min_p=self._settings.min_p if min_p is None else min_p,
                top_k=self._settings.top_k if top_k is None else top_k,
                repetition_penalty=self._settings.repeat_penalty if repeat_penalty is None else repeat_penalty,
                repetition_context_size=self._settings.repeat_context_size
                if repeat_context_size is None
                else repeat_context_size,
                stop_strings=list(self._settings.stop_strings if stop_strings is None else stop_strings),
                enable_thinking=self._settings.enable_thinking if enable_thinking is None else enable_thinking,
                session_id=session_id,
            )
            return {
                "reply": result.output_text,
                "metrics": result.metrics_dict(),
                "model_id": result.model_id,
            }

    def stream_chat(
        self,
        messages: list[dict[str, str]],
        max_tokens: int | None = None,
        temperature: float | None = None,
        top_p: float | None = None,
        min_p: float | None = None,
        top_k: int | None = None,
        repeat_penalty: float | None = None,
        repeat_context_size: int | None = None,
        stop_strings: list[str] | None = None,
        enable_thinking: bool | None = None,
        session_id: str | None = None,
    ) -> Iterator[dict[str, object]]:
        with self._lock:
            yield from self._runtime.stream_messages(
                messages,
                max_tokens=max_tokens or self._settings.max_tokens,
                temperature=self._settings.temperature if temperature is None else temperature,
                top_p=self._settings.top_p if top_p is None else top_p,
                min_p=self._settings.min_p if min_p is None else min_p,
                top_k=self._settings.top_k if top_k is None else top_k,
                repetition_penalty=self._settings.repeat_penalty if repeat_penalty is None else repeat_penalty,
                repetition_context_size=self._settings.repeat_context_size
                if repeat_context_size is None
                else repeat_context_size,
                stop_strings=list(self._settings.stop_strings if stop_strings is None else stop_strings),
                enable_thinking=self._settings.enable_thinking if enable_thinking is None else enable_thinking,
                session_id=session_id,
            )

    def status(self) -> dict[str, object]:
        return {
            "runtime": self._runtime_name,
            "runtimes": runtime_capabilities(),
            "model_id": self._settings.model_id,
            "loaded": self._runtime.is_loaded(),
            "max_tokens": self._settings.max_tokens,
            "temperature": self._settings.temperature,
            "top_p": self._settings.top_p,
            "min_p": self._settings.min_p,
            "top_k": self._settings.top_k,
            "repeat_penalty": self._settings.repeat_penalty,
            "repeat_context_size": self._settings.repeat_context_size,
            "stop_strings": list(self._settings.stop_strings),
            "enable_thinking": self._settings.enable_thinking,
            "models": self.available_models(),
        }

    def update_settings(
        self,
        max_tokens: int | None = None,
        temperature: float | None = None,
        top_p: float | None = None,
        min_p: float | None = None,
        top_k: int | None = None,
        repeat_penalty: float | None = None,
        repeat_context_size: int | None = None,
        stop_strings: list[str] | None = None,
        enable_thinking: bool | None = None,
    ) -> dict[str, object]:
        if max_tokens is not None:
            self._settings.max_tokens = max_tokens
        if temperature is not None:
            self._settings.temperature = temperature
        if top_p is not None:
            self._settings.top_p = top_p
        if min_p is not None:
            self._settings.min_p = min_p
        if top_k is not None:
            self._settings.top_k = top_k
        if repeat_penalty is not None:
            self._settings.repeat_penalty = repeat_penalty
        if repeat_context_size is not None:
            self._settings.repeat_context_size = repeat_context_size
        if stop_strings is not None:
            self._settings.stop_strings = tuple(item for item in stop_strings if item)
        if enable_thinking is not None:
            self._settings.enable_thinking = enable_thinking
        self._persist_settings()
        return self.status()

    def _persist_settings(self) -> None:
        self._settings_store.save(
            {
                "max_tokens": self._settings.max_tokens,
                "temperature": self._settings.temperature,
                "top_p": self._settings.top_p,
                "min_p": self._settings.min_p,
                "top_k": self._settings.top_k,
                "repeat_penalty": self._settings.repeat_penalty,
                "repeat_context_size": self._settings.repeat_context_size,
                "stop_strings": list(self._settings.stop_strings),
                "enable_thinking": self._settings.enable_thinking,
            }
        )

    def reset_session(self, session_id: str) -> None:
        runtime = self._runtime
        if hasattr(runtime, "reset_session"):
            runtime.reset_session(session_id)

    def list_workspace_files(self, query: str = "") -> list[dict[str, object]]:
        return self._workspace.list_files(query=query)

    def read_workspace_file(self, relative_path: str) -> dict[str, object]:
        return self._workspace.read_file(relative_path)

    def _monitor_download_progress(self, baseline_bytes: int, total_bytes: int | None) -> None:
        while not self._download_stop.wait(0.35):
            downloaded_bytes = max(self._model_store.cache_root_size() - baseline_bytes, 0)
            progress = None
            if total_bytes and total_bytes > 0:
                progress = min(downloaded_bytes / total_bytes, 0.99)
            self._set_download_status(
                phase="downloading",
                downloaded_bytes=downloaded_bytes,
                total_bytes=total_bytes,
                progress=progress,
                message="Downloading model files...",
            )

    def _wait_for_download_process(
        self,
        model_id: str,
        total_bytes: int | None,
        baseline_bytes: int,
    ) -> None:
        process: subprocess.Popen[str] | None
        with self._lock:
            process = self._download_process
        if process is None:
            return

        _, stderr = process.communicate()
        downloaded_bytes = max(self._model_store.cache_root_size() - baseline_bytes, 0)

        with self._lock:
            cancelled = self._download_cancelled
            self._download_process = None

        if cancelled:
            self._download_stop.set()
            return

        if process.returncode == 0:
            self._set_download_status(
                active=False,
                phase="completed",
                progress=1.0,
                downloaded_bytes=downloaded_bytes,
                total_bytes=total_bytes,
                message=f"{model_id} is ready.",
            )
        else:
            error_message = (stderr or "").strip() or f"Download failed with exit code {process.returncode}."
            self._set_download_status(
                active=False,
                phase="error",
                progress=None,
                downloaded_bytes=downloaded_bytes,
                total_bytes=total_bytes,
                message=error_message,
            )
        self._download_stop.set()

    def _set_download_status(self, **updates: object) -> None:
        with self._lock:
            self._download_status = {
                **self._download_status,
                **updates,
            }

    def _format_model_error(self, model_id: str, exc: Exception) -> str:
        raw = str(exc).strip()
        detail = raw.splitlines()[0] if raw else exc.__class__.__name__
        return f"Failed to load {model_id}: {detail}"
