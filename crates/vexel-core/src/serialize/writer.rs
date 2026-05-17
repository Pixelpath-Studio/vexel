//! IR → `.vex` bytes.
//!
//! Phases 2+ build the full GEOM/IDIX/META payload. HITX/ANIM payloads are
//! written by their respective builders (`hit::build_hitx`, `session::build_anim`)
//! and passed in here via `ExtraSection`.

use crate::convert::id_extract;
use crate::error::{Result, VexelError};
use crate::format::{
    geom::GeomBuilder,
    header::{FileFlags, Footer, Header, FOOTER_SIZE, HEADER_SIZE, VERSION_MAJOR, VERSION_MINOR},
    idix::IdixBuilder,
    meta::MetaBuilder,
    section_table::{align4, SectionEntry, SectionKind, SECTION_ENTRY_SIZE},
    strs::StrsBuilder,
};
use crate::ir::Ir;

/// A pre-built section payload added to the file. Used by phases 3+ (HITX) and
/// phase 6 (ANIM) without expanding the writer's signature each time.
pub struct ExtraSection {
    pub kind: SectionKind,
    pub payload: Vec<u8>,
}

pub fn write(ir: &Ir) -> Result<Vec<u8>> {
    write_with_extras(ir, &[], WriterOptions::default())
}

#[derive(Debug, Clone)]
pub struct WriterOptions {
    pub is_streaming_snapshot: bool,
    /// If true, also insert Mermaid-normalized short ids into IDIX pointing at
    /// the same element_index. Default true (matches `ConvertOptions::default`).
    pub normalize_mermaid_ids: bool,
}

impl Default for WriterOptions {
    fn default() -> Self {
        Self {
            is_streaming_snapshot: false,
            normalize_mermaid_ids: true,
        }
    }
}

pub fn write_with_extras(ir: &Ir, extras: &[ExtraSection], opts: WriterOptions) -> Result<Vec<u8>> {
    // 1. STRS first so META and IDIX can intern.
    let mut strs = StrsBuilder::new();
    let mut meta = MetaBuilder::new();
    for (k, v) in &ir.metadata {
        meta.push(&mut strs, k, v);
    }

    // 2. GEOM from IR.
    let mut geom = GeomBuilder::new();
    let mut idix = IdixBuilder::new();
    for (idx, el) in ir.elements.iter().enumerate() {
        let idx_u32 = idx as u32;
        if let Some(id) = &el.id {
            idix.insert(id, idx_u32);
            if opts.normalize_mermaid_ids {
                if let Some(short) = id_extract::normalize(id) {
                    if &short != id {
                        idix.insert(&short, idx_u32);
                    }
                }
            }
        }
        geom.push(el.clone());
    }

    let geom_bytes = geom.into_bytes();
    let idix_bytes = if idix.is_empty() {
        Vec::new()
    } else {
        idix.into_bytes(&mut strs)
    };
    let meta_bytes = if meta.is_empty() {
        Vec::new()
    } else {
        meta.into_bytes()
    };
    let strs_bytes = strs.into_bytes();

    // 3. Plan section order (conventional: GEOM, IDIX, HITX, STRS, ANIM, META).
    struct Section {
        kind: SectionKind,
        payload: Vec<u8>,
    }
    let mut sections: Vec<Section> = Vec::new();
    sections.push(Section {
        kind: SectionKind::GEOM,
        payload: geom_bytes,
    });
    if !idix_bytes.is_empty() {
        sections.push(Section {
            kind: SectionKind::IDIX,
            payload: idix_bytes,
        });
    }
    for ex in extras.iter().filter(|e| e.kind == SectionKind::HITX) {
        sections.push(Section {
            kind: ex.kind,
            payload: ex.payload.clone(),
        });
    }
    sections.push(Section {
        kind: SectionKind::STRS,
        payload: strs_bytes,
    });
    for ex in extras.iter().filter(|e| e.kind == SectionKind::ANIM) {
        sections.push(Section {
            kind: ex.kind,
            payload: ex.payload.clone(),
        });
    }
    if !meta_bytes.is_empty() {
        sections.push(Section {
            kind: SectionKind::META,
            payload: meta_bytes,
        });
    }
    // Pass through any other extras (forward-compat).
    for ex in extras
        .iter()
        .filter(|e| !matches!(e.kind, SectionKind::HITX | SectionKind::ANIM))
    {
        sections.push(Section {
            kind: ex.kind,
            payload: ex.payload.clone(),
        });
    }

    // 4. Compute offsets.
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
        return Err(VexelError::Internal("file size exceeds u32::MAX"));
    }

    // 5. Assemble.
    let mut out = vec![0u8; total_size];

    let mut flags = FileFlags::default();
    flags = flags.with(
        FileFlags::HAS_HIT_TEST,
        entries.iter().any(|e| e.kind == SectionKind::HITX),
    );
    flags = flags.with(
        FileFlags::HAS_ANIMATION,
        entries.iter().any(|e| e.kind == SectionKind::ANIM),
    );
    flags = flags.with(FileFlags::IS_STREAMING_SNAPSHOT, opts.is_streaming_snapshot);
    if !ir.elements.is_empty() {
        // We currently only emit text-as-paths; tag accordingly.
        flags = flags.with(FileFlags::TEXT_AS_PATHS, true);
    }

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
    }
    let body_crc = crc32fast::hash(&out[..body_end]);
    Footer {
        body_crc32: body_crc,
        total_size: total_size as u32,
    }
    .write_into(&mut out[body_end..body_end + FOOTER_SIZE]);

    Ok(out)
}
