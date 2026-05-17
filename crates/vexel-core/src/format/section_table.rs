//! SECTION TABLE — SPEC §3.2. Each entry is 16 B fixed.

use crate::error::{Result, VexelError};
use byteorder::{ByteOrder, LittleEndian as LE};

pub const SECTION_ENTRY_SIZE: usize = 16;

/// Four-byte section identifier. Stored as a `[u8; 4]` on the wire so unknown
/// kinds can still be inspected and skipped via `offset+size`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct SectionKind(pub [u8; 4]);

impl SectionKind {
    pub const GEOM: Self = Self(*b"GEOM");
    pub const IDIX: Self = Self(*b"IDIX");
    pub const HITX: Self = Self(*b"HITX");
    pub const STRS: Self = Self(*b"STRS");
    pub const ANIM: Self = Self(*b"ANIM");
    pub const META: Self = Self(*b"META");

    /// Best-effort UTF-8 string view for debugging. Wire data is opaque bytes.
    pub fn as_str(&self) -> &str {
        std::str::from_utf8(&self.0).unwrap_or("????")
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SectionEntry {
    pub kind: SectionKind,
    pub offset: u32,
    pub size: u32,
    pub version_major: u16,
    pub version_minor: u16,
}

impl SectionEntry {
    pub fn write_into(&self, out: &mut [u8]) {
        debug_assert_eq!(out.len(), SECTION_ENTRY_SIZE);
        out[0..4].copy_from_slice(&self.kind.0);
        LE::write_u32(&mut out[4..8], self.offset);
        LE::write_u32(&mut out[8..12], self.size);
        LE::write_u16(&mut out[12..14], self.version_major);
        LE::write_u16(&mut out[14..16], self.version_minor);
    }

    pub fn parse(bytes: &[u8]) -> Result<Self> {
        if bytes.len() < SECTION_ENTRY_SIZE {
            return Err(VexelError::InvalidFile("truncated section entry"));
        }
        let mut kind = [0u8; 4];
        kind.copy_from_slice(&bytes[0..4]);
        Ok(Self {
            kind: SectionKind(kind),
            offset: LE::read_u32(&bytes[4..8]),
            size: LE::read_u32(&bytes[8..12]),
            version_major: LE::read_u16(&bytes[12..14]),
            version_minor: LE::read_u16(&bytes[14..16]),
        })
    }
}

/// Round up to the next 4-byte boundary. Section payloads are 4-byte aligned per §3.2.
pub fn align4(n: usize) -> usize {
    (n + 3) & !3
}
