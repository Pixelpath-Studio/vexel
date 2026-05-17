package co.vexel

import android.graphics.RectF
import co.vexel.generated.HitMode as CoreHitMode
import co.vexel.generated.VexelFile as CoreVexelFile

/** Read-only view over a parsed `.vex` buffer. Wraps the Rust core via UniFFI. */
class VexelFile @Throws(Exception::class) constructor(bytes: ByteArray) {
    internal val inner: CoreVexelFile = CoreVexelFile(bytes.toList())

    val viewBox: RectF
        get() {
            val vb = inner.viewbox()
            return RectF(vb.x, vb.y, vb.x + vb.w, vb.y + vb.h)
        }

    val elementCount: Int get() = inner.elementCount().toInt()
    val ids: List<String> get() = inner.ids()

    fun metadata(key: String): String? = inner.metadata(key)

    fun hitTest(x: Float, y: Float, mode: HitMode = HitMode.VISIBLE_PAINTED): String? =
        inner.hitTest(x, y, mode.toCore())
}

enum class HitMode {
    VISIBLE_PAINTED, VISIBLE_STROKE, VISIBLE_FILL, ALL, BOUNDING_BOX;

    internal fun toCore(): CoreHitMode = when (this) {
        VISIBLE_PAINTED -> CoreHitMode.VISIBLE_PAINTED
        VISIBLE_STROKE  -> CoreHitMode.VISIBLE_STROKE
        VISIBLE_FILL    -> CoreHitMode.VISIBLE_FILL
        ALL             -> CoreHitMode.ALL
        BOUNDING_BOX    -> CoreHitMode.BOUNDING_BOX
    }
}
