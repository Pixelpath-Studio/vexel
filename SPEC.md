# Trace — Final Specification and Technical Architecture (v1.0)

**An open-source vector graphics format and rendering runtime for mobile.**

Trace is a binary file format (`.trace`) and a cross-platform plugin that renders it natively on iOS and Android with pixel-identical output, powered by Skia. It is designed to replace SVG as the *rendering* format for mobile apps — for static illustrations, pre-generated diagrams (Mermaid, org charts), and AI-authored, progressively-drawn content (like a teacher writing on a whiteboard).

You install one npm package. You convert any SVG to `.trace` (at build time or at runtime). You drop a `<TraceView>` component into your app. It renders fast, identically on both platforms, with per-element interactivity. That's the entire product surface.

```
                  ┌──────────────────────────────────────────┐
                  │  Your app (React Native, iOS, Android)   │
                  └──────────────────────────────────────────┘
                                     │
                                     ▼
                  ┌──────────────────────────────────────────┐
                  │  @trace/runtime (npm)                    │
                  │  - <TraceView /> React Native component  │
                  │  - convert(svg) at build & runtime       │
                  │  - streaming Session API                 │
                  │  - peer dep: @shopify/react-native-skia  │
                  └──────────────────────────────────────────┘
                                     │
                  ┌──────────────────┴──────────────────────┐
                  │                                          │
                  ▼                                          ▼
         ┌──────────────────┐                    ┌──────────────────────┐
         │  Trace.framework │                    │  trace-android.aar   │
         │  (Swift + Rust)  │                    │  (Kotlin + Rust)     │
         │  draws via Skia  │                    │  draws via Skia      │
         │  (Metal backend) │                    │  (Vulkan/GL backend) │
         └─────────┬────────┘                    └──────────┬───────────┘
                   │                                        │
                   └──────────────┬─────────────────────────┘
                                  │
                                  ▼
                       ┌─────────────────────┐
                       │  trace-core (Rust)  │
                       │  parse · convert ·  │
                       │  serialize · query  │
                       │  hit-test (Rust)    │
                       └─────────────────────┘
```

**License:** Apache 2.0 · **Working name:** Trace · **File extension:** `.trace` · **MIME:** `application/vnd.trace+binary` · **Reference consumer:** Curo

---

## Implementation notes for Claude Code (read first)

**Identity preservation requirement (critical).** The runtime must maintain a one-to-one mapping from element index (in GEOM order) to a drawable handle, such that any element can be independently re-styled, animated, or highlighted at any time. SkPicture caching is permitted **only** for elements with `flags.is_decorative == true`; all other elements must be drawn via individual `canvas.drawPath` calls with their own paint state. Hit-testing routes through `trace_core::hit_test` (Rust); the platform runtime never queries Skia for hit-testing because Skia has no concept of element identity.

**Three identity invariants that must hold across the entire codebase:**

1. The Rust core is the single source of truth for scene structure and hit-testing.
2. Each addressable element gets its own `canvas.drawPath` call, not batched into an opaque SkPicture.
3. The identity-to-handle map lives in the platform/RN layer, not in Skia's internals.

**Sequencing.** Build in the order: Rust core scaffolding → conversion path → hit-test acceleration → iOS runtime → Android runtime → streaming/animation → npm package → CLI/docs/release. Each phase depends on the previous; none requires unfinished work from a later phase.

**On unresolved design questions encountered during implementation.** Three areas in this spec are sketched rather than fully specified: Mermaid id normalization rules across all diagram types, text rendering fallback strategy when system fonts are missing, and the `hand-natural` easing curve calibration. These should be addressed during implementation by (a) cataloging actual Mermaid output across diagram types in week 3, (b) defining a font fallback chain in week 4, and (c) calibrating the easing curve against recorded handwriting data in week 11. Use sensible defaults and leave TODOs where decisions are pending.

**Memory and DoS hardening.** Enforce explicit limits in `Session`: max 65,536 elements, max 16 MB total geometry data, max 10,000 pending animation tracks. Reject inputs that exceed these.

**Stroked dashed path hit-testing.** For v1, treat paths with `stroke-dasharray` as continuous strokes for hit-testing purposes (a tap anywhere along the path's centerline within `stroke_width/2 + tol` is a hit, regardless of dash gaps). This deviates from SVG spec but is the natural mobile behavior and avoids edge cases.

**Animation state pattern (Skia-specific).** With `react-native-skia`, animation hot-paths run in Reanimated worklets on the UI thread. The identity-to-handle map lives on the JS thread; animation state is stored in per-element shared values that worklets read/write directly. Worklets never need to know about ids. Use `useDerivedValue` so only the affected element's paint recomputes on style changes — never re-render the whole canvas tree.

---

## Table of contents

1. [Project shape and distribution](#1-project-shape-and-distribution)
2. [What developers see on day one](#2-what-developers-see-on-day-one)
3. [The `.trace` binary format](#3-the-trace-binary-format)
4. [The Rust core (`trace-core`)](#4-the-rust-core-trace-core)
5. [The iOS runtime](#5-the-ios-runtime)
6. [The Android runtime](#6-the-android-runtime)
7. [The npm package (`@trace/runtime`)](#7-the-npm-package-tracenuntime)
8. [The streaming protocol](#8-the-streaming-protocol)
9. [The drawing-motion model](#9-the-drawing-motion-model)
10. [CLI (`@trace/cli`)](#10-cli-tracecli)
11. [Conformance test suite](#11-conformance-test-suite)
12. [Repository layout](#12-repository-layout)
13. [Build and release process](#13-build-and-release-process)
14. [12-week implementation plan](#14-12-week-implementation-plan)
15. [Minimum viable demo (week 12 success criterion)](#15-minimum-viable-demo-week-12-success-criterion)
16. [Open questions and explicit deferrals](#16-open-questions-and-explicit-deferrals)

---

## 1. Project shape and distribution

Trace is structured as **one organization, four published artifacts**, with one open Rust monorepo behind them.

| Artifact | Distribution | Audience |
|---|---|---|
| `@trace/runtime` | npm (peer dep: `@shopify/react-native-skia`) | React Native developers (primary) |
| `@trace/cli` | npm (`npx @trace/cli ...`) | Build pipelines, anyone with an SVG to convert |
| `Trace.framework` | SwiftPM + CocoaPods (depends on Skia.framework via RN-Skia's distribution) | Native iOS developers (no React Native) |
| `co.trace:trace-android` | Maven Central (depends on Skia .so via RN-Skia's distribution) | Native Android developers (no React Native) |

The Rust core (`trace-core`) is the engine behind all of them. Open-source, but never the user-facing artifact.

**Why a new format, not "yet another SVG library":** the format is the moat. A library that renders SVG faster is a temporary win. A format with a reference runtime is permanent infrastructure — it survives runtime changes, attracts contributors, and creates an ecosystem.

**Why Skia as the rendering backend:** the entire promise of this project is cross-platform consistency. Skia (the engine that powers Chrome, Flutter, and Android) is the only choice that guarantees pixel identity on iOS and Android. The binary size cost (~8-10 MB per ABI, dominated by Skia itself) is acceptable for a graphics library that delivers this guarantee. A future v2 may add a tree-shaken minimal renderer for binary-sensitive apps.

**Why open-source under Apache 2.0:** formats survive on ecosystems. Apache 2.0 provides explicit patent grant (MIT doesn't) and doesn't scare commercial adopters (GPL does). It's the standard for serious open infrastructure: React Native, Rust, Kotlin, Swift, Flutter, Skia.

---

## 2. What developers see on day one

```bash
npm install @trace/runtime @shopify/react-native-skia
cd ios && pod install
```

The npm postinstall fetches the prebuilt Rust core for iOS (XCFramework) and Android (AAR). Skia binaries come from `react-native-skia` (already required as a peer dep). No Rust toolchain required on the user's machine.

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

---

## 3. The `.trace` binary format

### 3.1 Design principles

1. Binary, little-endian, 4-byte aligned. JSON never on a hot path. `.trace` is `mmap`-readable.
2. Forward-compatible via section table; unknown sections skippable.
3. Identity-preserving: every element with an id is reachable in O(log n).
4. Streamable: same format works for incremental sessions and complete files.
5. No built-in compression — transport (HTTP gzip/brotli) handles it.

### 3.2 File layout

```
┌──────────────────────────────────────────────────────────────┐
│ HEADER (32 B, fixed)                                         │
│   magic            "TRCE"          4 B                       │
│   major            u16             2 B  (v1 = 1)             │
│   minor            u16             2 B  (v1 = 0)             │
│   flags            u32             4 B                       │
│   viewbox          f32×4          16 B  (x, y, w, h)         │
│   section_count    u32             4 B                       │
├──────────────────────────────────────────────────────────────┤
│ SECTION TABLE (section_count × 16 B)                         │
│   kind    [4]u8   "GEOM"|"IDIX"|"HITX"|"STRS"|"ANIM"|"META"  │
│   offset  u32     absolute from file start                   │
│   size    u32                                                │
│   version u32     u16 major + u16 minor                      │
├──────────────────────────────────────────────────────────────┤
│ SECTION PAYLOADS, packed, 4-byte aligned                     │
├──────────────────────────────────────────────────────────────┤
│ FOOTER (16 B, fixed)                                         │
│   body_crc32       u32                                       │
│   total_size       u32                                       │
│   magic_end        "trc!"          4 B                       │
│   reserved         u32                                       │
└──────────────────────────────────────────────────────────────┘
```

Unknown section `kind` codes **must** be ignored by the runtime using `offset+size` to skip. This is the v1 → vN forward-compat mechanism.

### 3.3 Header flags

| Bit | Name | Meaning |
|---|---|---|
| 0 | `HAS_HIT_TEST` | HITX section present |
| 1 | `HAS_ANIMATION` | ANIM section present |
| 2 | `IS_STREAMING_SNAPSHOT` | snapshot of an in-progress session |
| 3 | `TEXT_AS_PATHS` | text was converted to outline paths |
| 4 | `TEXT_AS_RUNS` | text runs preserved (requires platform text renderer) |
| 5–31 | reserved | must be 0 |

### 3.4 `GEOM` — geometry section (required)

```
element_count: u32
elements:      element_count × Element

Element {
    bbox_min:        f32×2
    bbox_max:        f32×2
    fill_rgba:       u32     // 0x00000000 = no fill
    stroke_rgba:     u32     // 0x00000000 = no stroke
    stroke_width:    f32
    flags:           u8
        bit 0: fill rule  (0=nonzero, 1=evenodd)
        bit 1: pointer-events visiblePainted
        bit 2: pointer-events visibleStroke
        bit 3: pointer-events visibleFill
        bit 4: is decorative (can be batched into SkPicture)
        bit 5: stroke linecap round (else butt)
        bit 6: stroke linejoin round (else miter)
        bit 7: reserved
    text_run_idx:    u8       // 0xFF if not text; else index into text runs
    layer_hint:      u16      // 0 = no preference; else hint for layer batching
    verb_count:      u32
    point_count:     u32
    verbs:           verb_count × u8     // 1=M, 2=L, 3=Q, 4=C, 5=Z
    _verb_padding:   align to 4 bytes
    points:          point_count × (f32 x, f32 y)
}
```

- All paths use absolute coordinates in viewBox units.
- Arcs (`A`) are flattened to cubics by the converter.
- Transforms are pre-baked into points.
- Colors are sRGB, straight (not premultiplied) RGBA.
- `bbox` is the visual bounding box including stroke half-width.

### 3.5 Supported SVG subset (v1)

**Supported elements:** `<svg>`, `<g>`, `<path>`, `<rect>`, `<circle>`, `<ellipse>`, `<line>`, `<polyline>`, `<polygon>`, `<text>` + `<tspan>`, `<defs>`, `<linearGradient>` (flattened to a representative solid in v1), `<marker>` (baked into stroke geometry at convert time).

**Supported attributes:** `id`, `class` (parsed and preserved, not rendered), `transform`, `viewBox`, `preserveAspectRatio`, `fill`, `fill-rule`, `fill-opacity`, `stroke`, `stroke-width`, `stroke-opacity`, `stroke-linecap`, `stroke-linejoin`, `stroke-dasharray`, `stroke-dashoffset`, `opacity`, `visibility`, `pointer-events`, `d`, `cx`, `cy`, `r`, `rx`, `ry`, `x`, `y`, `width`, `height`, `points`, `marker-end`, `marker-start`, `marker-mid`.

**Explicitly NOT supported in v1:**

- `<filter>` (all filter primitives) — v1.2
- `<pattern>` — v1.2
- `<radialGradient>` — v1.1 (treated as solid in v1)
- `<mask>` (except trivial rect masks) — v1.2
- `<clipPath>` for non-rectangular clips — v1.1
- `<foreignObject>` (Mermaid must be configured with `htmlLabels: false`) — v1.2
- SMIL animations — superseded by ANIM section
- `<use>` / `<symbol>` — resolved at convert time
- CSS animations — caller must use ANIM
- `<image>` (embedded raster) — v1.1

**On unsupported features:** the converter never errors. It warns into META and renders nothing for unrecognized elements. This is essential for resilience with AI-generated SVG.

### 3.6 `IDIX` — identity index (Tier 1)

```
entry_count: u32
entries:     entry_count × {
    id_offset:     u32     // byte offset into STRS
    element_index: u32     // index into GEOM elements
}                          // sorted ASCII-lexically by id
```

Lookup by id is binary search: O(log n). For Mermaid-generated content, the converter inserts both the raw id (`flowchart-A-1`) and the normalized form (`A`) as entries pointing to the same element.

### 3.7 `HITX` — hit-test acceleration (Tier 2)

```
rtree_node_count: u32
rtree_leaf_count: u32
polyline_count:   u32

// Flat STR-packed R-tree, fanout 16
rtree_nodes: rtree_node_count × {
    aabb:        f32×4
    first_child: u32   // index into rtree_nodes (internal) or leaf_payload (leaf)
    child_count: u16
    is_leaf:     u16
}
leaf_payload: rtree_leaf_count × u32   // each = element_index

// Per-element flattened polylines
polylines: polyline_count × {
    element_index: u32
    quant_scale:   f32
    base_x:        f32
    base_y:        f32
    vertex_count:  u32
    deltas:        vertex_count × (i16 dx, i16 dy)
    is_closed:     u8
    _pad:          3 B
}
```

**Hit-test algorithm:**

```
fn hit_test(file, x, y, mode):
    candidates = rtree_query(file.hitx, point(x, y))   # &[element_index]
    for element_idx in candidates.iter().rev():        # reverse = z-order top-down
        el = file.geom.element(element_idx)
        if not mode.matches(el.flags): continue
        pl = file.hitx.polyline_for(element_idx)
        if el.fill_rgba != 0 and point_in_polygon(pl, x, y):
            return file.idix.id_of(element_idx)
        if el.stroke_rgba != 0 and distance_to_polyline(pl, x, y) < el.stroke_width / 2 + tol:
            return file.idix.id_of(element_idx)
    return None
```

Max elements per file: **65,536**. Beyond that, files must be split.

### 3.8 `STRS` — string blob

Packed UTF-8 NUL-terminated strings. All ids, classes, font-family names, text content, and META values live here. Referenced by byte offset.

### 3.9 `ANIM` — animation tracks (required for streaming or animated batch)

```
track_count: u32
tracks:      track_count × Track

Track {
    element_index: u32
    type:          u8
        1 = stroke_draw   (animate strokeEnd 0→1 along path)
        2 = fill_fade     (animate fill opacity 0→target)
        3 = appear        (instant appear at start_ms)
        4 = opacity_to    (animate opacity to payload value)
        5 = transform_to  (animate transform; payload = 6×f32 affine)
        6 = remove        (animate out, then remove)
    start_ms:      u32     // ms from session start (streaming) or render start (batch)
    duration_ms:   u32
    easing:        u8      // 0=linear, 1=ease-out, 2=ease-in-out, 3=hand-natural
    payload_len:   u16
    payload:       payload_len bytes (type-specific)
}
```

Tracks are sorted by `start_ms`.

### 3.10 `META` — metadata (optional)

Flat key-value store of (`key_offset`, `value_offset`) into STRS. Standard keys:

- `title`, `description`, `aria-label`
- `unsupported`: comma-separated list of features encountered
- `source-hash`: SHA-256 of input SVG (for cache keys)
- `generator`: e.g. `"mermaid-11.4.0"`, `"curo-ai-v0.3"`
- `viewbox-content-bbox`: tight bbox of actual content (vs declared viewBox)

---

## 4. The Rust core (`trace-core`)

The Rust core does **everything algorithmic**: parsing SVG, normalizing, baking transforms, flattening to polylines, building the R-tree, serializing to `.trace`, providing the query API, managing streaming sessions. It contains **no platform graphics code**. It does not depend on Skia, CoreGraphics, or Canvas. Platforms only handle drawing.

### 4.1 Crate layout

```
trace-core/
├── Cargo.toml
├── src/
│   ├── lib.rs                     # public API, re-exports
│   ├── format/
│   │   ├── mod.rs
│   │   ├── header.rs              # header, section table, footer
│   │   ├── geom.rs                # GEOM read/write
│   │   ├── idix.rs                # IDIX read/write
│   │   ├── hitx.rs                # HITX read/write
│   │   ├── strs.rs                # STRS read/write
│   │   ├── anim.rs                # ANIM read/write
│   │   ├── meta.rs                # META read/write
│   │   └── reader.rs              # zero-copy reader over &[u8]
│   ├── ir/
│   │   ├── mod.rs                 # in-memory IR (used by streaming)
│   │   ├── element.rs
│   │   ├── path.rs
│   │   └── bbox.rs
│   ├── convert/
│   │   ├── mod.rs                 # SVG → IR
│   │   ├── path_baking.rs         # transform baking, arc-to-cubic
│   │   ├── text.rs                # text → outline paths
│   │   ├── marker.rs              # bake arrowheads into paths
│   │   ├── color.rs               # resolve currentColor, gradients
│   │   └── id_extract.rs          # Mermaid-aware id normalization
│   ├── serialize/
│   │   └── writer.rs              # IR → .trace bytes
│   ├── hit/
│   │   ├── rtree.rs               # STR-packed R-tree build + query
│   │   ├── polyline.rs            # path flattening
│   │   ├── point_in_poly.rs
│   │   └── distance.rs
│   ├── session/
│   │   ├── mod.rs                 # streaming session
│   │   ├── fragment.rs            # append, edit, remove
│   │   └── delta.rs               # incremental snapshot/delta
│   ├── api/
│   │   ├── mod.rs                 # UniFFI surface
│   │   └── api.udl                # UniFFI interface definition
│   └── error.rs
├── benches/
│   ├── parse_500_node_mermaid.rs
│   ├── hit_test_500_node.rs
│   └── stream_100_fragments.rs
├── tests/
│   ├── conversion/
│   ├── hit/
│   └── streaming/
└── fixtures/
    ├── mermaid/                   # representative Mermaid outputs
    ├── illustrations/             # designer-style SVGs
    └── adversarial/               # malformed, deeply nested, huge
```

### 4.2 Dependencies (pinned)

```toml
[dependencies]
usvg          = "0.45"   # SVG parsing and normalization
tiny-skia-path = "0.11"  # path structures, flattening (no rasterizer)
uniffi        = "0.28"   # language bindings
byteorder     = "1.5"    # LE serialization
crc32fast     = "1.4"    # footer CRC
thiserror     = "1"      # error types

[build-dependencies]
uniffi        = { version = "0.28", features = ["build"] }
```

Notably absent: `tiny-skia` (no rasterizer needed — Skia handles rasterization on the platform side), `serde`/`serde_json` (own format), `tokio` (sync API).

### 4.3 Public API (Rust, mirrors UniFFI surface)

```rust
// Conversion
pub fn convert_svg_to_trace(svg: &str, options: ConvertOptions) -> Result<Vec<u8>, TraceError>;

// Batch query
pub struct TraceFile<'a> { /* zero-copy view over &[u8] */ }

impl<'a> TraceFile<'a> {
    pub fn parse(bytes: &'a [u8]) -> Result<Self, TraceError>;
    pub fn viewbox(&self) -> ViewBox;
    pub fn element_count(&self) -> u32;
    pub fn ids(&self) -> impl Iterator<Item = &str>;
    pub fn element_by_id(&self, id: &str) -> Option<ElementView<'a>>;
    pub fn element_at_index(&self, idx: u32) -> Option<ElementView<'a>>;
    pub fn hit_test(&self, x: f32, y: f32, mode: HitMode) -> Option<&str>;
    pub fn bbox_of(&self, id: &str) -> Option<Rect>;
    pub fn animation_tracks(&self) -> impl Iterator<Item = AnimTrackView<'a>>;
    pub fn metadata(&self, key: &str) -> Option<&str>;
}

// ElementView is a borrowed projection of one element
pub struct ElementView<'a> {
    pub id: &'a str,
    pub bbox: Rect,
    pub fill: Rgba,
    pub stroke: Rgba,
    pub stroke_width: f32,
    pub flags: ElementFlags,
    pub verbs: &'a [u8],
    pub points: &'a [Point],
}

// Streaming
pub struct Session { /* mutable, builds IR incrementally */ }

impl Session {
    pub fn new(viewbox: ViewBox) -> Self;
    pub fn append_svg_fragment(
        &mut self,
        svg: &str,
        anim: Option<FragmentAnim>,
    ) -> Result<Vec<String>, TraceError>;
    pub fn remove_element(&mut self, id: &str) -> bool;
    pub fn update_element(&mut self, id: &str, patch: ElementPatch) -> bool;
    pub fn snapshot(&self) -> Vec<u8>;          // complete .trace
    pub fn delta_since(&self, version: u64) -> Vec<u8>;  // incremental bytes
    pub fn version(&self) -> u64;
}

pub struct FragmentAnim {
    pub stroke_draw_ms: Option<u32>,
    pub fill_fade_ms: Option<u32>,
    pub start_after: StartAfter,    // Immediately | PreviousFragment | AtMs(u32)
    pub easing: Easing,
}

pub enum HitMode { VisiblePainted, VisibleStroke, VisibleFill, All, BoundingBox }
```

### 4.4 Conversion pipeline

```
SVG string
  ├─> usvg::Tree::from_str(svg, &usvg_options)
  └─> walk_tree(tree.root, &mut ir, &mut id_map)
       ├─> path_baking::bake_transforms(node)
       ├─> path_baking::flatten_arcs_to_cubics(path)
       ├─> color::resolve(fill, stroke, gradients)
       ├─> text::convert_to_outlines(text_node, font_db)
       ├─> marker::bake_into_path(path, markers)
       ├─> id_extract::normalize_id(node.id)   # Mermaid-aware
       └─> ir.push_element(element)
```

`usvg` is configured with:

- A pre-loaded `font_db` (system fonts on iOS via CoreText, Android via Typeface; geometric placeholders in unit tests)
- `text_rendering: OptimizeLegibility`
- `image_href_resolver: reject` (no embedded images in v1)
- Hard caps: 1,000,000 elements, 1024 nesting depth (DoS hardening)

`id_extract::normalize_id` recognizes Mermaid id patterns:

- `flowchart-A-1` → emits both `flowchart-A-1` and `A` as IDIX entries → same element_index
- `L_A_B_0` → emits both `L_A_B_0` and `A->B`
- Standard CSS selectors are unchanged

**Note for implementation:** the full enumeration of Mermaid id patterns across all diagram types (sequence, class, state, ER, gantt, pie, mindmap) is to be derived empirically in week 3 by running the converter against fixtures from each Mermaid diagram type and adjusting the normalizer accordingly.

### 4.5 The streaming session

`Session` holds:

- `ir: Ir` (mutable)
- `id_index: HashMap<String, u32>` (mirror for O(1) writes)
- `pending_anim: Vec<AnimTrack>` (sorted on snapshot)
- `version: u64` (monotonic)
- Enforced limits: max 65,536 elements, max 16 MB total geometry, max 10,000 pending anim tracks

`append_svg_fragment`:

1. Parse fragment via `usvg::Tree::from_str("<svg ...>" + fragment + "</svg>")`.
2. Walk new elements, assign synthetic ids where missing (`__frag_<version>_<n>`).
3. Append to `ir.elements`, update `id_index`.
4. Push `AnimTrack`s based on `FragmentAnim`.
5. Bump `version`. Return new ids.
6. Reject if any session limit would be exceeded.

`snapshot` produces a complete `.trace` (with `IS_STREAMING_SNAPSHOT` set). `delta_since(v)` produces a minimal delta with only elements added/changed since `v`. The platform layer applies the delta by appending GEOM entries, merging IDIX, and scheduling new animations.

### 4.6 Error handling

```rust
#[derive(thiserror::Error, Debug)]
pub enum TraceError {
    #[error("SVG parse error: {0}")]
    SvgParse(String),
    #[error("malformed .trace file: {0}")]
    InvalidFile(&'static str),
    #[error("unsupported version: {major}.{minor}")]
    UnsupportedVersion { major: u16, minor: u16 },
    #[error("element id not found: {0}")]
    UnknownId(String),
    #[error("session limit exceeded: {0}")]
    LimitExceeded(&'static str),
    #[error("internal invariant violated: {0}")]
    Internal(&'static str),
}
```

Conversion **never** errors on unsupported SVG features. It warns into META and renders nothing for unrecognized elements. Hard errors are reserved for truly malformed input.

---

## 5. The iOS runtime

### 5.1 Package structure

```
trace-ios/
├── Package.swift                # SwiftPM
├── Trace.podspec                # CocoaPods
├── Sources/Trace/
│   ├── Trace.swift              # umbrella
│   ├── TraceFile.swift          # wraps Rust TraceFile via UniFFI
│   ├── TraceSession.swift       # wraps Rust Session
│   ├── TraceView.swift          # UIView subclass, hosts a Skia surface
│   ├── TraceRenderer.swift      # element-index → SkPath/Paint map; draws to canvas
│   ├── HitTest.swift            # UITouch → Rust hit_test
│   ├── Animator.swift           # CADisplayLink-driven anim state
│   └── PathConvert.swift        # verb-stream → SkPath
└── TraceCore.xcframework        # Rust .a bundled via uniffi-bindgen-swift
```

### 5.2 The `TraceView` API

```swift
public final class TraceView: UIView {
    public enum Source {
        case file(URL)
        case data(Data)
        case session(TraceSession)
    }

    public var source: Source { didSet { reload() } }
    public weak var delegate: TraceViewDelegate?

    public var highlightedIds: Set<String> = [] { didSet { applyHighlight() } }
    public var highlightColor: UIColor = .systemOrange
    public var highlightStrokeBoost: CGFloat = 1.5
}

public protocol TraceViewDelegate: AnyObject {
    func traceView(_ view: TraceView, didTap elementId: String, at point: CGPoint)
    func traceView(_ view: TraceView, didFinishAnimation forElementId: String?)
}
```

### 5.3 Rendering model

The `TraceView` hosts a Skia drawing surface (provided by the Skia framework that `react-native-skia` distributes, or by linking Skia directly for the standalone iOS framework). The rendering loop:

1. On load: parse the `.trace` file via Rust. For each element in GEOM, build an `SkPath` from the verb stream and store it in a map `Map<element_index, ElementHandle>`, where `ElementHandle` holds the SkPath, the current Paint, and per-element animation state.
2. On each frame: walk elements in document order, calling `canvas.drawPath(handle.path, handle.paint)`. Decorative elements (`flags.is_decorative == true`) may be grouped into a cached `SkPicture` and drawn via `canvas.drawPicture` for performance — but interactive elements are **always** drawn individually.
3. Animation state is per-element. The animator updates `strokeProgress`, `fillOpacity`, etc., on each handle, then triggers redraw.
4. Highlights are drawn as overlay strokes/fills on top of the base draw call for the highlighted element — no need to rebuild the SkPath.

**Why Skia per-element instead of one SkPicture for the whole document:** identity. Each addressable element must be independently re-styleable. SkPicture is opaque after recording; you can't change one element's color without re-recording.

### 5.4 Hit-testing

Override `touchesEnded` to consult `traceFile.hitTest`:

```swift
public override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) {
    guard let touch = touches.first else { return }
    let viewPt = touch.location(in: self)
    let vbPt = viewboxPoint(from: viewPt)
    if let id = traceFile.hitTest(x: vbPt.x, y: vbPt.y, mode: .visiblePainted) {
        delegate?.traceView(self, didTap: id, at: viewPt)
    }
}
```

Hit-testing is done in viewBox space, not screen space — scale-independent. The actual hit-test runs in Rust; Skia is never consulted for hit-testing because Skia has no concept of element identity.

### 5.5 Stroke-draw animation

For each animated element, the `Animator` updates a per-element `strokeProgress: Float` (0 → 1) over the animation duration with the configured easing. Each frame, the element's Paint is updated to use a `PathEffect` that draws only the leading `strokeProgress` fraction of the path, then triggers redraw.

For `hand-natural` easing, the animator samples the curve from §9 in 32 steps and interpolates.

### 5.6 Performance notes

- Build SkPath objects once per element; cache for the lifetime of the file.
- Decorative shapes (`is_decorative == true`) may be batched into a cached `SkPicture` for static rendering.
- During streaming, disable any whole-canvas caching since elements appear incrementally.
- Pre-compute path lengths during file parse (stored in IR cache, used for stroke-draw timing).
- For very large documents (>500 elements), use SkPicture replay for interactive elements as well, but maintain a parallel per-element Paint state map so highlights can still be applied as overlays.

---

## 6. The Android runtime

### 6.1 Module structure

```
trace-android/
├── build.gradle.kts
├── src/main/
│   ├── kotlin/co/trace/
│   │   ├── Trace.kt                # top-level
│   │   ├── TraceFile.kt
│   │   ├── TraceSession.kt
│   │   ├── TraceView.kt            # View subclass, hosts Skia surface
│   │   ├── TraceRenderer.kt        # element-index → SkPath/Paint map; draws to canvas
│   │   ├── HitTest.kt
│   │   ├── Animator.kt             # Choreographer-driven
│   │   └── PathConvert.kt          # verb-stream → SkPath
│   └── jniLibs/
│       ├── arm64-v8a/libtrace_core.so
│       ├── armeabi-v7a/libtrace_core.so
│       ├── x86_64/libtrace_core.so
│       └── x86/libtrace_core.so
```

### 6.2 The `TraceView` API

```kotlin
class TraceView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
    defStyle: Int = 0
) : View(context, attrs, defStyle) {

    sealed class Source {
        data class File(val uri: Uri) : Source()
        data class Bytes(val data: ByteArray) : Source()
        data class Streaming(val session: TraceSession) : Source()
    }

    var source: Source? = null
        set(value) { field = value; reload() }

    var listener: Listener? = null

    var highlightedIds: Set<String> = emptySet()
        set(value) { field = value; invalidate() }

    var highlightColor: Int = 0xFFFF5722.toInt()
    var highlightStrokeBoost: Float = 1.5f

    interface Listener {
        fun onElementTap(id: String, x: Float, y: Float)
        fun onAnimationFinished(id: String?)
    }
}
```

### 6.3 Rendering model

Same architecture as iOS: a Skia surface hosted in the View, with an element-index → SkPath/Paint map maintained in Kotlin. The loop:

1. On load: parse `.trace`, build SkPath per element via JNI calls to Rust, store in `Map<Int, ElementHandle>`.
2. On `onDraw` (or via Choreographer for animated content): walk elements, call `canvas.drawPath` per element. Decorative shapes may use cached SkPicture.
3. Animation state is per-element, advanced by the Animator on each frame.

**Cross-platform pixel identity is guaranteed because both iOS and Android use the same Skia engine.** This is the entire architectural reason for choosing Skia over CAShapeLayer + Android Canvas.

### 6.4 Hit-testing

```kotlin
override fun onTouchEvent(event: MotionEvent): Boolean {
    if (event.action == MotionEvent.ACTION_UP) {
        val (vbx, vby) = viewToViewbox(event.x, event.y)
        traceFile.hitTest(vbx, vby, HitMode.VisiblePainted)?.let { id ->
            listener?.onElementTap(id, event.x, event.y)
            return true
        }
    }
    return super.onTouchEvent(event)
}
```

Hit-test routes to Rust, not Skia. Same invariant as iOS.

### 6.5 Performance notes

- Use `setLayerType(LAYER_TYPE_HARDWARE, null)` to ensure GPU-accelerated drawing.
- Path objects cached per-element; rebuilt only on element mutation.
- For fully static (non-animated, non-interactive) files, render once to an SkPicture and replay each frame.
- For streaming, do not cache the whole canvas — elements are added incrementally.

---

## 7. The npm package (`@trace/runtime`)

This is the primary distribution channel — the package most users interact with.

### 7.1 Package structure

```
@trace/runtime/
├── package.json
├── src/
│   ├── index.ts                  # public API
│   ├── TraceView.tsx             # Fabric component, wraps RN-Skia canvas
│   ├── useTraceSession.ts        # streaming hook
│   ├── convert.ts                # SVG → Uint8Array (calls Rust via TurboModule)
│   ├── types.ts
│   └── native/
│       ├── NativeTrace.ts        # TurboModule spec (codegen input)
│       ├── TraceViewNativeComponent.ts  # Fabric spec
│       └── jsi.ts                # direct JSI bindings (advanced)
├── ios/
│   ├── Trace.podspec → links Trace.framework
│   ├── RNTraceView.swift         # Fabric component impl
│   └── RNTraceModule.swift       # TurboModule impl
├── android/
│   ├── build.gradle → links co.trace:trace-android
│   ├── src/main/kotlin/.../RNTraceViewManager.kt
│   └── src/main/kotlin/.../RNTraceModule.kt
└── README.md
```

### 7.2 Public API

```ts
// Conversion (synchronous, via JSI)
export function convert(svg: string, options?: ConvertOptions): Uint8Array;

// Batch render
export const TraceView: React.FC<{
  source: Uint8Array | string | TraceSession;
  highlightedIds?: string[];
  highlightColor?: string;
  onElementPress?: (id: string, x: number, y: number) => void;
  onAnimationFinished?: (id: string | null) => void;
  style?: ViewStyle;
}>;

// Streaming
export function useTraceSession(opts: {
  viewBox: [number, number, number, number];
  backpressure?: 'queue' | 'catchUp' | 'drop';
}): TraceSession;

export interface TraceSession {
  append(svgFragment: string, anim?: FragmentAnim): string[];
  remove(id: string): boolean;
  update(id: string, patch: Partial<ElementPatch>): boolean;
  ids(): string[];
  reset(): void;
}

export interface FragmentAnim {
  strokeDrawMs?: number;
  fillFadeMs?: number;
  startAfter?: 'immediately' | 'previous' | { atMs: number };
  easing?: 'linear' | 'ease-out' | 'ease-in-out' | 'hand-natural';
}

// Imperative queries
export function inspect(bytes: Uint8Array): {
  viewBox: [number, number, number, number];
  ids: string[];
  metadata: Record<string, string>;
};
```

### 7.3 Bridge architecture

- **Fabric component** (`TraceViewNativeComponent`) for the rendering surface, wrapping a `react-native-skia` Canvas internally.
- **TurboModule** (`NativeTrace`) for imperative methods: `convert`, `inspect`, session operations.
- **JSI direct path** for hot-path operations (`Session.append`): the Rust core's `Session` is exposed as a JSI HostObject, eliminating bridge serialization for the streaming case.

Cross-language data passes as `ArrayBuffer` (zero-copy) for compiled bytes, plain JS values for ids/colors.

**Animation state pattern:** the identity-to-handle map lives on the JS thread. Per-element animation values are stored as Reanimated shared values that Skia worklets read directly on the UI thread. Use `useDerivedValue` to derive paint properties from animation state, so only affected elements recompute when state changes.

### 7.4 The Rust ↔ JS bridge

Generated via `uniffi-bindgen-react-native`:

- Rust UDL in `trace-core/src/api/api.udl` → TypeScript types and TurboModule + JSI C++ glue
- Single source of truth; iOS, Android, and React Native bindings all derive from it.

### 7.5 Peer dependency on `@shopify/react-native-skia`

`@trace/runtime` declares `@shopify/react-native-skia` as a peer dependency. The runtime uses RN-Skia's `Canvas` component internally as the drawing surface. This means:

- Users install both packages.
- The Skia binaries come from RN-Skia (not bundled by Trace), avoiding duplication.
- Trace inherits RN-Skia's React Native version support matrix.
- Total binary added by Trace on top of RN-Skia: only the Rust core (~2-3 MB per ABI).

---

## 8. The streaming protocol

The streaming protocol is **what gets sent from the AI/server to the runtime** during a Curo-style drawing session. It is a wire protocol, not part of the file format.

### 8.1 Wire format

Trace is **transport-agnostic**. WebSocket, SSE, polling — application's choice. What gets transmitted is a sequence of **fragment messages**:

```json
{
  "type": "fragment",
  "svg": "<g id=\"step-3\"><circle cx=\"100\" cy=\"100\" r=\"40\" fill=\"#3b82f6\"/></g>",
  "anim": {
    "strokeDrawMs": 800,
    "fillFadeMs": 300,
    "startAfter": "previous",
    "easing": "hand-natural"
  }
}
```

Other message types:

- `init`: `{ "type": "init", "viewBox": [0, 0, 800, 600] }`
- `remove`: `{ "type": "remove", "id": "step-2" }`
- `update`: `{ "type": "update", "id": "step-3", "patch": { "fill": "#ef4444" } }`
- `flush`: `{ "type": "flush" }` (forces immediate animation start, no batching)
- `done`: `{ "type": "done" }` (session complete)

Messages are JSON for ease of debugging. They're cheap because they're small (typical fragment = few hundred bytes of SVG).

### 8.2 Client-side flow

```ts
const session = useTraceSession({ viewBox: [0, 0, 800, 600] });

ws.onmessage = (msg) => {
  const m = JSON.parse(msg.data);
  switch (m.type) {
    case 'fragment': session.append(m.svg, m.anim); break;
    case 'remove':   session.remove(m.id); break;
    case 'update':   session.update(m.id, m.patch); break;
    case 'reset':    session.reset(); break;
  }
};
```

`session.append` internally calls Rust's `Session::append_svg_fragment` via JSI, which:

1. Parses the fragment.
2. Appends to IR.
3. Pushes anim tracks.
4. Returns new ids.

The platform layer (iOS/Android) reads the delta (or polls `session.version()`) and updates the view.

### 8.3 Backpressure

If the AI emits fragments faster than the renderer can animate them, the runtime has three modes:

- **Queue** (default): fragments are queued with their `start_after: previous` chained. The user sees them in order, paced by the animation durations.
- **Catch up**: each new fragment shortens the animation of the previous one if it hasn't finished. Trades motion fidelity for staying current.
- **Drop animation**: instant-appear fragments when queue depth exceeds N.

Set per session: `useTraceSession({ viewBox: ..., backpressure: 'catchUp' });`

---

## 9. The drawing-motion model

This is what makes Trace look like a teacher drawing rather than a robot revealing.

### 9.1 The four primitives

| Primitive | Effect |
|---|---|
| `stroke_draw` | Animate `strokeEnd` from 0 to 1 along the path |
| `fill_fade` | Fade fill opacity from 0 to target |
| `appear` | Instant visibility (no animation) |
| `opacity_to` / `transform_to` / `remove` | Standard property animations |

For most teacher-like content, a fragment uses `stroke_draw` (outline appears as if being drawn) followed by `fill_fade` (interior fills in after). The two run sequentially: `stroke_draw` for `strokeDrawMs`, then `fill_fade` for `fillFadeMs`.

### 9.2 The `hand-natural` easing curve (v1 starting values)

Real handwriting has non-linear velocity: fast in the middle of a stroke, slower at the start and end, with micro-pauses at sharp corners. Linear or ease-out alone looks robotic.

`hand-natural` is defined as a piecewise cubic Bézier easing curve. v1 starting control points (input progress → output progress):

```
(0.00, 0.00)
(0.12, 0.02)   slow start
(0.40, 0.55)   acceleration
(0.70, 0.92)   deceleration begins
(1.00, 1.00)
```

**Calibration note:** these values are starting estimates. Before v1.0 release in week 12, calibrate against recorded handwriting data (record a teacher drawing on a tablet, extract velocity profile, fit a curve). If calibrated values differ significantly, update this section before release.

### 9.3 Stroke timing per path length

Drawing a 200-unit path in 200ms feels normal. Drawing a 2000-unit path in 200ms looks like a robot. The runtime applies a soft normalization: `effective_duration = base_duration * (path_length / reference_length)^0.7`, clamped to `[0.5 × base, 2.0 × base]`. This means longer strokes get more time, but the relationship is sublinear so very long paths don't take forever.

### 9.4 Multi-fragment pacing

When fragments arrive with `start_after: previous`, they queue in order, each starting after the previous finishes. The runtime inserts a small **inter-fragment pause** (default 80ms) between fragments to mimic the natural pause a teacher takes between strokes. This is configurable per session.

---

## 10. CLI (`@trace/cli`)

```bash
# Convert one or more SVGs to .trace
npx @trace/cli convert input.svg --out output.trace
npx @trace/cli convert "icons/*.svg" --out-dir assets/

# Inspect a .trace file
npx @trace/cli inspect file.trace
# → viewBox, element count, ids, metadata, animation tracks

# Dump a .trace file as JSON (for debugging)
npx @trace/cli dump file.trace --pretty
# Every byte of a .trace file is round-trippable through JSON; dump produces
# editable JSON, and `npx @trace/cli pack input.json` reconstructs the .trace.
# This is the debuggability escape hatch.

# Validate
npx @trace/cli validate file.trace

# Diff two .trace files
npx @trace/cli diff a.trace b.trace
```

The CLI is just a thin Node wrapper around the same Rust core that the runtime uses. No duplication of conversion logic.

---

## 11. Conformance test suite

Shipped as a separate package `@trace/conformance` to make the format real (not "whatever the Rust code does"). Lottie has one; Rive has one. Trace must have one from day one.

Contents:

```
@trace/conformance/
├── fixtures/
│   ├── 001-empty/              # empty .trace file
│   │   ├── input.json          # canonical JSON representation
│   │   ├── output.trace        # expected binary
│   │   └── queries.json        # expected query results
│   ├── 002-single-rect/
│   ├── 003-mermaid-flowchart-100-nodes/
│   ├── ...
│   └── 200-streaming-session-snapshot/
├── runner/                     # Node-based runner
│   ├── run.ts
│   └── compare.ts
└── README.md
```

Each fixture defines:

- An input (either an SVG or a sequence of streaming fragments)
- The expected `.trace` bytes (canonical output)
- Expected query results: viewBox, element count, all ids, hit-test results at specific (x, y), bbox of named elements

Any implementation — the reference Rust runtime now, a hypothetical Flutter or web port later — can run against this suite and prove conformance. This is how Trace evolves from "a library" to "a format."

**Test target for v1.0 release:** 200 fixture cases passing, covering all supported SVG features, all section types, batch and streaming modes.

---

## 12. Repository layout

```
trace/                              # the public OSS monorepo
├── README.md
├── LICENSE                         # Apache 2.0
├── SPEC.md                         # the format specification (this doc, distilled)
├── CONTRIBUTING.md
├── crates/
│   └── trace-core/                 # the Rust core (§4)
├── packages/
│   ├── runtime/                    # @trace/runtime (npm) (§7)
│   ├── cli/                        # @trace/cli (npm) (§10)
│   ├── conformance/                # @trace/conformance (npm) (§11)
│   └── docs/                       # docs site (Docusaurus/Nextra)
├── platforms/
│   ├── ios/                        # Trace.framework (§5)
│   └── android/                    # trace-android.aar (§6)
├── examples/
│   ├── react-native-mermaid/       # render Mermaid diagrams in RN
│   ├── react-native-streaming/     # streaming AI whiteboard demo
│   ├── ios-swift/                  # native iOS sample
│   └── android-kotlin/             # native Android sample
├── tools/
│   ├── conformance/                # cross-runtime test runner
│   └── fuzz/                       # fuzzers for the parser
└── .github/
    └── workflows/
        ├── ci.yml                  # cargo test, ios build, android build
        ├── release.yml             # publish npm, pod, maven
        └── conformance.yml         # nightly conformance suite
```

Single monorepo. One license. One version number for the whole stack. Cross-cutting changes (e.g., adding a section type to the format) happen in one PR that touches Rust + iOS + Android + npm.

---

## 13. Build and release process

### 13.1 Rust core build

```bash
cd crates/trace-core
cargo build --release --target aarch64-apple-ios
cargo build --release --target aarch64-apple-ios-sim
cargo build --release --target x86_64-apple-ios
cargo build --release --target aarch64-linux-android
cargo build --release --target armv7-linux-androideabi
cargo build --release --target x86_64-linux-android
cargo build --release --target i686-linux-android
```

Universal binaries are assembled by `lipo` (iOS) and copied into `jniLibs/` (Android).

### 13.2 iOS framework

```bash
cd platforms/ios
./scripts/build-xcframework.sh
# → produces TraceCore.xcframework
# Trace.framework wraps it and adds Swift API
```

UniFFI generates Swift bindings; `Trace.framework` adds the `TraceView` UIView and the Swift idiomatic surface on top.

### 13.3 Android library

```bash
cd platforms/android
./gradlew :trace:assembleRelease
# → produces trace-android.aar with bundled .so files
```

UniFFI generates Kotlin bindings; `trace-android` adds the `TraceView` View and Kotlin idiomatic surface.

### 13.4 npm package distribution

`@trace/runtime`'s postinstall:

1. Downloads the matching iOS XCFramework from GitHub releases.
2. Downloads the matching Android AAR.
3. Verifies SHA-256 signatures against published hashes in the package itself.
4. Places binaries where CocoaPods / Gradle can find them.

**Trust model:** package version pins exact binary SHA-256 hashes. Postinstall verifies downloaded binaries match. If verification fails, install fails. Fallback to building from source via Rust toolchain if user opts in via env var. Modeled after `esbuild` and `sharp`'s distribution.

### 13.5 Release flow

Every release follows:

1. Update `Cargo.toml`, `package.json`, `build.gradle`, `Trace.podspec` to the new version (one script: `./scripts/bump-version.sh 1.2.3`).
2. Tag `v1.2.3`.
3. CI builds Rust binaries for all targets.
4. CI uploads them to GitHub releases.
5. CI publishes to npm, CocoaPods, Maven Central.

Semantic versioning. Major bumps require a format major-version bump. Minor bumps may add section types or new APIs. Patches are bugfixes only.

---

## 14. 12-week implementation plan

### Weeks 1–2 · Rust core scaffolding

- Set up monorepo, Apache 2.0 license, CI scaffolding
- `trace-core` crate, depend on usvg
- Implement IR types
- Implement format read/write for HEADER, SECTION TABLE, FOOTER, STRS
- Round-trip test: write empty file, read it back
- Set up UniFFI scaffolding
- Start `@trace/conformance` fixture format

### Weeks 3–4 · Conversion path

- `convert::svg_to_ir` with usvg integration
- Path baking: transforms, arcs → cubics
- Marker baking (Mermaid arrowheads)
- Text → outline paths (font_db loaded from system; define font fallback chain)
- **Mermaid id normalization: catalog actual outputs across all diagram types and finalize the normalizer**
- `serialize::writer` produces GEOM, IDIX, STRS
- Test against 20 fixture SVGs (Mermaid flowcharts, sequence, class, state, ER, gantt, pie, mindmap)

### Weeks 5–6 · Hit-test acceleration

- Path flattening to polylines
- STR-packed R-tree build
- R-tree query
- point-in-polygon (nonzero + evenodd)
- point-to-polyline distance
- `hit_test` API
- HITX section read/write
- Test: hit-test correctness on Mermaid fixtures

### Weeks 7–8 · iOS runtime

- `Trace.framework` skeleton
- UniFFI Swift bindings generation
- `TraceFile` Swift wrapper
- `TraceView` UIView with Skia surface
- verb-stream → SkPath
- Per-element draw call architecture (NOT SkPicture-for-everything)
- Element-index → handle map
- Hit-testing via touchesEnded (routes to Rust)
- Static example app rendering a Mermaid `.trace`

### Week 9 · Android runtime

- `trace-android` AAR skeleton
- UniFFI Kotlin bindings
- `TraceView` View with Skia surface
- verb-stream → SkPath (Skia, not android.graphics.Path)
- Per-element draw call architecture
- Element-index → handle map in Kotlin
- Hit-testing via onTouchEvent (routes to Rust)
- Static example app
- **Verify pixel-identical output between iOS and Android on test fixtures**

### Weeks 10–11 · Streaming, animation, RN binding

- `Session` Rust API with enforced limits
- ANIM section read/write
- Animator (iOS CADisplayLink + Android Choreographer)
- Stroke-draw animation (per-element strokeProgress in shared values)
- Fill-fade animation
- **`hand-natural` easing curve calibration against recorded handwriting data**
- `@trace/runtime` npm package
- Fabric component + TurboModule wrapping RN-Skia Canvas
- `useTraceSession` hook
- Streaming example app

### Week 12 · Polish, CLI, conformance, docs, v1.0 release

- `@trace/cli` package (convert, inspect, dump, validate, diff, pack)
- `@trace/conformance` 200-fixture suite passing
- Docs site (Docusaurus or Nextra)
- Demo: AI-whiteboard playground (the success criterion video — see §15)
- Demo: Mermaid in RN
- Real benchmarks on actual hardware (iPhone 12, Pixel 6)
- README, CONTRIBUTING, SPEC.md
- v1.0.0 release: npm, Pod, Maven

After v1.0: Curo integrates `@trace/runtime`, replaces existing SVG handling. First-user dogfooding informs v1.1.

---

## 15. Minimum viable demo (week 12 success criterion)

The project succeeds at week 12 if and only if you can produce **two artifacts**:

**Artifact A — Side-by-side comparison video.**

- Same React Native app, same Mermaid org chart of ~200 nodes.
- One screen recording with `react-native-svg` (the current state of the art).
- One screen recording with `@trace/runtime` (Trace v1.0).
- Visible difference in: load time, scroll/pan smoothness, tap response latency, cross-platform rendering consistency.
- Total runtime: 60-90 seconds, side-by-side.

**Artifact B — AI-whiteboard demo video.**

- A live Curo session (or simulated equivalent) running on a real iPhone and a real Android phone.
- The AI emits a flowchart stroke-by-stroke over WebSocket.
- Each stroke draws with the hand-natural easing curve at the right pace.
- The user taps a node mid-draw to ask a follow-up question; the tap registers correctly and the node highlights.
- Both phones show pixel-identical output at the same frame.
- Total runtime: 60-90 seconds.

**If both videos can be produced at the end of week 12, the project has succeeded.** If they can't — regardless of how technically correct the code is — the project has failed its goal and needs another iteration before release.

These videos are also the marketing artifact for the public launch. Make them well.

---

## 16. Open questions and explicit deferrals

These are decisions deliberately punted to post-v1, with notes on the leading direction.

| Question | Leading direction | Defer to |
|---|---|---|
| Should we support text-as-runs (live text rendering, accessibility, dynamic content) in addition to text-as-paths? | Yes; add TEXT_AS_RUNS path with system font shaping per platform | v1.1 |
| Should we ship a Figma plugin? | Yes, exporting nodes as `.trace` directly | v1.2 |
| Should we ship a web runtime (Canvas2D or WebGL)? | Yes; Rust core compiles to WASM trivially | v1.3 |
| Should the format support raster image embeds (`<image>`)? | Yes; add IMGS section with PNG/JPEG blobs | v1.1 |
| Should we support radial gradients and patterns? | Yes for radial; pattern is design-tool driven, defer further | v1.1 / v1.3 |
| Should there be a hosted CDN service for converting and serving `.trace`? | Maybe — only if usage justifies it. The Rust core's `convert` is fast enough that most users will convert in their build pipeline. | based on demand |
| Should we support designer-authored interactive regions (clickable hotspots independent of SVG ids)? | Yes; new section type INTR | v1.2 |
| Should we support full accessibility (screen reader element descriptions, focus traversal)? | Yes; ARIA fields in META + platform a11y bridge | v1.1 |
| Should we expose a Flutter binding? | Yes, via Dart FFI over the same Rust core | v1.3 |
| Should there be a Mermaid build-time integration that emits `.trace` directly? | Yes; small Mermaid plugin that writes `.trace` instead of `.svg` | v1.1 |
| Should we ship a minimal-binary renderer (no Skia) for binary-sensitive apps? | Yes, as alternate backend; same format, smaller deps | v2.0 |
| Should v1 support SkPicture caching for interactive elements (with per-element Paint overrides)? | Investigate during week 8 — if performance requires it for >500 element diagrams, add it as an optimization while preserving the per-element handle map. | week 8 review |

---

## Closing notes

This document defines everything needed to start building Trace on day one. The format is small enough to implement, opinionated enough to be coherent, and forward-compatible enough to grow. The architecture is grounded in proven prior art: usvg for SVG normalization, R-tree spatial indexing for hit-testing, PDF's xref pattern for random-access by id, Rive's ToC pattern for forward-compat, Lottie's playbook for cross-platform runtime parity, UniFFI for the Rust → mobile distribution path, and Skia for the cross-platform pixel-identical rendering layer.

The strategic bet is that the right unit of contribution to the ecosystem is **a new format with a reference runtime**, not yet another SVG library. Formats outlive runtimes. A well-designed open format attracts contributors who build alternate renderers (web, Flutter, Qt), design-tool plugins (Figma, Sketch, Illustrator), and validators — none of which Trace itself needs to build. Curo gets all of that ecosystem benefit for free, because Curo's rendering layer is the same code that everyone else is using and improving.

The first version is intentionally narrow. Interactive diagrams (Mermaid, org charts) and streamed AI drawing — that's it. Everything else (filters, patterns, designer tools, web) is on the roadmap but explicitly out of v1. Discipline at v1 is what lets the project ship in 12 weeks instead of dying in 12 months.

Ship the format. Ship the runtime. Watch what people build with it. Let the broader story emerge from real usage.
