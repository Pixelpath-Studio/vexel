// Built-in arrowhead marker definitions + a runtime registry that emits
// the exact `<marker>` declarations needed for the edges Vexel is rendering.
//
// Why a registry rather than emitting markers directly: a single diagram
// may use the same shape at many color/scale combinations (red 1x arrow,
// blue 1.5x arrow, etc.). Each unique (shape, color, scale) triple becomes
// one `<marker>` definition in <Defs>; references on the line/path use a
// stable id derived from the triple.

import type { ArrowShape, CustomArrowShape } from './types';

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
