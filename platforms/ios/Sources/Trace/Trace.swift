// Trace.swift — umbrella module. Re-exports the public surface.
//
// The framework's public API is intentionally narrow per SPEC §5:
//   - TraceFile / TraceSession: read and stream `.trace` data
//   - TraceView: UIView that renders a Trace source via Skia
//   - TraceViewDelegate: callbacks for taps and animation completion
//   - HitMode: hit-test query mode
//
// Identity invariants (from SPEC's Implementation notes) hold across this
// framework:
//   1. Hit-testing routes to the Rust core's `hit_test`, never to Skia.
//   2. TraceRenderer draws each element with its own `canvas.drawPath`
//      (except `flags.is_decorative == true` elements, which may be batched
//      into a cached SkPicture).
//   3. The identity-to-handle map is owned in TraceRenderer (Swift), not by
//      Skia internals.

import Foundation

public enum Trace {
    public static let formatVersion: (major: UInt16, minor: UInt16) = (1, 0)
}
