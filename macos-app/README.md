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

For now it is intentionally a dev-oriented prototype shell that proves the app structure before packaging into a standalone `.app`.
