//! Generates the canonical bytes for conformance fixture 001-empty.
//!
//! Run from the repo root:
//!   cargo run -p vexel-core --example gen_fixture_001 > \
//!     packages/conformance/fixtures/001-empty/output.vex

use std::io::Write;
use vexel_core::{Ir, ViewBox};

fn main() -> std::io::Result<()> {
    let ir = Ir::new(ViewBox::new(0.0, 0.0, 800.0, 600.0));
    let bytes = vexel_core::write(&ir).expect("serialize");
    std::io::stdout().write_all(&bytes)?;
    Ok(())
}
