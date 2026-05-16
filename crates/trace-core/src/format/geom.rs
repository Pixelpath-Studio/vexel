//! GEOM — geometry section — SPEC §3.4.
//!
//! Phase 1 ships only the codec for the section header (`element_count`) plus
//! per-element framing; the full element body (paths, points) will be exercised
//! end-to-end once the converter lands in phase 2. For phase 1's empty-file
//! round-trip, an `element_count == 0` payload is the entire section.

use crate::error::{Result, TraceError};
use byteorder::{ByteOrder, LittleEndian as LE};

/// Builds a GEOM payload from elements. Phase 1 stub — only handles the empty
/// case to keep the round-trip test green. Phase 2 fills in element framing.
pub struct GeomBuilder {
    element_count: u32,
    body: Vec<u8>,
}

impl Default for GeomBuilder {
    fn default() -> Self {
        Self::new()
    }
}

impl GeomBuilder {
    pub fn new() -> Self {
        Self {
            element_count: 0,
            body: Vec::new(),
        }
    }

    pub fn element_count(&self) -> u32 {
        self.element_count
    }

    pub fn into_bytes(self) -> Vec<u8> {
        let mut out = Vec::with_capacity(4 + self.body.len());
        let mut hdr = [0u8; 4];
        LE::write_u32(&mut hdr, self.element_count);
        out.extend_from_slice(&hdr);
        out.extend_from_slice(&self.body);
        out
    }
}

/// Read-side view over a GEOM payload. Phase 1 only exposes the element count;
/// per-element accessors land in phase 2.
#[derive(Debug, Clone, Copy)]
pub struct Geom<'a> {
    bytes: &'a [u8],
}

impl<'a> Geom<'a> {
    pub fn new(bytes: &'a [u8]) -> Result<Self> {
        if bytes.len() < 4 {
            return Err(TraceError::InvalidFile("GEOM section too small"));
        }
        Ok(Self { bytes })
    }

    pub fn element_count(&self) -> u32 {
        LE::read_u32(&self.bytes[0..4])
    }
}
