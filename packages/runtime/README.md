# @trace/runtime

React Native component and JS API for the [Trace vector graphics format](../../SPEC.md).

## Install

```bash
npm install @trace/runtime @shopify/react-native-skia
cd ios && pod install
```

The postinstall script downloads platform binaries (`Trace.framework` for iOS,
`trace-android.aar` for Android) from the matching GitHub release. Skia binaries
come from `@shopify/react-native-skia` (peer dep) — Trace doesn't ship its own.

## Use

```tsx
import { TraceView, convert } from '@trace/runtime';

const bytes = convert(svgString);

<TraceView
  source={bytes}
  onElementPress={(id) => console.log('tapped', id)}
  highlightedIds={['flowchart-A-1']}
  style={{ width: '100%', height: 400 }}
/>
```

Streaming:

```tsx
import { TraceView, useTraceSession } from '@trace/runtime';

const session = useTraceSession({ viewBox: [0, 0, 800, 600] });
ws.on('fragment', (svg) => session.append(svg, {
  strokeDrawMs: 800, fillFadeMs: 300, easing: 'hand-natural',
}));
return <TraceView source={session} style={{ flex: 1 }} />;
```

See [SPEC.md §7](../../SPEC.md#7-the-npm-package-tracenuntime) for the full API.
