#!/bin/zsh

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ASSETS_DIR="$ROOT_DIR/macos-app/Assets"
ICONSET_DIR="$ASSETS_DIR/AppIcon.iconset"
ICNS_PATH="$ASSETS_DIR/AppIcon.icns"

mkdir -p "$ASSETS_DIR"
rm -rf "$ICONSET_DIR"
mkdir -p "$ICONSET_DIR"

swift "$ROOT_DIR/scripts/render_app_icon.swift" "$ICONSET_DIR"
iconutil -c icns "$ICONSET_DIR" -o "$ICNS_PATH"

echo "Built app icon at:"
echo "  $ICNS_PATH"
