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

/// Нативный клиент к существующему серверному API (misesuite.com/api/*).
/// Бэкенд, авторизация и бизнес-логика не переписываются — переиспользуются.
/// URLSession сам хранит и переотправляет cookie-токен (PIN-сессия).
enum API {
    static let base = "https://www.misesuite.com"

    static func postJSON<T: Decodable>(_ path: String, body: [String: String], as type: T.Type) async throws -> T {
        guard let url = URL(string: base + path) else { throw APIError.badURL }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, resp) = try await URLSession.shared.data(for: req)
        guard let http = resp as? HTTPURLResponse else { throw APIError.http(-1, nil) }
        guard (200..<300).contains(http.statusCode) else { throw APIError.http(http.statusCode, serverMessage(data)) }
        do { return try JSONDecoder().decode(T.self, from: data) }
        catch { throw APIError.decode }
    }

    /// Достаёт текст ошибки из тела ответа `{ error: "..." }`.
    private static func serverMessage(_ data: Data) -> String? {
        struct E: Decodable { let error: String? }
        return try? JSONDecoder().decode(E.self, from: data).error
    }

    /// Низкоуровневый запрос к шлюзу данных `/api/db` (см. DB.swift).
    /// Принимает произвольный JSON-payload, возвращает сырое тело ответа `{ data: ... }`.
    static func dbRequest(_ payload: [String: Any]) async throws -> Data {
        guard let url = URL(string: base + "/api/db") else { throw APIError.badURL }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: payload)
        let (data, resp) = try await URLSession.shared.data(for: req)
        guard let http = resp as? HTTPURLResponse else { throw APIError.http(-1, nil) }
        guard (200..<300).contains(http.statusCode) else { throw APIError.http(http.statusCode, serverMessage(data)) }
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
