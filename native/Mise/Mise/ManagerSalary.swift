import SwiftUI

// MARK: - Manager → Зарплата (реструктура 2026-08-13, см.
// docs/MANAGER-PEOPLE-RESTRUCTURE-2026-08-13.md). Фонд/долг/список всех сотрудников/оплата —
// сюда, перенесено из People→Зарплата (там остался только личный вид, PeopleTasksSalary.swift).
// markSalaryPaid списывает инкассацию дня оплаты напрямую (inkassations.salary/salary_note).

extension ManagerModel {
    struct SalRow: Identifiable {
        let id: String; let name: String; let salary: Double; let absences: Int
        let absenceList: [String]
        let deduct: Double; let card: Double; let advance: Double
        let advanceList: [SalaryAdvance]; let total: Double; let cash: Double
        var paid: Double = 0; var remaining: Double = 0; var lastPaidAt: String? = nil
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

    var isCurrentMonth: Bool { Calendar.current.isDate(viewMonth, equalTo: Date(), toGranularity: .month) }
    var fund: Double { rows.reduce(0) { $0 + $1.total } }
    // Буфер до реального дня выплаты (salary_payout_day, ЗП-долг 2026-07-28): ЗП за месяц
    // выдаётся 10-15 числа СЛЕДУЮЩЕГО месяца, поэтому 100% начисления должно достигаться не
    // в конце текущего месяца, а на payout_day следующего.
    var accruedToday: Double {
        guard isCurrentMonth else { return fund }
        let cal = Calendar.current
        let day = cal.component(.day, from: Date())
        let daysInMonth = cal.range(of: .day, in: .month, for: viewMonth)?.count ?? 30
        let denom = payoutDay.map { daysInMonth + $0 } ?? daysInMonth
        return fund * Double(min(day, denom)) / Double(denom)
    }

    private let dfKey: DateFormatter = {
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.locale = Locale(identifier: "en_US_POSIX")
        return f
    }()
    func key(_ d: Date) -> String { dfKey.string(from: d) }

    func changeMonth(_ dir: Int) {
        if dir > 0 && isCurrentMonth { return }
        guard let d = Calendar.current.date(byAdding: .month, value: dir, to: viewMonth) else { return }
        viewMonth = d
        Task { await load() }
    }

    // Канон расчёта — решение 2026-07-17, паритет с PeopleModel.computeSalary (личный вид).
    private func computeSalary(monthOf date: Date) async -> [ManagerModel.SalRow] {
        let cal = Calendar.current
        let ym = String(key(date).prefix(7))
        let monthStart = cal.date(from: cal.dateComponents([.year, .month], from: date)) ?? date
        let monthEnd = cal.date(byAdding: DateComponents(month: 1, day: -1), to: monthStart) ?? monthStart
        async let empsR = try? DB.from("employees").select("id, name, salary, deduct_per_absence").eq("is_active", true).order("name").list(Employee.self)
        async let absR = try? DB.from("shift_absences").select("employee_id, date, source").gte("date", ym + "-01").lte("date", key(monthEnd)).list(Absence.self)
        async let cardsR = try? DB.from("monthly_card_amounts").select("employee_id, card_amount").eq("month", ym).list(CardAmount.self)
        async let advR = try? DB.from("salary_advances").select().gte("date", ym + "-01").lte("date", key(monthEnd)).list(SalaryAdvance.self)
        async let paysR = try? DB.from("salary_payments").select().eq("period", ym + "-01").list(SalaryPayment.self)
        guard let employees = await empsR else { return [] }
        let absences = (await absR) ?? [], cardAmounts = (await cardsR) ?? []
        let advances = (await advR) ?? [], payments = (await paysR) ?? []

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
            let lastPaidAt = paysForEmp.compactMap { $0.paid_at }.max()
            let total = max(0, (e.salary ?? 0) - deduct)
            let cash = max(0, total - advance - card)
            let remaining = max(0, cash - paid)
            return ManagerModel.SalRow(id: e.id, name: e.name, salary: e.salary ?? 0, absences: absN, absenceList: absenceList, deduct: deduct, card: card, advance: advance, advanceList: advForEmp, total: total, cash: cash, paid: paid, remaining: remaining, lastPaidAt: lastPaidAt)
        }
    }

    func load() async {
        if payoutDay == nil {
            payoutDay = (try? await DB.from("restaurant_settings").select("salary_payout_day").limit(1).list(PayoutDayRow.self))?.first?.salary_payout_day
        }
        rows = await computeSalary(monthOf: viewMonth)
        loaded = true
    }

    // Аванс/сумма на карту — перенесено из AnalyticsView.AnalyticsModel (юзер-фидбок
    // 2026-08-14: Analytics стал read-only, редактирование — только здесь, единая точка,
    // без риска задвоенной правки). Логика письма в инкассацию не менялась.
    private func findShift(forDate date: String) async -> Shift? {
        (try? await DB.from("shifts").select().eq("date", date).order("opened_at", ascending: false).limit(1).list(Shift.self))?.first
    }
    private func findInkassation(forShiftId shiftId: String) async -> Inkassation? {
        try? await DB.from("inkassations").select("shift_id, amount, expense, reason, total, salary, salary_note")
            .eq("shift_id", shiftId).limit(1).list(Inkassation.self).first
    }

    func addAdvance(empId: String, amount: Double, date: String) async {
        let empName = rows.first { $0.id == empId }?.name ?? ""
        guard (try? await DB.from("salary_advances").insert([
            "restaurant_id": rid, "employee_id": empId,
            "amount": amount, "date": date, "note": empName + " аванс",
        ] as [String: Any]).single(SalaryAdvance.self)) != nil else { flash(t("bk.saveFailed")); return }

        if let shift = await findShift(forDate: date) {
            let ink = await findInkassation(forShiftId: shift.id)
            let baseAmount = ink?.amount ?? (shift.inkassation ?? 0)
            let newExpense = (ink?.expense ?? 0) + amount
            let reasonParts = [ink?.reason?.isEmpty == false ? ink?.reason : nil, empName + " аванс"].compactMap { $0 }
            let newReason = reasonParts.joined(separator: ", ")
            let newTotal = baseAmount - newExpense - (ink?.salary ?? 0)
            if ink != nil {
                try? await DB.from("inkassations").update([
                    "expense": newExpense, "reason": newReason, "total": newTotal,
                ] as [String: Any]).eq("shift_id", shift.id).run()
            } else {
                try? await DB.from("inkassations").insert([
                    "shift_id": shift.id, "restaurant_id": rid, "date": shift.date,
                    "amount": baseAmount, "expense": newExpense, "reason": newReason,
                    "salary": 0, "total": newTotal,
                ] as [String: Any]).run()
            }
        } else {
            flash(t("bk.advanceInkassationMissing"))
        }
        await load()
    }

    func deleteAdvance(_ a: SalaryAdvance) async {
        do { try await DB.from("salary_advances").delete().eq("id", a.id).run() }
        catch { flash(t("saveFailed", ["err": error.localizedDescription])); return }
        if let date = a.date, let shift = await findShift(forDate: date), let ink = await findInkassation(forShiftId: shift.id) {
            let empName = rows.first { $0.id == a.employee_id }?.name ?? ""
            let newExpense = max(0, (ink.expense ?? 0) - (a.amount ?? 0))
            let newReason = (ink.reason ?? "").components(separatedBy: ", ").filter { !$0.hasPrefix(empName + " аванс") }.joined(separator: ", ")
            let newTotal = (ink.amount ?? (shift.inkassation ?? 0)) - newExpense - (ink.salary ?? 0)
            try? await DB.from("inkassations").update([
                "expense": newExpense, "reason": newReason, "total": newTotal,
            ] as [String: Any]).eq("shift_id", shift.id).run()
        }
        await load()
    }

    func saveMonthlyCard(_ empId: String, _ amount: Double) async {
        let ym = String(key(viewMonth).prefix(7))
        let existing = try? await DB.from("monthly_card_amounts").select().eq("employee_id", empId).eq("month", ym).limit(1).list(CardAmount.self).first
        if let cid = existing?.id {
            try? await DB.from("monthly_card_amounts").update(["card_amount": amount]).eq("id", cid).run()
        } else {
            try? await DB.from("monthly_card_amounts").insert([
                "restaurant_id": rid, "employee_id": empId, "month": ym, "card_amount": amount,
            ]).run()
        }
        await load()
    }

    // Задолженность = сумма непокрытого остатка по всем ЗАКРЫТЫМ месяцам (строго раньше
    // текущего), окно 6 месяцев назад. debtTrackingStart: до этой фичи (2026-07-28) факт
    // выплаты нигде не фиксировался — легаси-месяцы (до и включая июль 2026) в подсчёт
    // никогда не попадают (юзер-фидбок 2026-07-29, ложный многотысячный долг при включении).
    private var debtTrackingStart: Date { DateComponents(calendar: .current, year: 2026, month: 8, day: 1).date ?? Date() }
    func loadDebt() async {
        var total = 0.0; var byEmp: [String: Double] = [:]
        for i in 1...6 {
            guard let d = Calendar.current.date(byAdding: .month, value: -i, to: Date()), d >= debtTrackingStart else { continue }
            let list = await computeSalary(monthOf: d)
            for r in list where r.remaining > 0 {
                total += r.remaining
                byEmp[r.id, default: 0] += r.remaining
            }
        }
        debtTotal = total; debtByEmp = byEmp
    }

    // Смена/инкассация на дату оплаты может не существовать (менеджер платит задним/будущим
    // числом) — создаём её тем же паттерном, что ManagerModel.openShift (opening = closing
    // предыдущей смены, gap-tolerant).
    private func prevClosingForPayout(before date: Date) async throws -> Double {
        let y = Calendar.current.date(byAdding: .day, value: -1, to: date) ?? date
        let rows = try await DB.from("shifts").select("closing_balance")
            .lte("date", key(y)).order("date", ascending: false).order("opened_at", ascending: false).limit(1).list(ClosingOnly.self)
        return rows.first?.closing_balance ?? 0
    }
    private func ensureShift(dateStr: String, before date: Date) async -> String? {
        if let existing = try? await DB.from("shifts").select().eq("date", dateStr).order("opened_at").list(Shift.self), let sh = existing.first {
            return sh.id
        }
        guard let opening = try? await prevClosingForPayout(before: date) else { return nil }
        let values: [String: Any] = [
            "restaurant_id": rid, "date": dateStr,
            "opening_balance": opening, "income": 0, "inkassation": 0,
            "closing_balance": opening, "status": "open",
        ]
        guard let sh = try? await DB.from("shifts").insert(values).single(Shift.self) else { return nil }
        return sh.id
    }

    // Выплата ЗП «прямо из инкассации» (юзер-фидбок 2026-08-13): одно действие одновременно
    // фиксирует факт выплаты (salary_payments) И списывает её с инкассации ДНЯ, выбранного в
    // шторке оплаты — inkassations.salary += amount, salary_note дописывается «Имя: Сумма».
    // Карта — безнал, кассы не касается, списывается только method="cash". Уход в минус
    // запрещён: сумма не может превышать (amount − expense − уже списанная salary).
    var toast: String?
    private func flash(_ m: String) {
        toast = m
        Task { try? await Task.sleep(nanoseconds: 2_400_000_000); if toast == m { toast = nil } }
    }
    func markSalaryPaid(employeeId: String, employeeName: String, amount: Double, method: String, date: Date, note: String) async -> Bool {
        guard amount > 0 else { return false }
        let dateStr = key(date)

        if method == "cash" {
            guard let shiftId = await ensureShift(dateStr: dateStr, before: date) else {
                flash(t("saveFailed", ["err": "shift"])); return false
            }
            struct InkRow: Codable, Sendable { let id: String; let amount: Double?; let expense: Double?; let salary: Double?; let salary_note: String? }
            let current = try? await DB.from("inkassations").select("id, amount, expense, salary, salary_note")
                .eq("shift_id", shiftId).limit(1).list(InkRow.self).first
            let available = (current?.amount ?? 0) - (current?.expense ?? 0) - (current?.salary ?? 0)
            guard amount <= available else {
                flash(t("pe.insufficientInkassation", ["date": dateStr, "avail": Money.s(max(0, available))]))
                return false
            }
            let noteEntry = "\(employeeName): \(Money.s(amount))"
            let mergedNote = [current?.salary_note, noteEntry].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: "; ")
            let values: [String: Any] = [
                "restaurant_id": rid, "date": dateStr,
                "salary": (current?.salary ?? 0) + amount, "salary_note": mergedNote,
            ]
            do {
                if let id = current?.id {
                    try await DB.from("inkassations").update(values).eq("id", id).run()
                } else {
                    try await DB.from("inkassations").insert(values.merging(["shift_id": shiftId]) { a, _ in a }).run()
                }
            } catch { flash(t("saveFailed", ["err": error.localizedDescription])); return false }
        }

        let period = String(key(viewMonth).prefix(7)) + "-01"
        let paidAt = ISO8601DateFormatter().string(from: date)
        let noteVal: Any = note.isEmpty ? NSNull() : note
        do {
            try await DB.from("salary_payments").insert([
                "employee_id": employeeId, "period": period, "amount": amount, "method": method,
                "paid_at": paidAt, "note": noteVal,
            ]).run()
        } catch { flash(t("saveFailed", ["err": error.localizedDescription])); return false }
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
            let cal = Calendar.current
            let monthStart = cal.date(from: cal.dateComponents([.year, .month], from: sm.viewMonth)) ?? sm.viewMonth
            let monthEnd = cal.date(byAdding: DateComponents(month: 1, day: -1), to: monthStart) ?? monthStart
            AdvanceAddSheet(monthRange: monthStart...monthEnd) { amount, date in
                Task { await sm.addAdvance(empId: advEmpId, amount: amount, date: date) }
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
        }
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
        let totalCard = sm.rows.reduce(0) { $0 + $1.card }
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
            Button { advEmpId = r.id; showAdvanceSheet = true } label: {
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

    init(sm: ManagerSalaryModel, row: ManagerModel.SalRow) {
        self.sm = sm; self.row = row
        _amount = State(initialValue: String(Int(row.remaining.rounded())))
    }

    var body: some View {
        NavigationStack {
            Form {
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
                    }.disabled(saving || (Double(amount) ?? 0) <= 0)
                }
            }
            .toolbarBackground(Color.miseBg, for: .navigationBar)
        }
    }
}
