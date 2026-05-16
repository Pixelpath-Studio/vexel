package co.trace

import android.view.Choreographer

/**
 * Choreographer-driven animation loop (SPEC §6.3). Reads ANIM tracks from the
 * TraceFile and on each frame updates the renderer's per-element
 * strokeProgress / fillOpacity.
 *
 * Easing curves are evaluated against wall-clock millisecond deltas; the
 * hand-natural curve uses the v1 starting samples from SPEC §9.2.
 */
internal class Animator(
    private val renderer: TraceRenderer,
    file: TraceFile,
    private val session: TraceSession?,
    private val onFinish: (String?) -> Unit,
) : Choreographer.FrameCallback {

    private data class Track(
        val elementIndex: Int,
        val id: String?,
        val type: TrackType,
        val startMs: Long,
        val durationMs: Long,
        val easing: Easing,
        var finished: Boolean = false,
    )

    private enum class TrackType { STROKE_DRAW, FILL_FADE, APPEAR, OPACITY_TO, TRANSFORM_TO, REMOVE }
    private enum class Easing { LINEAR, EASE_OUT, EASE_IN_OUT, HAND_NATURAL }

    private var startNanos: Long = 0
    private var lastSnapshotVersion: ULong = 0u
    private var tracks: MutableList<Track> = file.inner.animationTracks().map { core ->
        Track(
            elementIndex = core.elementIndex.toInt(),
            id = null,
            type = TrackType.values()[core.kind.ordinal],
            startMs = core.startMs.toLong(),
            durationMs = core.durationMs.toLong(),
            easing = Easing.values()[core.easing.ordinal],
        )
    }.toMutableList()

    fun start() {
        if (tracks.isEmpty() && session == null) return
        startNanos = System.nanoTime()
        Choreographer.getInstance().postFrameCallback(this)
    }

    fun stop() {
        Choreographer.getInstance().removeFrameCallback(this)
    }

    override fun doFrame(frameTimeNanos: Long) {
        val nowMs = ((frameTimeNanos - startNanos) / 1_000_000L)

        // Re-snapshot when streaming session ticks the version.
        session?.let { s ->
            if (s.version != lastSnapshotVersion) {
                lastSnapshotVersion = s.version
                try {
                    val f = TraceFile(s.snapshot())
                    renderer.load(f)
                    tracks = f.inner.animationTracks().map { core ->
                        Track(
                            elementIndex = core.elementIndex.toInt(),
                            id = null,
                            type = TrackType.values()[core.kind.ordinal],
                            startMs = core.startMs.toLong(),
                            durationMs = core.durationMs.toLong(),
                            easing = Easing.values()[core.easing.ordinal],
                        )
                    }.toMutableList()
                } catch (e: Exception) {
                    android.util.Log.w("Trace", "session refresh failed", e)
                }
            }
        }

        var anyActive = false
        for (i in tracks.indices) {
            if (tracks[i].finished) continue
            anyActive = true
            val t0 = tracks[i].startMs
            val dur = tracks[i].durationMs.coerceAtLeast(1)
            if (nowMs < t0) continue
            val elapsed = nowMs - t0
            val raw = (elapsed.toFloat() / dur.toFloat()).coerceAtMost(1f)
            val eased = applyEasing(tracks[i].easing, raw)
            when (tracks[i].type) {
                TrackType.STROKE_DRAW -> renderer.setStrokeProgress(eased, tracks[i].elementIndex)
                TrackType.FILL_FADE   -> renderer.setFillOpacity(eased, tracks[i].elementIndex)
                TrackType.APPEAR      -> renderer.setFillOpacity(1f, tracks[i].elementIndex)
                TrackType.OPACITY_TO  -> renderer.setFillOpacity(eased, tracks[i].elementIndex)
                TrackType.TRANSFORM_TO, TrackType.REMOVE -> {
                    // Wired in v1.1 alongside the renderer's transform pipeline.
                }
            }
            if (raw >= 1f) {
                tracks[i].finished = true
                onFinish(tracks[i].id)
            }
        }
        if (anyActive || session != null) {
            Choreographer.getInstance().postFrameCallback(this)
        }
    }

    private fun applyEasing(e: Easing, t: Float): Float {
        val x = t.coerceIn(0f, 1f)
        return when (e) {
            Easing.LINEAR -> x
            Easing.EASE_OUT -> 1 - (1 - x) * (1 - x)
            Easing.EASE_IN_OUT ->
                if (x < 0.5f) 2 * x * x else 1 - Math.pow((-2f * x + 2f).toDouble(), 2.0).toFloat() / 2
            Easing.HAND_NATURAL -> handNatural(x)
        }
    }

    // SPEC §9.2 starting samples. Calibrated against recorded handwriting in
    // phase 8.
    private val handSamples = floatArrayOf(0.00f, 0.12f, 0.40f, 0.70f, 1.00f) to
        floatArrayOf(0.00f, 0.02f, 0.55f, 0.92f, 1.00f)

    private fun handNatural(x: Float): Float {
        val (xs, ys) = handSamples
        for (i in 1 until xs.size) {
            if (x <= xs[i]) {
                val t = (x - xs[i - 1]) / maxOf(xs[i] - xs[i - 1], 1e-6f)
                return ys[i - 1] + (ys[i] - ys[i - 1]) * t
            }
        }
        return 1f
    }
}
