import Foundation

/// One-off ledger expenses belong to a shift, never to expense_categories.
nonisolated struct CustomExpenseDraft: Codable, Identifiable, Sendable, Equatable {
    var id: String
    var name: String
    var amount: String
    var unpaid: Bool
    var note: String

    init(id: String = UUID().uuidString, name: String = "", amount: String = "", unpaid: Bool = false, note: String = "") {
        self.id = id.lowercased(); self.name = name; self.amount = amount
        self.unpaid = unpaid; self.note = note
    }

    private enum CodingKeys: String, CodingKey { case id, name, amount, unpaid, note }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id).lowercased()
        name = try c.decode(String.self, forKey: .name)
        amount = try c.decode(String.self, forKey: .amount)
        unpaid = try c.decodeIfPresent(Bool.self, forKey: .unpaid) ?? false
        note = try c.decodeIfPresent(String.self, forKey: .note) ?? ""
    }

}

nonisolated struct PreparedCustomExpense: Sendable {
    let id: String
    let name: String
    let amount: Double
    let unpaid: Bool
    let note: String

    func values(restaurantId: String, shiftId: String) -> [String: Any] {
        ["id": id, "restaurant_id": restaurantId, "shift_id": shiftId,
         "category_name": name, "amount": amount, "is_custom": true,
         "is_paid": !unpaid, "note": note]
    }
}

nonisolated enum CustomExpenseValidationError: Error { case invalid }

nonisolated func normalizeExpenseName(_ value: String) -> String {
    value.split(whereSeparator: \.isWhitespace).joined(separator: " ")
}

/// Integer cents avoid float rounding and reject signs, exponents and extra decimals.
nonisolated func parseExpenseCents(_ value: String) -> Int64? {
    let text = value.trimmingCharacters(in: .whitespacesAndNewlines).replacingOccurrences(of: ",", with: ".")
    guard text.range(of: #"^(?:[0-9]+(?:\.[0-9]{0,2})?|\.[0-9]{1,2})$"#, options: .regularExpression) != nil else { return nil }
    let pieces = text.split(separator: ".", omittingEmptySubsequences: false)
    guard let whole = Int64(pieces[0].isEmpty ? "0" : String(pieces[0])), whole <= 1_000_000_000 else { return nil }
    let fraction = pieces.count > 1 ? String(pieces[1]) : ""
    guard let centsPart = Int64(fraction.padding(toLength: 2, withPad: "0", startingAt: 0)) else { return nil }
    let cents = whole * 100 + centsPart
    return cents > 0 && cents <= 100_000_000_000 ? cents : nil
}

nonisolated func prepareCustomExpenses(_ rows: [CustomExpenseDraft]) throws -> [PreparedCustomExpense] {
    var result: [PreparedCustomExpense] = []
    var ids: Set<String> = []
    for row in rows {
        let name = normalizeExpenseName(row.name)
        if name.isEmpty && row.amount.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { continue }
        guard !name.isEmpty, name.utf16.count <= 120,
              UUID(uuidString: row.id) != nil, ids.insert(row.id.lowercased()).inserted,
              let cents = parseExpenseCents(row.amount) else { throw CustomExpenseValidationError.invalid }
        result.append(PreparedCustomExpense(id: row.id.lowercased(), name: name, amount: Double(cents) / 100,
                                            unpaid: row.unpaid, note: row.note))
    }
    return result
}

nonisolated func customExpenseTotal(_ rows: [CustomExpenseDraft]) -> Double {
    let cents = rows.reduce(Int64(0)) { $1.unpaid ? $0 : $0 + (parseExpenseCents($1.amount) ?? 0) }
    return Double(cents) / 100
}
