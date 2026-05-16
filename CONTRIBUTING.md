# Contributing to Trace

Thanks for your interest. Trace is intended to be infrastructure — a format with a
reference runtime — so contributions to the spec, the conformance suite, and the
reference implementation are all welcome.

## Toolchain

| Tool | Min version | Used for |
|---|---|---|
| Rust | 1.80 | The `trace-core` crate (everything algorithmic). |
| Node | 20 | The `@trace/*` npm packages and conformance runner. |
| Xcode | 15 | Building `Trace.framework` and the iOS example. |
| Android Studio | Hedgehog (2023.1) | Building `trace-android.aar` and the Android example. |
| `cargo-ndk` | 3.5 | Cross-compiling the Rust core for Android targets. |

Install Rust cross-compilation targets you need to build for:

```bash
rustup target add aarch64-apple-ios aarch64-apple-ios-sim x86_64-apple-ios
rustup target add aarch64-linux-android armv7-linux-androideabi x86_64-linux-android i686-linux-android
```

## Repo layout

See [SPEC.md §12](SPEC.md#12-repository-layout) for the full layout. Quick map:

- `crates/trace-core/` — the Rust core (parse, convert, hit-test, serialize).
- `packages/runtime/` — `@trace/runtime` npm package (React Native binding).
- `packages/cli/` — `@trace/cli` npm package.
- `packages/conformance/` — `@trace/conformance` npm package (fixture suite).
- `platforms/ios/` — `Trace.framework` (SwiftPM + CocoaPods).
- `platforms/android/` — `co.trace:trace-android` AAR.
- `examples/` — runnable demo apps.

## Running tests

```bash
# Rust core
cd crates/trace-core
cargo test
cargo clippy -- -D warnings
cargo fmt --check

# Conformance suite (runs the Rust core against every fixture)
cd packages/conformance
npm test
```

## Adding a conformance fixture

The conformance suite makes Trace a *format*, not "whatever the Rust code does". Adding
a fixture is one of the highest-leverage contributions.

1. Create `packages/conformance/fixtures/NNN-short-name/`.
2. Add `input.svg` (or `input.fragments.json` for streaming).
3. Run `cargo run --bin gen-fixture -- packages/conformance/fixtures/NNN-short-name` to
   generate the canonical `output.trace`.
4. Add a `queries.json` describing expected query results — viewBox, ids, hit-test
   points, named bboxes.
5. Run `npm test -w packages/conformance` to verify it passes.

## Reporting issues

- For format bugs (the runtime accepts something the spec forbids, or rejects something
  the spec allows), open an issue with a minimal reproducing fixture.
- For renderer bugs (iOS and Android disagree on a fixture), attach screenshots from
  both platforms and the fixture path.

## Three identity invariants you must never violate

These are non-negotiable across the codebase. See SPEC.md's "Implementation notes for
Claude Code".

1. The Rust core is the single source of truth for scene structure and hit-testing.
2. Each addressable element gets its own `canvas.drawPath` call — never batched into an
   opaque `SkPicture` (decorative elements with `flags.is_decorative == true` are the
   only exception).
3. The identity-to-handle map lives in the platform/RN layer, not in Skia's internals.

A PR that breaks any of these will be rejected.

## License

Apache 2.0. By contributing you agree your contributions are licensed under the same.
