//! IDIX — identity index — SPEC §3.6.
//!
//! Phase 1 stub: declares the section identifier and entry layout. Full builder
//! and lookup land in phase 2 alongside the converter, which is what populates
//! it.

pub const ENTRY_SIZE: usize = 8; // id_offset: u32, element_index: u32
