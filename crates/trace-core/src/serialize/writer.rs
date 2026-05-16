//! IR → `.trace` bytes.
//!
//! Phase 1 supports the minimal sections needed for a round-trip: STRS, GEOM
//! (element count only), and optional META. IDIX/HITX/ANIM land with their
//! respective phases. The writer layout walks header → section table →
//! 4-byte-aligned payloads → footer, matching SPEC §3.2.

use crate::error::{Result, TraceError};
use crate::format::{
    geom::GeomBuilder,
    header::{FileFlags, Footer, Header, FOOTER_SIZE, HEADER_SIZE, VERSION_MAJOR, VERSION_MINOR},
    meta::MetaBuilder,
    section_table::{align4, SectionEntry, SectionKind, SECTION_ENTRY_SIZE},
    strs::StrsBuilder,
};
use crate::ir::Ir;

pub fn write(ir: &Ir) -> Result<Vec<u8>> {
    // 1. Build STRS first because META and (later) GEOM/IDIX/HITX all intern into it.
    let mut strs = StrsBuilder::new();
    let mut meta = MetaBuilder::new();
    for (k, v) in &ir.metadata {
        meta.push(&mut strs, k, v);
    }
    let geom = {
        // Phase 1: element_count = 0 until the converter lands in phase 2.
        if !ir.elements.is_empty() {
            return Err(TraceError::Internal(
                "phase 1 writer only handles empty IR; elements land in phase 2",
            ));
        }
        GeomBuilder::new()
    };

    // 2. Materialize payloads in the order they'll appear on the wire.
    //    The order is conventional, not load-bearing: section table indirects by
    //    offset, so any order is legal. Use GEOM → IDIX → HITX → STRS → ANIM → META
    //    for readability per the table in §3.2.
    struct Section {
        kind: SectionKind,
        payload: Vec<u8>,
    }

    let mut sections: Vec<Section> = Vec::new();
    sections.push(Section {
        kind: SectionKind::GEOM,
        payload: geom.into_bytes(),
    });
    if !meta.is_empty() {
        // META first so its STRS references are stable before STRS is moved.
        // (No-op for ordering — STRS is built independently — but mirrors how phase 2+
        // builders interact.)
    }
    sections.push(Section {
        kind: SectionKind::STRS,
        payload: strs.into_bytes(),
    });
    if !meta.is_empty() {
        sections.push(Section {
            kind: SectionKind::META,
            payload: meta.into_bytes(),
        });
    }

    // 3. Plan offsets. Body starts after header + section table.
    let table_size = sections.len() * SECTION_ENTRY_SIZE;
    let body_start = HEADER_SIZE + table_size;
    let mut cursor = body_start;
    let mut entries: Vec<SectionEntry> = Vec::with_capacity(sections.len());
    for s in &sections {
        let aligned = align4(cursor);
        entries.push(SectionEntry {
            kind: s.kind,
            offset: aligned as u32,
            size: s.payload.len() as u32,
            version_major: 1,
            version_minor: 0,
        });
        cursor = aligned + s.payload.len();
    }
    let body_end = cursor;
    let total_size = body_end + FOOTER_SIZE;
    if total_size > u32::MAX as usize {
        return Err(TraceError::Internal("file size exceeds u32::MAX"));
    }

    // 4. Assemble.
    let mut out = vec![0u8; total_size];

    // Header flag bits computed from what we wrote.
    let mut flags = FileFlags::default();
    flags = flags.with(
        FileFlags::HAS_HIT_TEST,
        entries.iter().any(|e| e.kind == SectionKind::HITX),
    );
    flags = flags.with(
        FileFlags::HAS_ANIMATION,
        entries.iter().any(|e| e.kind == SectionKind::ANIM),
    );

    Header {
        major: VERSION_MAJOR,
        minor: VERSION_MINOR,
        flags,
        viewbox: ir.viewbox,
        section_count: entries.len() as u32,
    }
    .write_into(&mut out[..HEADER_SIZE]);

    for (i, entry) in entries.iter().enumerate() {
        let off = HEADER_SIZE + i * SECTION_ENTRY_SIZE;
        entry.write_into(&mut out[off..off + SECTION_ENTRY_SIZE]);
    }

    for (entry, section) in entries.iter().zip(sections.iter()) {
        let start = entry.offset as usize;
        let end = start + section.payload.len();
        out[start..end].copy_from_slice(&section.payload);
        // Padding bytes between sections remain zero (4-byte alignment).
    }

    let body_crc = crc32fast::hash(&out[..body_end]);
    Footer {
        body_crc32: body_crc,
        total_size: total_size as u32,
    }
    .write_into(&mut out[body_end..body_end + FOOTER_SIZE]);

    Ok(out)
}
