package co.trace.rn

import android.graphics.Color
import android.util.Base64
import co.trace.HitMode
import co.trace.TraceView
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.annotations.ReactProp

/** Fabric view manager. */
class RNTraceViewManager : SimpleViewManager<TraceView>() {
    override fun getName() = "TraceView"

    override fun createViewInstance(reactContext: ThemedReactContext): TraceView {
        val v = TraceView(reactContext)
        v.listener = object : TraceView.Listener {
            override fun onElementTap(id: String, x: Float, y: Float) {
                val event = com.facebook.react.bridge.Arguments.createMap().apply {
                    putString("id", id); putDouble("x", x.toDouble()); putDouble("y", y.toDouble())
                }
                reactContext.getJSModule(
                    com.facebook.react.uimanager.events.RCTEventEmitter::class.java
                ).receiveEvent(v.id, "topElementPress", event)
            }
            override fun onAnimationFinished(id: String?) {
                val event = com.facebook.react.bridge.Arguments.createMap().apply {
                    putString("id", id)
                }
                reactContext.getJSModule(
                    com.facebook.react.uimanager.events.RCTEventEmitter::class.java
                ).receiveEvent(v.id, "topAnimationFinished", event)
            }
        }
        return v
    }

    @ReactProp(name = "sourceBytesB64")
    fun setSourceBytesB64(view: TraceView, b64: String?) {
        if (b64.isNullOrEmpty()) return
        val bytes = Base64.decode(b64, Base64.NO_WRAP)
        view.source = TraceView.Source.Bytes(bytes)
    }

    @ReactProp(name = "highlightedIdsCsv")
    fun setHighlightedIdsCsv(view: TraceView, csv: String?) {
        view.highlightedIds = csv?.split(',')?.filter { it.isNotEmpty() }?.toSet() ?: emptySet()
    }

    @ReactProp(name = "highlightColor")
    fun setHighlightColor(view: TraceView, color: String?) {
        if (color != null) try { view.highlightColor = Color.parseColor(color) } catch (_: Exception) {}
    }

    @ReactProp(name = "highlightStrokeBoost")
    fun setHighlightStrokeBoost(view: TraceView, boost: Float) {
        view.highlightStrokeBoost = boost
    }
}
