// Built-in arrowhead marker definitions + a runtime registry that emits
// the exact `<marker>` declarations needed for the edges Vexel is rendering.
//
// Why a registry rather than emitting markers directly: a single diagram
// may use the same shape at many color/scale combinations (red 1x arrow,
// blue 1.5x arrow, etc.). Each unique (shape, color, scale) triple becomes
// one `<marker>` definition in <Defs>; references on the line/path use a
// stable id derived from the triple.

import type { ArrowShape, CustomArrowShape, EdgeStyle } from './types';
import type { CssRule } from './cssRules';

export interface MarkerSpec {
  shape: ArrowShape;
  color: string;
  scale: number;
}

export interface MarkerBlueprint {
  /** Marker id used in `marker-end="url(#...)"` references. */
  id: string;
  /** SVG path / circle / rect element definition. */
  path: string;
  viewBox: string;
  refX: number;
  refY: number;
  width: number;
  height: number;
  fill: string;
  stroke: string;
  strokeWidth: number;
}

/** Built-in shape definitions in marker-coordinate space (10x10 default). */
const BUILT_INS: Record<Exclude<ArrowShape, 'none' | CustomArrowShape>, {
  d: string;
  viewBox?: string;
  refX?: number;
  refY?: number;
  width?: number;
  height?: number;
  outline?: boolean;
}> = {
  triangle:      { d: 'M0,0 L10,5 L0,10 z',                 refX: 9,  refY: 5 },
  'triangle-open': { d: 'M0,0 L10,5 L0,10',                 refX: 9,  refY: 5, outline: true },
  arrow:         { d: 'M0,0 L10,5 L0,10',                   refX: 9,  refY: 5, outline: true },
  circle:        { d: 'M0,5 a5,5 0 1,0 10,0 a5,5 0 1,0 -10,0', refX: 10, refY: 5 },
  'circle-open': { d: 'M0,5 a5,5 0 1,0 10,0 a5,5 0 1,0 -10,0', refX: 10, refY: 5, outline: true },
  square:        { d: 'M0,0 L10,0 L10,10 L0,10 z',          refX: 10, refY: 5 },
  diamond:       { d: 'M0,5 L5,0 L10,5 L5,10 z',            refX: 10, refY: 5 },
  bar:           { d: 'M5,0 L5,10',                         refX: 5,  refY: 5, outline: true, width: 6, height: 10 },
};

/** Stable, URL-safe id for marker references. */
export function makeMarkerId(spec: MarkerSpec): string {
  if (spec.shape === 'none') return '';
  const tag = typeof spec.shape === 'string' ? spec.shape : 'custom-' + hashCustom(spec.shape);
  const safeColor = String(spec.color).replace(/[^a-z0-9]/gi, '');
  const scaleTag = String(spec.scale).replace('.', '_');
  return `vexel-arrow-${tag}-${safeColor}-${scaleTag}`;
}

function hashCustom(s: CustomArrowShape): string {
  // Cheap stable hash; collisions are visually harmless (same id → same marker).
  let h = 5381;
  const src = (s.d ?? '') + (s.viewBox ?? '') + String(s.refX ?? '') + String(s.refY ?? '');
  for (let i = 0; i < src.length; i++) h = ((h * 33) ^ src.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/** Build a concrete marker blueprint for the renderer to draw. */
export function blueprintFor(spec: MarkerSpec): MarkerBlueprint | null {
  if (spec.shape === 'none') return null;
  const id = makeMarkerId(spec);
  const def: CustomArrowShape =
    typeof spec.shape === 'string'
      ? (BUILT_INS as any)[spec.shape]
      : spec.shape;
  if (!def) return null;
  const w = (def.width ?? 10) * spec.scale;
  const h = (def.height ?? 10) * spec.scale;
  const outline = !!def.outline;
  return {
    id,
    path: def.d,
    viewBox: def.viewBox ?? '0 0 10 10',
    refX: def.refX ?? 9,
    refY: def.refY ?? 5,
    width: w,
    height: h,
    fill: outline ? 'none' : spec.color,
    stroke: spec.color,
    strokeWidth: outline ? 1.5 : 0,
  };
}

/** Resolve dash-array shorthand to a number array RN-SVG accepts. */
export function resolveDasharray(
  v: number[] | 'solid' | 'dashed' | 'dotted' | undefined,
): string | undefined {
  if (v == null) return undefined;
  if (v === 'solid') return undefined;       // = no dasharray
  if (v === 'dashed') return '6,4';
  if (v === 'dotted') return '2,3';
  if (Array.isArray(v)) return v.join(',');
  return undefined;
}

// =============================================================================
// CSS-driven arrow customization
// =============================================================================
//
// SVG authors can style arrows via custom properties on edge selectors:
//
//   .flowchart-link {
//     --vexel-arrow: triangle;            /* shape name, both ends */
//     --vexel-arrow-color: #f59e0b;
//     --vexel-arrow-scale: 1.5;
//   }
//
//   .important {
//     --vexel-arrow-end: diamond;         /* per-end override */
//     --vexel-arrow-start: bar;
//   }
//
// Cascades through the same resolver as every other style — `:hover`
// pseudo-classes, `@media (prefers-color-scheme: dark)`, etc. all work.

const VALID_SHAPES: ReadonlySet<string> = new Set([
  'triangle', 'triangle-open', 'arrow', 'circle', 'circle-open',
  'square', 'diamond', 'bar', 'none',
]);

function asArrowShape(v: string | undefined): ArrowShape | undefined {
  if (!v) return undefined;
  const t = v.trim();
  if (VALID_SHAPES.has(t)) return t as ArrowShape;
  return undefined;
}

/**
 * Extract `--vexel-arrow*` custom props from a CSS cascade-resolved
 * declaration map into a partial EdgeStyle the renderer can apply.
 */
export function extractCssArrowStyle(
  decls: Record<string, string>,
): Partial<EdgeStyle> | undefined {
  const start = asArrowShape(decls['--vexel-arrow-start']);
  const end = asArrowShape(decls['--vexel-arrow-end']);
  const both = asArrowShape(decls['--vexel-arrow']);
  const color = decls['--vexel-arrow-color']?.trim();
  const scaleRaw = decls['--vexel-arrow-scale']?.trim();

  let arrow: EdgeStyle['arrow'] | undefined;
  if (start !== undefined || end !== undefined) {
    arrow = { start, end };
  } else if (both !== undefined) {
    arrow = both;
  }

  if (arrow === undefined && color === undefined && scaleRaw === undefined) {
    return undefined;
  }

  const out: Partial<EdgeStyle> = {};
  if (arrow !== undefined) out.arrow = arrow;
  if (color) out.arrowColor = color;
  if (scaleRaw) {
    const n = parseFloat(scaleRaw);
    if (!Number.isNaN(n) && n > 0) out.arrowScale = n;
  }
  return out;
}

/**
 * Scan a parsed stylesheet for all `--vexel-arrow*` references and emit a
 * marker spec for each unique (shape, color, scale) triple — so the
 * synthetic markers exist in `<Defs>` by the time the renderer resolves
 * the per-element cascade.
 *
 * `var(--brand)` and other inherited references work only when the values
 * are also reachable as :root variables or via cssVariables prop. Literal
 * values always work.
 */
export function collectMarkerSpecsFromCss(
  rules: CssRule[],
  rootVariables: Record<string, string>,
  userVariables: Record<string, string>,
): MarkerSpec[] {
  const variables = { ...userVariables, ...rootVariables };
  const specs: MarkerSpec[] = [];
  const seen = new Set<string>();

  const resolveVar = (raw: string): string => {
    const trimmed = raw.trim();
    const m = trimmed.match(/^var\(\s*(--[^,)]+)(?:\s*,\s*([^)]+))?\s*\)$/);
    if (!m) return trimmed;
    const ref = variables[m[1].trim()];
    if (ref !== undefined) return ref.trim();
    return (m[2] ?? '').trim();
  };

  for (const rule of rules) {
    let shape: string | undefined;
    let start: string | undefined;
    let end: string | undefined;
    let color: string | undefined;
    let scale: number = 1;
    let stroke: string | undefined;
    let hasArrow = false;
    for (const d of rule.declarations) {
      const v = resolveVar(d.value);
      if (d.property === '--vexel-arrow') { shape = v; hasArrow = true; }
      else if (d.property === '--vexel-arrow-start') { start = v; hasArrow = true; }
      else if (d.property === '--vexel-arrow-end') { end = v; hasArrow = true; }
      else if (d.property === '--vexel-arrow-color') { color = v; }
      else if (d.property === '--vexel-arrow-scale') {
        const n = parseFloat(v);
        if (!Number.isNaN(n) && n > 0) scale = n;
      }
      else if (d.property === 'stroke') { stroke = v; }
    }
    if (!hasArrow) continue;
    const effColor = color ?? stroke ?? '#000000';
    const positions: ArrowShape[] = [];
    const validStart = asArrowShape(start);
    const validEnd = asArrowShape(end);
    const validBoth = asArrowShape(shape);
    if (validStart && validStart !== 'none') positions.push(validStart);
    if (validEnd && validEnd !== 'none') positions.push(validEnd);
    if (!positions.length && validBoth && validBoth !== 'none') positions.push(validBoth);
    for (const s of positions) {
      const id = makeMarkerId({ shape: s, color: effColor, scale });
      if (id && !seen.has(id)) {
        seen.add(id);
        specs.push({ shape: s, color: effColor, scale });
      }
    }
  }
  return specs;
}
