//! Hit-test acceleration — SPEC §3.7 / §4.3.

pub mod distance;
pub mod point_in_poly;
pub mod polyline;
pub mod rtree;

use crate::error::Result;
use crate::format::hitx::{build_polyline_entries, serialize, HitxPayload};
use crate::ir::Ir;
use crate::serialize::ExtraSection;
use crate::SectionKind;

/// Hit-test query mode — SPEC §4.3.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HitMode {
    /// Standard SVG default: hit on visible fill *or* visible stroke.
    VisiblePainted,
    /// Hit only on visible stroke.
    VisibleStroke,
    /// Hit only on visible fill.
    VisibleFill,
    /// Hit on any element (including invisible).
    All,
    /// Hit on the element bounding box (cheapest).
    BoundingBox,
}

/// Build a HITX section payload from an IR. Flattens each element's path,
/// constructs an R-tree over the bboxes, and packs the polylines.
pub fn build_hitx_extra(ir: &Ir) -> Result<ExtraSection> {
    let mut bboxes = Vec::with_capacity(ir.elements.len());
    let mut element_polylines = Vec::with_capacity(ir.elements.len());
    for (idx, el) in ir.elements.iter().enumerate() {
        let pl = polyline::flatten(&el.path);
        bboxes.push((idx as u32, el.bbox));
        element_polylines.push((idx as u32, pl));
    }
    let tree = rtree::build(&bboxes);
    let polylines = build_polyline_entries(&element_polylines);
    let payload = HitxPayload {
        rtree: tree,
        polylines,
    };
    Ok(ExtraSection {
        kind: SectionKind::HITX,
        payload: serialize(&payload),
    })
}
