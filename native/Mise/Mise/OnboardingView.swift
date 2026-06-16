import SwiftUI

struct OnboardingView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            switch model.phase {
            case .welcome:     WelcomeView()
            case .connect:     ConnectView()
            case .pin:         PinView()
            case .permissions: PermissionsView()
            default:           Color.black
            }
        }
        .preferredColorScheme(.dark)
        .animation(.easeInOut(duration: 0.28), value: model.phase)
    }
}

// MARK: - Приветствие

private struct WelcomeView: View {
    @Environment(AppModel.self) private var model

    private let features: [(String, CGFloat, CGFloat)] = [
        ("Смены и касса", 0.20, 0.16), ("Выручка в реальном времени", 0.70, 0.22),
        ("Склад табака", 0.24, 0.34), ("Расписание команды", 0.74, 0.36),
        ("Зарплаты без таблиц", 0.18, 0.62), ("QR-меню", 0.78, 0.60),
        ("Инвентаризация", 0.30, 0.74), ("Кальянная смена", 0.70, 0.74),
    ]

    var body: some View {
        VStack {
            Spacer()
            Wordmark(size: 72, color: .white)
            Text(t("onb.tagline"))
                .font(.system(size: 16, weight: .medium))
                .multilineTextAlignment(.center)
                .foregroundStyle(.white.opacity(0.55))
                .padding(.top, 18)
            Spacer()
            Button { model.goConnect() } label: { PrimaryLabel(t("onb.login")) }
                .padding(.horizontal, 24)
                .padding(.bottom, 28)
        }
        .background(FloatingFeatures(items: features))
    }
}

private struct FloatingFeatures: View {
    let items: [(String, CGFloat, CGFloat)]
    var body: some View {
        GeometryReader { geo in
            TimelineView(.animation) { ctx in
                let t = ctx.date.timeIntervalSinceReferenceDate
                ForEach(Array(items.enumerated()), id: \.offset) { i, item in
                    let phase = (sin(t * 0.6 + Double(i) * 1.3) + 1) / 2
                    Text(item.0)
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(.white.opacity(0.06 + phase * 0.26))
                        .position(x: geo.size.width * item.1, y: geo.size.height * item.2)
                }
            }
        }
        .allowsHitTesting(false)
    }
}

// MARK: - Подключение (скан QR)

private struct ConnectView: View {
    @Environment(AppModel.self) private var model
    @State private var denied = false

    var body: some View {
        VStack(spacing: 0) {
            Spacer()
            VStack(spacing: 10) {
                Text("Отсканируйте QR заведения")
                    .font(.system(size: 22, weight: .bold))
                    .foregroundStyle(.white)
                Text("Индивидуальный QR-код вам покажет владелец — в дашборде Mise, раздел «Доступ».")
                    .font(.system(size: 14))
                    .multilineTextAlignment(.center)
                    .foregroundStyle(.white.opacity(0.55))
                    .padding(.horizontal, 28)
            }
            .padding(.bottom, 24)

            ZStack {
                if denied {
                    Text("Нет доступа к камере. Разрешите его в Настройках → Mise → Камера.")
                        .font(.system(size: 14))
                        .multilineTextAlignment(.center)
                        .foregroundStyle(.white.opacity(0.55))
                        .padding(.horizontal, 28)
                } else {
                    QRScannerView(onResult: { code in
                        Task { await model.handleScan(code) }
                    }, onDenied: { denied = true })
                    .overlay { ScanFrame() }
                }
            }
            .frame(width: 300, height: 300)
            .clipShape(RoundedRectangle(cornerRadius: 28, style: .continuous))

            Spacer()
            Button { model.goWelcome() } label: {
                Text("Назад").font(.system(size: 15, weight: .medium))
                    .foregroundStyle(.white.opacity(0.6))
            }
            .padding(.bottom, 28)
        }
    }
}

private struct ScanFrame: View {
    var body: some View {
        GeometryReader { geo in
            let s = min(geo.size.width, geo.size.height) * 0.64
            RoundedRectangle(cornerRadius: 16)
                .stroke(.white.opacity(0.9), lineWidth: 3)
                .frame(width: s, height: s)
                .position(x: geo.size.width / 2, y: geo.size.height / 2)
        }
    }
}

// MARK: - PIN

private struct PinView: View {
    @Environment(AppModel.self) private var model
    @State private var pin = ""
    @State private var error = false
    @State private var shake = false
    @State private var checking = false

    private let keys = ["1","2","3","4","5","6","7","8","9","","0","⌫"]

    var body: some View {
        VStack(spacing: 0) {
            Spacer()
            Wordmark(size: 40, color: .white)
            Text(model.restaurant?.name ?? "")
                .font(.system(size: 19, weight: .bold)).foregroundStyle(.white)
                .padding(.top, 10)
            Text(t("pin.enter"))
                .font(.system(size: 13)).foregroundStyle(.white.opacity(0.55))
                .padding(.top, 4)

            HStack(spacing: 18) {
                ForEach(0..<4, id: \.self) { i in
                    Circle()
                        .fill(pin.count > i ? (error ? Color.red : Color.white) : Color.white.opacity(0.2))
                        .frame(width: 14, height: 14)
                        .scaleEffect(pin.count > i ? 1.15 : 1)
                }
            }
            .padding(.vertical, 40)
            .offset(x: shake ? -10 : 0)
            .animation(shake ? .default.repeatCount(3, autoreverses: true).speed(6) : .default, value: shake)

            LazyVGrid(columns: Array(repeating: GridItem(.fixed(74), spacing: 14), count: 3), spacing: 14) {
                ForEach(keys, id: \.self) { k in
                    Button { tap(k) } label: { KeyLabel(k) }
                        .disabled(k.isEmpty || checking)
                        .buttonStyle(.plain)
                }
            }

            Spacer()
            Button { model.goConnect() } label: {
                Text(t("pin.change")).font(.system(size: 13))
                    .foregroundStyle(.white.opacity(0.45))
            }
            .padding(.bottom, 28)
        }
    }

    private func tap(_ k: String) {
        if k == "⌫" { if !pin.isEmpty { pin.removeLast() }; return }
        guard !k.isEmpty, pin.count < 4, !checking else { return }
        error = false
        pin.append(k)
        if pin.count == 4 {
            checking = true
            let entered = pin
            Task {
                let ok = await model.checkPin(entered)
                checking = false
                if ok {
                    model.proceedAfterPin()
                } else {
                    error = true; shake.toggle()
                    try? await Task.sleep(nanoseconds: 500_000_000)
                    pin = ""
                }
            }
        }
    }
}

private struct KeyLabel: View {
    let k: String
    init(_ k: String) { self.k = k }
    var body: some View {
        ZStack {
            if !k.isEmpty {
                Circle().fill(k == "⌫" ? Color.clear : Color.white.opacity(0.08))
            }
            Text(k).font(.system(size: k == "⌫" ? 22 : 28, weight: .regular)).foregroundStyle(.white)
        }
        .frame(width: 74, height: 74)
    }
}

// MARK: - Разрешения

private struct PermissionsView: View {
    @Environment(AppModel.self) private var model
    @State private var step = 0
    @State private var busy = false
    @State private var locationRequester = LocationRequester()

    private struct Perm { let symbol, title, desc, cta: String }
    private let perms = [
        Perm(symbol: "faceid", title: "Вход по Face ID",
             desc: "Следующий вход — без ввода PIN, мгновенно и безопасно.", cta: "Включить Face ID"),
        Perm(symbol: "bell.badge.fill", title: "Уведомления",
             desc: "Новые заказы, заканчивающийся табак, конец смены — вовремя.", cta: "Разрешить уведомления"),
        Perm(symbol: "location.fill", title: "Геолокация",
             desc: "Отметка «Я пришёл» на смене работает по месту заведения.", cta: "Разрешить геолокацию"),
    ]

    var body: some View {
        let p = perms[min(step, perms.count - 1)]
        VStack(spacing: 0) {
            Spacer()
            VStack(spacing: 12) {
                ZStack {
                    RoundedRectangle(cornerRadius: 24, style: .continuous)
                        .fill(.white.opacity(0.07))
                        .frame(width: 88, height: 88)
                    Image(systemName: p.symbol)
                        .font(.system(size: 38, weight: .regular))
                        .foregroundStyle(.white)
                }
                Text(p.title).font(.system(size: 22, weight: .bold)).foregroundStyle(.white)
                Text(p.desc).font(.system(size: 15)).multilineTextAlignment(.center)
                    .foregroundStyle(.white.opacity(0.55)).padding(.horizontal, 28)
            }
            HStack(spacing: 6) {
                ForEach(0..<perms.count, id: \.self) { i in
                    Circle().fill(i == step ? Color.white : Color.white.opacity(0.22))
                        .frame(width: 7, height: 7)
                }
            }
            .padding(.top, 24)
            Spacer()
            VStack(spacing: 10) {
                Button { Task { await allow() } } label: { PrimaryLabel(p.cta) }
                    .disabled(busy)
                Button { advance() } label: {
                    Text("Не сейчас").font(.system(size: 15, weight: .medium))
                        .foregroundStyle(.white.opacity(0.6))
                }
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 28)
        }
    }

    private func allow() async {
        busy = true
        switch step {
        case 0: _ = await Biometrics.authenticate(reason: "Включить вход по Face ID")
        case 1: _ = await Notifications.request()
        default: await locationRequester.request()
        }
        busy = false
        advance()
    }

    private func advance() {
        if step >= perms.count - 1 { model.finish() } else { step += 1 }
    }
}

// MARK: - Общие элементы

struct PrimaryLabel: View {
    let title: String
    init(_ title: String) { self.title = title }
    var body: some View {
        Text(title)
            .font(.system(size: 17, weight: .semibold))
            .foregroundStyle(.black)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 17)
            .background(Color.white, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }
}
