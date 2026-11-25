import Foundation

// Разбор shift_expenses одной смены на «что показывает форма закрытия смены» и «что форма
// не трогает». Порт lib/shiftForm.ts (веб) — алгоритм 1:1.
//
// Аудит 2026-09-27: раньше форма грузила строку с employee_id в empExtras[emp] (одно поле на
// сотрудника) и при сохранении удаляла ВСЕ старые строки смены, пересоздавая только то, что
// было в форме: ЗП-долг (note SALPERIOD:) превращался в «Имя (экстра)» без метки (фантомные
// долги SO 31.08), дубли одного сотрудника/категории за день терялись, строки уволенных и
// выключенных категорий удалялись. Теперь форма «владеет» только тем, что может честно
// показать и пересоздать; остальное не удаляется, а его оплаченная часть входит в расход дня.

let salperiodPrefix = "SALPERIOD:"

/// Деньги — до центов, без float-хвостов вида 482.49999999999864.
func round2(_ v: Double) -> Double { (v * 100).rounded() / 100 }

struct ShiftFormSplit {
    var customExpenses: [CustomExpenseDraft] = []
    var catAmounts: [String: Double] = [:]
    var catNotes: [String: String] = [:]
    var catUnpaid: [String: Bool] = [:]
    var empExtras: [String: Double] = [:]
    var empUnpaid: [String: Bool] = [:]
    /// Строки, которые форма пересоздаёт при сохранении (их и только их можно удалять).
    var ownedIds: [String] = []
    /// Оплаченные строки вне формы (уволенный сотрудник, выключенная категория, …) — в расход дня.
    var unmanagedPaidTotal: Double = 0
    /// Погашения долгов, сделанные ЭТОЙ сменой (paid_shift_id == shiftId) — в расход дня.
    var settledTodayTotal: Double = 0
}

/// Выбранные долги устарели: погашены другой сменой, удалены или сумма изменена с другого
/// устройства (settle_debts такие пропускает, а касса уже посчитана с ними). Порт hasStaleDebt.
func hasStaleDebt(_ selected: [(id: String, amount: Double)], fresh: [ShiftExpense], shiftId: String) -> Bool {
    let byId = Dictionary(fresh.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
    return selected.contains { d in
        guard let r = byId[d.id], (r.amount ?? 0) == d.amount else { return true }
        if let paid = r.paid_shift_id { return paid != shiftId }
        return r.is_paid != false
    }
}

func splitShiftExpenses(_ rows: [ShiftExpense], shiftId: String,
                        activeCategoryIds: Set<String>, activeEmployeeIds: Set<String>,
                        includeCustom: Bool = false) -> ShiftFormSplit {
    var out = ShiftFormSplit()
    var unpaidByKey: [String: Bool] = [:]
    for e in rows {
        let amount = e.amount ?? 0
        if let paidShift = e.paid_shift_id {
            if paidShift == shiftId { out.settledTodayTotal += amount }
            continue // историческая пометка «долг был здесь» — не считается и не трогается
        }
        let unpaid = e.is_paid == false
        let isSalaryDebt = e.note?.hasPrefix(salperiodPrefix) ?? false
        if e.is_custom == true {
            if includeCustom, !isSalaryDebt, e.category_id == nil, e.employee_id == nil,
               let name = e.category_name, !normalizeExpenseName(name).isEmpty {
                out.customExpenses.append(CustomExpenseDraft(id: e.id, name: name,
                    amount: String(round2(amount)), unpaid: unpaid, note: e.note ?? ""))
                out.ownedIds.append(e.id)
            } else if !unpaid {
                out.unmanagedPaidTotal += amount
            }
            continue
        }
        var key: String? = nil
        if !isSalaryDebt {
            if let emp = e.employee_id { key = activeEmployeeIds.contains(emp) ? "e:" + emp : nil }
            else if let cat = e.category_id { key = activeCategoryIds.contains(cat) ? "c:" + cat : nil }
        }
        // Смешанные «оплачено»/«в долг» на одном ключе — строки другого статуса остаются вне
        // формы (не удаляются), а не перекрашиваются молча.
        if let key, unpaidByKey[key] == nil || unpaidByKey[key] == unpaid {
            unpaidByKey[key] = unpaid
            let id = String(key.dropFirst(2))
            out.ownedIds.append(e.id)
            if key.hasPrefix("e:") {
                out.empExtras[id, default: 0] += amount
                if unpaid { out.empUnpaid[id] = true }
            } else {
                out.catAmounts[id, default: 0] += amount
                if unpaid { out.catUnpaid[id] = true }
                if let n = e.note, !n.isEmpty, out.catNotes[id] == nil { out.catNotes[id] = n }
            }
            continue
        }
        if !unpaid { out.unmanagedPaidTotal += amount }
    }
    out.unmanagedPaidTotal = round2(out.unmanagedPaidTotal)
    out.settledTodayTotal = round2(out.settledTodayTotal)
    return out
}
