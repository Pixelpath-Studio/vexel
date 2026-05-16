// Fabric component implementation. Hosts a `Trace.TraceView` (from
// Trace.framework) inside a UIView managed by the RN view registry.
//
// Per SPEC §7.5 the rendering surface used here piggybacks on the host app's
// react-native-skia distribution for Skia binaries — the framework does not
// bundle its own copy.

import UIKit
import React
import Trace

@objc(RNTraceViewManager)
final class RNTraceViewManager: RCTViewManager {
    override class func requiresMainQueueSetup() -> Bool { true }
    override func view() -> UIView! { RNTraceViewWrapper(frame: .zero) }
}

final class RNTraceViewWrapper: UIView, TraceViewDelegate {
    @objc var sourceBytesB64: String = "" { didSet { reload() } }
    @objc var sessionHandle: NSNumber = 0 { didSet { reload() } }
    @objc var highlightedIdsCsv: String = "" { didSet { applyHighlights() } }
    @objc var highlightColor: String? { didSet { applyHighlightColor() } }
    @objc var highlightStrokeBoost: NSNumber = 1.5

    @objc var onElementPress: RCTDirectEventBlock?
    @objc var onAnimationFinished: RCTDirectEventBlock?

    private let inner = TraceView()

    override init(frame: CGRect) {
        super.init(frame: frame)
        inner.delegate = self
        inner.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        addSubview(inner)
    }
    required init?(coder: NSCoder) { fatalError("not supported") }

    private func reload() {
        if sessionHandle.intValue != 0 {
            // Session-driven view; the wrapper polls the snapshot via the
            // Trace.framework Animator, which already supports session input.
            // For v1 we re-fetch the snapshot on each version bump from JS.
            if let bytes = Data(base64Encoded: sourceBytesB64) {
                inner.source = .data(bytes)
            }
        } else if let bytes = Data(base64Encoded: sourceBytesB64), !bytes.isEmpty {
            inner.source = .data(bytes)
        }
    }

    private func applyHighlights() {
        inner.highlightedIds = Set(
            highlightedIdsCsv.split(separator: ",").map(String.init).filter { !$0.isEmpty }
        )
    }

    private func applyHighlightColor() {
        if let s = highlightColor, let c = UIColor(hex: s) {
            inner.highlightColor = c
        }
    }

    // TraceViewDelegate
    func traceView(_ view: TraceView, didTap elementId: String, at point: CGPoint) {
        onElementPress?(["id": elementId, "x": point.x, "y": point.y])
    }
    func traceView(_ view: TraceView, didFinishAnimation forElementId: String?) {
        onAnimationFinished?(["id": forElementId as Any])
    }
}

private extension UIColor {
    convenience init?(hex: String) {
        var s = hex; if s.hasPrefix("#") { s.removeFirst() }
        guard let v = UInt32(s, radix: 16) else { return nil }
        let r = CGFloat((v >> 16) & 0xFF) / 255
        let g = CGFloat((v >> 8)  & 0xFF) / 255
        let b = CGFloat( v        & 0xFF) / 255
        self.init(red: r, green: g, blue: b, alpha: 1)
    }
}
