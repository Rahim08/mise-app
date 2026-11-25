import SwiftUI

// MARK: - Manager → Зарплата (реструктура 2026-08-13, см.
// docs/MANAGER-PEOPLE-RESTRUCTURE-2026-08-13.md). Фонд/долг/список всех сотрудников/оплата —
// сюда, перенесено из People→Зарплата (там остался только личный вид, PeopleTasksSalary.swift).
// markSalaryPaid списывает инкассацию дня оплаты напрямую (inkassations.salary/salary_note).

extension ManagerModel {
    struct SalRow: Identifiable {
        let id: String; let name: String; let salary: Double; let absences: Int
        let absenceList: [String]
        let deduct: Double; let card: Double; var advance: Double
        var advanceList: [SalaryAdvance]; let total: Double; var cash: Double
        var paid: Double = 0; var remaining: Double = 0; var lastPaidAt: String? = nil
        var paidCash: Double = 0
    }
}

@MainActor
@Observable
final class ManagerSalaryModel {
    let rid: String
    init(rid: String) { self.rid = rid }

    var viewMonth: Date = Date()
    var rows: [ManagerModel.SalRow] = []
    var loaded = false
    var debtTotal: Double = 0
    var debtByEmp: [String: Double] = [:]
    var payoutDay: Int? = nil
    private var loadGeneration = 0

    var isCurrentMonth: Bool { Calendar.current.isDate(viewMonth, equalTo: Date(), toGranularity: .month) }
    var fund: Double { rows.reduce(0) { $0 + $1.total } }
    // C3 (аудит 2026-08-15): кэш-нал прошлого месяца для payout-day-цикла (computeAccruedToday),
    // пока не наступил payout_day текущего — паритет с Analytics.salToday. Заполняется в load().
    var prevCashTotal: Double = 0
    var prevPaidCash: Double = 0
    // Единая формула с Analytics (computeAccruedToday, AnalyticsView.swift) — раньше здесь была
    // своя линейная рампа над daysInMonth+payoutDay, применённая к валовому fund; расходилась с
    // Analytics до ~17пп на одну и ту же ЗП. Теперь база — totalCash (нал к выплате, за вычетом
    // аванса/карты), как в Analytics, а не fund (включающий уже отложенное на карту/аванс).
    var accruedToday: Double {
        guard isCurrentMonth else { return fund }
        let cal = Calendar.current
        let daysInMonth = cal.range(of: .day, in: .month, for: viewMonth)?.count ?? 30
        let prevDaysInMonth = cal.date(byAdding: .month, value: -1, to: Date()).flatMap { cal.range(of: .day, in: .month, for: $0)?.count } ?? 30
        let totalCash = rows.reduce(0) { $0 + $1.cash }
        return computeAccruedToday(isCurrentMonth: isCurrentMonth, totalCash: totalCash, daysInMonth: daysInMonth, payoutDay: payoutDay, prevTotalCash: prevCashTotal, prevDaysInMonth: prevDaysInMonth,
                                   paidCash: rows.reduce(0) { $0 + $1.paidCash }, prevPaidCash: prevPaidCash)
    }

    private let dfKey: DateFormatter = {
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.locale = Locale(identifier: "en_US_POSIX")
        return f
    }()
    func key(_ d: Date) -> String { dfKey.string(from: d) }

    func changeMonth(_ dir: Int) {
        guard !moneyBusy else { return }
        if dir > 0 && isCurrentMonth { return }
        guard let d = Calendar.current.date(byAdding: .month, value: dir, to: viewMonth) else { return }
        viewMonth = d
        loaded = false
        Task { await load() }
    }

    // Канон расчёта — решение 2026-07-17, паритет с PeopleModel.computeSalary (личный вид).
    private func computeSalary(monthOf date: Date) async -> [ManagerModel.SalRow] {
        let cal = Calendar.current
        let ym = String(key(date).prefix(7))
        let monthStart = cal.date(from: cal.dateComponents([.year, .month], from: date)) ?? date
        let monthEnd = cal.date(byAdding: DateComponents(month: 1, day: -1), to: monthStart) ?? monthStart
        // Без фильтра is_active: уволенный остаётся в месяцах, где у него есть выплаты/авансы/
        // прогулы/карта (аудит 2026-09-27, паритет с веб tabs-salary.tsx) — фильтр ниже.
        async let empsR = try? DB.from("employees").select("id, name, salary, deduct_per_absence, is_active").order("name").list(Employee.self)
        async let absR = try? DB.from("shift_absences").select("employee_id, date, source").gte("date", ym + "-01").lte("date", key(monthEnd)).list(Absence.self)
        async let cardsR = try? DB.from("monthly_card_amounts").select("employee_id, card_amount").eq("month", ym).list(CardAmount.self)
        // Фильтр по period (месяц ЗП, к которому отнесён аванс), НЕ по date (день списания из
        // кассы) — юзер-фидбок 2026-08-15: аванс, взятый в июле датой на август, должен
        // остаться в зарплате июля, а не уехать в август вслед за датой списания.
        async let advR = try? DB.from("salary_advances").select().eq("period", ym + "-01").list(SalaryAdvance.self)
        async let paysR = try? DB.from("salary_payments").select().eq("period", ym + "-01").list(SalaryPayment.self)
        // Открытый ЗП-долг за месяц («Отметить как долг») — уже обещан к выплате через Manager→
        // Долги; в «осталось» не дублируем, иначе можно заплатить дважды (аудит 2026-09-27).
        nonisolated struct DebtAmt: Codable, Sendable { let employee_id: String?; let amount: Double? }
        async let debtsR = try? DB.from("shift_expenses").select("employee_id, amount").eq("is_paid", false).eq("note", "\(Self.salperiodPrefix)\(ym)-01").list(DebtAmt.self)
        // Оклад/вычет, действовавшие в этом месяце (salary-history-2026-09.sql) — иначе
        // правка оклада сегодня меняет расчёт за прошлые месяцы задним числом, и loadDebt
        // ниже материализует фиктивный долг в syncLedger (MISE-001).
        async let salHistR = try? DB.from("salary_history").select("employee_id, salary, deduct_per_absence, effective_from").lte("effective_from", key(monthStart)).list(SalaryHistoryRow.self)
        guard let rawEmployees = await empsR else { return [] }
        let absences = (await absR) ?? [], cardAmounts = (await cardsR) ?? []
        let advances = (await advR) ?? [], payments = (await paysR) ?? []
        var openDebtByEmp: [String: Double] = [:]
        for d in (await debtsR) ?? [] { if let id = d.employee_id { openDebtByEmp[id, default: 0] += d.amount ?? 0 } }
        var withActivity = Set<String>(openDebtByEmp.keys)
        absences.filter { $0.source != "auto" }.forEach { if let id = $0.employee_id { withActivity.insert(id) } }
        cardAmounts.forEach { if let id = $0.employee_id { withActivity.insert(id) } }
        advances.forEach { if let id = $0.employee_id { withActivity.insert(id) } }
        payments.forEach { if let id = $0.employee_id { withActivity.insert(id) } }
        let monthEmployees = rawEmployees.filter { $0.is_active != false || withActivity.contains($0.id) }
        let employees = resolveEmployees(monthEmployees, history: (await salHistR) ?? [], monthStart: key(monthStart))

        return employees.map { e -> ManagerModel.SalRow in
            let absForEmp = absences.filter { $0.employee_id == e.id && $0.source != "auto" }
            let absN = absForEmp.count
            let absenceList = absForEmp.compactMap { $0.date }.sorted()
            let deduct = Double(absN) * (e.deduct_per_absence ?? 0)
            let card = cardAmounts.first { $0.employee_id == e.id }?.card_amount ?? 0
            let advForEmp = advances.filter { $0.employee_id == e.id }
            let advance = advForEmp.reduce(0) { $0 + ($1.amount ?? 0) }
            let paysForEmp = payments.filter { $0.employee_id == e.id }
            let paid = paysForEmp.reduce(0) { $0 + ($1.amount ?? 0) }
            // A2 (аудит 2026-08-15): remaining должен уменьшаться только оплатами method="cash" —
            // `card` (monthly_card_amounts) уже вычтен из `cash` бюджетно; вычитать ещё и
            // salary_payments с method="card" из remaining значит списать ту же сумму дважды.
            let paidCash = paysForEmp.filter { ($0.method ?? "cash") == "cash" }.reduce(0) { $0 + ($1.amount ?? 0) }
            let lastPaidAt = paysForEmp.compactMap { $0.paid_at }.max()
            let total = max(0, (e.salary ?? 0) - deduct)
            let cash = max(0, total - advance - card)
            let remaining = max(0, cash - paidCash - (openDebtByEmp[e.id] ?? 0))
            return ManagerModel.SalRow(id: e.id, name: e.name, salary: e.salary ?? 0, absences: absN, absenceList: absenceList, deduct: deduct, card: card, advance: advance, advanceList: advForEmp, total: total, cash: cash, paid: paid, remaining: remaining, lastPaidAt: lastPaidAt, paidCash: paidCash)
        }
    }

    func load() async {
        loadGeneration += 1
        let generation = loadGeneration, month = viewMonth
        let isCurrent = Calendar.current.isDate(month, equalTo: Date(), toGranularity: .month)
        var payout = payoutDay
        if payout == nil {
            payout = (try? await DB.from("restaurant_settings").select("salary_payout_day").limit(1).list(PayoutDayRow.self))?.first?.salary_payout_day
        }
        let currentRows = await computeSalary(monthOf: month)
        guard generation == loadGeneration, month == viewMonth else { return }
        rows = currentRows; payoutDay = payout
        if isCurrent, let previous = Calendar.current.date(byAdding: .month, value: -1, to: month) {
            let previousRows = await computeSalary(monthOf: previous)
            guard generation == loadGeneration, month == viewMonth else { return }
            prevCashTotal = previousRows.reduce(0) { $0 + $1.cash }
            prevPaidCash = previousRows.reduce(0) { $0 + $1.paidCash }
        }
        loaded = true
    }

    // Все деньги — одной функцией базы (веб-паритет lib/moneyOps.ts). Повтор той же операции
    // после потерянного ответа идёт с тем же op_id, база второй раз ничего не запишет.
    private static let moneyTables = ["salary_payments", "salary_advances", "inkassations", "inkassation_balance", "shifts", "shift_expenses"]
    private var moneyAttempt: (key: String, opId: String)?
    private func opId(_ fn: String, _ payload: [String: Any]) -> String {
        let data = (try? JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys])) ?? Data()
        let fingerprint = fn + (String(data: data, encoding: .utf8) ?? "")
        if moneyAttempt?.key != fingerprint { moneyAttempt = (fingerprint, UUID().uuidString.lowercased()) }
        return moneyAttempt!.opId
    }
    private func moneyDone() async {
        moneyAttempt = nil
        // До перечитывания экран не должен получить старый кеш.
        for table in Self.moneyTables { await CacheStore.shared.invalidate(table: table) }
    }
    /// Текст отказа; остаток и пул перечитываются — база отказала, значит экран устарел.
    private func moneyError(_ error: Error, employeeId: String) async -> String {
        guard case let APIError.http(_, message) = error else { return t("saveFailed", ["err": error.localizedDescription]) }
        for table in Self.moneyTables { await CacheStore.shared.invalidate(table: table) }
        switch message {
        case "exceeds_remaining":
            await load()
            return t("pe.debtExceedsRemaining", ["avail": Money.s(rows.first { $0.id == employeeId }?.remaining ?? 0)])
        case "insufficient_pool":
            insufficientFunds = true
            let balance = (try? await DB.from("inkassation_balance").select("balance").fresh().eq("restaurant_id", rid).limit(1).list(InkBalanceRow.self))?.first?.balance ?? 0
            return t("pe.insufficientInkassationPool", ["avail": Money.s(max(0, balance))])
        case "duplicate_payment": return t("pe.duplicatePayment")
        default: return t("saveFailed", ["err": error.localizedDescription])
        }
    }

    // Тег с суммой (юзер-фидбок 2026-08-15): без неё в заметке инкассации было просто «Имя
    // аванс» без числа — непонятно сколько. id-суффикс — см. A4 (аудит 2026-08-15), не
    // отображается юзеру (см. displayReason, Theme.swift), нужен только чтобы deleteAdvance
    // не стирал чужой аванс того же имени за тот же день.
    private func advanceTag(name: String, amount: Double, id: String) -> String {
        name + " аванс " + Money.s(amount) + "·" + String(id.prefix(8))
    }

    // Синхронный замок от двойного нажатия/параллельной записи денег (аванс, выплата): второй
    // вызов, пришедший пока первый ещё пишет, молча отбрасывается — так исключены дубли (реальный
    // случай: выплата Артемию €1530 записана дважды, SO, 2026-09-14).
    private(set) var moneyBusy = false
    private(set) var advanceError: String?

    func prepareAdvance() -> Bool {
        guard loaded, !moneyBusy else { return false }
        advanceError = nil; toast = nil
        return true
    }

    @discardableResult
    func addAdvance(empId: String, amount: Double, date: String) async -> Bool {
        guard !moneyBusy else { return false }
        advanceError = nil
        func fail(_ message: String) -> Bool {
            advanceError = message; flash(message); return false
        }
        guard amount.isFinite else { return fail(t("mg.topupErrAmount")) }
        let amount = (amount * 100).rounded() / 100
        guard amount.isFinite, amount > 0, let parsedDate = dfKey.date(from: date), key(parsedDate) == date else { return fail(t("bk.saveFailed")) }
        moneyBusy = true
        defer { moneyBusy = false }
        // Аванс относится к зарплате МЕСЯЦА ЭКРАНА (viewMonth), date — только день, когда деньги
        // уходят из инкассации.
        guard loaded, let row = rows.first(where: { $0.id == empId }) else { return fail(t("refreshFailed")) }
        let period = String(key(viewMonth).prefix(7)) + "-01"
        toast = nil
        var payload: [String: Any] = [
            "employee_id": empId, "period": period, "amount": amount, "date": date, "note": row.name + " аванс",
        ]
        // Тег с id аванса (= op_id): по нему удаление уберёт из заметки именно этот аванс.
        let id = opId("add_advance", payload)
        payload["op_id"] = id
        payload["tag"] = advanceTag(name: row.name, amount: amount, id: id)
        let advRow: SalaryAdvance
        do {
            advRow = try await DB.rpcRow("add_advance", args: ["p": payload], cacheInvalidate: Self.moneyTables, as: SalaryAdvance.self)
        } catch {
            let message = await moneyError(error, employeeId: empId)
            _ = fail(message); await load(); return false
        }
        await moneyDone()
        // All financial writes are confirmed. Invalidate older payroll responses, then
        // apply this one advance without recalculating every employee and previous month.
        loadGeneration += 1
        if String(key(viewMonth).prefix(7)) + "-01" == period {
            var updated = rows.first(where: { $0.id == empId }) ?? row
            if !updated.advanceList.contains(where: { $0.id == advRow.id }) {
                updated.advanceList.append(advRow)
                updated.advance = ((updated.advance + amount) * 100).rounded() / 100
                updated.cash = max(0, ((updated.cash - amount) * 100).rounded() / 100)
                updated.remaining = max(0, ((updated.remaining - amount) * 100).rounded() / 100)
            }
            if let index = rows.firstIndex(where: { $0.id == empId }) { rows[index] = updated }
            else { rows.append(updated) }
            loaded = true
        }
        return true
    }

    func deleteAdvance(_ a: SalaryAdvance) async {
        guard !moneyBusy else { return }
        moneyBusy = true
        defer { moneyBusy = false }
        let name = rows.first { $0.id == a.employee_id }?.name ?? ""
        var payload: [String: Any] = [
            "advance_id": a.id, "tag": advanceTag(name: name, amount: a.amount ?? 0, id: a.id), "prefix": name + " аванс",
        ]
        payload["op_id"] = opId("delete_advance", payload)
        do { try await DB.rpc("delete_advance", args: ["p": payload], cacheInvalidate: Self.moneyTables) }
        catch { flash(await moneyError(error, employeeId: a.employee_id ?? "")); return }
        await moneyDone()
        await load()
    }

    func saveMonthlyCard(_ empId: String, _ amount: Double) async {
        let ym = String(key(viewMonth).prefix(7))
        let existing = try? await DB.from("monthly_card_amounts").select().eq("employee_id", empId).eq("month", ym).limit(1).list(CardAmount.self).first
        // B1 (аудит 2026-08-13): regression при переносе из Analytics — раньше здесь была
        // guard-проверка результата (потеря правки при unique-constraint на повторном
        // редактировании в той же сессии молча терялась). Восстановлено.
        if let cid = existing?.id {
            guard (try? await DB.from("monthly_card_amounts").update(["card_amount": amount]).eq("id", cid).run()) != nil else {
                flash(t("bk.saveFailed")); return
            }
        } else {
            guard (try? await DB.from("monthly_card_amounts").insert([
                "restaurant_id": rid, "employee_id": empId, "month": ym, "card_amount": amount,
            ]).run()) != nil else {
                flash(t("bk.saveFailed")); return
            }
        }
        await load()
    }

    // Задолженность = сумма непокрытого остатка по всем ЗАКРЫТЫМ месяцам (строго раньше
    // текущего), окно 6 месяцев назад. debtTrackingStart: до этой фичи (2026-07-28) факт
    // выплаты нигде не фиксировался — легаси-месяцы (до и включая июль 2026) в подсчёт
    // никогда не попадают (юзер-фидбок 2026-07-29, ложный многотысячный долг при включении).
    private var debtTrackingStart: Date { DateComponents(calendar: .current, year: 2026, month: 8, day: 1).date ?? Date() }
    static let salperiodPrefix = "SALPERIOD:"

    private func periodLabel(_ period: String) -> String {
        guard let d = dfKey.date(from: period) else { return period }
        let f = DateFormatter(); f.locale = appLocale(); f.dateFormat = "LLLL yyyy"
        return f.string(from: d)
    }

    func loadDebt() async {
        var total = 0.0; var byEmp: [String: Double] = [:]
        let cal = Calendar.current
        for i in 1...6 {
            guard let d = cal.date(byAdding: .month, value: -i, to: Date()), d >= debtTrackingStart else { continue }
            let list = await computeSalary(monthOf: d)
            for r in list where r.remaining > 0 {
                total += r.remaining
                byEmp[r.id, default: 0] += r.remaining
            }
        }
        debtTotal = total; debtByEmp = byEmp
    }

    // «Отметить как долг»: сумма добавляется к открытому долгу за месяц экрана, гасится
    // галочкой в Manager→Смена.
    @discardableResult
    func markAsDebt(employeeId: String, amount: Double, date: Date) async -> Bool {
        guard amount > 0, !moneyBusy else { return false }
        guard let row = rows.first(where: { $0.id == employeeId }), amount <= row.remaining else {
            flash(t("pe.debtExceedsRemaining", ["avail": Money.s(rows.first(where: { $0.id == employeeId })?.remaining ?? 0)]))
            return false
        }
        moneyBusy = true   // замок от двойного тапа (аудит 2026-09-27)
        defer { moneyBusy = false }
        let period = String(key(viewMonth).prefix(7)) + "-01"
        var payload: [String: Any] = [
            "employee_id": employeeId, "period": period, "date": key(date), "amount": amount,
            "title": "\(t("pe.salaryWord")) — \(periodLabel(period))",
        ]
        payload["op_id"] = opId("add_salary_debt", payload)
        do { try await DB.rpc("add_salary_debt", args: ["p": payload], cacheInvalidate: Self.moneyTables) }
        catch { flash(await moneyError(error, employeeId: employeeId)); return false }
        await moneyDone()
        insufficientFunds = false
        flash(t("pe.markedAsDebt"))
        await load(); await loadDebt()
        return true
    }

    var toast: String?
    private func flash(_ m: String) {
        toast = m
        Task { try? await Task.sleep(nanoseconds: 2_400_000_000); if toast == m { toast = nil } }
    }
    // Веб-паритет payInsufficient (tabs-salary.tsx) — MISE-001, аудит 2026-08-28: раньше
    // недостаток кассы на iOS был тупиком (только toast, ни одного способа продолжить);
    // теперь ManagerMarkPaidSheet показывает «Отметить как долг» тем же способом, что веб.
    var insufficientFunds = false
    // Выплата наличными списывается с инкассации дня оплаты; карта инкассации не касается.
    // Остаток и пул инкассации проверяет база (pay_salary).
    func markSalaryPaid(employeeId: String, employeeName: String, amount: Double, method: String, date: Date, note: String) async -> Bool {
        guard amount > 0 else { return false }
        guard !moneyBusy else { return false }
        moneyBusy = true
        defer { moneyBusy = false }
        insufficientFunds = false
        var payload: [String: Any] = [
            "employee_id": employeeId, "period": String(key(viewMonth).prefix(7)) + "-01",
            "amount": (amount * 100).rounded() / 100, "method": method, "date": key(date),
            "note": note, "entry": "\(employeeName): \(Money.s(amount))",
        ]
        payload["op_id"] = opId("pay_salary", payload)
        do { try await DB.rpc("pay_salary", args: ["p": payload], cacheInvalidate: Self.moneyTables) }
        catch { flash(await moneyError(error, employeeId: employeeId)); return false }
        await moneyDone()
        flash(t("pe.paymentSaved"))
        await load()
        await loadDebt()
        return true
    }
}

// MARK: - View

struct ManagerSalaryTab: View {
    @State private var sm: ManagerSalaryModel?
    let rid: String
    @State private var open: String?
    @State private var payFor: ManagerModel.SalRow?

    var body: some View {
        Group {
            if let sm {
                ManagerSalaryBody(sm: sm, open: $open, payFor: $payFor)
            } else {
                RowListSkeleton(rows: 3)
            }
        }
        .task {
            if sm == nil {
                let model = ManagerSalaryModel(rid: rid)
                sm = model
                await model.load()
                await model.loadDebt()
            }
        }
        // Аванс/оплата может прийти из другого места сессии (или юзер просто ушёл со
        // вкладки и вернулся) — .task грузит модель только один раз за жизнь View, поэтому
        // без onAppear-рефреша строка сотрудника молча показывала бы устаревшие данные
        // (юзер-репорт 2026-08-15: добавленный аванс не отображался в Зарплате).
        .onAppear {
            if let sm { Task { await sm.load(); await sm.loadDebt() } }
        }
        .sheet(item: $payFor) { r in if let sm { ManagerMarkPaidSheet(sm: sm, row: r) } }
    }
}

private struct ManagerSalaryBody: View {
    @Bindable var sm: ManagerSalaryModel
    @Binding var open: String?
    @Binding var payFor: ManagerModel.SalRow?
    @State private var showAdvanceSheet = false
    @State private var advEmpId = ""
    private let accent = BrandKit.manager

    var body: some View {
        VStack(spacing: 12) {
            monthNav
            if !sm.loaded {
                RowListSkeleton(rows: 3)
            } else if sm.rows.isEmpty {
                Text(t("pe.noSalary")).font(.system(size: 15)).foregroundStyle(.primary.opacity(0.4)).padding(.top, 50)
            } else {
                if sm.debtTotal > 0 { debtCard }
                heroCard
                ForEach(sm.rows) { r in
                    VStack(spacing: 0) {
                        Button { withAnimation(.easeInOut(duration: 0.18)) { open = open == r.id ? nil : r.id } } label: {
                            HStack(spacing: 10) {
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(r.name).font(.system(size: 15, weight: .semibold)).foregroundStyle(.primary)
                                    rowSubtitle(r)
                                    if let st = payStatus(r) {
                                        Text(st.0).font(.system(size: 11, weight: .semibold)).foregroundStyle(st.1)
                                    }
                                }
                                Spacer()
                                VStack(alignment: .trailing, spacing: 2) {
                                    Text(eur(r.cash)).font(.system(size: 16, weight: .bold)).foregroundStyle(accent)
                                    if r.card > 0 {
                                        Text(t("pe.cardShort") + " " + eur(r.card))
                                            .font(.system(size: 11)).foregroundStyle(.primary.opacity(0.4))
                                    }
                                }
                                Image(systemName: open == r.id ? "chevron.up" : "chevron.down")
                                    .font(.system(size: 11)).foregroundStyle(.primary.opacity(0.4))
                            }
                            .padding(14)
                        }
                        .buttonStyle(.plain)
                        if open == r.id {
                            breakdown(r).padding(.horizontal, 14).padding(.bottom, 14)
                        }
                    }
                    .background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 14))
                }
            }
            if let toast = sm.toast {
                Text(toast).font(.system(size: 13, weight: .semibold)).foregroundStyle(.primary)
                    .padding(.horizontal, 16).padding(.vertical, 10)
                    .background(.ultraThinMaterial, in: Capsule())
            }
        }
        .sheet(isPresented: $showAdvanceSheet) {
            AdvanceAddSheet(error: sm.advanceError) { amount, date in
                await sm.addAdvance(empId: advEmpId, amount: amount, date: date)
            }
        }
    }

    private var monthNav: some View {
        HStack(spacing: 10) {
            Button { sm.changeMonth(-1) } label: {
                Image(systemName: "chevron.left").font(.system(size: 13, weight: .bold))
                    .frame(width: 34, height: 34).foregroundStyle(.primary)
                    .background(Color.primary.opacity(0.06), in: Circle())
            }
            Text(monthLabel(sm.viewMonth)).font(.system(size: 13, weight: .bold)).foregroundStyle(.primary.opacity(0.55))
                .textCase(.uppercase).frame(maxWidth: .infinity)
            Button { sm.changeMonth(1) } label: {
                Image(systemName: "chevron.right").font(.system(size: 13, weight: .bold))
                    .frame(width: 34, height: 34).foregroundStyle(.primary.opacity(sm.isCurrentMonth ? 0.25 : 1))
                    .background(Color.primary.opacity(0.06), in: Circle())
            }
            .disabled(sm.isCurrentMonth)
        }.disabled(sm.moneyBusy)
    }
    private func monthLabel(_ d: Date) -> String {
        let f = DateFormatter(); f.locale = appLocale(); f.dateFormat = "LLLL yyyy"
        return f.string(from: d)
    }

    private var debtCard: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(t("pe.debtTitle")).font(.system(size: 11, weight: .bold)).foregroundStyle(.red.opacity(0.85)).kerning(0.4).textCase(.uppercase)
            Text(eur(sm.debtTotal)).font(.system(size: 22, weight: .heavy)).foregroundStyle(.red)
            Text(t("pe.debtHint")).font(.system(size: 12)).foregroundStyle(.primary.opacity(0.4))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(Color.red.opacity(0.08), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    private func payStatus(_ r: ManagerModel.SalRow) -> (String, Color)? {
        guard r.total > 0 else { return nil }
        if r.remaining <= 0 {
            let fFrac = ISO8601DateFormatter(); fFrac.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            if let last = r.lastPaidAt, let d = fFrac.date(from: last) ?? ISO8601DateFormatter().date(from: last) {
                return (t("pe.paidOn", ["date": shortDate2(d)]), .green)
            }
            return (t("pe.paidStatus"), .green)
        }
        if r.remaining == r.total { return (t("pe.notPaidYet"), .orange) }
        return (t("pe.oweAmount", ["amount": eur(r.remaining)]), .orange)
    }
    private func shortDate2(_ d: Date) -> String {
        let f = DateFormatter(); f.locale = appLocale(); f.dateFormat = "d MMM"
        return f.string(from: d)
    }

    private var heroCard: some View {
        let totalCash = sm.rows.reduce(0) { $0 + $1.cash }
        // Клампим advance/card по total сотрудника (юзер-фидбок 2026-08-15: «наличными» +
        // «на карту» не давали сумму фонда) — если аванс/карта суммарно ПРЕВЫШАЮТ total
        // (переавансирование, или карта осталась настроена у сотрудника, чей total обнулился
        // прогулами), излишек молча выпадал из cash (max(0, …) в computeSalary), но полностью
        // оставался в totalCard/totalAdvance — фонд наверху и три блока внизу расходились
        // ровно на этот излишек. Приоритет: аванс списывается из total первым, карта — из
        // остатка. cash по каждой строке уже верно (max(0, total-advance-card)), клампим
        // только для агрегатов, чтобы cash+card+advance ВСЕГДА равнялось fund.
        let totalAdvance = sm.rows.reduce(0) { $0 + min($1.advance, $1.total) }
        let totalCard = sm.rows.reduce(0) { s, r in s + min(r.card, max(0, r.total - min(r.advance, r.total))) }
        return VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 4) {
                Text(t("an.payrollFund")).font(.system(size: 12, weight: .semibold)).foregroundStyle(.white.opacity(0.75)).kerning(0.4)
                Text(eur(sm.fund)).font(.system(size: 34, weight: .heavy)).foregroundStyle(.white)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 18).padding(.top, 18).padding(.bottom, 14)
            Divider().overlay(Color.white.opacity(0.15))
            HStack(spacing: 0) {
                heroMini(t("byCash"), eur(totalCash), .white)
                Divider().frame(height: 28).overlay(Color.white.opacity(0.15))
                heroMini(t("toCard"), eur(totalCard), .white.opacity(0.85))
                if totalAdvance > 0 {
                    Divider().frame(height: 28).overlay(Color.white.opacity(0.15))
                    heroMini(t("an.advance"), eur(totalAdvance), .white.opacity(0.85))
                }
            }
            .padding(.vertical, 10)
            if sm.isCurrentMonth {
                Divider().overlay(Color.white.opacity(0.15))
                Text("\(t("pe.accruedToday")) \(eur(sm.accruedToday)) · \(t("pe.accruedTodayHint"))")
                    .font(.system(size: 11)).foregroundStyle(.white.opacity(0.75))
                    .padding(.horizontal, 18).padding(.vertical, 10)
            }
        }
        .background(LinearGradient(colors: [accent, accent.opacity(0.75)],
                                   startPoint: .topLeading, endPoint: .bottomTrailing),
                    in: RoundedRectangle(cornerRadius: 20, style: .continuous))
    }

    @ViewBuilder
    private func breakdown(_ r: ManagerModel.SalRow) -> some View {
        VStack(spacing: 0) {
            bline(t("baseSalary"), eur(r.salary), .primary.opacity(0.85))
            if !r.absenceList.isEmpty {
                sectionHeader(t("absencesN", ["n": "\(r.absences)"]), BrandKit.menu)
                ForEach(Array(r.absenceList.enumerated()), id: \.offset) { _, d in
                    bline(shortDate(d), "−" + eur(r.deduct / Double(max(1, r.absences))), BrandKit.menu)
                }
            } else if r.deduct > 0 {
                bline(t("pe.deductN", ["n": "\(r.absences)"]), "−" + eur(r.deduct), BrandKit.menu)
            }
            if !r.advanceList.isEmpty {
                sectionHeader(t("an.advance"), BrandKit.stash)
                ForEach(r.advanceList.sorted { ($0.date ?? "") < ($1.date ?? "") }) { adv in
                    HStack {
                        Text(adv.date.map { shortDate($0) } ?? t("an.advance")).font(.system(size: 13)).foregroundStyle(.primary.opacity(0.55))
                        Spacer()
                        Text("−" + eur(adv.amount ?? 0)).font(.system(size: 13, weight: .semibold)).foregroundStyle(BrandKit.stash)
                        Button { Task { await sm.deleteAdvance(adv) } } label: {
                            Image(systemName: "xmark.circle").font(.system(size: 14)).foregroundStyle(.primary.opacity(0.3))
                        }
                    }
                    .padding(.vertical, 5)
                }
            }
            Button { if sm.prepareAdvance() { advEmpId = r.id; showAdvanceSheet = true } } label: {
                Label(t("an.addAdvance"), systemImage: "plus")
                    .font(.system(size: 13, weight: .semibold)).foregroundStyle(BrandKit.stash)
            }
            .padding(.top, 4)
            Divider().overlay(Color.primary.opacity(0.07)).padding(.vertical, 4)
            CardInputRow(empId: r.id, current: r.card) { amt in
                Task { await sm.saveMonthlyCard(r.id, amt) }
            }
            .id(sm.viewMonth.description + r.id)
            Divider().overlay(Color.primary.opacity(0.1)).padding(.vertical, 4)
            bline(t("byCash"), eur(r.cash), accent, bold: true)
            if let st = payStatus(r) {
                Divider().overlay(Color.primary.opacity(0.07)).padding(.vertical, 4)
                HStack {
                    Text(st.0).font(.system(size: 13, weight: .semibold)).foregroundStyle(st.1)
                    Spacer()
                    if r.remaining > 0 {
                        Button { payFor = r } label: {
                            Text(t("pe.markPaid")).font(.system(size: 12, weight: .bold)).foregroundStyle(.white)
                                .padding(.horizontal, 12).padding(.vertical, 6)
                                .background(accent, in: Capsule())
                        }
                    }
                }
            }
        }
        .padding(14)
        .background(Color.primary.opacity(0.05), in: RoundedRectangle(cornerRadius: 14))
    }

    private func rowSubtitle(_ r: ManagerModel.SalRow) -> some View {
        var parts: [String] = [t("baseSalary") + " " + eur(r.salary)]
        if r.absences > 0 { parts.append(t("absencesN", ["n": "\(r.absences)"])) }
        if r.advance > 0  { parts.append(t("an.advance") + " " + eur(r.advance)) }
        return Text(parts.joined(separator: " · ")).font(.system(size: 11)).foregroundStyle(.primary.opacity(0.4)).lineLimit(1)
    }
    private func sectionHeader(_ label: String, _ color: Color) -> some View {
        Text(label.uppercased()).font(.system(size: 10, weight: .semibold)).foregroundStyle(color.opacity(0.8)).kerning(0.5)
            .frame(maxWidth: .infinity, alignment: .leading).padding(.top, 10).padding(.bottom, 2)
    }
    private func bline(_ l: String, _ v: String, _ c: Color, bold: Bool = false) -> some View {
        HStack {
            Text(l).font(.system(size: 13)).foregroundStyle(.primary.opacity(0.55))
            Spacer()
            Text(v).font(.system(size: 13, weight: bold ? .bold : .semibold)).foregroundStyle(c)
        }
        .padding(.vertical, 5)
    }
    private func heroMini(_ label: String, _ value: String, _ color: Color) -> some View {
        VStack(spacing: 2) {
            Text(value).font(.system(size: 15, weight: .bold)).foregroundStyle(color)
            Text(label).font(.system(size: 11)).foregroundStyle(color.opacity(0.7))
        }.frame(maxWidth: .infinity)
    }
    private func shortDate(_ ymd: String) -> String {
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.locale = Locale(identifier: "en_US_POSIX")
        guard let d = f.date(from: ymd) else { return ymd }
        let out = DateFormatter(); out.locale = appLocale(); out.dateFormat = "d MMM"
        return out.string(from: d)
    }
}

private struct ManagerMarkPaidSheet: View {
    let sm: ManagerSalaryModel
    let row: ManagerModel.SalRow
    @Environment(\.dismiss) private var dismiss
    @State private var amount: String
    @State private var method: String = "cash"
    @State private var date = Date()
    @State private var note = ""
    @State private var saving = false
    @State private var markingDebt = false

    init(sm: ManagerSalaryModel, row: ManagerModel.SalRow) {
        self.sm = sm; self.row = row
        let rest = (row.remaining * 100).rounded() / 100
        _amount = State(initialValue: rest == rest.rounded() ? String(Int(rest)) : String(format: "%.2f", rest))
    }

    var body: some View {
        NavigationStack {
            Form {
                // Ошибка из markSalaryPaid (недостаточно в инкассации, гонка, нет смены) раньше
                // уходила в sm.toast, который рендерится в ManagerSalaryBody — под этой шторкой,
                // невидимо. Юзер жал «Сохранить выплату», шторка не закрывалась, а почему —
                // не было видно совсем: выглядело как «кнопка ничего не делает».
                if let toast = sm.toast {
                    Section { Text(toast).font(.system(size: 13, weight: .semibold)).foregroundStyle(.red) }
                }
                Section {
                    HStack {
                        Text(t("pe.paymentAmount"))
                        Spacer()
                        TextField("0", text: $amount).keyboardType(.decimalPad).multilineTextAlignment(.trailing)
                    }
                    Picker(t("pe.paymentMethod"), selection: $method) {
                        Text(t("pe.methodCash")).tag("cash")
                        Text(t("pe.methodCard")).tag("card")
                    }.pickerStyle(.segmented)
                    DatePicker(t("pe.paymentDate"), selection: $date, displayedComponents: .date)
                    TextField(t("pe.paymentNote"), text: $note)
                }
                // Веб-паритет (payInsufficient, tabs-salary.tsx) — MISE-001: нехватка кассы
                // раньше была на iOS тупиком (только toast, ни одного способа продолжить).
                if sm.insufficientFunds {
                    Section {
                        Button(role: .none) {
                            markingDebt = true
                            Task {
                                await sm.markAsDebt(employeeId: row.id, amount: Double(amount.replacingOccurrences(of: ",", with: ".")) ?? 0, date: date)
                                markingDebt = false
                                dismiss()
                            }
                        } label: {
                            HStack { Spacer(); Text(t("pe.markAsDebt")); Spacer() }
                        }
                        .disabled(markingDebt)
                        .foregroundStyle(.orange)
                    }
                }
            }
            .navigationTitle(t("pe.markPaid") + " · " + row.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(t("cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(t("pe.savePayment")) {
                        saving = true
                        Task {
                            let ok = await sm.markSalaryPaid(employeeId: row.id, employeeName: row.name,
                                                              amount: Double(amount.replacingOccurrences(of: ",", with: ".")) ?? 0,
                                                              method: method, date: date, note: note)
                            saving = false
                            if ok { dismiss() }
                        }
                    // C5 (аудит 2026-08-13): disabled сверял Double(amount) БЕЗ замены запятой,
                    // хотя сам save её заменяет — на ru-раскладке (десятичная запятая) кнопка
                    // оставалась disabled навсегда. Теперь сверяются одинаково.
                    }.disabled(saving || (Double(amount.replacingOccurrences(of: ",", with: ".")) ?? 0) <= 0)
                }
            }
            .toolbarBackground(Color.miseBg, for: .navigationBar)
            // Сброс при открытии — иначе stale true от предыдущей (другой) попытки оплаты
            // мог показать «Отметить как долг» для строки, где кассы ещё хватает.
            .onAppear { sm.insufficientFunds = false }
        }
    }
}
