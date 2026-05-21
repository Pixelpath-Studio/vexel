# Vexel — Pain points, RCA, and roadmap

Vexel is a React Native SVG runtime that exists because **`react-native-svg`
ships per-element React views with no caching, no memoization, no first-class
mutation API, no painted-area hit-testing, and a half-finished CSS layer that
most teams `patch-package` out**. Skia handles GPU-heavy use cases (drawing
apps, large charts) — but it's a single immediate-mode canvas with no
addressable elements, no SVG identity, no per-element interactivity story.

There's a real, narrow wedge between those two: **diagrams**, **AI-generated
SVG**, **maps**, **interactive textbook figures**, **floor plans**, **annotation
tools**. These need *identity* (every element addressable), *mutability*
(edit one path mid-frame without re-parsing), *gesture safety* (taps that
work inside a ScrollView), and *correct* SVG semantics (full CSS cascade,
markers, transforms, foreignObject alternatives). Vexel is for that wedge.

This document is the source of truth for *every problem Vexel claims to
solve*. Each entry follows the same structure:

> **Symptom** — what end users see go wrong
> **Root cause** — why the existing tools fail (architectural, not
> blame-y)
> **Vexel's solution** — design-level, not Curo-specific
> **Status** — what's shipped, what's next
> **Citations** — live evidence

We update this as we ship. Tagged `🔴` = unsolved upstream, live pain;
`🟡` = workaround exists but ugly; `🟢` = solved; `⚫` = explicitly out of
scope.

---

## PP-CSS · CSS in `<style>` blocks doesn't fully work

`🟢 Shipped in v0.0.3–v0.0.9 (cascade, @media, !important, var(), markers, edges, dark mode)`

### Symptom
SVGs produced by Mermaid, Inkscape, Figma export, Adobe Illustrator, and
GraphViz render as a mess of black boxes (or invisible elements) — the
visual rules that should color them live in a `<style>` block, and the
rendering library never reads it.

### Root cause
- `react-native-svg` ships an *optional* CSS layer (`SvgCss`,
  `SvgCssUri`) that bundles `css-tree` + `css-select` and handles **basic
  class selectors only**. It does not implement `@media` queries, the full
  CSS cascade, `!important`, full `var()` resolution, or inheritance the
  way the spec requires.
- It adds ~100–250 KB to the bundle; many teams `patch-package` it back
  out for size reasons.
- `react-native-svg` Skia mode (and Shopify's `@shopify/react-native-skia`
  directly) explicitly states **CSS styles in SVG are not supported**.
  Period.
- Mermaid and friends use **id-prefixed selectors** like `#diagram .node
  rect { fill: #FFF8F2 }` — selectors that require the `<svg>` root in
  the ancestor stack. Even libraries that *do* parse CSS often start the
  ancestor stack at the first `<g>` child.

### Vexel's solution (general-purpose)
A complete cascade engine in pure TypeScript (no css-tree dep), embedded
in the runtime. Supports the full SVG-2 CSS subset:

- Selectors: tag, `.class`, `#id`, `[attr]`, `*`, descendant (` `), child
  (`>`), adjacent sibling (`+`), general sibling (`~`)
- Pseudo-classes: `:first-child`, `:last-child`, `:nth-child()`,
  `:nth-of-type()`, `:not()`, `:is()`, `:where()`, `:root`, `:hover` /
  `:focus` / `:active` mapped to Vexel's selection state
- At-rules: `@media (prefers-color-scheme | min-width | max-width |
  prefers-reduced-motion)`, `@supports`, `@keyframes`, `@font-face`,
  `@import` (parsed, surfaced)
- Values: `var(--name, fallback)`, `calc()`, `currentColor`, `!important`
- Inheritance: SVG-2 inheritance table for `fill`, `stroke`, `color`,
  `font-*`, etc.
- Cascade: specificity-correct `(a,b,c)` ordering, source-order tiebreak,
  `!important` tier

The SVG `<svg>` root is included in the matcher's ancestor stack, so
namespaced selectors (`#diagram .node rect`) match correctly. Markers in
`<defs>` get cascade resolution too, so `.marker path { fill }` actually
colors arrowheads.

Bundle cost: ~12 KB minified. No external dependency.

### Why this matters at scale
Any consumer that needs to render Mermaid, generator-produced SVG, or
themed (dark-mode) SVG benefits. Curo's lecture diagrams are one case;
the same engine powers `<style>`-driven theming for floor plans (zone
colors per occupancy), maps (population choropleth via CSS variables),
and AI-generated SVGs where the LLM emits its own stylesheet.

### Citations
- `react-native-svg` [#2693 "SVGs filled with black instead of none"](https://github.com/software-mansion/react-native-svg/issues/2693) (open, July 2025)
- `react-native-svg` [#2380 var() bug](https://github.com/software-mansion/react-native-svg/issues/2380) (fixed Oct 2024, narrow)
- `react-native-svg` [#1264 bundle size](https://github.com/software-mansion/react-native-svg/issues/1264)
- Skia: ["CSS styles included in SVG are not supported"](https://shopify.github.io/react-native-skia/docs/images-svg/)

---

## PP-MERMAID · Mermaid diagrams don't render in React Native

`🟢 Shipped in v0.0.4–v0.0.9 (svg-root, transforms, tspan, top-level shapes, streaming, markers)`

### Symptom
Mermaid produces an SVG. `react-native-svg` renders it as one rectangle, or
several piled at viewBox (0,0), or empty boxes, or with no arrowheads, or
with broken text labels.

### Root cause (five separate bugs)
1. **id-prefixed CSS doesn't match.** Mermaid uses `#diagram .node rect`.
   Renderers that start the ancestor stack at the first `<g>` skip the
   `<svg>` root, so every Mermaid CSS rule silently fails.
2. **`<g transform="translate(x,y)">` not forwarded** to the rendered
   group. Mermaid positions every node via group transform. Without it,
   all nodes pile up at viewBox origin.
3. **`<tspan>` content not extracted.** Mermaid wraps labels as
   `<text><tspan dy="1em">Hello</tspan></text>`. Renderers that read
   only direct text from `<text>` see empty strings — invisible labels.
4. **Author CSS lost to presentation attribute.** Mermaid sequence
   diagrams set `<line stroke="none" class="messageLine0">` and rely on
   `.messageLine0 { stroke: #212121 }` to color them. Per SVG-2 cascade,
   CSS wins — but if the renderer applies SVG attrs after CSS, all arrows
   are invisible.
5. **Top-level renderable shapes skipped.** Mermaid sequence diagrams
   emit `<text>` and `<line>` as direct children of `<svg>`, no wrapping
   `<g>`. A render loop that iterates only `<g>` siblings drops them.
6. **Markers scattered across multiple `<defs>`** (or no `<defs>` at
   all — flowcharts put them as direct `<g>` children). A render path
   that only handles the first `<defs>` misses every arrowhead but one.
7. **`<marker>` children rendered without CSS context** — even if the
   author writes `#diagram .marker path { fill: white }` for dark mode,
   the marker path inside `<Marker>` ignores it.
8. **Streaming order list doesn't find nested node IDs.** Building the
   draw-order list from direct `<g id>` children misses every Mermaid
   node, which lives several levels deep under `<g class="root">`.

### Vexel's solution
All of the above are addressed in the parser + renderer. Specifically:

- `<svg>` root + its element-context (id, classes) seeded into every
  cascade resolution
- Group-level attributes (`transform`, `opacity`, `clip-path`, `mask`,
  `visibility`, `display`, `pointer-events`) forwarded to the `<G>`
  wrapper
- `<text>` walks `<tspan>` children, emits them as `<TSpan>` with their
  own attrs, runs CSS resolution per tspan
- Cascade order: presentation attr → author CSS → inline style →
  consumer overrides → status → reveal
- Top-level `<text>` / `<line>` / `<path>` / `<rect>` outside any `<g>`
  are dispatched through `renderShape`
- All `<marker>` elements walked from the whole tree (not just direct
  `<defs>` child), collected into a single `<Defs>` block at top
- `<marker>` children inherit the cascade ancestor stack `[svg, marker,
  path]`, so `.marker path { fill }` works
- Streaming `orderedIds` derived from `graph.shapes.keys()` (the
  full DOM walk), not just direct `<g>` children

Verified against real Mermaid 10.9.x output for **flowchart, sequence,
class, state** diagrams. No `<foreignObject>` workaround needed (Mermaid
10.9 respects `htmlLabels:false`).

### Why this matters at scale
Anyone shipping an LLM-driven mobile product where the model emits
Mermaid (or any structured diagram DSL) needs this. Education apps,
project-management copilots, code-explanation tools, doctor's clinical
decision support — all converge on diagrams as the right output for
process / relationships / hierarchies.

### Citations
- No maintained `react-native-mermaid` package on npm
- Mermaid [#7015 / #7016](https://github.com/mermaid-js/mermaid/issues/7015) (Sep 2025, `htmlLabels:false` bugs in v11)
- Expo's [`'use dom'`](https://docs.expo.dev/guides/dom-components/) — the dominant escape hatch

---

## PP-EDGES · Connecting lines / arrowheads can't be restyled

`🟢 Shipped in v0.0.7–v0.0.9 (imperative edges + CSS --vexel-arrow-* + marker CSS resolution)`

### Symptom
The SVG renders with the source's default arrow shape and line color. No
way to "make every arrow orange" or "make this critical edge a thick red
diamond" without round-tripping through the source generator.

### Root cause
- `<marker>` references (`marker-end="url(#arrowhead)"`) lookup by id
  globally — there's no clean way to *replace* the arrow shape at the
  consumer level.
- `react-native-svg` has long-running marker bugs ([#1410], [#1739],
  [#461]) that make even basic arrowhead rendering unreliable.
- No library lets you swap arrow shapes by prop, by class, by id, by
  callback, or by CSS variable.

### Vexel's solution
Two complementary paths:

**Imperative (`edges` prop):** layered config — `default → byClass →
byId → resolve(id, shape)`. Each layer can set `stroke`,
`strokeDasharray`, `strokeWidth`, `strokeLinecap`, `opacity`, plus
`arrow` (8 built-ins or custom `{ d, viewBox }`), `arrowColor`,
`arrowScale`.

**Declarative (CSS):** `--vexel-arrow`, `--vexel-arrow-start`,
`--vexel-arrow-end`, `--vexel-arrow-color`, `--vexel-arrow-scale` custom
properties. Cascade like everything else. Author CSS = source of truth.
`:hover`, `@media`, `!important`, `var()` all work.

For every unique `(shape, color, scale)` triple referenced anywhere
(props, CSS, root-vars chains), Vexel emits one synthetic `<Marker>` in
`<Defs>` with a stable id (`vexel-arrow-triangle-f59e0b-1_5`). Marker
references on edges are rewritten to point at the synthetic markers.

### Why this matters at scale
Any product with a design system that needs diagrams to follow brand:
healthcare apps with consistent arrow weight across all flowcharts, fin-
tech with red-for-critical-edge conventions, internal-tooling dashboards
where edge color encodes status.

### Citations
- `react-native-svg` [#1410 Markers broken iOS+Android](https://github.com/software-mansion/react-native-svg/issues/1410)
- `react-native-svg` [#1739 markerEnd broken on Android](https://github.com/software-mansion/react-native-svg/issues/1739)

---

## PP-HITTEST · Hit-test inside parent gestures is broken

`🔴 Major unsolved pain — Vexel JS-side fix planned (next release)`

### Symptom
1. SVG inside a ScrollView: dragging on the SVG blocks the ScrollView's
   pan even when nothing on the SVG should be tappable.
2. Tapping near a thin diagonal path triggers it from anywhere inside
   its bounding box — even far from the actual painted stroke.
3. `pointerEvents="none"` on the root `<Svg>` doesn't always stop the
   bbox from intercepting taps.

### Root cause
- `react-native-svg`'s touch handling is *bounding-box only* on
  iOS/Android (web renderer is correct). For a quarter-circle path, the
  bbox is a square — tapping anywhere in the empty corner fires the
  path's `onPress` ([gesture-handler #2748](https://github.com/software-mansion/react-native-gesture-handler/issues/2748)).
- `pointerEvents` cascade is incomplete; even when set, the root `<Svg>`
  view in the native hierarchy intercepts touches before they reach the
  parent scroll handler ([#2690](https://github.com/software-mansion/react-native-svg/issues/2690), open).
- There's no first-class API for composing SVG-element gestures with
  `react-native-gesture-handler` recognizers. Each consumer rolls their
  own.

### Vexel's solution
Three layers:

1. **Painted-area resolver (pre-Skia, JS).** Vexel already computes
   `IndexedShape.bbox` and `IndexedShape.endpoints` at parse time. Add
   point-in-polyline distance check using the path's flattened points,
   so a tap inside a path's bbox but outside its painted area falls
   through to the parent gesture. Honors `stroke-width` + a configurable
   tolerance.
2. **Gesture composition props.** `<VexelView simultaneousHandlers={[scrollRef]}
   waitFor={[panRef]}>`. Vexel wraps its internal `<G>` taps in
   `react-native-gesture-handler` `TapGestureHandler`s with the provided
   refs, so composition with ScrollView/Pan works without consumer code.
3. **Post-Skia: native R-tree.** The Rust core's
   `crates/trace-core/src/hit/` STR-packed R-tree gives O(log n) painted
   hit-test for files up to 65,536 elements with proper polyline
   distance + nonzero/evenodd fill rules. Same public API as the JS
   resolver — consumers upgrade transparently.

### Why this matters at scale
Floor-plan apps (seat selection inside a scrollable theater layout),
interactive maps (city overlay inside a zoomable region picker), org
charts (tap a person inside a horizontally-scrollable hierarchy),
educational figures (multi-step diagrams with pinch-zoom). Every one of
these breaks today because the SVG's bbox eats the parent's gestures.

### Citations
- `react-native-svg` [#2690 pointerEvents ignored](https://github.com/software-mansion/react-native-svg/issues/2690) (open)
- `react-native-svg` [#1332 onPress on hundreds of shapes](https://github.com/software-mansion/react-native-svg/issues/1332)
- `gesture-handler` [#2748 tap area too large on Android](https://github.com/software-mansion/react-native-gesture-handler/issues/2748)

---

## PP-MUTATE · No live-edit API; everyone re-renders the whole tree

`🔴 Major unsolved pain — Vexel design exists (Session), public API planned`

### Symptom
To change one node's color in an SVG, you replace the whole `source`
prop with a new XML string. The library re-parses everything, rebuilds
the React tree, and re-renders all elements — even though only one path
moved. Real-time visualizations (live stock charts, collaborative
whiteboards, AI-streaming SVGs) become unusable at any nontrivial scale.

### Root cause
- `react-native-svg`'s scene graph IS its React tree. There's no
  separate IR you can patch. Mutating means changing JSX, which means
  re-rendering.
- The maintainer admits in [their own blog](https://swmansion.com/blog/you-might-not-need-react-native-svg-b5c65646d01f):
  "Each element… isn't memoized by default… everything gets redrawn,
  and there's no caching involved."
- Even when you wrap individual paths in `React.memo`, attribute changes
  via `useAnimatedProps` (Reanimated) trigger inconsistent behavior
  ([Reanimated #2618](https://github.com/software-mansion/react-native-reanimated/issues/2618):
  drops to 30-40 fps on Android, 100% CPU).

### Vexel's solution
Vexel maintains a stable in-memory IR (`Graph`) separate from the React
tree. A new top-level `useVexelSession()` hook returns a `Session`
handle:

```tsx
const session = useVexelSession({ viewBox: [0, 0, 800, 600] });

// Append SVG fragment (already shipped for streaming)
session.append('<g id="newNode"><rect .../></g>', {
  strokeDrawMs: 800,
  easing: 'hand-natural',
});

// Patch one attribute on one element — does NOT trigger
// a full re-render. Only #node-42 repaints.
session.patch('node-42', { fill: '#f59e0b' });

// Replace one element's path data
session.replace('edge-3', '<path d="M0,0 L100,100" .../>');

// Remove
session.remove('label-5');

// Subscribe to changes (e.g. for analytics or undo/redo)
session.onChange((mutation) => log(mutation));
```

Under the hood, `patch` updates Reanimated shared values that drive the
target element's RN-SVG props directly — no React tree change. `append`
uses the existing streaming pathway. `remove` deletes from the IR + the
React reconciler removes only that element.

Post-Skia: the same API drives dirty-rect repaints on the UI thread.

### Why this matters at scale
- **AI-driven UIs.** An LLM streams an SVG diagram fragment-by-fragment;
  each fragment patches in without re-parsing the previous ones.
- **Collaborative whiteboards.** Multi-user; each peer's edit is one
  `session.patch` call applied locally.
- **Live data viz.** Stock tickers, sensor dashboards, real-time
  geospatial — all want to update 20 points/second without a full
  re-render.
- **Image annotation tools.** User drops a pin → `session.append` —
  doesn't re-render the 1000 other pins.
- **Undo/redo.** Mutations are first-class events; trivial to record
  and replay.

### Citations
- Software Mansion: ["You Might Not Need react-native-svg"](https://swmansion.com/blog/you-might-not-need-react-native-svg-b5c65646d01f)
- Reanimated [#2618 Path useAnimatedProps perf](https://github.com/software-mansion/react-native-reanimated/issues/2618)
- `react-native-svg` [#908 animate path d](https://github.com/react-native-svg/react-native-svg/issues/908) (open 5+ years)

---

## PP-STREAM · No way to stream-draw an SVG as it arrives

`🟢 Shipped in v0.0.x (streamReveal + hand-natural easing); generalization to mutation API planned`

### Symptom
You want to render an LLM's output the way a teacher would draw it on a
whiteboard — stroke by stroke, in document order, with hand-natural
timing. Or you want to highlight "what just changed" by drawing only
the new strokes. No library does this.

### Root cause
- Path-drawing via `strokeDasharray` / `strokeDashoffset` is well-known
  for static SVGs. But it assumes the *full path is known upfront*.
- Streaming partial SVG fragments and animating them as they arrive
  isn't a documented pattern — the closest art is academic
  ([Decomate arxiv 2511.06297](https://arxiv.org/html/2511.06297v1)) or
  web-only token streamers.

### Vexel's solution
`streamReveal={true}` + `streamElementMs` + `streamPauseMs` +
`streamEasing="hand-natural"` + `streamOrder="document" | "random" |
"topological" | (shapes) => ids`.

The `Session` API (see PP-MUTATE) generalizes this: every appended
fragment is streamed in by default; consumers can override per-call.
The `hand-natural` curve is a piecewise Bézier calibrated to match
real handwriting velocity (calibration data + curve sampler in
`hand_natural.ts`).

### Why this matters at scale
- **AI-tutored learning.** Show how the diagram is constructed, not
  just the final state.
- **Step-through proofs / explanations.** Highlight strokes as the
  voiceover narrates them.
- **Code walkthroughs.** Reveal call-graph edges in the order the
  execution actually visits them.
- **Live coding demos.** Server pushes the SVG fragments matching the
  current keystroke.

### Citations
- Decomate ([arxiv 2511.06297](https://arxiv.org/html/2511.06297v1))
- [FlowToken](https://github.com/Ephibbs/flowtoken) (web-only token stream)

---

## PP-PERF · Performance at 100+ elements degrades

`🔴 Major unsolved pain — Vexel JS-side mitigations planned (next release)`

### Symptom
Render a flowchart with 100 nodes: ~30 fps and feels heavy. Try 500 nodes:
flickering during initial render, navigation to the screen freezes for
5–10 seconds, the JS thread pegs.

### Root cause
- `react-native-svg` does no per-element memoization. Every component
  reconciles every element on every render.
- Native bridges fire one update per element per frame; for 500 elements
  that's 500 cross-bridge calls per animation tick.
- The maintainer recommends migrating to Expo Image (for static SVG) or
  Skia (for animated/interactive) for this case.

### Vexel's solution (pre-Skia, today)
- Wrap `renderShape` output in a memoized `<ShapeRenderer>` that
  short-circuits on a deep-equal of resolved props (incl. CSS,
  override, status, reveal).
- Batch attribute mutations from Reanimated shared values into a single
  `setNativeProps` call per element per frame via
  `useAnimatedProps`.
- Defer offscreen elements via `rendering.viewportCulling` (already in
  the prop API, currently a no-op — wire it up).
- `rendering.interactiveBudget` (already shipped) drops tap handlers
  when element count > N.

Pre-Skia comfort zone target: 500 elements at 60 fps for static, 200
elements at 60 fps for animated.

### Vexel's solution (post-Skia)
Single Skia canvas, no per-element view. Dirty-rect repaint. Each
element's draw-call goes through the Rust core's element handle map —
identity preserved without paying per-element React reconciliation cost.
Target: 5,000 elements at 60 fps.

### Why this matters at scale
- Large flowcharts (the Software-Mansion-cited dependency-graph case).
- Maps with hundreds of regions / pins.
- Schematic diagrams (PCB layouts, circuit diagrams).
- Educational figures with high element counts (anatomy diagrams, family
  trees).

### Citations
- `react-native-svg` [#2660 perf with many SVG images](https://github.com/software-mansion/react-native-svg/issues/2660)
- `react-native-svg` [#2831 5-10s nav freezes after upgrade](https://github.com/software-mansion/react-native-svg/issues/2831)
- Software Mansion: ["You Might Not Need react-native-svg"](https://swmansion.com/blog/you-might-not-need-react-native-svg-b5c65646d01f)

---

## PP-ANIM · No declarative animation timeline / SMIL replacement

`🟡 Reveal + streaming shipped; full timeline primitive planned`

### Symptom
You want to express: "draw stroke A over 800ms, then morph A → B over
400ms, then fade in C, then highlight D pulse 3x." No library has this
declarative shape. You write imperative Reanimated for each step,
managing 7 shared values by hand, and it stops working at the second
state transition.

### Root cause
- SMIL `<animate>` / `<animateTransform>` is *officially unsupported* in
  `react-native-svg` ([#1019], [#121], [#180]) — the "use a WebView"
  workaround is openly recommended.
- Animating Path `d` attribute via Reanimated drops to 30-40 fps on
  Android with 100% CPU ([Reanimated #2618]).
- `useAnimatedProps` + path morphing via Flubber works for one path on
  the JS thread, breaks at scale.

### Vexel's solution
A declarative timeline primitive — `useVexelTimeline()` hook or
`<VexelTimeline>` component:

```tsx
<VexelTimeline
  steps={[
    { at: 0, op: 'draw', id: 'arrow-1', durMs: 800, easing: 'hand-natural' },
    { at: 800, op: 'morph', id: 'arrow-1', toD: '...', durMs: 400 },
    { at: 1200, op: 'fade', id: 'label-3', from: 0, to: 1, durMs: 200 },
    { at: 1400, op: 'pulse', id: 'node-9', scale: 1.1, count: 3 },
  ]}
  onComplete={...}
/>
```

The timeline compiles to Reanimated shared values, one per element
property being animated. The runtime dispatches updates on the UI thread
where Reanimated's worklet system can handle them at 60 fps. For path
morphing (the `d` attribute), pre-Skia Vexel uses Flubber on the JS
thread with explicit warnings about scale; post-Skia, morphs run as
worklets on the UI thread.

Easing presets include `hand-natural` (the streaming curve), plus the
standard `linear`, `ease-out`, `ease-in-out`, cubic-bezier, spring.

### Why this matters at scale
- **Tutorial/onboarding flows** — animate the explanation of any UI or
  diagram.
- **Process visualizations** — "draw the user journey step by step."
- **Data narratives** (à la D3 transitions) — "morph this bar chart
  into a line chart as the time selector advances."
- **Brand animations** — logo strokes / monogram reveals at app launch.

### Citations
- `react-native-svg` [#1019 SMIL request](https://github.com/react-native-svg/react-native-svg/issues/1019)
- Reanimated [#2618 Path useAnimatedProps perf](https://github.com/software-mansion/react-native-reanimated/issues/2618)
- [Flubber](https://github.com/veltman/flubber) (the de-facto path
  morpher, JS-thread only)

---

## PP-FABRIC · New Architecture / Fabric stability

`🔴 Inherited from RN-SVG today — verified compat matrix + CI planned`

### Symptom
You upgrade to RN 0.78 + Hermes + New Architecture; the lecture screen
crashes with `Unsupported top level event type 'topSvgLayout'`. You
upgrade to RN 0.81; the iOS build fails outright. You pin
`react-native-svg@15.4.0` to make it work — months later you can't
upgrade anything in your dep tree.

### Root cause
- `react-native-svg` is a complex native module straddling old + new
  architectures with limited test coverage on the matrix.
- RN's New Architecture rollout introduces breaking changes in the
  native event dispatch path; library maintainers play catch-up.
- No public CI matrix verifies (RN version × Old/New Arch × Hermes/JSC ×
  iOS/Android) combinations — bugs land in releases.

### Vexel's solution (pre-Skia)
Pure-JS layer over `react-native-svg` means Vexel inherits these bugs
until the Skia swap. The mitigations:

1. **Published compatibility matrix.** README documents which
   `react-native-svg` versions work with which RN versions + arch.
2. **Pinned peer-dep ranges.** Vexel's `peerDependencies` constrain
   `react-native-svg >= 15.0.0` (the last fully tested baseline) and
   document known-broken upgrades.
3. **CI matrix.** Build the example app against RN 0.74, 0.75, 0.76,
   0.77, 0.78, 0.79, 0.80, 0.81 — Old Arch + New Arch — Hermes + JSC.
   Badge in README.
4. **Compatibility test SVGs.** The 5 Mermaid fixtures run as snapshot
   tests on every matrix cell; visual diff alerts on render
   regressions.

### Vexel's solution (post-Skia)
Skia + own native bindings via UniFFI — Vexel owns its own native
surface. Fabric/New Arch compatibility becomes Vexel's responsibility,
not an inherited bug.

### Why this matters at scale
Every team building a production RN app upgrades RN at least once a
year. If the SVG library doesn't keep up, the app gets stuck. Public
compat matrix = "I can plan my upgrades around this."

### Citations
- `react-native-svg` [#2825 topSvgLayout crash, Nov 2025](https://github.com/software-mansion/react-native-svg/issues/2825) (open)
- `react-native-svg` [#2744 RN 0.81 incompatibility](https://github.com/software-mansion/react-native-svg/issues/2744)
- `react-native-svg` [#2749 iOS Fabric build fail](https://github.com/software-mansion/react-native-svg/issues/2749)
- `react-native-svg` [#2732 RN 0.80.1 broke icons](https://github.com/software-mansion/react-native-svg/issues/2732)

---

## PP-FIDELITY · Cross-platform render fidelity (iOS ≠ Android)

`🟡 Solved via author workarounds — Vexel build-time normalizer planned`

### Symptom
A SVG looks fine on iOS, has the clip-path inverted on Android. A
Gaussian blur is subtle on iOS, completely absent on Android above
`stdDeviation=15`. A mask that's perfect on iOS is wrong on Android.
Filters cause iOS memory leaks. Designers ship two SVGs.

### Root cause
- `clip-rule="evenodd"` defaults are interpreted differently by the
  Android backend ([#1409](https://github.com/software-mansion/react-native-svg/issues/1409)).
- `feGaussianBlur` is rendered via different native primitives; Android
  caps the effective radius.
- Mask rendering doesn't honor `mask-type="luminance"` correctly on
  Android ([#2202](https://github.com/software-mansion/react-native-svg/issues/2202)).
- Filter pipeline introduced memory leak on iOS 15.4+ ([#2687](https://github.com/software-mansion/react-native-svg/issues/2687)).

### Vexel's solution
At parse time (in `buildGraph`), Vexel touches every node — that's the
natural place to normalize:

1. **Auto-inject `clip-rule="evenodd"` on `<clipPath>` children** that
   don't specify, matching the iOS default.
2. **Warn for known-broken filters** (Gaussian blur with stdDev > 15,
   complex filter graphs) via `onWarning` callback.
3. **Optional rasterization fallback** for filter-heavy elements: the
   `vexel convert` CLI can rasterize a sub-tree to a PNG and replace it
   with an `<image>` reference, guaranteeing parity.
4. **Embed font glyph outlines** via the converter, so custom-font text
   renders identically without depending on RN's font registry.

### Why this matters at scale
- Marketing/illustration teams that draw once in Figma/Illustrator and
  expect parity.
- Brand-critical UI (logos, mascots) where iOS and Android diverging is
  a bug report.
- Apps with global design teams where the design source of truth is the
  designer's Figma, not platform-specific exports.

### Citations
- `react-native-svg` [#1409 ClipPath broken on Android](https://github.com/software-mansion/react-native-svg/issues/1409)
- `react-native-svg` [#2636 feGaussianBlur divergence](https://github.com/software-mansion/react-native-svg/issues/2636)
- `react-native-svg` [#2202 Mask incorrect on Android](https://github.com/software-mansion/react-native-svg/issues/2202)
- `react-native-svg` [#2687 filter memory leak iOS](https://github.com/software-mansion/react-native-svg/issues/2687)

---

## PP-DX · Developer experience — no SVG inspector, weak debugging

`🟡 Workarounds exist — Vexel dev overlay planned`

### Symptom
"Why is this gray box clickable?" You can't tell. React DevTools shows
the React tree, not the painted SVG. You spend an hour wrapping every
`<G>` in a `border` style to figure out which one the tap fires.

Stack traces from `react-native-svg` errors are unhelpful. Snapshot
tests with `jest-snapshot` are flaky on CI due to font-fallback
differences. TypeScript types omit half the SVG-2 props.

### Root cause
- No SVG-aware inspector exists; RN DevTools wasn't designed for
  immediate-mode-ish trees.
- Snapshot serialization writes raw RN-SVG props; cross-platform fonts
  resolve to different families, breaking the snapshot.
- Error messages from RN-SVG's native bridge don't include element id
  or path context.

### Vexel's solution
1. **`<VexelView debug />`.** Overlay shows: element IDs, painted-area
   bbox outlines, hit-region polygons (the actual tap area, not the
   bbox), and a hover/tap inspector that displays the element's
   resolved CSS + ancestor chain.
2. **`vexel inspect <file.vex>` CLI.** Lists every element, its bbox,
   classes, resolved cascade. Already exists for `.vex` — bring it to
   live SVG too.
3. **Snapshot via `.vex` binary diff.** The deterministic, font-agnostic
   binary format diffs reliably across platforms.
4. **Structured error messages.** Every `VexelError` includes
   `{ kind, elementId, message, source }` — no more "something went
   wrong."
5. **Complete TypeScript types** for every SVG-2 prop the runtime
   accepts.

### Why this matters at scale
- Onboarding new engineers — they can see the SVG structure
  immediately.
- QA debugging — visually confirm "the tap area covers what I expect."
- CI reliability — snapshots that don't depend on the test machine's
  font cache.

### Citations
- `react-native-svg` [#1741 'Svg' cannot be used as a JSX component](https://github.com/software-mansion/react-native-svg/issues/1741)
- Custom font setup chaos: [#189](https://github.com/software-mansion/react-native-svg/issues/189), [#122](https://github.com/software-mansion/react-native-svg/issues/122), [#1623](https://github.com/software-mansion/react-native-svg/issues/1623)

---

## PP-A11Y · Per-element accessibility + reduce-motion

`🟡 Cheap fix — planned (~2 days)`

### Symptom
Screen-reader users on VoiceOver / TalkBack can't navigate the SVG.
The root `<Svg>` has one `accessibilityLabel`; individual nodes /
regions / interactive elements don't. Reduce-motion users see the same
stream-by-stroke reveal as everyone else.

### Root cause
- `react-native-svg` exposes `accessible` / `accessibilityLabel` only at
  the root.
- No bridge between Reanimated's `ReduceMotion.System` and SVG
  animation libraries — each rolls their own (or doesn't).

### Vexel's solution
```tsx
<VexelView
  source={svg}
  accessibility={{
    resolveLabel: (id, shape) =>
      `${shape.kind} ${id}, ${shape.classes?.join(' ') ?? ''}`,
    focusOrder: 'document', // | 'topological' | (graph) => string[]
    rolesByKind: { node: 'button', edge: 'image', note: 'text' },
  }}
  respectReducedMotion // already shipped — wire to streaming/timeline
/>
```

Each addressable element gets its own `accessibilityLabel` + `Role` on
the rendered `<G>`. Reduce-motion auto-detected via `AccessibilityInfo`
disables streaming + timeline (already implemented for streaming;
extend to timeline).

### Why this matters at scale
- Education apps (regulatory: WCAG / ADA / Section 508).
- Government / public-sector RN apps (legal requirement in many
  jurisdictions).
- Enterprise procurement — a11y is increasingly a checklist line item.

### Citations
- `react-native-svg`: no per-shape a11y API documented.
- `expo` [#1959 font @font-face ignored](https://github.com/expo/expo/issues/1959) (related — fonts surface a11y issues too)

---

## PP-PRESETS · Out-of-the-box diagram components

`⚪ Planned — wraps everything above into one-line components`

### Symptom
Even after Vexel solves the rendering, a consumer still has to:
1. Run Mermaid in a WebView (boilerplate)
2. Wire `MermaidToSvg` → `VexelView`
3. Configure highlights, streaming, themes themselves
4. Re-do this for each app

### Root cause
Vexel is currently a primitive — `<VexelView source={svg} />` —
delegating diagram generation to the consumer.

### Vexel's solution
A `@pixelpath/vexel-presets` package shipping turnkey components:

- `<VexelMermaid source="graph TD; A-->B" />` — bundles the WebView
  Mermaid renderer; consumer doesn't write any HTML.
- `<VexelFlowchart nodes={...} edges={...} />` — typed Node/Edge data
  in, rendered diagram out.
- `<VexelOrgChart hierarchy={...} />` — tree-shape data, rendered with
  Reingold–Tilford layout.
- `<VexelSequence interactions={...} />` — typed sequence-diagram data.

Each builds the underlying SVG via D3 / ELK / Dagre depending on
diagram type, then drops into `<VexelView>` with sensible defaults.

### Why this matters at scale
Most consumers don't want the primitives — they want "I have this data,
draw a flowchart." Presets close the demo-to-production gap.

---

## Tier-3 — out of scope

These are real pain points but Vexel won't chase them:

- **GPU-heavy drawing apps / signature pads** — Skia owns this
  (`drawing-board`, `react-native-skia-draw`, Notesnook). Vexel uses
  Skia in v1.0 under the hood, but doesn't position against it for
  drawing canvases.
- **5,000-point real-time charts** — Skia + Reanimated (victory-native
  v40, react-native-graph, wagmi-charts). Vexel is for *identity*-bearing
  diagrams, not anonymous data points.
- **HTML-in-SVG via `<foreignObject>`** — Web-only spec, niche on
  mobile. Mermaid 10.9 + `htmlLabels:false` is the documented
  workaround.
- **SMIL-as-literally-SMIL** — declarative `<animate>` elements. Vexel
  exposes a timeline primitive instead; consumers describing animation
  in JS get a better DX than authoring SMIL.

---

## Priority order (next 3 releases)

| Release | Adds | Why |
|---|---|---|
| **v0.1.0** | PP-HITTEST (painted-area + simultaneousHandlers) | Highest leverage; nothing else does this. |
| **v0.2.0** | PP-MUTATE (Session.patch/append/remove) | The mutable-SVG moat. AI-streamer use cases need this. |
| **v0.3.0** | PP-ANIM (timeline primitive) + PP-PERF (memoization) | Pre-Skia perf ceiling raised; "the SMIL React Native never got." |
| **v0.4.0** | PP-FABRIC matrix + CI badges + PP-DX dev overlay | Production-ready credibility. |
| **v0.5.0** | PP-PRESETS (`@pixelpath/vexel-presets`) + PP-A11Y | The "just drop it in" experience. |
| **v1.0.0** | Skia swap (post-mutate, post-timeline) | Pixel parity + 5k-element ceiling. |

---

## Citations of "we verified what people actually struggle with"

Every claim in this document traces to a concrete issue, blog post, or
discussion. The full link set lives at the bottom of each PP. We update
this list as the ecosystem moves — if RN-SVG ships SMIL tomorrow, the
PP-ANIM entry says so and we re-prioritize.

This document is *the* source of truth for "what is Vexel for, what
problem does it solve, and what's the design rationale." If you find a
pain point not listed — open an issue, link the evidence, and we'll RCA
it before deciding what to do.
