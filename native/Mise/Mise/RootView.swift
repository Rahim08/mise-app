import SwiftUI

struct RootView: View {
    @State private var model = AppModel()

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
        .environment(model)
        .task { await model.start() }
    }
}

#Preview {
    RootView()
}
