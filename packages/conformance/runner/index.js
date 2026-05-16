#!/usr/bin/env node
// @trace/conformance runner.
//
// Walks every fixture under fixtures/, regenerates output.trace from input.svg
// using the trace-cli binary (workspace-built), and compares against the
// checked-in canonical bytes. Also runs each fixture's queries.json against
// the parsed file.
//
// Exit code is non-zero on any failure. Designed to be runnable both locally
// (`npm test -w packages/conformance`) and from CI.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const FIXTURES = path.resolve(__dirname, '..', 'fixtures');
const CLI = process.env.TRACE_CLI || findCli();

function findCli() {
  const candidates = [
    path.join(ROOT, 'target', 'release', 'trace-cli'),
    path.join(ROOT, 'target', 'debug', 'trace-cli'),
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  // Fallback: build it.
  const r = spawnSync('cargo', ['build', '-p', 'trace-cli'], { cwd: ROOT, stdio: 'inherit' });
  if (r.status !== 0) throw new Error('trace-cli not found and `cargo build -p trace-cli` failed');
  return path.join(ROOT, 'target', 'debug', 'trace-cli');
}

function run(...args) {
  const r = spawnSync(CLI, args, { encoding: 'utf-8' });
  if (r.status !== 0) {
    throw new Error(`trace-cli ${args.join(' ')}: ${r.stderr}`);
  }
  return r.stdout;
}

function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf-8')); }

function inspectViaCli(traceFile) {
  // We don't have a JSON "inspect" mode in CLI yet; use `dump` which emits a
  // compact JSON description. The dump command in the CLI prints viewBox, ids,
  // element_count, and metadata.
  return JSON.parse(run('dump', traceFile));
}

// Pretty fixture-level reporter.
let pass = 0, fail = 0;
function report(name, ok, detail = '') {
  const tag = ok ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m';
  console.log(`  ${tag}  ${name}${detail ? '  — ' + detail : ''}`);
  ok ? pass++ : fail++;
}

const fixtures = fs.readdirSync(FIXTURES)
  .map((d) => path.join(FIXTURES, d))
  .filter((d) => fs.statSync(d).isDirectory())
  .sort();

console.log(`@trace/conformance — ${fixtures.length} fixtures\n`);

for (const dir of fixtures) {
  const name = path.basename(dir);
  console.log(`▶ ${name}`);

  const goldenPath = path.join(dir, 'output.trace');
  const queriesPath = path.join(dir, 'queries.json');
  const svgPath = path.join(dir, 'input.svg');

  // 1. Byte stability: re-convert and cmp. Use the same generator string as
  // gen_fixtures.rs so the STRS section comes out byte-identical.
  if (fs.existsSync(svgPath)) {
    try {
      const tmp = path.join(dir, '.actual.trace');
      run('convert', svgPath, '--out', tmp, '--generator', 'trace-conformance');
      const actual = fs.readFileSync(tmp);
      const golden = fs.readFileSync(goldenPath);
      const equal = actual.length === golden.length && actual.equals(golden);
      report('byte-stable conversion', equal,
        equal ? '' : `actual ${actual.length}B vs golden ${golden.length}B`);
      fs.unlinkSync(tmp);
    } catch (e) {
      report('byte-stable conversion', false, e.message);
    }
  } else {
    report('byte-stable conversion', true, 'no input.svg (JSON-only fixture)');
  }

  // 2. Query correctness via CLI inspect/dump.
  if (fs.existsSync(queriesPath)) {
    const queries = readJson(queriesPath);
    try {
      const inspected = inspectViaCli(goldenPath);
      // viewBox.
      if (queries.viewBox) {
        const v = inspected.viewBox;
        const ok = v[0] === queries.viewBox[0] && v[1] === queries.viewBox[1]
          && v[2] === queries.viewBox[2] && v[3] === queries.viewBox[3];
        report('viewBox', ok, ok ? '' : `got [${v}]`);
      }
      // element_count.
      if (queries.element_count != null) {
        const ok = inspected.element_count === queries.element_count;
        report('element_count', ok,
          ok ? '' : `got ${inspected.element_count}, expected ${queries.element_count}`);
      }
      // ids_include.
      if (queries.ids_include) {
        const got = new Set(inspected.ids);
        const missing = queries.ids_include.filter((id) => !got.has(id));
        report('ids_include', missing.length === 0,
          missing.length ? `missing: ${missing.join(', ')}` : '');
      }
      // hit_tests aren't routed through the CLI yet — the v1 CLI doesn't
      // expose hit-test on stdin. We mark these as informational.
      if (queries.hit_tests) {
        console.log(`  \x1b[33mINFO\x1b[0m  ${queries.hit_tests.length} hit_tests skipped (CLI hit-test subcommand TODO)`);
      }
    } catch (e) {
      report('queries', false, e.message);
    }
  }
  console.log('');
}

console.log(`\nTotal: ${pass} passed, ${fail} failed.`);
process.exit(fail > 0 ? 1 : 0);
