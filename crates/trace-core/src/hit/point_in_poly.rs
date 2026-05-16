//! Point-in-polygon for both fill rules. Walks every closed subpath; the
//! interpretation differs per rule:
//!
//! - **Even-odd**: count edge crossings; inside iff odd.
//! - **Non-zero**: sum signed crossings; inside iff non-zero.
//!
//! Open subpaths (no `Close` verb) contribute nothing to fill testing; their
//! geometry only matters for stroke distance.

use super::polyline::Polyline;
use crate::ir::Point;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FillRule {
    NonZero,
    EvenOdd,
}

pub fn contains(poly: &Polyline, x: f32, y: f32, rule: FillRule) -> bool {
    let mut signed_crossings: i32 = 0;
    let mut crossings: u32 = 0;

    for sp in &poly.subpaths {
        if !sp.closed {
            continue;
        }
        let verts = &poly.vertices[sp.start as usize..sp.end as usize];
        if verts.len() < 2 {
            continue;
        }
        for i in 0..verts.len() {
            let a = verts[i];
            let b = verts[(i + 1) % verts.len()];
            if let Some(sign) = ray_crosses(Point::new(x, y), a, b) {
                signed_crossings += sign;
                crossings += 1;
            }
        }
    }

    match rule {
        FillRule::EvenOdd => (crossings & 1) == 1,
        FillRule::NonZero => signed_crossings != 0,
    }
}

/// Returns Some(+1) for an upward crossing, Some(-1) for a downward crossing,
/// None for no crossing. Crossings exactly at vertex y are biased to avoid
/// double-counting (Sunday's "edge-crosses-ray" trick).
fn ray_crosses(p: Point, a: Point, b: Point) -> Option<i32> {
    let (lo, hi, sign) = if a.y <= b.y { (a, b, 1) } else { (b, a, -1) };
    if p.y < lo.y || p.y >= hi.y {
        return None;
    }
    let t = (p.y - lo.y) / (hi.y - lo.y);
    let x_at = lo.x + t * (hi.x - lo.x);
    if p.x < x_at {
        Some(sign)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hit::polyline::flatten;
    use crate::ir::Path;

    fn rect(x: f32, y: f32, w: f32, h: f32) -> Polyline {
        let mut p = Path::new();
        p.move_to(x, y);
        p.line_to(x + w, y);
        p.line_to(x + w, y + h);
        p.line_to(x, y + h);
        p.close();
        flatten(&p)
    }

    #[test]
    fn rect_contains_center() {
        let pl = rect(0.0, 0.0, 10.0, 10.0);
        assert!(contains(&pl, 5.0, 5.0, FillRule::NonZero));
        assert!(contains(&pl, 5.0, 5.0, FillRule::EvenOdd));
    }

    #[test]
    fn rect_excludes_outside() {
        let pl = rect(0.0, 0.0, 10.0, 10.0);
        assert!(!contains(&pl, -1.0, 5.0, FillRule::NonZero));
        assert!(!contains(&pl, 100.0, 100.0, FillRule::EvenOdd));
    }

    #[test]
    fn donut_evenodd_hole() {
        // Outer rect 0..10 + inner rect 3..7 → ring with even-odd rule.
        let mut p = Path::new();
        p.move_to(0.0, 0.0);
        p.line_to(10.0, 0.0);
        p.line_to(10.0, 10.0);
        p.line_to(0.0, 10.0);
        p.close();
        p.move_to(3.0, 3.0);
        p.line_to(7.0, 3.0);
        p.line_to(7.0, 7.0);
        p.line_to(3.0, 7.0);
        p.close();
        let pl = flatten(&p);
        // Center should be a hole under even-odd.
        assert!(!contains(&pl, 5.0, 5.0, FillRule::EvenOdd));
        // Outside the donut wall but inside the outer rect.
        assert!(contains(&pl, 1.0, 1.0, FillRule::EvenOdd));
    }
}
