// Painted-area hit-testing for SVG shapes.
//
// Why this exists — see ROADMAP.md "PP-HITTEST". Short version:
// `react-native-svg` and most JS SVG renderers fire a path's `onPress`
// when the user taps anywhere in the path's *bounding box*, not its
// painted area. For a thin diagonal line, the bbox is a huge rectangle
// — taps anywhere in the empty corner trigger the line.
//
// This module gives us point-in-painted-area resolution:
//   - For rect/circle/ellipse/polygon: precise geometry tests
//   - For path/polyline: flatten the path to a polyline once at parse
//     time, then point-to-segment distance check at hit time
//   - Stroke-only or fill-only filtering per-element if needed
//
// All pure functions. No native module. Runs on JS thread; for files
// up to a few hundred elements this is well under one frame on iPhone
// XS-class hardware. The v1.0 Skia + Rust core moves this to native
// (STR R-tree, ~O(log n) instead of O(n)).

import type { IndexedShape, HitTestMode } from './types';

// =============================================================================
// Path "d" flattener — coarse polyline approximation
// =============================================================================
//
// SVG paths are made of move/line/curve/arc commands. For hit-testing we don't
// need exact curves — we sample each curve at K points and treat the whole
// path as one polyline. This is fine for taps because the human finger is
// ~30px wide; sub-pixel curve accuracy doesn't matter.

const CURVE_SAMPLES = 16; // points per cubic/quadratic curve

interface PathCmd {
  op: string;
  args: number[];
}

/** Tokenize the `d` attribute into commands. */
function tokenizePath(d: string): PathCmd[] {
  const cmds: PathCmd[] = [];
  // Match: a command letter, followed by any number of numbers (signed,
  // decimal, scientific) separated by whitespace or commas.
  const re = /([MmLlHhVvCcSsQqTtAaZz])([^MmLlHhVvCcSsQqTtAaZz]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(d)) !== null) {
    const op = m[1];
    const argStr = m[2];
    const args: number[] = [];
    // Numbers like 1.5e-3, -.5, +3, 1.5.5 (the implicit decimal split).
    const numRe = /-?\d*\.?\d+(?:[eE][-+]?\d+)?/g;
    let nm: RegExpExecArray | null;
    while ((nm = numRe.exec(argStr)) !== null) {
      args.push(parseFloat(nm[0]));
    }
    cmds.push({ op, args });
  }
  return cmds;
}

/** Flatten path "d" into a polyline (array of [x,y] points). */
export function flattenPath(d: string): Float64Array {
  const out: number[] = [];
  let cx = 0, cy = 0;            // current point
  let startX = 0, startY = 0;    // subpath start (for Z)
  // For S/T (smooth curves), we need the previous control point reflection.
  let prevCtrlX = 0, prevCtrlY = 0;
  let prevOp = '';

  const push = (x: number, y: number) => {
    out.push(x, y);
    cx = x;
    cy = y;
  };

  for (const cmd of tokenizePath(d)) {
    const a = cmd.args;
    const op = cmd.op;
    const upper = op.toUpperCase();
    const rel = op !== upper;
    let i = 0;
    while (i < a.length || (upper === 'Z' && i === 0)) {
      switch (upper) {
        case 'M': {
          let x = a[i++], y = a[i++];
          if (rel) { x += cx; y += cy; }
          push(x, y);
          startX = x; startY = y;
          // Subsequent pairs after M are implicit L.
          while (i + 1 < a.length) {
            let lx = a[i++], ly = a[i++];
            if (rel) { lx += cx; ly += cy; }
            push(lx, ly);
          }
          break;
        }
        case 'L': {
          let x = a[i++], y = a[i++];
          if (rel) { x += cx; y += cy; }
          push(x, y);
          break;
        }
        case 'H': {
          let x = a[i++];
          if (rel) x += cx;
          push(x, cy);
          break;
        }
        case 'V': {
          let y = a[i++];
          if (rel) y += cy;
          push(cx, y);
          break;
        }
        case 'C': {
          let x1 = a[i++], y1 = a[i++];
          let x2 = a[i++], y2 = a[i++];
          let x = a[i++], y = a[i++];
          if (rel) { x1 += cx; y1 += cy; x2 += cx; y2 += cy; x += cx; y += cy; }
          sampleCubic(cx, cy, x1, y1, x2, y2, x, y, out);
          prevCtrlX = x2; prevCtrlY = y2;
          push(x, y);
          break;
        }
        case 'S': {
          // Smooth cubic — reflect previous ctrl
          const refX = (prevOp.toUpperCase() === 'C' || prevOp.toUpperCase() === 'S')
            ? 2 * cx - prevCtrlX : cx;
          const refY = (prevOp.toUpperCase() === 'C' || prevOp.toUpperCase() === 'S')
            ? 2 * cy - prevCtrlY : cy;
          let x2 = a[i++], y2 = a[i++];
          let x = a[i++], y = a[i++];
          if (rel) { x2 += cx; y2 += cy; x += cx; y += cy; }
          sampleCubic(cx, cy, refX, refY, x2, y2, x, y, out);
          prevCtrlX = x2; prevCtrlY = y2;
          push(x, y);
          break;
        }
        case 'Q': {
          let x1 = a[i++], y1 = a[i++];
          let x = a[i++], y = a[i++];
          if (rel) { x1 += cx; y1 += cy; x += cx; y += cy; }
          sampleQuadratic(cx, cy, x1, y1, x, y, out);
          prevCtrlX = x1; prevCtrlY = y1;
          push(x, y);
          break;
        }
        case 'T': {
          const refX = (prevOp.toUpperCase() === 'Q' || prevOp.toUpperCase() === 'T')
            ? 2 * cx - prevCtrlX : cx;
          const refY = (prevOp.toUpperCase() === 'Q' || prevOp.toUpperCase() === 'T')
            ? 2 * cy - prevCtrlY : cy;
          let x = a[i++], y = a[i++];
          if (rel) { x += cx; y += cy; }
          sampleQuadratic(cx, cy, refX, refY, x, y, out);
          prevCtrlX = refX; prevCtrlY = refY;
          push(x, y);
          break;
        }
        case 'A': {
          // Arc — convert to cubic Bézier(s). For hit-test purposes, sample
          // the arc as a coarse polyline: K samples along the elliptical path.
          const rx = a[i++], ry = a[i++];
          const phi = (a[i++] * Math.PI) / 180;
          const largeArc = a[i++] !== 0;
          const sweep = a[i++] !== 0;
          let ex = a[i++], ey = a[i++];
          if (rel) { ex += cx; ey += cy; }
          sampleArc(cx, cy, ex, ey, rx, ry, phi, largeArc, sweep, out);
          push(ex, ey);
          break;
        }
        case 'Z':
        case 'z': {
          if (cx !== startX || cy !== startY) {
            out.push(startX, startY);
            cx = startX; cy = startY;
          }
          i = a.length; // exit while
          break;
        }
        default:
          // Unknown — bail to avoid infinite loop.
          i = a.length;
      }
      prevOp = op;
      if (upper === 'Z') break;
    }
  }
  return new Float64Array(out);
}

function sampleCubic(
  x0: number, y0: number,
  x1: number, y1: number,
  x2: number, y2: number,
  x3: number, y3: number,
  out: number[],
): void {
  for (let i = 1; i < CURVE_SAMPLES; i++) {
    const t = i / CURVE_SAMPLES;
    const u = 1 - t;
    const x = u*u*u*x0 + 3*u*u*t*x1 + 3*u*t*t*x2 + t*t*t*x3;
    const y = u*u*u*y0 + 3*u*u*t*y1 + 3*u*t*t*y2 + t*t*t*y3;
    out.push(x, y);
  }
}

function sampleQuadratic(
  x0: number, y0: number,
  x1: number, y1: number,
  x2: number, y2: number,
  out: number[],
): void {
  for (let i = 1; i < CURVE_SAMPLES; i++) {
    const t = i / CURVE_SAMPLES;
    const u = 1 - t;
    const x = u*u*x0 + 2*u*t*x1 + t*t*x2;
    const y = u*u*y0 + 2*u*t*y1 + t*t*y2;
    out.push(x, y);
  }
}

function sampleArc(
  x0: number, y0: number,
  x1: number, y1: number,
  rx: number, ry: number,
  phi: number,
  largeArc: boolean,
  sweep: boolean,
  out: number[],
): void {
  // Endpoint-to-center conversion per SVG spec.
  if (rx === 0 || ry === 0) {
    out.push(x1, y1);
    return;
  }
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);
  const dx = (x0 - x1) / 2;
  const dy = (y0 - y1) / 2;
  const x1p = cosPhi * dx + sinPhi * dy;
  const y1p = -sinPhi * dx + cosPhi * dy;
  const rxSq = rx * rx;
  const rySq = ry * ry;
  const x1pSq = x1p * x1p;
  const y1pSq = y1p * y1p;
  let radicand = (rxSq * rySq - rxSq * y1pSq - rySq * x1pSq) /
                 (rxSq * y1pSq + rySq * x1pSq);
  radicand = Math.max(0, radicand);
  const coef = (largeArc !== sweep ? 1 : -1) * Math.sqrt(radicand);
  const cxp = coef * (rx * y1p) / ry;
  const cyp = coef * -(ry * x1p) / rx;
  const cx = cosPhi * cxp - sinPhi * cyp + (x0 + x1) / 2;
  const cy = sinPhi * cxp + cosPhi * cyp + (y0 + y1) / 2;
  const startA = Math.atan2((y1p - cyp) / ry, (x1p - cxp) / rx);
  let deltaA = Math.atan2((-y1p - cyp) / ry, (-x1p - cxp) / rx) - startA;
  if (!sweep && deltaA > 0) deltaA -= 2 * Math.PI;
  else if (sweep && deltaA < 0) deltaA += 2 * Math.PI;
  for (let i = 1; i < CURVE_SAMPLES; i++) {
    const t = i / CURVE_SAMPLES;
    const a = startA + deltaA * t;
    const x = cosPhi * rx * Math.cos(a) - sinPhi * ry * Math.sin(a) + cx;
    const y = sinPhi * rx * Math.cos(a) + cosPhi * ry * Math.sin(a) + cy;
    out.push(x, y);
  }
}

// =============================================================================
// Geometry primitives
// =============================================================================

/** Squared distance from point (px,py) to segment [(ax,ay), (bx,by)]. */
export function pointToSegmentSqDist(
  px: number, py: number,
  ax: number, ay: number,
  bx: number, by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) {
    const ex = px - ax;
    const ey = py - ay;
    return ex * ex + ey * ey;
  }
  let t = ((px - ax) * dx + (py - ay) * dy) / lengthSq;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  const ex = px - cx;
  const ey = py - cy;
  return ex * ex + ey * ey;
}

/** Distance from point to a flattened polyline (returns squared distance). */
export function pointToPolylineSqDist(
  px: number, py: number,
  pts: Float64Array,
): number {
  if (pts.length < 4) return Infinity;
  let min = Infinity;
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const d = pointToSegmentSqDist(px, py, pts[i], pts[i + 1], pts[i + 2], pts[i + 3]);
    if (d < min) min = d;
  }
  return min;
}

/**
 * Point-in-polygon via ray-casting.
 * `rule` selects nonzero or evenodd fill semantics — for hit-test purposes
 * evenodd is the standard sample (ray from point to +infinity, count crossings).
 */
export function pointInPolygon(
  px: number, py: number,
  pts: Float64Array,
  _rule: 'nonzero' | 'evenodd' = 'evenodd',
): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 2; i < pts.length; j = i, i += 2) {
    const xi = pts[i], yi = pts[i + 1];
    const xj = pts[j], yj = pts[j + 1];
    const intersects =
      (yi > py) !== (yj > py) &&
      px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

// =============================================================================
// Top-level hit test
// =============================================================================

/**
 * Result of a hit test: which element was struck, plus distance² for
 * tie-breaking (closer element wins when bboxes overlap).
 */
export interface HitResult {
  id: string;
  /** Squared distance from tap to nearest painted pixel. 0 = inside fill. */
  distSq: number;
}

/**
 * Run a painted-area hit test against every shape. Returns the topmost
 * (last in document order) shape whose painted area is within `tolerance`
 * of the tap point. Returns null if no shape matches — caller should then
 * treat the tap as "background" (deselect, propagate to parent gesture).
 *
 * O(n) over shapes. For files with >500 elements this is ~0.2 ms on
 * iPhone XS; for larger files use viewport culling first.
 */
export function hitTestShapes(
  point: [number, number],
  shapes: Map<string, IndexedShape>,
  mode: HitTestMode = 'visible-painted',
  tolerance: number = 6,
): HitResult | null {
  if (mode === 'bounding-box') {
    return hitTestBoundingBox(point, shapes, tolerance);
  }
  const tolSq = tolerance * tolerance;
  const [px, py] = point;
  let best: HitResult | null = null;
  // Iterate in reverse so the topmost (last drawn) shape wins ties.
  const ids = Array.from(shapes.keys());
  for (let i = ids.length - 1; i >= 0; i--) {
    const id = ids[i];
    const shape = shapes.get(id)!;
    // Fast reject: tap outside bbox + tol.
    const b = shape.bbox;
    if (b) {
      if (px < b.minX - tolerance || px > b.maxX + tolerance ||
          py < b.minY - tolerance || py > b.maxY + tolerance) {
        continue;
      }
    }
    const distSq = shapeHitDistanceSq(px, py, shape, mode);
    if (distSq <= tolSq) {
      // Topmost match wins — we iterate reverse, so return on first.
      return { id, distSq };
    }
    if (!best || distSq < best.distSq) best = { id, distSq };
  }
  // Within tolerance? Otherwise null.
  if (best && best.distSq <= tolSq) return best;
  return null;
}

function hitTestBoundingBox(
  point: [number, number],
  shapes: Map<string, IndexedShape>,
  tolerance: number,
): HitResult | null {
  const [px, py] = point;
  const ids = Array.from(shapes.keys());
  for (let i = ids.length - 1; i >= 0; i--) {
    const id = ids[i];
    const b = shapes.get(id)!.bbox;
    if (!b) continue;
    if (px >= b.minX - tolerance && px <= b.maxX + tolerance &&
        py >= b.minY - tolerance && py <= b.maxY + tolerance) {
      return { id, distSq: 0 };
    }
  }
  return null;
}

/**
 * Distance (squared) from a tap point to the painted area of a shape.
 * Returns 0 if the tap is inside the fill region; otherwise the min
 * distance to the stroke.
 */
function shapeHitDistanceSq(
  px: number, py: number,
  shape: IndexedShape,
  mode: HitTestMode,
): number {
  const polyline = shape.flattened;
  if (!polyline || polyline.length < 4) {
    // Fall back to bbox if we don't have flattened geometry (e.g. text
    // labels we never need to fall through anyway).
    return shape.bbox && pointInBBox(px, py, shape.bbox) ? 0 : Infinity;
  }
  // Stroke check.
  const strokeDistSq = pointToPolylineSqDist(px, py, polyline);
  if (mode === 'stroke-only') return strokeDistSq;
  // Fill check (closed shapes only — open polylines have no interior).
  if (shape.closed) {
    const inside = pointInPolygon(px, py, polyline);
    if (inside) return 0;
  }
  if (mode === 'fill-only') return Infinity;
  return strokeDistSq;
}

function pointInBBox(
  px: number, py: number,
  b: { minX: number; minY: number; maxX: number; maxY: number },
): boolean {
  return px >= b.minX && px <= b.maxX && py >= b.minY && py <= b.maxY;
}
