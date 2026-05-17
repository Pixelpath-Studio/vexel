//! META — optional metadata key-value store — SPEC §3.10.
//!
//! Each entry is `(key_offset: u32, value_offset: u32)` where both offsets index
//! into the STRS section. Entries are appended in insertion order; lookup is a
//! linear scan (small N, predictable layout, no auxiliary index needed).

use crate::error::{Result, VexelError};
use crate::format::strs::{Strs, StrsBuilder};
use byteorder::{ByteOrder, LittleEndian as LE};

pub const ENTRY_SIZE: usize = 8;

#[derive(Debug, Default)]
pub struct MetaBuilder {
    entries: Vec<(u32, u32)>,
}

impl MetaBuilder {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn push(&mut self, strs: &mut StrsBuilder, key: &str, value: &str) {
        let k = strs.intern(key);
        let v = strs.intern(value);
        self.entries.push((k, v));
    }

    pub fn into_bytes(self) -> Vec<u8> {
        let mut out = vec![0u8; 4 + self.entries.len() * ENTRY_SIZE];
        LE::write_u32(&mut out[0..4], self.entries.len() as u32);
        for (i, (k, v)) in self.entries.iter().enumerate() {
            let off = 4 + i * ENTRY_SIZE;
            LE::write_u32(&mut out[off..off + 4], *k);
            LE::write_u32(&mut out[off + 4..off + 8], *v);
        }
        out
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }
}

#[derive(Debug, Clone, Copy)]
pub struct Meta<'a> {
    bytes: &'a [u8],
    count: u32,
}

impl<'a> Meta<'a> {
    pub fn new(bytes: &'a [u8]) -> Result<Self> {
        if bytes.len() < 4 {
            return Err(VexelError::InvalidFile("META section too small"));
        }
        let count = LE::read_u32(&bytes[0..4]);
        let expected = 4 + (count as usize) * ENTRY_SIZE;
        if bytes.len() < expected {
            return Err(VexelError::InvalidFile("META section truncated"));
        }
        Ok(Self { bytes, count })
    }

    pub fn count(&self) -> u32 {
        self.count
    }

    pub fn get(&self, strs: Strs<'a>, key: &str) -> Result<Option<&'a str>> {
        for i in 0..self.count as usize {
            let off = 4 + i * ENTRY_SIZE;
            let k_off = LE::read_u32(&self.bytes[off..off + 4]);
            let v_off = LE::read_u32(&self.bytes[off + 4..off + 8]);
            if strs.get(k_off)? == key {
                return Ok(Some(strs.get(v_off)?));
            }
        }
        Ok(None)
    }
}
