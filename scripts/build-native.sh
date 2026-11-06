#!/bin/sh
# 构建 native/build/Shiyi.app（拾遗桌宠 + 微信眼睛）。需要 Xcode Command Line Tools。
set -e
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
APP="$ROOT/native/build/Shiyi.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS"
cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleIdentifier</key><string>com.raeqi.shiyi</string>
  <key>CFBundleName</key><string>Shiyi</string>
  <key>CFBundleDisplayName</key><string>拾遗</string>
  <key>CFBundleExecutable</key><string>Shiyi</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>0.1.0</string>
  <key>LSUIElement</key><true/>
  <key>LSMinimumSystemVersion</key><string>14.0</string>
  <key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>
</dict></plist>
PLIST
swiftc -O -o "$APP/Contents/MacOS/Shiyi" "$ROOT/native/Shiyi.swift" \
  -framework Cocoa -framework WebKit -framework Vision
xattr -cr "$APP"
codesign --force --sign - --identifier com.raeqi.shiyi "$APP"
echo "✅ $APP"
