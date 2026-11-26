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
        guard (op == "rpc" && payload["fn"] as? String == "stock_save_movement")
                || (op == "select" && ["tobacco_stock", "tobacco_movements"].contains(table)) else {
            throw APIError.http(-1009, nil)
        }
        let start = ContinuousClock.now
        try await Task.sleep(for: .milliseconds(op == "select" && table == "tobacco_movements" ? 8000 : 120))
        let result: Any
        if op == "rpc" {
            // Only a new receipt or issue of known items; edits and venue scope fail closed.
            guard let p = (payload["args"] as? [String: Any])?["p"] as? [String: Any],
                  let mode = p["mode"] as? String, ["in", "out", "writeoff"].contains(mode),
                  (p["replace_ids"] as? [String])?.isEmpty == true,
                  let rows = p["rows"] as? [[String: Any]], !rows.isEmpty else { throw APIError.http(-1009, nil) }
            if !failedOnce, ProcessInfo.processInfo.environment["MISE_DEMO_STASH_SAVE"] == "fail-once" {
                failedOnce = true
                throw APIError.http(503, "Временная ошибка сохранения")
            }
            var next = stock, touched: [StockItem] = [], inserted: [[String: Any]] = []
            for row in rows {
                guard let brand = row["brand"] as? String, let flavor = row["flavor"] as? String,
                      let grams = row["grams"] as? Double, grams.isFinite,
                      let index = next.firstIndex(where: { $0.brand == brand && $0.flavor == flavor }) else { throw APIError.http(-1009, nil) }
                let old = next[index]
                next[index] = StockItem(id: old.id, brand: brand, flavor: flavor,
                                        quantity_g: max(0, old.quantity_g + (mode == "in" ? grams : -grams)), min_quantity_g: old.min_quantity_g)
                touched.append(next[index])
                inserted.append(["id": UUID().uuidString.lowercased(), "brand": brand, "flavor": flavor, "quantity_g": grams,
                                 "type": mode, "created_at": ISO8601DateFormatter().string(from: Date())])
            }
            stock = next
            movements += inserted
            result = ["stock": try JSONSerialization.jsonObject(with: JSONEncoder().encode(touched)), "movements": inserted]
        } else {
            result = table == "tobacco_stock" ? try JSONSerialization.jsonObject(with: JSONEncoder().encode(stock)) : movements
        }
        print("[StashSaveFixture] \(table.isEmpty ? "stock-rpc" : table).\(op) \(start.duration(to: .now))")
        return try JSONSerialization.data(withJSONObject: ["data": result])
    }
}
#endif
