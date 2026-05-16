package co.trace

// Umbrella module re-exports the public surface.
//
// Identity invariants (SPEC Implementation notes):
//   1. Hit-testing routes to the Rust core (TraceFile.hitTest), never to Skia.
//   2. Each addressable element gets its own canvas.drawPath call. SkPicture
//      caching is reserved for elements with `flags.isDecorative == true`.
//   3. The identity-to-handle map lives in TraceRenderer (Kotlin), not in
//      Skia's internals.

object Trace {
    const val FORMAT_MAJOR: Int = 1
    const val FORMAT_MINOR: Int = 0
}
