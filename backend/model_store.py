from __future__ import annotations

import shutil
from pathlib import Path

from huggingface_hub import HfApi, snapshot_download
from huggingface_hub.constants import HF_HUB_CACHE


MODEL_ALLOW_PATTERNS = [
    "*.json",
    "model*.safetensors",
    "*.py",
    "tokenizer.model",
    "*.tiktoken",
    "tiktoken.model",
    "*.txt",
    "*.jsonl",
    "*.jinja",
]

GGUF_ALLOW_PATTERNS = [
    "*.gguf",
    "*.json",
    "*.txt",
    "tokenizer.model",
    "*.tiktoken",
    "tiktoken.model",
]


class ModelStore:
    def __init__(self) -> None:
        self.cache_root = Path(HF_HUB_CACHE)
        self.api = HfApi()
        self._mlx_validation_cache: dict[str, tuple[bool, str | None]] = {}

    def list_local_models(self) -> list[dict[str, object]]:
        if not self.cache_root.exists():
            return []

        models: list[dict[str, object]] = []
        for entry in sorted(self.cache_root.glob("models--mlx-community--*")):
            repo_id = self._repo_id_from_cache_dir(entry.name)
            if repo_id is None:
                continue
            snapshot_dir = self._latest_snapshot_dir(entry)
            has_weights = snapshot_dir is not None and self._snapshot_has_mlx_weights(entry)
            compatible, error = self._validate_mlx_snapshot(snapshot_dir) if has_weights else (False, "No MLX safetensors found in the cached snapshot.")
            models.append(
                {
                    "id": repo_id,
                    "cached": True,
                    "size_gb": round(self._dir_size(entry) / 1e9, 2),
                    "path": str(entry),
                    "ready": has_weights and compatible,
                    "error": None if has_weights and compatible else error,
                }
            )
        return models

    def list_local_gguf_models(self, limit: int = 80) -> list[dict[str, object]]:
        models: list[dict[str, object]] = []
        seen: set[str] = set()
        for root in self._gguf_roots():
            if not root.exists():
                continue
            for entry in root.rglob("*.gguf"):
                resolved = str(entry.resolve())
                display_path = str(entry.absolute())
                if resolved in seen or not entry.is_file():
                    continue
                seen.add(resolved)
                repo_id = self._repo_id_for_gguf(entry)
                models.append(
                    {
                        "id": entry.stem,
                        "repo_id": repo_id,
                        "cached": True,
                        "size_gb": round(entry.stat().st_size / 1e9, 2),
                        # Keep the user-facing/loadable .gguf path, not the Hugging Face blob target.
                        "path": display_path,
                    }
                )
                if len(models) >= limit:
                    return sorted(models, key=lambda item: item["path"])
        return sorted(models, key=lambda item: item["path"])

    def search_models(self, query: str, limit: int = 20) -> list[dict[str, object]]:
        local_ids = {model["id"] for model in self.list_local_models()}
        local_ggufs = self.list_local_gguf_models(limit=400)
        local_gguf_by_repo: dict[str, list[dict[str, object]]] = {}
        for model in local_ggufs:
            repo_id = model.get("repo_id")
            if repo_id:
                local_gguf_by_repo.setdefault(repo_id, []).append(model)

        results = []
        seen_ids: set[tuple[str, str]] = set()
        for model in self.api.list_models(author="mlx-community", search=query, limit=limit, full=True):
            if not self._has_mlx_weights(model):
                continue
            size_bytes = self._model_size_bytes(model)
            item = {
                "id": model.id,
                "downloads": getattr(model, "downloads", None),
                "likes": getattr(model, "likes", None),
                "cached": model.id in local_ids,
                "size_gb": round(size_bytes / 1e9, 2) if size_bytes else None,
                "format": "mlx",
                "runtime": "mlx",
                "downloadable": True,
                "ready": True,
            }
            results.append(item)
            seen_ids.add((model.id, "mlx"))

        for model in self.api.list_models(search=query, limit=limit * 3, full=True):
            if (model.id, "gguf") in seen_ids:
                continue
            if not self._has_gguf(model):
                continue
            local_files = local_gguf_by_repo.get(model.id, [])
            size_bytes = self._gguf_size_bytes(model)
            item = {
                "id": model.id,
                "downloads": getattr(model, "downloads", None),
                "likes": getattr(model, "likes", None),
                "cached": bool(local_files),
                "size_gb": round(size_bytes / 1e9, 2) if size_bytes else None,
                "format": "gguf",
                "runtime": "llama_cpp",
                "downloadable": True,
                "local_path": local_files[0]["path"] if len(local_files) == 1 else None,
                "local_count": len(local_files),
            }
            results.append(item)
            seen_ids.add((model.id, "gguf"))
            if len(results) >= limit * 2:
                break

        return sorted(
            results,
            key=lambda item: (
                0 if item["format"] == "mlx" else 1,
                -(item.get("downloads") or 0),
            ),
        )[: limit * 2]

    def model_size_bytes(self, model_id: str, format: str | None = None, filename: str | None = None) -> int | None:
        info = self.api.model_info(model_id, files_metadata=True)
        if format == "gguf" and filename:
            size_bytes = self._named_file_size_bytes(info, filename)
        elif format == "gguf":
            size_bytes = self._gguf_size_bytes(info)
        else:
            size_bytes = self._model_size_bytes(info)
        return size_bytes or None

    def list_model_files(self, model_id: str, format: str = "gguf") -> list[dict[str, object]]:
        info = self.api.model_info(model_id, files_metadata=True)
        files: list[dict[str, object]] = []
        for sibling in getattr(info, "siblings", []) or []:
            name = getattr(sibling, "rfilename", "") or ""
            size = getattr(sibling, "size", 0) or 0
            if format == "gguf" and not name.lower().endswith(".gguf"):
                continue
            files.append(
                {
                    "name": name,
                    "size_bytes": size,
                    "size_gb": round(size / 1e9, 2) if size else None,
                }
            )
        return sorted(files, key=lambda item: item["name"])

    def cache_root_size(self) -> int:
        if not self.cache_root.exists():
            return 0
        return self._dir_size(self.cache_root)

    def download_model(self, model_id: str, format: str = "mlx", filename: str | None = None) -> dict[str, object]:
        if format == "mlx":
            info = self.api.model_info(model_id, files_metadata=True)
            if not self._has_mlx_weights(info):
                raise ValueError(f"{model_id} does not contain MLX safetensors and cannot be loaded by mlx-lm.")
            allow_patterns = MODEL_ALLOW_PATTERNS
        elif filename:
            allow_patterns = [filename, "*.json", "*.txt", "tokenizer.model", "*.tiktoken", "tiktoken.model"]
        else:
            allow_patterns = GGUF_ALLOW_PATTERNS
        path = snapshot_download(model_id, allow_patterns=allow_patterns)
        return {
            "id": model_id,
            "cached": True,
            "path": path,
            "format": format,
            "filename": filename,
        }

    def delete_model(self, model_id: str) -> None:
        cache_dir = self.cache_root / self._cache_folder_name(model_id)
        if cache_dir.exists():
            shutil.rmtree(cache_dir)

    def delete_gguf(self, model_path: str) -> None:
        candidate = Path(model_path).expanduser()
        if not candidate.exists():
            return

        resolved = candidate.resolve()

        # Hugging Face GGUF downloads are usually symlinked from snapshots into blobs.
        # Removing the whole cached repo is the cleanest "delete model" behavior.
        for parent in candidate.parents:
            if parent.name.startswith("models--"):
                shutil.rmtree(parent, ignore_errors=True)
                return

        if candidate.is_file() or resolved.is_file():
            try:
                candidate.unlink(missing_ok=True)
            except OSError:
                if resolved != candidate:
                    resolved.unlink(missing_ok=True)

    def is_cached(self, model_id: str) -> bool:
        return (self.cache_root / self._cache_folder_name(model_id)).exists()

    def mlx_model_status(self, model_id: str) -> tuple[bool, str | None]:
        cache_dir = self.cache_root / self._cache_folder_name(model_id)
        snapshot_dir = self._latest_snapshot_dir(cache_dir)
        if snapshot_dir is None or not self._snapshot_has_mlx_weights(cache_dir):
            return False, "No MLX safetensors found in the cached snapshot."
        return self._validate_mlx_snapshot(snapshot_dir)

    def gguf_exists(self, model_path: str) -> bool:
        candidate = Path(model_path).expanduser()
        return candidate.exists() and candidate.is_file() and candidate.suffix.lower() == ".gguf"

    def _cache_folder_name(self, model_id: str) -> str:
        return f"models--{model_id.replace('/', '--')}"

    def _repo_id_from_cache_dir(self, dir_name: str) -> str | None:
        if not dir_name.startswith("models--"):
            return None
        repo = dir_name.removeprefix("models--")
        owner, _, name = repo.partition("--")
        if not owner or not name:
            return None
        return f"{owner}/{name}"

    def _gguf_roots(self) -> list[Path]:
        home = Path.home()
        return [
            self.cache_root,
            home / ".cache" / "lm-studio" / "models",
            home / ".cache" / "lmstudio" / "models",
            home / ".lmstudio" / "models",
            home / "Library" / "Application Support" / "LM Studio" / "models",
        ]

    def _repo_id_for_gguf(self, path: Path) -> str | None:
        for parent in path.parents:
            name = parent.name
            if name.startswith("models--"):
                return self._repo_id_from_cache_dir(name)
        return None

    def _dir_size(self, path: Path) -> int:
        total = 0
        for file_path in path.rglob("*"):
            if file_path.is_file():
                total += file_path.stat().st_size
        return total

    def _model_size_bytes(self, model: object) -> int:
        size_bytes = 0
        for sibling in getattr(model, "siblings", []) or []:
            size_bytes += getattr(sibling, "size", 0) or 0
        return size_bytes

    def _gguf_size_bytes(self, model: object) -> int:
        size_bytes = 0
        for sibling in getattr(model, "siblings", []) or []:
            name = getattr(sibling, "rfilename", "") or ""
            if name.lower().endswith(".gguf"):
                size_bytes += getattr(sibling, "size", 0) or 0
        return size_bytes

    def _named_file_size_bytes(self, model: object, filename: str) -> int:
        for sibling in getattr(model, "siblings", []) or []:
            name = getattr(sibling, "rfilename", "") or ""
            if name == filename:
                return getattr(sibling, "size", 0) or 0
        return 0

    def _has_gguf(self, model: object) -> bool:
        for sibling in getattr(model, "siblings", []) or []:
            name = getattr(sibling, "rfilename", "") or ""
            if name.lower().endswith(".gguf"):
                return True
        return False

    def _has_mlx_weights(self, model: object) -> bool:
        for sibling in getattr(model, "siblings", []) or []:
            name = getattr(sibling, "rfilename", "") or ""
            if name.endswith(".safetensors") and "model" in name:
                return True
        return False

    def _snapshot_has_mlx_weights(self, cache_dir: Path) -> bool:
        snapshots_dir = cache_dir / "snapshots"
        if not snapshots_dir.exists():
            return False
        return any(snapshots_dir.rglob("*.safetensors"))

    def _latest_snapshot_dir(self, cache_dir: Path) -> Path | None:
        snapshots_dir = cache_dir / "snapshots"
        if not snapshots_dir.exists():
            return None
        snapshots = [entry for entry in snapshots_dir.iterdir() if entry.is_dir()]
        if not snapshots:
            return None
        return max(snapshots, key=lambda entry: entry.stat().st_mtime)

    def _validate_mlx_snapshot(self, snapshot_dir: Path | None) -> tuple[bool, str | None]:
        if snapshot_dir is None:
            return False, "No cached MLX snapshot found."

        cache_key = str(snapshot_dir)
        cached = self._mlx_validation_cache.get(cache_key)
        if cached is not None:
            return cached

        try:
            from transformers import AutoConfig

            AutoConfig.from_pretrained(snapshot_dir, local_files_only=True)
        except Exception as exc:  # noqa: BLE001 - surface compatibility issues as user-facing state
            message = str(exc).strip().splitlines()[0] if str(exc).strip() else exc.__class__.__name__
            result = (
                False,
                f"Incompatible with the current MLX runtime: {message}",
            )
            self._mlx_validation_cache[cache_key] = result
            return result

        result = (True, None)
        self._mlx_validation_cache[cache_key] = result
        return result
