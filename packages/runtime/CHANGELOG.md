# Changelog

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
