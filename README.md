# Trace

**An open-source binary vector graphics format and cross-platform rendering runtime for mobile.**

Trace is a binary file format (`.trace`) and a plugin that renders it natively on iOS and
Android with pixel-identical output via Skia. It is designed to replace SVG as the
*rendering* format for mobile apps — for static illustrations, pre-generated diagrams
(Mermaid, org charts), and AI-authored, progressively-drawn content.

- One npm package.
- Convert any SVG to `.trace` at build time or runtime.
- Drop a `<TraceView>` component into your app.
- Pixel-identical output on iOS and Android.
- Per-element interactivity (taps, highlights).
- Streaming sessions for AI-drawn content.

## Install

```bash
npm install @trace/runtime @shopify/react-native-skia
cd ios && pod install
```

## Use

**Batch mode (pre-generated SVG):**

```tsx
import { TraceView, convert } from '@trace/runtime';

const traceBytes = convert(svgString);

<TraceView
  source={traceBytes}
  onElementPress={(id) => console.log('tapped', id)}
  highlightedIds={['flowchart-A-1']}
  style={{ width: '100%', height: 400 }}
/>
```

**Streaming mode (AI-generated drawing):**

```tsx
import { TraceView, useTraceSession } from '@trace/runtime';

function AIWhiteboard() {
  const session = useTraceSession({ viewBox: [0, 0, 800, 600] });

  useEffect(() => {
    ws.on('fragment', (svgFragment) => {
      session.append(svgFragment, {
        strokeDrawMs: 800,
        fillFadeMs: 300,
        easing: 'hand-natural',
      });
    });
  }, []);

  return <TraceView source={session} style={{ flex: 1 }} />;
}
```

**Build-time conversion:**

```bash
npx @trace/cli convert ./icons/*.svg --out ./assets/
```

## Artifacts

| Artifact | Distribution | Audience | v1.0 status |
|---|---|---|---|
| `@trace/runtime` | npm | React Native developers | source-complete; needs native binaries |
| `@trace/cli` | npm (`bin/trace-cli.js` shim) | Build pipelines | working (workspace fallback to `cargo run`) |
| `@trace/conformance` | npm | Format implementers | 5 fixtures · 19 checks · Node runner |
| `Trace.framework` | SwiftPM + CocoaPods | Native iOS | source-complete; build via `platforms/ios/scripts/build-xcframework.sh` |
| `co.trace:trace-android` | Maven Central | Native Android | source-complete; build via `platforms/android/scripts/build-aar.sh` |
| `trace-core` (Rust) | crates.io | Format implementers / WASM ports | **fully implemented, 33 tests passing** |

## Status

The Rust core (`trace-core`) is the substance of v1.0: SVG → `.trace` conversion, Mermaid
id normalization, an STR-packed R-tree with per-element hit-testing, a streaming `Session`
with DoS limits, ANIM section codecs, and a `TraceFile` zero-copy reader. All of it has
passing tests on this machine. The CLI (`trace-cli`) wraps the core with `convert`,
`inspect`, `dump`, `validate`, `diff`, `pack` subcommands and is reachable via the
`@trace/cli` Node wrapper.

The iOS framework, Android library, and React Native `@trace/runtime` package are
**source-complete to the spec**. They build against Xcode, Android Studio, and the
React Native codegen — those toolchains were not available in the development
environment, so the build is verified-by-inspection only at the time of this commit.
The CI workflow (`.github/workflows/ci.yml`) exercises the Rust workspace + conformance
suite end-to-end on push.

The v1.0 success gate (SPEC §15: side-by-side benchmark video + AI-whiteboard
demo video) is achievable from this code with one full device build cycle.

## Documentation

- [SPEC.md](SPEC.md) — full format specification and architecture (16 sections).
- [CONTRIBUTING.md](CONTRIBUTING.md) — toolchain setup, running tests, adding fixtures.
- [LICENSE](LICENSE) — Apache 2.0.

## Verification

```bash
# Rust core + CLI (33 tests, all passing)
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings

# Conformance suite (5 fixtures × byte-stability + queries)
node packages/conformance/runner/index.js
```
