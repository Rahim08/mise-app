import SwiftUI

// Floating draggable AI button with mise gradient.
// Tap = voice input (requires mic+speech permissions in Info.plist).
// Long press = text input sheet.
// Falls back to text sheet automatically if permissions are denied.

struct AIButton: View {
    let module: String
    let onMessage: (String) async -> Void

    @State private var speech = SpeechManager()
    @State private var pos = CGPoint.zero          // zero = use default (set on first appear)
    @State private var dragOffset = CGSize.zero
    @State private var showText = false
    @State private var textInput = ""
    @State private var processing = false
    @State private var didDrag = false
    @State private var pressStart: Date?

    private let size: CGFloat = 52

    var body: some View {
        GeometryReader { geo in
            let defaultPos = CGPoint(
                x: geo.size.width - size / 2 - 18,
                y: geo.size.height - size / 2 - 100
            )
            let base = pos == .zero ? defaultPos : pos
            let current = CGPoint(x: base.x + dragOffset.width, y: base.y + dragOffset.height)

            buttonCircle
                .position(current)
                .gesture(
                    DragGesture(minimumDistance: 0)
                        .onChanged { g in
                            if pressStart == nil { pressStart = Date() }
                            let moved = hypot(g.translation.width, g.translation.height)
                            if moved > 8 {
                                didDrag = true
                                dragOffset = g.translation
                            } else if !didDrag, let s = pressStart,
                                      Date().timeIntervalSince(s) > 0.55, !showText {
                                showText = true
                            }
                        }
                        .onEnded { g in
                            let moved = hypot(g.translation.width, g.translation.height)
                            defer { pressStart = nil; didDrag = false; dragOffset = .zero }
                            if didDrag {
                                let newPos = CGPoint(x: base.x + g.translation.width,
                                                     y: base.y + g.translation.height)
                                pos = clamped(newPos, in: geo.size)
                            } else if moved < 8 && !showText && !processing {
                                Task { await tapAction() }
                            }
                        }
                )
        }
        .ignoresSafeArea()
        .allowsHitTesting(true)
        .sheet(isPresented: $showText) { textSheet }
    }

    private var buttonCircle: some View {
        ZStack {
            Circle()
                .fill(
                    LinearGradient(colors: BrandKit.eGradient,
                                   startPoint: .topLeading, endPoint: .bottomTrailing)
                )
                .shadow(
                    color: speech.isListening
                        ? Color(hex: 0x5e5ce6).opacity(0.65)
                        : .black.opacity(0.28),
                    radius: speech.isListening ? 20 : 8,
                    y: speech.isListening ? 0 : 3
                )
            Group {
                if processing {
                    ProgressView().tint(.white).scaleEffect(0.65)
                } else if speech.isListening {
                    Image(systemName: "waveform")
                        .font(.system(size: 20, weight: .medium)).foregroundStyle(.white)
                } else {
                    Image(systemName: "sparkles")
                        .font(.system(size: 19, weight: .medium)).foregroundStyle(.white)
                }
            }
        }
        .frame(width: size, height: size)
        .scaleEffect(speech.isListening ? 1.13 : (processing ? 0.92 : 1.0))
        .animation(.spring(duration: 0.32), value: speech.isListening)
        .animation(.spring(duration: 0.22), value: processing)
    }

    private var textSheet: some View {
        NavigationStack {
            ZStack {
                Color.miseBg.ignoresSafeArea()
                VStack(spacing: 16) {
                    TextField(t("ai.typeMessage"), text: $textInput, axis: .vertical)
                        .textFieldStyle(.plain)
                        .font(.system(size: 16))
                        .padding(14)
                        .background(Color.primary.opacity(0.07), in: RoundedRectangle(cornerRadius: 14))
                        .lineLimit(3...8)

                    if processing {
                        HStack(spacing: 8) {
                            ProgressView().tint(.primary)
                            Text(t("ai.thinking")).font(.system(size: 14)).foregroundStyle(.primary.opacity(0.6))
                        }
                    } else {
                        Button {
                            let msg = textInput.trimmingCharacters(in: .whitespacesAndNewlines)
                            guard !msg.isEmpty else { return }
                            showText = false
                            textInput = ""
                            Task { processing = true; await onMessage(msg); processing = false }
                        } label: {
                            Text(t("ai.send"))
                                .font(.system(size: 16, weight: .bold)).foregroundStyle(.white)
                                .frame(maxWidth: .infinity).padding(.vertical, 15)
                                .background(
                                    LinearGradient(colors: BrandKit.eGradient,
                                                   startPoint: .leading, endPoint: .trailing),
                                    in: RoundedRectangle(cornerRadius: 14)
                                )
                        }
                        .disabled(textInput.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    }
                    Spacer()
                }
                .padding(20)
            }
            .navigationTitle("AI")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(t("done")) { showText = false }
                }
            }
            .toolbarBackground(Color.miseBg, for: .navigationBar)
        }
    }

    private func tapAction() async {
        if speech.isListening {
            let msg = speech.stop()
            guard !msg.isEmpty else { return }
            processing = true
            await onMessage(msg)
            processing = false
        } else {
            let ok = await speech.start()
            if !ok { showText = true }  // permissions denied — fall back to text
        }
    }

    private func clamped(_ p: CGPoint, in size: CGSize) -> CGPoint {
        let r = self.size / 2 + 10
        return CGPoint(
            x: max(r, min(size.width - r, p.x)),
            y: max(r + 50, min(size.height - r, p.y))
        )
    }
}
