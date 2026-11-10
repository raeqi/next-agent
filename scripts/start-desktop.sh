#!/bin/sh
# 使用本地临时目录，避免同步文件夹的 FinderInfo 扩展属性导致签名失效。
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT"
# 固定路径且仅在源码变化时重建，避免每次启动改变应用签名。
DEST="${SHIYI_NATIVE_APP:-$HOME/Applications/Shiyi.app}"
mkdir -p "$(dirname "$DEST")"
STAMP="$DEST/Contents/source.sha256"
HASH=$(shasum -a 256 native/Shiyi.swift scripts/build-native.sh | shasum -a 256 | cut -d ' ' -f 1)
if [ ! -x "$DEST/Contents/MacOS/Shiyi" ] || [ ! -f "$STAMP" ] || [ "$(cat "$STAMP")" != "$HASH" ]; then
  SHIYI_BUILD_APP="$DEST" sh scripts/build-native.sh
  printf '%s\n' "$HASH" > "$STAMP"
  xattr -cr "$DEST"
  codesign --force --sign - --identifier com.raeqi.shiyi "$DEST"
fi
codesign --verify --deep --strict "$DEST"
export SHIYI_NATIVE_APP="$DEST"
export SHIYI_NATIVE_BINARY="$DEST/Contents/MacOS/Shiyi"
exec node daemon/main.mjs --port "${SHIYI_PORT:-18746}"
