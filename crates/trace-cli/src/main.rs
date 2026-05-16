//! `trace-cli` — reference CLI for the Trace format.
//!
//! Subcommands per SPEC §10:
//!   convert <input.svg> [--out <output.trace>]
//!   inspect <file.trace>
//!   dump    <file.trace>
//!   validate <file.trace>
//!   diff    <a.trace> <b.trace>
//!   pack    <input.json> [--out <output.trace>]   (round-trips dump output)
//!
//! Avoids a CLI-parser dependency for binary-size discipline. The argument
//! grammar is small and the parsing is straightforward.

use std::fs;
use std::path::PathBuf;
use std::process::ExitCode;
use trace_core::{ConvertOptions, TraceFile};

#[cfg(unix)]
fn reset_sigpipe() {
    // SAFETY: SIGPIPE handler reset must be done at startup before any I/O
    // begins. Standard POSIX CLI hygiene; no concurrency involved.
    #[allow(unsafe_code)]
    unsafe {
        extern "C" {
            fn signal(signum: i32, handler: usize) -> usize;
        }
        const SIGPIPE: i32 = 13;
        const SIG_DFL: usize = 0;
        signal(SIGPIPE, SIG_DFL);
    }
}

#[cfg(not(unix))]
fn reset_sigpipe() {}

fn main() -> ExitCode {
    // Exit cleanly when stdout is closed by a downstream `head`/`less`/etc.
    // (default Rust behavior is to panic on EPIPE, which is ugly in pipelines.)
    reset_sigpipe();
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.is_empty() {
        print_usage();
        return ExitCode::from(2);
    }
    let (sub, rest) = args.split_first().unwrap();
    match sub.as_str() {
        "convert" => run(convert(rest)),
        "inspect" => run(inspect(rest)),
        "dump" => run(dump(rest)),
        "validate" => run(validate(rest)),
        "diff" => run(diff(rest)),
        "pack" => run(pack(rest)),
        "--help" | "-h" | "help" => {
            print_usage();
            ExitCode::SUCCESS
        }
        "--version" | "-v" => {
            println!("trace-cli {}", env!("CARGO_PKG_VERSION"));
            ExitCode::SUCCESS
        }
        other => {
            eprintln!("trace-cli: unknown subcommand: {other}");
            print_usage();
            ExitCode::from(2)
        }
    }
}

fn run(result: Result<(), String>) -> ExitCode {
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(msg) => {
            eprintln!("trace-cli: error: {msg}");
            ExitCode::FAILURE
        }
    }
}

fn print_usage() {
    eprintln!(
        "trace-cli {version} — reference CLI for the Trace format

USAGE:
  trace-cli convert  <input.svg>     [--out <output.trace>] [--generator <name>]
  trace-cli inspect  <file.trace>
  trace-cli dump     <file.trace>
  trace-cli validate <file.trace>
  trace-cli diff     <a.trace> <b.trace>
  trace-cli pack     <input.json>    [--out <output.trace>]

SUBCOMMANDS:
  convert    SVG → .trace. Defaults output path to <input>.trace.
  inspect    Print viewBox, element count, ids, metadata, animation tracks.
  dump       Print a JSON representation of the file (round-trips with `pack`).
  validate   Verify CRC, section table, magic bytes.
  diff       Structural diff of two .trace files.
  pack       JSON → .trace (reverse of `dump`).
",
        version = env!("CARGO_PKG_VERSION")
    )
}

// ---------------------------------------------------------------------------
// convert

fn convert(args: &[String]) -> Result<(), String> {
    let mut input: Option<PathBuf> = None;
    let mut output: Option<PathBuf> = None;
    let mut generator: Option<String> = None;
    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--out" | "-o" => {
                i += 1;
                output = Some(PathBuf::from(args.get(i).ok_or("--out needs a value")?));
            }
            "--generator" => {
                i += 1;
                generator = Some(args.get(i).ok_or("--generator needs a value")?.clone());
            }
            other if input.is_none() && !other.starts_with("--") => {
                input = Some(PathBuf::from(other));
            }
            other => return Err(format!("unexpected arg: {other}")),
        }
        i += 1;
    }
    let input = input.ok_or("missing <input.svg>")?;
    let svg = fs::read_to_string(&input).map_err(|e| format!("reading {input:?}: {e}"))?;
    let opts = ConvertOptions {
        generator: generator.or_else(|| Some(format!("trace-cli {}", env!("CARGO_PKG_VERSION")))),
        ..ConvertOptions::default()
    };
    let bytes =
        trace_core::convert_svg_to_trace(&svg, &opts).map_err(|e| format!("convert: {e}"))?;
    let out_path = output.unwrap_or_else(|| {
        let mut p = input.clone();
        p.set_extension("trace");
        p
    });
    fs::write(&out_path, &bytes).map_err(|e| format!("writing {out_path:?}: {e}"))?;
    eprintln!("wrote {} ({} bytes)", out_path.display(), bytes.len());
    Ok(())
}

// ---------------------------------------------------------------------------
// inspect

fn inspect(args: &[String]) -> Result<(), String> {
    let path = args.first().ok_or("missing <file.trace>")?;
    let bytes = fs::read(path).map_err(|e| format!("reading {path}: {e}"))?;
    let file = TraceFile::parse(&bytes).map_err(|e| format!("parse: {e}"))?;
    println!("file:         {path}");
    println!("size:         {} bytes", bytes.len());
    let (maj, min) = file.version();
    println!("version:      {maj}.{min}");
    let vb = file.viewbox();
    println!("viewBox:      [{} {} {} {}]", vb.x, vb.y, vb.w, vb.h);
    let flags = file.flags().0;
    println!("flags:        0x{flags:08x}");
    println!(
        "elements:     {}",
        file.element_count().map_err(|e| e.to_string())?
    );
    let ids = file.ids().map_err(|e| e.to_string())?;
    println!("ids:          {}", ids.len());
    for id in ids.iter().take(20) {
        println!("  - {id}");
    }
    if ids.len() > 20 {
        println!("  ... ({} more)", ids.len() - 20);
    }
    // Print common metadata keys.
    for key in [
        "generator",
        "title",
        "unsupported",
        "rendered-size",
        "source-hash",
    ] {
        if let Ok(Some(v)) = file.metadata(key) {
            println!("meta.{key}: {v}");
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// validate

fn validate(args: &[String]) -> Result<(), String> {
    let path = args.first().ok_or("missing <file.trace>")?;
    let bytes = fs::read(path).map_err(|e| format!("reading {path}: {e}"))?;
    let file = TraceFile::parse(&bytes).map_err(|e| format!("invalid: {e}"))?;
    let n = file.element_count().map_err(|e| e.to_string())?;
    println!(
        "{path}: ok ({} elements, version {}.{})",
        n,
        file.version().0,
        file.version().1
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// dump  (JSON)
//
// Hand-rolled JSON to keep the dep tree small. Output is stable enough to be
// round-tripped through `pack`.

fn dump(args: &[String]) -> Result<(), String> {
    let path = args.first().ok_or("missing <file.trace>")?;
    let bytes = fs::read(path).map_err(|e| format!("reading {path}: {e}"))?;
    let file = TraceFile::parse(&bytes).map_err(|e| format!("parse: {e}"))?;
    let vb = file.viewbox();
    let mut out = String::new();
    out.push_str("{\n");
    out.push_str(&format!(
        "  \"viewBox\": [{}, {}, {}, {}],\n",
        vb.x, vb.y, vb.w, vb.h
    ));
    let ids = file.ids().map_err(|e| e.to_string())?;
    out.push_str("  \"ids\": [");
    for (i, id) in ids.iter().enumerate() {
        if i > 0 {
            out.push(',');
        }
        out.push_str(&format!("\"{}\"", json_escape(id)));
    }
    out.push_str("],\n");
    out.push_str("  \"metadata\": {");
    let mut first = true;
    for key in [
        "generator",
        "title",
        "description",
        "unsupported",
        "rendered-size",
        "source-hash",
    ] {
        if let Ok(Some(v)) = file.metadata(key) {
            if !first {
                out.push(',');
            }
            first = false;
            out.push_str(&format!(
                "\"{}\": \"{}\"",
                json_escape(key),
                json_escape(&v)
            ));
        }
    }
    out.push_str("},\n");
    out.push_str("  \"element_count\": ");
    out.push_str(&file.element_count().map_err(|e| e.to_string())?.to_string());
    out.push_str("\n}\n");
    print!("{out}");
    Ok(())
}

fn json_escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out
}

// ---------------------------------------------------------------------------
// pack  (reverse of dump; minimal — viewBox + metadata, empty body)

fn pack(args: &[String]) -> Result<(), String> {
    let mut input: Option<PathBuf> = None;
    let mut output: Option<PathBuf> = None;
    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--out" | "-o" => {
                i += 1;
                output = Some(PathBuf::from(args.get(i).ok_or("--out needs a value")?));
            }
            other if input.is_none() && !other.starts_with("--") => {
                input = Some(PathBuf::from(other));
            }
            other => return Err(format!("unexpected arg: {other}")),
        }
        i += 1;
    }
    let input = input.ok_or("missing <input.json>")?;
    let json = fs::read_to_string(&input).map_err(|e| format!("reading {input:?}: {e}"))?;
    let (vb, metadata) = parse_pack_json(&json)?;
    let mut ir = trace_core::Ir::new(vb);
    for (k, v) in metadata {
        ir.set_metadata(k, v);
    }
    let bytes = trace_core::write(&ir).map_err(|e| format!("serialize: {e}"))?;
    let out_path = output.unwrap_or_else(|| {
        let mut p = input.clone();
        p.set_extension("trace");
        p
    });
    fs::write(&out_path, &bytes).map_err(|e| format!("writing {out_path:?}: {e}"))?;
    eprintln!("wrote {} ({} bytes)", out_path.display(), bytes.len());
    Ok(())
}

/// Tiny JSON extractor for viewBox + flat string metadata. Avoids pulling in
/// serde for the CLI; the JSON shape produced by `dump` is fixed and small.
fn parse_pack_json(json: &str) -> Result<(trace_core::ViewBox, Vec<(String, String)>), String> {
    let viewbox = json.find("\"viewBox\"").ok_or("missing viewBox")?;
    let open = json[viewbox..].find('[').ok_or("malformed viewBox")? + viewbox;
    let close = json[open..].find(']').ok_or("malformed viewBox")? + open;
    let nums: Vec<f32> = json[open + 1..close]
        .split(',')
        .map(|s| s.trim().parse::<f32>())
        .collect::<Result<_, _>>()
        .map_err(|e| format!("viewBox parse: {e}"))?;
    if nums.len() != 4 {
        return Err("viewBox needs 4 numbers".into());
    }
    let vb = trace_core::ViewBox::new(nums[0], nums[1], nums[2], nums[3]);

    let mut metadata = Vec::new();
    if let Some(md_start) = json.find("\"metadata\"") {
        let md_open = json[md_start..]
            .find('{')
            .map(|i| i + md_start)
            .ok_or("malformed metadata")?;
        let md_close = json[md_open..]
            .find('}')
            .map(|i| i + md_open)
            .ok_or("malformed metadata")?;
        let body = &json[md_open + 1..md_close];
        let mut chars = body.chars().peekable();
        while chars.peek().is_some() {
            // Skip whitespace and commas.
            while matches!(chars.peek(), Some(c) if c.is_whitespace() || *c == ',') {
                chars.next();
            }
            if chars.peek().is_none() {
                break;
            }
            let key = read_json_string(&mut chars).ok_or("malformed metadata key")?;
            while matches!(chars.peek(), Some(c) if c.is_whitespace() || *c == ':') {
                chars.next();
            }
            let value = read_json_string(&mut chars).ok_or("malformed metadata value")?;
            metadata.push((key, value));
        }
    }
    Ok((vb, metadata))
}

fn read_json_string<I: Iterator<Item = char>>(
    chars: &mut std::iter::Peekable<I>,
) -> Option<String> {
    if chars.next()? != '"' {
        return None;
    }
    let mut out = String::new();
    while let Some(c) = chars.next() {
        match c {
            '"' => return Some(out),
            '\\' => match chars.next()? {
                '"' => out.push('"'),
                '\\' => out.push('\\'),
                'n' => out.push('\n'),
                'r' => out.push('\r'),
                't' => out.push('\t'),
                other => out.push(other),
            },
            c => out.push(c),
        }
    }
    None
}

// ---------------------------------------------------------------------------
// diff

fn diff(args: &[String]) -> Result<(), String> {
    if args.len() < 2 {
        return Err("missing <a.trace> <b.trace>".into());
    }
    let a_bytes = fs::read(&args[0]).map_err(|e| format!("reading {}: {e}", args[0]))?;
    let b_bytes = fs::read(&args[1]).map_err(|e| format!("reading {}: {e}", args[1]))?;
    if a_bytes == b_bytes {
        println!("identical");
        return Ok(());
    }
    let a = TraceFile::parse(&a_bytes).map_err(|e| format!("parse {}: {e}", args[0]))?;
    let b = TraceFile::parse(&b_bytes).map_err(|e| format!("parse {}: {e}", args[1]))?;
    let mut any = false;
    if a.viewbox() != b.viewbox() {
        println!("viewBox differs");
        any = true;
    }
    let ac = a.element_count().map_err(|e| e.to_string())?;
    let bc = b.element_count().map_err(|e| e.to_string())?;
    if ac != bc {
        println!("element count: {} → {}", ac, bc);
        any = true;
    }
    let aids = a.ids().map_err(|e| e.to_string())?;
    let bids = b.ids().map_err(|e| e.to_string())?;
    for id in &aids {
        if !bids.contains(id) {
            println!("- {id}");
            any = true;
        }
    }
    for id in &bids {
        if !aids.contains(id) {
            println!("+ {id}");
            any = true;
        }
    }
    if !any {
        println!("byte-different but structurally equivalent");
    }
    Ok(())
}
