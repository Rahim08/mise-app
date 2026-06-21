import Speech
import AVFoundation

// Voice recognition wrapper for the AI button.
// Requires NSMicrophoneUsageDescription + NSSpeechRecognitionUsageDescription in Info.plist.
// Without those keys the authorization will always return .denied and the app
// falls back to the text-input sheet gracefully.

@MainActor
@Observable
final class SpeechManager {
    var isListening = false
    var transcript = ""
    var audioLevel: Float = 0  // 0–1, updated per audio buffer while listening

    private var recognizer: SFSpeechRecognizer?
    private var audioEngine = AVAudioEngine()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?

    init() {
        recognizer = SFSpeechRecognizer(locale: Locale.current)
            ?? SFSpeechRecognizer(locale: Locale(identifier: "en-US"))
    }

    /// Request both microphone + speech permissions. Returns true if both granted.
    func requestPermissions() async -> Bool {
        let micGranted = await AVAudioApplication.requestRecordPermission()
        guard micGranted else { return false }
        return await withCheckedContinuation { cont in
            SFSpeechRecognizer.requestAuthorization { status in
                cont.resume(returning: status == .authorized)
            }
        }
    }

    /// Start listening. Returns false if permissions denied or recognizer unavailable.
    func start() async -> Bool {
        guard await requestPermissions() else { return false }
        guard recognizer?.isAvailable == true else { return false }

        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.record, mode: .measurement, options: .duckOthers)
            try session.setActive(true, options: .notifyOthersOnDeactivation)
        } catch { return false }

        request = SFSpeechAudioBufferRecognitionRequest()
        guard let req = request else { return false }
        req.shouldReportPartialResults = true

        let input = audioEngine.inputNode
        let format = input.outputFormat(forBus: 0)
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak req, weak self] buf, _ in
            req?.append(buf)
            // RMS amplitude → 0–1 level for the pulse animation
            if let data = buf.floatChannelData?[0] {
                let n = Int(buf.frameLength)
                let rms = (0..<n).reduce(Float(0)) { $0 + data[$1] * data[$1] }
                let level = min(1.0, sqrt(rms / max(1, Float(n))) * 20)
                Task { @MainActor [weak self] in self?.audioLevel = level }
            }
        }
        audioEngine.prepare()
        do { try audioEngine.start() } catch { cleanup(); return false }

        transcript = ""
        isListening = true
        task = recognizer?.recognitionTask(with: req) { [weak self] result, error in
            Task { @MainActor [weak self] in
                if let r = result { self?.transcript = r.bestTranscription.formattedString }
                if error != nil || result?.isFinal == true { self?.isListening = false }
            }
        }
        return true
    }

    /// Stop listening and return the captured transcript.
    func stop() -> String {
        cleanup()
        isListening = false
        audioLevel = 0
        let result = transcript
        transcript = ""
        return result
    }

    private func cleanup() {
        audioEngine.stop()
        if audioEngine.inputNode.numberOfInputs > 0 {
            audioEngine.inputNode.removeTap(onBus: 0)
        }
        request?.endAudio()
        task?.cancel()
        request = nil
        task = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }
}
