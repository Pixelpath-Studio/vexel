package co.vexel.rn

import android.graphics.RectF
import android.util.Base64
import co.vexel.Easing
import co.vexel.FragmentAnim
import co.vexel.StartAfter
import co.vexel.VexelFile
import co.vexel.VexelSession
import co.vexel.generated.convertSvgToTrace
import co.vexel.generated.ConvertOptions
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.module.annotations.ReactModule
import org.json.JSONObject

/** TurboModule. Bridges JS calls to the Rust core via the vexel-android AAR. */
@ReactModule(name = RNTraceModule.NAME)
class RNTraceModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {

    override fun getName() = NAME

    private val sessions = mutableMapOf<Int, VexelSession>()
    private var nextHandle = 1

    @ReactMethod(isBlockingSynchronousMethod = true)
    fun convert(svg: String, generator: String?): String {
        return try {
            val bytes = convertSvgToTrace(
                svg,
                ConvertOptions(generator = generator, normalizeMermaidIds = true, resourcesDir = null)
            )
            Base64.encodeToString(bytes.toByteArray(), Base64.NO_WRAP)
        } catch (e: Exception) { "" }
    }

    @ReactMethod(isBlockingSynchronousMethod = true)
    fun inspect(b64: String): String {
        return try {
            val bytes = Base64.decode(b64, Base64.NO_WRAP)
            val file = VexelFile(bytes)
            val vb = file.viewBox
            val meta = JSONObject().apply {
                for (k in listOf("generator", "title", "unsupported", "rendered-size")) {
                    file.metadata(k)?.let { put(k, it) }
                }
            }
            JSONObject().apply {
                put("viewBox", listOf(vb.left, vb.top, vb.width(), vb.height()))
                put("ids", file.ids)
                put("metadata", meta)
            }.toString()
        } catch (e: Exception) {
            """{"error":"parse"}"""
        }
    }

    @ReactMethod(isBlockingSynchronousMethod = true)
    fun createSession(x: Double, y: Double, w: Double, h: Double): Int {
        val s = VexelSession(RectF(x.toFloat(), y.toFloat(), (x + w).toFloat(), (y + h).toFloat()))
        val h = nextHandle++
        synchronized(sessions) { sessions[h] = s }
        return h
    }

    @ReactMethod(isBlockingSynchronousMethod = true)
    fun sessionAppend(
        handle: Int, svgFragment: String,
        strokeDrawMs: Int, fillFadeMs: Int,
        startAfterCode: Int, startAfterAtMs: Int, easingCode: Int,
    ): String {
        val s = synchronized(sessions) { sessions[handle] } ?: return """{"ids":[]}"""
        val anim = FragmentAnim(
            strokeDrawMs = strokeDrawMs.takeIf { it > 0 }?.toUInt(),
            fillFadeMs = fillFadeMs.takeIf { it > 0 }?.toUInt(),
            startAfter = when (startAfterCode) {
                0 -> StartAfter.Immediately
                2 -> StartAfter.AtMs(startAfterAtMs.toUInt())
                else -> StartAfter.PreviousFragment
            },
            easing = when (easingCode) {
                0 -> Easing.Linear
                1 -> Easing.EaseOut
                2 -> Easing.EaseInOut
                else -> Easing.HandNatural
            },
        )
        val ids = try { s.append(svgFragment, anim) } catch (e: Exception) { emptyList() }
        return JSONObject().put("ids", ids).toString()
    }

    @ReactMethod(isBlockingSynchronousMethod = true)
    fun sessionRemove(handle: Int, id: String): Boolean =
        synchronized(sessions) { sessions[handle] }?.remove(id) ?: false

    @ReactMethod(isBlockingSynchronousMethod = true)
    fun sessionSnapshot(handle: Int): String {
        val s = synchronized(sessions) { sessions[handle] } ?: return ""
        return try { Base64.encodeToString(s.snapshot(), Base64.NO_WRAP) } catch (e: Exception) { "" }
    }

    @ReactMethod(isBlockingSynchronousMethod = true)
    fun sessionVersion(handle: Int): Double =
        synchronized(sessions) { sessions[handle] }?.version?.toDouble() ?: 0.0

    @ReactMethod
    fun sessionRelease(handle: Int) {
        synchronized(sessions) { sessions.remove(handle) }
    }

    companion object { const val NAME = "RNTrace" }
}
