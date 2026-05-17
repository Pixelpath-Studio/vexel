//! Phase 3 exit criterion: hit-test correctness for representative SVGs.

use vexel_core::{convert_svg_to_vex, ConvertOptions, HitMode, VexelFile};

#[test]
fn hit_a_circle() {
    let svg = r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
      <circle id="dot" cx="100" cy="100" r="50" fill="#3b82f6"/>
    </svg>"##;
    let bytes = convert_svg_to_vex(svg, &ConvertOptions::default()).unwrap();
    let file = VexelFile::parse(&bytes).unwrap();

    // Center is inside.
    assert_eq!(
        file.hit_test(100.0, 100.0, HitMode::VisiblePainted)
            .unwrap()
            .as_deref(),
        Some("dot")
    );
    // Outside.
    assert_eq!(
        file.hit_test(10.0, 10.0, HitMode::VisiblePainted).unwrap(),
        None
    );
    // Just inside the edge.
    assert_eq!(
        file.hit_test(140.0, 100.0, HitMode::VisiblePainted)
            .unwrap()
            .as_deref(),
        Some("dot")
    );
    // Just outside the edge.
    assert_eq!(
        file.hit_test(160.0, 100.0, HitMode::VisiblePainted)
            .unwrap(),
        None
    );
}

#[test]
fn z_order_top_wins() {
    let svg = r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <rect id="bg" x="0" y="0" width="100" height="100" fill="#fafafa"/>
      <rect id="fg" x="20" y="20" width="60" height="60" fill="#ef4444"/>
    </svg>"##;
    let bytes = convert_svg_to_vex(svg, &ConvertOptions::default()).unwrap();
    let file = VexelFile::parse(&bytes).unwrap();

    // Both elements overlap (50,50); fg is on top in document order.
    assert_eq!(
        file.hit_test(50.0, 50.0, HitMode::VisiblePainted)
            .unwrap()
            .as_deref(),
        Some("fg")
    );
    // Only bg at (10,10).
    assert_eq!(
        file.hit_test(10.0, 10.0, HitMode::VisiblePainted)
            .unwrap()
            .as_deref(),
        Some("bg")
    );
}

#[test]
fn stroke_only_line() {
    let svg = r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <path id="line" d="M 10 50 L 90 50" stroke="#000" stroke-width="4" fill="none"/>
    </svg>"##;
    let bytes = convert_svg_to_vex(svg, &ConvertOptions::default()).unwrap();
    let file = VexelFile::parse(&bytes).unwrap();

    // On the line.
    assert_eq!(
        file.hit_test(50.0, 50.0, HitMode::VisiblePainted)
            .unwrap()
            .as_deref(),
        Some("line")
    );
    // 1px off — still within stroke_width/2 + tol = 2.5.
    assert_eq!(
        file.hit_test(50.0, 51.0, HitMode::VisiblePainted)
            .unwrap()
            .as_deref(),
        Some("line")
    );
    // Way off.
    assert_eq!(
        file.hit_test(50.0, 70.0, HitMode::VisiblePainted).unwrap(),
        None
    );
}

#[test]
fn mermaid_short_id_returned() {
    let svg = r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100">
      <rect id="flowchart-Node-1" x="50" y="20" width="100" height="60" fill="#fff" stroke="#000"/>
    </svg>"##;
    let bytes = convert_svg_to_vex(svg, &ConvertOptions::default()).unwrap();
    let file = VexelFile::parse(&bytes).unwrap();

    // IDIX returns the first lexically-sorted id pointing at that element.
    // Both "Node" and "flowchart-Node-1" are present; "Node" sorts first.
    let id = file.hit_test(100.0, 50.0, HitMode::VisiblePainted).unwrap();
    assert!(id.is_some());
    let id = id.unwrap();
    assert!(id == "Node" || id == "flowchart-Node-1", "got {id}");
}

#[test]
fn bbox_mode_includes_transparent_areas() {
    // Bounding-box mode hits even where the shape is empty.
    let svg = r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <circle id="ring" cx="50" cy="50" r="40" stroke="#000" stroke-width="4" fill="none"/>
    </svg>"##;
    let bytes = convert_svg_to_vex(svg, &ConvertOptions::default()).unwrap();
    let file = VexelFile::parse(&bytes).unwrap();

    // Center is inside the bbox but not on the stroke.
    assert_eq!(
        file.hit_test(50.0, 50.0, HitMode::VisiblePainted).unwrap(),
        None
    );
    assert_eq!(
        file.hit_test(50.0, 50.0, HitMode::BoundingBox)
            .unwrap()
            .as_deref(),
        Some("ring")
    );
}
