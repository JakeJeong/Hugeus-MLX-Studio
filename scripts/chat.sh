#!/bin/zsh

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT_DIR/scripts/python_env.sh"

ensure_project_python_env

export PYTHONPATH="$ROOT_DIR"

exec "$VENV_PY" "$ROOT_DIR/backend/chat_repl.py" "$@"
