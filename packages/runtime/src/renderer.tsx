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
} from 'react-native-svg';
import { attrs, children, firstChild, textOf } from './parseSvgGraph';
import type {
  Graph,
  HighlightColors,
  IndexedShape,
  RenderStatus,
  ShapeKind,
  VexelViewProps,
} from './types';

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
}

export function renderDefs(svgRoot: any): React.ReactNode {
  const defsNode = firstChild(svgRoot, 'defs');
  if (!defsNode) return null;
  const kids = children(defsNode);
  return (
    <Defs>
      {kids.map(([name, c], i) => {
        if (name === 'marker') {
          const a = normalizeAttrs(attrs(c));
          const kids2 = children(c);
          return (
            <Marker key={`m-${i}`} {...a}>
              {kids2.map(([n, kc], j) =>
                renderShape(n, kc, 'normal', 1, `m-${i}-${n}${j}`, {
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
        }
        return null;
      })}
    </Defs>
  );
}

export function renderGroup(
  node: any,
  opts: RenderOptions,
  key: string,
  inherited?: { reveal: number; ownerId?: string; ownerClasses?: string[]; ownerKind?: ShapeKind },
): React.ReactNode {
  const a = attrs(node);
  const id: string | undefined = a?.id;
  const klass = a?.class ? a.class.split(/\s+/).filter(Boolean) : undefined;
  const status: RenderStatus = id ? opts.statusOf(id) : 'normal';
  const reveal: number =
    inherited?.reveal != null
      ? inherited.reveal
      : id && opts.revealOf
      ? opts.revealOf(id)
      : 1;
  const ownerId = id ?? inherited?.ownerId;
  const ownerClasses = klass ?? inherited?.ownerClasses;
  const ownerKind = (id ? opts.graph.shapes.get(id)?.kind : inherited?.ownerKind) ?? 'node';

  const kids = children(node);
  const inner = kids.map(([name, child], i) => {
    if (opts.skipText && name === 'text') return null;
    if (name === 'g') {
      return renderGroup(child, opts, `${key}-g${i}`, {
        reveal,
        ownerId,
        ownerClasses,
        ownerKind,
      });
    }
    return renderShape(name, child, status, reveal, `${key}-${name}${i}`, {
      colors: opts.colors,
      ownerId,
      ownerClasses,
      ownerKind,
      customColors: opts.customColors,
      colorFilter: opts.colorFilter,
    });
  });

  // Performance: drop tap handlers when total interactive element count
  // exceeds the budget. Renders become a fraction of the cost when react
  // doesn't have to wire onPress per <G>.
  const overBudget =
    opts.interactiveBudget != null && opts.graph.shapes.size >= opts.interactiveBudget;

  if (id && !overBudget) {
    return (
      <G
        key={key}
        onPress={() => opts.onPress(id)}
        onPressIn={opts.onPressIn ? () => opts.onPressIn!(id) : undefined}
        onPressOut={opts.onPressOut}
      >
        {inner}
      </G>
    );
  }
  return <G key={key}>{inner}</G>;
}

interface ShapeRenderCtx {
  colors: Required<HighlightColors>;
  ownerId: string | undefined;
  ownerClasses: string[] | undefined;
  ownerKind: ShapeKind;
  customColors: VexelViewProps['colors'];
  colorFilter: VexelViewProps['colorFilter'];
}

function renderShape(
  name: string,
  node: any,
  groupStatus: RenderStatus,
  reveal: number,
  key: string,
  ctx: ShapeRenderCtx,
): React.ReactNode {
  const Comp = RNSVG[name];
  if (!Comp) return null;
  const raw = normalizeAttrs(attrs(node));

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

  const customOverride: Record<string, any> = {};
  if (ownerColors.fill !== undefined && (raw.fill === undefined || raw.fill !== 'none')) {
    customOverride.fill = applyFilter(ownerColors.fill, 'fill') ?? ownerColors.fill;
  } else if (!isText && raw.fill !== undefined) {
    const filtered = applyFilter(String(raw.fill), 'fill');
    if (filtered && filtered !== raw.fill) customOverride.fill = filtered;
  }
  if (ownerColors.stroke !== undefined) {
    customOverride.stroke = applyFilter(ownerColors.stroke, 'stroke') ?? ownerColors.stroke;
  } else if (!isText && raw.stroke !== undefined) {
    const filtered = applyFilter(String(raw.stroke), 'stroke');
    if (filtered && filtered !== raw.stroke) customOverride.stroke = filtered;
  }

  // Status (selected/connected/normal) override — text and dividers exempt
  // so glyph outlines stay clean.
  const skipStatusOverride = name === 'text' || name === 'line';
  const statusOverride = skipStatusOverride ? {} : overrideForStatus(groupStatus, ctx.colors);

  // Streaming reveal — stroke-dasharray + fill-opacity.
  const revealOverride = revealOverrideFor(name, reveal);

  const final = { ...raw, ...customOverride, ...statusOverride, ...revealOverride };

  if (name === 'text') {
    const txt = textOf(node);
    return (
      <Comp key={key} {...final} pointerEvents="none">
        {txt}
      </Comp>
    );
  }
  return <Comp key={key} {...final} />;
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
