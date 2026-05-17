package co.vexel

import android.graphics.RectF
import co.vexel.generated.Easing as CoreEasing
import co.vexel.generated.FragmentAnim as CoreFragmentAnim
import co.vexel.generated.Session as CoreSession
import co.vexel.generated.StartAfter as CoreStartAfter
import co.vexel.generated.ViewBox as CoreViewBox

/** Streaming session for AI-drawn content. See SPEC §4.5. */
class VexelSession(viewBox: RectF) {
    internal val inner: CoreSession = CoreSession(
        CoreViewBox(viewBox.left, viewBox.top, viewBox.width(), viewBox.height())
    )

    @Throws(Exception::class)
    fun append(svgFragment: String, anim: FragmentAnim? = null): List<String> =
        inner.appendSvgFragment(svgFragment, anim?.toCore())

    fun remove(id: String): Boolean = inner.removeElement(id)

    val version: ULong get() = inner.version()

    @Throws(Exception::class)
    fun snapshot(): ByteArray = inner.snapshot().toByteArray()
}

data class FragmentAnim(
    val strokeDrawMs: UInt? = null,
    val fillFadeMs: UInt? = null,
    val startAfter: StartAfter = StartAfter.PreviousFragment,
    val easing: Easing = Easing.HandNatural,
) {
    internal fun toCore() = CoreFragmentAnim(
        strokeDrawMs = strokeDrawMs,
        fillFadeMs = fillFadeMs,
        startAfter = startAfter.toCore(),
        easing = easing.toCore(),
    )
}

sealed class StartAfter {
    object Immediately : StartAfter()
    object PreviousFragment : StartAfter()
    data class AtMs(val t: UInt) : StartAfter()

    internal fun toCore(): CoreStartAfter = when (this) {
        Immediately       -> CoreStartAfter.Immediately
        PreviousFragment  -> CoreStartAfter.PreviousFragment
        is AtMs           -> CoreStartAfter.AtMs(this.t)
    }
}

enum class Easing {
    Linear, EaseOut, EaseInOut, HandNatural;

    internal fun toCore(): CoreEasing = when (this) {
        Linear      -> CoreEasing.LINEAR
        EaseOut     -> CoreEasing.EASE_OUT
        EaseInOut   -> CoreEasing.EASE_IN_OUT
        HandNatural -> CoreEasing.HAND_NATURAL
    }
}
