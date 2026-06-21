import SwiftUI

struct AIButton: View {
    let module: String
    let onMessage: (String) async -> String?

    @State private var speech = SpeechManager()
    @State private var pos = CGPoint.zero
    @State private var dragOffset = CGSize.zero
    @State private var showText = false
    @State private var textInput = ""
    @State private var processing = false
    @State private var didDrag = false
    @State private var pressStart: Date?
    @State private var replyBanner: String? = nil
    @State private var gradAngle: Double = 0
    @GestureState private var isPressing = false

    private let size: CGFloat = 42

    var body: some View {
        GeometryReader { geo in
            let defaultPos = CGPoint(
                x: geo.size.width - size / 2 - 18,
                y: geo.size.height - size / 2 - 100
            )
            let base = pos == .zero ? defaultPos : pos
            let current = CGPoint(x: base.x + dragOffset.width, y: base.y + dragOffset.height)

            ZStack(alignment: .top) {
                // Floating button
                buttonCircle(isPressing: isPressing)
                    .position(current)
                    .onAppear {
                        withAnimation(.linear(duration: 3).repeatForever(autoreverses: false)) {
                            gradAngle = 360
                        }
                    }
                    .gesture(
                        DragGesture(minimumDistance: 0)
                            .onChanged { g in
                                if pressStart == nil {
                                    pressStart = Date()
                                    UIImpactFeedbackGenerator(style: .light).impactOccurred()
                                }
                                let moved = hypot(g.translation.width, g.translation.height)
                                if moved > 8 { didDrag = true; dragOffset = g.translation }
                            }
                            .onEnded { g in
                                let moved = hypot(g.translation.width, g.translation.height)
                                defer { pressStart = nil; didDrag = false }
                                if didDrag {
                                    let raw = CGPoint(x: base.x + g.translation.width,
                                                      y: base.y + g.translation.height)
                                    let edgeX: CGFloat = raw.x < geo.size.width / 2
                                        ? (size / 2 + 12) : (geo.size.width - size / 2 - 12)
                                    // Commit current visual position first (no jump),
                                    // then spring-animate to the snapped edge.
                                    pos = clamped(raw, in: geo.size)
                                    dragOffset = .zero
                                    withAnimation(.spring(duration: 0.35)) {
                                        pos = clamped(CGPoint(x: edgeX, y: raw.y), in: geo.size)
                                    }
                                } else {
                                    dragOffset = .zero
                                    UIImpactFeedbackGenerator(style: .light).impactOccurred()
                                    if moved < 8 && !showText && !processing {
                                        Task { await tapAction() }
                                    }
                                }
                            }
                    )
                    .simultaneousGesture(
                        LongPressGesture(minimumDuration: 0.5, maximumDistance: 8)
                            .updating($isPressing) { v, state, _ in state = v }
                            .onEnded { _ in
                                UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                                if speech.isListening { _ = speech.stop() }
                                if !didDrag && !showText { showText = true }
                            }
                    )

                // Reply banner — slides down from top
                if let banner = replyBanner {
                    AIReplyBanner(text: banner, onDismiss: {
                        withAnimation(.spring(duration: 0.4)) { replyBanner = nil }
                    })
                    .padding(.horizontal, 14)
                    .padding(.top, geo.safeAreaInsets.top + 6)
                    .transition(.move(edge: .top).combined(with: .opacity))
                    .zIndex(1)
                }
            }
            .frame(width: geo.size.width, height: geo.size.height)
        }
        .ignoresSafeArea()
        .allowsHitTesting(true)
        .sheet(isPresented: $showText, onDismiss: { textInput = "" }) {
            textSheet
                .presentationDetents([.height(240)])
                .presentationDragIndicator(.visible)
        }
    }

    // MARK: - Button circle

    private func buttonCircle(isPressing: Bool) -> some View {
        let voiceScale = speech.isListening ? (1.0 + CGFloat(speech.audioLevel) * 0.4) : 1.0
        let glowOpacity = speech.isListening
            ? Double(0.45 + speech.audioLevel * 0.45)
            : (isPressing ? 0.75 : 0.0)
        let glowRadius = speech.isListening
            ? (8 + CGFloat(speech.audioLevel) * 18)
            : (isPressing ? 14 : 5)

        return ZStack {
            if speech.isListening {
                Circle()
                    .fill(Color(hex: 0x5e5ce6).opacity(Double(speech.audioLevel) * 0.22))
                    .frame(width: size + 20, height: size + 20)
                    .animation(.easeOut(duration: 0.08), value: speech.audioLevel)
            }
            Circle()
                .fill(AngularGradient(
                    gradient: Gradient(colors: BrandKit.eGradient + [BrandKit.eGradient[0]]),
                    center: .center,
                    startAngle: .degrees(gradAngle),
                    endAngle: .degrees(gradAngle + 360)
                ))
                .shadow(color: Color(hex: 0x5e5ce6).opacity(glowOpacity),
                        radius: glowRadius,
                        y: (speech.isListening || isPressing) ? 0 : 3)
                .shadow(color: .black.opacity((speech.isListening || isPressing) ? 0 : 0.26),
                        radius: 5, y: 3)
            Group {
                if processing {
                    ProgressView().tint(.white).scaleEffect(0.6)
                } else if speech.isListening {
                    Image(systemName: "waveform")
                        .font(.system(size: 15, weight: .medium)).foregroundStyle(.white)
                } else {
                    Image(systemName: "sparkles")
                        .font(.system(size: 14, weight: .medium)).foregroundStyle(.white)
                }
            }
        }
        .frame(width: size, height: size)
        .scaleEffect(speech.isListening ? voiceScale : (isPressing ? 1.1 : (processing ? 0.9 : 1.0)))
        .animation(.easeOut(duration: 0.08), value: speech.audioLevel)
        .animation(.spring(duration: 0.25), value: speech.isListening)
        .animation(.spring(duration: 0.2), value: isPressing)
        .animation(.spring(duration: 0.22), value: processing)
    }

    // MARK: - Text input sheet (long-press)

    private var textSheet: some View {
        NavigationStack {
            ZStack {
                Color.miseBg.ignoresSafeArea()
                VStack(spacing: 14) {
                    if processing {
                        Spacer()
                        HStack(spacing: 10) {
                            ProgressView().tint(.primary)
                            Text(t("ai.thinking")).font(.system(size: 14)).foregroundStyle(.primary.opacity(0.6))
                        }
                        Spacer()
                    } else {
                        TextField(t("ai.typeMessage"), text: $textInput, axis: .vertical)
                            .textFieldStyle(.plain)
                            .font(.system(size: 15))
                            .padding(13)
                            .background(Color.primary.opacity(0.07), in: RoundedRectangle(cornerRadius: 13))
                            .lineLimit(3...6)
                        Button {
                            let msg = textInput.trimmingCharacters(in: .whitespacesAndNewlines)
                            guard !msg.isEmpty else { return }
                            textInput = ""
                            Task {
                                processing = true
                                let reply = await onMessage(msg)
                                processing = false
                                showText = false
                                showBanner(reply)
                            }
                        } label: {
                            Text(t("ai.send"))
                                .font(.system(size: 15, weight: .bold)).foregroundStyle(.white)
                                .frame(maxWidth: .infinity).padding(.vertical, 14)
                                .background(
                                    LinearGradient(colors: BrandKit.eGradient,
                                                   startPoint: .leading, endPoint: .trailing),
                                    in: RoundedRectangle(cornerRadius: 14)
                                )
                        }
                        .disabled(textInput.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    }
                    Spacer(minLength: 0)
                }
                .padding(18)
            }
            .navigationTitle("AI")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if !processing {
                    ToolbarItem(placement: .cancellationAction) {
                        Button(t("cancel")) { showText = false }
                    }
                }
            }
            .toolbarBackground(Color.miseBg, for: .navigationBar)
        }
    }

    // MARK: - Actions

    private func tapAction() async {
        if speech.isListening {
            let msg = speech.stop()
            UIImpactFeedbackGenerator(style: .soft).impactOccurred()
            guard !msg.isEmpty else { return }
            processing = true
            let reply = await onMessage(msg)
            processing = false
            showBanner(reply)
        } else {
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
            let ok = await speech.start()
            if !ok { showText = true }
        }
    }

    private func showBanner(_ text: String?) {
        guard let text, !text.isEmpty else { return }
        UIImpactFeedbackGenerator(style: .rigid).impactOccurred()
        withAnimation(.spring(duration: 0.5, bounce: 0.2)) { replyBanner = text }
        Task {
            try? await Task.sleep(nanoseconds: 8_000_000_000)
            withAnimation(.easeOut(duration: 0.4)) {
                if replyBanner == text { replyBanner = nil }
            }
        }
    }

    private func clamped(_ p: CGPoint, in sz: CGSize) -> CGPoint {
        let r = size / 2 + 12
        return CGPoint(
            x: max(r, min(sz.width - r, p.x)),
            y: max(r + 50, min(sz.height - r - 20, p.y))
        )
    }
}

// MARK: - Reply Banner

private struct AIReplyBanner: View {
    let text: String
    let onDismiss: () -> Void

    @State private var expanded = false
    @State private var timerProgress: CGFloat = 1.0

    private let dismissAfter: Double = 8

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 5) {
                    Image(systemName: "sparkles")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(Color(hex: 0x5e5ce6))
                    Text("mise AI")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(Color(hex: 0x5e5ce6))
                    Spacer()
                    Button(action: onDismiss) {
                        Image(systemName: "xmark")
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundStyle(.primary.opacity(0.35))
                            .frame(width: 24, height: 24)
                    }
                }

                Text(text)
                    .font(.system(size: 14))
                    .foregroundStyle(.primary)
                    .lineLimit(expanded ? nil : 4)
                    .fixedSize(horizontal: false, vertical: true)

                if !expanded && text.count > 160 {
                    Button {
                        withAnimation(.spring(duration: 0.35)) { expanded = true }
                    } label: {
                        Text("Подробнее")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(Color(hex: 0x5e5ce6))
                    }
                }
            }
            .padding(.leading, 27).padding(.trailing, 14)
            .padding(.top, 12).padding(.bottom, 10)

            // Timer progress line
            GeometryReader { geo in
                RoundedRectangle(cornerRadius: 1)
                    .fill(LinearGradient(colors: BrandKit.eGradient,
                                         startPoint: .leading, endPoint: .trailing))
                    .frame(width: geo.size.width * timerProgress, height: 2)
            }
            .frame(height: 2)
        }
        // Gradient accent bar as overlay — не участвует в layout, не растягивает высоту
        .overlay(alignment: .topLeading) {
            LinearGradient(colors: BrandKit.eGradient, startPoint: .top, endPoint: .bottom)
                .frame(width: 3)
                .clipShape(RoundedRectangle(cornerRadius: 2))
                .padding(.leading, 14)
                .padding(.vertical, 12)
        }
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 18))
        .overlay(
            RoundedRectangle(cornerRadius: 18)
                .stroke(
                    LinearGradient(colors: BrandKit.eGradient.map { $0.opacity(0.4) },
                                   startPoint: .topLeading, endPoint: .bottomTrailing),
                    lineWidth: 1
                )
        )
        .shadow(color: Color(hex: 0x5e5ce6).opacity(0.18), radius: 20, y: 4)
        .shadow(color: .black.opacity(0.12), radius: 8, y: 2)
        .onAppear {
            withAnimation(.linear(duration: dismissAfter)) { timerProgress = 0 }
        }
        .onTapGesture { onDismiss() }
    }
}
