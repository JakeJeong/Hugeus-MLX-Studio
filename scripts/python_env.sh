#!/bin/zsh

set -euo pipefail

: "${ROOT_DIR:?ROOT_DIR must be set before sourcing scripts/python_env.sh}"

readonly PROJECT_PYTHON_MIN_MINOR=10
readonly PROJECT_PYTHON_MAX_MINOR=13
readonly VENV_DIR="$ROOT_DIR/.venv"
readonly VENV_PY="$VENV_DIR/bin/python"
readonly REQUIREMENTS_FILE="$ROOT_DIR/backend/requirements.txt"
readonly PACKAGED_REQUIREMENTS_FILE="$ROOT_DIR/backend/requirements-packaged.txt"
readonly WHEELHOUSE_DIR="${MLX_STUDIO_WHEELHOUSE_DIR:-$ROOT_DIR/backend/wheelhouse}"
readonly REQUIREMENTS_STAMP="$VENV_DIR/.requirements-installed"
readonly WHEELHOUSE_PYTHON_MINOR_FILE="$WHEELHOUSE_DIR/.python-minor"
readonly WHEELHOUSE_STAMP_FILE="$WHEELHOUSE_DIR/.bundle-stamp"

PYTHON_BOOTSTRAP_CMD=""
PYTHON_BOOTSTRAP_LABEL=""

resolve_python_executable() {
  "$1" -c 'import os, sys; print(os.path.realpath(getattr(sys, "_base_executable", None) or sys.executable))' 2>/dev/null
}

python_minor_version() {
  "$1" -c 'import sys; print(sys.version_info[1])' 2>/dev/null
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

required_packaged_python_minor() {
  if [ -f "$WHEELHOUSE_PYTHON_MINOR_FILE" ]; then
    tr -d '[:space:]' < "$WHEELHOUSE_PYTHON_MINOR_FILE"
    return 0
  fi

  local wheel_name tag_minor
  for wheel_name in "$WHEELHOUSE_DIR"/mlx-*.whl(N); do
    if [[ "$wheel_name:t" =~ cp3([0-9][0-9])\-cp3([0-9][0-9]) ]]; then
      tag_minor="${match[1]}"
      printf '%s\n' "${tag_minor#0}"
      return 0
    fi
  done

  return 1
}

packaged_mlx_wheel_tag() {
  local wheel_name
  for wheel_name in "$WHEELHOUSE_DIR"/mlx-*.whl(N); do
    printf '%s\n' "${wheel_name:t}"
    return 0
  done
  return 1
}

packaged_mlx_wheel_platform_major() {
  local wheel_tag
  wheel_tag="$(packaged_mlx_wheel_tag || true)"
  if [ -n "$wheel_tag" ] && [[ "$wheel_tag" =~ macosx_([0-9]+)_([0-9]+)_[A-Za-z0-9_]+\.whl$ ]]; then
    printf '%s\n' "${match[1]}"
    return 0
  fi
  return 1
}

current_macos_major_for_python() {
  "$1" -c 'import platform; version = platform.mac_ver()[0] or ""; print(version.split(".")[0] if version else "0")' 2>/dev/null
}

ensure_packaged_wheelhouse_compatible() {
  local python_path required_minor actual_minor wheel_platform_major current_macos_major wheel_tag

  python_path="$1"
  required_minor="$(required_packaged_python_minor || true)"
  wheel_platform_major="$(packaged_mlx_wheel_platform_major || true)"
  wheel_tag="$(packaged_mlx_wheel_tag || true)"
  actual_minor="$(python_minor_version "$python_path" || true)"

  if [ -n "$required_minor" ] && [ -n "$actual_minor" ] && [ "$actual_minor" != "$required_minor" ]; then
    echo "Packaged dependency bundle targets Python 3.$required_minor, but the selected interpreter is Python 3.$actual_minor." >&2
    return 1
  fi

  if [ -n "$wheel_platform_major" ]; then
    current_macos_major="$(current_macos_major_for_python "$python_path" || true)"
    if [ -n "$current_macos_major" ] && [ "$current_macos_major" -lt "$wheel_platform_major" ]; then
      echo "Packaged MLX wheel $wheel_tag requires macOS platform tag $wheel_platform_major or newer, but this Mac reports $current_macos_major." >&2
      echo "Rebuild the app on the target Mac, or package a wheelhouse built for this macOS version." >&2
      return 1
    fi
  fi

  return 0
}

find_supported_python() {
  local candidate version major minor resolved required_minor
  local -a candidates unsupported broken mismatched

  candidates=(
    python3.13
    python3.12
    python3.11
    python3.10
    python3
    python
    /opt/homebrew/bin/python3.13
    /opt/homebrew/bin/python3.12
    /opt/homebrew/bin/python3.11
    /opt/homebrew/bin/python3.10
    /usr/local/bin/python3.13
    /usr/local/bin/python3.12
    /usr/local/bin/python3.11
    /usr/local/bin/python3.10
    /Library/Frameworks/Python.framework/Versions/3.13/bin/python3.13
    /Library/Frameworks/Python.framework/Versions/3.12/bin/python3.12
    /Library/Frameworks/Python.framework/Versions/3.11/bin/python3.11
    /Library/Frameworks/Python.framework/Versions/3.10/bin/python3.10
  )
  unsupported=()
  broken=()
  mismatched=()
  required_minor=""

  if packaged_dependencies_available; then
    required_minor="$(required_packaged_python_minor || true)"
  fi

  for candidate in "${candidates[@]}"; do
    if [[ "$candidate" == /* ]]; then
      if [ ! -x "$candidate" ]; then
        continue
      fi
    elif ! command -v "$candidate" >/dev/null 2>&1; then
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

    if [ -n "$required_minor" ] && [ "$minor" -ne "$required_minor" ]; then
      mismatched+=("$candidate ($version)")
      continue
    fi

    resolved="$(resolve_python_executable "$candidate" || true)"
    if [ -z "$resolved" ] || [ ! -x "$resolved" ]; then
      broken+=("$candidate ($version, missing base executable)")
      continue
    fi

    if python_can_create_venv "$resolved"; then
      if [ -n "$required_minor" ] && ! ensure_packaged_wheelhouse_compatible "$resolved"; then
        broken+=("$candidate ($version, incompatible with packaged wheelhouse)")
        continue
      fi
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
  if [ ${#mismatched[@]} -gt 0 ] && [ -n "$required_minor" ]; then
    echo "Skipped Python installs that do not match the packaged bundle: ${mismatched[*]}" >&2
  fi
  if [ -n "$required_minor" ]; then
    echo "This packaged build includes offline wheels for Python 3.$required_minor only." >&2
    echo "Install Python 3.$required_minor on this Mac, or rebuild the app with a matching packaged wheelhouse." >&2
    return 1
  fi
  echo "Install Python 3.10-3.13, then rerun ./scripts/ui.sh --port 8010" >&2
  return 1
}

packaged_dependencies_available() {
  [ -d "$WHEELHOUSE_DIR" ] && [ -f "$PACKAGED_REQUIREMENTS_FILE" ]
}

current_packaged_bundle_stamp() {
  if packaged_dependencies_available && [ -f "$WHEELHOUSE_STAMP_FILE" ]; then
    tr -d '[:space:]' < "$WHEELHOUSE_STAMP_FILE"
    return 0
  fi

  return 1
}

active_requirements_file() {
  if packaged_dependencies_available; then
    printf '%s\n' "$PACKAGED_REQUIREMENTS_FILE"
    return 0
  fi

  printf '%s\n' "$REQUIREMENTS_FILE"
}

venv_needs_install() {
  local requirements_source current_bundle_stamp installed_bundle_stamp

  requirements_source="$(active_requirements_file)"

  if [ ! -x "$VENV_PY" ]; then
    return 0
  fi

  if [ ! -f "$REQUIREMENTS_STAMP" ] || [ "$requirements_source" -nt "$REQUIREMENTS_STAMP" ]; then
    return 0
  fi

  if packaged_dependencies_available; then
    current_bundle_stamp="$(current_packaged_bundle_stamp || true)"
    installed_bundle_stamp="$(tr -d '[:space:]' < "$REQUIREMENTS_STAMP" 2>/dev/null || true)"
    if [ -n "$current_bundle_stamp" ] && [ "$current_bundle_stamp" != "$installed_bundle_stamp" ]; then
      return 0
    fi
  fi

  if ! "$VENV_PY" -c "import fastapi, uvicorn" >/dev/null 2>&1; then
    return 0
  fi

  return 1
}

ensure_project_python_env() {
  local requirements_source required_minor existing_minor

  required_minor=""
  if packaged_dependencies_available; then
    required_minor="$(required_packaged_python_minor || true)"
  fi

  if [ -x "$VENV_PY" ] && [ -n "$required_minor" ]; then
    existing_minor="$(python_minor_version "$VENV_PY" || true)"
    if [ -n "$existing_minor" ] && [ "$existing_minor" != "$required_minor" ]; then
      echo "Recreating virtualenv because packaged bundle requires Python 3.$required_minor (found 3.$existing_minor in existing .venv)"
      rm -rf "$VENV_DIR"
    fi
  fi

  if [ ! -x "$VENV_PY" ]; then
    find_supported_python
    echo "Creating project virtualenv with ${PYTHON_BOOTSTRAP_LABEL:-$PYTHON_BOOTSTRAP_CMD}"
    "$PYTHON_BOOTSTRAP_CMD" -m venv "$VENV_DIR"
  fi

  if packaged_dependencies_available && ! ensure_packaged_wheelhouse_compatible "$VENV_PY"; then
    return 1
  fi

  requirements_source="$(active_requirements_file)"

  if venv_needs_install; then
    if packaged_dependencies_available; then
      echo "Installing packaged Python dependency bundle"
    else
      echo "Installing Python dependencies from backend/requirements.txt"
    fi
    "$VENV_PY" -m ensurepip --upgrade >/dev/null 2>&1 || true
    if packaged_dependencies_available; then
      "$VENV_PY" -m pip install --no-index --find-links "$WHEELHOUSE_DIR" -r "$PACKAGED_REQUIREMENTS_FILE"
    else
      "$VENV_PY" -m pip install --upgrade pip
      "$VENV_PY" -m pip install -r "$REQUIREMENTS_FILE"
    fi
    if packaged_dependencies_available; then
      current_packaged_bundle_stamp > "$REQUIREMENTS_STAMP"
    else
      touch "$REQUIREMENTS_STAMP"
    fi
  fi
}
