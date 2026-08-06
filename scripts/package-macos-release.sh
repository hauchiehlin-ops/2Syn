#!/usr/bin/env bash
set -euo pipefail

TARGET="host"
ARCH="native"
SIGN_IDENTITY=""
APPLE_ID=""
TEAM_ID=""
APP_PASSWORD=""
SKIP_PULL=0
SKIP_NOTARIZE=0

usage() {
  cat <<'EOF'
Usage:
  scripts/package-macos-release.sh [options]

Options:
  --target host|client              App variant to package. Default: host
  --arch native|universal|aarch64|x86_64
                                  Build architecture. Default: native
  --sign-identity "Developer ID Application: ..."
                                  Re-sign the final .app bundle.
  --apple-id email@example.com      Apple ID for notarization.
  --team-id TEAMID                  Apple Developer Team ID for notarization.
  --app-password xxxx-xxxx-xxxx     App-specific password for notarization.
  --skip-pull                       Do not fetch/checkout/pull main first.
  --skip-notarize                   Build signed/unsigned DMG without notarization.
  -h, --help                        Show this help.

Notes:
  This package intentionally does not include or enable a macOS login-screen HID
  DriverKit System Extension. macOS unattended login-screen control remains
  disabled in this formal package until Apple DriverKit HID entitlement,
  signing, and notarization are ready.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --target)
      TARGET="${2:?missing value for --target}"
      shift 2
      ;;
    --configuration)
      if [[ "${2:?missing value for --configuration}" != "release" ]]; then
        echo "macOS release packaging currently supports release builds only." >&2
        exit 1
      fi
      shift 2
      ;;
    --arch)
      ARCH="${2:?missing value for --arch}"
      shift 2
      ;;
    --sign-identity)
      SIGN_IDENTITY="${2:?missing value for --sign-identity}"
      shift 2
      ;;
    --apple-id)
      APPLE_ID="${2:?missing value for --apple-id}"
      shift 2
      ;;
    --team-id)
      TEAM_ID="${2:?missing value for --team-id}"
      shift 2
      ;;
    --app-password)
      APP_PASSWORD="${2:?missing value for --app-password}"
      shift 2
      ;;
    --skip-pull)
      SKIP_PULL=1
      shift
      ;;
    --skip-notarize)
      SKIP_NOTARIZE=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This release packaging script must run on macOS with Xcode command line tools, Rust, and Node.js installed." >&2
  exit 1
fi

case "$TARGET" in
  host|client) ;;
  *)
    echo "--target must be host or client" >&2
    exit 1
    ;;
esac

case "$ARCH" in
  native|universal|aarch64|x86_64) ;;
  *)
    echo "--arch must be native, universal, aarch64, or x86_64" >&2
    exit 1
    ;;
esac

if [[ "$SKIP_NOTARIZE" -eq 0 ]]; then
  if [[ -z "$SIGN_IDENTITY" || -z "$APPLE_ID" || -z "$TEAM_ID" || -z "$APP_PASSWORD" ]]; then
    echo "Formal notarized packages require --sign-identity, --apple-id, --team-id, and --app-password." >&2
    echo "Use --skip-notarize only for internal local packages." >&2
    exit 1
  fi
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

run() {
  echo
  printf '> '
  printf '%q ' "$@"
  echo
  "$@"
}

json_value() {
  node -e "const fs=require('fs'); const v=JSON.parse(fs.readFileSync(process.argv[1],'utf8')); const path=process.argv[2].split('.'); let cur=v; for (const p of path) cur=cur[p]; process.stdout.write(String(cur));" "$1" "$2"
}

find_latest() {
  local pattern="$1"
  local matches=()
  shopt -s nullglob
  matches=( $pattern )
  shopt -u nullglob
  if [[ "${#matches[@]}" -eq 0 ]]; then
    return 0
  fi
  ls -td "${matches[@]}" | head -n 1
}

if [[ "$SKIP_PULL" -eq 0 ]]; then
  if [[ -n "$(git status --porcelain)" ]]; then
    echo "Working tree is not clean. Commit/stash changes first, or rerun with --skip-pull for local packaging." >&2
    git status --short >&2
    exit 1
  fi
  run git fetch origin --tags --force
  run git checkout main
  run git pull --ff-only
fi

PACKAGE_VERSION="$(json_value desktop/package.json version)"
if [[ "$TARGET" == "client" ]]; then
  TAURI_CONFIG="desktop/src-tauri/tauri.client.conf.json"
  NPM_BUILD_SCRIPT="tauri:build:client"
else
  TAURI_CONFIG="desktop/src-tauri/tauri.conf.json"
  NPM_BUILD_SCRIPT="tauri:build:host"
fi
PRODUCT_NAME="$(json_value "$TAURI_CONFIG" productName)"
APP_NAME="${PRODUCT_NAME}.app"
RELEASE_ROOT="$REPO_ROOT/release"
RELEASE_DIR="$RELEASE_ROOT/2syn-macos-${TARGET}-${PACKAGE_VERSION}"
DMG_STAGE="$RELEASE_ROOT/2syn-macos-${TARGET}-${PACKAGE_VERSION}-dmg"
DMG_PATH="$RELEASE_ROOT/2syn-macos-${TARGET}-${PACKAGE_VERSION}.dmg"
ZIP_PATH="$RELEASE_ROOT/2syn-macos-${TARGET}-${PACKAGE_VERSION}.zip"

echo "2syn macOS release package"
echo "Repo: $REPO_ROOT"
echo "Target: $TARGET"
echo "Version: $PACKAGE_VERSION"
echo "Product: $PRODUCT_NAME"
echo "Architecture: $ARCH"
echo "Login-screen HID: disabled"

run bash "$SCRIPT_DIR/clean-dmg-mounts.sh"

BUILD_ARGS=()
case "$ARCH" in
  universal)
    BUILD_ARGS+=(-- --target universal-apple-darwin)
    ;;
  aarch64)
    BUILD_ARGS+=(-- --target aarch64-apple-darwin)
    ;;
  x86_64)
    BUILD_ARGS+=(-- --target x86_64-apple-darwin)
    ;;
esac

run rm -rf target desktop/dist desktop/src-tauri/target
run npm --prefix desktop install
if [[ "${#BUILD_ARGS[@]}" -gt 0 ]]; then
  run npm --prefix desktop run "$NPM_BUILD_SCRIPT" "${BUILD_ARGS[@]}"
else
  run npm --prefix desktop run "$NPM_BUILD_SCRIPT"
fi

APP_PATH="$(find_latest "$REPO_ROOT/target/*/release/bundle/macos/$APP_NAME")"
if [[ -z "$APP_PATH" ]]; then
  APP_PATH="$(find_latest "$REPO_ROOT/target/release/bundle/macos/$APP_NAME")"
fi
if [[ -z "$APP_PATH" || ! -d "$APP_PATH" ]]; then
  echo "Built app bundle not found: $APP_NAME" >&2
  exit 1
fi

if [[ -n "$SIGN_IDENTITY" ]]; then
  run codesign --force --deep --options runtime --timestamp --sign "$SIGN_IDENTITY" "$APP_PATH"
  run codesign --verify --deep --strict --verbose=2 "$APP_PATH"
fi

run rm -rf "$RELEASE_DIR"
run mkdir -p "$RELEASE_DIR"
run ditto "$APP_PATH" "$RELEASE_DIR/$APP_NAME"

cat > "$RELEASE_DIR/manifest.json" <<EOF
{
  "product": "2syn",
  "target": "$TARGET",
  "version": "$PACKAGE_VERSION",
  "commit": "$(git rev-parse --short HEAD)",
  "platform": "macOS",
  "architecture": "$ARCH",
  "app": "$APP_NAME",
  "loginScreenHidEnabled": false,
  "macosDriverKitHidExtensionBundled": false,
  "packagedAt": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
}
EOF

run rm -f "$DMG_PATH" "$ZIP_PATH"
run rm -rf "$DMG_STAGE"
run mkdir -p "$DMG_STAGE"
run ditto "$RELEASE_DIR/$APP_NAME" "$DMG_STAGE/$APP_NAME"
run ln -s /Applications "$DMG_STAGE/Applications"
run hdiutil create -volname "$PRODUCT_NAME" -srcfolder "$DMG_STAGE" -ov -format UDZO "$DMG_PATH"
run ditto -c -k --keepParent "$RELEASE_DIR" "$ZIP_PATH"

if [[ "$SKIP_NOTARIZE" -eq 0 ]]; then
  run xcrun notarytool submit "$DMG_PATH" \
    --apple-id "$APPLE_ID" \
    --team-id "$TEAM_ID" \
    --password "$APP_PASSWORD" \
    --wait
  run xcrun stapler staple "$DMG_PATH"
  run spctl --assess --type open --context context:primary-signature --verbose "$DMG_PATH"
fi

echo
echo "macOS release package ready:"
echo "$RELEASE_DIR"
echo "$DMG_PATH"
echo "$ZIP_PATH"
