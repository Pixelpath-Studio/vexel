# @pixelpath/vexel

**Interactive SVG renderer for React Native.** Parse any SVG (Mermaid diagram, hand-authored, schematic),
render it natively, tap individual elements, highlight transitive connections, stream stroke-by-stroke,
and theme programmatically — all from one React component.

[![npm](https://img.shields.io/npm/v/@pixelpath/vexel.svg)](https://www.npmjs.com/package/@pixelpath/vexel)
[![license](https://img.shields.io/npm/l/@pixelpath/vexel.svg)](https://github.com/Pixelpath-Studio/vexel/blob/main/LICENSE)

## Install

```bash
# Expo
npx expo install @pixelpath/vexel react-native-svg

# Bare React Native
npm install @pixelpath/vexel react-native-svg
cd ios && pod install
```

> `react-native-svg` is a peer dependency. Most RN apps already have it; if not,
> install it alongside `@pixelpath/vexel`. It's a peer dep (not a regular dep)
> so your app's existing version is reused — avoids native-module duplication.

## Use

```tsx
import { VexelView } from '@pixelpath/vexel';

<VexelView
  source={mySvgString}
  highlight="connected"
  streamReveal={isStreaming}
  onElementPress={(id) => console.log('tapped', id)}
  style={{ flex: 1 }}
/>
```

## What's in here

| Feature | Prop | Notes |
|---|---|---|
| **Render any SVG** | `source` (string · `Uint8Array` · `{uri}`) | async loader; placeholder / errorFallback |
| **Layout** | `fit`, `alignment`, `padding` | 5 fit modes including `scale-down`, 9-way alignment |
| **Highlight on tap** | `highlight: 'none' \| 'single' \| 'connected' \| 'custom'` | adjacency derived from SVG ids + path geometry |
| **Selection mode** | `selectionMode: 'single' \| 'multiple' \| 'toggle'` | multi-select supported |
| **Stream-by-stroke** | `streamReveal`, `streamSpeed`, `streamEasing`, `streamOrder`, `loop` | hand-natural easing, document/random/topological order |
| **Themes** | `colors.byId`, `colors.byClass`, `colorFilter` | text stays legible across themes |
| **Zoom & pan** | `zoom`, `pan`, `onZoomChange` | pinch + drag + double-tap, bounded |
| **Plugins** | `plugins`, `decorators` | ships `VexelLegend`, `VexelTooltip`; build your own |
| **Accessibility** | `accessibilityLabel`, `respectReducedMotion` | auto-detects OS reduce-motion |
| **Performance** | `rendering.skipText`, `rendering.interactiveBudget` | scales to 1000+ elements |

## Status

This is **v0.x — a pure-JS preview** implemented with `react-native-svg`. The prop API matches the
eventual v1.0, which will swap the rendering surface to Skia and route hit-testing through a Rust
core for cross-platform pixel parity at scale. **Consumers can upgrade transparently** — the public
API doesn't change.

## Peer dependencies

- `react` >= 18
- `react-native` >= 0.74
- `react-native-svg` >= 15

## Example

The full feature set is exercised by the demo app at
[`examples/react-native-mermaid`](https://github.com/Pixelpath-Studio/vexel/tree/main/examples/react-native-mermaid)
in the repo — 9-tab navigator with one tab per feature group.

## License

Apache-2.0 © PixelPath
