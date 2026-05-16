package co.trace

import android.graphics.RectF
import io.github.shopify.skia.SkCanvas
import io.github.shopify.skia.SkPaint
import io.github.shopify.skia.SkPath
import io.github.shopify.skia.SkPicture
import io.github.shopify.skia.SkPictureRecorder

/**
 * Owns the per-element draw state. Enforces the three identity invariants from
 * SPEC's Implementation notes:
 *
 *   1. Hit-testing uses TraceFile.hitTest (Rust) — never Skia.
 *   2. Each interactive element gets its own canvas.drawPath() call. Only
 *      `flags.isDecorative == true` elements may be batched into the cached
 *      SkPicture below.
 *   3. The `handles` map below IS the identity-to-handle map. It lives in
 *      Kotlin, not inside Skia's internals. Highlights, animations, and per-
 *      element re-style operations touch only the relevant handle.
 */
internal class TraceRenderer(private val view: TraceView) {

    internal data class ElementHandle(
        val id: String?,
        val path: SkPath,
        var fillPaint: SkPaint?,
        var strokePaint: SkPaint?,
        val bbox: RectF,
        val isDecorative: Boolean,
        var strokeProgress: Float = 1f,  // 0..1 — drives stroke-draw anim
        var fillOpacity: Float = 1f,     // 0..1 — drives fill-fade anim
    )

    private val handles: MutableMap<Int, ElementHandle> = LinkedHashMap()
    private var decorativePicture: SkPicture? = null

    @Throws(Exception::class)
    fun load(file: TraceFile) {
        handles.clear()
        decorativePicture = null

        val elements = file.inner.elements()
        var recorder: SkPictureRecorder? = null
        elements.forEachIndexed { idx, el ->
            val path = PathConvert.buildPath(
                el.verbs.toByteArray(),
                el.pointsX.toFloatArray(),
                el.pointsY.toFloatArray()
            )

            val fillPaint = if (el.fillRgba != 0u) SkPaint().apply {
                isAntiAlias = true
                color = el.fillRgba.toInt()
                style = SkPaint.Style.FILL
            } else null

            val strokePaint = if (el.strokeRgba != 0u && el.strokeWidth > 0f) SkPaint().apply {
                isAntiAlias = true
                color = el.strokeRgba.toInt()
                style = SkPaint.Style.STROKE
                strokeWidth = el.strokeWidth
            } else null

            val handle = ElementHandle(
                id = el.id,
                path = path,
                fillPaint = fillPaint,
                strokePaint = strokePaint,
                bbox = RectF(el.bboxMinX, el.bboxMinY, el.bboxMaxX, el.bboxMaxY),
                isDecorative = el.flagsIsDecorative,
            )
            handles[idx] = handle

            if (el.flagsIsDecorative) {
                if (recorder == null) {
                    recorder = SkPictureRecorder().also {
                        it.beginRecording(view.viewBoxBounds)
                    }
                }
                val c = recorder!!.recordingCanvas
                fillPaint?.let { c.drawPath(path, it) }
                strokePaint?.let { c.drawPath(path, it) }
            }
        }
        decorativePicture = recorder?.endRecording()
    }

    fun draw(canvas: SkCanvas, highlighted: Set<String>, highlightColor: Int, boost: Float) {
        decorativePicture?.let { canvas.drawPicture(it) }
        for ((_, h) in handles) {
            if (h.isDecorative) continue
            h.fillPaint?.let { paint ->
                paint.alpha = (paint.alpha * h.fillOpacity).toInt().coerceIn(0, 255)
                canvas.drawPath(h.path, paint)
            }
            h.strokePaint?.let { sp ->
                if (h.strokeProgress < 1f) {
                    sp.pathEffect = SkPath.trimEffect(0f, h.strokeProgress)
                }
                canvas.drawPath(h.path, sp)
            }
            if (h.id != null && highlighted.contains(h.id)) {
                val hp = SkPaint().apply {
                    isAntiAlias = true
                    color = highlightColor
                    style = SkPaint.Style.STROKE
                    strokeWidth = ((h.strokePaint?.strokeWidth ?: 1f) * boost).coerceAtLeast(2f)
                }
                canvas.drawPath(h.path, hp)
            }
        }
    }

    fun setStrokeProgress(p: Float, elementIndex: Int) {
        handles[elementIndex]?.let {
            it.strokeProgress = p.coerceIn(0f, 1f)
            view.requestRedraw()
        }
    }

    fun setFillOpacity(a: Float, elementIndex: Int) {
        handles[elementIndex]?.let {
            it.fillOpacity = a.coerceIn(0f, 1f)
            view.requestRedraw()
        }
    }
}
