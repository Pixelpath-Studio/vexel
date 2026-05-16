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

const traceBytes = await convert(svgString);

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

| Artifact | Distribution | Audience |
|---|---|---|
| `@trace/runtime` | npm | React Native developers |
| `@trace/cli` | npm | Build pipelines |
| `Trace.framework` | SwiftPM + CocoaPods | Native iOS |
| `co.trace:trace-android` | Maven Central | Native Android |

## Documentation

- [SPEC.md](SPEC.md) — full format specification and architecture.
- [CONTRIBUTING.md](CONTRIBUTING.md) — toolchain setup, running tests, adding fixtures.
- [LICENSE](LICENSE) — Apache 2.0.

## Status

Pre-release. v1.0 ships when the two demo videos in [SPEC.md §15](SPEC.md#15-minimum-viable-demo-week-12-success-criterion) exist.
