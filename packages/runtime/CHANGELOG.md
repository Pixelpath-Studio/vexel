# Changelog

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
