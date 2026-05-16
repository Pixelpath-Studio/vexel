//! IDIX — identity index — SPEC §3.6.
//!
//! Sorted (id_offset, element_index) pairs. Lookup is binary search on the id
//! string (resolved via STRS). Mermaid-aware normalization may insert both the
//! raw id and a normalized form pointing to the same element_index.

use crate::error::{Result, TraceError};
use crate::format::strs::{Strs, StrsBuilder};
use byteorder::{ByteOrder, LittleEndian as LE};

pub const ENTRY_SIZE: usize = 8;

#[derive(Debug, Default)]
pub struct IdixBuilder {
    entries: Vec<(String, u32)>, // (id, element_index) — sorted before serialization
}

impl IdixBuilder {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn insert(&mut self, id: &str, element_index: u32) {
        self.entries.push((id.to_owned(), element_index));
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    pub fn into_bytes(mut self, strs: &mut StrsBuilder) -> Vec<u8> {
        // ASCII-lexical sort by id for O(log n) binary search at read time.
        self.entries.sort_by(|a, b| a.0.cmp(&b.0));
        let mut out = vec![0u8; 4 + self.entries.len() * ENTRY_SIZE];
        LE::write_u32(&mut out[0..4], self.entries.len() as u32);
        for (i, (id, el_idx)) in self.entries.iter().enumerate() {
            let off = 4 + i * ENTRY_SIZE;
            let id_off = strs.intern(id);
            LE::write_u32(&mut out[off..off + 4], id_off);
            LE::write_u32(&mut out[off + 4..off + 8], *el_idx);
        }
        out
    }
}

#[derive(Debug, Clone, Copy)]
pub struct Idix<'a> {
    bytes: &'a [u8],
    count: u32,
}

impl<'a> Idix<'a> {
    pub fn new(bytes: &'a [u8]) -> Result<Self> {
        if bytes.len() < 4 {
            return Err(TraceError::InvalidFile("IDIX section too small"));
        }
        let count = LE::read_u32(&bytes[0..4]);
        if bytes.len() < 4 + (count as usize) * ENTRY_SIZE {
            return Err(TraceError::InvalidFile("IDIX entries truncated"));
        }
        Ok(Self { bytes, count })
    }

    pub fn count(&self) -> u32 {
        self.count
    }

    fn entry(&self, i: usize) -> (u32, u32) {
        let off = 4 + i * ENTRY_SIZE;
        (
            LE::read_u32(&self.bytes[off..off + 4]),
            LE::read_u32(&self.bytes[off + 4..off + 8]),
        )
    }

    /// Binary search for an id; returns the element_index if found.
    pub fn lookup(&self, strs: Strs<'a>, id: &str) -> Result<Option<u32>> {
        let mut lo = 0usize;
        let mut hi = self.count as usize;
        while lo < hi {
            let mid = (lo + hi) / 2;
            let (id_off, el_idx) = self.entry(mid);
            let candidate = strs.get(id_off)?;
            match candidate.cmp(id) {
                std::cmp::Ordering::Less => lo = mid + 1,
                std::cmp::Ordering::Greater => hi = mid,
                std::cmp::Ordering::Equal => return Ok(Some(el_idx)),
            }
        }
        Ok(None)
    }

    /// Reverse lookup: first id (lexically) pointing at element_index. O(n).
    pub fn id_of(&self, strs: Strs<'a>, element_index: u32) -> Result<Option<&'a str>> {
        for i in 0..self.count as usize {
            let (id_off, el_idx) = self.entry(i);
            if el_idx == element_index {
                return Ok(Some(strs.get(id_off)?));
            }
        }
        Ok(None)
    }

    pub fn ids(&self, strs: Strs<'a>) -> Result<Vec<&'a str>> {
        let mut v = Vec::with_capacity(self.count as usize);
        for i in 0..self.count as usize {
            let (id_off, _) = self.entry(i);
            v.push(strs.get(id_off)?);
        }
        Ok(v)
    }
}
