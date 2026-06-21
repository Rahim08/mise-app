import SwiftUI

@MainActor
@Observable
final class AppModel {
    enum Phase { case loading, welcome, connect, pin, permissions, authed }

    var phase: Phase = .loading
    var restaurant: Restaurant? {
        didSet { Money.symbol = (restaurant?.currency).flatMap { $0.isEmpty ? nil : $0 } ?? "€" }
    }
    var staff: ResolvedStaff?
    /// Открытое приложение в хабе (nil = показать список доступных приложений).
    var currentApp: String?
    var deviceMismatch = false
    var deviceLimitReached = false

    struct ResolvedStaff: Codable, Sendable {
        var id: String
        var name: String
        var apps: [String]
        var isOwner: Bool
        var role: String?
    }

    /// AI доступен: Pro-тариф или ручное включение в админке.
    var aiEnabled: Bool {
        guard let r = restaurant else { return false }
        if r.ai_enabled == true { return true }
        return r.subscription_plan == "pro"
    }

    /// Видит ли вошедший деньги/выручку (владелец и менеджер — да; кальянщик/официант — нет).
    var canSeeMoney: Bool {
        guard let s = staff else { return true }
        return s.isOwner || s.role == "manager"
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
        #if DEBUG
        // Визуальная проверка UI без реального входа: запуск с -MISE_DEMO_UI 1.
        if ProcessInfo.processInfo.environment["MISE_DEMO_UI"] == "1" {
            restaurant = Restaurant(id: "demo", name: "Mise Demo Lounge", logo_url: nil, currency: "€", has_owner_pin: false, subscription_plan: "pro", ai_enabled: true)
            staff = ResolvedStaff(id: "owner", name: "Владелец",
                                  apps: ["manager", "analytics", "stash", "people"], isOwner: true, role: nil)
            currentApp = ProcessInfo.processInfo.environment["MISE_DEMO_APP"]
            phase = .authed
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
            // Это повторный вход уже настроенного устройства → после PIN сразу внутрь,
            // НЕ переспрашивать разрешения (их уже выдали при первой настройке).
            isReauth = true
            // По решению: Face ID при каждом запуске; отказ/недоступно → PIN.
            if Biometrics.available {
                let ok = await Biometrics.authenticate(reason: "Вход в Mise")
                phase = ok ? .authed : .pin
            } else {
                phase = .pin
            }
            return
        }
        phase = .welcome
    }

    private func tokenValid() -> Bool {
        d.double(forKey: "mise_token_until") > Date().timeIntervalSince1970
    }

    // MARK: онбординг

    func goConnect() { phase = .connect }
    func goWelcome() { phase = .welcome }

    func handleScan(_ raw: String) async {
        var rid = raw
        if let comps = URLComponents(string: raw),
           let q = comps.queryItems?.first(where: { $0.name == "restaurant" })?.value {
            rid = q
        }
        do {
            let resp = try await API.postJSON("/api/auth/restaurant-info",
                                              body: ["restaurantId": rid],
                                              as: RestaurantInfoResponse.self)
            guard let r = resp.restaurant else { return }
            restaurant = r
            phase = .pin
        } catch {
            // остаёмся на экране скана
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
        // pin/check выставил httpOnly cookie (URLSession хранит его). Дублируем срок ~30 дней.
        d.set(Date().addingTimeInterval(30 * 24 * 3600).timeIntervalSince1970, forKey: "mise_token_until")
    }

    func goPermissions() { phase = .permissions }
    func finish() { phase = .authed }

    /// Куда идти после верного PIN: первичная настройка → разрешения; повторный вход → сразу внутрь.
    var isReauth = false
    func proceedAfterPin() { phase = isReauth ? .authed : .permissions }

    // MARK: хаб приложений

    /// Приложения, доступные вошедшему (только те, на которые есть доступ).
    var availableApps: [String] {
        let order = ["manager", "analytics", "stash", "people"]
        let apps = staff?.apps ?? []
        return order.filter { apps.contains($0) }
    }

    func openApp(_ id: String) { currentApp = id }
    func backToLauncher() { currentApp = nil }

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
        phase = .welcome
    }
}
