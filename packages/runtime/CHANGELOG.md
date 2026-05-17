# Changelog

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
