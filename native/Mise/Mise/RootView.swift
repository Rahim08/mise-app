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
        // Deep-link из виджета: mise://analytics | mise://stash | mise://bookings.
        .onOpenURL { url in route(url) }
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
