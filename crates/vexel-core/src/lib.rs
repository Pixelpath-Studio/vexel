//! `vexel-core` — the reference Rust core for the Vexel vector graphics format.
//!
//! This crate parses SVG, normalizes it to an in-memory IR, builds a hit-test
//! index, serializes to `.vex` bytes, and exposes a zero-copy query API. It
//! contains no platform graphics code: rasterization lives on the iOS and
//! Android runtimes (via Skia).
//!
//! The three identity invariants that the entire codebase upholds are documented
//! in `SPEC.md`'s "Implementation notes for Claude Code":
//!
//! 1. The Rust core is the single source of truth for scene structure and
//!    hit-testing.
//! 2. Each addressable element gets its own draw call.
//! 3. The identity-to-handle map lives in the platform/RN layer, not in Skia.

pub mod api;
pub mod convert;
pub mod error;
pub mod format;
pub mod hit;
pub mod ir;
pub mod serialize;
pub mod session;

pub use api::VexelFile;
pub use convert::{convert_svg_to_ir, convert_svg_to_vex, ConvertOptions};
pub use error::{Result, VexelError};
pub use format::anim::{AnimTrack, Easing, TrackType};
pub use format::header::{FileFlags, VERSION_MAJOR, VERSION_MINOR};
pub use format::section_table::SectionKind;
pub use hit::HitMode;
pub use ir::{Element, ElementFlags, Ir, Path, Point, Rect, Rgba, Verb, ViewBox};
pub use serialize::{write, write_with_extras, ExtraSection, WriterOptions};
pub use session::{FragmentAnim, Session, StartAfter};
