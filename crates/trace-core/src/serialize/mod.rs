//! IR → `.trace` byte stream.

pub mod writer;

pub use writer::{write, write_with_extras, ExtraSection, WriterOptions};
