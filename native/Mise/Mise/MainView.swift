import SwiftUI

// Каталог модулей сьюта.
// Сабтайтл НЕ хранится здесь — рендерится через t("mod.<id>.sub") на языке пользователя.
struct MiseModule: Identifiable {
    let id: String
    let title: String
    let symbol: String
    let color: Color
}

let miseModules: [String: MiseModule] = [
    "manager":   .init(id: "manager",   title: "Manager",   symbol: "creditcard.fill", color: BrandKit.manager),
    "analytics": .init(id: "analytics", title: "Analytics", symbol: "chart.bar.fill",  color: BrandKit.analytics),
    "stash":     .init(id: "stash",     title: "Stash",     symbol: "shippingbox.fill", color: BrandKit.stash),
    "people":    .init(id: "people",    title: "People",    symbol: "person.2.fill",    color: BrandKit.people),
    "bookings":  .init(id: "bookings",  title: "Bookings",  symbol: "calendar.badge.clock", color: BrandKit.bookings),
    "news":      .init(id: "news",      title: "News",      symbol: "megaphone.fill",  color: BrandKit.news),
]

/// После входа: хаб со списком доступных приложений. Если приложение одно — сразу в него.
/// Тап по бренду в шапке приложения возвращает к выбору (если приложений несколько).
struct MainView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.scenePhase) private var scenePhase

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
        .animation(.easeInOut(duration: 0.22), value: app.currentApp)
        .onAppear {
            // Одно доступное приложение → открываем сразу, без промежуточного экрана.
            if app.currentApp == nil, app.availableApps.count == 1 {
                app.currentApp = app.availableApps.first
            }
        }
        // Снимок для виджета: считаем при входе и при возврате на передний план.
        .task {
            await SnapshotWriter.refresh(canSeeMoney: app.canSeeMoney, dayStartHour: app.dayStartHour)
            if !app.notifsLoaded { await app.loadNotifications() }
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active {
                PushManager.shared.reuploadIfPossible()
                Task {
                    await SnapshotWriter.refresh(canSeeMoney: app.canSeeMoney, dayStartHour: app.dayStartHour, force: true)
                }
            }
        }
    }
}

// MARK: - Хаб выбора приложения

private struct LauncherView: View {
    @Environment(AppModel.self) private var app

    @State private var showSettings = false
    @State private var editing = false
    @State private var showEditHint = !UserDefaults.standard.bool(forKey: "mise_hub_edit_hint_seen")

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Wordmark(size: 24)
                Spacer()
                if editing {
                    Button(t("done")) {
                        withAnimation(.spring(response: 0.3, dampingFraction: 0.8)) { editing = false }
                    }
                    .font(.system(size: 15, weight: .semibold))
                } else {
                    NotificationBell()
                    Button { showSettings = true } label: {
                        Image(systemName: "gearshape.fill")
                            .font(.system(size: 17)).foregroundStyle(.primary.opacity(0.6))
                    }
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
            .padding(.horizontal, 20).padding(.top, 18).padding(.bottom, 14)

            if showEditHint {
                Text(t("hub.editHint"))
                    .font(.system(size: 12)).foregroundStyle(.primary.opacity(0.4))
                    .padding(.horizontal, 20).padding(.bottom, 10)
                    .transition(.opacity)
            }

            HubGridView(editing: $editing)
        }
        .onChange(of: editing) { _, now in
            guard now, showEditHint else { return }
            UserDefaults.standard.set(true, forKey: "mise_hub_edit_hint_seen")
            withAnimation { showEditHint = false }
        }
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

                NotificationBell()
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

// MARK: - Глобальный колокольчик уведомлений
//
// Раньше жил только внутри People→Смены (ревью Г2) — но уведомления бывают о чём угодно
// (брони, аудиты, задачи, касса), поэтому теперь виден в шапке ЛЮБОГО модуля и хаба.
// Тап по строке — маршрутизация в нужный модуль/вкладку (AppModel.routeNotification).

private struct NotificationBell: View {
    @Environment(AppModel.self) private var app
    @State private var showNotifs = false

    var body: some View {
        Button { showNotifs = true } label: {
            ZStack(alignment: .topTrailing) {
                Image(systemName: "bell").font(.system(size: 15)).foregroundStyle(.primary.opacity(0.45))
                if app.notifsUnread > 0 {
                    Circle().fill(BrandKit.menu).frame(width: 7, height: 7).offset(x: 3, y: -2)
                }
            }
        }
        .buttonStyle(.plain)
        .padding(.trailing, 4)
        .sheet(isPresented: $showNotifs) { NotificationsSheet() }
    }
}

private struct NotificationsSheet: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var confirmClearAll = false

    var body: some View {
        NavigationStack {
            ZStack {
                Color.miseBg.ignoresSafeArea()
                if !app.notifsLoaded {
                    RowListSkeleton(rows: 4)
                } else if app.notifs.isEmpty {
                    VStack(spacing: 12) {
                        Image(systemName: "bell").font(.system(size: 34)).foregroundStyle(.primary.opacity(0.3))
                        Text(t("pe.noNotifs")).font(.system(size: 15)).foregroundStyle(.primary.opacity(0.4))
                        Text(t("pe.noNotifsHint")).font(.system(size: 13)).foregroundStyle(.primary.opacity(0.3)).multilineTextAlignment(.center).padding(.horizontal, 30)
                    }
                } else {
                    ScrollView {
                        VStack(spacing: 8) {
                            ForEach(app.notifs) { n in row(n) }
                        }
                        .padding(16)
                    }
                }
            }
            .navigationTitle(t("pe.notifications"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(Color.miseBg, for: .navigationBar)
            .toolbar {
                if !app.notifs.isEmpty {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button(t("pe.clearAllNotifs")) { confirmClearAll = true }
                            .font(.system(size: 13, weight: .semibold))
                    }
                }
            }
            .confirmationDialog(t("pe.clearAllNotifsConfirm"), isPresented: $confirmClearAll, titleVisibility: .visible) {
                Button(t("pe.clearAllNotifs"), role: .destructive) { Task { await app.clearAllNotifications() } }
                Button(t("cancel"), role: .cancel) {}
            }
        }
        .task {
            if !app.notifsLoaded { await app.loadNotifications() }
            await app.markNotificationsRead()
        }
    }

    private func row(_ n: AppNotification) -> some View {
        SwipeActionRow(trailing: [
            SwipeAction(label: t("bk.delete"), systemImage: "trash.fill", tint: BrandKit.menu) {
                Task { await app.deleteNotification(n.id) }
            },
        ], onTap: {
            dismiss()
            if let type = n.type {
                var data: [String: String] = [:]
                for (k, v) in n.data ?? [:] { data[k] = v.text }
                app.routeNotification(type: type, data: data)
            }
        }) {
            HStack(alignment: .top, spacing: 12) {
                Circle().fill(n.read_at == nil ? BrandKit.people : Color.clear).frame(width: 8, height: 8).padding(.top, 5)
                VStack(alignment: .leading, spacing: 3) {
                    Text(notifTitle(n)).font(.system(size: 15, weight: .semibold)).foregroundStyle(.primary)
                    if let body = notifBody(n), !body.isEmpty {
                        Text(body).font(.system(size: 13)).foregroundStyle(.primary.opacity(0.55))
                    }
                    Text(notifDate(n.created_at)).font(.system(size: 11)).foregroundStyle(.primary.opacity(0.35))
                }
                Spacer(minLength: 0)
            }
            .padding(14)
            .background(Color.primary.opacity(0.05), in: RoundedRectangle(cornerRadius: 14))
        }
    }

    private func notifDate(_ iso: String?) -> String {
        guard let iso else { return "" }
        let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let f2 = ISO8601DateFormatter()
        guard let d = f.date(from: iso) ?? f2.date(from: iso) else { return "" }
        let out = DateFormatter(); out.locale = appLocale(); out.dateFormat = "dd.MM · HH:mm"
        return out.string(from: d)
    }
}

/// Обёртка страницы внутри нижнего TabView: чёрный фон + скролл, контент уходит
/// под нативный таб-бар (liquid glass на iOS 26).
struct AppTabPage<Content: View>: View {
    var refresh: (() async -> Void)? = nil
    // Не-nil только там, где нужен сброс скролла к началу при каждом переключении
    // вкладки (см. AnalyticsView) — прочие вызовы оставляют nil и поведение не меняется,
    // т.к. onChange никогда не срабатывает на переходе nil → nil.
    var scrollResetKey: String? = nil
    @ViewBuilder var content: Content

    @State private var appeared = false

    var body: some View {
        ZStack {
            Color.miseBg.ignoresSafeArea()
            ScrollViewReader { proxy in
                ScrollView {
                    VStack(spacing: 12) { content }
                        .padding(16).padding(.bottom, 24)
                        .opacity(appeared ? 1 : 0)
                        .offset(y: appeared ? 0 : 18)
                        .id("top")
                }
                .scrollDismissesKeyboard(.interactively)
                .refreshable {
                    // Обойти свежий кеш: иначе pull-to-refresh отдаёт те же данные (см. DB.clearCacheNow).
                    if refresh != nil { await DB.clearCacheNow() }
                    await refresh?()
                }
                .onChange(of: scrollResetKey) { _, _ in proxy.scrollTo("top", anchor: .top) }
            }
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
                    // Операционный день заведения (владелец/менеджер) — во сколько утра
                    // начинаются "новые сутки". Бронь на 00:00-05:59 понимается как поздний
                    // вечер вчера, не начало нового дня — влияет на авто-«опаздывает» в брони.
                    if app.isOfficial {
                        Section {
                            dayStartStepper
                        } header: {
                            Text(t("settings.dayStart"))
                        } footer: {
                            Text(t("settings.dayStartHint")).font(.system(size: 12)).foregroundStyle(.primary.opacity(0.4))
                        }
                    }
                    Section {
                        NavigationLink {
                            NotificationSettingsView()
                        } label: {
                            Label(t("pe.nsTitle"), systemImage: "bell.badge")
                        }
                        NavigationLink {
                            ReportExportView()
                        } label: {
                            Label(t("rp.title"), systemImage: "doc.richtext")
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
                // logout() стал async: отписка от пушей должна успеть уйти на сервер,
                // пока cookie PIN-сессии ещё не стёрта.
                Button(t("logout"), role: .destructive) { Task { await app.logout() }; dismiss() }
                Button(t("cancel"), role: .cancel) {}
            } message: { Text(t("logout.msg")) }
        }
        // Sheet — отдельный контекст презентации: применяем тему явно, чтобы
        // переключатель темы менял и сам экран настроек вживую.
        .preferredColorScheme(L10n.shared.colorScheme)
    }

    private var dayStartHourBinding: Binding<Int> {
        Binding(
            get: { app.dayStartHour },
            set: { newVal in
                app.dayStartHour = newVal
                Task { try? await DB.from("restaurant_settings").update(["day_start_hour": newVal]).run() }
            }
        )
    }
    private var dayStartStepper: some View {
        let label = t("settings.dayStartValue", ["h": String(format: "%02d:00", app.dayStartHour)])
        return Stepper(label, value: dayStartHourBinding, in: 0...11)
    }
}

// MARK: - Настройки уведомлений (персональные тумблеры)

private nonisolated struct PrefsBlob: Codable, Sendable {
    var shift_reminder: Bool?; var task: Bool?; var swap: Bool?; var attendance: Bool?
    var cash_open: Bool?; var cash_close: Bool?; var purchase: Bool?; var salary_payout: Bool?
    var show_cash_amount: Bool?; var purchase_digest: String?
    var booking: Bool?; var news: Bool?
    var low_stock: Bool?; var voice_tasks: Bool?
}
private nonisolated struct NotifPrefRow: Codable, Identifiable, Sendable { let id: String; let prefs: PrefsBlob? }

struct NotificationSettingsView: View {
    @Environment(AppModel.self) private var app

    @State private var loaded = false
    @State private var saving = false
    /// Тумблер щёлкнули, пока предыдущее сохранение ещё в полёте — сохранить ещё раз
    /// по завершении. Раньше такое изменение просто выбрасывалось (guard !saving), и
    /// второй быстрый тумблер не доезжал ни до сервера, ни до зеркала в UserDefaults.
    @State private var saveAgain = false
    @State private var rowId: String?
    @State private var shiftReminder = true
    @State private var task = true
    @State private var swap = true
    @State private var attendance = true
    @State private var cashOpen = true
    @State private var cashClose = true
    @State private var salaryPayout = true
    @State private var purchase = true
    @State private var showCashAmount = false
    @State private var purchaseDigest = "each"
    @State private var booking = true
    @State private var news = true
    @State private var lowStock = true
    @State private var voiceTasks = true

    private var isManager: Bool { (app.staff?.isOwner ?? false) || app.staff?.role == "manager" || app.staff?.role == "admin" }
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
                    Toggle(t("ns.lowStock"), isOn: $lowStock).onChange(of: lowStock) { _, _ in save() }
                    Toggle(t("ns.voiceTasks"), isOn: $voiceTasks).onChange(of: voiceTasks) { _, _ in save() }
                }
                if isManager {
                    Section(t("pe.nsForManagers")) {
                        Toggle(t("pe.nsBooking"), isOn: $booking).onChange(of: booking) { _, _ in save() }
                        Toggle(t("pe.nsAttendance"), isOn: $attendance).onChange(of: attendance) { _, _ in save() }
                        Toggle(t("pe.nsCashOpen"), isOn: $cashOpen).onChange(of: cashOpen) { _, _ in save() }
                        Toggle(t("pe.nsCashClose"), isOn: $cashClose).onChange(of: cashClose) { _, _ in save() }
                        Toggle(t("pe.nsSalaryPayout"), isOn: $salaryPayout).onChange(of: salaryPayout) { _, _ in save() }
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
            salaryPayout = p?.salary_payout ?? true
            purchase = p?.purchase ?? true
            showCashAmount = p?.show_cash_amount ?? false
            purchaseDigest = p?.purchase_digest ?? "each"
            booking = p?.booking ?? true
            news = p?.news ?? true
            lowStock = p?.low_stock ?? true
            voiceTasks = p?.voice_tasks ?? true
        }
        loaded = true
    }

    private func save() {
        guard loaded else { return }
        // Коалесценция последнего значения: пока идёт запись, новые щелчки не теряются —
        // после её завершения сохраняем АКТУАЛЬНОЕ состояние тумблеров ещё раз.
        guard !saving else { saveAgain = true; return }
        saving = true
        let prefs: [String: Any] = [
            "shift_reminder": shiftReminder, "task": task, "swap": swap, "attendance": attendance,
            "cash_open": cashOpen, "cash_close": cashClose, "salary_payout": salaryPayout, "purchase": purchase,
            "show_cash_amount": showCashAmount, "purchase_digest": purchaseDigest,
            "booking": booking, "news": news,
            "low_stock": lowStock, "voice_tasks": voiceTasks,
        ]
        // Зеркало в UserDefaults — локальные читатели без похода в БД (Push.isEnabled:
        // shift_reminder; StashView.checkLowStock: low_stock). Только Bool-значения:
        // читатели кастят словарь как [String: Bool], строковый purchase_digest сломал бы каст.
        UserDefaults.standard.set(prefs.filter { $0.value is Bool }, forKey: "mise_notif_prefs")
        Task {
            if let id = rowId {
                try? await DB.from("notification_prefs").update(["prefs": prefs, "updated_at": ISO8601DateFormatter().string(from: Date())]).eq("id", id).run()
            } else {
                let values: [String: Any] = isOwner ? ["to_owner": true, "prefs": prefs] : ["staff_id": app.staff?.id ?? "", "prefs": prefs]
                if let row = try? await DB.from("notification_prefs").insert(values).single(NotifPrefRow.self) { rowId = row.id }
            }
            saving = false
            if saveAgain { saveAgain = false; save() }
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
