//! HEADER (32 B fixed) and FOOTER (16 B fixed) — SPEC §3.2.

use crate::error::{Result, TraceError};
use crate::ir::ViewBox;
use byteorder::{ByteOrder, LittleEndian as LE};

pub const HEADER_MAGIC: &[u8; 4] = b"TRCE";
pub const FOOTER_MAGIC: &[u8; 4] = b"trc!";

pub const HEADER_SIZE: usize = 32;
pub const FOOTER_SIZE: usize = 16;

pub const VERSION_MAJOR: u16 = 1;
pub const VERSION_MINOR: u16 = 0;

/// Header flag bits — SPEC §3.3.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct FileFlags(pub u32);

impl FileFlags {
    pub const HAS_HIT_TEST: u32 = 1 << 0;
    pub const HAS_ANIMATION: u32 = 1 << 1;
    pub const IS_STREAMING_SNAPSHOT: u32 = 1 << 2;
    pub const TEXT_AS_PATHS: u32 = 1 << 3;
    pub const TEXT_AS_RUNS: u32 = 1 << 4;

    pub fn has(self, bit: u32) -> bool {
        (self.0 & bit) != 0
    }

    pub fn with(mut self, bit: u32, on: bool) -> Self {
        if on {
            self.0 |= bit;
        } else {
            self.0 &= !bit;
        }
        self
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Header {
    pub major: u16,
    pub minor: u16,
    pub flags: FileFlags,
    pub viewbox: ViewBox,
    pub section_count: u32,
}

impl Header {
    pub fn write_into(&self, out: &mut [u8]) {
        debug_assert_eq!(out.len(), HEADER_SIZE);
        out[0..4].copy_from_slice(HEADER_MAGIC);
        LE::write_u16(&mut out[4..6], self.major);
        LE::write_u16(&mut out[6..8], self.minor);
        LE::write_u32(&mut out[8..12], self.flags.0);
        LE::write_f32(&mut out[12..16], self.viewbox.x);
        LE::write_f32(&mut out[16..20], self.viewbox.y);
        LE::write_f32(&mut out[20..24], self.viewbox.w);
        LE::write_f32(&mut out[24..28], self.viewbox.h);
        LE::write_u32(&mut out[28..32], self.section_count);
    }

    pub fn parse(bytes: &[u8]) -> Result<Self> {
        if bytes.len() < HEADER_SIZE {
            return Err(TraceError::InvalidFile("file shorter than header"));
        }
        if &bytes[0..4] != HEADER_MAGIC {
            return Err(TraceError::InvalidFile("bad header magic (expected TRCE)"));
        }
        let major = LE::read_u16(&bytes[4..6]);
        let minor = LE::read_u16(&bytes[6..8]);
        // Major bump = breaking; reject. Minor bump = additive; accept.
        if major != VERSION_MAJOR {
            return Err(TraceError::UnsupportedVersion { major, minor });
        }
        Ok(Self {
            major,
            minor,
            flags: FileFlags(LE::read_u32(&bytes[8..12])),
            viewbox: ViewBox {
                x: LE::read_f32(&bytes[12..16]),
                y: LE::read_f32(&bytes[16..20]),
                w: LE::read_f32(&bytes[20..24]),
                h: LE::read_f32(&bytes[24..28]),
            },
            section_count: LE::read_u32(&bytes[28..32]),
        })
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Footer {
    pub body_crc32: u32,
    pub total_size: u32,
}

impl Footer {
    pub fn write_into(&self, out: &mut [u8]) {
        debug_assert_eq!(out.len(), FOOTER_SIZE);
        LE::write_u32(&mut out[0..4], self.body_crc32);
        LE::write_u32(&mut out[4..8], self.total_size);
        out[8..12].copy_from_slice(FOOTER_MAGIC);
        LE::write_u32(&mut out[12..16], 0); // reserved
    }

    pub fn parse(bytes: &[u8]) -> Result<Self> {
        if bytes.len() < FOOTER_SIZE {
            return Err(TraceError::InvalidFile("file shorter than footer"));
        }
        if &bytes[8..12] != FOOTER_MAGIC {
            return Err(TraceError::InvalidFile("bad footer magic (expected trc!)"));
        }
        Ok(Self {
            body_crc32: LE::read_u32(&bytes[0..4]),
            total_size: LE::read_u32(&bytes[4..8]),
        })
    }
}
