import SwiftUI
import AVFoundation

/// Нативный сканер QR на AVFoundation. Запрашивает доступ к камере, при распознавании
/// QR даёт лёгкую вибрацию и возвращает строку.
struct QRScannerView: UIViewControllerRepresentable {
    let onResult: (String) -> Void
    var onDenied: (() -> Void)? = nil

    func makeUIViewController(context: Context) -> ScannerVC {
        let vc = ScannerVC()
        vc.onResult = onResult
        vc.onDenied = onDenied
        return vc
    }
    func updateUIViewController(_ vc: ScannerVC, context: Context) {}
}

final class ScannerVC: UIViewController, AVCaptureMetadataOutputObjectsDelegate {
    var onResult: ((String) -> Void)?
    var onDenied: (() -> Void)?

    private let session = AVCaptureSession()
    private var preview: AVCaptureVideoPreviewLayer?
    private var handled = false

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            configure()
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { [weak self] granted in
                DispatchQueue.main.async {
                    if granted { self?.configure() } else { self?.onDenied?() }
                }
            }
        default:
            onDenied?()
        }
    }

    private func configure() {
        guard let device = AVCaptureDevice.default(for: .video),
              let input = try? AVCaptureDeviceInput(device: device),
              session.canAddInput(input) else { onDenied?(); return }
        session.addInput(input)

        let output = AVCaptureMetadataOutput()
        guard session.canAddOutput(output) else { onDenied?(); return }
        session.addOutput(output)
        output.setMetadataObjectsDelegate(self, queue: .main)
        output.metadataObjectTypes = [.qr]

        let p = AVCaptureVideoPreviewLayer(session: session)
        p.videoGravity = .resizeAspectFill
        p.frame = view.layer.bounds
        view.layer.addSublayer(p)
        preview = p

        let session = self.session
        DispatchQueue.global(qos: .userInitiated).async { session.startRunning() }
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        preview?.frame = view.layer.bounds
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        let session = self.session
        if session.isRunning {
            DispatchQueue.global(qos: .userInitiated).async { session.stopRunning() }
        }
    }

    func metadataOutput(_ output: AVCaptureMetadataOutput,
                        didOutput metadataObjects: [AVMetadataObject],
                        from connection: AVCaptureConnection) {
        guard !handled,
              let obj = metadataObjects.first as? AVMetadataMachineReadableCodeObject,
              let str = obj.stringValue else { return }
        handled = true
        UINotificationFeedbackGenerator().notificationOccurred(.success)
        let session = self.session
        DispatchQueue.global(qos: .userInitiated).async { session.stopRunning() }
        onResult?(str)
    }
}
