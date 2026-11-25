#if DEBUG
import Foundation

/// Explicit offline simulator transport. Unsupported operations never reach the network.
@MainActor enum AdvanceSaveFixture {
    nonisolated static var enabled: Bool {
        let env = ProcessInfo.processInfo.environment
        return env["MISE_DEMO_UI"] == "1" && ["success", "fail-once", "fail-cash-once"].contains(env["MISE_DEMO_ADVANCE_SAVE"] ?? "")
    }
    private static var failedOnce = false
    private static var tables: [String: [[String: Any]]] = {
        let df = DateFormatter(); df.dateFormat = "yyyy-MM-dd"; df.locale = Locale(identifier: "en_US_POSIX")
        let date = df.string(from: Date()), ym = String(df.string(from: Date()).prefix(7)), period = ym + "-01"
        return [
            "employees": [["id": "e1", "name": "Анна Кузнецова", "salary": 1000.0, "deduct_per_absence": 0.0, "is_active": true]],
            "shift_absences": [],
            "monthly_card_amounts": [["id": "c1", "employee_id": "e1", "month": ym, "card_amount": 200.0]],
            "salary_advances": [],
            "salary_payments": [["id": "p1", "employee_id": "e1", "period": period, "amount": 100.0, "method": "cash"]],
            "shift_expenses": [["id": "d1", "employee_id": "e1", "amount": 50.0, "is_paid": false, "note": "SALPERIOD:" + period]],
            "salary_history": [["id": "h0", "employee_id": "e1", "effective_from": "1900-01-01", "salary": 0.0, "deduct_per_absence": 0.0],
                               ["id": "h1", "employee_id": "e1", "effective_from": period, "salary": 1000.0, "deduct_per_absence": 0.0]],
            "restaurant_settings": [["salary_payout_day": 1]],
            "shifts": [["id": "s1", "restaurant_id": "demo", "date": date, "status": "closed", "inkassation": 600.0, "closing_balance": 100.0]],
            "inkassations": [["id": "i1", "restaurant_id": "demo", "shift_id": "s1", "date": date, "amount": 600.0, "expense": 50.0, "salary": 50.0, "total": 500.0, "reason": "Расход"]],
        ]
    }()

    /// Атомарные add_advance / delete_advance: всё или ничего, как в базе.
    private static func rpc(_ fn: String, _ p: [String: Any]) async throws -> Data {
        guard ["add_advance", "delete_advance"].contains(fn) else { throw APIError.http(-1009, nil) }
        try await Task.sleep(for: .milliseconds(120))
        let mode = ProcessInfo.processInfo.environment["MISE_DEMO_ADVANCE_SAVE"] ?? ""
        if !failedOnce, mode != "success" { failedOnce = true; throw APIError.http(503, "Временная ошибка сохранения") }
        var advances = tables["salary_advances"] ?? []
        var ink = tables["inkassations"]![0]
        let id = (fn == "add_advance" ? p["op_id"] : p["advance_id"]) as? String ?? ""
        var result: Any = NSNull()
        var delta = 0.0
        if fn == "add_advance" {
            if let saved = advances.first(where: { $0["id"] as? String == id }) { result = saved }
            else {
                delta = p["amount"] as? Double ?? 0
                var row: [String: Any] = ["id": id, "restaurant_id": "demo"]
                for key in ["employee_id", "amount", "date", "period", "note"] { row[key] = p[key] }
                advances.append(row); result = row
            }
        } else if let saved = advances.first(where: { $0["id"] as? String == id }) {
            delta = -(saved["amount"] as? Double ?? 0)
            advances.removeAll { $0["id"] as? String == id }
        }
        ink["expense"] = (ink["expense"] as? Double ?? 0) + delta
        ink["total"] = (ink["total"] as? Double ?? 0) - delta
        tables["salary_advances"] = advances; tables["inkassations"] = [ink]
        print("[AdvanceSaveFixture] \(fn)")
        return try JSONSerialization.data(withJSONObject: ["data": result])
    }

    static func request(_ payload: [String: Any]) async throws -> Data {
        if enabled, payload["op"] as? String == "rpc", let fn = payload["fn"] as? String,
           let p = (payload["args"] as? [String: Any])?["p"] as? [String: Any] { return try await rpc(fn, p) }
        guard enabled, let table = payload["table"] as? String, payload["op"] as? String == "select",
              table == "inkassation_balance" || tables[table] != nil else { throw APIError.http(-1009, nil) }
        let start = ContinuousClock.now
        try await Task.sleep(for: .milliseconds(120))
        let filters = payload["filters"] as? [[String: Any]] ?? []
        func matches(_ row: [String: Any]) -> Bool {
            filters.allSatisfy { f in
                guard let column = f["col"] as? String, let operation = f["op"] as? String else { return false }
                if column == "restaurant_id" { return f["val"] as? String == "demo" }
                let a = String(describing: row[column] ?? ""), b = String(describing: f["val"] ?? "")
                if operation == "eq" {
                    if let av = row[column] as? NSNumber, let bv = f["val"] as? NSNumber { return av == bv }
                    return a == b
                }
                if operation == "lte" { return a <= b }; if operation == "gte" { return a >= b }
                return false
            }
        }
        var current = tables[table] ?? []
        if table == "inkassation_balance" {
            let balance = (tables["inkassations"] ?? []).reduce(0.0) {
                $0 + ($1["amount"] as? Double ?? 0) - ($1["expense"] as? Double ?? 0) - ($1["salary"] as? Double ?? 0)
            }
            current = [["balance": balance]]
        }
        let result = current.filter(matches)
        let single = ["single", "maybeSingle"].contains(payload["returning"] as? String ?? "")
        print("[AdvanceSaveFixture] \(table).select \(start.duration(to: .now))")
        return try JSONSerialization.data(withJSONObject: ["data": single ? (result.first as Any? ?? NSNull()) : result])
    }
}
#endif
