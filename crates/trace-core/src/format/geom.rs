//! GEOM — geometry section — SPEC §3.4.
//!
//! Wire layout per element:
//!   bbox_min     f32×2
//!   bbox_max     f32×2
//!   fill_rgba    u32
//!   stroke_rgba  u32
//!   stroke_width f32
//!   flags        u8
//!   text_run_idx u8
//!   layer_hint   u16
//!   verb_count   u32
//!   point_count  u32
//!   verbs        verb_count × u8
//!   _padding     align(4)
//!   points       point_count × (f32, f32)

use crate::error::{Result, TraceError};
use crate::ir::{Element, ElementFlags, Path, Point, Rect, Rgba, Verb};
use byteorder::{ByteOrder, LittleEndian as LE};

pub const ELEMENT_HEADER_SIZE: usize = 4 * 2 + 4 * 2 + 4 + 4 + 4 + 1 + 1 + 2 + 4 + 4;
//                                      bbox_min  bbox_max  fill  stroke  sw  fl  tri  lh  vc  pc

pub struct GeomBuilder {
    elements: Vec<Element>,
}

impl Default for GeomBuilder {
    fn default() -> Self {
        Self::new()
    }
}

impl GeomBuilder {
    pub fn new() -> Self {
        Self {
            elements: Vec::new(),
        }
    }

    pub fn push(&mut self, el: Element) {
        self.elements.push(el);
    }

    pub fn element_count(&self) -> u32 {
        self.elements.len() as u32
    }

    pub fn elements(&self) -> &[Element] {
        &self.elements
    }

    pub fn into_bytes(self) -> Vec<u8> {
        let mut out = Vec::with_capacity(4 + self.elements.len() * (ELEMENT_HEADER_SIZE + 16));
        let mut hdr = [0u8; 4];
        LE::write_u32(&mut hdr, self.elements.len() as u32);
        out.extend_from_slice(&hdr);
        for el in &self.elements {
            write_element(&mut out, el);
        }
        out
    }
}

fn write_element(out: &mut Vec<u8>, el: &Element) {
    let start = out.len();
    out.resize(start + ELEMENT_HEADER_SIZE, 0);
    let h = &mut out[start..start + ELEMENT_HEADER_SIZE];
    LE::write_f32(&mut h[0..4], el.bbox.min_x);
    LE::write_f32(&mut h[4..8], el.bbox.min_y);
    LE::write_f32(&mut h[8..12], el.bbox.max_x);
    LE::write_f32(&mut h[12..16], el.bbox.max_y);
    LE::write_u32(&mut h[16..20], el.fill.0);
    LE::write_u32(&mut h[20..24], el.stroke.0);
    LE::write_f32(&mut h[24..28], el.stroke_width);
    h[28] = el.flags.0;
    h[29] = el.text_run_idx;
    LE::write_u16(&mut h[30..32], el.layer_hint);
    LE::write_u32(&mut h[32..36], el.path.verb_count());
    LE::write_u32(&mut h[36..40], el.path.point_count());

    // Verbs.
    for v in &el.path.verbs {
        out.push(*v as u8);
    }
    // Pad verbs to 4-byte boundary.
    while out.len() % 4 != 0 {
        out.push(0);
    }
    // Points.
    for p in &el.path.points {
        let mut buf = [0u8; 8];
        LE::write_f32(&mut buf[0..4], p.x);
        LE::write_f32(&mut buf[4..8], p.y);
        out.extend_from_slice(&buf);
    }
}

/// Zero-copy read-side view over a GEOM payload. Each element is parsed on demand
/// by walking from the section start. This is simple and avoids allocating an
/// offset table; element_count is small enough (~10⁴ for v1) that linear lookup
/// is fine for index-by-position access used by hit-test post-filter.
#[derive(Debug, Clone, Copy)]
pub struct Geom<'a> {
    bytes: &'a [u8],
    element_count: u32,
}

impl<'a> Geom<'a> {
    pub fn new(bytes: &'a [u8]) -> Result<Self> {
        if bytes.len() < 4 {
            return Err(TraceError::InvalidFile("GEOM section too small"));
        }
        let element_count = LE::read_u32(&bytes[0..4]);
        Ok(Self {
            bytes,
            element_count,
        })
    }

    pub fn element_count(&self) -> u32 {
        self.element_count
    }

    pub fn iter(&self) -> GeomIter<'a> {
        GeomIter {
            cursor: 4,
            bytes: self.bytes,
            remaining: self.element_count,
        }
    }

    pub fn element_at(&self, idx: u32) -> Result<Option<ElementView<'a>>> {
        if idx >= self.element_count {
            return Ok(None);
        }
        let mut it = self.iter();
        for _ in 0..idx {
            it.next().transpose()?;
        }
        it.next().transpose()
    }
}

#[derive(Debug)]
pub struct GeomIter<'a> {
    cursor: usize,
    bytes: &'a [u8],
    remaining: u32,
}

impl<'a> Iterator for GeomIter<'a> {
    type Item = Result<ElementView<'a>>;

    fn next(&mut self) -> Option<Self::Item> {
        if self.remaining == 0 {
            return None;
        }
        self.remaining -= 1;
        let start = self.cursor;
        if start + ELEMENT_HEADER_SIZE > self.bytes.len() {
            return Some(Err(TraceError::InvalidFile(
                "GEOM element header truncated",
            )));
        }
        let h = &self.bytes[start..start + ELEMENT_HEADER_SIZE];
        let bbox = Rect {
            min_x: LE::read_f32(&h[0..4]),
            min_y: LE::read_f32(&h[4..8]),
            max_x: LE::read_f32(&h[8..12]),
            max_y: LE::read_f32(&h[12..16]),
        };
        let fill = Rgba(LE::read_u32(&h[16..20]));
        let stroke = Rgba(LE::read_u32(&h[20..24]));
        let stroke_width = LE::read_f32(&h[24..28]);
        let flags = ElementFlags(h[28]);
        let text_run_idx = h[29];
        let layer_hint = LE::read_u16(&h[30..32]);
        let verb_count = LE::read_u32(&h[32..36]) as usize;
        let point_count = LE::read_u32(&h[36..40]) as usize;

        let mut cursor = start + ELEMENT_HEADER_SIZE;
        if cursor + verb_count > self.bytes.len() {
            return Some(Err(TraceError::InvalidFile("GEOM verbs truncated")));
        }
        let verbs = &self.bytes[cursor..cursor + verb_count];
        cursor += verb_count;
        // Align to 4 bytes.
        cursor = (cursor + 3) & !3;

        let points_byte_len = point_count * 8;
        if cursor + points_byte_len > self.bytes.len() {
            return Some(Err(TraceError::InvalidFile("GEOM points truncated")));
        }
        let points_bytes = &self.bytes[cursor..cursor + points_byte_len];
        cursor += points_byte_len;

        self.cursor = cursor;

        Some(Ok(ElementView {
            bbox,
            fill,
            stroke,
            stroke_width,
            flags,
            text_run_idx,
            layer_hint,
            verbs,
            points_bytes,
            point_count,
        }))
    }
}

#[derive(Debug, Clone, Copy)]
pub struct ElementView<'a> {
    pub bbox: Rect,
    pub fill: Rgba,
    pub stroke: Rgba,
    pub stroke_width: f32,
    pub flags: ElementFlags,
    pub text_run_idx: u8,
    pub layer_hint: u16,
    pub verbs: &'a [u8],
    points_bytes: &'a [u8],
    point_count: usize,
}

impl<'a> ElementView<'a> {
    pub fn point(&self, idx: usize) -> Point {
        let o = idx * 8;
        Point::new(
            LE::read_f32(&self.points_bytes[o..o + 4]),
            LE::read_f32(&self.points_bytes[o + 4..o + 8]),
        )
    }

    pub fn point_count(&self) -> usize {
        self.point_count
    }

    pub fn points(&self) -> Vec<Point> {
        (0..self.point_count).map(|i| self.point(i)).collect()
    }

    /// Materialize the IR `Path` (verb + point arrays) for this element. Used
    /// by the hit-test polyline builder and by platform path converters.
    pub fn to_path(&self) -> Result<Path> {
        let mut verbs = Vec::with_capacity(self.verbs.len());
        for &v in self.verbs {
            verbs.push(Verb::from_u8(v).ok_or(TraceError::InvalidFile("unknown path verb"))?);
        }
        let mut points = Vec::with_capacity(self.point_count);
        for i in 0..self.point_count {
            points.push(self.point(i));
        }
        Ok(Path { verbs, points })
    }
}
