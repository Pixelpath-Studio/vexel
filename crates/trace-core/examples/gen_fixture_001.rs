//! Generates the canonical bytes for conformance fixture 001-empty.
//!
//! Run from the repo root:
//!   cargo run -p trace-core --example gen_fixture_001 > \
//!     packages/conformance/fixtures/001-empty/output.trace

use std::io::Write;
use trace_core::{Ir, ViewBox};

fn main() -> std::io::Result<()> {
    let ir = Ir::new(ViewBox::new(0.0, 0.0, 800.0, 600.0));
    let bytes = trace_core::write(&ir).expect("serialize");
    std::io::stdout().write_all(&bytes)?;
    Ok(())
}
