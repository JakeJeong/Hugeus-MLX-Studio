#!/bin/zsh

set -euo pipefail

: "${ROOT_DIR:?ROOT_DIR must be set before sourcing scripts/python_env.sh}"

readonly PROJECT_PYTHON_MIN_MINOR=10
readonly PROJECT_PYTHON_MAX_MINOR=13
readonly VENV_DIR="$ROOT_DIR/.venv"
readonly VENV_PY="$VENV_DIR/bin/python"
readonly REQUIREMENTS_FILE="$ROOT_DIR/backend/requirements.txt"
readonly REQUIREMENTS_STAMP="$VENV_DIR/.requirements-installed"

PYTHON_BOOTSTRAP_CMD=""
PYTHON_BOOTSTRAP_LABEL=""

resolve_python_executable() {
  "$1" -c 'import os, sys; print(os.path.realpath(getattr(sys, "_base_executable", None) or sys.executable))' 2>/dev/null
}

python_can_create_venv() {
  local python_path probe_root probe_env

  python_path="$1"
  probe_root="$(mktemp -d "${TMPDIR:-/tmp}/mlx-studio-python-probe.XXXXXX")"
  probe_env="$probe_root/venv"

  if "$python_path" -m venv --without-pip "$probe_env" >/dev/null 2>&1 && [ -x "$probe_env/bin/python" ]; then
    rm -rf "$probe_root"
    return 0
  fi

  rm -rf "$probe_root"
  return 1
}

find_supported_python() {
  local candidate version major minor resolved
  local -a candidates unsupported broken

  candidates=(python3.13 python3.12 python3.11 python3.10 python3 python)
  unsupported=()
  broken=()

  for candidate in "${candidates[@]}"; do
    if ! command -v "$candidate" >/dev/null 2>&1; then
      continue
    fi

    version="$("$candidate" -c 'import sys; print(f"{sys.version_info[0]}.{sys.version_info[1]}")' 2>/dev/null || true)"
    if [ -z "$version" ]; then
      continue
    fi

    major="${version%%.*}"
    minor="${version#*.}"

    if [ "$major" != "3" ] || [ "$minor" -lt "$PROJECT_PYTHON_MIN_MINOR" ] || [ "$minor" -gt "$PROJECT_PYTHON_MAX_MINOR" ]; then
      unsupported+=("$candidate ($version)")
      continue
    fi

    resolved="$(resolve_python_executable "$candidate" || true)"
    if [ -z "$resolved" ] || [ ! -x "$resolved" ]; then
      broken+=("$candidate ($version, missing base executable)")
      continue
    fi

    if python_can_create_venv "$resolved"; then
      PYTHON_BOOTSTRAP_CMD="$resolved"
      PYTHON_BOOTSTRAP_LABEL="$candidate ($version)"
      return 0
    fi

    broken+=("$candidate ($version, venv probe failed)")
  done

  echo "Unable to find a supported Python interpreter for this project." >&2
  if [ ${#unsupported[@]} -gt 0 ]; then
    echo "Found unsupported versions: ${unsupported[*]}" >&2
  fi
  if [ ${#broken[@]} -gt 0 ]; then
    echo "Found unusable Python installs: ${broken[*]}" >&2
  fi
  echo "Install Python 3.10-3.13, then rerun ./scripts/ui.sh --port 8010" >&2
  return 1
}

venv_needs_install() {
  if [ ! -x "$VENV_PY" ]; then
    return 0
  fi

  if [ ! -f "$REQUIREMENTS_STAMP" ] || [ "$REQUIREMENTS_FILE" -nt "$REQUIREMENTS_STAMP" ]; then
    return 0
  fi

  if ! "$VENV_PY" -c "import fastapi, uvicorn" >/dev/null 2>&1; then
    return 0
  fi

  return 1
}

ensure_project_python_env() {
  if [ ! -x "$VENV_PY" ]; then
    find_supported_python
    echo "Creating project virtualenv with ${PYTHON_BOOTSTRAP_LABEL:-$PYTHON_BOOTSTRAP_CMD}"
    "$PYTHON_BOOTSTRAP_CMD" -m venv "$VENV_DIR"
  fi

  if venv_needs_install; then
    echo "Installing Python dependencies from backend/requirements.txt"
    "$VENV_PY" -m ensurepip --upgrade >/dev/null 2>&1 || true
    "$VENV_PY" -m pip install --upgrade pip
    "$VENV_PY" -m pip install -r "$REQUIREMENTS_FILE"
    touch "$REQUIREMENTS_STAMP"
  fi
}
