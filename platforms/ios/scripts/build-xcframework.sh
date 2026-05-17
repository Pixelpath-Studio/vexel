#!/usr/bin/env bash
# Build VexelCore.xcframework from the Rust core for iOS targets.
# Produces platforms/ios/VexelCore.xcframework (not checked in).
#
# Prerequisites:
#   rustup target add aarch64-apple-ios aarch64-apple-ios-sim x86_64-apple-ios
#   cargo install uniffi-bindgen-swift
#
# Usage:
#   cd platforms/ios && ./scripts/build-xcframework.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
IOS_DIR="$ROOT/platforms/ios"
CORE_DIR="$ROOT/crates/vexel-core"
BUILD_MODE=release

cd "$CORE_DIR"

echo "[1/4] Building static libs for iOS targets…"
for target in aarch64-apple-ios aarch64-apple-ios-sim x86_64-apple-ios; do
  cargo build --$BUILD_MODE --target "$target"
done

echo "[2/4] Creating fat simulator slice (arm64 + x86_64)…"
SIM_FAT="$ROOT/target/aarch64-apple-ios-sim/$BUILD_MODE/libvexel_core-sim.a"
mkdir -p "$(dirname "$SIM_FAT")"
lipo -create \
  "$ROOT/target/aarch64-apple-ios-sim/$BUILD_MODE/libvexel_core.a" \
  "$ROOT/target/x86_64-apple-ios/$BUILD_MODE/libvexel_core.a" \
  -output "$SIM_FAT"

echo "[3/4] Generating Swift bindings via uniffi-bindgen-swift…"
rm -rf "$IOS_DIR/Sources/VexelCore"
mkdir -p "$IOS_DIR/Sources/VexelCore"
uniffi-bindgen-swift \
  "$CORE_DIR/src/api/api.udl" \
  "$IOS_DIR/Sources/VexelCore" \
  --no-format

echo "[4/4] Packaging VexelCore.xcframework…"
rm -rf "$IOS_DIR/VexelCore.xcframework"
xcodebuild -create-xcframework \
  -library "$ROOT/target/aarch64-apple-ios/$BUILD_MODE/libvexel_core.a" \
    -headers "$IOS_DIR/Sources/VexelCore" \
  -library "$SIM_FAT" \
    -headers "$IOS_DIR/Sources/VexelCore" \
  -output "$IOS_DIR/VexelCore.xcframework"

echo "Done. VexelCore.xcframework at $IOS_DIR/VexelCore.xcframework"
