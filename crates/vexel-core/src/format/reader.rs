//! Zero-copy reader over a `.vex` byte buffer. Parses the header, walks the
//! section table, and exposes accessors per section. Sections themselves are
//! parsed lazily by the higher-level `VexelFile` in `crate::api`.

use super::{
    header::{Footer, Header, FOOTER_SIZE, HEADER_SIZE},
    section_table::{SectionEntry, SectionKind, SECTION_ENTRY_SIZE},
    strs::Strs,
};
use crate::error::{Result, VexelError};

#[derive(Debug)]
pub struct FileReader<'a> {
    pub bytes: &'a [u8],
    pub header: Header,
    pub footer: Footer,
    pub sections: Vec<SectionEntry>,
}

impl<'a> FileReader<'a> {
    pub fn parse(bytes: &'a [u8]) -> Result<Self> {
        if bytes.len() < HEADER_SIZE + FOOTER_SIZE {
            return Err(VexelError::InvalidFile("file too small"));
        }

        let header = Header::parse(&bytes[..HEADER_SIZE])?;
        let footer = Footer::parse(&bytes[bytes.len() - FOOTER_SIZE..])?;

        if footer.total_size as usize != bytes.len() {
            return Err(VexelError::InvalidFile(
                "footer total_size does not match buffer length",
            ));
        }

        let body_end = bytes.len() - FOOTER_SIZE;
        let expected_crc = crc32fast::hash(&bytes[..body_end]);
        if expected_crc != footer.body_crc32 {
            return Err(VexelError::InvalidFile("body CRC32 mismatch"));
        }

        let table_start = HEADER_SIZE;
        let table_end = table_start + (header.section_count as usize) * SECTION_ENTRY_SIZE;
        if table_end > body_end {
            return Err(VexelError::InvalidFile("section table runs past file end"));
        }

        let mut sections = Vec::with_capacity(header.section_count as usize);
        for i in 0..(header.section_count as usize) {
            let off = table_start + i * SECTION_ENTRY_SIZE;
            let entry = SectionEntry::parse(&bytes[off..off + SECTION_ENTRY_SIZE])?;
            let payload_end = (entry.offset as usize)
                .checked_add(entry.size as usize)
                .ok_or(VexelError::InvalidFile("section size overflow"))?;
            if entry.offset as usize > body_end || payload_end > body_end {
                return Err(VexelError::InvalidFile(
                    "section payload runs past file end",
                ));
            }
            sections.push(entry);
        }

        Ok(Self {
            bytes,
            header,
            footer,
            sections,
        })
    }

    /// Returns the raw payload bytes for the first section of the given kind, if
    /// present. Unknown kinds (i.e., kinds added in a future format version) are
    /// reachable here too and can be skipped cleanly — that's the v1→vN forward
    /// compatibility mechanism from SPEC §3.2.
    pub fn section(&self, kind: SectionKind) -> Option<&'a [u8]> {
        let entry = self.sections.iter().find(|e| e.kind == kind)?;
        let start = entry.offset as usize;
        let end = start + entry.size as usize;
        Some(&self.bytes[start..end])
    }

    pub fn strs(&self) -> Result<Option<Strs<'a>>> {
        self.section(SectionKind::STRS).map(Strs::new).transpose()
    }
}
