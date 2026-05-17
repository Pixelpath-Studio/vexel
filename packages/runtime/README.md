# @pixelpath/vexel

React Native component and JS API for the [Vexel vector graphics format](../../SPEC.md).

## Install

```bash
npm install @pixelpath/vexel @shopify/react-native-skia
cd ios && pod install
```

The postinstall script downloads platform binaries (`Vexel.framework` for iOS,
`vexel-android.aar` for Android) from the matching GitHub release. Skia binaries
come from `@shopify/react-native-skia` (peer dep) — Vexel doesn't ship its own.

## Use

```tsx
import { VexelView, convert } from '@pixelpath/vexel';

const bytes = convert(svgString);

<VexelView
  source={bytes}
  onElementPress={(id) => console.log('tapped', id)}
  highlightedIds={['flowchart-A-1']}
  style={{ width: '100%', height: 400 }}
/>
```

Streaming:

```tsx
import { VexelView, useVexelSession } from '@pixelpath/vexel';

const session = useVexelSession({ viewBox: [0, 0, 800, 600] });
ws.on('fragment', (svg) => session.append(svg, {
  strokeDrawMs: 800, fillFadeMs: 300, easing: 'hand-natural',
}));
return <VexelView source={session} style={{ flex: 1 }} />;
```

See [SPEC.md §7](../../SPEC.md#7-the-npm-package-tracenuntime) for the full API.
