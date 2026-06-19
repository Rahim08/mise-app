import SwiftUI

struct RootView: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            switch app.phase {
            case .loading:
                SplashView()
            case .connecting:
                ConnectingView()
            case .pinEntry:
                PinEntryView()
            case .active:
                MainPOSView()
            }
        }
        .onAppear { app.start() }
    }
}

// MARK: - Splash

struct SplashView: View {
    var body: some View {
        VStack(spacing: 8) {
            Text("mise")
                .font(.system(size: 48, weight: .black, design: .default))
                .foregroundStyle(.white)
            Text("POS")
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(.gray)
                .tracking(4)
        }
    }
}

// MARK: - Connecting

struct ConnectingView: View {
    @Environment(AppModel.self) private var app
    @State private var dots = ""
    @State private var timer: Timer?

    var body: some View {
        VStack(spacing: 24) {
            ProgressView()
                .tint(.white)
                .scaleEffect(1.4)

            VStack(spacing: 6) {
                Text("Поиск сервера\(dots)")
                    .font(.headline)
                    .foregroundStyle(.white)
                Text("mise-pos.local")
                    .font(.caption)
                    .foregroundStyle(.gray)
                    .monospaced()
            }

            if case .disconnected(let reason) = app.network.state {
                Text(reason)
                    .font(.caption)
                    .foregroundStyle(.red.opacity(0.8))
                    .padding(.top, 8)
            }
        }
        .onAppear {
            timer = Timer.scheduledTimer(withTimeInterval: 0.6, repeats: true) { _ in
                dots = dots.count >= 3 ? "" : dots + "."
            }
        }
        .onDisappear { timer?.invalidate() }
    }
}

// MARK: - PIN Entry

struct PinEntryView: View {
    @Environment(AppModel.self) private var app
    @State private var pin = ""
    @State private var shake = false
    @State private var error: String?

    private let digits = [["1","2","3"],["4","5","6"],["7","8","9"],["←","0","→"]]

    var body: some View {
        VStack(spacing: 40) {
            VStack(spacing: 8) {
                Text("mise POS")
                    .font(.system(size: 28, weight: .black))
                    .foregroundStyle(.white)
                Text("Введите PIN")
                    .font(.subheadline)
                    .foregroundStyle(.gray)
            }

            // Dots indicator
            HStack(spacing: 16) {
                ForEach(0..<4, id: \.self) { i in
                    Circle()
                        .fill(i < pin.count ? Color.white : Color.white.opacity(0.2))
                        .frame(width: 14, height: 14)
                }
            }
            .offset(x: shake ? -10 : 0)
            .animation(shake ? .spring(response: 0.1, dampingFraction: 0.3).repeatCount(3) : .default, value: shake)

            if let error {
                Text(error)
                    .font(.caption)
                    .foregroundStyle(.red)
            }

            // Numpad
            VStack(spacing: 12) {
                ForEach(digits, id: \.self) { row in
                    HStack(spacing: 12) {
                        ForEach(row, id: \.self) { key in
                            Button {
                                handleKey(key)
                            } label: {
                                Text(key == "→" ? "OK" : key)
                                    .font(.system(size: 22, weight: .semibold))
                                    .foregroundStyle(.white)
                                    .frame(width: 80, height: 80)
                                    .background(keyBg(key))
                                    .clipShape(Circle())
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }
        }
        .padding()
    }

    private func keyBg(_ key: String) -> Color {
        switch key {
        case "←": return Color.white.opacity(0.12)
        case "→": return pin.count == 4 ? Color.white : Color.white.opacity(0.06)
        default:  return Color.white.opacity(0.1)
        }
    }

    private func handleKey(_ key: String) {
        switch key {
        case "←":
            if !pin.isEmpty { pin.removeLast() }
        case "→":
            guard pin.count == 4 else { return }
            app.submitPin(pin)
        default:
            guard pin.count < 4 else { return }
            pin.append(key)
            if pin.count == 4 {
                // Auto-submit
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                    app.submitPin(pin)
                }
            }
        }
    }
}

// MARK: - Main POS

struct MainPOSView: View {
    @Environment(AppModel.self) private var app
    @State private var selectedTab = "floor"

    var body: some View {
        TabView(selection: $selectedTab) {
            FloorView()
                .tabItem { Label("Зал", systemImage: "table.furniture") }
                .tag("floor")

            KDSView()
                .tabItem { Label("Кухня", systemImage: "flame") }
                .tag("kitchen")

            SessionView()
                .tabItem { Label("Смена", systemImage: "key") }
                .tag("session")

            AnalyticsStubView()
                .tabItem { Label("Отчёты", systemImage: "chart.bar") }
                .tag("reports")
        }
        .tint(.white)
        .overlay(alignment: .top) {
            ConnectionBanner()
        }
    }
}

// MARK: - Connection banner

struct ConnectionBanner: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        if case .disconnected(let reason) = app.network.state {
            HStack(spacing: 8) {
                Image(systemName: "wifi.slash")
                Text("Нет связи с сервером")
                    .font(.caption.weight(.medium))
            }
            .foregroundStyle(.white)
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
            .background(Color.red.opacity(0.9))
            .clipShape(Capsule())
            .padding(.top, 8)
            .transition(.move(edge: .top).combined(with: .opacity))
        }
    }
}

// MARK: - Stubs

struct OrdersListView: View {
    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            Text("Список заказов — фаза 2")
                .foregroundStyle(.gray)
        }
    }
}

struct AnalyticsStubView: View {
    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            Text("Отчёты — фаза 8")
                .foregroundStyle(.gray)
        }
    }
}
