import SwiftUI

struct OnboardingView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        ZStack {
            Color.miseBg.ignoresSafeArea()
            switch model.phase {
            case .welcome:     WelcomeView()
            case .connect:     ConnectView()
            case .pin:         PinView()
            case .permissions: PermissionsView()
            default:           Color.miseBg
            }
        }
        .preferredColorScheme(L10n.shared.colorScheme)
        .animation(.easeInOut(duration: 0.28), value: model.phase)
    }
}

// MARK: - Приветствие

private struct WelcomeView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        VStack {
            Spacer()
            Wordmark(size: 72)
            Text(t("onb.tagline"))
                .font(.system(size: 16, weight: .medium))
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)
                .padding(.top, 18)
            Spacer()
            Button { model.goConnect() } label: { PrimaryLabel(t("onb.login")) }
                .padding(.horizontal, 24)
                .padding(.bottom, 28)
        }
    }
}

// MARK: - Подключение (скан QR)

private struct ConnectView: View {
    @Environment(AppModel.self) private var model
    @State private var denied = false
    @State private var scanAttempt = 0   // инкремент пересоздаёт сканер → продолжаем ловить QR

    var body: some View {
        VStack(spacing: 0) {
            Spacer()
            VStack(spacing: 10) {
                Text(t("ob.scanTitle"))
                    .font(.system(size: 22, weight: .bold))
                    .foregroundStyle(.primary)
                Text(t("ob.scanHint"))
                    .font(.system(size: 14))
                    .multilineTextAlignment(.center)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 28)
            }
            .padding(.bottom, 24)

            ZStack {
                if denied {
                    Text(t("ob.noCamera"))
                        .font(.system(size: 14))
                        .multilineTextAlignment(.center)
                        .foregroundStyle(.secondary)
                        .padding(.horizontal, 28)
                } else {
                    QRScannerView(onResult: { code in
                        Task {
                            await model.handleScan(code)
                            // Невалидный код / не найден ресторан → пересоздаём сканер и ловим дальше.
                            if model.scanError != nil { scanAttempt += 1 }
                        }
                    }, onDenied: { denied = true })
                    .id(scanAttempt)
                    .overlay { ScanFrame() }
                    .overlay(alignment: .bottom) {
                        if let err = model.scanError {
                            Text(err)
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundStyle(.white)
                                .padding(.horizontal, 14).padding(.vertical, 9)
                                .background(BrandKit.menu.opacity(0.92), in: Capsule())
                                .padding(.bottom, 14)
                                .transition(.move(edge: .bottom).combined(with: .opacity))
                        }
                    }
                    .animation(.easeInOut(duration: 0.2), value: model.scanError)
                }
            }
            .frame(width: 300, height: 300)
            .clipShape(RoundedRectangle(cornerRadius: 28, style: .continuous))
            .onChange(of: model.scanError) { _, newVal in
                guard newVal != nil else { return }
                Task { try? await Task.sleep(for: .seconds(3)); if model.scanError == newVal { model.scanError = nil } }
            }

            Spacer()
            Button { model.goWelcome() } label: {
                Text(t("back")).font(.system(size: 15, weight: .medium))
                    .foregroundStyle(.secondary)
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
                .stroke(.primary.opacity(0.85), lineWidth: 3)
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

    private var keys: [String] {
        ["1","2","3","4","5","6","7","8","9", Biometrics.available ? "faceid" : "", "0","⌫"]
    }

    var body: some View {
        VStack(spacing: 0) {
            Spacer()
            Wordmark(size: 40)
            if let raw = model.restaurant?.logo_url, let url = URL(string: raw) {
                AsyncImage(url: url) { img in
                    img.resizable().scaledToFit()
                } placeholder: { EmptyView() }
                .frame(width: 72, height: 72)
                .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                .padding(.top, 14)
            }
            Text(model.restaurant?.name ?? "")
                .font(.system(size: 19, weight: .bold)).foregroundStyle(.primary)
                .padding(.top, 10)
            Text(t("pin.enter"))
                .font(.system(size: 13)).foregroundStyle(.secondary)
                .padding(.top, 4)

            HStack(spacing: 18) {
                ForEach(0..<4, id: \.self) { i in
                    Circle()
                        .fill(pin.count > i ? (error ? Color.red : Color.primary) : Color.primary.opacity(0.2))
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
                    .foregroundStyle(.secondary)
            }
            .padding(.bottom, 28)
        }
        .alert(t("pin.deviceMismatch"), isPresented: Binding(
            get: { model.deviceMismatch },
            set: { if !$0 { model.deviceMismatch = false } }
        )) {
            Button(t("done"), role: .cancel) { model.deviceMismatch = false }
        } message: {
            Text(t("pin.deviceMismatchMsg"))
        }
        .alert(t("pin.deviceLimit"), isPresented: Binding(
            get: { model.deviceLimitReached },
            set: { if !$0 { model.deviceLimitReached = false } }
        )) {
            Button(t("done"), role: .cancel) { model.deviceLimitReached = false }
        } message: {
            Text(t("pin.deviceLimitMsg"))
        }
    }

    private func tap(_ k: String) {
        if k == "faceid" { Task { await retryBiometrics() }; return }
        if k == "⌫" { if !pin.isEmpty { pin.removeLast() }; return }
        guard !k.isEmpty, pin.count < 4, !checking else { return }
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        error = false
        pin.append(k)
        if pin.count == 4 {
            checking = true
            let entered = pin
            Task {
                let ok = await model.checkPin(entered)
                checking = false
                if ok {
                    UINotificationFeedbackGenerator().notificationOccurred(.success)
                    model.proceedAfterPin()
                } else {
                    UINotificationFeedbackGenerator().notificationOccurred(.error)
                    error = true; shake.toggle()
                    try? await Task.sleep(nanoseconds: 500_000_000)
                    pin = ""
                }
            }
        }
    }

    private func retryBiometrics() async {
        guard !checking else { return }
        checking = true
        let ok = await Biometrics.authenticate(reason: t("faceid.loginReason"))
        checking = false
        if ok {
            UINotificationFeedbackGenerator().notificationOccurred(.success)
            model.proceedAfterPin()
        }
    }
}

private struct KeyLabel: View {
    let k: String
    init(_ k: String) { self.k = k }
    var body: some View {
        ZStack {
            if !k.isEmpty {
                Circle().fill(k == "⌫" || k == "faceid" ? Color.clear : Color.primary.opacity(0.08))
            }
            if k == "faceid" {
                Image(systemName: "faceid").font(.system(size: 26, weight: .regular)).foregroundStyle(.primary)
            } else {
                Text(k).font(.system(size: k == "⌫" ? 22 : 28, weight: .regular)).foregroundStyle(.primary)
            }
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
        Perm(symbol: "faceid", title: t("ob.faceTitle"),
             desc: t("ob.faceDesc"), cta: t("ob.faceCta")),
        Perm(symbol: "bell.badge.fill", title: t("ob.notifTitle"),
             desc: t("ob.notifDesc"), cta: t("ob.notifCta")),
        Perm(symbol: "location.fill", title: t("ob.geoTitle"),
             desc: t("ob.geoDesc"), cta: t("ob.geoCta")),
    ]

    var body: some View {
        let p = perms[min(step, perms.count - 1)]
        VStack(spacing: 0) {
            Spacer()
            VStack(spacing: 12) {
                ZStack {
                    RoundedRectangle(cornerRadius: 24, style: .continuous)
                        .fill(.primary.opacity(0.07))
                        .frame(width: 88, height: 88)
                    Image(systemName: p.symbol)
                        .font(.system(size: 38, weight: .regular))
                        .foregroundStyle(.primary)
                }
                Text(p.title).font(.system(size: 22, weight: .bold)).foregroundStyle(.primary)
                Text(p.desc).font(.system(size: 15)).multilineTextAlignment(.center)
                    .foregroundStyle(.secondary).padding(.horizontal, 28)
            }
            HStack(spacing: 6) {
                ForEach(0..<perms.count, id: \.self) { i in
                    Circle().fill(i == step ? Color.primary : Color.primary.opacity(0.22))
                        .frame(width: 7, height: 7)
                }
            }
            .padding(.top, 24)
            Spacer()
            VStack(spacing: 10) {
                Button { Task { await allow() } } label: { PrimaryLabel(p.cta) }
                    .disabled(busy)
                if step < perms.count - 1 {
                    Button { advance() } label: {
                        Text(t("ob.notNow")).font(.system(size: 15, weight: .medium))
                            .foregroundStyle(.secondary)
                    }
                }
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 28)
        }
    }

    private func allow() async {
        busy = true
        switch step {
        case 0: _ = await Biometrics.authenticate(reason: t("faceid.enableReason"))
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
            .foregroundStyle(Color(UIColor.systemBackground))
            .frame(maxWidth: .infinity)
            .padding(.vertical, 17)
            .background(Color.primary, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }
}
