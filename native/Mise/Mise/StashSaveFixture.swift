#if DEBUG
import Foundation

/// Offline simulator data; both flags are required and unsupported operations fail closed.
@MainActor enum StashSaveFixture {
    nonisolated static var enabled: Bool {
        let env = ProcessInfo.processInfo.environment
        return env["MISE_DEMO_UI"] == "1" && ["success", "fail-once"].contains(env["MISE_DEMO_STASH_SAVE"] ?? "")
    }
    static let initialStock: [StockItem] = (1...6).map {
        StockItem(id: "qa\($0)", brand: "Проверка", flavor: "Позиция \($0)", quantity_g: 1000, min_quantity_g: 100)
    }
    private static var stock = initialStock
    private static var movements: [[String: Any]] = []
    private static var failedOnce = false

    static func request(_ payload: [String: Any]) async throws -> Data {
        guard enabled else { throw APIError.http(-1009, nil) }
        let op = payload["op"] as? String ?? "", table = payload["table"] as? String ?? ""
        guard (op == "rpc" && payload["fn"] as? String == "increment_tobacco_stock")
                || (["select", "insert"].contains(op) && ["tobacco_stock", "tobacco_movements"].contains(table)) else {
            throw APIError.http(-1009, nil)
        }
        let start = ContinuousClock.now
        try await Task.sleep(for: .milliseconds(op == "select" && table == "tobacco_movements" ? 8000 : 120))
        let result: Any
        if op == "rpc" {
            guard let args = payload["args"] as? [String: Any], let id = args["p_id"] as? String,
                  let delta = args["p_delta"] as? Double, delta.isFinite,
                  let index = stock.firstIndex(where: { $0.id == id }) else { throw APIError.http(-1009, nil) }
            let old = stock[index]
            stock[index] = StockItem(id: old.id, brand: old.brand, flavor: old.flavor,
                                    quantity_g: max(0, old.quantity_g + delta), min_quantity_g: old.min_quantity_g)
            result = try JSONSerialization.jsonObject(with: JSONEncoder().encode(stock[index]))
        } else if op == "select" {
            result = table == "tobacco_stock" ? try JSONSerialization.jsonObject(with: JSONEncoder().encode(stock)) : movements
        } else {
            let values = (payload["values"] as? [[String: Any]]) ?? (payload["values"] as? [String: Any]).map { [$0] } ?? []
            guard !values.isEmpty, values.allSatisfy({ $0["restaurant_id"] as? String == "demo" }) else { throw APIError.http(-1009, nil) }
            if table == "tobacco_movements", !failedOnce,
               ProcessInfo.processInfo.environment["MISE_DEMO_STASH_SAVE"] == "fail-once" {
                failedOnce = true
                throw APIError.http(503, "Временная ошибка сохранения")
            }
            let inserted = values.map { value in
                var row = value; row["id"] = row["id"] ?? UUID().uuidString.lowercased()
                row["created_at"] = row["created_at"] ?? ISO8601DateFormatter().string(from: Date())
                return row
            }
            if table == "tobacco_movements" { movements += inserted }
            else { stock += try JSONDecoder().decode([StockItem].self, from: JSONSerialization.data(withJSONObject: inserted)) }
            result = payload["returning"] as? String == "single" ? inserted[0] : inserted
        }
        print("[StashSaveFixture] \(table.isEmpty ? "stock-rpc" : table).\(op) \(start.duration(to: .now))")
        return try JSONSerialization.data(withJSONObject: ["data": result])
    }
}
#endif
