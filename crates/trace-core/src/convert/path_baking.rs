//! Lower a `tiny_skia_path::Path` (post-usvg, transforms already baked) into
//! our verb-stream `ir::Path`.
//!
//! usvg has already done the heavy lifting: arcs are flattened, transforms are
//! pushed into the points, markers are expanded. Our job is just to translate
//! the verb enum.

use crate::ir::{Path as IrPath, Point as IrPoint};
use tiny_skia_path::PathSegment;

pub fn from_tiny_skia(path: &tiny_skia_path::Path) -> IrPath {
    let mut out = IrPath::new();
    for seg in path.segments() {
        match seg {
            PathSegment::MoveTo(p) => out.move_to(p.x, p.y),
            PathSegment::LineTo(p) => out.line_to(p.x, p.y),
            PathSegment::QuadTo(c, p) => out.quad_to(c.x, c.y, p.x, p.y),
            PathSegment::CubicTo(c1, c2, p) => out.cubic_to(c1.x, c1.y, c2.x, c2.y, p.x, p.y),
            PathSegment::Close => out.close(),
        }
    }
    out
}

/// Compute the axis-aligned bounding box of an IR path including the stroke
/// half-width. The stroke half-width is added uniformly — this is a conservative
/// bound, not the tight stroke shape, and matches what SPEC §3.4 documents as
/// the bbox semantics.
pub fn bbox(path: &IrPath, stroke_width: f32) -> crate::ir::Rect {
    let mut r = crate::ir::Rect::EMPTY;
    for IrPoint { x, y } in &path.points {
        r.min_x = r.min_x.min(*x);
        r.min_y = r.min_y.min(*y);
        r.max_x = r.max_x.max(*x);
        r.max_y = r.max_y.max(*y);
    }
    if path.points.is_empty() {
        return crate::ir::Rect {
            min_x: 0.0,
            min_y: 0.0,
            max_x: 0.0,
            max_y: 0.0,
        };
    }
    let pad = stroke_width * 0.5;
    crate::ir::Rect {
        min_x: r.min_x - pad,
        min_y: r.min_y - pad,
        max_x: r.max_x + pad,
        max_y: r.max_y + pad,
    }
}
