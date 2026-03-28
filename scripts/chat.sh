#!/bin/zsh

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
VENV_PY="$ROOT_DIR/.venv/bin/python"

if [ ! -x "$VENV_PY" ]; then
  echo "Missing virtualenv Python at $VENV_PY"
  echo "Create the venv first, then install dependencies."
  exit 1
fi

export PYTHONPATH="$ROOT_DIR"

exec "$VENV_PY" "$ROOT_DIR/backend/chat_repl.py" "$@"
