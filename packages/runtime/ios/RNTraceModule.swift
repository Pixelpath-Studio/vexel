// TurboModule implementation. Bridges JS calls (convert, inspect, sessionXxx)
// to the Rust core via the Trace.framework Swift API.

import Foundation
import React  // RCTEventEmitter, RCTBridgeModule
import Trace  // our SwiftPM/CocoaPods framework

@objc(RNTraceModule)
final class RNTraceModule: NSObject, RCTBridgeModule {
    static func moduleName() -> String! { "RNTrace" }
    static func requiresMainQueueSetup() -> Bool { false }

    // Session handles are tracked by integer id, allocated monotonically.
    private static var sessionsLock = NSLock()
    private static var sessions: [Int: TraceSession] = [:]
    private static var nextHandle: Int = 1

    @objc
    func convert(_ svg: String, generator: String?) -> String {
        do {
            let bytes = try TraceCore.convertSvgToTrace(
                svg: svg,
                options: TraceCore.ConvertOptions(
                    generator: generator,
                    normalizeMermaidIds: true,
                    resourcesDir: nil
                )
            )
            return Data(bytes).base64EncodedString()
        } catch {
            return ""  // JS-side check converts empty → throw
        }
    }

    @objc
    func inspect(_ b64: String) -> String {
        guard let data = Data(base64Encoded: b64), let file = try? TraceFile(data: data) else {
            return "{\"error\":\"parse\"}"
        }
        let vb = file.viewBox
        let ids = file.ids
        var meta: [String: String] = [:]
        for k in ["generator", "title", "unsupported", "rendered-size"] {
            if let v = file.metadata(k) { meta[k] = v }
        }
        let obj: [String: Any] = [
            "viewBox": [Double(vb.minX), Double(vb.minY), Double(vb.width), Double(vb.height)],
            "ids": ids,
            "metadata": meta,
        ]
        if let d = try? JSONSerialization.data(withJSONObject: obj),
           let s = String(data: d, encoding: .utf8) {
            return s
        }
        return "{}"
    }

    // -------- Session lifecycle --------

    @objc(createSession:y:w:h:)
    func createSession(_ x: NSNumber, y: NSNumber, w: NSNumber, h: NSNumber) -> NSNumber {
        let vb = CGRect(x: CGFloat(truncating: x), y: CGFloat(truncating: y),
                        width: CGFloat(truncating: w), height: CGFloat(truncating: h))
        let session = TraceSession(viewBox: vb)
        return NSNumber(value: Self.register(session))
    }

    @objc(sessionAppend:svgFragment:strokeDrawMs:fillFadeMs:startAfterCode:startAfterAtMs:easingCode:)
    func sessionAppend(_ handle: NSNumber, svgFragment: String,
                       strokeDrawMs: NSNumber, fillFadeMs: NSNumber,
                       startAfterCode: NSNumber, startAfterAtMs: NSNumber,
                       easingCode: NSNumber) -> String {
        guard let session = Self.session(for: handle.intValue) else { return "{\"ids\":[]}" }
        let anim = FragmentAnim(
            strokeDrawMs: strokeDrawMs.uint32Value == 0 ? nil : strokeDrawMs.uint32Value,
            fillFadeMs:   fillFadeMs.uint32Value   == 0 ? nil : fillFadeMs.uint32Value,
            startAfter:   Self.decodeStartAfter(startAfterCode.intValue, startAfterAtMs.uint32Value),
            easing:       Self.decodeEasing(easingCode.intValue)
        )
        let ids = (try? session.append(svgFragment: svgFragment, anim: anim)) ?? []
        if let d = try? JSONSerialization.data(withJSONObject: ["ids": ids]),
           let s = String(data: d, encoding: .utf8) {
            return s
        }
        return "{\"ids\":[]}"
    }

    @objc(sessionRemove:id:)
    func sessionRemove(_ handle: NSNumber, id: String) -> NSNumber {
        let ok = Self.session(for: handle.intValue)?.remove(id: id) ?? false
        return NSNumber(value: ok)
    }

    @objc(sessionSnapshot:)
    func sessionSnapshot(_ handle: NSNumber) -> String {
        guard let session = Self.session(for: handle.intValue),
              let data = try? session.snapshot() else { return "" }
        return data.base64EncodedString()
    }

    @objc(sessionVersion:)
    func sessionVersion(_ handle: NSNumber) -> NSNumber {
        NSNumber(value: Self.session(for: handle.intValue)?.version ?? 0)
    }

    @objc(sessionRelease:)
    func sessionRelease(_ handle: NSNumber) {
        Self.sessionsLock.lock()
        Self.sessions.removeValue(forKey: handle.intValue)
        Self.sessionsLock.unlock()
    }

    // -------- helpers --------

    private static func register(_ session: TraceSession) -> Int {
        sessionsLock.lock(); defer { sessionsLock.unlock() }
        let h = nextHandle; nextHandle += 1
        sessions[h] = session
        return h
    }
    private static func session(for handle: Int) -> TraceSession? {
        sessionsLock.lock(); defer { sessionsLock.unlock() }
        return sessions[handle]
    }
    private static func decodeStartAfter(_ code: Int, _ atMs: UInt32) -> StartAfter {
        switch code {
        case 0: return .immediately
        case 2: return .atMs(atMs)
        default: return .previousFragment
        }
    }
    private static func decodeEasing(_ code: Int) -> Easing {
        switch code {
        case 0: return .linear
        case 1: return .easeOut
        case 2: return .easeInOut
        default: return .handNatural
        }
    }
}
