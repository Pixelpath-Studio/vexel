//! HITX — hit-test acceleration — SPEC §3.7.
//!
//! Wire layout:
//!   rtree_node_count u32
//!   rtree_payload_count u32   (size of the leaf_payload array)
//!   polyline_count u32        (total subpath count across all elements)
//!   rtree_nodes:  count × { aabb f32×4, first_child u32, child_count u16, is_leaf u16 }   (24 B each)
//!   leaf_payload: payload_count × u32
//!   polylines:    polyline_count × {
//!       element_index u32
//!       quant_scale   f32       (i16-per-unit; reconstruct value = base + delta / scale)
//!       base_x        f32
//!       base_y        f32
//!       vertex_count  u32       (total vertices stored; delta[0] is the base itself, == (0,0))
//!       deltas        vertex_count × (i16 dx, i16 dy)
//!       is_closed     u8
//!       _pad          3 B (zeros, align to 4)
//!   }

use crate::error::{Result, VexelError};
use crate::hit::polyline::{Polyline, Subpath};
use crate::hit::rtree::{RTree, RTreeNode};
use crate::ir::{Point, Rect};
use byteorder::{ByteOrder, LittleEndian as LE};

pub const NODE_SIZE: usize = 16 + 4 + 2 + 2; // 24
pub const POLYLINE_HEADER_SIZE: usize = 4 + 4 + 4 + 4 + 4; // 20 (el_idx, scale, bx, by, vc)

pub struct HitxPayload {
    pub rtree: RTree,
    /// One entry per closed/open subpath, plus its owning element_index.
    pub polylines: Vec<PolylineEntry>,
}

#[derive(Debug, Clone)]
pub struct PolylineEntry {
    pub element_index: u32,
    pub vertices: Vec<Point>,
    pub is_closed: bool,
}

pub fn build_polyline_entries(element_polylines: &[(u32, Polyline)]) -> Vec<PolylineEntry> {
    let mut out = Vec::new();
    for (idx, pl) in element_polylines {
        for sp in &pl.subpaths {
            let verts = &pl.vertices[sp.start as usize..sp.end as usize];
            out.push(PolylineEntry {
                element_index: *idx,
                vertices: verts.to_vec(),
                is_closed: sp.closed,
            });
        }
    }
    out
}

pub fn serialize(payload: &HitxPayload) -> Vec<u8> {
    let node_count = payload.rtree.nodes.len() as u32;
    let payload_count = payload.rtree.leaf_payload.len() as u32;
    let polyline_count = payload.polylines.len() as u32;

    let mut out = Vec::with_capacity(
        12 + payload.rtree.nodes.len() * NODE_SIZE
            + payload.rtree.leaf_payload.len() * 4
            + payload.polylines.len() * 64,
    );

    let mut hdr = [0u8; 12];
    LE::write_u32(&mut hdr[0..4], node_count);
    LE::write_u32(&mut hdr[4..8], payload_count);
    LE::write_u32(&mut hdr[8..12], polyline_count);
    out.extend_from_slice(&hdr);

    // Nodes.
    for n in &payload.rtree.nodes {
        let start = out.len();
        out.resize(start + NODE_SIZE, 0);
        let b = &mut out[start..start + NODE_SIZE];
        LE::write_f32(&mut b[0..4], n.aabb.min_x);
        LE::write_f32(&mut b[4..8], n.aabb.min_y);
        LE::write_f32(&mut b[8..12], n.aabb.max_x);
        LE::write_f32(&mut b[12..16], n.aabb.max_y);
        LE::write_u32(&mut b[16..20], n.first_child);
        LE::write_u16(&mut b[20..22], n.child_count);
        LE::write_u16(&mut b[22..24], n.is_leaf);
    }

    // Leaf payload.
    for &p in &payload.rtree.leaf_payload {
        let mut b = [0u8; 4];
        LE::write_u32(&mut b, p);
        out.extend_from_slice(&b);
    }

    // Polylines.
    for pl in &payload.polylines {
        write_polyline(&mut out, pl);
    }

    out
}

fn write_polyline(out: &mut Vec<u8>, pl: &PolylineEntry) {
    let vertex_count = pl.vertices.len() as u32;
    let (base_x, base_y) = pl
        .vertices
        .first()
        .map(|p| (p.x, p.y))
        .unwrap_or((0.0, 0.0));

    // Pick a per-polyline quantization scale so the largest delta fits in i16
    // with some headroom (30000 keeps us comfortably under i16::MAX).
    let mut max_abs = 0.0f32;
    for p in &pl.vertices {
        max_abs = max_abs.max((p.x - base_x).abs()).max((p.y - base_y).abs());
    }
    let quant_scale = if max_abs > 1e-6 {
        (30000.0 / max_abs).min(1e6)
    } else {
        1.0
    };

    let mut hdr = [0u8; POLYLINE_HEADER_SIZE];
    LE::write_u32(&mut hdr[0..4], pl.element_index);
    LE::write_f32(&mut hdr[4..8], quant_scale);
    LE::write_f32(&mut hdr[8..12], base_x);
    LE::write_f32(&mut hdr[12..16], base_y);
    LE::write_u32(&mut hdr[16..20], vertex_count);
    out.extend_from_slice(&hdr);

    for p in &pl.vertices {
        let dx = ((p.x - base_x) * quant_scale)
            .round()
            .clamp(-32768.0, 32767.0) as i16;
        let dy = ((p.y - base_y) * quant_scale)
            .round()
            .clamp(-32768.0, 32767.0) as i16;
        let mut b = [0u8; 4];
        LE::write_i16(&mut b[0..2], dx);
        LE::write_i16(&mut b[2..4], dy);
        out.extend_from_slice(&b);
    }

    out.push(pl.is_closed as u8);
    out.extend_from_slice(&[0u8; 3]); // pad
}

#[derive(Debug, Clone, Copy)]
pub struct Hitx<'a> {
    bytes: &'a [u8],
    node_count: u32,
    payload_count: u32,
    polyline_count: u32,
}

impl<'a> Hitx<'a> {
    pub fn new(bytes: &'a [u8]) -> Result<Self> {
        if bytes.len() < 12 {
            return Err(VexelError::InvalidFile("HITX header truncated"));
        }
        let node_count = LE::read_u32(&bytes[0..4]);
        let payload_count = LE::read_u32(&bytes[4..8]);
        let polyline_count = LE::read_u32(&bytes[8..12]);
        Ok(Self {
            bytes,
            node_count,
            payload_count,
            polyline_count,
        })
    }

    fn nodes_offset(&self) -> usize {
        12
    }

    fn payload_offset(&self) -> usize {
        self.nodes_offset() + (self.node_count as usize) * NODE_SIZE
    }

    fn polylines_offset(&self) -> usize {
        self.payload_offset() + (self.payload_count as usize) * 4
    }

    pub fn node(&self, idx: u32) -> RTreeNode {
        let off = self.nodes_offset() + (idx as usize) * NODE_SIZE;
        let b = &self.bytes[off..off + NODE_SIZE];
        RTreeNode {
            aabb: Rect {
                min_x: LE::read_f32(&b[0..4]),
                min_y: LE::read_f32(&b[4..8]),
                max_x: LE::read_f32(&b[8..12]),
                max_y: LE::read_f32(&b[12..16]),
            },
            first_child: LE::read_u32(&b[16..20]),
            child_count: LE::read_u16(&b[20..22]),
            is_leaf: LE::read_u16(&b[22..24]),
        }
    }

    pub fn payload(&self, idx: u32) -> u32 {
        let off = self.payload_offset() + (idx as usize) * 4;
        LE::read_u32(&self.bytes[off..off + 4])
    }

    /// Walks the R-tree top-down (root is the last node by build convention),
    /// collecting every element_index whose leaf bbox contains `(x, y)`.
    pub fn query_point(&self, x: f32, y: f32) -> Vec<u32> {
        if self.node_count == 0 {
            return Vec::new();
        }
        let mut out = Vec::new();
        let mut stack = vec![self.node_count - 1]; // root = last node
        while let Some(node_idx) = stack.pop() {
            let n = self.node(node_idx);
            if !n.aabb.contains(x, y) {
                continue;
            }
            if n.is_leaf == 1 {
                for i in 0..n.child_count {
                    out.push(self.payload(n.first_child + i as u32));
                }
            } else {
                for i in 0..n.child_count {
                    stack.push(n.first_child + i as u32);
                }
            }
        }
        out
    }

    /// Materialize the polyline (one or more subpaths) for an element_index by
    /// linear scan. v1 — fine for ≤10⁴ elements.
    pub fn polyline_for(&self, element_index: u32) -> Polyline {
        let mut cursor = self.polylines_offset();
        let mut out = Polyline::default();
        for _ in 0..self.polyline_count {
            let el = LE::read_u32(&self.bytes[cursor..cursor + 4]);
            let scale = LE::read_f32(&self.bytes[cursor + 4..cursor + 8]);
            let bx = LE::read_f32(&self.bytes[cursor + 8..cursor + 12]);
            let by = LE::read_f32(&self.bytes[cursor + 12..cursor + 16]);
            let vc = LE::read_u32(&self.bytes[cursor + 16..cursor + 20]) as usize;
            let deltas_start = cursor + 20;
            let deltas_end = deltas_start + vc * 4;
            let is_closed = self.bytes[deltas_end] == 1;
            let next = deltas_end + 4;

            if el == element_index {
                let start = out.vertices.len() as u32;
                let inv = if scale.abs() > 1e-9 { 1.0 / scale } else { 0.0 };
                for v in 0..vc {
                    let off = deltas_start + v * 4;
                    let dx = LE::read_i16(&self.bytes[off..off + 2]) as f32;
                    let dy = LE::read_i16(&self.bytes[off + 2..off + 4]) as f32;
                    out.vertices.push(Point::new(bx + dx * inv, by + dy * inv));
                }
                out.subpaths.push(Subpath {
                    start,
                    end: out.vertices.len() as u32,
                    closed: is_closed,
                });
            }

            cursor = next;
        }
        out
    }
}
