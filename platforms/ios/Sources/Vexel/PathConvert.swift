// PathConvert.swift — verb-stream → Skia SkPath.
//
// The verb encoding matches SPEC §3.4: 1=Move, 2=Line, 3=Quad, 4=Cubic, 5=Close.
// We materialize an SkPath once per element when the file is loaded, then keep
// it in TraceRenderer's identity-to-handle map for the lifetime of the view.
//
// This file imports Skia symbols from the host app's Skia framework (via the
// react-native-skia distribution). If you're integrating Vexel standalone,
// link Skia.xcframework into your target.

import Foundation
import SkiaKit  // provided by react-native-skia / vendored Skia

public enum PathConvert {
    public static func buildPath(verbs: [UInt8], points: [SIMD2<Float>]) -> SkPath {
        var path = SkPath()
        var pi = 0
        for v in verbs {
            switch v {
            case 1: // Move
                let p = points[pi]; pi += 1
                path.moveTo(p.x, p.y)
            case 2: // Line
                let p = points[pi]; pi += 1
                path.lineTo(p.x, p.y)
            case 3: // Quad
                let c = points[pi]; pi += 1
                let p = points[pi]; pi += 1
                path.quadTo(c.x, c.y, p.x, p.y)
            case 4: // Cubic
                let c1 = points[pi]; pi += 1
                let c2 = points[pi]; pi += 1
                let p  = points[pi]; pi += 1
                path.cubicTo(c1.x, c1.y, c2.x, c2.y, p.x, p.y)
            case 5: // Close
                path.close()
            default:
                // Unknown verbs from a forward-compat file are skipped silently
                // — the file is still drawable, just not fully expressive.
                break
            }
        }
        return path
    }
}
