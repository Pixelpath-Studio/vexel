//! Squared point-to-polyline distance. We compare against
//! `(stroke_width/2 + tol)²` at the call site to avoid the sqrt.

use super::polyline::Polyline;
use crate::ir::Point;

pub fn point_to_polyline_sq(poly: &Polyline, x: f32, y: f32) -> f32 {
    let p = Point::new(x, y);
    let mut best = f32::INFINITY;
    for sp in &poly.subpaths {
        let verts = &poly.vertices[sp.start as usize..sp.end as usize];
        if verts.len() < 2 {
            continue;
        }
        let edges = if sp.closed {
            verts.len()
        } else {
            verts.len() - 1
        };
        for i in 0..edges {
            let a = verts[i];
            let b = verts[(i + 1) % verts.len()];
            let d = segment_distance_sq(p, a, b);
            if d < best {
                best = d;
            }
        }
    }
    best
}

fn segment_distance_sq(p: Point, a: Point, b: Point) -> f32 {
    let dx = b.x - a.x;
    let dy = b.y - a.y;
    let len2 = dx * dx + dy * dy;
    if len2 < 1e-12 {
        let ex = p.x - a.x;
        let ey = p.y - a.y;
        return ex * ex + ey * ey;
    }
    let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
    let t = t.clamp(0.0, 1.0);
    let qx = a.x + t * dx;
    let qy = a.y + t * dy;
    let ex = p.x - qx;
    let ey = p.y - qy;
    ex * ex + ey * ey
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hit::polyline::flatten;
    use crate::ir::Path;

    #[test]
    fn point_on_line_is_zero() {
        let mut p = Path::new();
        p.move_to(0.0, 0.0);
        p.line_to(10.0, 0.0);
        let pl = flatten(&p);
        assert!(point_to_polyline_sq(&pl, 5.0, 0.0) < 1e-6);
    }

    #[test]
    fn perpendicular_distance() {
        let mut p = Path::new();
        p.move_to(0.0, 0.0);
        p.line_to(10.0, 0.0);
        let pl = flatten(&p);
        let d2 = point_to_polyline_sq(&pl, 5.0, 3.0);
        assert!((d2 - 9.0).abs() < 1e-4, "got {d2}");
    }

    #[test]
    fn endpoint_distance() {
        let mut p = Path::new();
        p.move_to(0.0, 0.0);
        p.line_to(10.0, 0.0);
        let pl = flatten(&p);
        let d2 = point_to_polyline_sq(&pl, -3.0, 4.0);
        // Clamp to endpoint (0,0); distance √(9+16) = 5 → 25.
        assert!((d2 - 25.0).abs() < 1e-4, "got {d2}");
    }
}
