import SwiftUI

struct RootView: View {
    @State private var model = AppModel()
    @State private var l10n = L10n.shared
    /// Переход, пришедший ДО авторизации (холодный старт: start() асинхронный, Face ID/PIN
    /// занимают секунды, а системный тап прилетает сразу). Раньше отложенным был только
    /// deep-link виджета, а тап по пушу и quick action просто терялись из-за
    /// `guard model.phase == .authed`.
    private enum PendingRoute {
        case module(String)
        case quickAction(String)
        case push(type: String, data: [String: String])
    }
    @State private var pending: PendingRoute?

    var body: some View {
        Group {
            switch model.phase {
            case .loading:
                SplashView()
            case .authed:
                MainView()
            default:
                OnboardingView()
            }
        }
        .preferredColorScheme(l10n.colorScheme)
        .environment(model)
        .task { await model.start() }
        .onAppear { l10n.applyThemeToWindows() }
        // Deep-link из виджета: mise://analytics | mise://stash | mise://bookings.
        .onOpenURL { url in route(url) }
        // Quick Actions с иконки (3D Touch / Haptic Touch)
        .onReceive(NotificationCenter.default.publisher(for: .quickAction)) { note in
            guard let type = note.object as? String else { return }
            apply(.quickAction(type))
        }
        // Тап по системному пуш-уведомлению (см. PushManager.didReceive response:).
        // userInfo — плоские ключи из data (booking_date/shift_date и т.п., см. lib/apns.ts).
        .onReceive(NotificationCenter.default.publisher(for: .pushTapped)) { note in
            guard let type = note.object as? String else { return }
            var data: [String: String] = [:]
            if let info = note.userInfo {
                for (k, v) in info { if let key = k as? String, let val = v as? String { data[key] = val } }
            }
            apply(.push(type: type, data: data))
        }
        .onChange(of: model.phase) { _, phase in
            if phase == .authed, let route = pending {
                pending = nil
                perform(route)
            }
        }
    }

    private func route(_ url: URL) {
        guard url.scheme == "mise", let host = url.host, !host.isEmpty else { return }
        apply(.module(host))
    }

    /// Выполнить сразу, если уже внутри; иначе запомнить до окончания входа.
    private func apply(_ route: PendingRoute) {
        if model.phase == .authed { perform(route) } else { pending = route }
    }

    private func perform(_ route: PendingRoute) {
        switch route {
        case .module(let id):
            openModule(id)
        case .quickAction(let type):
            switch type {
            case "com.rahim.mise.openBookings": model.openApp("bookings")
            case "com.rahim.mise.openManager":  model.openApp("manager")
            case "com.rahim.mise.addExpense":   model.openApp("manager") // откроет менеджер, расход — через UI
            default: break
            }
        case .push(let type, let data):
            model.routeNotification(type: type, data: data)
        }
    }

    private func openModule(_ id: String) {
        guard model.availableApps.contains(id) else { return }
        model.openApp(id)
    }
}

#Preview {
    RootView()
}
