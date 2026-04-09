#!/bin/zsh

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

"$ROOT_DIR/scripts/package_macos_app.sh"
"$ROOT_DIR/scripts/package_vscode_extension.sh"
