#!/usr/bin/env bash
# Build vexel-android.aar with bundled libvexel_core.so for all 4 Android ABIs.
# Produces platforms/android/build/outputs/aar/trace-release.aar (not checked in).

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
ANDROID_DIR="$ROOT/platforms/android"
CORE_DIR="$ROOT/crates/vexel-core"

echo "[1/3] Cross-compiling vexel-core for Android ABIs (requires cargo-ndk)…"
cd "$CORE_DIR"
cargo ndk \
  -t arm64-v8a -t armeabi-v7a -t x86_64 -t x86 \
  --release \
  build -p vexel-core

echo "[2/3] Staging .so files into jniLibs/…"
JNI="$ANDROID_DIR/src/main/jniLibs"
mkdir -p "$JNI/arm64-v8a" "$JNI/armeabi-v7a" "$JNI/x86_64" "$JNI/x86"
cp "$ROOT/target/aarch64-linux-android/release/libvexel_core.so"      "$JNI/arm64-v8a/"
cp "$ROOT/target/armv7-linux-androideabi/release/libvexel_core.so"    "$JNI/armeabi-v7a/"
cp "$ROOT/target/x86_64-linux-android/release/libvexel_core.so"       "$JNI/x86_64/"
cp "$ROOT/target/i686-linux-android/release/libvexel_core.so"         "$JNI/x86/"

echo "[3/3] Generating Kotlin UniFFI bindings and assembling AAR…"
uniffi-bindgen-kotlin \
  "$CORE_DIR/src/api/api.udl" \
  --out-dir "$ANDROID_DIR/src/main/kotlin/co/trace/generated"
cd "$ANDROID_DIR"
./gradlew :trace:assembleRelease
echo "Done. vexel-android.aar at $ANDROID_DIR/build/outputs/aar/trace-release.aar"
