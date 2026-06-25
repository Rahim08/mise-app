import Foundation

/// Нативный построитель запросов к шлюзу `/api/db` — зеркало веб-клиента `lib/db.ts`.
/// Аутентификация через cookie-токен PIN-сессии (URLSession хранит его сам).
/// Скоупинг по ресторану и авторизация по приложению форсируются на сервере.
///
///   DB.from("shifts").select().eq("date", "2026-06-15").order("opened_at").list(Shift.self)
///   DB.from("shifts").insert(["status": "open"]).single(Shift.self)
enum DB {
    static func from(_ table: String) -> DBQuery { DBQuery(table) }
}

final class DBQuery {
    private let table: String
    private var op = "select"
    private var columns = "*"
    private var values: Any?
    private var filters: [[String: Any]] = []
    private var orderArr: [[String: Any]] = []
    private var limitN: Int?
    private var returning: String?
    private var onConflict: String?

    init(_ table: String) { self.table = table }

    @discardableResult func select(_ cols: String = "*") -> DBQuery { columns = cols; return self }
    @discardableResult func insert(_ v: Any) -> DBQuery { op = "insert"; values = v; return self }
    @discardableResult func upsert(_ v: Any, onConflict: String? = nil) -> DBQuery { op = "upsert"; values = v; self.onConflict = onConflict; return self }
    @discardableResult func update(_ v: Any) -> DBQuery { op = "update"; values = v; return self }
    @discardableResult func delete() -> DBQuery { op = "delete"; return self }

    @discardableResult func eq(_ c: String, _ v: Any) -> DBQuery { filter("eq", c, v) }
    @discardableResult func neq(_ c: String, _ v: Any) -> DBQuery { filter("neq", c, v) }
    @discardableResult func gte(_ c: String, _ v: Any) -> DBQuery { filter("gte", c, v) }
    @discardableResult func lte(_ c: String, _ v: Any) -> DBQuery { filter("lte", c, v) }
    @discardableResult func `in`(_ c: String, _ v: [Any]) -> DBQuery { filter("in", c, v) }
    @discardableResult func ilike(_ c: String, _ v: Any) -> DBQuery { filter("ilike", c, v) }

    private func filter(_ op: String, _ c: String, _ v: Any) -> DBQuery {
        filters.append(["col": c, "op": op, "val": v]); return self
    }

    @discardableResult func order(_ c: String, ascending: Bool = true) -> DBQuery {
        orderArr.append(["col": c, "ascending": ascending]); return self
    }
    @discardableResult func limit(_ n: Int) -> DBQuery { limitN = n; return self }

    // MARK: - Выполнение

    private struct Wrap<T: Decodable>: Decodable { let data: T? }

    /// Терпимый к ошибкам декод одной строки: битая строка → nil, а не падение всего списка
    /// (Supabase может вернуть null в текстовом поле; JS это переживает, Codable — нет).
    private struct Lossy<T: Decodable>: Decodable {
        let value: T?
        init(from decoder: Decoder) {
            value = try? decoder.singleValueContainer().decode(T.self)
        }
    }

    private func payload() -> [String: Any] {
        var p: [String: Any] = ["table": table, "op": op]
        if op == "select" {
            p["columns"] = columns
            if let r = returning { p["returning"] = r }
        } else {
            if let v = values { p["values"] = v }
            if let r = returning { p["returning"] = r }
            if let oc = onConflict { p["onConflict"] = oc }
        }
        if !filters.isEmpty { p["filters"] = filters }
        if !orderArr.isEmpty { p["order"] = orderArr }
        if let l = limitN { p["limit"] = l }
        return p
    }

    /// Сетевая устойчивость: SELECT повторяем при сбое (идемпотентно). Без этого
    /// просадка сети/таймаут показывали «нет данных», пока не перелистнёшь туда-сюда.
    private func dbRequestResilient() async throws -> Data {
        let attempts = op == "select" ? 3 : 1
        var last: Error = APIError.http(-1, nil)
        for i in 1...attempts {
            do { return try await API.dbRequest(payload()) }
            catch {
                last = error
                // не ретраить осмысленные ответы сервера (4xx) — только сетевые/5xx
                if case APIError.http(let code, _) = error, (400..<500).contains(code) { throw error }
                if i < attempts { try? await Task.sleep(nanoseconds: UInt64(i) * 400_000_000) }
            }
        }
        throw last
    }

    /// SELECT множества строк (битые строки пропускаются, не роняя весь список).
    func list<T: Decodable>(_ type: T.Type) async throws -> [T] {
        let data = try await dbRequestResilient()
        let wrap = try JSONDecoder().decode(Wrap<[Lossy<T>]>.self, from: data)
        return (wrap.data ?? []).compactMap { $0.value }
    }

    /// SELECT одной строки (maybeSingle) или INSERT/UPDATE с возвратом строки (single).
    func single<T: Decodable>(_ type: T.Type) async throws -> T? {
        returning = op == "select" ? "maybeSingle" : "single"
        let data = try await dbRequestResilient()
        return try JSONDecoder().decode(Wrap<T>.self, from: data).data
    }

    /// Запись без возврата (INSERT/UPDATE/DELETE).
    func run() async throws {
        _ = try await API.dbRequest(payload())
    }
}
