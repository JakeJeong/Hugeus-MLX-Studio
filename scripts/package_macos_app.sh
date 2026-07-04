#!/bin/zsh

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_NAME="MLX Studio"
EXECUTABLE_NAME="MLXStudioApp"
DIST_DIR="$ROOT_DIR/dist"
APP_DIR="$DIST_DIR/$APP_NAME.app"
BACKUP_SUFFIX="$(date +%Y%m%d-%H%M%S)"
BUILD_DIR="$ROOT_DIR/macos-app/.build/release"
RESOURCES_DIR="$APP_DIR/Contents/Resources"
MACOS_DIR="$APP_DIR/Contents/MacOS"
RUNTIME_DIR="$RESOURCES_DIR/MLXStudioRuntime"
APP_ICON_PATH="$ROOT_DIR/macos-app/Assets/AppIcon.icns"
MODULE_CACHE_DIR="$ROOT_DIR/macos-app/.build/ModuleCache.noindex"
XDG_CACHE_DIR="$ROOT_DIR/macos-app/.build/xdg-cache"
INCLUDE_OFFLINE_BUNDLE="${MLX_STUDIO_SKIP_WHEELHOUSE_BUILD:-0}"

if [ "$INCLUDE_OFFLINE_BUNDLE" != "1" ]; then
  "$ROOT_DIR/scripts/build_offline_wheelhouse.sh"
fi

"$ROOT_DIR/scripts/build_app_icon.sh"

if [ -d "$APP_DIR" ]; then
  mv "$APP_DIR" "$DIST_DIR/$APP_NAME-$BACKUP_SUFFIX.app"
fi

mkdir -p "$DIST_DIR"
mkdir -p "$MODULE_CACHE_DIR" "$XDG_CACHE_DIR"

echo "Building macOS release executable..."
export CLANG_MODULE_CACHE_PATH="$MODULE_CACHE_DIR"
export SWIFTPM_MODULECACHE_OVERRIDE="$MODULE_CACHE_DIR"
export XDG_CACHE_HOME="$XDG_CACHE_DIR"
swift build --package-path "$ROOT_DIR/macos-app" -c release

mkdir -p "$MACOS_DIR" "$RESOURCES_DIR"
cp "$BUILD_DIR/$EXECUTABLE_NAME" "$MACOS_DIR/$EXECUTABLE_NAME"
chmod +x "$MACOS_DIR/$EXECUTABLE_NAME"
cp "$APP_ICON_PATH" "$RESOURCES_DIR/AppIcon.icns"

cat > "$APP_DIR/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>en</string>
  <key>CFBundleExecutable</key>
  <string>MLXStudioApp</string>
  <key>CFBundleIconFile</key>
  <string>AppIcon</string>
  <key>CFBundleIdentifier</key>
  <string>com.hugeus.mlxstudio</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>MLX Studio</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>0.0.1</string>
  <key>CFBundleVersion</key>
  <string>1</string>
  <key>LSMinimumSystemVersion</key>
  <string>14.0</string>
  <key>NSHighResolutionCapable</key>
  <true/>
  <key>NSPrincipalClass</key>
  <string>NSApplication</string>
</dict>
</plist>
PLIST

mkdir -p "$RUNTIME_DIR"
for component in backend frontend scripts; do
  ditto "$ROOT_DIR/$component" "$RUNTIME_DIR/$component"
done

find "$RUNTIME_DIR" -name '.DS_Store' -delete
find "$RUNTIME_DIR" -name '__pycache__' -type d -prune -exec rm -rf {} +
xattr -cr "$APP_DIR" 2>/dev/null || true
codesign --force --deep --sign - "$APP_DIR"

echo "Created app bundle at:"
echo "  $APP_DIR"
echo
echo "Note: this bundle includes the MLX Studio runtime sources and the offline"
echo "MLX dependency bundle. The target Mac still needs Python 3.10-3.13"
echo "for first-run virtualenv bootstrap, but package indexes are not required."
echo "Offline MLX wheels default to a macOS 15-compatible bundle."
echo "Override with MLX_STUDIO_TARGET_MACOS_MAJOR=<major> if you need a different target."
echo "Optional GGUF support can be bundled separately with"
echo "  MLX_STUDIO_INCLUDE_GGUF_BUNDLE=1 ./scripts/package_macos_app.sh"
