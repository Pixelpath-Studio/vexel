// VexelView.swift — UIView that hosts a Skia surface and renders a Vexel source.
// API mirrors SPEC §5.2.

import UIKit
import SkiaKit

public protocol VexelViewDelegate: AnyObject {
    func traceView(_ view: VexelView, didTap elementId: String, at point: CGPoint)
    func traceView(_ view: VexelView, didFinishAnimation forElementId: String?)
}

public final class VexelView: UIView {
    public enum Source {
        case file(URL)
        case data(Data)
        case session(VexelSession)
    }

    public var source: Source? {
        didSet { reload() }
    }
    public weak var delegate: VexelViewDelegate?

    public var highlightedIds: Set<String> = [] {
        didSet { requestRedraw() }
    }
    public var highlightColor: UIColor = .systemOrange { didSet { requestRedraw() } }
    public var highlightStrokeBoost: CGFloat = 1.5

    private let renderer = TraceRenderer()
    private var animator: Animator?
    private var skiaView: SkiaView!
    private var traceFile: VexelFile?
    private var traceSession: VexelSession?

    public override init(frame: CGRect) {
        super.init(frame: frame); setUp()
    }
    public required init?(coder: NSCoder) {
        super.init(coder: coder); setUp()
    }

    private func setUp() {
        backgroundColor = .clear
        renderer.owner = self
        skiaView = SkiaView(frame: bounds)
        skiaView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        skiaView.drawCallback = { [weak self] canvas in
            self?.drawOn(canvas)
        }
        addSubview(skiaView)
    }

    private func reload() {
        guard let source = source else {
            traceFile = nil; traceSession = nil
            skiaView.setNeedsDisplay(); return
        }
        do {
            switch source {
            case .file(let url):
                let file = try VexelFile(url: url)
                try renderer.load(from: file)
                self.traceFile = file
                self.traceSession = nil
            case .data(let data):
                let file = try VexelFile(data: data)
                try renderer.load(from: file)
                self.traceFile = file
                self.traceSession = nil
            case .session(let session):
                self.traceSession = session
                self.traceFile = try VexelFile(data: try session.snapshot())
                try renderer.load(from: self.traceFile!)
            }
            startOrResetAnimator()
            skiaView.setNeedsDisplay()
        } catch {
            NSLog("[Vexel] load failed: \(error)")
        }
    }

    private func drawOn(_ canvas: SkCanvas) {
        guard let file = traceFile else { return }
        // Apply viewBox → view transform once per frame.
        let vb = file.viewBox
        let sx = bounds.width / vb.width
        let sy = bounds.height / vb.height
        let s = min(sx, sy)
        let dx = (bounds.width - vb.width * s) * 0.5 - vb.minX * s
        let dy = (bounds.height - vb.height * s) * 0.5 - vb.minY * s
        canvas.save()
        canvas.translate(dx, dy)
        canvas.scale(s, s)
        renderer.draw(on: canvas, highlighted: highlightedIds,
                      highlightColor: highlightColor, boost: highlightStrokeBoost)
        canvas.restore()
    }

    func requestRedraw() { skiaView.setNeedsDisplay() }

    private func startOrResetAnimator() {
        animator?.stop()
        animator = Animator(renderer: renderer, file: traceFile!, session: traceSession) { [weak self] id in
            guard let self = self else { return }
            self.delegate?.traceView(self, didFinishAnimation: id)
        }
        animator?.start()
    }

    // MARK: - Hit-testing

    public override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) {
        super.touchesEnded(touches, with: event)
        guard let touch = touches.first, let file = traceFile else { return }
        let viewPt = touch.location(in: self)
        let vb = file.viewBox
        let sx = bounds.width / vb.width
        let sy = bounds.height / vb.height
        let s = min(sx, sy)
        let dx = (bounds.width - vb.width * s) * 0.5 - vb.minX * s
        let dy = (bounds.height - vb.height * s) * 0.5 - vb.minY * s
        // Inverse of the draw transform — map screen to viewBox.
        let vbX = (viewPt.x - dx) / s
        let vbY = (viewPt.y - dy) / s
        // Hit-test runs in Rust. Skia is never queried for identity.
        if let id = file.hitTest(x: vbX, y: vbY, mode: .visiblePainted) {
            delegate?.traceView(self, didTap: id, at: viewPt)
        }
    }
}
