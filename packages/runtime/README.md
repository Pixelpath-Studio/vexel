# @pixelpath/vexel

**Interactive, addressable, streamable SVG for React Native.** Render any SVG
(Mermaid, Inkscape, Figma, Adobe Illustrator, GraphViz, or hand-authored) on
iOS and Android with full CSS resolution, per-element tap-to-highlight,
painted-area hit testing, stream-by-stroke reveal, and design-system-aware
edge / arrow restyling — all from one React component.

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
> install it alongside `@pixelpath/vexel`. Marked as a peer (not a regular dep)
> so your app's existing version is reused — avoids native-module duplication.

## Quick start

```tsx
import { VexelView } from '@pixelpath/vexel';

<VexelView
  source={mySvgString}
  hitTestMode="visible-painted"      // tap only the actual painted area (v0.1.0)
  highlight="connected"              // tap a node → highlight every connected node + edge
  streamReveal={isStreaming}         // reveal elements in graph-flow order, stroke-by-stroke
  onElementPress={(id) => console.log('tapped', id)}
  style={{ flex: 1 }}
/>
```

## What's in here

| Feature | Prop | Notes |
|---|---|---|
| **Render any SVG** | `source` (string · `Uint8Array` · `{uri}`) | async loader; `placeholder` / `errorFallback` slots |
| **Full CSS engine** | (automatic) | parses `<style>` blocks — selectors, !important, @media, var(), calc(), inheritance, full SVG-2 cascade. Mermaid / Inkscape / Figma exports render correctly out of the box (v0.0.3+) |
| **CSS context** | `cssVariables`, `mediaContext`, `onCSSWarning`, `onFontFace` | feed design tokens, toggle dark mode without SVG regen, surface @font-face declarations |
| **Painted-area hit test** | `hitTestMode="visible-painted"`, `hitTestTolerance` | taps resolve against the actual stroke geometry, not the bounding box — fixes the long-standing "thin diagonal line's bbox covers half the canvas" tap problem (v0.1.0+) |
| **Highlight on tap** | `highlight: 'none' \| 'single' \| 'connected' \| 'custom'` | adjacency auto-derived from SVG ids + path geometry |
| **Selection mode** | `selectionMode: 'single' \| 'multiple' \| 'toggle'` | multi-select supported |
| **Stream-by-stroke** | `streamReveal`, `streamSpeed`, `streamEasing`, `streamOrder`, `loop` | hand-natural easing; default order is true graph-flow BFS (source → target → edge), not document order — so arrows never appear before the boxes they connect (v0.1.0+) |
| **Themes** | `colors.byId`, `colors.byClass`, `colorFilter` | text stays legible across themes |
| **Edge & arrow styling** | `edges.default`, `edges.byId`, `edges.byClass`, `edges.resolve` | line color / width / dash / cap; 8 built-in arrow shapes + custom path (v0.0.7+); also via `--vexel-arrow*` CSS custom properties (v0.0.8+) |
| **Layout** | `fit`, `alignment`, `padding` | 5 fit modes including `scale-down`, 9-way alignment |
| **Zoom & pan** | `zoom`, `pan`, `onZoomChange` | pinch + drag + double-tap, bounded |
| **Plugins** | `plugins`, `decorators` | ships `VexelLegend`, `VexelTooltip`; build your own |
| **Accessibility** | `accessibilityLabel`, `respectReducedMotion` | auto-detects OS reduce-motion (per-element labels coming in v0.2) |
| **Performance** | `rendering.skipText`, `rendering.interactiveBudget` | scales to several hundred elements; Skia + Rust-core swap planned for v1.0 to lift the ceiling |

## What Vexel is NOT for

Different problems need different runtimes — naming them upfront so you
don't reach for the wrong tool:

| If you're building | Use this instead |
|---|---|
| A drawing / signature / brush-engine app | [`@shopify/react-native-skia`](https://shopify.github.io/react-native-skia/) |
| 5,000+ point real-time charts (tickers, sensors) | [`victory-native@40+`](https://commerce.nearform.com/open-source/victory-native/), [`react-native-graph`](https://github.com/margelo/react-native-graph) |
| Designer-authored animations from After Effects | [`lottie-react-native`](https://github.com/lottie-react-native/lottie-react-native) |
| State-machine-driven interactive animations | [Rive](https://rive.app/) |
| Static icon SVGs only | [`react-native-svg`](https://github.com/software-mansion/react-native-svg) + [`react-native-svg-transformer`](https://github.com/kristerkari/react-native-svg-transformer) |

Vexel is for **identity-bearing**, **mutable**, **per-element-addressable**
SVG — diagrams, flowcharts, org charts, maps, schematics, AI-generated
visualizations, anything where each shape has a name and the user should be
able to interact with it individually.

## Status

This is **v0.x — a pure-JS preview** implemented on top of `react-native-svg`.
The prop API is the v1.0 surface; v1.0 will swap the rendering backend to
[Skia](https://shopify.github.io/react-native-skia/) and route hit-testing
through a Rust core for cross-platform pixel parity at scale. **Consumers
upgrade transparently** — the public API doesn't change.

See [ROADMAP.md](https://github.com/Pixelpath-Studio/vexel/blob/main/ROADMAP.md)
for the full pain-point → solution → status breakdown. Every release lines up
against an entry in that document.

## CSS support (v0.0.3+)

Most SVG generators (Mermaid, Inkscape, Figma export, Adobe Illustrator,
GraphViz) style elements via `<style>` blocks with CSS class selectors.
`react-native-svg`'s optional `SvgCss` module handles basic class selectors
but doesn't implement `@media`, the full cascade, `!important`, var() chains,
or SVG-2 inheritance — and ships ~100 KB of `css-tree`. Skia's SVG renderer
[explicitly doesn't support CSS](https://shopify.github.io/react-native-skia/docs/images-svg/)
at all.

Vexel implements the complete SVG-2 CSS subset in pure TypeScript (~12 KB,
no external deps), embedded in the runtime so it just works:

- **Selectors:** tag / `.class` / `#id` / `[attr]` / `*` / compound, descendant
  (` `), child (`>`), adjacent (`+`), sibling (`~`)
- **Pseudo-classes:** `:first-child`, `:last-child`, `:nth-child()`,
  `:nth-of-type()`, `:not()`, `:is()`, `:where()`, `:root` — plus `:hover` /
  `:focus` / `:active` mapped to Vexel's selection state
- **At-rules:** `@media (prefers-color-scheme | min-width | max-width |
  prefers-reduced-motion)`, `@supports`, `@keyframes`, `@font-face`,
  `@import`
- **Values:** `var(--name, fallback)`, `calc()`, `currentColor`, `!important`
- **Inheritance:** full SVG-2 inheritance for `fill`, `stroke`, `color`,
  `font-*`, etc.
- **Cascade:** specificity-correct `(a,b,c)` ordering, source-order tiebreak,
  `!important` tier

```tsx
<VexelView
  source={mermaidSvgString}
  cssVariables={{ '--brand': '#f59e0b' }}                   // feed your design tokens
  mediaContext={{ darkMode: scheme === 'dark' }}            // dark-mode @media support without re-parsing
  onFontFace={(faces) => loadFonts(faces)}                  // hook @font-face into your loader
  onCSSWarning={(w) => console.warn(w.kind, w.message)}     // dev diagnostics
/>
```

## Painted-area hit testing (v0.1.0+)

Take a thin diagonal arrow from `(0,0)` to `(300,200)`. Its bounding box is
`300×200`. With most SVG libraries (and Vexel's default `bounding-box` mode),
tapping anywhere in that box — including the empty top-right corner — fires
the arrow's `onPress`. With `visible-painted` mode, taps resolve against the
actual painted geometry (with a configurable tolerance), so empty-corner taps
correctly fall through.

```tsx
<VexelView
  source={svg}
  hitTestMode="visible-painted"     // | 'bounding-box' (default) | 'stroke-only' | 'fill-only'
  hitTestTolerance={6}              // viewBox units; default 6
  onElementPress={(id) => console.log('actually painted:', id)}
/>
```

Under the hood: every shape's `d` / `points` / primitive geometry is flattened
to a polyline at parse time; tap resolution runs point-to-polyline distance
with bounding-box early reject. Pure JS today; v1.0 moves the same public API
to an O(log n) Rust R-tree.

## Stream-by-stroke (v0.x)

Reveal elements over time in true graph-flow order — `Start → arrow →
Decision → arrow → Process A → arrow → End` — for AI-tutoring whiteboards,
explanation walkthroughs, or anywhere you want the diagram to *construct
itself* on screen.

```tsx
<VexelView
  source={svg}
  streamReveal
  streamElementMs={800}
  streamEasing="hand-natural"     // also: 'linear' | 'ease-out' | 'ease-in-out'
  streamOrder="topological"        // also: 'document' | 'random' | (shapes) => ids[]
/>
```

`topological` (the default when `streamReveal` is on) does a BFS through the
directed adjacency graph from source nodes, emitting `source-node → target-node
→ edge` so each arrow's head always lands on a target that's already visible.
Marker references are stripped during reveal to prevent arrowheads from
floating before their host path catches up — they re-attach the moment the
edge reaches full reveal.

## Edge & arrow styling (v0.0.7+)

Restyle every connecting line + arrowhead without touching the source SVG.
`edges` cascades over the SVG's own CSS at the highest author-tier priority.

```tsx
<VexelView
  source={mermaidSvg}
  edges={{
    default: {
      stroke: '#3b82f6',
      strokeWidth: 2,
      strokeDasharray: 'dashed',        // | 'solid' | 'dotted' | [5, 3, …]
      strokeLinecap: 'round',
      opacity: 0.9,
      arrow: 'circle',                  // 8 built-ins (below) or { d, viewBox }
      arrowColor: '#1d4ed8',
      arrowScale: 1.2,
    },
    byId: {
      'L_A_B_0': { stroke: '#ef4444', arrow: 'diamond' },
    },
    byClass: {
      'flowchart-link': { strokeWidth: 1.5 },
    },
    resolve: (id, shape) =>
      id?.startsWith('critical_')
        ? { stroke: 'red', arrow: 'triangle', arrowScale: 1.5 }
        : undefined,
  }}
/>
```

**Built-in arrow shapes** (`ArrowShape`): `triangle` (default) ·
`triangle-open` · `arrow` (chevron) · `circle` · `circle-open` · `square` ·
`diamond` · `bar` · `none` · or a `{ d, viewBox?, refX?, refY?, outline? }`
object for any custom path.

### CSS-driven arrows (v0.0.8+)

Same arrows, driven by CSS instead of props. Put the rules in the SVG's
own `<style>` block — they cascade like every other style, so `:hover`,
`@media`, `!important`, `var()` all work.

```css
.flowchart-link {
  stroke: #10b981;
  stroke-width: 2.5;
  --vexel-arrow: triangle-open;   /* shape name */
  --vexel-arrow-color: #047857;   /* falls back to stroke */
  --vexel-arrow-scale: 1.3;
}

.important {
  --vexel-arrow-start: bar;       /* per-end overrides */
  --vexel-arrow-end: diamond;
}

@media (prefers-color-scheme: dark) {
  .flowchart-link { --vexel-arrow-color: #34d399; }
}
```

| Custom prop | Value | Default |
|---|---|---|
| `--vexel-arrow` | shape name | — |
| `--vexel-arrow-start` | shape name | (none) |
| `--vexel-arrow-end` | shape name | (none) |
| `--vexel-arrow-color` | CSS color | element's `stroke` |
| `--vexel-arrow-scale` | number | 1 |

If both `edges` prop and `--vexel-arrow*` CSS apply to the same edge, the
`edges` prop wins per-property — explicit caller intent always trumps
declarative style.

## Peer dependencies

- `react` >= 18
- `react-native` >= 0.74
- `react-native-svg` >= 15

## Example

The full feature set is exercised by the demo app at
[`examples/react-native-mermaid`](https://github.com/Pixelpath-Studio/vexel/tree/main/examples/react-native-mermaid)
in the repo — a 13-tab navigator with one tab per feature group:
`Basic`, `Layout`, `Highlight`, `Stream`, `Theme`, `Zoom`, `Plugins`, `A11y`,
`Perf`, `CSS`, `Mermaid` (5 real Mermaid 10.9.x fixtures), `Edges` (6 edge-style
presets including a CSS-driven one), and `HitTest` (live synthetic-assertion
proof of bounding-box vs visible-painted behavior).

## Roadmap

See [ROADMAP.md](https://github.com/Pixelpath-Studio/vexel/blob/main/ROADMAP.md)
for the master pain-point document. Next up after v0.1.0:

- **v0.2** — `useVexelSession()` mutation API: `session.patch(id, attrs)` /
  `append(svgFragment)` / `remove(id)` for live editing without re-parsing
  the whole tree. The mobile receiver for streaming partial SVG fragments
  from an LLM, collaborative whiteboards, real-time data viz.
- **v0.3** — declarative animation timeline (the SMIL React Native never got).
- **v0.4** — verified Fabric / New-Architecture compat matrix + CI; dev
  overlay (`<VexelView debug />` showing ids, bboxes, hit regions).
- **v0.5** — preset components: `<VexelMermaid>`, `<VexelFlowchart>`,
  `<VexelOrgChart>`, `<VexelSequence>`.
- **v1.0** — Skia + Rust-core swap. Same public API; pixel parity iOS↔Android;
  5,000+ element ceiling.

## License

Apache-2.0 © PixelPath
