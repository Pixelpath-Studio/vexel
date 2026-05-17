// swift-tools-version:5.9
import PackageDescription

// Vexel.framework — SwiftPM manifest.
//
// Build prerequisites (see SPEC §13.2):
//   1. Build vexel-core for iOS targets via
//      `crates/vexel-core/Cargo.toml` cross-compilation (aarch64-apple-ios,
//      aarch64-apple-ios-sim, x86_64-apple-ios).
//   2. Run `platforms/ios/scripts/build-xcframework.sh` to assemble
//      VexelCore.xcframework and generate Swift UniFFI bindings into
//      Sources/VexelCore/.
//   3. `swift build` (or `pod install` via `Vexel.podspec` for CocoaPods).
//
// Skia is provided by the host app's `react-native-skia` dependency (npm
// package). For native iOS apps without React Native, Skia.xcframework must be
// vendored alongside this package — see README.md for instructions.

let package = Package(
    name: "Vexel",
    platforms: [.iOS(.v14)],
    products: [
        .library(name: "Vexel", targets: ["Vexel"]),
    ],
    targets: [
        // VexelCore.xcframework wraps the Rust static library; produced by
        // scripts/build-xcframework.sh and not checked in.
        .binaryTarget(
            name: "VexelCore",
            path: "VexelCore.xcframework"
        ),
        .target(
            name: "Vexel",
            dependencies: ["VexelCore"],
            path: "Sources/Vexel"
        ),
    ]
)
