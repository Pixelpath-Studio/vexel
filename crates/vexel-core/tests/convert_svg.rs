//! Phase 2 exit criterion: SVG → IR → bytes → query round-trips for a small
//! representative SVG. Once the Mermaid fixtures land, this is the suite that
//! enforces byte-stability per fixture.

use vexel_core::{convert_svg_to_vex, ConvertOptions, VexelFile};

const SIMPLE: &str = r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect id="bg" x="0" y="0" width="100" height="100" fill="#fafafa"/>
  <circle id="dot" cx="50" cy="50" r="20" fill="#3b82f6" stroke="#1e40af" stroke-width="2"/>
</svg>"##;

#[test]
fn convert_simple_svg() {
    let opts = ConvertOptions {
        generator: Some("test".into()),
        ..ConvertOptions::default()
    };
    let bytes = convert_svg_to_vex(SIMPLE, &opts).expect("convert");
    let file = VexelFile::parse(&bytes).expect("parse");
    assert_eq!(file.element_count().unwrap(), 2);
    assert_eq!(file.viewbox().w, 100.0);
    assert_eq!(file.viewbox().h, 100.0);

    let ids = file.ids().unwrap();
    assert!(ids.contains(&"bg"), "ids contains bg: {ids:?}");
    assert!(ids.contains(&"dot"), "ids contains dot: {ids:?}");

    let bg_idx = file.element_index_of("bg").unwrap();
    let dot_idx = file.element_index_of("dot").unwrap();
    assert!(bg_idx.is_some());
    assert!(dot_idx.is_some());

    let dot = file.element_by_id("dot").unwrap().expect("dot present");
    // Circle radius 20 at (50,50) with stroke width 2 → bbox includes stroke half.
    assert!(dot.bbox.min_x <= 30.0 + 0.001);
    assert!(dot.bbox.max_x >= 70.0 - 0.001);
    assert_ne!(dot.fill, vexel_core::Rgba::TRANSPARENT);
    assert_ne!(dot.stroke, vexel_core::Rgba::TRANSPARENT);
    assert!((dot.stroke_width - 2.0).abs() < 0.01);

    assert_eq!(file.metadata("generator").unwrap().as_deref(), Some("test"));
}

#[test]
fn mermaid_id_normalization() {
    let svg = r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100">
      <rect id="flowchart-Start-1" x="10" y="10" width="80" height="40" fill="#fff" stroke="#000"/>
      <rect id="flowchart-End-2" x="110" y="10" width="80" height="40" fill="#fff" stroke="#000"/>
      <path id="L_Start_End_0" d="M 90 30 L 110 30" stroke="#000"/>
    </svg>"##;
    let bytes = convert_svg_to_vex(svg, &ConvertOptions::default()).unwrap();
    let file = VexelFile::parse(&bytes).unwrap();

    assert!(file
        .element_index_of("flowchart-Start-1")
        .unwrap()
        .is_some());
    assert!(file.element_index_of("flowchart-End-2").unwrap().is_some());
    assert!(file.element_index_of("L_Start_End_0").unwrap().is_some());

    let start_short = file.element_index_of("Start").unwrap();
    let start_raw = file.element_index_of("flowchart-Start-1").unwrap();
    assert_eq!(start_short, start_raw);

    let edge_short = file.element_index_of("Start->End").unwrap();
    let edge_raw = file.element_index_of("L_Start_End_0").unwrap();
    assert_eq!(edge_short, edge_raw);
}

#[test]
fn deterministic_conversion() {
    let a = convert_svg_to_vex(SIMPLE, &ConvertOptions::default()).unwrap();
    let b = convert_svg_to_vex(SIMPLE, &ConvertOptions::default()).unwrap();
    assert_eq!(
        a, b,
        "convert must be deterministic for the conformance suite"
    );
}

#[test]
fn unsupported_features_are_tagged() {
    let svg = r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <text x="10" y="20">hello</text>
      <rect id="r" x="0" y="0" width="10" height="10" fill="#000"/>
    </svg>"##;
    let bytes = convert_svg_to_vex(svg, &ConvertOptions::default()).unwrap();
    let file = VexelFile::parse(&bytes).unwrap();
    let unsupported = file.metadata("unsupported").unwrap().unwrap_or_default();
    assert!(
        unsupported.contains("text"),
        "expected 'text' in unsupported list, got {unsupported:?}"
    );
    assert!(file.element_index_of("r").unwrap().is_some());
}
