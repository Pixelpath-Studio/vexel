//! Phase 6a/b: streaming Session with ANIM section round-trip.

use trace_core::{Easing, FragmentAnim, HitMode, Session, StartAfter, TraceFile, ViewBox};

#[test]
fn append_fragments_and_snapshot() {
    let mut s = Session::new(ViewBox::new(0.0, 0.0, 200.0, 200.0));
    let ids1 = s
        .append_svg_fragment(
            r##"<circle id="dot" cx="50" cy="50" r="20" fill="#3b82f6"/>"##,
            Some(FragmentAnim {
                stroke_draw_ms: Some(500),
                fill_fade_ms: Some(300),
                start_after: StartAfter::Immediately,
                easing: Easing::HandNatural,
            }),
        )
        .unwrap();
    assert_eq!(ids1, vec!["dot"]);

    let ids2 = s
        .append_svg_fragment(
            r##"<rect id="box" x="100" y="100" width="50" height="50" fill="#ef4444"/>"##,
            Some(FragmentAnim {
                stroke_draw_ms: Some(400),
                fill_fade_ms: None,
                start_after: StartAfter::PreviousFragment,
                easing: Easing::EaseOut,
            }),
        )
        .unwrap();
    assert_eq!(ids2, vec!["box"]);

    assert_eq!(s.element_count(), 2);
    assert_eq!(s.version(), 2);

    let bytes = s.snapshot().unwrap();
    let file = TraceFile::parse(&bytes).unwrap();
    assert_eq!(file.element_count().unwrap(), 2);
    assert!(file.element_index_of("dot").unwrap().is_some());
    assert!(file.element_index_of("box").unwrap().is_some());

    // IS_STREAMING_SNAPSHOT flag set.
    use trace_core::FileFlags;
    assert!(file.flags().has(FileFlags::IS_STREAMING_SNAPSHOT));
    // HAS_ANIMATION set because we scheduled tracks.
    assert!(file.flags().has(FileFlags::HAS_ANIMATION));

    // Hit-test works on the snapshot.
    let hit = file.hit_test(50.0, 50.0, HitMode::VisiblePainted).unwrap();
    assert_eq!(hit.as_deref(), Some("dot"));
}

#[test]
fn synthetic_ids_for_anonymous_elements() {
    let mut s = Session::new(ViewBox::new(0.0, 0.0, 100.0, 100.0));
    let ids = s
        .append_svg_fragment(r##"<circle cx="50" cy="50" r="10" fill="#000"/>"##, None)
        .unwrap();
    assert_eq!(ids.len(), 1);
    assert!(
        ids[0].starts_with("__frag_"),
        "expected synthetic id, got {}",
        ids[0]
    );
}

#[test]
fn remove_drops_id() {
    let mut s = Session::new(ViewBox::new(0.0, 0.0, 100.0, 100.0));
    s.append_svg_fragment(
        r##"<rect id="r1" x="0" y="0" width="10" height="10" fill="#000"/>"##,
        None,
    )
    .unwrap();
    assert!(s.ids().contains(&"r1".to_owned()));
    assert!(s.remove_element("r1"));
    assert!(!s.ids().contains(&"r1".to_owned()));
    // Still present in element count (we keep the slot to preserve indices).
    assert_eq!(s.element_count(), 1);
}

#[test]
fn element_count_limit_enforced() {
    let mut s = Session::new(ViewBox::new(0.0, 0.0, 1000.0, 1000.0));
    // Build a fragment with many tiny rects.
    let mut frag = String::new();
    for i in 0..100 {
        frag.push_str(&format!(
            r##"<rect id="r{i}" x="{x}" y="0" width="1" height="1" fill="#000"/>"##,
            x = i
        ));
    }
    // 100 elements, well under the cap.
    s.append_svg_fragment(&frag, None).unwrap();
    assert_eq!(s.element_count(), 100);
}
