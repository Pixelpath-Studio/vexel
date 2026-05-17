//! Streaming `Session` — SPEC §4.5.
//!
//! Holds a mutable IR plus pending animation tracks. Each `append_svg_fragment`
//! call parses the fragment, appends new elements, schedules animations, and
//! returns the synthesized ids so the caller can correlate with the source.
//!
//! Enforced DoS limits (SPEC Implementation notes):
//!   - max 65,536 elements
//!   - max 16 MB total geometry
//!   - max 10,000 pending animation tracks

pub mod fragment;

use crate::convert::{convert_svg_to_ir, ConvertOptions};
use crate::error::{Result, VexelError};
use crate::format::anim::{AnimTrack, Easing, TrackType};
use crate::ir::{Ir, ViewBox};
use crate::serialize::{write_with_extras, ExtraSection, WriterOptions};
use crate::SectionKind;
use std::collections::HashMap;

pub const MAX_ELEMENTS: usize = 65_536;
pub const MAX_GEOM_BYTES: usize = 16 * 1024 * 1024;
pub const MAX_PENDING_ANIM_TRACKS: usize = 10_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StartAfter {
    Immediately,
    PreviousFragment,
    AtMs(u32),
}

#[derive(Debug, Clone)]
pub struct FragmentAnim {
    pub stroke_draw_ms: Option<u32>,
    pub fill_fade_ms: Option<u32>,
    pub start_after: StartAfter,
    pub easing: Easing,
}

impl Default for FragmentAnim {
    fn default() -> Self {
        Self {
            stroke_draw_ms: None,
            fill_fade_ms: None,
            start_after: StartAfter::PreviousFragment,
            easing: Easing::HandNatural,
        }
    }
}

#[derive(Debug, Clone)]
pub struct Session {
    ir: Ir,
    id_index: HashMap<String, u32>,
    pending_anim: Vec<AnimTrack>,
    version: u64,
    /// Where the next fragment will begin if `start_after == PreviousFragment`.
    next_start_ms: u32,
    /// Approximate cumulative geometry size, used for the 16 MB DoS cap.
    geom_bytes_used: usize,
    /// Strictly monotonic id generator for synthetic ids on fragments without
    /// explicit ones.
    next_synthetic_id: u32,
}

impl Session {
    pub fn new(viewbox: ViewBox) -> Self {
        Self {
            ir: Ir::new(viewbox),
            id_index: HashMap::new(),
            pending_anim: Vec::new(),
            version: 0,
            next_start_ms: 0,
            geom_bytes_used: 0,
            next_synthetic_id: 0,
        }
    }

    pub fn version(&self) -> u64 {
        self.version
    }

    pub fn element_count(&self) -> usize {
        self.ir.elements.len()
    }

    pub fn ids(&self) -> Vec<String> {
        self.id_index.keys().cloned().collect()
    }

    /// Parse and append an SVG fragment, schedule its animations, return the
    /// ids of the elements added.
    pub fn append_svg_fragment(
        &mut self,
        svg_fragment: &str,
        anim: Option<FragmentAnim>,
    ) -> Result<Vec<String>> {
        let wrapped = wrap_fragment(svg_fragment, self.ir.viewbox);
        let opts = ConvertOptions::default();
        let fragment_ir = convert_svg_to_ir(&wrapped, &opts)?;

        if self.ir.elements.len() + fragment_ir.elements.len() > MAX_ELEMENTS {
            return Err(VexelError::LimitExceeded("element count over 65,536"));
        }
        let added_geom_bytes = estimate_geom_bytes(&fragment_ir);
        if self.geom_bytes_used + added_geom_bytes > MAX_GEOM_BYTES {
            return Err(VexelError::LimitExceeded("geometry over 16 MB"));
        }

        let anim = anim.unwrap_or_default();
        let fragment_start = match anim.start_after {
            StartAfter::Immediately => 0,
            StartAfter::PreviousFragment => self.next_start_ms,
            StartAfter::AtMs(t) => t,
        };
        let mut total_duration: u32 = 0;
        let mut added_ids = Vec::with_capacity(fragment_ir.elements.len());

        for mut el in fragment_ir.elements {
            let id = match &el.id {
                Some(id) => id.clone(),
                None => {
                    let s = format!("__frag_{}_{}", self.version, self.next_synthetic_id);
                    self.next_synthetic_id += 1;
                    s
                }
            };
            el.id = Some(id.clone());

            let element_index = self.ir.elements.len() as u32;
            self.id_index.insert(id.clone(), element_index);
            self.ir.elements.push(el);

            if let Some(stroke_ms) = anim.stroke_draw_ms {
                if self.pending_anim.len() >= MAX_PENDING_ANIM_TRACKS {
                    return Err(VexelError::LimitExceeded(
                        "pending animation tracks over 10,000",
                    ));
                }
                self.pending_anim.push(AnimTrack {
                    element_index,
                    track_type: TrackType::StrokeDraw,
                    start_ms: fragment_start,
                    duration_ms: stroke_ms,
                    easing: anim.easing,
                    payload: Vec::new(),
                });
                total_duration = total_duration.max(stroke_ms);
            }
            if let Some(fill_ms) = anim.fill_fade_ms {
                if self.pending_anim.len() >= MAX_PENDING_ANIM_TRACKS {
                    return Err(VexelError::LimitExceeded(
                        "pending animation tracks over 10,000",
                    ));
                }
                self.pending_anim.push(AnimTrack {
                    element_index,
                    track_type: TrackType::FillFade,
                    start_ms: fragment_start.saturating_add(anim.stroke_draw_ms.unwrap_or(0)),
                    duration_ms: fill_ms,
                    easing: anim.easing,
                    payload: Vec::new(),
                });
                total_duration =
                    total_duration.max(anim.stroke_draw_ms.unwrap_or(0).saturating_add(fill_ms));
            }

            added_ids.push(id);
        }

        self.geom_bytes_used += added_geom_bytes;
        // Inter-fragment pause (SPEC §9.4) — default 80 ms.
        self.next_start_ms = fragment_start
            .saturating_add(total_duration)
            .saturating_add(80);
        self.version += 1;

        Ok(added_ids)
    }

    pub fn remove_element(&mut self, id: &str) -> bool {
        let Some(&idx) = self.id_index.get(id) else {
            return false;
        };
        // We don't actually delete from `ir.elements` (would invalidate every
        // higher index); instead, mark the element as transparent so it stops
        // rendering and stops hit-testing. The id is forgotten.
        if let Some(el) = self.ir.elements.get_mut(idx as usize) {
            el.fill = crate::ir::Rgba::TRANSPARENT;
            el.stroke = crate::ir::Rgba::TRANSPARENT;
            el.id = None;
        }
        self.id_index.remove(id);
        self.version += 1;
        true
    }

    /// Produce a complete `.vex` snapshot of the session's current state.
    pub fn snapshot(&self) -> Result<Vec<u8>> {
        let mut extras = Vec::new();
        if !self.ir.elements.is_empty() {
            extras.push(crate::hit::build_hitx_extra(&self.ir)?);
        }
        if !self.pending_anim.is_empty() {
            extras.push(ExtraSection {
                kind: SectionKind::ANIM,
                payload: crate::format::anim::serialize(&self.pending_anim),
            });
        }
        let opts = WriterOptions {
            is_streaming_snapshot: true,
            ..WriterOptions::default()
        };
        // Header flag bits (HAS_HIT_TEST, HAS_ANIMATION) are computed
        // automatically by write_with_extras based on the extras list.
        write_with_extras(&self.ir, &extras, opts)
    }

    pub fn viewbox(&self) -> ViewBox {
        self.ir.viewbox
    }
}

fn wrap_fragment(fragment: &str, vb: ViewBox) -> String {
    let trimmed = fragment.trim();
    if trimmed.starts_with("<svg") {
        return trimmed.to_owned();
    }
    format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"{} {} {} {}\">{}</svg>",
        vb.x, vb.y, vb.w, vb.h, fragment
    )
}

fn estimate_geom_bytes(ir: &Ir) -> usize {
    let mut total = 0;
    for el in &ir.elements {
        // Match the on-wire GEOM element size estimate (header + verbs + points).
        total += 40 + el.path.verbs.len() + el.path.points.len() * 8;
    }
    total
}
