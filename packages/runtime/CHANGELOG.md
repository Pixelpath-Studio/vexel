# Changelog

## 0.1.0 — Painted-area hit testing + true-flow streaming + master pain-point roadmap

First minor-version bump. Adds the highest-leverage unsolved problem in
the React Native SVG ecosystem: hit testing that respects what's actually
painted, not just bounding boxes. Plus a fundamental fix to streaming
order — diagrams now reveal in true graph-flow order, not document order.

### Why this is a `0.1.x` and not a `0.0.x`

This release ships the first piece of work driven by `ROADMAP.md` — a
new top-level document that lists every pain point in the RN-SVG
ecosystem, traces each to its architectural root cause, and explains
how Vexel solves it at general-purpose-library scale (not Curo-
specific). Read it at `/ROADMAP.md` in the repo. From here on, every
release lines up against an entry in that document.

### What landed

**New: painted-area hit testing.** `hitTestMode="visible-painted"`
(plus the existing `hitTestTolerance` prop, now wired up) makes
`onElementPress` fire only when the tap is within `tolerance` viewBox
units of the element's painted area. Bounding-box mode (today's default)
still fires on any tap inside the bounding box.

```tsx
<VexelView
  source={svg}
  hitTestMode="visible-painted"  // | 'bounding-box' (default) | 'stroke-only' | 'fill-only'
  hitTestTolerance={6}
  onElementPress={(id) => console.log('actually painted:', id)}
/>
```

Why this matters: take a thin diagonal arrow from `(0,0)` to `(300,200)`.
Its bounding box is `300×200`. With bounding-box mode, tapping the empty
top-right corner triggers the arrow's `onPress`. With painted-area mode,
the tap correctly falls through to the parent (the canvas background, a
ScrollView, or whatever's underneath).

### Architecture

- New `src/hitTest.ts` module — pure functions, no native code.
  Exports: `flattenPath(d)`, `pointToSegmentSqDist`,
  `pointToPolylineSqDist`, `pointInPolygon`, `hitTestShapes`.
- Parser change: `IndexedShape` now carries `flattened: Float64Array`
  (the painted polyline) and `closed: boolean` (for `pointInPolygon`
  semantics). Computed once at parse time from `<path d="...">`,
  `<polygon>`/`<polyline>` points, or by sampling `<rect>`/`<circle>`/
  `<ellipse>` perimeters.
- Renderer change: in painted mode, per-`<G>` `onPress` wrappers are
  skipped (`bypassPerElementTap`). The root transparent rect's
  `onPressIn` dispatches all taps via `hitTestShapes()` → the matched
  element id, or falls through to `handleClearBackground`.
- Path flattener supports: `M / L / H / V / C / S / Q / T / A / Z` plus
  all relative forms and implicit-L after M. Curves are sampled at 16
  points per segment — coarse enough to be fast, fine enough that
  finger-sized taps resolve correctly. Arc endpoint-to-center conversion
  follows the SVG spec.

### Test coverage

19 new unit tests in `src/hitTest.test.ts` covering the flattener (line,
quadratic, cubic, smooth, arc, H/V, implicit-L), the distance primitives
(point-to-segment, point-to-polyline, point-in-polygon), and the
top-level resolver (miss-when-far, hit-inside-fill, topmost-wins-on-
overlap, fall-through-on-thin-diagonal, hit-within-tolerance, bbox-vs-
painted parity). Total suite: 68 tests passing (49 cssRules + 19
hitTest).

### Performance

Pre-Skia, all hit-testing runs on the JS thread, O(n) over the graph's
shapes (early-rejected by bbox first). For diagrams up to ~500 elements
this is under 1 ms per tap on iPhone XS-class hardware. The v1.0 Skia +
Rust core moves this to a native STR-packed R-tree with the same public
API — consumers upgrade transparently.

### Not in this release (next up)

- **Gesture composition props** (`gestures.simultaneousHandlers`,
  `gestures.waitFor`) — coming in v0.2 alongside the mutation API.
  For now, wrapping `<VexelView>` in a `react-native-gesture-handler`
  `TapGestureHandler` composes cleanly.
- **Per-element memoization** — separate effort tracked under PP-PERF.

### Demo

New "HitTest" tab in the example app. Toggle between painted-area and
bounding-box mode against a SVG with a diagonal arrow whose bounding box
covers the entire viewBox; tap the empty top-right corner to feel the
difference. On load the screen runs five synthetic taps against the live
parsed graph and shows bbox-mode vs painted-mode results side-by-side —
10 assertions, all green.

### Also in this release — true-flow streaming order

`streamReveal` now reveals elements in **graph-flow order** instead of
document order. The previous behavior dropped Mermaid edges (emitted in
`<g class="edgePaths">` before `<g class="nodes">`) before their host
nodes, leaving arrows pointing at empty space until the boxes caught up.

Three architectural fixes underneath:

1. **`buildGraph` now registers bare `<path id>` / `<polygon id>` /
   `<polyline id>` / `<line id>` elements** as graph shapes, not just
   `<g id>`. Mermaid emits edges as bare `<path id="L-A-B-0">` — they
   were entirely missing from `graph.shapes` and therefore invisible to
   streaming / highlight / adjacency.
2. **`renderShape` honors `revealOf` when the element itself has an id**
   (not only when a parent group does). Bare edge paths now animate
   in instead of jumping straight to fully visible.
3. **Default `streamOrder` flipped from `'document'` to `'topological'`,
   and `'topological'` now means actual BFS through the directed
   adjacency graph from source nodes** — emitting `source-node → target-
   node → edge` so the edge's arrowhead always lands on a target that's
   already visible. Disconnected components append in document order.

### Plus — marker rendering during reveal

`react-native-svg` renders `<marker>` definitions at the path's geometric
endpoint regardless of the host path's opacity or `stroke-dasharray`. So
during streaming, arrowheads would pop in at their target positions
*before* the host path animated in — producing "arrows pointing at
nothing." Fixed by stripping `markerEnd` / `markerStart` / `markerMid`
when `reveal < 1`, plus applying `display: none` on top of `opacity: 0`
for fully-hidden elements. Markers re-attach the moment the edge reaches
full reveal.

### Also — `computeBbox` backfills from flattened polyline

Path-only `<g>` groups (every edge in Mermaid) had no bbox at all
because `computeBbox` only handled rect/circle/polygon/polyline.
Bounding-box hit-test returned null for them. Now the bbox is derived
from the flattened polyline whenever the rect/circle/polygon scan
finds no primitive — making bbox-mode hit-test correct on path-based
shapes too.

### Master pain-point document — `ROADMAP.md`

Every issue this library claims to solve, traced through (symptom →
architectural root cause → Vexel's solution → status) at general-
purpose-library scale. Lives at `/ROADMAP.md` in the repo. From here on,
every release lines up against an entry. If you hit a pain point not
listed — open an issue, link the evidence, and we'll RCA it before
deciding what to do.

## 0.0.9 — CSS resolution for marker contents

Before this release, `<marker>` children were rendered with no CSS
cascade context — so author rules like

```css
#diagram .marker path { fill: var(--my-line); }
```

silently failed to color arrowheads. The path inside the marker rendered
with the SVG default fill (black). Users would write a perfectly
reasonable rule, see no effect, and have no way to debug it.

Fix: `renderDefs` now accepts an optional `cssCtx` ({ resolveStyle,
svgRootElCtx, svgRootInherited }) and threads it into each marker
child's `renderShape` call. The marker's own element context is pushed
onto the ancestor stack, so the chain `[svg, marker, path]` is what the
matcher sees — selectors like `#diagram .marker path` and
`.arrowMarkerPath` resolve correctly.

This matters most for dark-mode theming: a consumer that injects
`@media (prefers-color-scheme: dark) { #diagram .marker path { fill:
#bfbfbf } }` now actually gets light-gray arrowheads on dark background.

The CSS cascade order rules from 0.0.5 still apply — author CSS wins
over the marker path's presentation attrs, but inline `style="..."`
on the marker path still wins over CSS.

## 0.0.8 — CSS-driven arrow customization

`edges` (v0.0.7) is the imperative path; this release adds the
**declarative** path. SVG authors can style arrows by writing CSS:

```css
/* inside the SVG's own <style>, OR in a CSS-in-JS string the host injects */
.flowchart-link {
  stroke: #10b981;
  stroke-width: 2.5;
  --vexel-arrow: triangle-open;     /* shape name */
  --vexel-arrow-color: #047857;     /* falls back to stroke */
  --vexel-arrow-scale: 1.3;
}

.flowchart-link.important {
  --vexel-arrow-start: bar;          /* per-end overrides */
  --vexel-arrow-end: diamond;
}

@media (prefers-color-scheme: dark) {
  .flowchart-link { --vexel-arrow-color: #34d399; }
}
```

Same cascade as everything else, so `:hover` (mapped to Vexel selection
state), `@media`, `!important`, `var()` chains, all work. Imperative
`edges` prop still wins per-property when both are set.

### Custom property reference

| Property | Type | Default |
|---|---|---|
| `--vexel-arrow` | ArrowShape name | — |
| `--vexel-arrow-start` | ArrowShape name | (none) |
| `--vexel-arrow-end` | ArrowShape name | (none) |
| `--vexel-arrow-color` | CSS color | element's `stroke` |
| `--vexel-arrow-scale` | number | 1 |

`--vexel-arrow-start` / `--vexel-arrow-end` override `--vexel-arrow` when
either is set. `none` strips the marker.

### Synthetic-marker pre-emission

The renderer scans `parsedCss.rules` ahead of time, resolves `var()`
references against `:root` + the `cssVariables` prop, and emits one
synthetic `<marker>` per unique (shape, color, scale) triple. So the
marker definitions exist in `<Defs>` by the time the cascade resolves
the matching `marker-end="url(...)"` references on each edge.

49 unit tests passing (10 new ones cover `extractCssArrowStyle`,
`collectMarkerSpecsFromCss`, `makeMarkerId`).

A new `css-driven` preset in the "Edges" demo tab proves the round-trip:
the SVG is rendered unmodified except for a `<style>` rule injection that
sets `--vexel-arrow: triangle-open` — Vexel rewrites every edge's arrow
to an open-triangle outline in `#047857`.

## 0.0.7 — Edge & arrow customization

New `edges` prop lets consumers fully restyle connecting lines and their
arrowheads without touching the source SVG. Layers on top of the SVG's own
CSS at the highest author-tier priority (below interactive selection /
streaming overlay).

```tsx
<VexelView
  source={mermaidSvg}
  edges={{
    default: {
      stroke: '#3b82f6',
      strokeWidth: 2,
      strokeDasharray: 'dashed',     // | 'solid' | 'dotted' | [5, 3, …]
      strokeLinecap: 'round',
      opacity: 0.9,
      arrow: 'circle',               // 8 built-ins, or { d, viewBox, refX, refY }
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

### Built-in arrow shapes (`ArrowShape`)

`triangle` (filled, default) · `triangle-open` · `arrow` (chevron) ·
`circle` · `circle-open` · `square` · `diamond` · `bar` · `none` ·
or a `{ d, viewBox?, refX?, refY?, width?, height?, outline? }` object
for any custom path.

### How it works

For every unique (shape, color, scale) triple referenced by the config,
Vexel generates one synthetic `<marker>` definition and emits it in `<Defs>`
alongside the SVG's own markers. The matching `<path>` / `<line>` /
`<polyline>` elements get `marker-end="url(#vexel-arrow-...)"` rewritten
to point at the synthetic marker. References look up by id globally so
multiple consumers and per-edge overrides coexist.

The cascade resolution per edge is: `default` → each matching `byClass` →
`byId` → `resolve(id, shape)`. Later layers override earlier ones property
by property.

A new demo tab ("Edges") exercises six representative configs against the
complex flowchart fixture.

## 0.0.6 — Arrowhead markers

Directed edges in Mermaid diagrams reference shared `<marker>` definitions
via `marker-end="url(#arrowhead)"`. Vexel 0.0.5's `renderDefs` only looked
at the first `<defs>` element, but Mermaid is wildly inconsistent about
where it puts markers:

- **flowcharts** — markers as direct children of `<g>` (no `<defs>` at all)
- **sequence diagrams** — 7 separate `<defs>`, one marker each
- **class diagrams** — 10 separate `<defs>` mixing markers + symbols
- **state diagrams** — single `<defs>` with all markers

Result: every directed edge rendered as a line *without* an arrowhead.
Fixed by walking the entire SVG tree, collecting every `<marker>`
regardless of nesting, and emitting them in a single `<Defs>` block at the
top. Marker references resolve globally by id, so collapsing them is
semantically identical to the original layout.

Verified visible arrowheads on sequence (4 message arrows + dashed
reply), flowchart-complex (decision-diamond branches), and class
(inheritance triangles).

## 0.0.5 — All-Mermaid-types correctness + streaming fix

End-to-end verification against real Mermaid 10.9.x output (via
@mermaid-js/mermaid-cli) for **flowchart, sequence, class, state** diagrams
surfaced four more bugs that 0.0.4 missed. All five fixture types now render
correctly, including stroke-by-stroke streaming on the most complex flowchart.

### Bugs fixed

1. **`<tspan>` children of `<text>` weren't extracted.** Mermaid wraps every
   label as `<text><tspan dy="1em" x="0">...</tspan></text>`. The renderer
   was reading direct text from `<text>` (always empty) and ignoring the
   tspan, so every node label disappeared. Now walks tspan children and
   emits them as RN-SVG `<TSpan>` with their own attrs + cascaded styles.

2. **Cascade merge order was backwards.** Author CSS rules were losing to
   SVG presentation attributes — opposite of what the spec requires. Real
   consequence: Mermaid sequence diagrams set `<line stroke="none">` and
   rely on `.messageLine0 { stroke: #212121 }` to color them — the line
   attribute was winning, so all message arrows were invisible. Cascade
   order is now: presentation attr → author CSS → inline style → consumer
   props (matching CSS Cascade L5 / SVG 2).

3. **`<text>`, `<line>`, `<path>`, etc. as direct children of `<svg>` were
   skipped.** The render loop only iterated `<g>` siblings. Mermaid's
   sequence diagrams emit message lines + labels at the SVG top level (no
   wrapping `<g>`), so they never rendered. Now any renderable shape at
   the top level is dispatched through `renderShape`.

4. **`streamReveal` did nothing when node IDs were nested.** The order list
   for streaming was built by scanning *direct* `<g>` children for `id`,
   but Mermaid puts `<g id="flowchart-A-0">` several levels deep under
   `<g class="root">/<g class="nodes">`. The list was empty, so no element
   was ever revealed-in. Switched to `graph.shapes.keys()` (the
   `walk()`-discovered set), which has every id regardless of depth.

5. **The renderGroup reveal-inheritance check was wrong** (regression
   introduced by 0.0.4). When 0.0.4 began seeding the initial recurse with
   `reveal: 1`, the `inherited?.reveal != null` branch always won — so
   `revealOf(id)` was never called for nested id-having groups. Reordered:
   id-having groups always recompute their own reveal; non-id groups
   inherit from parent.

### What was verified

Five SVGs generated offline by `@mermaid-js/mermaid-cli@10.9.1` with the
same `themeVariables` Curo uses, rendered in the demo's new "Mermaid" tab:
flowchart-simple, flowchart-complex (decision diamond + 8 nodes + edge
labels), sequence (4 message arrows + lifelines), classDiagram
(inheritance), stateDiagram-v2 (start/end markers + transitions).
streamReveal verified mid-flight on flowchart-complex — boxes appear with
hand-natural easing in document order, edges fade in with their parent
elements.

## 0.0.4 — Mermaid-correctness fixes

Two bugs from 0.0.3 that prevented real Mermaid output from rendering correctly:

1. **`<g transform="...">` was ignored** — every `<g>` was emitted as a bare `<G>` without
   the parent's `transform`, `opacity`, `clip-path`, `mask`, `visibility`, `display`, or
   `pointer-events`. Mermaid (and most diagram generators) positions every node via
   `<g transform="translate(...)">`, so without this fix all nodes piled up at viewBox
   origin (0,0). Fixed: `renderGroup` now forwards these group-level attributes to the
   underlying `<G>` element.

2. **The `<svg>` root was missing from the CSS ancestor stack** — selectors like Mermaid's
   `#diagram .node rect { fill: #FFF8F2 }` silently failed because Vexel started the
   ancestor stack at the first top-level `<g>`, skipping `<svg id="diagram">`. Rects fell
   back to SVG default `fill: black`. Fixed: `VexelView` seeds the renderer with
   `[<svg> element context]` as the initial ancestor, and pre-resolves the SVG root's own
   CSS so inheritable props (like `fill`, `color`, `font-*`) flow down to descendants.

Together these mean real Mermaid SVGs (the actual `<style>` block + `<g transform>` output)
render correctly without any pre-processing in the consumer (no flatten shim, no WebView
hacks needed).

Two regression tests added for the CSS ancestor bug; the demo gains a `mermaid-real`
variant exercising the exact selector + transform pattern Mermaid emits.

## 0.0.3 — CSS support

The big one. Vexel now resolves the full CSS cascade declared in the SVG's `<style>` blocks, so
diagrams from Mermaid, Inkscape, Figma, Adobe Illustrator, and GraphViz render correctly out of
the box. Previously, `react-native-svg` (Vexel's v0.x rendering surface) ignored CSS entirely —
SVGs that relied on class selectors for fill / stroke / font shape came out unstyled.

### What's resolved

- **Selectors** — tag, `.class`, `#id`, `[attr]`, `*`, compound, descendant (` `), child (`>`),
  adjacent sibling (`+`), general sibling (`~`)
- **Pseudo-classes** — `:first-child`, `:last-child`, `:nth-child()`, `:nth-of-type()`, `:not()`,
  `:is()`, `:where()`, `:root`, plus `:hover` / `:focus` / `:active` mapped to Vexel's selection
  state (`selectedIds`)
- **At-rules** — `@media (prefers-color-scheme | min-width | max-width | prefers-reduced-motion)`,
  `@supports`, `@keyframes` (parsed + surfaced), `@font-face` (surfaced via `onFontFace`),
  `@import` (warned, not auto-fetched)
- **Values** — `var(--name, fallback)`, `calc()` (+, -, *, /), `currentColor`, `!important`
- **Inheritance** — full SVG 2 inheritance for `fill`, `stroke`, `color`, `font-*`, `opacity`,
  `visibility`, etc.
- **Cascade** — specificity-correct (a, b, c) ordering, source-order tiebreak, `!important` tier

### New props

- `cssVariables?: Record<string, string>` — feed your design tokens for `var(--brand)` etc.
- `mediaContext?: { darkMode?, reducedMotion?, viewportWidth?, viewportHeight? }` — drives
  `@media` query evaluation
- `onCSSWarning?: (warning) => void` — non-fatal parser diagnostics
- `onFontFace?: (faces) => void` — hook `@font-face` declarations into your font loader

### Migration

No breaking changes — existing apps continue to render. If a previously-broken Mermaid diagram
now renders **differently** (presumably correctly), it's because the CSS rules in the `<style>`
block are finally being honored.

If you were using a WebView shim (e.g. `getComputedStyle` → flatten attributes) to work around
the missing CSS support, you can drop it.

## 0.0.2

- Fixed npm metadata (correct GitHub org URLs in `repository` and `homepage`).

## 0.0.1

- Initial preview release: pure-JS SVG renderer for RN with tap highlighting, transitive
  connections, stream-by-stroke, zoom/pan, plugin system, accessibility.
