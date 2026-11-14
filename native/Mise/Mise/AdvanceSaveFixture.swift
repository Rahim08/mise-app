#if DEBUG
import Foundation

/// Explicit offline simulator transport. Unsupported operations never reach the network.
@MainActor enum AdvanceSaveFixture {
    nonisolated static var enabled: Bool {
        let env = ProcessInfo.processInfo.environment
        return env["MISE_DEMO_UI"] == "1" && ["success", "fail-once", "fail-cash-once"].contains(env["MISE_DEMO_ADVANCE_SAVE"] ?? "")
    }
    private static var failedInsert = false
    private static var failedCashWrites = 0
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

    static func request(_ payload: [String: Any]) async throws -> Data {
        guard enabled, let table = payload["table"] as? String, let op = payload["op"] as? String else { throw APIError.http(-1009, nil) }
        let writable = (table == "salary_advances" && ["insert", "delete"].contains(op))
            || (table == "inkassations" && ["insert", "update"].contains(op)) || (table == "shifts" && op == "insert")
        guard (op == "select" && (table == "inkassation_balance" || tables[table] != nil)) || writable else { throw APIError.http(-1009, nil) }
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
        let result: [[String: Any]]
        if op == "select" { result = current.filter(matches) }
        else if op == "delete" { tables[table] = current.filter { !matches($0) }; result = [] }
        else {
            guard var value = payload["values"] as? [String: Any],
                  (value["restaurant_id"] as? String).map({ $0 == "demo" }) ?? true else { throw APIError.http(-1009, nil) }
            if op == "insert", table == "salary_advances", !failedInsert,
               ProcessInfo.processInfo.environment["MISE_DEMO_ADVANCE_SAVE"] == "fail-once" {
                failedInsert = true; throw APIError.http(503, "Временная ошибка сохранения")
            }
            if table == "inkassations", failedCashWrites < 2,
               ProcessInfo.processInfo.environment["MISE_DEMO_ADVANCE_SAVE"] == "fail-cash-once" {
                failedCashWrites += 1; throw APIError.http(503, "Временная ошибка списания")
            }
            if op == "insert" {
                value["id"] = value["id"] ?? UUID().uuidString.lowercased(); value["restaurant_id"] = "demo"
                current.append(value); result = [value]
            } else {
                var changed: [[String: Any]] = []
                for i in current.indices where matches(current[i]) { current[i].merge(value) { _, new in new }; changed.append(current[i]) }
                result = changed
            }
            tables[table] = current
        }
        let single = ["single", "maybeSingle"].contains(payload["returning"] as? String ?? "")
        print("[AdvanceSaveFixture] \(table).\(op) \(start.duration(to: .now))")
        return try JSONSerialization.data(withJSONObject: ["data": single ? (result.first as Any? ?? NSNull()) : result])
    }
}
#endif
