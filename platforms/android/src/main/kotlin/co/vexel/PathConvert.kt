package co.vexel

import io.github.shopify.skia.SkPath  // type from react-native-skia / vendored Skia

/**
 * verb-stream → Skia SkPath. The verb encoding matches SPEC §3.4:
 *   1 = Move, 2 = Line, 3 = Quad, 4 = Cubic, 5 = Close.
 *
 * Built once per element when the file is loaded; the SkPath instance is then
 * stored in TraceRenderer's identity-to-handle map for the lifetime of the view.
 *
 * Crucially, this uses Skia's SkPath — NOT android.graphics.Path — so the
 * rendered output is pixel-identical to iOS (which is the architectural reason
 * for choosing Skia per SPEC §6.3).
 */
object PathConvert {
    fun buildPath(verbs: ByteArray, pointsX: FloatArray, pointsY: FloatArray): SkPath {
        val path = SkPath()
        var pi = 0
        for (v in verbs) {
            when (v.toInt()) {
                1 -> { path.moveTo(pointsX[pi], pointsY[pi]); pi++ }
                2 -> { path.lineTo(pointsX[pi], pointsY[pi]); pi++ }
                3 -> {
                    path.quadTo(pointsX[pi], pointsY[pi], pointsX[pi + 1], pointsY[pi + 1])
                    pi += 2
                }
                4 -> {
                    path.cubicTo(
                        pointsX[pi], pointsY[pi],
                        pointsX[pi + 1], pointsY[pi + 1],
                        pointsX[pi + 2], pointsY[pi + 2]
                    )
                    pi += 3
                }
                5 -> path.close()
                else -> { /* unknown verb from forward-compat file — skip */ }
            }
        }
        return path
    }
}
