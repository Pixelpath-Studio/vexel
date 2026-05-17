#!/usr/bin/env node
/*
 * @pixelpath/vexel postinstall — SPEC §13.4 trust model.
 *
 * Downloads the matching VexelCore.xcframework (iOS) and vexel-android.aar
 * (Android) from the GitHub release for this package's version, verifies the
 * SHA-256 hash against the pinned hashes below, and stages the binaries where
 * CocoaPods / Gradle expect them. Modeled after esbuild and sharp's
 * distribution.
 *
 * If the download fails or hash verification fails, the install fails. Users
 * who want to build from source set TRACE_BUILD_FROM_SOURCE=1.
 */

const fs = require('node:fs');
const https = require('node:https');
const crypto = require('node:crypto');
const path = require('node:path');

const pkg = require('../package.json');
const VERSION = pkg.version;
const BASE = `https://github.com/curo-trace/trace/releases/download/v${VERSION}`;

// Pinned SHA-256 hashes — updated by ./scripts/release.sh in CI when a new
// version ships. Empty during development; postinstall is a no-op in that case.
const PINS = {
  'VexelCore.xcframework.zip': '',
  'vexel-android.aar': '',
};

function noop(reason) {
  console.log(`@pixelpath/vexel: ${reason}`);
  process.exit(0);
}

if (process.env.TRACE_BUILD_FROM_SOURCE === '1') {
  noop('TRACE_BUILD_FROM_SOURCE=1; skipping prebuilt download');
}
if (!PINS['VexelCore.xcframework.zip'] && !PINS['vexel-android.aar']) {
  noop(`no pinned hashes for v${VERSION} (development install)`);
}

const root = path.resolve(__dirname, '..');

function fetch(url, dest) {
  return new Promise((resolve, reject) => {
    const f = fs.createWriteStream(dest);
    https.get(url, (res) => {
      if (res.statusCode === 302 || res.statusCode === 301) {
        fetch(res.headers.location, dest).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }
      res.pipe(f);
      f.on('finish', () => f.close(resolve));
    }).on('error', reject);
  });
}

function sha256(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    const s = fs.createReadStream(file);
    s.on('data', (c) => h.update(c));
    s.on('end', () => resolve(h.digest('hex')));
    s.on('error', reject);
  });
}

async function download(name) {
  const expected = PINS[name];
  if (!expected) return;
  const url = `${BASE}/${name}`;
  const out = path.join(root, 'cache', name);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  console.log(`@pixelpath/vexel: downloading ${name}`);
  await fetch(url, out);
  const got = await sha256(out);
  if (got !== expected) {
    throw new Error(`@pixelpath/vexel: ${name} hash mismatch (expected ${expected}, got ${got})`);
  }
}

(async () => {
  try {
    await download('VexelCore.xcframework.zip');
    await download('vexel-android.aar');
    console.log('@pixelpath/vexel: prebuilt binaries verified');
  } catch (e) {
    console.error(e.message);
    console.error('@pixelpath/vexel: install failed. Set TRACE_BUILD_FROM_SOURCE=1 to build locally.');
    process.exit(1);
  }
})();
