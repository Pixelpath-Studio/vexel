//! SVG → IR pipeline — SPEC §4.4.
//!
//! Resilience contract: unsupported features become META warnings, never errors.
//! Hard errors are reserved for genuinely malformed input (and even then we
//! prefer recovery where possible — AI-generated SVG is often syntactically
//! lossy).

pub mod color;
pub mod id_extract;
pub mod path_baking;

use crate::error::{Result, TraceError};
use crate::ir::{Element, ElementFlags, Ir, Rgba, ViewBox};
use std::collections::BTreeSet;
use usvg::{Group, Node, Options, Tree};

/// Options for the SVG → .trace converter. Mirrors the eventual UniFFI surface.
#[derive(Debug, Clone)]
pub struct ConvertOptions {
    /// If set, this string is written as the `generator` META key.
    pub generator: Option<String>,
    /// If true (default), normalize Mermaid ids by inserting both raw and
    /// short forms into IDIX pointing at the same element.
    pub normalize_mermaid_ids: bool,
    /// Resource directory passed to usvg for relative href resolution. Defaults
    /// to None (no embedded image resolution; v1 rejects `<image>` anyway).
    pub resources_dir: Option<std::path::PathBuf>,
}

impl Default for ConvertOptions {
    fn default() -> Self {
        Self {
            generator: None,
            normalize_mermaid_ids: true,
            resources_dir: None,
        }
    }
}

/// Top-level conversion. Parses SVG, walks the usvg tree, builds an IR, then
/// hands off to `crate::serialize::write` for byte output.
pub fn convert_svg_to_ir(svg: &str, opts: &ConvertOptions) -> Result<Ir> {
    // Pre-scan for unsupported tags before usvg silently strips them. usvg's
    // default behavior for <text>/<image>/<filter> is to drop them quietly
    // (text needs a fontdb, image needs an href resolver, filters are out of
    // scope) — so the walker never sees them and can't tag them. A textual
    // scan is the cheapest way to surface "this SVG had X, we ignored it."
    let pre_unsupported = detect_unsupported_tags(svg);

    let usvg_opts = build_usvg_options(opts);
    let tree = Tree::from_str(svg, &usvg_opts).map_err(|e| TraceError::SvgParse(e.to_string()))?;

    // usvg 0.45 normalizes all paths into user space; the effective viewBox is
    // origin (0,0) with the rendered size. (The original SVG viewBox is consumed
    // during transform baking and no longer exposed by Tree.)
    let size = tree.size();
    let viewbox = ViewBox::new(0.0, 0.0, size.width(), size.height());

    let mut ir = Ir::new(viewbox);

    // DoS hardening — hard cap matches SPEC §4.4.
    let mut budget = ElementBudget {
        remaining: 1_000_000,
        depth: 0,
        max_depth: 1024,
        unsupported: pre_unsupported,
    };
    walk_group(tree.root(), &mut ir, &mut budget)?;

    if let Some(gen) = &opts.generator {
        ir.set_metadata("generator", gen.clone());
    }
    if !budget.unsupported.is_empty() {
        let csv: Vec<String> = budget.unsupported.iter().cloned().collect();
        ir.set_metadata("unsupported", csv.join(","));
    }
    // Record declared size so consumers can scale without re-parsing the viewBox.
    ir.set_metadata(
        "rendered-size",
        format!("{}x{}", size.width(), size.height()),
    );

    Ok(ir)
}

/// Top-level conversion, returning serialized `.trace` bytes (includes HITX
/// so the file supports hit-testing out of the box).
pub fn convert_svg_to_trace(svg: &str, opts: &ConvertOptions) -> Result<Vec<u8>> {
    let ir = convert_svg_to_ir(svg, opts)?;
    let extras = if ir.elements.is_empty() {
        Vec::new()
    } else {
        vec![crate::hit::build_hitx_extra(&ir)?]
    };
    crate::serialize::write_with_extras(&ir, &extras, crate::WriterOptions::default())
}

struct ElementBudget {
    remaining: u32,
    depth: u32,
    max_depth: u32,
    unsupported: BTreeSet<String>,
}

/// Detect SVG features that v1 doesn't support, by scanning for their start
/// tags in the raw source. This catches features usvg drops silently (text
/// without fonts, image without resolver, filters, foreignObject, etc.) so the
/// META section can warn downstream consumers.
fn detect_unsupported_tags(svg: &str) -> BTreeSet<String> {
    const TAGS: &[(&str, &str)] = &[
        ("<text", "text"),
        ("<image", "image"),
        ("<filter", "filter"),
        ("<foreignObject", "foreignObject"),
        ("<pattern", "pattern"),
        ("<mask", "mask"),
    ];
    let mut found = BTreeSet::new();
    for (needle, tag) in TAGS {
        if svg.contains(needle) {
            found.insert((*tag).to_owned());
        }
    }
    found
}

fn build_usvg_options(_opts: &ConvertOptions) -> Options<'static> {
    Options {
        // Rasters are out for v1 — silently drop any href the document references.
        image_href_resolver: usvg::ImageHrefResolver {
            resolve_data: Box::new(|_, _, _| None),
            resolve_string: Box::new(|_, _| None),
        },
        ..Options::default()
    }
}

fn walk_group(group: &Group, ir: &mut Ir, budget: &mut ElementBudget) -> Result<()> {
    if budget.depth >= budget.max_depth {
        return Err(TraceError::InvalidFile("nesting exceeds 1024 depth"));
    }
    budget.depth += 1;
    for node in group.children() {
        if budget.remaining == 0 {
            return Err(TraceError::LimitExceeded("element count over 1M"));
        }
        match node {
            Node::Group(g) => walk_group(g, ir, budget)?,
            Node::Path(p) => {
                budget.remaining -= 1;
                push_path(p, ir);
            }
            Node::Image(_) => {
                budget.unsupported.insert("image".into());
            }
            Node::Text(_t) => {
                // Text-as-paths support lands when the text module fully
                // integrates with system fonts. Until then we tag and skip so
                // downstream consumers know it was present.
                budget.unsupported.insert("text".into());
            }
        }
    }
    budget.depth -= 1;
    Ok(())
}

fn push_path(p: &usvg::Path, ir: &mut Ir) {
    if !p.is_visible() {
        return;
    }
    let ir_path = path_baking::from_tiny_skia(p.data());

    let fill_opacity = p.fill().map(|f| f.opacity().get()).unwrap_or(1.0);
    let stroke_opacity = p.stroke().map(|s| s.opacity().get()).unwrap_or(1.0);

    let fill = color::paint_to_rgba(p.fill().map(|f| f.paint()), fill_opacity);
    let stroke = color::paint_to_rgba(p.stroke().map(|s| s.paint()), stroke_opacity);
    let stroke_width = p.stroke().map(|s| s.width().get()).unwrap_or(0.0);

    let mut flags = ElementFlags::default();
    // Default to visiblePainted for taps — equivalent to SVG's
    // pointer-events:visiblePainted unless usvg captured otherwise (we don't
    // currently parse pointer-events; phase 6 hardening).
    flags.0 |= ElementFlags::VISIBLE_PAINTED;
    if matches!(p.fill().map(|f| f.rule()), Some(usvg::FillRule::EvenOdd)) {
        flags.0 |= ElementFlags::EVENODD;
    }
    if let Some(s) = p.stroke() {
        if matches!(s.linecap(), usvg::LineCap::Round) {
            flags.0 |= ElementFlags::LINECAP_ROUND;
        }
        if matches!(s.linejoin(), usvg::LineJoin::Round) {
            flags.0 |= ElementFlags::LINEJOIN_ROUND;
        }
    }

    let id = if p.id().is_empty() {
        None
    } else {
        Some(p.id().to_owned())
    };

    let element = Element {
        id,
        bbox: path_baking::bbox(&ir_path, stroke_width),
        fill: if fill.is_transparent() {
            Rgba::TRANSPARENT
        } else {
            fill
        },
        stroke: if stroke.is_transparent() {
            Rgba::TRANSPARENT
        } else {
            stroke
        },
        stroke_width,
        flags,
        text_run_idx: 0xFF,
        layer_hint: 0,
        path: ir_path,
    };
    ir.push_element(element);
}
