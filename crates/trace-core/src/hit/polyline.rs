//! Flatten an IR `Path` to a polyline for hit-testing. Cubics and quads are
//! subdivided until the chord-to-curve error is below `tolerance` in viewBox
//! units. Recursive De Casteljau subdivision — simple, robust, no transcendentals.

use crate::ir::{Path, Point, Verb};

/// A flat polyline. Each entry in `subpaths` is one connected run (between
/// MoveTo and Close/end).
#[derive(Debug, Clone, Default)]
pub struct Polyline {
    pub vertices: Vec<Point>,
    /// Index ranges into `vertices` for each closed/open subpath.
    pub subpaths: Vec<Subpath>,
}

#[derive(Debug, Clone, Copy)]
pub struct Subpath {
    pub start: u32,
    pub end: u32, // exclusive
    pub closed: bool,
}

const DEFAULT_TOLERANCE: f32 = 0.5; // viewBox units

pub fn flatten(path: &Path) -> Polyline {
    flatten_with_tolerance(path, DEFAULT_TOLERANCE)
}

pub fn flatten_with_tolerance(path: &Path, tol: f32) -> Polyline {
    let mut out = Polyline::default();
    let tol2 = tol * tol;
    let mut cursor = Point::new(0.0, 0.0);
    let mut subpath_start: u32 = 0;
    let mut subpath_origin = Point::new(0.0, 0.0);
    let mut point_idx = 0usize;

    let push = |out: &mut Polyline, p: Point| {
        out.vertices.push(p);
    };

    for v in &path.verbs {
        match v {
            Verb::Move => {
                // Close out any previous open subpath (no `Close` verb).
                if (out.vertices.len() as u32) > subpath_start {
                    out.subpaths.push(Subpath {
                        start: subpath_start,
                        end: out.vertices.len() as u32,
                        closed: false,
                    });
                }
                let p = path.points[point_idx];
                point_idx += 1;
                cursor = p;
                subpath_origin = p;
                subpath_start = out.vertices.len() as u32;
                push(&mut out, p);
            }
            Verb::Line => {
                let p = path.points[point_idx];
                point_idx += 1;
                push(&mut out, p);
                cursor = p;
            }
            Verb::Quad => {
                let c = path.points[point_idx];
                let p = path.points[point_idx + 1];
                point_idx += 2;
                flatten_quad(&mut out, cursor, c, p, tol2);
                cursor = p;
            }
            Verb::Cubic => {
                let c1 = path.points[point_idx];
                let c2 = path.points[point_idx + 1];
                let p = path.points[point_idx + 2];
                point_idx += 3;
                flatten_cubic(&mut out, cursor, c1, c2, p, tol2);
                cursor = p;
            }
            Verb::Close => {
                // Close the subpath: emit a line back to origin if not already
                // coincident, and mark closed.
                if dist_sq(cursor, subpath_origin) > 1e-6 {
                    push(&mut out, subpath_origin);
                }
                out.subpaths.push(Subpath {
                    start: subpath_start,
                    end: out.vertices.len() as u32,
                    closed: true,
                });
                cursor = subpath_origin;
                subpath_start = out.vertices.len() as u32;
            }
        }
    }
    // Trailing open subpath.
    if (out.vertices.len() as u32) > subpath_start {
        out.subpaths.push(Subpath {
            start: subpath_start,
            end: out.vertices.len() as u32,
            closed: false,
        });
    }
    out
}

fn dist_sq(a: Point, b: Point) -> f32 {
    let dx = a.x - b.x;
    let dy = a.y - b.y;
    dx * dx + dy * dy
}

fn flatten_quad(out: &mut Polyline, p0: Point, c: Point, p1: Point, tol2: f32) {
    // Error metric: distance from control point to chord midpoint, squared.
    let mid_chord = Point::new((p0.x + p1.x) * 0.5, (p0.y + p1.y) * 0.5);
    if dist_sq(c, mid_chord) <= tol2 {
        out.vertices.push(p1);
        return;
    }
    // De Casteljau subdivision at t=0.5.
    let q0 = mid(p0, c);
    let q1 = mid(c, p1);
    let r = mid(q0, q1);
    flatten_quad(out, p0, q0, r, tol2);
    flatten_quad(out, r, q1, p1, tol2);
}

fn flatten_cubic(out: &mut Polyline, p0: Point, c1: Point, c2: Point, p1: Point, tol2: f32) {
    // Error metric: max distance from control points to chord.
    let d1 = dist_to_segment_sq(c1, p0, p1);
    let d2 = dist_to_segment_sq(c2, p0, p1);
    if d1.max(d2) <= tol2 {
        out.vertices.push(p1);
        return;
    }
    let q0 = mid(p0, c1);
    let q1 = mid(c1, c2);
    let q2 = mid(c2, p1);
    let r0 = mid(q0, q1);
    let r1 = mid(q1, q2);
    let s = mid(r0, r1);
    flatten_cubic(out, p0, q0, r0, s, tol2);
    flatten_cubic(out, s, r1, q2, p1, tol2);
}

fn mid(a: Point, b: Point) -> Point {
    Point::new((a.x + b.x) * 0.5, (a.y + b.y) * 0.5)
}

fn dist_to_segment_sq(p: Point, a: Point, b: Point) -> f32 {
    let dx = b.x - a.x;
    let dy = b.y - a.y;
    let len2 = dx * dx + dy * dy;
    if len2 < 1e-12 {
        return dist_sq(p, a);
    }
    let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
    let t = t.clamp(0.0, 1.0);
    let proj = Point::new(a.x + t * dx, a.y + t * dy);
    dist_sq(p, proj)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ir::Path;

    #[test]
    fn line_passes_through() {
        let mut p = Path::new();
        p.move_to(0.0, 0.0);
        p.line_to(10.0, 0.0);
        let pl = flatten(&p);
        assert_eq!(pl.subpaths.len(), 1);
        assert_eq!(pl.vertices.len(), 2);
        assert!(!pl.subpaths[0].closed);
    }

    #[test]
    fn closed_rect() {
        let mut p = Path::new();
        p.move_to(0.0, 0.0);
        p.line_to(10.0, 0.0);
        p.line_to(10.0, 10.0);
        p.line_to(0.0, 10.0);
        p.close();
        let pl = flatten(&p);
        assert_eq!(pl.subpaths.len(), 1);
        assert!(pl.subpaths[0].closed);
        // 4 verts plus closing back to origin.
        assert!(pl.vertices.len() >= 4);
    }

    #[test]
    fn cubic_is_subdivided() {
        let mut p = Path::new();
        p.move_to(0.0, 0.0);
        p.cubic_to(0.0, 50.0, 100.0, 50.0, 100.0, 0.0);
        let pl = flatten(&p);
        // A bezier with control points way off the chord should produce many
        // segments, not just two.
        assert!(pl.vertices.len() > 8, "got {} verts", pl.vertices.len());
    }
}
