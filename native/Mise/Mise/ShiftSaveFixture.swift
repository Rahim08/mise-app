#if DEBUG
import Foundation

/// Explicit simulator-only transport. No real credentials, requests or stock/cash writes.
/// Requires BOTH flags. Unhandled operations fail closed; none fall through to the network.
@MainActor enum ShiftSaveFixture {
    nonisolated static var enabled: Bool {
        let env = ProcessInfo.processInfo.environment
        return env["MISE_DEMO_UI"] == "1" && ["success", "fail-once"].contains(env["MISE_DEMO_SHIFT_SAVE"] ?? "")
    }
    private static var failedOnce = false
    private static var rows: [String: [[String: Any]]] = [
        "shifts": [["id": "s1", "restaurant_id": "demo", "status": "open", "opening_balance": 200]],
        "shift_expenses": [], "inkassations": [], "shift_absences": [],
        "shift_checklists": [], "shift_checklist_completions": [], "hookah_sales": [],
    ]

    private static func failOnce() throws {
        guard !failedOnce, ProcessInfo.processInfo.environment["MISE_DEMO_SHIFT_SAVE"] == "fail-once" else { return }
        failedOnce = true
        throw APIError.http(503, "Временная ошибка сохранения")
    }

    static func request(_ payload: [String: Any]) async throws -> Data {
        if enabled, payload["op"] as? String == "rpc", payload["fn"] as? String == "save_shift",
           let p = (payload["args"] as? [String: Any])?["p"] as? [String: Any] {
            try await Task.sleep(for: .milliseconds(120))
            try failOnce()
            func rows(_ key: String) -> [[String: Any]] { p[key] as? [[String: Any]] ?? [] }
            func amount(_ row: [String: Any]) -> Double { row["amount"] as? Double ?? 0 }
            let saved = (rows("rows") + rows("custom")).map { row -> [String: Any] in
                var out = row
                out["id"] = row["id"] ?? UUID().uuidString
                out["is_custom"] = row["name"] != nil
                out["category_name"] = row["name"] ?? "demo"
                out["is_paid"] = !(row["unpaid"] as? Bool ?? false)
                return out
            }
            Self.rows["shift_expenses"] = saved
            let total = saved.filter { $0["is_paid"] as? Bool == true }.map(amount).reduce(p["inkassation"] as? Double ?? 0, +)
            let closing = 200 + (p["income"] as? Double ?? 0) - total
            print("[ShiftSaveFixture] save_shift")
            return try JSONSerialization.data(withJSONObject: ["data": [
                "opening_balance": 200, "total_expense": total, "closing_balance": closing, "rows": saved,
            ] as [String: Any]])
        }
        guard enabled, let table = payload["table"] as? String, let current = rows[table],
              let op = payload["op"] as? String, ["select", "insert", "upsert", "update", "delete"].contains(op) else {
            throw APIError.http(-1009, nil)
        }
        let started = ContinuousClock.now
        // A deliberately slow optional read makes accidental UI coupling observable.
        try await Task.sleep(for: .milliseconds(table == "hookah_sales" ? 8_000 : 120))
        let filters = payload["filters"] as? [[String: Any]] ?? []
        func matches(_ row: [String: Any]) -> Bool {
            filters.allSatisfy { filter in
                guard let column = filter["col"] as? String, let operation = filter["op"] as? String else { return false }
                if column == "restaurant_id" { return filter["val"] as? String == "demo" }
                if operation == "eq" { return String(describing: row[column] ?? "") == String(describing: filter["val"] ?? "") }
                if operation == "in", let ids = filter["val"] as? [String] { return ids.contains(row[column] as? String ?? "") }
                return false
            }
        }
        let selected = current.filter(matches)
        let result: [[String: Any]]
        if op == "select" { result = selected }
        else if op == "delete" { rows[table] = current.filter { !matches($0) }; result = [] }
        else {
            let values = (payload["values"] as? [[String: Any]]) ?? (payload["values"] as? [String: Any]).map { [$0] } ?? []
            guard !values.isEmpty, values.allSatisfy({ ($0["restaurant_id"] as? String).map { $0 == "demo" } ?? true }) else {
                throw APIError.http(-1009, nil)
            }
            var updated = current
            var written: [[String: Any]] = []
            for value in values {
                if op == "update" {
                    for index in updated.indices where matches(updated[index]) {
                        updated[index].merge(value) { _, new in new }; written.append(updated[index])
                    }
                } else {
                    var row = value; row["id"] = row["id"] ?? UUID().uuidString
                    row["restaurant_id"] = "demo"
                    if op == "upsert" { updated.removeAll { $0["id"] as? String == row["id"] as? String } }
                    updated.append(row); written.append(row)
                }
            }
            rows[table] = updated; result = written
        }
        print("[ShiftSaveFixture] \(table).\(op) \(started.duration(to: .now))")
        let single = ["single", "maybeSingle"].contains(payload["returning"] as? String ?? "")
        return try JSONSerialization.data(withJSONObject: ["data": single ? (result.first as Any? ?? NSNull()) : result])
    }

    static func notification() async {
        guard enabled else { return }
        try? await Task.sleep(for: .seconds(8))
        print("[ShiftSaveFixture] offline notification finished")
    }
}
#endif
