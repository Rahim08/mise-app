import SwiftUI

struct RootView: View {
    @State private var model = AppModel()
    @State private var l10n = L10n.shared

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
    }
}

#Preview {
    RootView()
}
