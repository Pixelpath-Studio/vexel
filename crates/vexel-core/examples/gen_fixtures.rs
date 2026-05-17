//! Regenerate every conformance fixture's `output.vex` from its `input.svg`
//! or `input.json`. Run from the repo root:
//!
//!   cargo run -p vexel-core --example gen_fixtures
//!
//! For SVG inputs the converter is the authority. For JSON inputs (the
//! `001-empty` style), we reconstruct an IR by hand and serialize.

use std::fs;
use std::path::{Path, PathBuf};
use vexel_core::{convert_svg_to_vex, ConvertOptions, Ir, ViewBox};

fn main() -> std::io::Result<()> {
    let fixtures_dir = PathBuf::from("packages/conformance/fixtures");
    if !fixtures_dir.exists() {
        eprintln!("fixtures dir not found: {fixtures_dir:?}");
        std::process::exit(1);
    }

    let mut entries: Vec<_> = fs::read_dir(&fixtures_dir)?
        .filter_map(|e| e.ok())
        .filter(|e| e.path().is_dir())
        .collect();
    entries.sort_by_key(|e| e.path());

    let mut count = 0;
    for entry in entries {
        let dir = entry.path();
        let name = dir.file_name().and_then(|s| s.to_str()).unwrap_or_default();
        let out_path = dir.join("output.vex");

        if let Some(bytes) = build_from_svg(&dir) {
            fs::write(&out_path, &bytes)?;
            println!("{name}: {} bytes (from SVG)", bytes.len());
            count += 1;
        } else if let Some(bytes) = build_from_json(&dir) {
            fs::write(&out_path, &bytes)?;
            println!("{name}: {} bytes (from JSON)", bytes.len());
            count += 1;
        } else {
            eprintln!("{name}: no input.svg or input.json; skipping");
        }
    }
    eprintln!("regenerated {count} fixtures");
    Ok(())
}

fn build_from_svg(dir: &Path) -> Option<Vec<u8>> {
    let svg_path = dir.join("input.svg");
    if !svg_path.exists() {
        return None;
    }
    let svg = fs::read_to_string(&svg_path).ok()?;
    let opts = ConvertOptions {
        generator: Some("trace-conformance".into()),
        ..ConvertOptions::default()
    };
    convert_svg_to_vex(&svg, &opts).ok()
}

fn build_from_json(dir: &Path) -> Option<Vec<u8>> {
    // Minimal JSON fixture format: { "viewBox": [x, y, w, h], "elements": [] }.
    // Only the 001-empty fixture uses this for now — designed for the absolute
    // minimum-valid file case where SVG input would be ambiguous.
    let json_path = dir.join("input.json");
    if !json_path.exists() {
        return None;
    }
    let txt = fs::read_to_string(&json_path).ok()?;
    let open = txt.find("\"viewBox\"")?;
    let lb = txt[open..].find('[')? + open;
    let rb = txt[lb..].find(']')? + lb;
    let nums: Vec<f32> = txt[lb + 1..rb]
        .split(',')
        .map(|s| s.trim().parse().ok())
        .collect::<Option<Vec<_>>>()?;
    if nums.len() != 4 {
        return None;
    }
    let ir = Ir::new(ViewBox::new(nums[0], nums[1], nums[2], nums[3]));
    vexel_core::write(&ir).ok()
}
