#!/usr/bin/env node
// @pixelpath/vexel-cli — npm wrapper that dispatches to the native vexel-cli binary.
//
// At publish time, this package downloads the matching vexel-cli binary for the
// host platform (Mac/Linux/Windows × x64/arm64) from the GitHub release matching
// the package version, verifies a SHA-256 hash pinned in this file, and stores
// it under node_modules/@pixelpath/vexel-cli/bin/native/. Modeled after esbuild's
// optionalDependencies-per-platform pattern.
//
// For local development (e.g. running from a workspace checkout where the
// release hasn't been built yet), the wrapper falls back to building the binary
// from source via `cargo run -p vexel-cli`.

const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

function resolveNativeBinary() {
  const exe = process.platform === 'win32' ? 'vexel-cli.exe' : 'vexel-cli';
  const platform = `${process.platform}-${process.arch}`;
  const candidates = [
    path.join(__dirname, 'native', platform, exe),
    path.join(__dirname, 'native', exe),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return { mode: 'native', cmd: c, args: [] };
  }
  // Workspace fallback: walk up looking for a Cargo.toml + target/debug binary.
  let dir = __dirname;
  for (let i = 0; i < 6; i++) {
    dir = path.dirname(dir);
    const debugBin = path.join(dir, 'target', 'debug', exe);
    const releaseBin = path.join(dir, 'target', 'release', exe);
    if (fs.existsSync(releaseBin)) return { mode: 'workspace', cmd: releaseBin, args: [] };
    if (fs.existsSync(debugBin)) return { mode: 'workspace', cmd: debugBin, args: [] };
    if (fs.existsSync(path.join(dir, 'Cargo.toml'))) {
      return {
        mode: 'cargo',
        cmd: 'cargo',
        args: ['run', '--quiet', '-p', 'vexel-cli', '--release', '--'],
        cwd: dir,
      };
    }
  }
  console.error(
    '@pixelpath/vexel-cli: no native binary found and no Cargo workspace nearby. ' +
    'Reinstall the package or build from source with `cargo install vexel-cli`.'
  );
  process.exit(127);
}

const tool = resolveNativeBinary();
const result = spawnSync(tool.cmd, [...tool.args, ...process.argv.slice(2)], {
  stdio: 'inherit',
  cwd: tool.cwd,
});
if (result.error) {
  console.error('@pixelpath/vexel-cli:', result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 0);
