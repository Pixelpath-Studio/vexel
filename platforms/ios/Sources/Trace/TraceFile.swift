// TraceFile.swift — Swift wrapper over the Rust core's TraceFile via UniFFI.
//
// UniFFI bindings are generated from `crates/trace-core/src/api/api.udl` by
// `uniffi-bindgen-swift` and emitted into Sources/TraceCore/. This file adapts
// that generated surface to idiomatic Swift (Data instead of [UInt8], etc.).

import Foundation

public final class TraceFile {
    // Holds the parsed core handle. The Rust side keeps the bytes alive for
    // the lifetime of this object via UniFFI's Arc semantics.
    fileprivate let inner: TraceCore.TraceFile  // UniFFI-generated type

    public init(data: Data) throws {
        self.inner = try TraceCore.TraceFile(bytes: Array(data))
    }

    public convenience init(url: URL) throws {
        try self.init(data: Data(contentsOf: url))
    }

    public var viewBox: CGRect {
        let vb = inner.viewbox()
        return CGRect(x: CGFloat(vb.x), y: CGFloat(vb.y),
                      width: CGFloat(vb.w), height: CGFloat(vb.h))
    }

    public var elementCount: Int { Int(inner.elementCount()) }

    public var ids: [String] { inner.ids() }

    public func metadata(_ key: String) -> String? { inner.metadata(key: key) }

    public func hitTest(x: CGFloat, y: CGFloat, mode: HitMode = .visiblePainted) -> String? {
        inner.hitTest(x: Float(x), y: Float(y), mode: mode.toCore())
    }
}

public enum HitMode {
    case visiblePainted
    case visibleStroke
    case visibleFill
    case all
    case boundingBox

    fileprivate func toCore() -> TraceCore.HitMode {
        switch self {
        case .visiblePainted: return .visiblePainted
        case .visibleStroke:  return .visibleStroke
        case .visibleFill:    return .visibleFill
        case .all:            return .all
        case .boundingBox:    return .boundingBox
        }
    }
}
