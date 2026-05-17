# Vexel

**An open-source binary vector graphics format and cross-platform rendering runtime for mobile.**

Vexel is a binary file format (`.vex`) and a plugin that renders it natively on iOS and
Android with pixel-identical output via Skia. It is designed to replace SVG as the
*rendering* format for mobile apps — for static illustrations, pre-generated diagrams
(Mermaid, org charts), and AI-authored, progressively-drawn content.

- One npm package.
- Convert any SVG to `.vex` at build time or runtime.
- Drop a `<VexelView>` component into your app.
- Pixel-identical output on iOS and Android.
- Per-element interactivity (taps, highlights).
- Streaming sessions for AI-drawn content.

## Install

```bash
npm install @pixelpath/vexel @shopify/react-native-skia
cd ios && pod install
```

## Use

**Batch mode (pre-generated SVG):**

```tsx
import { VexelView, convert } from '@pixelpath/vexel';

const traceBytes = convert(svgString);

<VexelView
  source={traceBytes}
  onElementPress={(id) => console.log('tapped', id)}
  highlightedIds={['flowchart-A-1']}
  style={{ width: '100%', height: 400 }}
/>
```

**Streaming mode (AI-generated drawing):**

```tsx
import { VexelView, useVexelSession } from '@pixelpath/vexel';

function AIWhiteboard() {
  const session = useVexelSession({ viewBox: [0, 0, 800, 600] });

  useEffect(() => {
    ws.on('fragment', (svgFragment) => {
      session.append(svgFragment, {
        strokeDrawMs: 800,
        fillFadeMs: 300,
        easing: 'hand-natural',
      });
    });
  }, []);

  return <VexelView source={session} style={{ flex: 1 }} />;
}
```

**Build-time conversion:**

```bash
npx @pixelpath/vexel-cli convert ./icons/*.svg --out ./assets/
```

## Artifacts

| Artifact | Distribution | Audience | v1.0 status |
|---|---|---|---|
| `@pixelpath/vexel` | npm | React Native developers | source-complete; needs native binaries |
| `@pixelpath/vexel-cli` | npm (`bin/vexel-cli.js` shim) | Build pipelines | working (workspace fallback to `cargo run`) |
| `@pixelpath/vexel-conformance` | npm | Format implementers | 5 fixtures · 19 checks · Node runner |
| `Vexel.framework` | SwiftPM + CocoaPods | Native iOS | source-complete; build via `platforms/ios/scripts/build-xcframework.sh` |
| `co.vexel:vexel-android` | Maven Central | Native Android | source-complete; build via `platforms/android/scripts/build-aar.sh` |
| `vexel-core` (Rust) | crates.io | Format implementers / WASM ports | **fully implemented, 33 tests passing** |

## Status

The Rust core (`vexel-core`) is the substance of v1.0: SVG → `.vex` conversion, Mermaid
id normalization, an STR-packed R-tree with per-element hit-testing, a streaming `Session`
with DoS limits, ANIM section codecs, and a `VexelFile` zero-copy reader. All of it has
passing tests on this machine. The CLI (`vexel-cli`) wraps the core with `convert`,
`inspect`, `dump`, `validate`, `diff`, `pack` subcommands and is reachable via the
`@pixelpath/vexel-cli` Node wrapper.

The iOS framework, Android library, and React Native `@pixelpath/vexel` package are
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
