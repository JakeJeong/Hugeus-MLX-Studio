from __future__ import annotations

import os
import shutil
import ssl
import sys
from pathlib import Path

import certifi
import httpx
from huggingface_hub import HfApi, snapshot_download
from huggingface_hub.constants import HF_HUB_CACHE

from backend.config import HF_MIRROR_ENDPOINT, HUGGING_FACE_ENDPOINT, TLS_CERT_DIR

try:
    import truststore
except Exception:  # noqa: BLE001 - optional dependency
    truststore = None


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
        self._additional_model_roots: list[str] = []
        self._initial_ssl_cert_file = os.environ.get("SSL_CERT_FILE")
        self._initial_requests_ca_bundle = os.environ.get("REQUESTS_CA_BUNDLE")
        self._initial_hf_endpoint = os.environ.get("HF_ENDPOINT")
        self._custom_ca_bundle_path: str | None = None
        self._effective_ca_bundle_path: str | None = None
        self._ca_bundle_source = "default"
        self._generated_ca_bundle_path = TLS_CERT_DIR / "effective-ca-bundle.pem"
        self._hub_endpoint = self._normalize_hub_endpoint(self._initial_hf_endpoint)
        self.configure_tls_certificate_bundle(None)
        self.configure_hub_endpoint(self._hub_endpoint)

    def list_local_models(self) -> list[dict[str, object]]:
        models: list[dict[str, object]] = []
        seen_ids: set[str] = set()

        for entry in self._hf_cache_mlx_entries():
            repo_id = self._repo_id_from_cache_dir(entry.name)
            if repo_id is None or repo_id in seen_ids:
                continue
            seen_ids.add(repo_id)
            snapshot_dir = self._latest_snapshot_dir(entry)
            has_weights = snapshot_dir is not None and self._snapshot_has_mlx_weights(entry)
            compatible, error = self._validate_mlx_snapshot(snapshot_dir) if has_weights else (False, "No MLX safetensors found in the cached snapshot.")
            models.append(
                {
                    "id": repo_id,
                    "display_name": repo_id,
                    "repo_id": repo_id,
                    "cached": True,
                    "size_gb": round(self._dir_size(entry) / 1e9, 2),
                    "path": str(entry),
                    "ready": has_weights and compatible,
                    "error": None if has_weights and compatible else error,
                }
            )

        for entry in self._external_mlx_roots():
            model_id = str(entry)
            if model_id in seen_ids:
                continue
            seen_ids.add(model_id)
            has_weights = self._directory_has_mlx_weights(entry)
            compatible, error = self._validate_mlx_snapshot(entry) if has_weights else (False, "No MLX safetensors found in the model directory.")
            repo_id = self._repo_id_for_external_mlx(entry)
            models.append(
                {
                    "id": model_id,
                    "display_name": repo_id or entry.name,
                    "repo_id": repo_id,
                    "cached": True,
                    "size_gb": round(self._dir_size(entry) / 1e9, 2),
                    "path": str(entry),
                    "ready": has_weights and compatible,
                    "error": None if has_weights and compatible else error,
                }
            )

        return sorted(models, key=lambda item: str(item.get("display_name") or item["id"]).lower())

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
        try:
            mlx_models = self.api.list_models(author="mlx-community", search=query, limit=limit, full=True)
            remote_models = self.api.list_models(search=query, limit=limit * 3, full=True)
        except Exception as exc:  # noqa: BLE001 - normalize network and TLS failures
            raise RuntimeError(self._format_hub_error(exc, action="search remote models")) from exc

        for model in mlx_models:
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

        for model in remote_models:
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
        try:
            info = self.api.model_info(model_id, files_metadata=True)
        except Exception as exc:  # noqa: BLE001 - normalize network and TLS failures
            raise RuntimeError(self._format_hub_error(exc, action=f"inspect {model_id}")) from exc
        if format == "gguf" and filename:
            size_bytes = self._named_file_size_bytes(info, filename)
        elif format == "gguf":
            size_bytes = self._gguf_size_bytes(info)
        else:
            size_bytes = self._model_size_bytes(info)
        return size_bytes or None

    def list_model_files(self, model_id: str, format: str = "gguf") -> list[dict[str, object]]:
        try:
            info = self.api.model_info(model_id, files_metadata=True)
        except Exception as exc:  # noqa: BLE001 - normalize network and TLS failures
            raise RuntimeError(self._format_hub_error(exc, action=f"load file list for {model_id}")) from exc
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
            try:
                info = self.api.model_info(model_id, files_metadata=True)
            except Exception as exc:  # noqa: BLE001 - normalize network and TLS failures
                raise RuntimeError(self._format_hub_error(exc, action=f"inspect {model_id}")) from exc
            if not self._has_mlx_weights(info):
                raise ValueError(f"{model_id} does not contain MLX safetensors and cannot be loaded by mlx-lm.")
            allow_patterns = MODEL_ALLOW_PATTERNS
        elif filename:
            allow_patterns = [filename, "*.json", "*.txt", "tokenizer.model", "*.tiktoken", "tiktoken.model"]
        else:
            allow_patterns = GGUF_ALLOW_PATTERNS
        try:
            path = snapshot_download(
                model_id,
                allow_patterns=allow_patterns,
                endpoint=self._hub_endpoint,
            )
        except Exception as exc:  # noqa: BLE001 - normalize network and TLS failures
            raise RuntimeError(self._format_hub_error(exc, action=f"download {model_id}")) from exc
        return {
            "id": model_id,
            "cached": True,
            "path": path,
            "format": format,
            "filename": filename,
        }

    def configure_tls_certificate_bundle(self, bundle_path: str | None) -> None:
        custom_path = str(Path(bundle_path).expanduser()) if bundle_path else None
        env_path = self._initial_ssl_cert_file or self._initial_requests_ca_bundle
        source_path = custom_path or env_path

        if source_path:
            effective_path = self._build_effective_ca_bundle(Path(source_path).expanduser())
            self._effective_ca_bundle_path = str(effective_path)
            self._ca_bundle_source = "uploaded" if custom_path else "environment"
        else:
            self._effective_ca_bundle_path = None
            self._ca_bundle_source = "default"

        self._custom_ca_bundle_path = custom_path
        self._apply_ca_environment(self._effective_ca_bundle_path)
        self._configure_hub_http_client()

    def configure_hub_endpoint(self, endpoint: str | None) -> None:
        self._hub_endpoint = self._normalize_hub_endpoint(endpoint)
        self._apply_hub_environment(self._hub_endpoint)
        self._configure_hub_http_client()

    def tls_status(self) -> dict[str, object]:
        return {
            "source": self._ca_bundle_source,
            "custom_ca_bundle_path": self._custom_ca_bundle_path,
            "effective_ca_bundle_path": self._effective_ca_bundle_path,
            "hub_endpoint": self._hub_endpoint,
            "hub_provider": self._hub_provider_name(self._hub_endpoint),
        }

    def delete_model(self, model_id: str) -> None:
        direct_path = Path(model_id).expanduser()
        if direct_path.exists() and direct_path.is_dir():
            shutil.rmtree(direct_path, ignore_errors=True)
            return
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
        direct_path = Path(model_id).expanduser()
        if direct_path.exists() and direct_path.is_dir():
            if not self._directory_has_mlx_weights(direct_path):
                return False, "No MLX safetensors found in the model directory."
            return self._validate_mlx_snapshot(direct_path)

        cache_dir = self.cache_root / self._cache_folder_name(model_id)
        snapshot_dir = self._latest_snapshot_dir(cache_dir)
        if snapshot_dir is None or not self._snapshot_has_mlx_weights(cache_dir):
            return False, "No MLX safetensors found in the cached snapshot."
        return self._validate_mlx_snapshot(snapshot_dir)

    def mlx_runtime_target(self, model_id: str) -> str:
        direct_path = Path(model_id).expanduser()
        if direct_path.exists() and direct_path.is_dir():
            return str(direct_path)

        cache_dir = self.cache_root / self._cache_folder_name(model_id)
        snapshot_dir = self._latest_snapshot_dir(cache_dir)
        if snapshot_dir is not None and self._snapshot_has_mlx_weights(cache_dir):
            return str(snapshot_dir)

        return model_id

    def gguf_exists(self, model_path: str) -> bool:
        candidate = Path(model_path).expanduser()
        return candidate.exists() and candidate.is_file() and candidate.suffix.lower() == ".gguf"

    def configure_additional_model_roots(self, root_paths: list[str] | None) -> None:
        normalized: list[str] = []
        seen: set[str] = set()
        for raw_path in root_paths or []:
            candidate = Path(str(raw_path)).expanduser()
            if not candidate.exists() or not candidate.is_dir():
                continue
            try:
                resolved = candidate.resolve()
            except OSError:
                resolved = candidate.absolute()
            value = str(resolved)
            if value in seen:
                continue
            seen.add(value)
            normalized.append(value)
        self._additional_model_roots = normalized

    def additional_model_roots(self) -> list[str]:
        return list(self._additional_model_roots)

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
        roots = [*self._default_gguf_roots(), *(Path(item) for item in self._additional_model_roots)]
        deduped: list[Path] = []
        seen: set[str] = set()
        for root in roots:
            key = str(root.expanduser())
            if key in seen:
                continue
            seen.add(key)
            deduped.append(root)
        return deduped

    def _default_gguf_roots(self) -> list[Path]:
        home = Path.home()
        return [
            self.cache_root,
            home / ".cache" / "lm-studio" / "models",
            home / ".cache" / "lmstudio" / "models",
            home / ".lmstudio" / "models",
            home / "Library" / "Application Support" / "LM Studio" / "models",
        ]

    def _hf_cache_mlx_entries(self) -> list[Path]:
        if not self.cache_root.exists():
            return []
        entries: list[Path] = []
        for entry in self.cache_root.glob("models--*"):
            if entry.is_dir():
                entries.append(entry)
        return sorted(entries)

    def _external_mlx_roots(self) -> list[Path]:
        roots = [*self._default_external_mlx_roots(), *(Path(item) for item in self._additional_model_roots)]
        return self._discover_mlx_model_dirs(roots)

    def _default_external_mlx_roots(self) -> list[Path]:
        home = Path.home()
        return [
            home / ".lmstudio" / "models",
            home / ".cache" / "lmstudio" / "models",
            home / ".cache" / "lm-studio" / "models",
            home / "Library" / "Application Support" / "LM Studio" / "models",
        ]

    def _discover_mlx_model_dirs(self, roots: list[Path]) -> list[Path]:
        entries: list[Path] = []
        seen_paths: set[str] = set()
        for root in roots:
            candidate_root = root.expanduser()
            if not candidate_root.exists() or not candidate_root.is_dir():
                continue
            for current_root, dirnames, _ in os.walk(candidate_root):
                current = Path(current_root)
                if self._directory_has_mlx_weights(current):
                    resolved = str(current.resolve())
                    if resolved not in seen_paths:
                        seen_paths.add(resolved)
                        entries.append(current)
                    dirnames[:] = []
                    continue
        return sorted(entries)

    def _repo_id_for_external_mlx(self, path: Path) -> str | None:
        for root in [*self._default_external_mlx_roots(), *(Path(item) for item in self._additional_model_roots)]:
            try:
                relative_parts = path.resolve().relative_to(root.expanduser().resolve()).parts
            except (OSError, ValueError):
                continue
            if len(relative_parts) >= 2:
                return f"{relative_parts[0]}/{relative_parts[1]}"
        return None

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

    def _directory_has_mlx_weights(self, directory: Path) -> bool:
        return any(directory.glob("model*.safetensors")) or any(directory.glob("*.safetensors"))

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

    def _build_effective_ca_bundle(self, source_path: Path) -> Path:
        if not source_path.exists() or not source_path.is_file():
            raise ValueError(f"Certificate bundle was not found: {source_path}")

        TLS_CERT_DIR.mkdir(parents=True, exist_ok=True)
        default_bundle = Path(certifi.where())
        if source_path.resolve() == default_bundle.resolve():
            return default_bundle

        merged = bytearray()
        merged.extend(default_bundle.read_bytes().rstrip())
        merged.extend(b"\n")
        merged.extend(source_path.read_bytes().strip())
        merged.extend(b"\n")
        self._generated_ca_bundle_path.write_bytes(bytes(merged))
        return self._generated_ca_bundle_path

    def _apply_ca_environment(self, effective_path: str | None) -> None:
        if effective_path:
            os.environ["SSL_CERT_FILE"] = effective_path
            os.environ["REQUESTS_CA_BUNDLE"] = effective_path
            return

        if self._initial_ssl_cert_file is not None:
            os.environ["SSL_CERT_FILE"] = self._initial_ssl_cert_file
        else:
            os.environ.pop("SSL_CERT_FILE", None)

        if self._initial_requests_ca_bundle is not None:
            os.environ["REQUESTS_CA_BUNDLE"] = self._initial_requests_ca_bundle
        else:
            os.environ.pop("REQUESTS_CA_BUNDLE", None)

    def _apply_hub_environment(self, endpoint: str | None) -> None:
        if endpoint:
            os.environ["HF_ENDPOINT"] = endpoint
            return

        if self._initial_hf_endpoint is not None:
            os.environ["HF_ENDPOINT"] = self._initial_hf_endpoint
        else:
            os.environ.pop("HF_ENDPOINT", None)

    def _configure_hub_http_client(self) -> None:
        verify: bool | str | ssl.SSLContext = self._httpx_verify_config()
        try:
            from huggingface_hub import close_session, set_client_factory

            def client_factory() -> httpx.Client:
                return httpx.Client(
                    verify=verify,
                    trust_env=True,
                    follow_redirects=True,
                    timeout=httpx.Timeout(10.0, connect=10.0, read=60.0, write=60.0, pool=60.0),
                )

            set_client_factory(client_factory)
            close_session()
        except Exception:
            try:
                from huggingface_hub.utils import configure_http_backend
                import requests

                def backend_factory() -> requests.Session:
                    session = requests.Session()
                    session.verify = verify
                    return session

                configure_http_backend(backend_factory=backend_factory)
            except Exception:
                pass

        self.api = HfApi(endpoint=self._hub_endpoint)

    def _httpx_verify_config(self) -> bool | str | ssl.SSLContext:
        # On macOS corporate networks the system Keychain trust store is often
        # more reliable than certifi, especially for TLS interception products.
        if truststore is not None and sys.platform == "darwin":
            try:
                context = truststore.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
                source_path = self._custom_ca_bundle_path or self._initial_ssl_cert_file or self._initial_requests_ca_bundle
                if source_path:
                    context.load_verify_locations(cafile=str(Path(source_path).expanduser()))
                return context
            except Exception:
                pass

        return self._effective_ca_bundle_path or True

    def _normalize_hub_endpoint(self, endpoint: str | None) -> str:
        value = str(endpoint or "").strip()
        if not value:
            return HUGGING_FACE_ENDPOINT
        if value in {"huggingface", "official"}:
            return HUGGING_FACE_ENDPOINT
        if value in {"hf-mirror", "mirror"}:
            return HF_MIRROR_ENDPOINT
        return value.rstrip("/")

    def _hub_provider_name(self, endpoint: str | None) -> str:
        normalized = self._normalize_hub_endpoint(endpoint)
        if normalized == HF_MIRROR_ENDPOINT:
            return "hf-mirror"
        return "huggingface"

    def _format_hub_error(self, exc: Exception, action: str) -> str:
        message = str(exc).strip() or exc.__class__.__name__
        if isinstance(exc, httpx.ConnectError) and "CERTIFICATE_VERIFY_FAILED" in message:
            return (
                f"Could not {action} because TLS certificate verification failed on this network. "
                "If your organization uses a custom root certificate, export SSL_CERT_FILE or REQUESTS_CA_BUNDLE "
                "to that PEM file before starting MLX Studio."
            )
        if "Basic Constraints of CA cert not marked critical" in message:
            return (
                f"Could not {action} because the imported PEM is not a standards-compliant CA certificate for OpenSSL. "
                "On macOS, import that certificate into Keychain Access and trust it there, then use the default system trust store; "
                "or ask IT for the proper root CA PEM."
            )
        if "CERTIFICATE_VERIFY_FAILED" in message or "self-signed certificate" in message.lower():
            return (
                f"Could not {action} because TLS certificate verification failed on this network. "
                "Set SSL_CERT_FILE or REQUESTS_CA_BUNDLE to your organization's PEM bundle and restart the server."
            )
        return f"Could not {action}: {message}"
