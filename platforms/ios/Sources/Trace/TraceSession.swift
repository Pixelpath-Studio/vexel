// TraceSession.swift — streaming session for AI-drawn content. Wraps the Rust
// core's `Session` via UniFFI. Mirrors the API in SPEC §4.5.

import Foundation

public final class TraceSession {
    fileprivate let inner: TraceCore.Session

    public init(viewBox: CGRect) {
        self.inner = TraceCore.Session(viewbox: TraceCore.ViewBox(
            x: Float(viewBox.origin.x),
            y: Float(viewBox.origin.y),
            w: Float(viewBox.size.width),
            h: Float(viewBox.size.height)
        ))
    }

    @discardableResult
    public func append(svgFragment: String, anim: FragmentAnim? = nil) throws -> [String] {
        try inner.appendSvgFragment(svg: svgFragment, anim: anim?.toCore())
    }

    public func remove(id: String) -> Bool { inner.removeElement(id: id) }

    public var version: UInt64 { inner.version() }

    public func snapshot() throws -> Data {
        Data(try inner.snapshot())
    }
}

public struct FragmentAnim {
    public var strokeDrawMs: UInt32?
    public var fillFadeMs: UInt32?
    public var startAfter: StartAfter
    public var easing: Easing

    public init(strokeDrawMs: UInt32? = nil,
                fillFadeMs: UInt32? = nil,
                startAfter: StartAfter = .previousFragment,
                easing: Easing = .handNatural) {
        self.strokeDrawMs = strokeDrawMs
        self.fillFadeMs = fillFadeMs
        self.startAfter = startAfter
        self.easing = easing
    }

    fileprivate func toCore() -> TraceCore.FragmentAnim {
        TraceCore.FragmentAnim(
            strokeDrawMs: strokeDrawMs,
            fillFadeMs: fillFadeMs,
            startAfter: startAfter.toCore(),
            easing: easing.toCore()
        )
    }
}

public enum StartAfter {
    case immediately, previousFragment, atMs(UInt32)
    fileprivate func toCore() -> TraceCore.StartAfter {
        switch self {
        case .immediately: return .immediately
        case .previousFragment: return .previousFragment
        case .atMs(let t): return .atMs(t: t)
        }
    }
}

public enum Easing {
    case linear, easeOut, easeInOut, handNatural
    fileprivate func toCore() -> TraceCore.Easing {
        switch self {
        case .linear:       return .linear
        case .easeOut:      return .easeOut
        case .easeInOut:    return .easeInOut
        case .handNatural:  return .handNatural
        }
    }
}
