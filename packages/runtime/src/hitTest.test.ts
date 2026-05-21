// Unit tests for hitTest.ts — painted-area hit resolver.
// Run with: node --experimental-strip-types src/hitTest.test.ts

import {
  flattenPath,
  hitTestShapes,
  pointInPolygon,
  pointToPolylineSqDist,
  pointToSegmentSqDist,
} from './hitTest.ts';
import type { IndexedShape } from './types.ts';

let passed = 0;
let failed = 0;
const failures: string[] = [];

function it(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e: any) {
    failed++;
    failures.push(`${name}: ${e?.message ?? e}`);
    console.log(`  ✗ ${name}`);
    console.log(`    ${e?.message ?? e}`);
  }
}
function describe(name: string, fn: () => void) {
  console.log(`\n${name}`);
  fn();
}
function assert(cond: any, msg = 'assert failed'): asserts cond {
  if (!cond) throw new Error(msg);
}
function approxEq(actual: number, expected: number, eps = 0.01, msg?: string) {
  if (Math.abs(actual - expected) > eps) {
    throw new Error(msg ?? `expected ~${expected}, got ${actual}`);
  }
}

// ============================================================================
// Path flattener
// ============================================================================

describe('flattenPath', () => {
  it('flattens an absolute line path', () => {
    const pts = flattenPath('M 0,0 L 100,0 L 100,100 L 0,100 Z');
    // M produces 1 point, each L produces 1 point, Z adds the start back.
    // Result: (0,0), (100,0), (100,100), (0,100), (0,0)
    assert(pts.length === 10, `expected 10 floats, got ${pts.length}`);
    approxEq(pts[0], 0); approxEq(pts[1], 0);
    approxEq(pts[2], 100); approxEq(pts[3], 0);
    approxEq(pts[8], 0); approxEq(pts[9], 0);
  });

  it('flattens relative line commands', () => {
    // M0,0 then l10,0 l0,10 = (0,0), (10,0), (10,10)
    const pts = flattenPath('M0,0 l10,0 l0,10');
    assert(pts.length === 6);
    approxEq(pts[0], 0); approxEq(pts[1], 0);
    approxEq(pts[2], 10); approxEq(pts[3], 0);
    approxEq(pts[4], 10); approxEq(pts[5], 10);
  });

  it('flattens a quadratic curve to a polyline', () => {
    // A Q curve from (0,0) ctrl (50,100) end (100,0) — apex at (50,50).
    const pts = flattenPath('M0,0 Q50,100 100,0');
    // Should produce many sample points. Last point ≈ (100, 0).
    assert(pts.length >= 30, `expected many samples, got ${pts.length / 2} pts`);
    approxEq(pts[pts.length - 2], 100);
    approxEq(pts[pts.length - 1], 0);
    // Midpoint y should be ~50 (apex).
    const mid = Math.floor(pts.length / 4) * 2;
    assert(pts[mid + 1] > 30, `expected curve apex, got y=${pts[mid + 1]}`);
  });

  it('flattens H and V commands', () => {
    const pts = flattenPath('M5,5 H20 V25');
    assert(pts.length === 6);
    approxEq(pts[2], 20); approxEq(pts[3], 5);   // H to x=20
    approxEq(pts[4], 20); approxEq(pts[5], 25);  // V to y=25
  });

  it('handles implicit-L after M', () => {
    // M followed by extra coord pairs = implicit L
    const pts = flattenPath('M0,0 10,10 20,20');
    assert(pts.length === 6);
    approxEq(pts[0], 0); approxEq(pts[1], 0);
    approxEq(pts[2], 10); approxEq(pts[3], 10);
    approxEq(pts[4], 20); approxEq(pts[5], 20);
  });

  it('handles cubic Bézier', () => {
    const pts = flattenPath('M0,0 C0,100 100,100 100,0');
    approxEq(pts[pts.length - 2], 100);
    approxEq(pts[pts.length - 1], 0);
    // The curve goes up — midpoint y > 0.
    let maxY = 0;
    for (let i = 1; i < pts.length; i += 2) maxY = Math.max(maxY, pts[i]);
    assert(maxY > 30, `expected curve to bulge up, peak=${maxY}`);
  });

  it('handles arcs (A command)', () => {
    // Half-circle from (0,0) to (100,0) sweeping up.
    const pts = flattenPath('M0,0 A50,50 0 0 1 100,0');
    approxEq(pts[pts.length - 2], 100);
    approxEq(pts[pts.length - 1], 0);
    // Should bulge down (sweep=1 in SVG = clockwise = below the chord here).
    // Just assert the arc was sampled with reasonable point count.
    assert(pts.length >= 30);
  });
});

// ============================================================================
// Distance primitives
// ============================================================================

describe('pointToSegmentSqDist', () => {
  it('returns 0 when on the segment', () => {
    approxEq(pointToSegmentSqDist(5, 5, 0, 0, 10, 10), 0);
  });
  it('returns squared distance to segment endpoints when projection falls outside', () => {
    // Point (20, 20), segment (0,0)-(10,10): projection at t=2, clamped to t=1.
    // Nearest point on segment = (10,10), distance² = 200.
    approxEq(pointToSegmentSqDist(20, 20, 0, 0, 10, 10), 200);
  });
  it('returns perpendicular squared distance', () => {
    // Point (0, 10), segment (0,0)-(10,0): perpendicular distance = 10, sq=100.
    approxEq(pointToSegmentSqDist(0, 10, 0, 0, 10, 0), 100);
  });
});

describe('pointToPolylineSqDist', () => {
  it('walks every segment and returns the minimum', () => {
    // Square polyline (0,0)(10,0)(10,10)(0,10).
    const sq = new Float64Array([0, 0, 10, 0, 10, 10, 0, 10]);
    // Tap at (5, -5) — 5 above the top edge.
    approxEq(pointToPolylineSqDist(5, -5, sq), 25);
    // Tap at (5, 5) — center of the square. Min distance to edges = 5.
    approxEq(pointToPolylineSqDist(5, 5, sq), 25);
  });
});

describe('pointInPolygon', () => {
  it('detects inside / outside of a square', () => {
    const sq = new Float64Array([0, 0, 10, 0, 10, 10, 0, 10]);
    assert(pointInPolygon(5, 5, sq) === true);
    assert(pointInPolygon(20, 5, sq) === false);
    assert(pointInPolygon(-1, 5, sq) === false);
  });

  it('detects inside a triangle', () => {
    const tri = new Float64Array([0, 0, 10, 0, 5, 10]);
    assert(pointInPolygon(5, 2, tri) === true);
    assert(pointInPolygon(5, 11, tri) === false);
    assert(pointInPolygon(15, 5, tri) === false);
  });
});

// ============================================================================
// Top-level resolver
// ============================================================================

describe('hitTestShapes', () => {
  function makeRect(id: string, x: number, y: number, w: number, h: number): IndexedShape {
    return {
      id,
      kind: 'node',
      bbox: { minX: x, minY: y, maxX: x + w, maxY: y + h },
      flattened: new Float64Array([
        x, y,
        x + w, y,
        x + w, y + h,
        x, y + h,
        x, y,
      ]),
      closed: true,
    };
  }

  it('returns null when tap is far from any shape', () => {
    const shapes = new Map([['a', makeRect('a', 0, 0, 10, 10)]]);
    const r = hitTestShapes([100, 100], shapes, 'visible-painted', 6);
    assert(r === null);
  });

  it('returns the id when tap is inside the painted rect', () => {
    const shapes = new Map([['a', makeRect('a', 0, 0, 10, 10)]]);
    const r = hitTestShapes([5, 5], shapes, 'visible-painted', 6);
    assert(r?.id === 'a');
    assert(r?.distSq === 0);
  });

  it('returns the topmost (last-drawn) shape when bboxes overlap', () => {
    // Two overlapping rects. Tap inside both — bottom of map should win.
    const shapes = new Map([
      ['below', makeRect('below', 0, 0, 100, 100)],
      ['above', makeRect('above', 20, 20, 60, 60)],
    ]);
    const r = hitTestShapes([50, 50], shapes, 'visible-painted', 6);
    assert(r?.id === 'above', `expected topmost, got ${r?.id}`);
  });

  it('falls through to background when tap is outside the painted path of a diagonal line', () => {
    // Thin diagonal path from (0,0) to (100,100). Tap at (90, 10) is in
    // the bbox but ~57px from the painted line — beyond default tolerance.
    const shape: IndexedShape = {
      id: 'line',
      kind: 'edge',
      bbox: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
      flattened: new Float64Array([0, 0, 100, 100]),
      closed: false,
    };
    const shapes = new Map([['line', shape]]);
    const r = hitTestShapes([90, 10], shapes, 'visible-painted', 6);
    assert(r === null, `expected miss (diagonal line, tap in empty corner), got ${r?.id}`);
  });

  it('hits the line within tolerance', () => {
    const shape: IndexedShape = {
      id: 'line',
      kind: 'edge',
      bbox: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
      flattened: new Float64Array([0, 0, 100, 100]),
      closed: false,
    };
    const shapes = new Map([['line', shape]]);
    // Tap at (50, 52) — perpendicular distance to y=x is sqrt(2) ≈ 1.4
    const r = hitTestShapes([50, 52], shapes, 'visible-painted', 6);
    assert(r?.id === 'line');
  });

  it('bounding-box mode hits the corner of a diagonal line', () => {
    const shape: IndexedShape = {
      id: 'line',
      kind: 'edge',
      bbox: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
      flattened: new Float64Array([0, 0, 100, 100]),
      closed: false,
    };
    const shapes = new Map([['line', shape]]);
    // The fundamental difference: bbox mode says "you tapped the line"
    // even in the empty corner. Painted-area mode rejects.
    const bboxHit = hitTestShapes([90, 10], shapes, 'bounding-box', 6);
    assert(bboxHit?.id === 'line', 'bbox mode should be lax');
    const paintedMiss = hitTestShapes([90, 10], shapes, 'visible-painted', 6);
    assert(paintedMiss === null, 'painted mode should be precise');
  });
});

// ============================================================================
// Runner
// ============================================================================

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
