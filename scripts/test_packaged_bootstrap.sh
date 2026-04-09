#!/bin/zsh

set -euo pipefail
unsetopt BG_NICE 2>/dev/null || true

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_DIR="${1:-$ROOT_DIR/dist/MLX Studio.app}"
PORT="${MLX_STUDIO_TEST_PORT:-8011}"
FULL_STACK="${MLX_STUDIO_TEST_FULL_STACK:-0}"

if [ ! -d "$APP_DIR" ]; then
  echo "Packaged app not found at: $APP_DIR" >&2
  echo "Run ./scripts/package_macos_app.sh first." >&2
  exit 1
fi

RUNTIME_BUNDLE_DIR="$APP_DIR/Contents/Resources/MLXStudioRuntime"
if [ ! -d "$RUNTIME_BUNDLE_DIR" ]; then
  echo "Bundled runtime is missing from: $RUNTIME_BUNDLE_DIR" >&2
  exit 1
fi

SANDBOX_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/mlx-studio-sandbox.XXXXXX")"
SANDBOX_HOME="$SANDBOX_ROOT/home"
RUNTIME_ROOT="$SANDBOX_HOME/Library/Application Support/MLX Studio/Runtime"
SERVER_LOG="$SANDBOX_ROOT/server.log"
SANDBOX_TMPDIR="$SANDBOX_ROOT/tmp"
SERVER_PID=""

cleanup() {
  if [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" >/dev/null 2>&1; then
    kill "$SERVER_PID" >/dev/null 2>&1 || true
    wait "$SERVER_PID" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT INT TERM

mkdir -p "$RUNTIME_ROOT"
mkdir -p "$SANDBOX_TMPDIR"
for component in backend frontend scripts; do
  ditto "$RUNTIME_BUNDLE_DIR/$component" "$RUNTIME_ROOT/$component"
done

echo "Launching packaged runtime inside sandbox:"
echo "  HOME=$SANDBOX_HOME"
echo "  ROOT=$RUNTIME_ROOT"

if [ "$FULL_STACK" = "1" ]; then
  echo "  PORT=$PORT"

  (
    cd "$RUNTIME_ROOT"
    env -i \
      HOME="$SANDBOX_HOME" \
      PATH="/usr/bin:/bin:/usr/sbin:/sbin" \
      TMPDIR="$SANDBOX_TMPDIR" \
      ./scripts/ui.sh --port "$PORT"
  ) >"$SERVER_LOG" 2>&1 &
  SERVER_PID="$!"

  for _ in {1..180}; do
    if curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then
      echo "Sandbox full-stack bootstrap succeeded."
      echo "Server log:"
      sed -n '1,200p' "$SERVER_LOG"
      exit 0
    fi

    if ! kill -0 "$SERVER_PID" >/dev/null 2>&1; then
      echo "Sandbox full-stack bootstrap failed. Server exited early." >&2
      sed -n '1,240p' "$SERVER_LOG" >&2
      exit 1
    fi

    sleep 1
  done

  echo "Sandbox full-stack bootstrap timed out." >&2
  sed -n '1,240p' "$SERVER_LOG" >&2
  exit 1
fi

(
  cd "$RUNTIME_ROOT"
  env -i \
    HOME="$SANDBOX_HOME" \
    PATH="/usr/bin:/bin:/usr/sbin:/sbin" \
    TMPDIR="$SANDBOX_TMPDIR" \
    ROOT_DIR="$RUNTIME_ROOT" \
    zsh -fc 'source "$ROOT_DIR/scripts/python_env.sh"; ensure_project_python_env'
) >"$SERVER_LOG" 2>&1

if [ -x "$RUNTIME_ROOT/.venv/bin/python" ] && [ -f "$RUNTIME_ROOT/.venv/.requirements-installed" ]; then
  echo "Sandbox bootstrap succeeded."
  echo "Server log:"
  sed -n '1,200p' "$SERVER_LOG"
  exit 0
fi

echo "Sandbox bootstrap failed." >&2
sed -n '1,240p' "$SERVER_LOG" >&2
exit 1
