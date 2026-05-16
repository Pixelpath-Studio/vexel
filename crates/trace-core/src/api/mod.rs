//! Public API surface for the Rust core. Phase 1 ships read-side query (parse,
//! viewbox, element_count, metadata) plus serialization from IR. Conversion,
//! hit-testing, and streaming land with their respective phases.
//!
//! UniFFI bindings derive from `api.udl` (see neighbor file) and are wired in
//! phase 4 when the iOS/Android frameworks land. Phase 1 keeps the Rust API
//! independent of UniFFI so the round-trip test has no codegen dependency.

use crate::error::Result;
use crate::format::{
    geom::Geom, header::FileFlags, meta::Meta, reader::FileReader, section_table::SectionKind,
};
use crate::ir::ViewBox;

/// Zero-copy view over a parsed `.trace` buffer.
#[derive(Debug)]
pub struct TraceFile<'a> {
    reader: FileReader<'a>,
}

impl<'a> TraceFile<'a> {
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

    /// Returns the value for a META key if present.
    pub fn metadata(&self, key: &str) -> Result<Option<String>> {
        let (Some(strs), Some(meta_bytes)) =
            (self.reader.strs()?, self.reader.section(SectionKind::META))
        else {
            return Ok(None);
        };
        let meta = Meta::new(meta_bytes)?;
        Ok(meta.get(strs, key)?.map(|s| s.to_owned()))
    }
}
