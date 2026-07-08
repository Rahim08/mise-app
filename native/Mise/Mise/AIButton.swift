import SwiftUI
import Combine

// MARK: - Shared chat state
//
// Нужно, чтобы модуль (контент за кнопкой) знал, когда чат открыт, и слегка
// размывал свой фон — настоящий «спотлайт» (как Control Center), а не матовая
// панель поверх. Только один модуль на экране одновременно → singleton ок.
@MainActor @Observable final class AIChat {
    static let shared = AIChat()
    var open = false
    private init() {}
}

// MARK: - Neural Bloom mark
//
// Ядро-градиент, вокруг которого расходятся кольца-«ауры». Кольца плавно
// растворяются (opacity = sin(phase·π): 0 → 1 → 0), поэтому на стыке цикла
// нет вспышки — кольцо именно растворяется, а не мигает и исчезает.
// Движение задаётся временем (TimelineView), а не повторяющейся анимацией —
// цикл бесшовный.
private struct BloomRings: View {
    var palette: [Color]
    /// Период одного «вдоха» кольца, сек. Меньше = энергичнее (слушает/думает).
    var period: Double = 2.6
    /// До какого масштаба от базового кадра расходится кольцо.
    var maxScale: CGFloat = 2.0
    /// Общая яркость колец (0…1).
    var intensity: Double = 0.9
    var lineWidth: CGFloat = 1.5

    private let ringCount = 3

    var body: some View {
        TimelineView(.animation) { ctx in
            let t = ctx.date.timeIntervalSinceReferenceDate
            ZStack {
                ForEach(0..<ringCount, id: \.self) { i in
                    let phase = ((t / period) + Double(i) / Double(ringCount))
                        .truncatingRemainder(dividingBy: 1)
                    let scale = 0.5 + CGFloat(phase) * (maxScale - 0.5)
                    let op = sin(phase * .pi) * intensity   // 0→1→0, бесшовно
                    Circle()
                        .strokeBorder(
                            LinearGradient(colors: palette,
                                           startPoint: .topLeading, endPoint: .bottomTrailing),
                            lineWidth: lineWidth)
                        .scaleEffect(scale)
                        .opacity(op)
                }
            }
        }
    }
}

// MARK: - The orb / send button (one object, two states)
//
// `morphed == false` — плавающий Neural-Bloom шар (кнопка вызова ИИ).
// `morphed == true`  — пристыкованная кнопка «отправить» (стрелка вверх).
// Переход между состояниями делает matchedGeometryEffect снаружи —
// объект физически перелетает и перетекает формой.
private struct BloomOrb: View {
    var size: CGFloat
    var morphed: Bool
    var pressing: Bool = false
    var active: Bool = false          // слушает/думает — кольца ярче и быстрее
    var audioLevel: Float = 0

    private var palette: [Color] { BrandKit.eGradient }

    var body: some View {
        ZStack {
            // Аура-кольца только у плавающего шара (за пределами диска — не клипуем).
            if !morphed {
                BloomRings(palette: palette,
                           period: active ? 1.5 : 2.8,
                           maxScale: (active ? 1.6 : 1.35) + CGFloat(audioLevel) * 0.4,
                           intensity: active ? 0.6 : 0.35,
                           lineWidth: 0.8)
                    .frame(width: size, height: size)
            }

            // Базовая форма с градиентом — общая для обоих состояний (плавный морф).
            RoundedRectangle(cornerRadius: morphed ? size * 0.34 : size / 2, style: .continuous)
                .fill(AngularGradient(
                    gradient: Gradient(colors: palette + [palette[0]]),
                    center: .center))
                .overlay(   // стеклянный блик
                    RoundedRectangle(cornerRadius: morphed ? size * 0.34 : size / 2, style: .continuous)
                        .fill(RadialGradient(
                            colors: [.white.opacity(0.55), .clear],
                            center: UnitPoint(x: 0.34, y: 0.3),
                            startRadius: 0, endRadius: size * 0.7))
                )
                .frame(width: size, height: size)
                .shadow(color: Color(hex: 0x5e5ce6).opacity(active ? 0.28 : (pressing ? 0.2 : 0.12)),
                        radius: active || pressing ? 7 : 4, y: pressing ? 0 : 1)
                .shadow(color: .black.opacity(0.14), radius: 2, y: 1)

            // Глиф «отправить» — только в пристыкованном состоянии.
            if morphed {
                Image(systemName: "arrow.up")
                    .font(.system(size: size * 0.42, weight: .bold))
                    .foregroundStyle(.white)
                    .transition(.scale.combined(with: .opacity))
            }
        }
        .frame(width: size, height: size)
        .scaleEffect(pressing ? 1.12 : 1)
        .animation(.spring(duration: 0.22), value: pressing)
        .animation(.spring(duration: 0.3), value: active)
    }
}

// MARK: - Chat message model

private struct AIChatMessage: Identifiable {
    enum Role { case user, ai }
    let id = UUID()
    let role: Role
    let text: String
}

// MARK: - AIButton

struct AIButton: View {
    let module: String
    let onMessage: (String) async -> String?

    @State private var speech = SpeechManager()
    @State private var pos = CGPoint.zero
    @State private var dragOffset = CGSize.zero
    @State private var didDrag = false
    @State private var pressStart: Date?

    @State private var chatOpen = false
    @State private var draft = ""
    @State private var messages: [AIChatMessage] = []
    @State private var thinking = false

    @State private var replyBanner: String? = nil
    @GestureState private var isPressing = false
    @FocusState private var inputFocused: Bool
    @Namespace private var orbNS

    private let size: CGFloat = 32
    private let sendSize: CGFloat = 34

    var body: some View {
        GeometryReader { geo in
            let defaultPos = CGPoint(
                x: geo.size.width - size / 2 - 18,
                y: geo.size.height - size / 2 - 100
            )
            let base = pos == .zero ? defaultPos : pos
            let current = CGPoint(x: base.x + dragOffset.width, y: base.y + dragOffset.height)

            ZStack(alignment: .top) {
                // ---- Chat overlay (spotlight) ----
                if chatOpen {
                    chatOverlay
                        .zIndex(2)
                }

                // ---- Floating orb ----
                if !chatOpen {
                    BloomOrb(size: size,
                             morphed: false,
                             pressing: isPressing,
                             active: speech.isListening,
                             audioLevel: speech.audioLevel)
                        .matchedGeometryEffect(id: "aiOrb", in: orbNS)
                        .position(current)
                        .gesture(dragGesture(base: base, geo: geo))
                        .simultaneousGesture(longPress)
                        .zIndex(1)
                }

                // ---- Voice reply banner ----
                if let banner = replyBanner {
                    AIReplyBanner(text: banner) {
                        withAnimation(.spring(duration: 0.4)) { replyBanner = nil }
                    }
                    .padding(.horizontal, 14)
                    .padding(.top, geo.safeAreaInsets.top + 6)
                    .transition(.move(edge: .top).combined(with: .opacity))
                    .zIndex(3)
                }
            }
            .frame(width: geo.size.width, height: geo.size.height)
        }
        .onDisappear { _ = speech.stop() }
    }

    // MARK: Gestures

    private func dragGesture(base: CGPoint, geo: GeometryProxy) -> some Gesture {
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
                    pos = clamped(raw, in: geo.size)
                    dragOffset = .zero
                    withAnimation(.spring(duration: 0.35)) {
                        pos = clamped(CGPoint(x: edgeX, y: raw.y), in: geo.size)
                    }
                } else {
                    dragOffset = .zero
                    if moved < 8 && !chatOpen && !thinking {
                        Task { await tapAction() }
                    }
                }
            }
    }

    private var longPress: some Gesture {
        LongPressGesture(minimumDuration: 0.45, maximumDistance: 8)
            .updating($isPressing) { v, state, _ in state = v }
            .onEnded { _ in
                UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                if speech.isListening { _ = speech.stop() }
                if !didDrag { openChat() }
            }
    }

    // MARK: Chat overlay (spotlight, reduced blur)

    private var chatOverlay: some View {
        ZStack(alignment: .bottom) {
            // Контент модуля уже слегка размыт (в самом модуле). Здесь — только
            // лёгкое затемнение, чтобы данные просвечивали, но не отвлекали.
            Color.black.opacity(0.18)
                .ignoresSafeArea()
                .contentShape(Rectangle())
                .onTapGesture { closeChat() }

            // Безопасная зона уважается (корень больше не ignoresSafeArea) →
            // строка ввода нативно встаёт НАД клавиатурой.
            VStack(spacing: 0) {
                chatHeader
                messagesScroll
                inputBar
            }
            .padding(.bottom, 4)
        }
        .transition(.opacity)
    }

    private var chatHeader: some View {
        HStack(spacing: 7) {
            BloomOrb(size: 18, morphed: false)
                .frame(width: 18, height: 18)
            Text("mise AI")
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(
                    LinearGradient(colors: BrandKit.eGradient,
                                   startPoint: .leading, endPoint: .trailing))
            Spacer()
            Button { closeChat() } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(.primary.opacity(0.5))
                    .frame(width: 32, height: 32)
                    .background(.ultraThinMaterial, in: Circle())
            }
        }
        .padding(.horizontal, 18)
        .padding(.top, 8)
        .padding(.bottom, 6)
    }

    private var messagesScroll: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 12) {
                    Spacer(minLength: 0).frame(height: 4)
                    ForEach(messages) { msg in
                        messageRow(msg).id(msg.id)
                    }
                    if thinking {
                        thinkingRow.id("thinking")
                    }
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 8)
            }
            .scrollDismissesKeyboard(.interactively)
            .onChange(of: messages.count) { _, _ in
                withAnimation(.spring(duration: 0.4)) {
                    if thinking {
                        proxy.scrollTo("thinking", anchor: .bottom)
                    } else if let last = messages.last?.id {
                        proxy.scrollTo(last, anchor: .bottom)
                    }
                }
            }
            .onChange(of: thinking) { _, t in
                if t { withAnimation { proxy.scrollTo("thinking", anchor: .bottom) } }
            }
        }
    }

    private func messageRow(_ msg: AIChatMessage) -> some View {
        HStack {
            if msg.role == .user { Spacer(minLength: 40) }
            VStack(alignment: msg.role == .user ? .trailing : .leading, spacing: 4) {
                if msg.role == .ai {
                    HStack(spacing: 5) {
                        Circle()
                            .fill(LinearGradient(colors: BrandKit.eGradient,
                                                 startPoint: .topLeading, endPoint: .bottomTrailing))
                            .frame(width: 8, height: 8)
                        Text("mise")
                            .font(.system(size: 11, weight: .bold))
                            .foregroundStyle(
                                LinearGradient(colors: BrandKit.eGradient,
                                               startPoint: .leading, endPoint: .trailing))
                    }
                }
                Text(msg.text)
                    .font(.system(size: 14.5))
                    .foregroundStyle(.primary)
                    .padding(.horizontal, 14).padding(.vertical, 10)
                    .background {
                        if msg.role == .user {
                            RoundedRectangle(cornerRadius: 20, style: .continuous)
                                .fill(.ultraThinMaterial)
                                .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous)
                                    .strokeBorder(.white.opacity(0.12)))
                        } else {
                            RoundedRectangle(cornerRadius: 20, style: .continuous)
                                .fill(Color.miseBg.opacity(0.55))
                                .background(.ultraThinMaterial,
                                            in: RoundedRectangle(cornerRadius: 20, style: .continuous))
                                .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous)
                                    .strokeBorder(.white.opacity(0.08)))
                        }
                    }
                    .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
            }
            if msg.role == .ai { Spacer(minLength: 40) }
        }
        .transition(.asymmetric(
            insertion: .move(edge: .bottom).combined(with: .opacity),
            removal: .opacity))
    }

    private var thinkingRow: some View {
        HStack {
            TypingDots()
                .padding(.horizontal, 14).padding(.vertical, 12)
                .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            Spacer(minLength: 40)
        }
        .transition(.opacity)
    }

    private var inputBar: some View {
        HStack(alignment: .bottom, spacing: 10) {
            HStack {
                TextField(t("ai.ask"), text: $draft, axis: .vertical)
                    .textFieldStyle(.plain)
                    .font(.system(size: 15))
                    .focused($inputFocused)
                    .lineLimit(1...5)
                    .submitLabel(.send)
            }
            .padding(.horizontal, 16).padding(.vertical, 12)
            .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 23, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 23, style: .continuous)
                .strokeBorder(.white.opacity(0.12)))

            // Тот же объект, что и плавающий шар — прилетает сюда и морфится.
            BloomOrb(size: sendSize, morphed: true, active: thinking)
                .matchedGeometryEffect(id: "aiOrb", in: orbNS)
                .opacity(canSend ? 1 : 0.45)
                .scaleEffect(canSend ? 1 : 0.92)
                .animation(.spring(duration: 0.25), value: canSend)
                .onTapGesture { send() }
                .allowsHitTesting(canSend && !thinking)
        }
        .padding(.horizontal, 14)
        .padding(.top, 6)
    }

    private var canSend: Bool {
        !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    // MARK: Actions

    private func openChat() {
        withAnimation(.spring(duration: 0.5, bounce: 0.18)) {
            chatOpen = true
            AIChat.shared.open = true
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { inputFocused = true }
    }

    private func closeChat() {
        inputFocused = false
        withAnimation(.spring(duration: 0.45, bounce: 0.1)) {
            chatOpen = false
            AIChat.shared.open = false
        }
    }

    private func send() {
        let msg = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !msg.isEmpty, !thinking else { return }
        draft = ""
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        withAnimation(.spring(duration: 0.4)) {
            messages.append(AIChatMessage(role: .user, text: msg))
            thinking = true
        }
        Task {
            let reply = await onMessage(msg)
            UIImpactFeedbackGenerator(style: .rigid).impactOccurred()
            withAnimation(.spring(duration: 0.45)) {
                thinking = false
                messages.append(AIChatMessage(role: .ai,
                                              text: reply ?? t("ai.noReply")))
            }
        }
    }

    private func tapAction() async {
        if speech.isListening {
            let msg = speech.stop()
            UIImpactFeedbackGenerator(style: .soft).impactOccurred()
            guard !msg.isEmpty else { return }
            thinking = true
            let reply = await onMessage(msg)
            thinking = false
            showBanner(reply)
        } else {
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
            let ok = await speech.start()
            if !ok { openChat() }   // нет доступа к микрофону → открываем чат
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

// MARK: - Typing dots

private struct TypingDots: View {
    @State private var phase = 0
    private let timer = Timer.publish(every: 0.25, on: .main, in: .common).autoconnect()

    var body: some View {
        HStack(spacing: 5) {
            ForEach(0..<3, id: \.self) { i in
                Circle()
                    .fill(LinearGradient(colors: BrandKit.eGradient,
                                         startPoint: .topLeading, endPoint: .bottomTrailing))
                    .frame(width: 7, height: 7)
                    .opacity(phase == i ? 1 : 0.3)
                    .scaleEffect(phase == i ? 1.15 : 0.85)
            }
        }
        .animation(.easeInOut(duration: 0.25), value: phase)
        .onReceive(timer) { _ in phase = (phase + 1) % 3 }
    }
}

// MARK: - Reply Banner (voice)

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
                    Circle()
                        .fill(LinearGradient(colors: BrandKit.eGradient,
                                             startPoint: .topLeading, endPoint: .bottomTrailing))
                        .frame(width: 8, height: 8)
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
                        Text(t("ai.more"))
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(Color(hex: 0x5e5ce6))
                    }
                }
            }
            .padding(.leading, 27).padding(.trailing, 14)
            .padding(.top, 12).padding(.bottom, 10)

            GeometryReader { geo in
                RoundedRectangle(cornerRadius: 1)
                    .fill(LinearGradient(colors: BrandKit.eGradient,
                                         startPoint: .leading, endPoint: .trailing))
                    .frame(width: geo.size.width * timerProgress, height: 2)
            }
            .frame(height: 2)
        }
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
