//! Phase 1 exit criterion: write an empty `.vex`, read it back, assert byte
//! identity and that all header/footer/section-table fields survive.

use vexel_core::format::header::{
    FileFlags, Footer, Header, FOOTER_SIZE, HEADER_SIZE, VERSION_MAJOR, VERSION_MINOR,
};
use vexel_core::{Ir, VexelFile, ViewBox};

#[test]
fn empty_file_roundtrip() {
    let ir = Ir::new(ViewBox::new(0.0, 0.0, 800.0, 600.0));
    let bytes = vexel_core::write(&ir).expect("serialize");

    // Header magic must be present.
    assert_eq!(&bytes[0..4], b"VEXL");

    // Footer magic must be at total_size - 16 + 8.
    let total = bytes.len();
    assert!(total >= HEADER_SIZE + FOOTER_SIZE, "file too small");
    assert_eq!(
        &bytes[total - FOOTER_SIZE + 8..total - FOOTER_SIZE + 12],
        b"vex!"
    );

    // Parse and verify field round-trip.
    let header = Header::parse(&bytes[..HEADER_SIZE]).expect("header");
    assert_eq!(header.major, VERSION_MAJOR);
    assert_eq!(header.minor, VERSION_MINOR);
    assert_eq!(header.viewbox.x, 0.0);
    assert_eq!(header.viewbox.y, 0.0);
    assert_eq!(header.viewbox.w, 800.0);
    assert_eq!(header.viewbox.h, 600.0);
    // No HITX, no ANIM in an empty file.
    assert!(!header.flags.has(FileFlags::HAS_HIT_TEST));
    assert!(!header.flags.has(FileFlags::HAS_ANIMATION));

    let footer = Footer::parse(&bytes[total - FOOTER_SIZE..]).expect("footer");
    assert_eq!(footer.total_size as usize, total);

    // Public VexelFile API.
    let file = VexelFile::parse(&bytes).expect("trace file parse");
    let vb = file.viewbox();
    assert_eq!(vb.w, 800.0);
    assert_eq!(vb.h, 600.0);
    assert_eq!(file.element_count().expect("element_count"), 0);
    assert_eq!(file.version(), (VERSION_MAJOR, VERSION_MINOR));
}

#[test]
fn deterministic_serialization() {
    // The same IR must produce byte-identical output across calls. This is the
    // foundation of the conformance suite (canonical `output.vex` per fixture).
    let ir = Ir::new(ViewBox::new(0.0, 0.0, 100.0, 100.0));
    let a = vexel_core::write(&ir).unwrap();
    let b = vexel_core::write(&ir).unwrap();
    assert_eq!(a, b, "serialization must be deterministic");
}

#[test]
fn metadata_roundtrip() {
    let mut ir = Ir::new(ViewBox::new(0.0, 0.0, 100.0, 100.0));
    ir.set_metadata("generator", "vexel-core-test");
    ir.set_metadata("title", "round-trip fixture");

    let bytes = vexel_core::write(&ir).unwrap();
    let file = VexelFile::parse(&bytes).unwrap();
    assert_eq!(
        file.metadata("generator").unwrap().as_deref(),
        Some("vexel-core-test"),
    );
    assert_eq!(
        file.metadata("title").unwrap().as_deref(),
        Some("round-trip fixture"),
    );
    assert_eq!(file.metadata("missing").unwrap(), None);
}

#[test]
fn rejects_bad_magic() {
    let mut bytes = vexel_core::write(&Ir::new(ViewBox::new(0.0, 0.0, 1.0, 1.0))).unwrap();
    bytes[0] = b'X';
    let err = VexelFile::parse(&bytes).unwrap_err();
    assert!(matches!(err, vexel_core::VexelError::InvalidFile(_)));
}

#[test]
fn rejects_corrupted_body() {
    let mut bytes = vexel_core::write(&Ir::new(ViewBox::new(0.0, 0.0, 1.0, 1.0))).unwrap();
    // Flip a byte in the body (after header, before footer).
    let off = HEADER_SIZE + 4;
    bytes[off] ^= 0xFF;
    let err = VexelFile::parse(&bytes).unwrap_err();
    assert!(matches!(err, vexel_core::VexelError::InvalidFile(_)));
}
