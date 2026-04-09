#!/bin/zsh

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
export ROOT_DIR

source "$ROOT_DIR/scripts/python_env.sh"

readonly BUILD_ROOT="$ROOT_DIR/.build/offline-wheelhouse"
readonly BUILD_VENV_DIR="$BUILD_ROOT/venv"
readonly BUILD_PY="$BUILD_VENV_DIR/bin/python"
readonly BUILD_PIP="$BUILD_VENV_DIR/bin/pip"
readonly PIP_CACHE_DIR="$BUILD_ROOT/pip-cache"
readonly STAMP_FILE="$WHEELHOUSE_DIR/.bundle-stamp"
readonly PYTHON_MINOR_FILE="$WHEELHOUSE_DIR/.python-minor"
readonly PLATFORM_MAJOR_FILE="$WHEELHOUSE_DIR/.macos-platform-major"
readonly PACKAGED_BUILD_REQUIREMENTS_FILE="$ROOT_DIR/backend/requirements-packaged-build.txt"
readonly OPTIONAL_GGUF_REQUIREMENTS_FILE="$ROOT_DIR/backend/requirements-optional-gguf.txt"
readonly OPTIONAL_GGUF_BUILD_REQUIREMENTS_FILE="$ROOT_DIR/backend/requirements-optional-gguf-build.txt"

INCLUDE_GGUF_BUNDLE="${MLX_STUDIO_INCLUDE_GGUF_BUNDLE:-0}"
TARGET_MACOS_MAJOR="${MLX_STUDIO_TARGET_MACOS_MAJOR:-15}"

FORCE_REBUILD=0

if [ "${1:-}" = "--force" ]; then
  FORCE_REBUILD=1
fi

requirements_fingerprint() {
  {
    cat "$PACKAGED_BUILD_REQUIREMENTS_FILE"
    echo "---"
    cat "$PACKAGED_REQUIREMENTS_FILE"
    echo "---"
    printf 'target_macos_major=%s\n' "$TARGET_MACOS_MAJOR"
    echo "---"
    printf 'include_gguf=%s\n' "$INCLUDE_GGUF_BUNDLE"
    if [ "$INCLUDE_GGUF_BUNDLE" = "1" ] && [ -f "$OPTIONAL_GGUF_REQUIREMENTS_FILE" ] && [ -f "$OPTIONAL_GGUF_BUILD_REQUIREMENTS_FILE" ]; then
      cat "$OPTIONAL_GGUF_BUILD_REQUIREMENTS_FILE"
      echo "---"
      cat "$OPTIONAL_GGUF_REQUIREMENTS_FILE"
    fi
  } | /usr/bin/shasum -a 256 | awk '{ print $1 }'
}

wheelhouse_has_artifacts() {
  [ -d "$WHEELHOUSE_DIR" ] && find "$WHEELHOUSE_DIR" -type f -name '*.whl' | grep -q .
}

ensure_builder_python() {
  if [ -x "$BUILD_PY" ]; then
    return 0
  fi

  find_supported_python
  mkdir -p "$BUILD_ROOT"
  echo "Creating wheelhouse builder virtualenv with ${PYTHON_BOOTSTRAP_LABEL:-$PYTHON_BOOTSTRAP_CMD}"
  "$PYTHON_BOOTSTRAP_CMD" -m venv "$BUILD_VENV_DIR"
}

ensure_builder_tools() {
  mkdir -p "$PIP_CACHE_DIR"
  export PIP_CACHE_DIR
  "$BUILD_PY" -m ensurepip --upgrade >/dev/null 2>&1 || true
  "$BUILD_PIP" install --upgrade pip wheel setuptools
}

resolved_wheel_version() {
  local distribution_name wheel_name

  distribution_name="$1"
  shift

  for wheel_name in "$@"; do
    if [[ "$wheel_name:t" =~ ^${distribution_name}-([^-]+)- ]]; then
      printf '%s\n' "${match[1]}"
      return 0
    fi
  done

  return 1
}

download_target_mlx_wheels() {
  local destination_dir python_minor abi pip_python_version mlx_version mlx_metal_version
  local -a mlx_wheels metal_wheels

  destination_dir="$1"
  python_minor="$2"
  abi="cp3${python_minor}"
  pip_python_version="3.${python_minor}"
  mlx_wheels=("$destination_dir"/mlx-*.whl(N))
  metal_wheels=("$destination_dir"/mlx_metal-*.whl(N))
  mlx_version="$(resolved_wheel_version "mlx" "${mlx_wheels[@]}" || true)"
  mlx_metal_version="$(resolved_wheel_version "mlx_metal" "${metal_wheels[@]}" || true)"

  if [ -z "$mlx_version" ] || [ -z "$mlx_metal_version" ]; then
    echo "Unable to determine packaged MLX wheel versions from the builder output." >&2
    return 1
  fi

  echo "Downloading MLX runtime wheels for macOS ${TARGET_MACOS_MAJOR}.x / Python 3.${python_minor}..."
  if [ ${#mlx_wheels[@]} -gt 0 ]; then
    rm -f "${mlx_wheels[@]}"
  fi
  if [ ${#metal_wheels[@]} -gt 0 ]; then
    rm -f "${metal_wheels[@]}"
  fi
  "$BUILD_PIP" download \
    --only-binary=:all: \
    --no-deps \
    --dest "$destination_dir" \
    --platform "macosx_${TARGET_MACOS_MAJOR}_0_arm64" \
    --implementation cp \
    --python-version "$pip_python_version" \
    --abi "$abi" \
    "mlx==${mlx_version}" \
    "mlx-metal==${mlx_metal_version}"
}

build_wheelhouse() {
  local fingerprint temp_dir builder_minor

  fingerprint="$(requirements_fingerprint)"

  if [ "$FORCE_REBUILD" -eq 0 ] && wheelhouse_has_artifacts && [ -f "$STAMP_FILE" ] && [ "$(cat "$STAMP_FILE")" = "$fingerprint" ]; then
    echo "Offline wheelhouse is already up to date."
    return 0
  fi

  ensure_builder_python
  ensure_builder_tools

  temp_dir="$(mktemp -d "${TMPDIR:-/tmp}/mlx-studio-wheelhouse.XXXXXX")"
  trap 'rm -rf "$temp_dir"' EXIT INT TERM

  echo "Building offline Python dependency bundle..."
  "$BUILD_PIP" wheel --wheel-dir "$temp_dir" -r "$PACKAGED_BUILD_REQUIREMENTS_FILE"
  builder_minor="$("$BUILD_PY" -c 'import sys; print(sys.version_info[1])')"
  download_target_mlx_wheels "$temp_dir" "$builder_minor"

  if [ "$INCLUDE_GGUF_BUNDLE" = "1" ] && [ -f "$OPTIONAL_GGUF_BUILD_REQUIREMENTS_FILE" ]; then
    echo "Building optional GGUF dependency bundle..."
    "$BUILD_PIP" wheel --wheel-dir "$temp_dir" -r "$OPTIONAL_GGUF_BUILD_REQUIREMENTS_FILE"
  else
    echo "Skipping optional GGUF dependency bundle."
  fi

  rm -rf "$WHEELHOUSE_DIR"
  mkdir -p "$WHEELHOUSE_DIR"
  mv "$temp_dir"/* "$WHEELHOUSE_DIR"/
  printf '%s\n' "$builder_minor" > "$PYTHON_MINOR_FILE"
  printf '%s\n' "$TARGET_MACOS_MAJOR" > "$PLATFORM_MAJOR_FILE"
  printf '%s\n' "$fingerprint" > "$STAMP_FILE"

  trap - EXIT INT TERM
  rm -rf "$temp_dir"

  echo "Built offline wheelhouse at:"
  echo "  $WHEELHOUSE_DIR"
  echo "Packaged Python minor:"
  echo "  3.$builder_minor"
  echo "Packaged macOS target:"
  echo "  $TARGET_MACOS_MAJOR.x"
  if [ "$INCLUDE_GGUF_BUNDLE" != "1" ]; then
    echo
    echo "This bundle currently targets the MLX runtime only."
    echo "Set MLX_STUDIO_INCLUDE_GGUF_BUNDLE=1 to try packaging llama-cpp-python as well."
  fi
}

build_wheelhouse
