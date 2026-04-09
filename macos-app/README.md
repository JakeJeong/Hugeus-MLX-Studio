# MLX Studio macOS prototype

This folder contains the first native macOS SwiftUI shell for MLX Studio.

Current prototype scope:

- native sidebar-based macOS UI
- streaming chat surface backed by the existing FastAPI server
- model list and remote model search
- backend start/stop using the repo's `scripts/ui.sh`
- download activity and runtime logs
- generation settings and TLS certificate import

Architecture notes:

- `Domain`: entities, repository contracts, and lightweight use cases
- `Data`: HTTP client, repository implementation, runtime process control, local preferences
- `Presentation`: SwiftUI-facing view model
- `Views`: native macOS screens and shell

Run locally from this folder:

```bash
cd macos-app
swift run MLXStudioApp
```

The prototype expects to live inside this repository so it can find:

- `scripts/ui.sh`
- `backend/server.py`

Package a shareable `.app` bundle from the repository root:

```bash
./scripts/package_macos_app.sh
```

This creates:

- `dist/MLX Studio.app`

The bundle carries the MLX Studio backend/frontend/scripts inside
`Contents/Resources/MLXStudioRuntime`. On launch, the native shell mirrors
those runtime sources into `~/Library/Application Support/MLX Studio/Runtime`
so the local `.venv` and settings stay writable.

Current packaging caveat:

- the packaged app still expects Python 3.10-3.13 to be available on the target Mac for first-run bootstrap
- MLX Python packages are bundled into an offline `backend/wheelhouse`, so first-run install should not need external package indexes
- the packaged MLX bundle defaults to macOS 15-compatible wheels; override with `MLX_STUDIO_TARGET_MACOS_MAJOR=<major>` if you need a newer platform target
- GGUF / `llama-cpp-python` bundling remains an optional follow-up path

Verify the packaged runtime in a clean sandbox:

```bash
./scripts/test_packaged_bootstrap.sh
```
