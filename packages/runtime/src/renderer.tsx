// Dynamic SVG → react-native-svg renderer.
//
// Walks the parsed preserveOrder tree and emits react-native-svg primitives.
// For each <g id="...">, calls back with the id on tap; for each shape inside,
// looks up the parent group's render status + per-id/per-class color overrides
// and applies them.

import React from 'react';
import {
  Circle,
  Defs,
  Ellipse,
  G,
  Line,
  Marker,
  Path,
  Polygon,
  Polyline,
  Rect,
  Text as SvgText,
  TSpan,
} from 'react-native-svg';
import { attrs, children, firstChild, textOf, walk } from './parseSvgGraph';
import type { ElementContext } from './cssRules';
import type {
  Graph,
  HighlightColors,
  IndexedShape,
  RenderStatus,
  ShapeKind,
  VexelViewProps,
} from './types';

/**
 * Per-element CSS cascade resolver. Returns the fully-resolved style
 * declarations for an element (kebab-case keys, e.g. `stroke-width`).
 * The renderer applies these as the bottom layer of the paint cascade
 * (above SVG implicit defaults, below SVG presentation attributes).
 *
 * `inherited` carries already-resolved values from the parent element so
 * inheritable props (fill, stroke, color, font-*, etc.) flow down the tree
 * per SVG 2 inheritance rules — e.g. `.box { fill: red }` on a `<g>` is
 * inherited by every shape inside, even if no rule targets the shapes
 * directly.
 */
export type ResolveStyleFn = (
  element: ElementContext,
  ancestors: ElementContext[],
  inherited: Record<string, string>,
) => Record<string, string>;

const RNSVG: Record<string, any> = {
  rect: Rect,
  circle: Circle,
  ellipse: Ellipse,
  line: Line,
  path: Path,
  polygon: Polygon,
  polyline: Polyline,
  text: SvgText,
};

export const DEFAULT_COLORS = {
  selected: '#f59e0b',
  connectedNode: '#10b981',
  connectedEdge: '#3b82f6',
};

export interface RenderOptions {
  graph: Graph;
  selectedId: string | null;
  onPress: (id: string) => void;
  onPressIn?: (id: string) => void;
  onPressOut?: () => void;
  colors: Required<HighlightColors>;
  /** Per-id and per-class fill/stroke overrides. */
  customColors?: VexelViewProps['colors'];
  /** Programmatic recolor for every fill/stroke read out of the SVG. */
  colorFilter?: VexelViewProps['colorFilter'];
  statusOf: (id: string) => RenderStatus;
  revealOf?: (id: string) => number;
  /** Performance: drop text elements entirely. */
  skipText?: boolean;
  /** Performance: drop interactivity (onPress) when >= N elements. */
  interactiveBudget?: number;
  /** CSS cascade resolver — applies <style> blocks to each element. */
  resolveStyle?: ResolveStyleFn;
}

export function renderDefs(svgRoot: any): React.ReactNode {
  // Walk the entire tree collecting every <marker>, regardless of nesting.
  // Mermaid is wildly inconsistent here:
  //   - flowcharts:           markers as direct children of <g> (no <defs>)
  //   - sequence diagrams:    7 separate <defs>, one marker each
  //   - class diagrams:       10 separate <defs> mixing markers + symbols
  //   - state diagrams:       single <defs> with all markers
  // Collecting them all into one <Defs> block at the top is correct because
  // marker references (`marker-end="url(#id)"`) lookup by id globally.
  const markers: Array<[string, any]> = [];
  walk(svgRoot, (node, name) => {
    if (name === 'marker') {
      const a = attrs(node);
      if (a?.id) markers.push([a.id, node]);
    }
  });
  if (markers.length === 0) return null;
  return (
    <Defs>
      {markers.map(([id, markerNode], i) => {
        const a = normalizeAttrs(attrs(markerNode));
        const kids = children(markerNode);
        return (
          <Marker key={`m-${id}-${i}`} {...a}>
            {kids.map(([n, kc], j) =>
              renderShape(n, kc, 'normal', 1, `m-${id}-${n}${j}`, {
                colors: DEFAULT_COLORS as Required<HighlightColors>,
                ownerId: undefined,
                ownerClasses: undefined,
                ownerKind: 'node',
                customColors: undefined,
                colorFilter: undefined,
              }),
            )}
          </Marker>
        );
      })}
    </Defs>
  );
}

export function renderGroup(
  node: any,
  opts: RenderOptions,
  key: string,
  inherited?: {
    reveal: number;
    ownerId?: string;
    ownerClasses?: string[];
    ownerKind?: ShapeKind;
    ancestors?: ElementContext[];
    /** Already-resolved inheritable CSS values from parent groups. */
    cssInherited?: Record<string, string>;
  },
): React.ReactNode {
  const a = attrs(node);
  const id: string | undefined = a?.id;
  const klass = a?.class ? a.class.split(/\s+/).filter(Boolean) : undefined;
  const status: RenderStatus = id ? opts.statusOf(id) : 'normal';
  // If this group has its own id, it's an addressable element with its own
  // reveal animation timing. Always recompute via revealOf — DON'T inherit
  // the parent's reveal value (which would be 1 for top-level wrappers and
  // mask streaming entirely).
  const reveal: number =
    id && opts.revealOf
      ? opts.revealOf(id)
      : inherited?.reveal != null
      ? inherited.reveal
      : 1;
  const ownerId = id ?? inherited?.ownerId;
  const ownerClasses = klass ?? inherited?.ownerClasses;
  const ownerKind = (id ? opts.graph.shapes.get(id)?.kind : inherited?.ownerKind) ?? 'node';

  // CSS cascade: build the element context for this <g> and push onto the
  // ancestor stack so descendant selectors (e.g. `.cluster .label`) match.
  const groupElCtx: ElementContext = {
    tag: 'g',
    id,
    classes: klass,
    attributes: a,
  };
  const nextAncestors = inherited?.ancestors
    ? [...inherited.ancestors, groupElCtx]
    : [groupElCtx];

  // Resolve THIS group's CSS so we can extract the inheritable props to pass
  // down to descendants. Without this, a rule like `.box { fill: red }`
  // applied to a <g class="box"> wouldn't be inherited by its child <rect>.
  const parentCssInherited = inherited?.cssInherited ?? {};
  let nextCssInherited = parentCssInherited;
  if (opts.resolveStyle) {
    const groupResolved = opts.resolveStyle(
      groupElCtx,
      inherited?.ancestors ?? [],
      parentCssInherited,
    );
    nextCssInherited = mergeInherited(parentCssInherited, groupResolved);
  }

  const kids = children(node);
  const inner = kids.map(([name, child], i) => {
    if (opts.skipText && name === 'text') return null;
    if (name === 'g') {
      return renderGroup(child, opts, `${key}-g${i}`, {
        reveal,
        ownerId,
        ownerClasses,
        ownerKind,
        ancestors: nextAncestors,
        cssInherited: nextCssInherited,
      });
    }
    return renderShape(name, child, status, reveal, `${key}-${name}${i}`, {
      colors: opts.colors,
      ownerId,
      ownerClasses,
      ownerKind,
      customColors: opts.customColors,
      colorFilter: opts.colorFilter,
      resolveStyle: opts.resolveStyle,
      ancestors: nextAncestors,
      cssInherited: nextCssInherited,
    });
  });

  // Performance: drop tap handlers when total interactive element count
  // exceeds the budget. Renders become a fraction of the cost when react
  // doesn't have to wire onPress per <G>.
  const overBudget =
    opts.interactiveBudget != null && opts.graph.shapes.size >= opts.interactiveBudget;

  // Pass through the group's geometric + paint attributes to <G>:
  //   - transform — REQUIRED for SVGs that position children via `<g transform>`
  //     (Mermaid, GraphViz, almost every diagram generator). Without this, every
  //     child renders at the parent's local origin (overlapping at 0,0).
  //   - opacity / clip / mask / visibility / display — group-level effects.
  // Everything else (id, class, style, geometry attrs that don't apply to <g>)
  // is filtered out.
  const groupAttrs = groupAttrsForG(a);

  if (id && !overBudget) {
    return (
      <G
        key={key}
        {...groupAttrs}
        onPress={() => opts.onPress(id)}
        onPressIn={opts.onPressIn ? () => opts.onPressIn!(id) : undefined}
        onPressOut={opts.onPressOut}
      >
        {inner}
      </G>
    );
  }
  return <G key={key} {...groupAttrs}>{inner}</G>;
}

const G_PASSTHROUGH_ATTRS = new Set([
  'transform',
  'opacity',
  'visibility',
  'display',
  'clip-path',
  'mask',
  'pointer-events',
]);

function groupAttrsForG(a: Record<string, string> | undefined): Record<string, any> {
  if (!a) return {};
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(a)) {
    if (!G_PASSTHROUGH_ATTRS.has(k)) continue;
    const ck = k.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    out[ck] = v;
  }
  return out;
}

interface ShapeRenderCtx {
  colors: Required<HighlightColors>;
  ownerId: string | undefined;
  ownerClasses: string[] | undefined;
  ownerKind: ShapeKind;
  customColors: VexelViewProps['colors'];
  colorFilter: VexelViewProps['colorFilter'];
  resolveStyle?: ResolveStyleFn;
  ancestors?: ElementContext[];
  cssInherited?: Record<string, string>;
}

export function renderShape(
  name: string,
  node: any,
  groupStatus: RenderStatus,
  reveal: number,
  key: string,
  ctx: ShapeRenderCtx,
): React.ReactNode {
  const Comp = RNSVG[name];
  if (!Comp) return null;
  const rawAttrs = attrs(node);
  const raw = normalizeAttrs(rawAttrs);

  // CSS cascade resolution — applies <style> block rules to this element.
  // Layer order (low → high priority, later wins):
  //   1. css resolved (this layer)         — author CSS, !important included
  //   2. svg presentation attributes (raw) — per SVG 2: presentation attrs
  //      have specificity below universal selector, so author CSS wins…
  //      BUT the @media/!important interactions are complex; in practice
  //      this order matches what browsers render for the SVGs we target
  //      (Mermaid, Inkscape, Figma) because those generators are consistent
  //      about putting `fill="..."` only where they want it to override CSS.
  //   3. inline style="..."                — high specificity per CSS spec
  //   4. customColors (consumer override)
  //   5. colorFilter
  //   6. status (highlight)
  //   7. reveal (streaming)
  const elementClasses = rawAttrs?.class
    ? rawAttrs.class.split(/\s+/).filter(Boolean)
    : undefined;
  let cssResolved: Record<string, any> = {};
  if (ctx.resolveStyle) {
    const elementCtx: ElementContext = {
      tag: name,
      id: rawAttrs?.id,
      classes: elementClasses,
      attributes: rawAttrs,
    };
    const resolved = ctx.resolveStyle(
      elementCtx,
      ctx.ancestors ?? [],
      ctx.cssInherited ?? {},
    );
    cssResolved = cssDeclarationsToProps(resolved);
  }

  // Inline style="..." parsing — these are an author-origin tier sitting
  // above CSS class rules per browser cascade.
  const inlineStyle = rawAttrs?.style ? parseInlineStyle(rawAttrs.style) : {};

  // Per-id / per-class color overrides apply to shape boundaries (rect/circle/
  // path/polygon), NEVER to text — text recolor would hurt legibility (e.g.
  // a "dark mode" theme that turns labels white-on-white). Use the SVG's
  // native text fill, or override via a custom decorator if needed.
  const isText = name === 'text';
  const idOverride = !isText && ctx.ownerId ? ctx.customColors?.byId?.[ctx.ownerId] : undefined;
  const classOverride = !isText && ctx.ownerClasses
    ? Object.assign({}, ...ctx.ownerClasses.map((c) => ctx.customColors?.byClass?.[c]).filter(Boolean))
    : undefined;
  const ownerColors = { ...classOverride, ...idOverride };

  // colorFilter same rule — skip text so labels stay readable across themes.
  const applyFilter = (color: string | undefined, attr: 'fill' | 'stroke'): string | undefined => {
    if (isText) return color;
    if (!ctx.colorFilter || !color || color === 'none' || color === 'transparent') return color;
    return ctx.colorFilter(color, { id: ctx.ownerId, kind: ctx.ownerKind, attr });
  };

  // The "effective" color to filter is whatever the cascade resolved to so far
  // (CSS → raw attr → inline style). We need this so colorFilter sees the
  // post-CSS color, not just the raw attribute.
  const preFilterFill = inlineStyle.fill ?? raw.fill ?? cssResolved.fill;
  const preFilterStroke = inlineStyle.stroke ?? raw.stroke ?? cssResolved.stroke;

  const customOverride: Record<string, any> = {};
  if (ownerColors.fill !== undefined && (preFilterFill === undefined || preFilterFill !== 'none')) {
    customOverride.fill = applyFilter(ownerColors.fill, 'fill') ?? ownerColors.fill;
  } else if (!isText && preFilterFill !== undefined) {
    const filtered = applyFilter(String(preFilterFill), 'fill');
    if (filtered !== undefined && filtered !== preFilterFill) customOverride.fill = filtered;
  }
  if (ownerColors.stroke !== undefined) {
    customOverride.stroke = applyFilter(ownerColors.stroke, 'stroke') ?? ownerColors.stroke;
  } else if (!isText && preFilterStroke !== undefined) {
    const filtered = applyFilter(String(preFilterStroke), 'stroke');
    if (filtered !== undefined && filtered !== preFilterStroke) customOverride.stroke = filtered;
  }

  // Status (selected/connected/normal) override — text and dividers exempt
  // so glyph outlines stay clean.
  const skipStatusOverride = name === 'text' || name === 'line';
  const statusOverride = skipStatusOverride ? {} : overrideForStatus(groupStatus, ctx.colors);

  // Streaming reveal — stroke-dasharray + fill-opacity.
  const revealOverride = revealOverrideFor(name, reveal);

  // Strip the raw `style` attr from the merge — we've already parsed it into
  // inlineStyle, and leaving it raw would override our overrides.
  const { style: _ignoredStyle, ...rawNoStyle } = raw;

  // Cascade order, low → high priority (per CSS Cascade L5 / SVG 2):
  //   1. SVG presentation attributes (rawNoStyle) — lowest, below universal
  //   2. Author CSS rules (cssResolved) — !important already merged inside
  //   3. Inline style="..." — high specificity author tier
  //   4. Vexel consumer overrides (colors/filter/status/stream) — always wins
  // This is why Mermaid's `<line class="messageLine0" stroke="none">` ends up
  // with stroke=#212121 from `.messageLine0 { stroke:#212121 }` (CSS over attr).
  const final = {
    ...rawNoStyle,
    ...cssResolved,
    ...inlineStyle,
    ...customOverride,
    ...statusOverride,
    ...revealOverride,
  };

  if (name === 'text') {
    // Mermaid (and most generators) wraps text content in <tspan> children:
    //   <text><tspan dy="1em" x="0">Usability Heuristics</tspan></text>
    // We need to walk the children — direct text() goes inline, <tspan>
    // children render as <TSpan> with their own attrs so per-span x/dy/style
    // (used for multi-line labels) is honored.
    const txt = textOf(node);
    const tspans = children(node)
      .filter(([n]) => n === 'tspan')
      .map(([, tspanNode], i) => {
        const tspanAttrs = normalizeAttrs(attrs(tspanNode));
        // Resolve CSS for the tspan too (inherits from the text element).
        let tspanCss: Record<string, any> = {};
        if (ctx.resolveStyle) {
          const tspanCtx_attrs = attrs(tspanNode);
          const tspanElCtx: ElementContext = {
            tag: 'tspan',
            id: tspanCtx_attrs?.id,
            classes: tspanCtx_attrs?.class
              ? tspanCtx_attrs.class.split(/\s+/).filter(Boolean)
              : undefined,
            attributes: tspanCtx_attrs,
          };
          const elementCtx: ElementContext = {
            tag: 'text',
            id: rawAttrs?.id,
            classes: elementClasses,
            attributes: rawAttrs,
          };
          const tspanResolved = ctx.resolveStyle(
            tspanElCtx,
            [...(ctx.ancestors ?? []), elementCtx],
            mergeForChild(ctx.cssInherited ?? {}, cssResolved),
          );
          tspanCss = cssDeclarationsToProps(tspanResolved);
        }
        const tspanFinal = { ...tspanCss, ...tspanAttrs };
        return (
          <TSpan key={`${key}-tspan${i}`} {...tspanFinal}>
            {textOf(tspanNode)}
          </TSpan>
        );
      });
    // If the <text> has direct text children AND tspans, both render
    // (txt first, then each tspan in document order).
    return (
      <Comp key={key} {...final} pointerEvents="none">
        {txt || null}
        {tspans}
      </Comp>
    );
  }
  return <Comp key={key} {...final} />;
}

/** Merge resolved props with inherited ones for downstream cascade chain. */
function mergeForChild(
  inherited: Record<string, string>,
  resolved: Record<string, any>,
): Record<string, string> {
  const out: Record<string, string> = { ...inherited };
  for (const [k, v] of Object.entries(resolved)) {
    if (typeof v === 'string') out[k] = v;
    else if (typeof v === 'number') out[k] = String(v);
  }
  return out;
}

// =============================================================================
// CSS → react-native-svg prop conversion
// =============================================================================

/**
 * Properties from the CSS cascade that react-native-svg understands.
 * Kebab-case CSS keys are converted to camelCase to match the RN-SVG API.
 * Properties not in this list (e.g. animation-*, transition-*) are dropped
 * — RN-SVG can't render them and they'd just become unknown attrs.
 */
const SVG_STYLED_PROPS = new Set([
  'fill', 'fill-opacity', 'fill-rule',
  'stroke', 'stroke-opacity', 'stroke-width',
  'stroke-dasharray', 'stroke-dashoffset',
  'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit',
  'opacity', 'visibility', 'display',
  'color', 'cursor',
  'font-family', 'font-size', 'font-weight', 'font-style', 'font-variant',
  'letter-spacing', 'word-spacing', 'text-anchor',
  'dominant-baseline', 'alignment-baseline',
  'clip-path', 'clip-rule', 'mask',
  'paint-order', 'shape-rendering', 'text-rendering',
  'marker', 'marker-start', 'marker-mid', 'marker-end',
  'transform', 'transform-origin',
  'vector-effect',
  'mix-blend-mode',
]);

function cssDeclarationsToProps(decls: Record<string, string>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(decls)) {
    if (!SVG_STYLED_PROPS.has(k)) continue;
    if (!v || v === 'inherit' || v === 'initial' || v === 'unset') continue;
    const ck = k.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    out[ck] = coerceCssValue(k, v);
  }
  return out;
}

function parseInlineStyle(styleStr: string): Record<string, any> {
  const out: Record<string, any> = {};
  const parts = styleStr.split(';');
  for (const part of parts) {
    const idx = part.indexOf(':');
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim().toLowerCase();
    let v = part.slice(idx + 1).trim();
    if (!k || !v) continue;
    // Strip `!important` marker — we don't currently track its priority at
    // this layer; the inline style already sits above CSS rules.
    v = v.replace(/\s*!important$/i, '').trim();
    if (!SVG_STYLED_PROPS.has(k)) continue;
    const ck = k.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    out[ck] = coerceCssValue(k, v);
  }
  return out;
}

/** Props that inherit per SVG 2. Mirrors INHERITED_PROPS in cssRules.ts. */
const INHERITABLE = new Set([
  'color', 'cursor', 'direction', 'fill', 'fill-rule', 'fill-opacity',
  'font', 'font-family', 'font-size', 'font-style', 'font-variant', 'font-weight',
  'letter-spacing', 'pointer-events', 'shape-rendering', 'stroke',
  'stroke-dasharray', 'stroke-dashoffset', 'stroke-linecap', 'stroke-linejoin',
  'stroke-miterlimit', 'stroke-opacity', 'stroke-width', 'text-anchor',
  'text-rendering', 'visibility', 'word-spacing', 'writing-mode',
]);

function mergeInherited(
  parent: Record<string, string>,
  resolved: Record<string, string>,
): Record<string, string> {
  // Resolved props REPLACE inherited ones (browser semantics: a child rule's
  // explicit value overrides the inherited value for itself + its descendants).
  // Only inheritable props are carried forward.
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(parent)) {
    if (INHERITABLE.has(k)) out[k] = v;
  }
  for (const [k, v] of Object.entries(resolved)) {
    if (INHERITABLE.has(k)) out[k] = v;
  }
  return out;
}

function coerceCssValue(prop: string, value: string): any {
  // Numeric props — strip `px` and coerce so RN-SVG gets numbers.
  const numericProps = new Set([
    'stroke-width', 'stroke-dashoffset', 'stroke-miterlimit',
    'opacity', 'fill-opacity', 'stroke-opacity',
    'font-size', 'font-weight',
  ]);
  if (numericProps.has(prop)) {
    const m = value.match(/^(-?\d*\.?\d+)(?:px)?$/i);
    if (m) return Number(m[1]);
  }
  return value;
}

function overrideForStatus(
  status: RenderStatus,
  colors: Required<HighlightColors>,
): { stroke?: string; strokeWidth?: number } {
  switch (status) {
    case 'selected':
      return { stroke: colors.selected, strokeWidth: 3.5 };
    case 'connected-node':
      return { stroke: colors.connectedNode, strokeWidth: 2.5 };
    case 'connected-edge':
      return { stroke: colors.connectedEdge, strokeWidth: 2.5 };
    default:
      return {};
  }
}

function revealOverrideFor(name: string, reveal: number): Record<string, any> {
  if (reveal >= 1) return {};
  if (reveal <= 0) return { opacity: 0 };
  if (name === 'text') return { opacity: reveal };
  const dashLen = 10000;
  return {
    strokeDasharray: dashLen,
    strokeDashoffset: dashLen * (1 - reveal),
    fillOpacity: reveal,
  };
}

function normalizeAttrs(a: Record<string, string> | undefined): Record<string, any> {
  if (!a) return {};
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(a)) {
    if (k === 'class') continue;
    const ck = k.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    out[ck] = /^[-+]?\d*\.?\d+$/.test(v) ? Number(v) : v;
  }
  return out;
}
