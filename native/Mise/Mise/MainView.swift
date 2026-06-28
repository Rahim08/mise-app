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
    "bookings":  .init(id: "bookings",  title: "Bookings",  subtitle: "Брони столов",         symbol: "calendar.badge.clock", color: BrandKit.bookings),
    "news":      .init(id: "news",      title: "News",      subtitle: "Лента и объявления",   symbol: "megaphone.fill",  color: BrandKit.news),
]

/// После входа: хаб со списком доступных приложений. Если приложение одно — сразу в него.
/// Тап по бренду в шапке приложения возвращает к выбору (если приложений несколько).
struct MainView: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        ZStack {
            Color.miseBg.ignoresSafeArea()
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
                Wordmark(size: 24)
                Spacer()
                Button { showSettings = true } label: {
                    Image(systemName: "gearshape.fill")
                        .font(.system(size: 17)).foregroundStyle(.primary.opacity(0.6))
                }
            }
            .padding(.horizontal, 20).padding(.top, 8).padding(.bottom, 4)
            .sheet(isPresented: $showSettings) { SettingsView() }

            VStack(spacing: 4) {
                Text(app.restaurant?.name ?? "")
                    .font(.system(size: 24, weight: .bold)).foregroundStyle(.primary)
                Text(app.staff?.isOwner == true ? t("role.owner") : (app.staff?.name ?? ""))
                    .font(.system(size: 14)).foregroundStyle(.primary.opacity(0.5))
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 20).padding(.top, 18).padding(.bottom, 22)

            ScrollView {
                LazyVGrid(columns: cols, spacing: 14) {
                    ForEach(app.availableApps.compactMap { miseModules[$0] }) { mod in
                        Button {
                            UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                            app.openApp(mod.id)
                        } label: { tile(mod) }
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
                Text(mod.title).font(.system(size: 17, weight: .bold)).foregroundStyle(.primary)
                Text(t("mod.\(mod.id).sub")).font(.system(size: 12)).foregroundStyle(.primary.opacity(0.45))
                    .lineLimit(2, reservesSpace: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 20, style: .continuous))
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
                        Wordmark(size: 19, animated: false, accent: module.color)
                        Text(module.title).font(.system(size: 16, weight: .semibold)).foregroundStyle(.primary.opacity(0.6))
                        if canSwitch {
                            Image(systemName: "chevron.down").font(.system(size: 11, weight: .bold))
                                .foregroundStyle(.primary.opacity(0.4))
                        }
                    }
                }
                .buttonStyle(.plain)
                .disabled(!canSwitch)

                Spacer()

                Button { showSettings = true } label: {
                    Image(systemName: "gearshape.fill").font(.system(size: 15)).foregroundStyle(.primary.opacity(0.45))
                }
                .sheet(isPresented: $showSettings) { SettingsView() }
            }
            .padding(.horizontal, 16).padding(.vertical, 10)
            .background(Color.miseBg)
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
        case "bookings":  BookingsView()
        case "news":      NewsView()
        default:          ComingSoon(module: module)
        }
    }
}

/// Обёртка страницы внутри нижнего TabView: чёрный фон + скролл, контент уходит
/// под нативный таб-бар (liquid glass на iOS 26).
struct AppTabPage<Content: View>: View {
    var refresh: (() async -> Void)? = nil
    @ViewBuilder var content: Content

    @State private var appeared = false

    var body: some View {
        ZStack {
            Color.miseBg.ignoresSafeArea()
            ScrollView {
                VStack(spacing: 12) { content }
                    .padding(16).padding(.bottom, 24)
                    .opacity(appeared ? 1 : 0)
                    .offset(y: appeared ? 0 : 18)
            }
            .scrollDismissesKeyboard(.interactively)
            .refreshable { await refresh?() }
        }
        .onAppear {
            guard !appeared else { return }
            withAnimation(.spring(duration: 0.45, bounce: 0.1)) { appeared = true }
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
                Color.miseBg.ignoresSafeArea()
                List {
                    Section(t("settings.lang")) {
                        ForEach(Lang.ordered, id: \.self) { l in
                            Button { L10n.shared.setLang(l) } label: {
                                HStack {
                                    Text(l.native).foregroundStyle(.primary)
                                    Spacer()
                                    if L10n.shared.lang == l {
                                        Image(systemName: "checkmark").foregroundStyle(BrandKit.analytics)
                                    }
                                }
                            }
                        }
                    }
                    Section(t("settings.theme")) {
                        ForEach(AppTheme.allCases, id: \.self) { th in
                            Button { L10n.shared.theme = th } label: {
                                HStack {
                                    Label(themeLabel(th), systemImage: themeIcon(th))
                                        .foregroundStyle(.primary)
                                    Spacer()
                                    if L10n.shared.theme == th {
                                        Image(systemName: "checkmark").foregroundStyle(BrandKit.analytics)
                                    }
                                }
                            }
                        }
                    }
                    Section {
                        NavigationLink {
                            NotificationSettingsView()
                        } label: {
                            Label(t("pe.nsTitle"), systemImage: "bell.badge")
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
            .toolbarBackground(Color.miseBg, for: .navigationBar)
            .confirmationDialog(t("logout.confirm"), isPresented: $confirmLogout, titleVisibility: .visible) {
                Button(t("logout"), role: .destructive) { app.logout(); dismiss() }
                Button(t("cancel"), role: .cancel) {}
            } message: { Text(t("logout.msg")) }
        }
    }
}

// MARK: - Настройки уведомлений (персональные тумблеры)

private nonisolated struct PrefsBlob: Codable, Sendable {
    var shift_reminder: Bool?; var task: Bool?; var swap: Bool?; var attendance: Bool?
    var cash_open: Bool?; var cash_close: Bool?; var purchase: Bool?
    var show_cash_amount: Bool?; var purchase_digest: String?
    var booking: Bool?; var news: Bool?
}
private nonisolated struct NotifPrefRow: Codable, Identifiable, Sendable { let id: String; let prefs: PrefsBlob? }

struct NotificationSettingsView: View {
    @Environment(AppModel.self) private var app

    @State private var loaded = false
    @State private var rowId: String?
    @State private var shiftReminder = true
    @State private var task = true
    @State private var swap = true
    @State private var attendance = true
    @State private var cashOpen = true
    @State private var cashClose = true
    @State private var purchase = true
    @State private var showCashAmount = false
    @State private var purchaseDigest = "each"
    @State private var booking = true
    @State private var news = true

    private var isManager: Bool { (app.staff?.isOwner ?? false) || app.staff?.role == "manager" }
    private var isOwner: Bool { app.staff?.isOwner ?? false }

    var body: some View {
        ZStack {
            Color.miseBg.ignoresSafeArea()
            Form {
                Section {
                    Toggle(t("pe.nsShiftReminder"), isOn: $shiftReminder).onChange(of: shiftReminder) { _, _ in save() }
                    Toggle(t("pe.nsTask"), isOn: $task).onChange(of: task) { _, _ in save() }
                    Toggle(t("pe.nsSwap"), isOn: $swap).onChange(of: swap) { _, _ in save() }
                    Toggle(t("pe.nsNews"), isOn: $news).onChange(of: news) { _, _ in save() }
                }
                if isManager {
                    Section(t("pe.nsForManagers")) {
                        Toggle(t("pe.nsBooking"), isOn: $booking).onChange(of: booking) { _, _ in save() }
                        Toggle(t("pe.nsAttendance"), isOn: $attendance).onChange(of: attendance) { _, _ in save() }
                        Toggle(t("pe.nsCashOpen"), isOn: $cashOpen).onChange(of: cashOpen) { _, _ in save() }
                        Toggle(t("pe.nsCashClose"), isOn: $cashClose).onChange(of: cashClose) { _, _ in save() }
                        Toggle(t("pe.nsShowAmount"), isOn: $showCashAmount).onChange(of: showCashAmount) { _, _ in save() }
                        Toggle(t("pe.nsPurchase"), isOn: $purchase).onChange(of: purchase) { _, _ in save() }
                        Picker(t("pe.nsPurchaseMode"), selection: $purchaseDigest) {
                            Text(t("pe.nsEach")).tag("each")
                            Text(t("pe.nsDaily")).tag("daily")
                        }.onChange(of: purchaseDigest) { _, _ in save() }
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .tint(PEOPLE_ACCENT_M)
            .disabled(!loaded)
        }
        .navigationTitle(t("pe.nsTitle")).navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(Color.miseBg, for: .navigationBar)
        .task { await load() }
    }

    private func load() async {
        let q = isOwner
            ? DB.from("notification_prefs").select().eq("to_owner", true)
            : DB.from("notification_prefs").select().eq("staff_id", app.staff?.id ?? "")
        let row = (try? await q.limit(1).list(NotifPrefRow.self))?.first
        if let row {
            rowId = row.id
            let p = row.prefs
            shiftReminder = p?.shift_reminder ?? true
            task = p?.task ?? true
            swap = p?.swap ?? true
            attendance = p?.attendance ?? true
            cashOpen = p?.cash_open ?? true
            cashClose = p?.cash_close ?? true
            purchase = p?.purchase ?? true
            showCashAmount = p?.show_cash_amount ?? false
            purchaseDigest = p?.purchase_digest ?? "each"
            booking = p?.booking ?? true
            news = p?.news ?? true
        }
        loaded = true
    }

    private func save() {
        guard loaded else { return }
        let prefs: [String: Any] = [
            "shift_reminder": shiftReminder, "task": task, "swap": swap, "attendance": attendance,
            "cash_open": cashOpen, "cash_close": cashClose, "purchase": purchase,
            "show_cash_amount": showCashAmount, "purchase_digest": purchaseDigest,
            "booking": booking, "news": news,
        ]
        Task {
            if let id = rowId {
                try? await DB.from("notification_prefs").update(["prefs": prefs, "updated_at": ISO8601DateFormatter().string(from: Date())]).eq("id", id).run()
            } else {
                let values: [String: Any] = isOwner ? ["to_owner": true, "prefs": prefs] : ["staff_id": app.staff?.id ?? "", "prefs": prefs]
                if let row = try? await DB.from("notification_prefs").insert(values).single(NotifPrefRow.self) { rowId = row.id }
            }
        }
    }
}

private let PEOPLE_ACCENT_M = BrandKit.people

private func themeLabel(_ th: AppTheme) -> String {
    switch th {
    case .system: return t("theme.system")
    case .dark:   return t("theme.dark")
    case .light:  return t("theme.light")
    }
}
private func themeIcon(_ th: AppTheme) -> String {
    switch th {
    case .system: return "circle.lefthalf.filled"
    case .dark:   return "moon.fill"
    case .light:  return "sun.max.fill"
    }
}

private struct ComingSoon: View {
    let module: MiseModule
    var body: some View {
        ZStack {
            Color.miseBg.ignoresSafeArea()
            VStack(spacing: 14) {
                ZStack {
                    RoundedRectangle(cornerRadius: 22, style: .continuous).fill(module.color.opacity(0.16)).frame(width: 84, height: 84)
                    Image(systemName: module.symbol).font(.system(size: 34)).foregroundStyle(module.color)
                }
                Text("Mise \(module.title)").font(.system(size: 20, weight: .bold)).foregroundStyle(.primary)
                Text(t("comingSoon"))
                    .font(.system(size: 14)).foregroundStyle(.primary.opacity(0.5)).multilineTextAlignment(.center)
            }
            .padding(40)
            .frame(maxHeight: .infinity)
        }
    }
}
