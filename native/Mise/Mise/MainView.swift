import SwiftUI

// Каталог модулей сьюта.
struct MiseModule: Identifiable {
    let id: String
    let title: String
    let subtitle: String
    let symbol: String
    let color: Color
}

let miseModules: [String: MiseModule] = [
    "manager":   .init(id: "manager",   title: "Manager",   subtitle: "Смены и касса",        symbol: "creditcard.fill", color: BrandKit.manager),
    "analytics": .init(id: "analytics", title: "Analytics", subtitle: "Выручка и аналитика",  symbol: "chart.bar.fill",  color: BrandKit.analytics),
    "stash":     .init(id: "stash",     title: "Stash",     subtitle: "Склад и кальян",       symbol: "shippingbox.fill", color: BrandKit.stash),
    "people":    .init(id: "people",    title: "People",    subtitle: "Команда и расписание", symbol: "person.2.fill",    color: BrandKit.people),
]

/// После входа: хаб со списком доступных приложений. Если приложение одно — сразу в него.
/// Тап по бренду в шапке приложения возвращает к выбору (если приложений несколько).
struct MainView: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            if let id = app.currentApp, let mod = miseModules[id] {
                AppContainer(module: mod)
                    .transition(.opacity)
            } else {
                LauncherView()
                    .transition(.opacity)
            }
        }
        .preferredColorScheme(.dark)
        .animation(.easeInOut(duration: 0.22), value: app.currentApp)
        .onAppear {
            // Одно доступное приложение → открываем сразу, без промежуточного экрана.
            if app.currentApp == nil, app.availableApps.count == 1 {
                app.currentApp = app.availableApps.first
            }
        }
    }
}

// MARK: - Хаб выбора приложения

private struct LauncherView: View {
    @Environment(AppModel.self) private var app

    private let cols = [GridItem(.flexible(), spacing: 14), GridItem(.flexible(), spacing: 14)]
    @State private var showSettings = false

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Wordmark(size: 24, color: .white)
                Spacer()
                Button { showSettings = true } label: {
                    Image(systemName: "gearshape.fill")
                        .font(.system(size: 17)).foregroundStyle(.white.opacity(0.6))
                }
            }
            .padding(.horizontal, 20).padding(.top, 8).padding(.bottom, 4)
            .sheet(isPresented: $showSettings) { SettingsView() }

            VStack(spacing: 4) {
                Text(app.restaurant?.name ?? "")
                    .font(.system(size: 24, weight: .bold)).foregroundStyle(.white)
                Text(app.staff?.isOwner == true ? t("role.owner") : (app.staff?.name ?? ""))
                    .font(.system(size: 14)).foregroundStyle(.white.opacity(0.5))
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 20).padding(.top, 18).padding(.bottom, 22)

            ScrollView {
                LazyVGrid(columns: cols, spacing: 14) {
                    ForEach(app.availableApps.compactMap { miseModules[$0] }) { mod in
                        Button { app.openApp(mod.id) } label: { tile(mod) }
                            .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 20)
            }
            Spacer(minLength: 0)
        }
    }

    private func tile(_ mod: MiseModule) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            ZStack {
                RoundedRectangle(cornerRadius: 16, style: .continuous).fill(mod.color.opacity(0.18))
                    .frame(width: 54, height: 54)
                Image(systemName: mod.symbol).font(.system(size: 24)).foregroundStyle(mod.color)
            }
            VStack(alignment: .leading, spacing: 3) {
                Text(mod.title).font(.system(size: 17, weight: .bold)).foregroundStyle(.white)
                Text(t("mod.\(mod.id).sub")).font(.system(size: 12)).foregroundStyle(.white.opacity(0.45))
                    .lineLimit(2, reservesSpace: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 20, style: .continuous))
    }
}

// MARK: - Контейнер приложения (шапка + тело)

private struct AppContainer: View {
    @Environment(AppModel.self) private var app
    let module: MiseModule

    private var canSwitch: Bool { app.availableApps.count > 1 }
    @State private var showSettings = false

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                Button {
                    if canSwitch { app.backToLauncher() }
                } label: {
                    HStack(spacing: 6) {
                        Wordmark(size: 19, color: .white, animated: false, accent: module.color)
                        Text(module.title).font(.system(size: 16, weight: .semibold)).foregroundStyle(.white.opacity(0.6))
                        if canSwitch {
                            Image(systemName: "chevron.down").font(.system(size: 11, weight: .bold))
                                .foregroundStyle(.white.opacity(0.4))
                        }
                    }
                }
                .buttonStyle(.plain)
                .disabled(!canSwitch)

                Spacer()

                Button { showSettings = true } label: {
                    Image(systemName: "gearshape.fill").font(.system(size: 15)).foregroundStyle(.white.opacity(0.45))
                }
                .sheet(isPresented: $showSettings) { SettingsView() }
            }
            .padding(.horizontal, 16).padding(.vertical, 10)
            .background(Color.black)
            .overlay(alignment: .bottom) { Rectangle().fill(.white.opacity(0.08)).frame(height: 0.5) }

            body(for: module.id)
        }
    }

    @ViewBuilder private func body(for id: String) -> some View {
        switch id {
        case "manager":   ManagerView()
        case "stash":     StashView()
        case "analytics": AnalyticsView()
        case "people":    PeopleView()
        default:          ComingSoon(module: module)
        }
    }
}

/// Обёртка страницы внутри нижнего TabView: чёрный фон + скролл, контент уходит
/// под нативный таб-бар (liquid glass на iOS 26).
struct AppTabPage<Content: View>: View {
    var refresh: (() async -> Void)? = nil
    @ViewBuilder var content: Content

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            ScrollView {
                VStack(spacing: 12) { content }
                    .padding(16).padding(.bottom, 24)
            }
            .scrollDismissesKeyboard(.interactively)
            .refreshable { await refresh?() }
        }
    }
}

// MARK: - Настройки (язык + выход)

struct SettingsView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var confirmLogout = false

    var body: some View {
        NavigationStack {
            ZStack {
                Color.black.ignoresSafeArea()
                List {
                    Section(t("settings.lang")) {
                        ForEach(Lang.allCases, id: \.self) { l in
                            Button { L10n.shared.setLang(l) } label: {
                                HStack {
                                    Text(l.native).foregroundStyle(.white)
                                    Spacer()
                                    if L10n.shared.lang == l {
                                        Image(systemName: "checkmark").foregroundStyle(BrandKit.analytics)
                                    }
                                }
                            }
                        }
                    }
                    Section {
                        Button(role: .destructive) { confirmLogout = true } label: {
                            Label(t("logout"), systemImage: "rectangle.portrait.and.arrow.right")
                        }
                    }
                }
                .scrollContentBackground(.hidden)
            }
            .navigationTitle(t("settings")).navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button(t("done")) { dismiss() } } }
            .toolbarBackground(.black, for: .navigationBar)
            .preferredColorScheme(.dark)
            .confirmationDialog(t("logout.confirm"), isPresented: $confirmLogout, titleVisibility: .visible) {
                Button(t("logout"), role: .destructive) { app.logout(); dismiss() }
                Button(t("cancel"), role: .cancel) {}
            } message: { Text(t("logout.msg")) }
        }
    }
}

private struct ComingSoon: View {
    let module: MiseModule
    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            VStack(spacing: 14) {
                ZStack {
                    RoundedRectangle(cornerRadius: 22, style: .continuous).fill(module.color.opacity(0.16)).frame(width: 84, height: 84)
                    Image(systemName: module.symbol).font(.system(size: 34)).foregroundStyle(module.color)
                }
                Text("Mise \(module.title)").font(.system(size: 20, weight: .bold)).foregroundStyle(.white)
                Text("Модуль скоро появится в нативной версии")
                    .font(.system(size: 14)).foregroundStyle(.white.opacity(0.5)).multilineTextAlignment(.center)
            }
            .padding(40)
            .frame(maxHeight: .infinity)
        }
    }
}
