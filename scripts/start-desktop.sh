#!/bin/sh
# 使用本地临时目录，避免同步文件夹的 FinderInfo 扩展属性导致签名失效。
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT"
DEST="${TMPDIR:-/tmp}/shiyi-desktop-runtime/Shiyi.app"
mkdir -p "$(dirname "$DEST")"
SHIYI_BUILD_APP="$DEST" sh scripts/build-native.sh
codesign --verify --deep --strict "$DEST"
export SHIYI_NATIVE_APP="$DEST"
export SHIYI_NATIVE_BINARY="$DEST/Contents/MacOS/Shiyi"
exec node daemon/main.mjs --port "${SHIYI_PORT:-18746}"
