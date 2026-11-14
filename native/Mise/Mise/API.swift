import Foundation

enum APIError: Error, LocalizedError {
    case http(Int, String?), decode, badURL
    var errorDescription: String? {
        switch self {
        case .http(let code, let msg): return msg ?? "ошибка сервера (\(code))"
        case .decode: return "не удалось прочитать ответ"
        case .badURL: return "неверный адрес"
        }
    }
}

/// Человеческий текст ошибки для AI-советника. Без интернета URLSession кидает голый
/// системный текст («A TLS error caused the secure connection to fail») — непрофессионально
/// показывать это как есть, подменяем на понятное «нет соединения».
@MainActor func aiErrorMessage(_ error: Error) -> String {
    if let apiErr = error as? APIError {
        switch apiErr {
        case .http(401, _): return t("ai.err401")
        case .http(403, _): return t("ai.err403")
        case .http(500, _): return t("ai.err500")
        case .http(502, _): return t("ai.err502")
        default: break
        }
    }
    let ns = error as NSError
    if ns.domain == NSURLErrorDomain { return t("ai.errOffline") }
    return "\(t("ai.errGeneric")): \(error.localizedDescription)"
}

/// Нативный клиент к существующему серверному API (misesuite.com/api/*).
/// Бэкенд, авторизация и бизнес-логика не переписываются — переиспользуются.
/// URLSession сам хранит и переотправляет cookie-токен (PIN-сессия).
private struct PeopleWrap<T: Decodable>: Decodable { let data: T? }

enum API {
    static let base = "https://www.misesuite.com"

    // UI fixtures are strictly offline, including background reads by child views.
    private static func requireLiveTransport() throws {
        #if DEBUG
        if ProcessInfo.processInfo.environment["MISE_DEMO_UI"] == "1" {
            throw APIError.http(-1009, nil)
        }
        #endif
    }

    /// Сервер отверг PIN-сессию (истёкший/невалидный cookie), пока клиент считал себя
    /// авторизованным (кэш в UserDefaults ещё "валиден"). Без этого хука экран остаётся
    /// пустым/замороженным — все ошибки в DB.swift глотаются через `try?`. AppModel
    /// подписывается в start() и возвращает на PIN вместо мёртвого экрана.
    static var onUnauthorized: (@Sendable () -> Void)?

    private static func checkAuth(_ code: Int) {
        if code == 401 { onUnauthorized?() }
    }

    static func postJSON<T: Decodable>(_ path: String, body: [String: String], as type: T.Type) async throws -> T {
        try requireLiveTransport()
        guard let url = URL(string: base + path) else { throw APIError.badURL }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, resp) = try await MiseSharedSession.session.data(for: req)
        guard let http = resp as? HTTPURLResponse else { throw APIError.http(-1, nil) }
        guard (200..<300).contains(http.statusCode) else { throw APIError.http(http.statusCode, serverMessage(data)) }
        do { return try JSONDecoder().decode(T.self, from: data) }
        catch { throw APIError.decode }
    }

    /// JSON-запрос к People-эндпоинтам (/api/people/*): произвольное тело, ответ `{ data }`
    /// декодируется в T. Та же PIN-сессия, что у /api/db (MiseSharedSession).
    static func people<T: Decodable>(_ path: String, method: String = "POST", body: [String: Any]? = nil, as type: T.Type) async throws -> T? {
        try requireLiveTransport()
        guard let url = URL(string: base + path) else { throw APIError.badURL }
        var req = URLRequest(url: url)
        req.httpMethod = method
        req.cachePolicy = .reloadIgnoringLocalCacheData
        if let body {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        let (data, resp) = try await MiseSharedSession.session.data(for: req)
        guard let http = resp as? HTTPURLResponse else { throw APIError.http(-1, nil) }
        guard (200..<300).contains(http.statusCode) else {
            checkAuth(http.statusCode)
            throw APIError.http(http.statusCode, serverMessage(data))
        }
        do { return try JSONDecoder().decode(PeopleWrap<T>.self, from: data).data }
        catch { throw APIError.decode }
    }

    /// Достаёт текст ошибки из тела ответа `{ error: "..." }`.
    private static func serverMessage(_ data: Data) -> String? {
        struct E: Decodable { let error: String? }
        return try? JSONDecoder().decode(E.self, from: data).error
    }

    /// Запрос к AI-эндпоинту. Возвращает сырой словарь для разбора вызывающей стороной.
    static func aiChat(module: String, message: String, context: String = "") async throws -> [String: Any] {
        try requireLiveTransport()
        guard let url = URL(string: base + "/api/ai") else { throw APIError.badURL }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let body: [String: Any] = [
            "module": module,
            "message": message,
            "context": context,
            "lang": L10n.shared.lang.rawValue,
        ]
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, resp) = try await MiseSharedSession.session.data(for: req)
        guard let http = resp as? HTTPURLResponse else { throw APIError.http(-1, nil) }
        guard (200..<300).contains(http.statusCode) else { throw APIError.http(http.statusCode, serverMessage(data)) }
        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw APIError.decode }
        return json
    }

    /// Низкоуровневый запрос к шлюзу данных `/api/db` (см. DB.swift).
    /// Принимает произвольный JSON-payload, возвращает сырое тело ответа `{ data: ... }`.
    static func dbRequest(_ payload: [String: Any]) async throws -> Data {
        #if DEBUG
        if ShiftSaveFixture.enabled { return try await ShiftSaveFixture.request(payload) }
        if StashSaveFixture.enabled { return try await StashSaveFixture.request(payload) }
        if AdvanceSaveFixture.enabled { return try await AdvanceSaveFixture.request(payload) }
        #endif
        try requireLiveTransport()
        guard let url = URL(string: base + "/api/db") else { throw APIError.badURL }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: payload)
        let (data, resp) = try await MiseSharedSession.session.data(for: req)
        guard let http = resp as? HTTPURLResponse else { throw APIError.http(-1, nil) }
        guard (200..<300).contains(http.statusCode) else {
            checkAuth(http.statusCode)
            throw APIError.http(http.statusCode, serverMessage(data))
        }
        return data
    }
}

// MARK: - DTO

struct Restaurant: Codable, Identifiable, Sendable {
    let id: String
    let name: String
    let logo_url: String?
    var currency: String?
    let has_owner_pin: Bool?
    let subscription_plan: String?
    let ai_enabled: Bool?
    // Биллинг v2 (веб уже читает через lib/plans.ts entitlements()) — без этих полей
    // iOS не видит купленный AI-аддон и статус триала/отмены подписки.
    let subscription_status: String?
    let addon_ai: Bool?
    let addon_modules: [String]?
    let comp_apps: [String]?
    let extra_seats: Int?
    let staff_limit: Int?
    let billing_interval: String?
    let trial_ends_at: String?
}

struct RestaurantInfoResponse: Codable, Sendable {
    let restaurant: Restaurant?
}

struct StaffDTO: Codable, Sendable {
    let id: String?
    let name: String?
    let apps: [String]?
    let role: String?
}

struct PinCheckResponse: Codable, Sendable {
    let match: Bool
    let is_owner: Bool?
    let apps: [String]?
    let staff: StaffDTO?
}

// MARK: - Банк (Open Banking)

struct BankInstitutionDTO: Codable, Sendable, Identifiable {
    let name: String
    let country: String
    var id: String { "\(name)-\(country)" }
}
struct BankConnectResponse: Codable, Sendable {
    let link: String?
    let institutions: [BankInstitutionDTO]?
    let error: String?
}
struct BankSyncResponse: Codable, Sendable {
    let ok: Bool?
    let throttled: Bool?
    let error: String?
}
