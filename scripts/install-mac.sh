#!/usr/bin/env bash
# Build Warden and install it into /Applications (macOS only).
#
# Usage: npm run install:mac [-- options]
#   --skip-build   install the existing build in release/ without rebuilding
#   --unsigned     build without code signing (for machines without a working
#                  Developer ID setup; fine for local use)
#   --open         launch Warden after installing
#
# Set WARDEN_INSTALL_DIR to install somewhere other than /Applications.

set -euo pipefail

APP_NAME="Warden"
INSTALL_DIR="${WARDEN_INSTALL_DIR:-/Applications}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

skip_build=false
open_after=false
for arg in "$@"; do
  case "$arg" in
    --skip-build) skip_build=true ;;
    --unsigned) export CSC_IDENTITY_AUTO_DISCOVERY=false ;;
    --open) open_after=true ;;
    -h|--help) sed -n '2,11p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $arg" >&2; exit 1 ;;
  esac
done

if [[ "$(uname)" != "Darwin" ]]; then
  echo "This script only supports macOS." >&2
  exit 1
fi

cd "$ROOT"

if [[ "$skip_build" == false ]]; then
  echo "==> Building $APP_NAME"
  npm run build:mac
fi

# electron-builder writes release/mac-arm64 on Apple Silicon, release/mac on Intel.
case "$(uname -m)" in
  arm64) candidates=("release/mac-arm64" "release/mac-universal" "release/mac") ;;
  *)     candidates=("release/mac" "release/mac-universal") ;;
esac
src=""
for dir in "${candidates[@]}"; do
  if [[ -d "$dir/$APP_NAME.app" ]]; then
    src="$dir/$APP_NAME.app"
    break
  fi
done
if [[ -z "$src" ]]; then
  echo "No $APP_NAME.app found in release/. Run without --skip-build." >&2
  exit 1
fi

dest="$INSTALL_DIR/$APP_NAME.app"
if [[ ! -w "$INSTALL_DIR" ]]; then
  echo "$INSTALL_DIR is not writable. Re-run with sudo or set WARDEN_INSTALL_DIR." >&2
  exit 1
fi

# Quit a running copy first so it can flush unsaved edits and release files.
if pgrep -xq "$APP_NAME"; then
  echo "==> Quitting running $APP_NAME"
  osascript -e "tell application \"$APP_NAME\" to quit" >/dev/null 2>&1 || true
  for _ in {1..20}; do
    pgrep -xq "$APP_NAME" || break
    sleep 0.5
  done
  if pgrep -xq "$APP_NAME"; then
    echo "$APP_NAME is still running; quit it and try again." >&2
    exit 1
  fi
fi

echo "==> Installing $src -> $dest"
# Copy to a temp name first so a failed copy never leaves a broken app behind.
tmp="$INSTALL_DIR/.$APP_NAME.app.installing"
rm -rf "$tmp"
ditto "$src" "$tmp"
rm -rf "$dest"
mv "$tmp" "$dest"

echo "==> Installed $APP_NAME to $dest"

if [[ "$open_after" == true ]]; then
  open "$dest"
fi
