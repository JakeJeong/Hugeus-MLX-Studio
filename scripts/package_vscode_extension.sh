#!/bin/zsh

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
EXT_DIR="$ROOT_DIR/vscode-extension"
DIST_DIR="$ROOT_DIR/dist"
STAGE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/mlx-studio-vsix.XXXXXX")"
PACKAGE_JSON="$EXT_DIR/package.json"

cleanup() {
  rm -rf "$STAGE_DIR"
}
trap cleanup EXIT

read_manifest_field() {
  node -e 'const fs=require("fs"); const data=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); console.log(data[process.argv[2]] ?? "");' "$PACKAGE_JSON" "$1"
}

NAME="$(read_manifest_field name)"
DISPLAY_NAME="$(read_manifest_field displayName)"
DESCRIPTION="$(read_manifest_field description)"
VERSION="$(read_manifest_field version)"
PUBLISHER="$(read_manifest_field publisher)"
VSCODE_ENGINE="$(node -e 'const fs=require("fs"); const data=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); console.log(data.engines?.vscode ?? "");' "$PACKAGE_JSON")"
CATEGORIES="$(node -e 'const fs=require("fs"); const data=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); console.log((data.categories ?? []).join(","));' "$PACKAGE_JSON")"
TAGS="$(node -e 'const fs=require("fs"); const data=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); console.log((data.keywords ?? data.categories ?? []).join(","));' "$PACKAGE_JSON")"
ARTIFACT_PATH="$DIST_DIR/${NAME}-${VERSION}.vsix"
BACKUP_SUFFIX="$(date +%Y%m%d-%H%M%S)"

if [ -f "$ARTIFACT_PATH" ]; then
  mv "$ARTIFACT_PATH" "$DIST_DIR/${NAME}-${VERSION}-${BACKUP_SUFFIX}.vsix"
fi

mkdir -p "$DIST_DIR"
mkdir -p "$STAGE_DIR/extension"

ditto "$EXT_DIR" "$STAGE_DIR/extension"
find "$STAGE_DIR/extension" -name '.DS_Store' -delete
rm -rf "$STAGE_DIR/extension/.vscode"

cat > "$STAGE_DIR/[Content_Types].xml" <<'XML'
<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="json" ContentType="application/json" />
  <Default Extension="js" ContentType="application/javascript" />
  <Default Extension="css" ContentType="text/css" />
  <Default Extension="md" ContentType="text/markdown" />
  <Default Extension="svg" ContentType="image/svg+xml" />
  <Default Extension="xml" ContentType="text/xml" />
  <Default Extension="vsixmanifest" ContentType="text/xml" />
</Types>
XML

cat > "$STAGE_DIR/extension.vsixmanifest" <<XML
<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011">
  <Metadata>
    <Identity Language="en-US" Id="${PUBLISHER}.${NAME}" Version="${VERSION}" Publisher="${PUBLISHER}" />
    <DisplayName>${DISPLAY_NAME}</DisplayName>
    <Description xml:space="preserve">${DESCRIPTION}</Description>
    <Tags>${TAGS}</Tags>
    <Categories>${CATEGORIES}</Categories>
    <Properties>
      <Property Id="Microsoft.VisualStudio.Code.Engine" Value="${VSCODE_ENGINE}" />
    </Properties>
  </Metadata>
  <Installation>
    <InstallationTarget Id="Microsoft.VisualStudio.Code" />
  </Installation>
  <Dependencies />
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" />
    <Asset Type="Microsoft.VisualStudio.Services.Content.Details" Path="extension/README.md" />
    <Asset Type="Microsoft.VisualStudio.Services.Icons.Default" Path="extension/media/icon.svg" />
  </Assets>
</PackageManifest>
XML

(
  cd "$STAGE_DIR"
  zip -qr "$ARTIFACT_PATH" .
)

echo "Created VS Code extension package at:"
echo "  $ARTIFACT_PATH"
