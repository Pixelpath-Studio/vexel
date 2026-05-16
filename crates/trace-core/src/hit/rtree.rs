//! Sort-Tile-Recursive (STR) packed R-tree.
//!
//! Built once at convert time, queried at hit-test time. Fanout 16 per SPEC
//! §3.7. The tree is stored as a flat `Vec<RTreeNode>` plus a flat
//! `Vec<u32>` leaf payload (element_indexes); both are mmap-friendly when
//! serialized into HITX.

use crate::ir::Rect;

pub const FANOUT: usize = 16;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct RTreeNode {
    pub aabb: Rect,
    /// Index into the node array (internal) or the leaf payload (leaf).
    pub first_child: u32,
    pub child_count: u16,
    pub is_leaf: u16,
}

#[derive(Debug, Clone, Default)]
pub struct RTree {
    pub nodes: Vec<RTreeNode>,
    pub leaf_payload: Vec<u32>, // packed element_indexes
    pub root: u32,
}

/// Build an STR R-tree from `(element_index, aabb)` pairs.
pub fn build(items: &[(u32, Rect)]) -> RTree {
    if items.is_empty() {
        let mut t = RTree::default();
        t.nodes.push(RTreeNode {
            aabb: Rect::EMPTY,
            first_child: 0,
            child_count: 0,
            is_leaf: 1,
        });
        return t;
    }

    // Sort by x-center, partition into vertical slices, then sort each by
    // y-center and partition into leaves. Classic STR construction.
    let n = items.len();
    let leaf_count = n.div_ceil(FANOUT);
    let slice_count = (leaf_count as f64).sqrt().ceil() as usize;
    let per_slice = n.div_ceil(slice_count);

    let mut sorted: Vec<(u32, Rect)> = items.to_vec();
    sorted.sort_by(|a, b| {
        center_x(&a.1)
            .partial_cmp(&center_x(&b.1))
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    let mut tree = RTree::default();

    // Build leaves.
    let mut leaves: Vec<(Rect, u32, u16)> = Vec::new(); // (aabb, first_child=payload offset, count)
    for slice in sorted.chunks_mut(per_slice) {
        slice.sort_by(|a, b| {
            center_y(&a.1)
                .partial_cmp(&center_y(&b.1))
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        for leaf_chunk in slice.chunks(FANOUT) {
            let mut bbox = Rect::EMPTY;
            let first_child = tree.leaf_payload.len() as u32;
            for (idx, r) in leaf_chunk {
                tree.leaf_payload.push(*idx);
                bbox = union(bbox, *r);
            }
            leaves.push((bbox, first_child, leaf_chunk.len() as u16));
        }
    }

    // Materialize leaf nodes.
    let leaf_node_start = tree.nodes.len();
    for (bbox, first_child, count) in &leaves {
        tree.nodes.push(RTreeNode {
            aabb: *bbox,
            first_child: *first_child,
            child_count: *count,
            is_leaf: 1,
        });
    }

    // Build upper levels bottom-up by packing FANOUT siblings at a time, with
    // a single slice per level (the slices-per-level refinement isn't worth
    // the complexity for v1 — typical scenes are <2000 elements, ≤2 levels
    // above the leaves).
    let mut prev_start = leaf_node_start;
    let mut prev_count = leaves.len();
    while prev_count > 1 {
        let level_start = tree.nodes.len();
        let mut i = 0;
        while i < prev_count {
            let end = (i + FANOUT).min(prev_count);
            let mut bbox = Rect::EMPTY;
            for j in i..end {
                bbox = union(bbox, tree.nodes[prev_start + j].aabb);
            }
            tree.nodes.push(RTreeNode {
                aabb: bbox,
                first_child: (prev_start + i) as u32,
                child_count: (end - i) as u16,
                is_leaf: 0,
            });
            i = end;
        }
        prev_count = tree.nodes.len() - level_start;
        prev_start = level_start;
    }

    tree.root = (tree.nodes.len() - 1) as u32;
    tree
}

fn center_x(r: &Rect) -> f32 {
    (r.min_x + r.max_x) * 0.5
}
fn center_y(r: &Rect) -> f32 {
    (r.min_y + r.max_y) * 0.5
}
fn union(a: Rect, b: Rect) -> Rect {
    if a.min_x > a.max_x {
        return b;
    }
    if b.min_x > b.max_x {
        return a;
    }
    Rect {
        min_x: a.min_x.min(b.min_x),
        min_y: a.min_y.min(b.min_y),
        max_x: a.max_x.max(b.max_x),
        max_y: a.max_y.max(b.max_y),
    }
}

/// Query: every element whose bbox contains (x, y), in unspecified order.
/// Callers re-sort by z-order (i.e. element_index, top-down).
pub fn query_point(tree: &RTree, x: f32, y: f32) -> Vec<u32> {
    if tree.nodes.is_empty() {
        return Vec::new();
    }
    let mut out = Vec::new();
    let mut stack = vec![tree.root];
    while let Some(node_idx) = stack.pop() {
        let n = tree.nodes[node_idx as usize];
        if !n.aabb.contains(x, y) {
            continue;
        }
        if n.is_leaf == 1 {
            let s = n.first_child as usize;
            let e = s + n.child_count as usize;
            out.extend_from_slice(&tree.leaf_payload[s..e]);
        } else {
            let s = n.first_child as usize;
            for i in 0..n.child_count as usize {
                stack.push((s + i) as u32);
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn r(min_x: f32, min_y: f32, max_x: f32, max_y: f32) -> Rect {
        Rect {
            min_x,
            min_y,
            max_x,
            max_y,
        }
    }

    #[test]
    fn empty_tree_returns_nothing() {
        let t = build(&[]);
        assert!(query_point(&t, 0.0, 0.0).is_empty());
    }

    #[test]
    fn single_element() {
        let t = build(&[(7, r(0.0, 0.0, 10.0, 10.0))]);
        let hits = query_point(&t, 5.0, 5.0);
        assert_eq!(hits, vec![7]);
        let miss = query_point(&t, 20.0, 20.0);
        assert!(miss.is_empty());
    }

    #[test]
    fn many_elements_grid() {
        // 5x5 grid of 10×10 squares from (0,0) to (50,50).
        let mut items = Vec::new();
        let mut k = 0u32;
        for j in 0..5 {
            for i in 0..5 {
                items.push((
                    k,
                    r(
                        i as f32 * 10.0,
                        j as f32 * 10.0,
                        (i + 1) as f32 * 10.0,
                        (j + 1) as f32 * 10.0,
                    ),
                ));
                k += 1;
            }
        }
        let t = build(&items);
        // (25, 25) is in cell (2,2) → index 12.
        let hits = query_point(&t, 25.0, 25.0);
        assert!(hits.contains(&12), "got {hits:?}");
    }

    #[test]
    fn overlapping_returns_all() {
        let items = vec![
            (0u32, r(0.0, 0.0, 20.0, 20.0)),
            (1, r(5.0, 5.0, 25.0, 25.0)),
            (2, r(10.0, 10.0, 30.0, 30.0)),
        ];
        let t = build(&items);
        let mut hits = query_point(&t, 15.0, 15.0);
        hits.sort();
        assert_eq!(hits, vec![0, 1, 2]);
    }
}
