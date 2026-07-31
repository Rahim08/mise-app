import SwiftUI

@MainActor
@Observable
final class AppModel {
    enum Phase { case loading, welcome, connect, pin, permissions, authed }

    var phase: Phase = .loading {
        didSet {
            // Войдя, регистрируем APNs-токен и привязываем его к ресторану/пользователю.
            if phase == .authed {
                PushManager.shared.registerForPush()
                Task { await loadDayStartHour() }
            }
        }
    }

    /// Во сколько утра у заведения начинаются "новые сутки" (см. day-start-hour-2026-07.sql).
    /// Бронь на 00:00 — dayStartHour используется, чтобы понять: это "поздний вечер вчера"
    /// (заведение работает допоздна) или реально "начало нового дня".
    var dayStartHour: Int = 6
    private struct DayStartRow: Codable { let day_start_hour: Int? }
    func loadDayStartHour() async {
        if let row = try? await DB.from("restaurant_settings").select("day_start_hour").limit(1).list(DayStartRow.self).first,
           let h = row.day_start_hour {
            dayStartHour = h
        }
    }

    /// "Сегодня" операционного дня заведения — до dayStartHour часов утра ещё считается
    /// вчерашними сутками (ночное заведение, юзер-фидбог 2026-07-23: расширили с бейджа
    /// «опаздывает» на кассу дня в Manager/Analytics/виджете — раньше везде была голая
    /// календарная дата, полночь обнуляла ещё не закрытую смену).
    static func businessDate(dayStartHour: Int, from now: Date = Date()) -> Date {
        let cal = Calendar.current
        guard cal.component(.hour, from: now) < dayStartHour else { return now }
        return cal.date(byAdding: .day, value: -1, to: now) ?? now
    }
    var restaurant: Restaurant? {
        didSet { Money.symbol = (restaurant?.currency).flatMap { $0.isEmpty ? nil : $0 } ?? "€" }
    }
    var staff: ResolvedStaff?
    /// Открытое приложение в хабе (nil = показать список доступных приложений).
    var currentApp: String?
    var deviceMismatch = false
    var deviceLimitReached = false
    var scanError: String?   // непустое = показать плашку «Неверный QR» и продолжить скан

    struct ResolvedStaff: Codable, Sendable {
        var id: String
        var name: String
        var apps: [String]
        var isOwner: Bool
        var role: String?
    }

    /// AI доступен: Pro-тариф, купленный AI-аддон (биллинг v2) или ручное включение в админке.
    var aiEnabled: Bool {
        guard let r = restaurant else { return false }
        if r.ai_enabled == true || r.addon_ai == true { return true }
        return r.subscription_plan == "pro"
    }

    /// Видит ли вошедший деньги/выручку (владелец и менеджер — да; кальянщик/официант — нет).
    var canSeeMoney: Bool {
        guard let s = staff else { return true }
        return s.isOwner || s.role == "manager" || s.role == "admin"
    }

    /// Должностное лицо (владелец/управляющий): может редактировать любые брони, ставить цели KPI.
    var isOfficial: Bool {
        guard let s = staff else { return false }
        return s.isOwner || s.role == "manager" || s.role == "admin"
    }

    private let d = UserDefaults.standard

    private var deviceId: String {
        if let s = d.string(forKey: "mise_device_id") { return s }
        let s = "dev_" + UUID().uuidString
        d.set(s, forKey: "mise_device_id")
        return s
    }

    // MARK: запуск

    func start() async {
        API.onUnauthorized = { [weak self] in
            guard let self else { return }
            Task { @MainActor in self.sessionExpired() }
        }
        #if DEBUG
        // Визуальная проверка UI без реального входа: запуск с -MISE_DEMO_UI 1.
        if ProcessInfo.processInfo.environment["MISE_DEMO_UI"] == "1" {
            restaurant = Restaurant(id: "demo", name: "Mise Demo Lounge", logo_url: nil, currency: "€", has_owner_pin: false, subscription_plan: "pro", ai_enabled: true, subscription_status: "active", addon_ai: false, addon_modules: nil, comp_apps: nil, extra_seats: nil, staff_limit: nil, billing_interval: "month", trial_ends_at: nil)
            staff = ResolvedStaff(id: "owner", name: "Владелец",
                                  apps: ["manager", "analytics", "stash", "people"], isOwner: true, role: nil)
            currentApp = ProcessInfo.processInfo.environment["MISE_DEMO_APP"]
            phase = .authed
            // Разовая визуальная проверка ReportExportView.buildPDF() без похода
            // через UI/бэкенд — пишет PDF в Documents, забирается через simctl.
            if ProcessInfo.processInfo.environment["MISE_DEMO_REPORT_PDF"] == "1" {
                let m = ReportModel(rid: "demo")
                if ProcessInfo.processInfo.environment["MISE_DEMO_REPORT_PERIOD"] == "all" { m.periodMode = "all" }
                await m.load()
                let data = ReportModel.renderPDF(m.pdfSnapshot(venueName: restaurant?.name ?? ""))
                if let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first {
                    try? data.write(to: docs.appendingPathComponent("demo-report.pdf"))
                }
            }
            return
        }
        #endif
        if let rData = d.data(forKey: "mise_restaurant"),
           let r = try? JSONDecoder().decode(Restaurant.self, from: rData),
           let sData = d.data(forKey: "mise_staff"),
           let s = try? JSONDecoder().decode(ResolvedStaff.self, from: sData),
           tokenValid() {
            restaurant = r
            staff = s
            // Обновляем restaurant info в фоне: кешированный объект может не иметь
            // новых полей (subscription_plan, ai_enabled), добавленных после первого входа.
            Task { await refreshRestaurant(rid: r.id) }
            // Это повторный вход уже настроенного устройства → после PIN сразу внутрь,
            // НЕ переспрашивать разрешения (их уже выдали при первой настройке).
            isReauth = true
            // По решению: Face ID при каждом запуске; отказ/недоступно → PIN.
            if Biometrics.available {
                let ok = await Biometrics.authenticate(reason: t("faceid.loginReason"))
                phase = ok ? .authed : .pin
            } else {
                phase = .pin
            }
            return
        }
        phase = .welcome
    }

    /// Сервер отверг PIN-сессию, пока клиент считал себя авторизованным (см. API.onUnauthorized).
    /// Возвращаем на PIN, не стирая restaurant/staff — тот же вход, просто заново PIN
    /// (иначе экран остаётся пустым/замороженным, а все ошибки в DB.swift глотаются через `try?`).
    func sessionExpired() {
        guard phase == .authed else { return }
        currentApp = nil
        isReauth = true
        phase = .pin
    }

    private func tokenValid() -> Bool {
        d.double(forKey: "mise_token_until") > Date().timeIntervalSince1970
    }

    private func refreshRestaurant(rid: String) async {
        guard let resp = try? await API.postJSON("/api/auth/restaurant-info",
                                                  body: ["restaurantId": rid],
                                                  as: RestaurantInfoResponse.self),
              let fresh = resp.restaurant else { return }
        restaurant = fresh
        if let data = try? JSONEncoder().encode(fresh) { d.set(data, forKey: "mise_restaurant") }
    }

    // MARK: онбординг

    func goConnect() { phase = .connect }
    func goWelcome() { phase = .welcome }

    func handleScan(_ raw: String) async {
        scanError = nil
        // Только QR Mise: ссылка вида …/join?restaurant=<id>. Иначе — невалидный код.
        guard let comps = URLComponents(string: raw),
              let rid = comps.queryItems?.first(where: { $0.name == "restaurant" })?.value,
              !rid.isEmpty else {
            scanError = t("ob.qrInvalid")
            return
        }
        do {
            let resp = try await API.postJSON("/api/auth/restaurant-info",
                                              body: ["restaurantId": rid],
                                              as: RestaurantInfoResponse.self)
            guard let r = resp.restaurant else { scanError = t("ob.qrInvalid"); return }
            restaurant = r
            phase = .pin
        } catch {
            scanError = t("ob.qrInvalid")
        }
    }

    /// true — PIN верный (перешли дальше); false — неверный (показать тряску).
    func checkPin(_ pin: String) async -> Bool {
        guard let r = restaurant else { return false }
        do {
            let resp = try await API.postJSON("/api/auth/pin/check",
                                              body: ["restaurantId": r.id, "pin": pin, "deviceId": deviceId],
                                              as: PinCheckResponse.self)
            guard resp.match else { return false }
            // Владельцу показываем все модули: сервер для owner возвращает apps
            // ['manager','analytics','stash'] (для скоупинга), но в /api/db owner обходит
            // проверку приложений (authorized → true), поэтому People ему тоже доступен.
            let resolved: ResolvedStaff = (resp.is_owner == true)
                ? .init(id: "owner", name: "Владелец",
                        apps: ["manager", "analytics", "stash", "people"], isOwner: true, role: nil)
                : .init(id: resp.staff?.id ?? "",
                        name: resp.staff?.name ?? "",
                        apps: resp.staff?.apps ?? [], isOwner: false, role: resp.staff?.role)
            staff = resolved
            persist(r, resolved)
            return true
        } catch {
            if case APIError.http(403, let msg) = error {
                if msg == "device_limit_reached" { deviceLimitReached = true }
                else { deviceMismatch = true }
            }
            return false
        }
    }

    private func persist(_ r: Restaurant, _ s: ResolvedStaff) {
        if let rd = try? JSONEncoder().encode(r) { d.set(rd, forKey: "mise_restaurant") }
        if let sd = try? JSONEncoder().encode(s) { d.set(sd, forKey: "mise_staff") }
        // pin/check выставил httpOnly cookie (URLSession хранит его). Дублируем срок — держать
        // в синхроне с TTL_SECONDS в lib/staffToken.ts (сейчас 10 лет, практически бессрочно;
        // выход только по кнопке «Выйти» — юзер-фидбэк 2026-07-31, раньше было 7 дней).
        d.set(Date().addingTimeInterval(60 * 60 * 24 * 365 * 10).timeIntervalSince1970, forKey: "mise_token_until")
    }

    func goPermissions() { phase = .permissions }
    /// mise_device_onboarded переживает истечение mise_token_until (7 дней), logout() и любые
    /// сессии, отвалившиеся без переустановки приложения — юзер-фидбэк: у каждого сотрудника
    /// свой личный телефон (не общее устройство на смену), поэтому экраны Face ID/геолокации/
    /// уведомлений не должны спрашиваться заново на том же устройстве, где разрешения уже
    /// выданы на уровне iOS.
    func finish() { d.set(true, forKey: "mise_device_onboarded"); phase = .authed }

    /// Куда идти после верного PIN: первичная настройка → разрешения; повторный вход
    /// (или устройство уже проходило Permissions раньше) → сразу внутрь.
    var isReauth = false
    func proceedAfterPin() { phase = (isReauth || d.bool(forKey: "mise_device_onboarded")) ? .authed : .permissions }

    // MARK: хаб приложений

    /// Приложения, доступные вошедшему (только те, на которые есть доступ).
    /// Bookings и News доступны всем сотрудникам (брони/лента — общие для команды).
    var availableApps: [String] {
        let order = ["manager", "analytics", "stash", "people"]
        let apps = staff?.apps ?? []
        return order.filter { apps.contains($0) } + ["bookings", "news"]
    }

    func openApp(_ id: String) { currentApp = id }
    func backToLauncher() { currentApp = nil }

    // MARK: журнал уведомлений (глобальный колокольчик — раньше жил только внутри
    // People→Смены, но уведомления бывают о чём угодно, переехал на верхний уровень)

    var notifs: [AppNotification] = []
    var notifsLoaded = false
    var notifsUnread = 0

    private var notifMyId: String { staff?.id ?? "owner" }

    /// Журнал получателя: staff — свои записи, владелец — to_owner.
    func loadNotifications() async {
        var q = DB.from("notifications").select()
        if notifMyId == "owner" || notifMyId.isEmpty { q = q.eq("to_owner", true) }
        else { q = q.eq("staff_id", notifMyId) }
        if let rows = try? await q.order("created_at", ascending: false).limit(50).list(AppNotification.self) {
            notifs = rows
            notifsUnread = rows.filter { $0.read_at == nil }.count
        }
        notifsLoaded = true
    }

    /// Открыл журнал — всё прочитано (как веб-колокольчик).
    func markNotificationsRead() async {
        let unread = notifs.filter { $0.read_at == nil }.map(\.id)
        guard !unread.isEmpty else { return }
        let now = ISO8601DateFormatter().string(from: Date())
        for i in notifs.indices where notifs[i].read_at == nil { notifs[i].read_at = now }
        notifsUnread = 0
        try? await DB.from("notifications").update(["read_at": now]).in("id", unread).run()
    }

    /// Удалить одно уведомление из журнала (свайп).
    func deleteNotification(_ id: String) async {
        let wasUnread = notifs.first { $0.id == id }?.read_at == nil
        notifs.removeAll { $0.id == id }
        if wasUnread { notifsUnread = max(0, notifsUnread - 1) }
        try? await DB.from("notifications").delete().eq("id", id).run()
    }

    /// Очистить весь журнал.
    func clearAllNotifications() async {
        let ids = notifs.map(\.id)
        notifs = []
        notifsUnread = 0
        guard !ids.isEmpty else { return }
        try? await DB.from("notifications").delete().in("id", ids).run()
    }

    // MARK: маршрутизация тапа по уведомлению (в журнале или системном пуше) — открыть
    // нужный модуль и, если это People, нужную вкладку внутри него.

    struct PeopleRoute: Equatable {
        var tab: String
        var shiftsView: String? = nil
        var opsView: String? = nil
        var tasksSeg: String? = nil
        var checklistsSubTab: String? = nil
    }
    /// PeopleView применяет и сбрасывает при создании/смене модели (см. PeopleView.swift).
    var pendingPeopleRoute: PeopleRoute?
    /// BookingsView прыгает на эту дату и сбрасывает (см. BookingsView.swift).
    var pendingBookingsDate: String?
    /// AnalyticsView прыгает на эту смену и сбрасывает (см. AnalyticsView.swift).
    var pendingAnalyticsDate: String?

    /// data — плоские строковые поля из payload уведомления (booking_date, shift_date и т.п.,
    /// см. BookingsView.swift/ManagerView.swift Notify.send). Один и тот же вызов обслуживает
    /// и тап по журналу (данные из AppNotification.data), и тап по системному пушу (из userInfo).
    func routeNotification(type: String, data: [String: String] = [:]) {
        switch type {
        case "cash_close":
            if let d = data["shift_date"], !d.isEmpty { pendingAnalyticsDate = d }
            openApp("analytics")
        case "cash_open", "shift_reminder":
            openApp("manager")
        case "booking":
            if let d = data["booking_date"], !d.isEmpty { pendingBookingsDate = d }
            openApp("bookings")
        case "news":
            openApp("news")
        case "purchase":
            pendingPeopleRoute = PeopleRoute(tab: "purchase"); openApp("people")
        case "swap_request", "swap_result":
            pendingPeopleRoute = PeopleRoute(tab: "shifts", shiftsView: "swaps"); openApp("people")
        case "attendance":
            pendingPeopleRoute = PeopleRoute(tab: "shifts"); openApp("people")
        case "task":
            pendingPeopleRoute = PeopleRoute(tab: "tasks", tasksSeg: "tasks"); openApp("people")
        case "audit", "audit_close_reminder":
            // Д5: флаттенинг — внутренний сегмент снова checklistsSubTab (единая пилюля
            // Смена|Восьмёрка|Аудиты вместо отдельного auditSeg на удалённом уровне Рутина/Аудиты).
            pendingPeopleRoute = PeopleRoute(tab: "shifts", shiftsView: "audit", checklistsSubTab: "audits"); openApp("people")
        default: break
        }
    }

    // MARK: выход

    func logout() {
        d.removeObject(forKey: "mise_restaurant")
        d.removeObject(forKey: "mise_staff")
        d.removeObject(forKey: "mise_token_until")
        if let cookies = HTTPCookieStorage.shared.cookies {
            for c in cookies { HTTPCookieStorage.shared.deleteCookie(c) }
        }
        restaurant = nil
        staff = nil
        currentApp = nil
        isReauth = false
        // mise_device_onboarded НЕ трогаем: у каждого сотрудника свой личный телефон (не
        // общее устройство на смену), поэтому OS-разрешения (Face ID/гео/уведомления) уже
        // выданы этому приложению на этом телефоне и после выхода/повторного входа спрашивать
        // их заново незачем (юзер-фидбэк).
        phase = .welcome
        SnapshotWriter.clear()   // чистим снимок виджета, чтобы не светились старые цифры
        DB.clearCache()   // кеш SELECT-ов не ключуется по ресторану/сессии — иначе следующий
                           // вход (другой ресторан или тот же после сбоя) до 5 минут читает
                           // чужие/пустые данные из CacheStore вместо свежего запроса
    }
}
