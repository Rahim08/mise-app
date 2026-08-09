import Foundation

/// Нативный построитель запросов к шлюзу `/api/db` — зеркало веб-клиента `lib/db.ts`.
/// Аутентификация через cookie-токен PIN-сессии (URLSession хранит его сам).
/// Скоупинг по ресторану и авторизация по приложению форсируются на сервере.
///
///   DB.from("shifts").select().eq("date", "2026-06-15").order("opened_at").list(Shift.self)
///   DB.from("shifts").insert(["status": "open"]).single(Shift.self)
enum DB {
    static func from(_ table: String) -> DBQuery { DBQuery(table) }

    /// Очистить кеш для конкретной таблицы (вызывать после мутаций).
    /// Fire-and-forget: порядок не критичен — кеш и так живёт максимум 5 минут (TTL).
    static func invalidateCache(table: String) { Task { await CacheStore.shared.invalidate(table: table) } }

    /// Очистить весь кеш.
    static func clearCache() { Task { await CacheStore.shared.clearAll() } }

    /// Очистить кеш и ДОЖДАТЬСЯ очистки — для pull-to-refresh: свежий кеш (<TTL) иначе
    /// возвращается вместо сети, и жест «обновить» ничего не обновлял (до 5 минут
    /// межустройственной слепоты). Оффлайн-поддержка не страдает: после очистки
    /// успешные SELECT-ы тут же перезаполняют кеш.
    static func clearCacheNow() async { await CacheStore.shared.clearAll() }

    /// Отметить/снять признак «отдали устаревший кеш» (см. DBStatus).
    static func markStale(table: String) async { await MainActor.run { DBStatus.shared.mark(table) } }
    static func clearStale(table: String) async { await MainActor.run { DBStatus.shared.clear(table) } }
}

/// Признак «данные пришли из просроченного кеша, сеть не ответила».
///
/// Раньше stale-ответ был неотличим от свежего (комментарий в dbRequestResilient обещал
/// индикатор, но потребителей не существовало): менеджер мог закрыть смену по остатку,
/// которому уже несколько часов, и не узнать об этом. Теперь любой такой ответ помечает
/// таблицу здесь, а экраны показывают плашку.
@MainActor
@Observable
final class DBStatus {
    static let shared = DBStatus()

    /// Таблицы, последнее чтение которых пришло из устаревшего кеша.
    private(set) var staleTables: Set<String> = []
    /// Когда в последний раз отдали устаревшие данные (для текста плашки).
    private(set) var staleAt: Date?

    func mark(_ table: String) { staleTables.insert(table); staleAt = Date() }
    func clear(_ table: String) {
        guard staleTables.contains(table) else { return }
        staleTables.remove(table)
        if staleTables.isEmpty { staleAt = nil }
    }
    func clearAll() { staleTables.removeAll(); staleAt = nil }
    /// Хоть одна из перечисленных таблиц читалась из устаревшего кеша.
    func isStale(_ tables: String...) -> Bool { tables.contains { staleTables.contains($0) } }
}

// MARK: - In-memory cache (оффлайн-поддержка)

/// Потокобезопасный кеш для SELECT-запросов с TTL.
/// При ошибке сети возвращает кешированные данные с флагом stale.
actor CacheStore {
    static let shared = CacheStore()

    private struct Entry {
        let data: Data
        let timestamp: Date
    }

    private var store: [String: Entry] = [:]
    private let ttl: TimeInterval = 300 // 5 минут

    func get(_ key: String) -> (data: Data, stale: Bool)? {
        guard let entry = store[key] else { return nil }
        let age = Date().timeIntervalSince(entry.timestamp)
        return (entry.data, age > ttl)
    }

    func set(_ key: String, data: Data) {
        store[key] = Entry(data: data, timestamp: Date())
    }

    func invalidate(table: String) {
        store = store.filter { !$0.key.hasPrefix(table + ":") }
    }

    func clearAll() { store.removeAll() }
}

// Мутабельное состояние строится и потребляется инлайн в одной цепочке вызовов —
// экземпляр никогда не переживает await-границу и не шарится между вызовами,
// но конформанс объявляем явно, а не полагаемся на выведенную MainActor-изоляцию.
final class DBQuery: @unchecked Sendable {
    private let table: String
    private var op = "select"
    private var columns = "*"
    private var values: Any?
    private var filters: [[String: Any]] = []
    private var orderArr: [[String: Any]] = []
    private var limitN: Int?
    private var returning: String?
    private var onConflict: String?
    private var bypassCache = false

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

    /// Чтение мимо кеша (и без stale-fallback): для read-modify-write, где старые данные
    /// приведут к lost update (мерж чек-листов). Успешный ответ кеш всё равно обновляет.
    @discardableResult func fresh() -> DBQuery { bypassCache = true; return self }

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
    /// Для SELECT-запросов используется кеш: при ошибке сети возвращаем кешированные данные.
    private func dbRequestResilient() async throws -> (data: Data, stale: Bool) {
        let p = payload()
        let isRead = op == "select"
        let cacheKey = isRead ? cacheKey(p) : nil

        // Попытка получить из кеша до запроса (для оффлайна)
        var cachedStale: Data?
        if let key = cacheKey, !bypassCache {
            if let entry = await CacheStore.shared.get(key) {
                if !entry.stale { return (entry.data, false) } // свежий кеш — возвращаем сразу
                cachedStale = entry.data // запомнили на случай ошибки сети
            }
        }

        let attempts = isRead ? 3 : 1
        var last: Error = APIError.http(-1, nil)
        for i in 1...attempts {
            do {
                let data = try await API.dbRequest(p)
                // Кешируем успешный SELECT
                if let key = cacheKey {
                    await CacheStore.shared.set(key, data: data)
                }
                // Любая запись обесценивает кеш SELECT-ов этой таблицы — иначе следующее
                // чтение до 5 минут отдаёт состояние ДО мутации (открытая смена «пропадала»,
                // и повторное открытие ловило unique(restaurant_id,date)).
                if !isRead { DB.invalidateCache(table: table) }
                else { await DB.clearStale(table: table) }
                return (data, false)
            } catch {
                last = error
                // не ретраить осмысленные ответы сервера (4xx) — только сетевые/5xx
                if case APIError.http(let code, _) = error, (400..<500).contains(code) {
                    #if DEBUG
                    print("[DB] \(table) \(op) HTTP \(code): \(error)")
                    #endif
                    throw error
                }
                if i < attempts { try? await Task.sleep(nanoseconds: UInt64(i) * 400_000_000) }
            }
        }

        // Сеть недоступна — возвращаем кеш если есть, но помечаем данные устаревшими:
        // вызывающий обязан уметь это показать (см. listChecked / DB.staleReads),
        // иначе менеджер закроет смену по остатку, которому может быть много часов.
        if let stale = cachedStale {
            await DB.markStale(table: table)
            return (stale, true)
        }

        #if DEBUG
        print("[DB] \(table) \(op) failed after retries: \(last)")
        #endif
        throw last
    }

    /// Генерация ключа кеша на основе payload запроса.
    ///
    /// ВАЖНО: раньше ключ обрезался до первых 32 hex-символов (=16 байт сырого JSON) —
    /// это не хеш, а обрезка. Запросы с одинаковым table/op/columns, но разными значениями
    /// фильтра (например, датой), сериализуются в JSON с общим префиксом длиннее 16 байт
    /// (значение фильтра стоит ПОСЛЕ него) → получали ОДИНАКОВЫЙ "ключ" и коллизировали:
    /// первый ответ кешировался, все последующие запросы с другой датой получали тот же
    /// закешированный результат. Использовать весь hex — коллизий не будет.
    private func cacheKey(_ p: [String: Any]) -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: p, options: .sortedKeys) else { return table }
        let hash = data.map { String(format: "%02x", $0) }.joined()
        return "\(table):\(hash)"
    }

    /// SELECT множества строк (битые строки пропускаются, не роняя весь список).
    func list<T: Decodable>(_ type: T.Type) async throws -> [T] {
        try await listChecked(type).rows
    }

    /// Как list(), но дополнительно сообщает, что строки пришли из устаревшего кеша
    /// (сеть не ответила). Для экранов, где по данным принимают денежные решения.
    func listChecked<T: Decodable>(_ type: T.Type) async throws -> (rows: [T], stale: Bool) {
        let (data, stale) = try await dbRequestResilient()
        do {
            let wrap = try JSONDecoder().decode(Wrap<[Lossy<T>]>.self, from: data)
            let rows = (wrap.data ?? []).compactMap { $0.value }
            #if DEBUG
            print("[DB] \(table) list filters=\(filters) -> \(rows.count) rows (raw: \(String(data: data, encoding: .utf8)?.prefix(200) ?? ""))")
            #endif
            return (rows, stale)
        } catch {
            #if DEBUG
            print("[DB] \(table) list DECODE FAILED: \(error) raw: \(String(data: data, encoding: .utf8)?.prefix(500) ?? "")")
            #endif
            throw error
        }
    }

    /// SELECT одной строки (maybeSingle) или INSERT/UPDATE с возвратом строки (single).
    /// Для записи кеш таблицы инвалидируется внутри dbRequestResilient() — раньше это
    /// делал только run(), и путь insert().single() оставлял протухший SELECT в кеше.
    func single<T: Decodable>(_ type: T.Type) async throws -> T? {
        returning = op == "select" ? "maybeSingle" : "single"
        let (data, _) = try await dbRequestResilient()
        do {
            return try JSONDecoder().decode(Wrap<T>.self, from: data).data
        } catch {
            #if DEBUG
            print("[DB] \(table) single DECODE FAILED: \(error) raw: \(String(data: data, encoding: .utf8)?.prefix(500) ?? "")")
            #endif
            throw error
        }
    }

    /// Запись без возврата (INSERT/UPDATE/DELETE). Инвалидирует кеш таблицы
    /// (общий путь dbRequestResilient — как и single() для записи).
    func run() async throws {
        _ = try await dbRequestResilient()
    }
}
