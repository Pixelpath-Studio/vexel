// SVG → Graph deriver. Pure, no React.
//
// Strategy for deriving "which elements connect to which":
//   1. Id-pattern matching for known Mermaid + custom conventions:
//        - `edge-X-Y`           → connects X and Y
//        - `L_A_B_N` / `L-A-B-N` (Mermaid flowchart) → connects A and B
//        - `note-X`             → attaches to X
//   2. Geometric fallback for paths whose ids don't name endpoints:
//        - Take the path's first/last point from the `d` attribute.
//        - Find a node (rect/circle/polygon) whose bbox contains that point.
//
// Together this gives "load any well-formed SVG, get a navigable graph".

import { XMLParser } from 'fast-xml-parser';
import type { Graph, IndexedShape, ShapeKind } from './types';
import { collectStyleRules, type ParsedStylesheet } from './cssRules';

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  preserveOrder: true,
});

export interface ParseResult {
  /** Raw parsed tree (preserveOrder format) — needed by the renderer. */
  tree: any;
  /** Top-level <svg> node. */
  svgRoot: any;
  /** Derived graph (shapes + adjacency). */
  graph: Graph;
  /** Parsed <style> blocks: rules, keyframes, @font-face, @import, :root vars. */
  parsedCss: ParsedStylesheet;
}

export function buildGraph(svgText: string): ParseResult {
  const tree = xmlParser.parse(svgText);
  const svgRoot = findNode(tree, 'svg');
  if (!svgRoot) {
    throw new Error('SVG root element not found');
  }
  const viewBox = (attrs(svgRoot)?.viewBox as string) ?? '0 0 720 640';
  const viewBoxRect = parseViewBox(viewBox);

  const shapes = new Map<string, IndexedShape>();
  walk(svgRoot, (node, name) => {
    if (name !== 'g') return;
    const a = attrs(node);
    if (!a?.id) return;
    const id = a.id;
    const shape: IndexedShape = { id, kind: classifyId(id) };
    if (a.class) {
      shape.classes = a.class.split(/\s+/).filter(Boolean);
    }
    const bbox = computeBbox(children(node));
    if (bbox) shape.bbox = bbox;
    const path = firstChild(node, 'path');
    if (path) {
      const d = attrs(path)?.d;
      if (d) {
        const eps = endpointsOfPathD(d);
        if (eps) shape.endpoints = eps;
      }
    }
    shapes.set(id, shape);
  });

  const adjacency = deriveAdjacency(shapes);
  const parsedCss = collectStyleRules(svgRoot, walk, textOf);
  return {
    tree,
    svgRoot,
    graph: { viewBox, viewBoxRect, shapes, adjacency },
    parsedCss,
  };
}

function parseViewBox(vb: string): { x: number; y: number; w: number; h: number } {
  const nums = vb.split(/[\s,]+/).map(Number).filter((n) => !Number.isNaN(n));
  return {
    x: nums[0] ?? 0,
    y: nums[1] ?? 0,
    w: nums[2] ?? 720,
    h: nums[3] ?? 640,
  };
}

// ---------- classification + adjacency ----------

function classifyId(id: string): ShapeKind {
  if (id.startsWith('note')) return 'note';
  if (id.startsWith('edge') || /^L[_-].+[_-].+[_-]\d+$/.test(id)) return 'edge';
  return 'node';
}

const EDGE_ID_PATTERNS = [
  /^edge[-_](.+?)[-_](.+)$/,
  /^L[_-](.+?)[_-](.+?)[_-]\d+$/,
];

function deriveAdjacency(
  shapes: Map<string, IndexedShape>,
): Map<string, { nodes: string[]; edges: string[] }> {
  const adj = new Map<string, { nodes: string[]; edges: string[] }>();
  for (const id of shapes.keys()) adj.set(id, { nodes: [], edges: [] });

  for (const [id, shape] of shapes) {
    if (shape.kind !== 'edge') continue;
    let src: string | undefined;
    let dst: string | undefined;
    for (const pat of EDGE_ID_PATTERNS) {
      const m = id.match(pat);
      if (m) { src = m[1]; dst = m[2]; break; }
    }
    if (src && dst) {
      const srcId = findNodeIdByName(shapes, src);
      const dstId = findNodeIdByName(shapes, dst);
      if (srcId && dstId) {
        link(adj, srcId, dstId, id);
        adj.get(id)!.nodes = [srcId, dstId];
        continue;
      }
    }
    // Geometric fallback.
    if (shape.endpoints) {
      const srcHit = nodeContainingPoint(shapes, shape.endpoints.start);
      const dstHit = nodeContainingPoint(shapes, shape.endpoints.end);
      if (srcHit && dstHit && srcHit !== dstHit) {
        link(adj, srcHit, dstHit, id);
        adj.get(id)!.nodes = [srcHit, dstHit];
      }
    }
  }

  // Notes: note-X attaches to the node named X.
  for (const [id, shape] of shapes) {
    if (shape.kind !== 'note') continue;
    const m = id.match(/^note[-_](.+)$/);
    if (m) {
      const targetId = findNodeIdByName(shapes, m[1]);
      if (targetId) {
        adj.get(id)!.nodes.push(targetId);
        adj.get(targetId)!.nodes.push(id);
      }
    }
  }
  return adj;
}

function findNodeIdByName(shapes: Map<string, IndexedShape>, name: string): string | undefined {
  const candidates = [
    `classGroup-${name}`,
    `flowchart-${name}`,
    `state-${name}`,
    name,
  ];
  for (const c of candidates) if (shapes.has(c)) return c;
  // Numeric-suffix variant: flowchart-X-N
  for (const id of shapes.keys()) {
    if (id.startsWith(`flowchart-${name}-`)) return id;
    if (id.startsWith(`state-${name}-`)) return id;
  }
  return undefined;
}

function nodeContainingPoint(
  shapes: Map<string, IndexedShape>,
  [x, y]: [number, number],
): string | undefined {
  const tol = 6;
  for (const [id, shape] of shapes) {
    if (shape.kind === 'edge') continue;
    const b = shape.bbox;
    if (!b) continue;
    if (x >= b.minX - tol && x <= b.maxX + tol && y >= b.minY - tol && y <= b.maxY + tol) {
      return id;
    }
  }
  return undefined;
}

function link(
  adj: Map<string, { nodes: string[]; edges: string[] }>,
  a: string,
  b: string,
  edgeId: string,
) {
  const ea = adj.get(a)!; const eb = adj.get(b)!;
  if (!ea.nodes.includes(b)) ea.nodes.push(b);
  if (!eb.nodes.includes(a)) eb.nodes.push(a);
  if (!ea.edges.includes(edgeId)) ea.edges.push(edgeId);
  if (!eb.edges.includes(edgeId)) eb.edges.push(edgeId);
}

// ---------- geometry helpers ----------

function computeBbox(kids: Array<[string, any]>) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let seen = false;
  for (const [name, node] of kids) {
    const a = attrs(node);
    if (!a) continue;
    if (name === 'rect') {
      const x = +a.x || 0, y = +a.y || 0, w = +a.width || 0, h = +a.height || 0;
      minX = Math.min(minX, x); minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + w); maxY = Math.max(maxY, y + h);
      seen = true;
    } else if (name === 'circle') {
      const cx = +a.cx || 0, cy = +a.cy || 0, r = +a.r || 0;
      minX = Math.min(minX, cx - r); minY = Math.min(minY, cy - r);
      maxX = Math.max(maxX, cx + r); maxY = Math.max(maxY, cy + r);
      seen = true;
    } else if (name === 'polygon' || name === 'polyline') {
      const pts = parsePoints((a.points as string) ?? '');
      for (const [px, py] of pts) {
        minX = Math.min(minX, px); minY = Math.min(minY, py);
        maxX = Math.max(maxX, px); maxY = Math.max(maxY, py);
      }
      if (pts.length) seen = true;
    }
  }
  return seen ? { minX, minY, maxX, maxY } : undefined;
}

function parsePoints(s: string): Array<[number, number]> {
  const nums = s.split(/[\s,]+/).map(Number).filter((n) => !Number.isNaN(n));
  const out: Array<[number, number]> = [];
  for (let i = 0; i + 1 < nums.length; i += 2) out.push([nums[i], nums[i + 1]]);
  return out;
}

function endpointsOfPathD(d: string): { start: [number, number]; end: [number, number] } | undefined {
  const nums = d.replace(/[A-Za-z,]/g, ' ').split(/\s+/).map(Number).filter((n) => !Number.isNaN(n));
  if (nums.length < 4) return undefined;
  return { start: [nums[0], nums[1]], end: [nums[nums.length - 2], nums[nums.length - 1]] };
}

// ---------- preserveOrder tree helpers ----------

export function findNode(tree: any, name: string): any {
  if (Array.isArray(tree)) {
    for (const item of tree) {
      if (item[name]) return item;
      for (const k of Object.keys(item)) {
        if (k === ':@') continue;
        const r = findNode(item[k], name);
        if (r) return r;
      }
    }
  }
  return undefined;
}

export function attrs(node: any): Record<string, string> | undefined {
  return node?.[':@'];
}

export function children(node: any): Array<[string, any]> {
  if (!node) return [];
  const tagKey = Object.keys(node).find((k) => k !== ':@');
  if (!tagKey) return [];
  const arr = node[tagKey];
  if (!Array.isArray(arr)) return [];
  const out: Array<[string, any]> = [];
  for (const item of arr) {
    for (const k of Object.keys(item)) {
      if (k === ':@') continue;
      out.push([k, item]);
    }
  }
  return out;
}

export function firstChild(node: any, name: string): any | undefined {
  for (const [n, c] of children(node)) if (n === name) return c;
  return undefined;
}

export function walk(node: any, cb: (node: any, name: string) => void): void {
  for (const [name, c] of children(node)) {
    cb(c, name);
    walk(c, cb);
  }
}

export function textOf(node: any): string {
  const tagKey = Object.keys(node).find((k) => k !== ':@');
  if (!tagKey) return '';
  const arr = node[tagKey];
  if (!Array.isArray(arr)) return '';
  return arr.map((c: any) => c['#text'] ?? '').join('');
}
