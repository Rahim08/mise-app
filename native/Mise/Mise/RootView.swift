import SwiftUI

struct RootView: View {
    @State private var model = AppModel()
    @State private var l10n = L10n.shared
    /// Модуль из deep-link виджета (mise://<module>), который ждёт авторизации.
    @State private var pendingLink: String?

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
            guard model.phase == .authed, let type = note.object as? String else { return }
            switch type {
            case "com.rahim.mise.openBookings": model.openApp("bookings")
            case "com.rahim.mise.openManager":  model.openApp("manager")
            case "com.rahim.mise.addExpense":   model.openApp("manager") // откроет менеджер, расход — через UI
            default: break
            }
        }
        // Тап по системному пуш-уведомлению (см. PushManager.didReceive response:).
        // userInfo — плоские ключи из data (booking_date/shift_date и т.п., см. lib/apns.ts).
        .onReceive(NotificationCenter.default.publisher(for: .pushTapped)) { note in
            guard model.phase == .authed, let type = note.object as? String else { return }
            var data: [String: String] = [:]
            if let info = note.userInfo {
                for (k, v) in info { if let key = k as? String, let val = v as? String { data[key] = val } }
            }
            model.routeNotification(type: type, data: data)
        }
        .onChange(of: model.phase) { _, phase in
            if phase == .authed, let id = pendingLink {
                pendingLink = nil
                openModule(id)
            }
        }
    }

    private func route(_ url: URL) {
        guard url.scheme == "mise", let host = url.host, !host.isEmpty else { return }
        if model.phase == .authed { openModule(host) } else { pendingLink = host }
    }

    private func openModule(_ id: String) {
        guard model.availableApps.contains(id) else { return }
        model.openApp(id)
    }
}

#Preview {
    RootView()
}
