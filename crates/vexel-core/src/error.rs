use thiserror::Error;

/// All fallible operations in `vexel_core` return this error.
///
/// The conversion path (SVG → IR → bytes) is deliberately tolerant: unrecognized
/// SVG features become META warnings, never `VexelError`. Hard errors are reserved
/// for genuinely malformed input or violated invariants.
#[derive(Error, Debug)]
pub enum VexelError {
    #[error("SVG parse error: {0}")]
    SvgParse(String),

    #[error("malformed .vex file: {0}")]
    InvalidFile(&'static str),

    #[error("unsupported version: {major}.{minor}")]
    UnsupportedVersion { major: u16, minor: u16 },

    #[error("element id not found: {0}")]
    UnknownId(String),

    #[error("session limit exceeded: {0}")]
    LimitExceeded(&'static str),

    #[error("internal invariant violated: {0}")]
    Internal(&'static str),

    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
}

pub type Result<T> = std::result::Result<T, VexelError>;
