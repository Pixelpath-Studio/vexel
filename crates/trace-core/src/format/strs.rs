//! STRS — packed UTF-8 NUL-terminated string blob — SPEC §3.8.
//!
//! Strings are referenced by their byte offset within the section payload. Offset 0
//! is always the empty string (a one-byte NUL written at the start of every STRS),
//! so callers can use 0 as a sentinel meaning "no string".

use crate::error::{Result, TraceError};
use std::collections::HashMap;

/// Builder used at write time. Deduplicates identical strings.
#[derive(Debug, Default)]
pub struct StrsBuilder {
    bytes: Vec<u8>,
    index: HashMap<String, u32>,
}

impl StrsBuilder {
    pub fn new() -> Self {
        // Slot 0: the empty string. Single NUL terminator.
        let mut bytes = Vec::with_capacity(64);
        bytes.push(0u8);
        let mut index = HashMap::new();
        index.insert(String::new(), 0);
        Self { bytes, index }
    }

    /// Returns the byte offset of `s` within the STRS payload, inserting it if
    /// not already present.
    pub fn intern(&mut self, s: &str) -> u32 {
        if let Some(&off) = self.index.get(s) {
            return off;
        }
        let off = self.bytes.len() as u32;
        self.bytes.extend_from_slice(s.as_bytes());
        self.bytes.push(0); // NUL terminator
        self.index.insert(s.to_owned(), off);
        off
    }

    pub fn into_bytes(self) -> Vec<u8> {
        self.bytes
    }
}

/// Zero-copy reader over a STRS payload.
#[derive(Debug, Clone, Copy)]
pub struct Strs<'a> {
    bytes: &'a [u8],
}

impl<'a> Strs<'a> {
    pub fn new(bytes: &'a [u8]) -> Result<Self> {
        if bytes.is_empty() {
            return Err(TraceError::InvalidFile("STRS section is empty"));
        }
        if bytes[0] != 0 {
            return Err(TraceError::InvalidFile(
                "STRS does not start with empty-string sentinel",
            ));
        }
        Ok(Self { bytes })
    }

    pub fn len(&self) -> usize {
        self.bytes.len()
    }

    pub fn is_empty(&self) -> bool {
        // Always at least one byte (the sentinel NUL).
        self.bytes.len() <= 1
    }

    /// Returns the NUL-terminated UTF-8 string starting at `offset`. Returns the
    /// empty string for offset 0.
    pub fn get(&self, offset: u32) -> Result<&'a str> {
        let off = offset as usize;
        if off >= self.bytes.len() {
            return Err(TraceError::InvalidFile("STRS offset out of bounds"));
        }
        let end = self.bytes[off..]
            .iter()
            .position(|&b| b == 0)
            .ok_or(TraceError::InvalidFile("unterminated STRS entry"))?;
        std::str::from_utf8(&self.bytes[off..off + end])
            .map_err(|_| TraceError::InvalidFile("STRS entry is not UTF-8"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_sentinel_at_offset_0() {
        let bytes = StrsBuilder::new().into_bytes();
        let strs = Strs::new(&bytes).unwrap();
        assert_eq!(strs.get(0).unwrap(), "");
    }

    #[test]
    fn intern_and_read_back() {
        let mut b = StrsBuilder::new();
        let a = b.intern("flowchart-A-1");
        let bb = b.intern("A");
        let c = b.intern("flowchart-A-1"); // duplicate
        assert_eq!(a, c);
        assert_ne!(a, bb);

        let bytes = b.into_bytes();
        let strs = Strs::new(&bytes).unwrap();
        assert_eq!(strs.get(a).unwrap(), "flowchart-A-1");
        assert_eq!(strs.get(bb).unwrap(), "A");
        assert_eq!(strs.get(0).unwrap(), "");
    }
}
