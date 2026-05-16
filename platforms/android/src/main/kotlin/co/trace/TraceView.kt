package co.trace

import android.content.Context
import android.graphics.Canvas
import android.graphics.RectF
import android.net.Uri
import android.util.AttributeSet
import android.view.Choreographer
import android.view.MotionEvent
import android.view.View
import io.github.shopify.skia.SkCanvas

/** Android counterpart of TraceView (SPEC §6.2). */
class TraceView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
    defStyle: Int = 0,
) : View(context, attrs, defStyle) {

    sealed class Source {
        data class File(val uri: Uri) : Source()
        data class Bytes(val data: ByteArray) : Source()
        data class Streaming(val session: TraceSession) : Source()
    }

    var source: Source? = null
        set(value) { field = value; reload() }

    var listener: Listener? = null

    var highlightedIds: Set<String> = emptySet()
        set(value) { field = value; invalidate() }

    var highlightColor: Int = 0xFFFF5722.toInt()
    var highlightStrokeBoost: Float = 1.5f

    private val renderer = TraceRenderer(this)
    private var animator: Animator? = null
    private var traceFile: TraceFile? = null
    private var traceSession: TraceSession? = null

    init {
        // GPU-accelerated layer — see SPEC §6.5.
        setLayerType(LAYER_TYPE_HARDWARE, null)
    }

    internal val viewBoxBounds: RectF
        get() = traceFile?.viewBox ?: RectF(0f, 0f, width.toFloat(), height.toFloat())

    private fun reload() {
        val src = source
        if (src == null) {
            traceFile = null; traceSession = null
            invalidate(); return
        }
        try {
            when (src) {
                is Source.File -> {
                    val bytes = context.contentResolver.openInputStream(src.uri)
                        ?.use { it.readBytes() } ?: return
                    val f = TraceFile(bytes)
                    renderer.load(f)
                    traceFile = f; traceSession = null
                }
                is Source.Bytes -> {
                    val f = TraceFile(src.data)
                    renderer.load(f)
                    traceFile = f; traceSession = null
                }
                is Source.Streaming -> {
                    traceSession = src.session
                    val f = TraceFile(src.session.snapshot())
                    renderer.load(f)
                    traceFile = f
                }
            }
            startOrResetAnimator()
            invalidate()
        } catch (e: Exception) {
            android.util.Log.e("Trace", "load failed", e)
        }
    }

    override fun onDraw(canvas: Canvas) {
        // The host app's react-native-skia provides a SkCanvas bridge over
        // android.graphics.Canvas. For standalone Android apps we obtain a
        // SkCanvas from a vendored Skia surface attached to this View. In both
        // cases the drawing path is the same: per-element drawPath using the
        // identity-to-handle map.
        val skCanvas = SkCanvas.fromAndroidCanvas(canvas)
        val file = traceFile ?: return
        val vb = file.viewBox
        val sx = width / vb.width()
        val sy = height / vb.height()
        val s = minOf(sx, sy)
        val dx = (width - vb.width() * s) * 0.5f - vb.left * s
        val dy = (height - vb.height() * s) * 0.5f - vb.top * s
        skCanvas.save()
        skCanvas.translate(dx, dy)
        skCanvas.scale(s, s)
        renderer.draw(skCanvas, highlightedIds, highlightColor, highlightStrokeBoost)
        skCanvas.restore()
    }

    internal fun requestRedraw() {
        post { invalidate() }
    }

    override fun onTouchEvent(event: MotionEvent): Boolean {
        if (event.action != MotionEvent.ACTION_UP) return super.onTouchEvent(event)
        val file = traceFile ?: return super.onTouchEvent(event)
        val vb = file.viewBox
        val sx = width / vb.width()
        val sy = height / vb.height()
        val s = minOf(sx, sy)
        val dx = (width - vb.width() * s) * 0.5f - vb.left * s
        val dy = (height - vb.height() * s) * 0.5f - vb.top * s
        val vbX = (event.x - dx) / s
        val vbY = (event.y - dy) / s
        // Hit-test routes to Rust. Skia is never consulted for identity.
        val id = file.hitTest(vbX, vbY, HitMode.VISIBLE_PAINTED)
        if (id != null) {
            listener?.onElementTap(id, event.x, event.y)
            return true
        }
        return super.onTouchEvent(event)
    }

    private fun startOrResetAnimator() {
        animator?.stop()
        animator = Animator(renderer, traceFile!!, traceSession) { id ->
            listener?.onAnimationFinished(id)
        }
        animator?.start()
    }

    interface Listener {
        fun onElementTap(id: String, x: Float, y: Float)
        fun onAnimationFinished(id: String?)
    }
}
