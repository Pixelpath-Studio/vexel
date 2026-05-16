// swift-tools-version:5.9
import PackageDescription

// Trace.framework — SwiftPM manifest.
//
// Build prerequisites (see SPEC §13.2):
//   1. Build trace-core for iOS targets via
//      `crates/trace-core/Cargo.toml` cross-compilation (aarch64-apple-ios,
//      aarch64-apple-ios-sim, x86_64-apple-ios).
//   2. Run `platforms/ios/scripts/build-xcframework.sh` to assemble
//      TraceCore.xcframework and generate Swift UniFFI bindings into
//      Sources/TraceCore/.
//   3. `swift build` (or `pod install` via `Trace.podspec` for CocoaPods).
//
// Skia is provided by the host app's `react-native-skia` dependency (npm
// package). For native iOS apps without React Native, Skia.xcframework must be
// vendored alongside this package — see README.md for instructions.

let package = Package(
    name: "Trace",
    platforms: [.iOS(.v14)],
    products: [
        .library(name: "Trace", targets: ["Trace"]),
    ],
    targets: [
        // TraceCore.xcframework wraps the Rust static library; produced by
        // scripts/build-xcframework.sh and not checked in.
        .binaryTarget(
            name: "TraceCore",
            path: "TraceCore.xcframework"
        ),
        .target(
            name: "Trace",
            dependencies: ["TraceCore"],
            path: "Sources/Trace"
        ),
    ]
)
