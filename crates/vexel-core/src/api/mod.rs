//! Public API surface for the Rust core.
//!
//! UniFFI bindings derive from `api.udl` (see neighbor file) and are wired in
//! phase 4 when the iOS/Android frameworks land.

use crate::error::Result;
use crate::format::{
    geom::{ElementView, Geom},
    header::FileFlags,
    hitx::Hitx,
    idix::Idix,
    meta::Meta,
    reader::FileReader,
    section_table::SectionKind,
};
use crate::hit::{point_in_poly::FillRule, HitMode};
use crate::ir::{ElementFlags, ViewBox};

/// Zero-copy view over a parsed `.vex` buffer.
#[derive(Debug)]
pub struct VexelFile<'a> {
    reader: FileReader<'a>,
}

impl<'a> VexelFile<'a> {
    pub fn parse(bytes: &'a [u8]) -> Result<Self> {
        Ok(Self {
            reader: FileReader::parse(bytes)?,
        })
    }

    pub fn viewbox(&self) -> ViewBox {
        self.reader.header.viewbox
    }

    pub fn flags(&self) -> FileFlags {
        self.reader.header.flags
    }

    pub fn version(&self) -> (u16, u16) {
        (self.reader.header.major, self.reader.header.minor)
    }

    pub fn element_count(&self) -> Result<u32> {
        match self.reader.section(SectionKind::GEOM) {
            Some(bytes) => Ok(Geom::new(bytes)?.element_count()),
            None => Ok(0),
        }
    }

    /// All ids present in IDIX (raw plus any Mermaid-normalized short forms).
    pub fn ids(&self) -> Result<Vec<&'a str>> {
        let (Some(strs), Some(idix_bytes)) =
            (self.reader.strs()?, self.reader.section(SectionKind::IDIX))
        else {
            return Ok(Vec::new());
        };
        Idix::new(idix_bytes)?.ids(strs)
    }

    /// Resolve an id to its `element_index` via IDIX binary search.
    pub fn element_index_of(&self, id: &str) -> Result<Option<u32>> {
        let (Some(strs), Some(idix_bytes)) =
            (self.reader.strs()?, self.reader.section(SectionKind::IDIX))
        else {
            return Ok(None);
        };
        Idix::new(idix_bytes)?.lookup(strs, id)
    }

    pub fn element_at(&self, idx: u32) -> Result<Option<ElementView<'a>>> {
        match self.reader.section(SectionKind::GEOM) {
            Some(bytes) => Geom::new(bytes)?.element_at(idx),
            None => Ok(None),
        }
    }

    pub fn element_by_id(&self, id: &str) -> Result<Option<ElementView<'a>>> {
        match self.element_index_of(id)? {
            Some(idx) => self.element_at(idx),
            None => Ok(None),
        }
    }

    /// Iterate over all elements in document order.
    pub fn elements(&self) -> Result<impl Iterator<Item = Result<ElementView<'a>>> + 'a> {
        let bytes = self
            .reader
            .section(SectionKind::GEOM)
            .ok_or(crate::VexelError::InvalidFile("missing GEOM"))?;
        Ok(Geom::new(bytes)?.iter())
    }

    pub fn metadata(&self, key: &str) -> Result<Option<String>> {
        let (Some(strs), Some(meta_bytes)) =
            (self.reader.strs()?, self.reader.section(SectionKind::META))
        else {
            return Ok(None);
        };
        let meta = Meta::new(meta_bytes)?;
        Ok(meta.get(strs, key)?.map(|s| s.to_owned()))
    }

    /// Raw access to a section payload by kind. Used by HITX consumers and by
    /// the conformance suite's hex dumper.
    pub fn section_bytes(&self, kind: SectionKind) -> Option<&'a [u8]> {
        self.reader.section(kind)
    }

    /// Hit-test in viewBox-space coordinates. Returns the id of the topmost
    /// (highest element_index) hit, or None.
    ///
    /// Routes through the Rust hit-test path exclusively — the platform
    /// runtimes never consult Skia for hit-testing because Skia has no concept
    /// of element identity.
    pub fn hit_test(&self, x: f32, y: f32, mode: HitMode) -> Result<Option<String>> {
        let Some(hitx_bytes) = self.reader.section(SectionKind::HITX) else {
            return Ok(None);
        };
        let hitx = Hitx::new(hitx_bytes)?;
        let mut candidates = hitx.query_point(x, y);
        candidates.sort_unstable();
        candidates.dedup();
        // Reverse iteration = top-down z-order.
        for el_idx in candidates.iter().rev().copied() {
            let el = match self.element_at(el_idx)? {
                Some(e) => e,
                None => continue,
            };
            if !mode_matches(mode, el.flags) {
                continue;
            }
            if mode == HitMode::BoundingBox {
                if el.bbox.contains(x, y) {
                    return Ok(self.id_from_index(el_idx)?.map(|s| s.to_owned()));
                }
                continue;
            }
            let polyline = hitx.polyline_for(el_idx);
            let rule = if el.flags.evenodd() {
                FillRule::EvenOdd
            } else {
                FillRule::NonZero
            };

            let want_fill = matches!(
                mode,
                HitMode::VisiblePainted | HitMode::VisibleFill | HitMode::All
            ) && !el.fill.is_transparent();
            let want_stroke = matches!(
                mode,
                HitMode::VisiblePainted | HitMode::VisibleStroke | HitMode::All
            ) && !el.stroke.is_transparent();

            if want_fill && crate::hit::point_in_poly::contains(&polyline, x, y, rule) {
                return Ok(self.id_from_index(el_idx)?.map(|s| s.to_owned()));
            }
            if want_stroke {
                let d2 = crate::hit::distance::point_to_polyline_sq(&polyline, x, y);
                let r = el.stroke_width * 0.5 + 0.5; // half-stroke + tolerance
                if d2 <= r * r {
                    return Ok(self.id_from_index(el_idx)?.map(|s| s.to_owned()));
                }
            }
        }
        Ok(None)
    }

    fn id_from_index(&self, element_index: u32) -> Result<Option<&'a str>> {
        let (Some(strs), Some(idix_bytes)) =
            (self.reader.strs()?, self.reader.section(SectionKind::IDIX))
        else {
            return Ok(None);
        };
        Idix::new(idix_bytes)?.id_of(strs, element_index)
    }
}

fn mode_matches(mode: HitMode, flags: ElementFlags) -> bool {
    match mode {
        HitMode::All | HitMode::BoundingBox => true,
        HitMode::VisiblePainted => flags.visible_painted() || flags.0 == 0,
        HitMode::VisibleStroke => flags.visible_stroke() || flags.visible_painted(),
        HitMode::VisibleFill => flags.visible_fill() || flags.visible_painted(),
    }
}
