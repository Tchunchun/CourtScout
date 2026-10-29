#!/bin/sh
# Builds the iPhone UI as a phone-sized Mac app and opens it. Needs only the
# Command Line Tools. Start the server first with `npm start`.
set -eu
cd "$(dirname "$0")/.."
swift build --product court-scout-mac
app=".build/Court Scout Preview.app"
mkdir -p "$app/Contents/MacOS"
cp ".build/debug/court-scout-mac" "$app/Contents/MacOS/court-scout-mac"
cat > "$app/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleExecutable</key><string>court-scout-mac</string>
    <key>CFBundleIdentifier</key><string>com.courtscout.preview</string>
    <key>CFBundleName</key><string>Court Scout Preview</string>
    <key>CFBundlePackageType</key><string>APPL</string>
    <key>CFBundleShortVersionString</key><string>0.1</string>
    <key>LSMinimumSystemVersion</key><string>14.0</string>
    <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
PLIST
open "$app"
