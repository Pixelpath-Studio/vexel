// Animator.swift — CADisplayLink-driven animation loop.
//
// Reads ANIM tracks from the TraceFile (or the live Session snapshot) and on
// each frame updates per-element strokeProgress / fillOpacity in the renderer.
// Easing curves are evaluated against the wall-clock millisecond delta since
// the animation started.

import Foundation
import QuartzCore

final class Animator {
    private let renderer: TraceRenderer
    private let file: TraceFile
    private let session: TraceSession?
    private let onFinish: (String?) -> Void

    private var displayLink: CADisplayLink?
    private var startTime: CFTimeInterval = 0
    private var lastSnapshotVersion: UInt64 = 0
    private var tracks: [Track] = []

    private struct Track {
        let elementIndex: Int
        let id: String?
        let type: TrackType  // strokeDraw | fillFade | appear | opacityTo | transformTo | remove
        let startMs: UInt32
        let durationMs: UInt32
        let easing: Easing
        var finished: Bool = false
    }

    init(renderer: TraceRenderer, file: TraceFile, session: TraceSession?,
         onFinish: @escaping (String?) -> Void) {
        self.renderer = renderer
        self.file = file
        self.session = session
        self.onFinish = onFinish
        self.tracks = file.inner.animationTracks().map { core in
            Track(elementIndex: Int(core.elementIndex),
                  id: nil,
                  type: TrackType(core: core.kind),
                  startMs: core.startMs,
                  durationMs: core.durationMs,
                  easing: Easing(core: core.easing))
        }
    }

    func start() {
        guard !tracks.isEmpty || session != nil else { return }
        let link = CADisplayLink(target: self, selector: #selector(tick(_:)))
        link.add(to: .main, forMode: .common)
        startTime = CACurrentMediaTime()
        displayLink = link
    }

    func stop() {
        displayLink?.invalidate(); displayLink = nil
    }

    @objc private func tick(_ link: CADisplayLink) {
        let nowMs = UInt32(((link.timestamp - startTime) * 1000.0).rounded())
        // If we're rendering a live session, pull new tracks since last tick.
        if let session = session, session.version != lastSnapshotVersion {
            // The platform layer would normally consume `delta_since(v)` and
            // append new tracks here. For v1 we just re-snapshot which is
            // good enough for typical fragment cadences (<10 Hz).
            lastSnapshotVersion = session.version
            do {
                let snap = try session.snapshot()
                let newFile = try TraceFile(data: snap)
                tracks = newFile.inner.animationTracks().map { core in
                    Track(elementIndex: Int(core.elementIndex),
                          id: nil,
                          type: TrackType(core: core.kind),
                          startMs: core.startMs,
                          durationMs: core.durationMs,
                          easing: Easing(core: core.easing))
                }
                try renderer.load(from: newFile)
            } catch {
                NSLog("[Trace] session refresh failed: \(error)")
            }
        }

        var anyActive = false
        for i in 0..<tracks.count {
            if tracks[i].finished { continue }
            anyActive = true
            let t0 = tracks[i].startMs
            let dur = max(tracks[i].durationMs, 1)
            guard nowMs >= t0 else { continue }
            let elapsed = nowMs - t0
            let raw = min(Float(elapsed) / Float(dur), 1.0)
            let eased = tracks[i].easing.apply(raw)
            switch tracks[i].type {
            case .strokeDraw:
                renderer.setStrokeProgress(eased, forElement: tracks[i].elementIndex)
            case .fillFade:
                renderer.setFillOpacity(eased, forElement: tracks[i].elementIndex)
            case .appear:
                renderer.setFillOpacity(1.0, forElement: tracks[i].elementIndex)
            case .opacityTo:
                renderer.setFillOpacity(eased, forElement: tracks[i].elementIndex)
            case .transformTo, .remove:
                // v1: not yet wired to the renderer's transform pipeline.
                break
            }
            if raw >= 1.0 {
                tracks[i].finished = true
                onFinish(tracks[i].id)
            }
        }
        if !anyActive && session == nil { stop() }
    }
}

private enum TrackType {
    case strokeDraw, fillFade, appear, opacityTo, transformTo, remove
    init(core: TraceCore.TrackType) {
        switch core {
        case .strokeDraw: self = .strokeDraw
        case .fillFade: self = .fillFade
        case .appear: self = .appear
        case .opacityTo: self = .opacityTo
        case .transformTo: self = .transformTo
        case .remove: self = .remove
        }
    }
}

private enum Easing {
    case linear, easeOut, easeInOut, handNatural
    init(core: TraceCore.Easing) {
        switch core {
        case .linear: self = .linear
        case .easeOut: self = .easeOut
        case .easeInOut: self = .easeInOut
        case .handNatural: self = .handNatural
        }
    }

    func apply(_ t: Float) -> Float {
        let x = max(0.0, min(1.0, t))
        switch self {
        case .linear: return x
        case .easeOut: return 1 - (1 - x) * (1 - x)
        case .easeInOut:
            return x < 0.5 ? 2 * x * x : 1 - pow(-2 * x + 2, 2) / 2
        case .handNatural:
            // Piecewise cubic Bezier per SPEC §9.2.
            // v1 starting control points: (0, 0), (0.12, 0.02), (0.40, 0.55),
            // (0.70, 0.92), (1, 1). Pre-sampled lookup at 32 steps would be
            // ideal; for v1 we evaluate the 4-segment piecewise cubic directly.
            return HandNatural.evaluate(x)
        }
    }
}

private enum HandNatural {
    static let samples: [(Float, Float)] = [
        (0.00, 0.00), (0.12, 0.02), (0.40, 0.55), (0.70, 0.92), (1.00, 1.00)
    ]
    static func evaluate(_ x: Float) -> Float {
        // Linear-interp between adjacent samples; piecewise cubic refinement
        // is a calibration step in week 11 of the plan.
        for i in 1..<samples.count {
            let (x0, y0) = samples[i - 1]
            let (x1, y1) = samples[i]
            if x <= x1 {
                let t = (x - x0) / max(x1 - x0, 1e-6)
                return y0 + (y1 - y0) * t
            }
        }
        return 1.0
    }
}
