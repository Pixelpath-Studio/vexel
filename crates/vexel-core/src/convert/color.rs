//! Resolve usvg paint values to our straight-sRGB `Rgba`.
//!
//! Gradients are flattened to a representative solid in v1 (linear: average of
//! endpoint stops; radial: same approach — full gradient support lands in v1.1
//! per SPEC §16).

use crate::ir::Rgba;
use usvg::Paint;

pub fn paint_to_rgba(paint: Option<&Paint>, opacity: f32) -> Rgba {
    let Some(paint) = paint else {
        return Rgba::TRANSPARENT;
    };
    let alpha_scale = opacity.clamp(0.0, 1.0);
    match paint {
        Paint::Color(c) => {
            let a = (alpha_scale * 255.0).round().clamp(0.0, 255.0) as u8;
            Rgba::from_rgba(c.red, c.green, c.blue, a)
        }
        Paint::LinearGradient(g) => average_stops(g.stops(), alpha_scale),
        Paint::RadialGradient(g) => average_stops(g.stops(), alpha_scale),
        Paint::Pattern(_) => {
            // Patterns are deferred to v1.2 — render as transparent for v1.
            Rgba::TRANSPARENT
        }
    }
}

fn average_stops(stops: &[usvg::Stop], alpha_scale: f32) -> Rgba {
    if stops.is_empty() {
        return Rgba::TRANSPARENT;
    }
    let mut r = 0u32;
    let mut g = 0u32;
    let mut b = 0u32;
    let mut a = 0u32;
    for s in stops {
        let c = s.color();
        let stop_alpha = s.opacity().get();
        r += c.red as u32;
        g += c.green as u32;
        b += c.blue as u32;
        a += ((stop_alpha * 255.0).round() as u32).min(255);
    }
    let n = stops.len() as u32;
    let r = (r / n) as u8;
    let g = (g / n) as u8;
    let b = (b / n) as u8;
    let a = (((a / n) as f32) * alpha_scale).round().clamp(0.0, 255.0) as u8;
    Rgba::from_rgba(r, g, b, a)
}
