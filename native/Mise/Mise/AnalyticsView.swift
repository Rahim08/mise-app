import SwiftUI
import Charts

private func cur(_ v: Double) -> String { Money.s(v) }
private func kg(_ g: Double) -> String {
    if g >= 1000 {
        let f = NumberFormatter(); f.numberStyle = .decimal
        f.minimumFractionDigits = 0; f.maximumFractionDigits = 2   // точно, без округления до целых
        return (f.string(from: NSNumber(value: g / 1000)) ?? "0") + " кг"
    }
    return "\(Int(g.rounded())) г"
}

// MARK: - Модель Analytics (кокпит владельца) — логика app/analytics/page.tsx

@MainActor
@Observable
final class AnalyticsModel {
    let rid: String
    var tab = "period"
    var loading = true
    var currentDate: Date
    var showPrevious = false // показать сравнение с прошлым месяцем
    var toast: String?
    func flash(_ m: String) {
        toast = m
        Task { try? await Task.sleep(nanoseconds: 2_400_000_000); if toast == m { toast = nil } }
    }

    var includeCard = false
    var hkPrice = 0.0
    var hkPortion = 20.0
    var payoutDay: Int? = nil // restaurant_settings.salary_payout_day — только для «до выплаты N дн.», в рамп начисления НЕ входит
    var kassaMode = "kassa"
    var periodMode = "month" // day | week | month
    var cumulativeInkass = 0.0 // инкассация накопительно (до конца выбранного месяца)

    // Банк (Open Banking, Enable Banking) — вкладка «Банк» заменила «Прогноз» (5-таб
    // лимит iOS, см. комментарий у TabView в AnalyticsBody). connection == nil, пока не
    // подключено (или status != "linked").
    var bankConnection: BankConnection?
    var bankTx: [BankTransaction] = []
    var bankBusy = false
    var bankCountry = "IT" // целевой рынок после теста на личном Revolut юзера
    var bankQuery = ""
    var bankInstitutions: [BankInstitutionDTO] = []
    var bankError: String?

    var shiftsRaw: [Shift] = []
    var prevShiftsRaw: [Shift] = []
    var expenses: [ShiftExpense] = []
    var prevExpenses: [ShiftExpense] = []
    var pinnedCats: Set<String> = []   // закреплённые категории — первыми в разбивке
    var employees: [Employee] = []
    var cardAmounts: [CardAmount] = []
    var absences: [Absence] = []

    var inkDetails: [String: Inkassation] = [:]
    var advances: [SalaryAdvance] = []
    var payments: [SalaryPayment] = []
    // Прошлый месяц — для «Начислено» до payout_day (см. cycleTotalCash в карточке кассы):
    // до дня выплаты карточка ещё показывает не выплаченную ЗП за прошлый месяц.
    var prevCardAmounts: [CardAmount] = []
    var prevAbsences: [Absence] = []
    var prevAdvances: [SalaryAdvance] = []

    func handleAI(_ message: String) async -> String? {
        // expenses by category (current period)
        var catTotals: [String: Double] = [:]
        for e in expenses where countsInRollup(e) { catTotals[e.category_name ?? "—", default: 0] += e.amount ?? 0 }
        let catLines = catTotals.sorted { $0.value > $1.value }
            .map { "\($0.key): \(Money.s($0.value))" }.joined(separator: ", ")

        // extras by employee (current period)
        var empTotals: [String: Double] = [:]
        for e in expenses {
            guard let eid = e.employee_id else { continue }
            let name = employees.first { $0.id == eid }?.name ?? eid
            empTotals[name, default: 0] += e.amount ?? 0
        }
        let empLines = empTotals.sorted { $0.value > $1.value }
            .map { "\($0.key): \(Money.s($0.value))" }.joined(separator: ", ")

        // prev month expenses by category
        var prevCatTotals: [String: Double] = [:]
        for e in prevExpenses { prevCatTotals[e.category_name ?? "—", default: 0] += e.amount ?? 0 }
        let prevCatLines = prevCatTotals.sorted { $0.value > $1.value }
            .map { "\($0.key): \(Money.s($0.value))" }.joined(separator: ", ")

        // inkassation details per shift
        let inkLines = shiftsWithInk.map { s -> String in
            let ink = inkDetails[s.id]
            let rsn = ink?.reason.map { " (\($0))" } ?? ""
            return "\(s.date): gross \(Money.s(s.inkassation ?? 0)), expense \(Money.s(ink?.expense ?? 0))\(rsn), net \(Money.s(ink?.total ?? (s.inkassation ?? 0)))"
        }.joined(separator: "; ")

        // hookah by type
        let typeLines = byType.map { "\($0.name): \($0.paid) paid + \($0.free) free" }.joined(separator: ", ")

        // tobacco warehouse stock
        let stockLines = stockRows.map { "\($0.brand) \($0.flavor): \(kg($0.quantity_g))" }.joined(separator: ", ")

        // employee salary breakdown
        let salLines = salaryRows.map { r -> String in
            var line = "\(r.name): salary \(Money.s(r.salary))"
            if r.abs > 0 { line += ", absences \(r.abs) (-\(Money.s(r.deduct)))" }
            line += ", net \(Money.s(r.total))"
            return line
        }.joined(separator: "; ")

        // ИИ должен видеть полную выручку (нал+карта) независимо от переключателя
        // includeCard, который влияет только на то, что владелец решил показывать в UI.
        let last = shiftsRaw.last
        let lastDay = last.map { s in
            "Last shift \(s.date): income \(Money.s((s.income ?? 0) + (s.income_card ?? 0))), expenses \(Money.s(s.total_expense ?? 0)), kassa \(Money.s(s.closing_balance ?? 0))."
        } ?? "No shifts yet."
        let totalIncomeCombined = shiftsRaw.reduce(0) { $0 + ($1.income ?? 0) + ($1.income_card ?? 0) }
        let prevIncomeCombined = prevShiftsRaw.reduce(0) { $0 + ($1.income ?? 0) + ($1.income_card ?? 0) }

        let ctx = """
            Period: \(navLabel).
            Revenue: \(Money.s(totalIncomeCombined)) (prev month: \(Money.s(prevIncomeCombined))).
            Expenses: \(Money.s(totalExpense)) (prev month: \(Money.s(prevExpense))).
            Expense breakdown this period: \(catLines.isEmpty ? "none" : catLines).
            \(empLines.isEmpty ? "" : "Employee extras this period: \(empLines).")
            Prev month expense breakdown: \(prevCatLines.isEmpty ? "none" : prevCatLines).
            Shifts: \(shiftsRaw.count). \(lastDay)
            Cash collections (\(shiftsWithInk.count)): \(inkLines.isEmpty ? "none" : inkLines).
            Total inkass: gross \(Money.s(totalInkass)), net \(Money.s(totalInkassNet)).
            Hookah this period: \(qtyMonth) paid + \(qtyFree) free, revenue \(Money.s(revMonth)). By type: \(typeLines.isEmpty ? "none" : typeLines).
            Tobacco in venue: \(kg(venueAtPlaceG)). Warehouse total: \(kg(stockG)) (\(String(format: "%.0f", stockG)) g). Per-flavor warehouse stock: \(stockLines.isEmpty ? "none" : stockLines).
            Payroll fund: \(Money.s(payrollTotal)). Per employee: \(salLines.isEmpty ? "none" : salLines).
            """

        do {
            let result = try await API.aiChat(module: "analytics", message: message, context: ctx)
            return result["reply"] as? String ?? t("ai.noReply")
        } catch {
            return aiErrorMessage(error)
        }
    }

    var hookahRows: [HookahSale] = []
    var allHookah: [HookahSale] = []
    var stockRows: [StockItem] = []
    var issuedG = 0.0
    var stockG = 0.0
    var types: [HookahType] = []

    init(rid: String, dayStartHour: Int = 6) {
        self.rid = rid
        self.currentDate = AppModel.businessDate(dayStartHour: dayStartHour)
    }

    private let df: DateFormatter = {
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.locale = Locale(identifier: "en_US_POSIX"); return f
    }()
    func key(_ d: Date) -> String { df.string(from: d) }
    /// Последний день месяца "yyyy-MM" как "yyyy-MM-dd" — "-31" в 30-дневных месяцах
    /// невалидная дата для колонки типа date (400 → авансы молча пропадали).
    func monthEndKey(_ ym: String) -> String {
        guard let start = df.date(from: ym + "-01"),
              let end = Calendar.current.date(byAdding: DateComponents(month: 1, day: -1), to: start)
        else { return ym + "-28" }
        return key(end)
    }

    // Кэш all-time данных (инкассация-история для cumulativeInkass, кальян-склад) — эти
    // запросы шли БЕЗ границы даты вообще и гонялись заново на КАЖДУЮ навигацию по месяцам
    // (каждая стрелка, каждая вкладка), хотя основа не зависит от currentDate — только verdict
    // "на конец какого месяца" считается локально. Теперь фетчатся один раз за сессию,
    // обновляются только явным pull-to-refresh (forceRefresh: true).
    private var histLoaded = false
    nonisolated struct ShiftInkRow: Codable, Sendable { let date: String; let inkassation: Double? }
    nonisolated struct InkDeductRow: Codable, Sendable { let date: String?; let expense: Double?; let salary: Double? }
    private var allShiftInkRows: [ShiftInkRow] = []
    private var allInkDedRows: [InkDeductRow] = []

    func load(forceRefresh: Bool = false) async {
        #if DEBUG
        if ProcessInfo.processInfo.environment["MISE_DEMO_UI"] == "1" { seedDemo(); return }
        #endif
        if forceRefresh { histLoaded = false }
        loading = true; defer { loading = false }
        let cal = Calendar.current
        let monthStart = cal.date(from: cal.dateComponents([.year, .month], from: currentDate)) ?? currentDate
        let monthEnd = cal.date(byAdding: DateComponents(month: 1, day: -1), to: monthStart) ?? monthStart
        let prevStart = cal.date(byAdding: .month, value: -1, to: monthStart) ?? monthStart
        let prevEnd = cal.date(byAdding: .day, value: -1, to: monthStart) ?? monthStart
        let ym = String(key(currentDate).prefix(7))

        if let s = try? await DB.from("restaurant_settings").select().limit(1).list(AnalyticsSettings.self).first {
            includeCard = s.include_card_in_analytics ?? false
            hkPrice = s.hookah_price ?? 0
            hkPortion = s.hookah_portion_g ?? 20
            payoutDay = s.salary_payout_day
        }

        // Грузим в optional и присваиваем в state ТОЛЬКО при успехе: при сетевом сбое
        // (напр. pull-to-refresh без связи) прошлые данные сохраняются, а не обнуляются.
        async let sh = try? DB.from("shifts").select().gte("date", key(monthStart)).lte("date", key(monthEnd)).order("date").list(Shift.self)
        async let prev = try? DB.from("shifts").select().gte("date", key(prevStart)).lte("date", key(prevEnd)).order("date").list(Shift.self)
        async let emps = try? DB.from("employees").select().eq("is_active", true).order("name").list(Employee.self)
        async let cards = try? DB.from("monthly_card_amounts").select("id, employee_id, card_amount").eq("month", ym).list(CardAmount.self)
        async let abs = try? DB.from("shift_absences").select().gte("date", key(monthStart)).lte("date", key(monthEnd)).list(Absence.self)
        async let hk = try? DB.from("hookah_sales").select().gte("date", key(monthStart)).lte("date", key(monthEnd)).order("date").list(HookahSale.self)
        let prevYm = String(key(prevStart).prefix(7))
        async let prevCards = try? DB.from("monthly_card_amounts").select("id, employee_id, card_amount").eq("month", prevYm).list(CardAmount.self)
        async let prevAbs = try? DB.from("shift_absences").select().gte("date", key(prevStart)).lte("date", key(prevEnd)).list(Absence.self)
        async let prevAdv = try? DB.from("salary_advances").select().gte("date", key(prevStart)).lte("date", key(prevEnd)).list(SalaryAdvance.self)

        shiftsRaw = (await sh) ?? shiftsRaw
        prevShiftsRaw = (await prev) ?? prevShiftsRaw
        employees = (await emps) ?? employees
        cardAmounts = (await cards) ?? cardAmounts
        if let a = await abs { absences = a.filter { $0.source != "auto" } }
        hookahRows = (await hk) ?? hookahRows
        prevCardAmounts = (await prevCards) ?? prevCardAmounts
        if let pa = await prevAbs { prevAbsences = pa.filter { $0.source != "auto" } }
        prevAdvances = (await prevAdv) ?? prevAdvances

        let ids = shiftsRaw.map(\.id)
        if !ids.isEmpty {
            if let e = try? await DB.from("shift_expenses").select().in("shift_id", ids).list(ShiftExpense.self) { expenses = e }
            if let inks = try? await DB.from("inkassations").select("shift_id, amount, expense, reason, total, salary, salary_note").in("shift_id", ids).list(Inkassation.self) {
                var d: [String: Inkassation] = [:]
                for ink in inks { if let sid = ink.shift_id { d[sid] = ink } }
                inkDetails = d
            }
        } else { expenses = []; inkDetails = [:] }

        let prevIds = prevShiftsRaw.map(\.id)
        if !prevIds.isEmpty {
            if let pe = try? await DB.from("shift_expenses").select().in("shift_id", prevIds).list(ShiftExpense.self) { prevExpenses = pe }
        } else { prevExpenses = [] }

        if let adv = try? await DB.from("salary_advances").select()
            .gte("date", key(monthStart)).lte("date", key(monthEnd)).list(SalaryAdvance.self) { advances = adv }
        if let pays = try? await DB.from("salary_payments").select()
            .eq("period", String(key(monthStart).prefix(7)) + "-01").list(SalaryPayment.self) { payments = pays }

        // Закреплённые категории расходов — показываются первыми в разбивке.
        nonisolated struct CatPin: Codable, Sendable { let name: String?; let is_pinned: Bool? }
        if let cats = try? await DB.from("expense_categories").select("name, is_pinned").list(CatPin.self) {
            pinnedCats = Set(cats.filter { $0.is_pinned == true }.compactMap { $0.name })
        }

        if !histLoaded {
            async let allShiftInk = try? DB.from("shifts").select("date, inkassation").list(ShiftInkRow.self)
            async let allInkDed = try? DB.from("inkassations").select("date, expense, salary").list(InkDeductRow.self)
            allShiftInkRows = (await allShiftInk) ?? allShiftInkRows
            allInkDedRows = (await allInkDed) ?? allInkDedRows

            // кальян all-time + склад — тоже не зависит от currentDate, грузим вместе с историей
            async let allHk = try? DB.from("hookah_sales").select("quantity, portion_g").list(HookahSale.self)
            async let stock = try? DB.from("tobacco_stock").select("id, brand, flavor, quantity_g, min_quantity_g").list(StockItem.self)
            async let movs = try? DB.from("tobacco_movements").select().list(Movement.self)
            async let tps = try? DB.from("hookah_types").select("id, name").list(HookahType.self)
            allHookah = (await allHk) ?? allHookah
            stockRows = (await stock) ?? stockRows
            if let mv = await movs { issuedG = mv.filter { $0.type == "out" }.reduce(0) { $0 + $1.quantity_g } }
            stockG = stockRows.reduce(0) { $0 + $1.quantity_g }
            types = (await tps) ?? types
            await loadDebts()
            await loadBank()
            histLoaded = true
        }

        // Инкассация — общий баланс заведения, не привязан к просматриваемому месяцу
        // (юзер-фидбок 2026-08-16: цифра не должна ехать при пролистывании назад/вперёд).
        // Вся валовая инкассация по сменам ЗА ВСЁ ВРЕМЯ минус все списания из неё (расход +
        // выплаченная ЗП) — без фильтра по monthEnd (тот был багом: паритет с вебом
        // app/analytics/page.tsx cumulativeInkass, который всегда all-time).
        let grossInk = allShiftInkRows.reduce(0) { $0 + ($1.inkassation ?? 0) }
        let dedInk = allInkDedRows.reduce(0) { $0 + (($1.expense ?? 0) + ($1.salary ?? 0)) }
        cumulativeInkass = grossInk - dedInk
    }

    // MARK: - Банк (Open Banking)

    func loadBank() async {
        guard let c = try? await DB.from("bank_connections").select()
            .order("created_at", ascending: false).limit(1).list(BankConnection.self).first else {
            bankConnection = nil; return
        }
        guard c.status == "linked" else { bankConnection = nil; return }
        bankConnection = c
        if let tx = try? await DB.from("bank_transactions").select()
            .eq("connection_id", c.id).order("booking_date", ascending: false).list(BankTransaction.self) {
            bankTx = tx
        }
    }

    /// institutionName задан — либо выбор из списка совпадений, либо повторное
    /// подключение уже известного банка (re-consent). countryOverride — то же для страны.
    func connectBank(institutionName: String? = nil, countryOverride: String? = nil) async {
        bankBusy = true; bankError = nil; bankInstitutions = []
        defer { bankBusy = false }
        do {
            let resp = try await API.postJSON("/api/bank/connect", body: [
                "country": countryOverride ?? bankCountry, "query": bankQuery,
                "institutionName": institutionName ?? "", "platform": "ios",
            ].compactMapValues { $0.isEmpty ? nil : $0 }, as: BankConnectResponse.self)
            if let institutions = resp.institutions, !institutions.isEmpty {
                bankInstitutions = institutions; return
            }
            guard let link = resp.link, let url = URL(string: link) else {
                bankError = resp.error ?? "error"; return
            }
            try await BankAuthCoordinator().present(url: url)
            await loadBank()
        } catch {
            bankError = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    func refreshBank() async {
        bankBusy = true; bankError = nil
        defer { bankBusy = false }
        do {
            let resp = try await API.postJSON("/api/bank/sync", body: [:], as: BankSyncResponse.self)
            if resp.ok == false { bankError = resp.error ?? "error" }
        } catch {
            bankError = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
        await loadBank()
    }

    func changeMonth(_ d: Int) async {
        currentDate = Calendar.current.date(byAdding: .month, value: d, to: currentDate) ?? currentDate
        await load()
    }

    /// Шаг навигации зависит от вкладки и режима Периода: день/неделя/месяц.
    private var navUnitIsDay: Bool { tab == "period" && periodMode == "day" }
    private var navUnitIsWeek: Bool { tab == "period" && periodMode == "week" }
    func navigate(_ dir: Int) async {
        let cal = Calendar.current
        if navUnitIsDay { currentDate = cal.date(byAdding: .day, value: dir, to: currentDate) ?? currentDate }
        else if navUnitIsWeek { currentDate = cal.date(byAdding: .day, value: dir * 7, to: currentDate) ?? currentDate }
        else { currentDate = cal.date(byAdding: .month, value: dir, to: currentDate) ?? currentDate }
        await load()
    }
    func setDate(_ d: Date) async { currentDate = d; await load() }
    var navLabel: String {
        if navUnitIsDay { return dayLabelRu(key(currentDate)) }
        if navUnitIsWeek {
            let (m, s) = weekRange
            let f = DateFormatter(); f.locale = appLocale(); f.dateFormat = "d MMM"
            return f.string(from: m) + " – " + f.string(from: s)
        }
        return monthLabel(currentDate)
    }
    var navTappableForDate: Bool { navUnitIsDay }

    // MARK: computed

    private func adj(_ rows: [Shift]) -> [Shift] {
        guard includeCard else { return rows }
        return rows.map { var s = $0; s.income = ($0.income ?? 0) + ($0.income_card ?? 0); return s }
    }
    var shifts: [Shift] { adj(shiftsRaw) }
    var prevShifts: [Shift] { adj(prevShiftsRaw) }

    var totalIncome: Double { shifts.reduce(0) { $0 + ($1.income ?? 0) } }
    var totalExpense: Double { shifts.reduce(0) { $0 + ($1.total_expense ?? 0) } }
    var totalInkass: Double { shifts.reduce(0) { $0 + ($1.inkassation ?? 0) } }
    var lastClosing: Double { shifts.last?.closing_balance ?? 0 }
    var prevIncome: Double { prevShifts.reduce(0) { $0 + ($1.income ?? 0) } }
    var prevExpense: Double { prevShifts.reduce(0) { $0 + ($1.total_expense ?? 0) } }
    func pct(_ c: Double, _ p: Double) -> Double? { p != 0 ? (c - p) / p * 100 : nil }

    var catMap: [(String, Double)] {
        let ids = Set(periodShifts.map(\.id))
        var m: [String: Double] = [:]
        for e in expenses {
            if let sid = e.shift_id, !ids.contains(sid) { continue }
            // Авансы — расход инкассации, не кассы; не показываем в расходах периода.
            if e.category_name?.hasPrefix("Аванс") == true { continue }
            guard countsInRollup(e) else { continue }
            m[e.category_name ?? "—", default: 0] += e.amount ?? 0
        }
        return m.sorted {
            let pa = pinnedCats.contains($0.key), pb = pinnedCats.contains($1.key)
            if pa != pb { return pa }   // закреплённые — первыми
            return $0.value > $1.value
        }
    }

    // касса
    var filledShifts: [Shift] { shifts.filter { ($0.income ?? 0) > 0 || ($0.total_expense ?? 0) > 0 } }
    var lastFilledDate: Date? { filledShifts.last.flatMap { df.date(from: $0.date) } }
    // «Вход» дня N считаем как «Кассу» дня N-1 из этого же списка, а не хранимое поле:
    // opening_balance пишется один раз при открытии смены и может «застыть» на 0,
    // если предыдущий день был закрыт позже (см. баг SO 2026-07-07/07-01).
    // Первая строка — единственная без предыдущей строки в этом же списке; она же
    // всегда первый активный день выбранного месяца, поэтому её «до» берём из закрытия
    // последней смены прошлого месяца (prevShifts уже загружен для сравнения периодов).
    var filledShiftsDisplay: [Shift] {
        var rows = filledShifts
        guard !rows.isEmpty else { return rows }
        if rows.count > 1 {
            for i in 1..<rows.count { rows[i].opening_balance = rows[i - 1].closing_balance }
        }
        if let prevClose = prevShifts.last?.closing_balance { rows[0].opening_balance = prevClose }
        return rows
    }
    // Не только дни с реальным сбором — так же дни, где из фонда списали расход/ЗП без
    // нового сбора (юзер-фидбок 2026-08-16: выплата пропадала из истории целиком).
    var shiftsWithInk: [Shift] {
        shifts.filter {
            ($0.inkassation ?? 0) > 0 || (inkDetails[$0.id]?.expense ?? 0) > 0 || (inkDetails[$0.id]?.salary ?? 0) > 0
        }
    }

    // прогноз
    var daysInMonth: Int {
        let cal = Calendar.current
        return cal.range(of: .day, in: .month, for: currentDate)?.count ?? 30
    }
    var isCurrentMonth: Bool {
        Calendar.current.isDate(currentDate, equalTo: Date(), toGranularity: .month)
    }
    var daysPassed: Int { isCurrentMonth ? Calendar.current.component(.day, from: Date()) : daysInMonth }
    var dailyAvg: Double { daysPassed > 0 ? totalIncome / Double(daysPassed) : 0 }
    var projected: Double { (dailyAvg * Double(daysInMonth)).rounded() }

    // Период: срез смен по режиму относительно ВЫБРАННОЙ даты (currentDate).
    private var allLoaded: [Shift] { adj(shiftsRaw + prevShiftsRaw) }
    private var periodRaw: [Shift] {
        let all = shiftsRaw + prevShiftsRaw
        switch periodMode {
        case "day": return all.filter { $0.date == key(currentDate) }
        case "week":
            let (mon, sun) = weekRange
            return all.filter { $0.date >= key(mon) && $0.date <= key(sun) }
        default: return shiftsRaw
        }
    }
    var pCash: Double { periodRaw.reduce(0) { $0 + ($1.income ?? 0) } }
    var pCard: Double { periodRaw.reduce(0) { $0 + ($1.income_card ?? 0) } }
    var pTotal: Double { pCash + pCard }
    var prevTotal: Double { prevShiftsRaw.reduce(0) { $0 + ($1.income ?? 0) + ($1.income_card ?? 0) } }

    var weekRange: (Date, Date) {
        let cal = Calendar.current
        let wd = cal.component(.weekday, from: currentDate)
        let monday = cal.date(byAdding: .day, value: -((wd + 5) % 7), to: currentDate) ?? currentDate
        return (monday, cal.date(byAdding: .day, value: 6, to: monday) ?? monday)
    }
    var periodShifts: [Shift] {
        switch periodMode {
        case "day": return allLoaded.filter { $0.date == key(currentDate) }
        case "week":
            let (mon, sun) = weekRange
            return allLoaded.filter { $0.date >= key(mon) && $0.date <= key(sun) }
        default: return shifts
        }
    }
    // Диапазон текущего периода (день/неделя/месяц) как строки дат — для фильтрации долгов,
    // которые (в отличие от shifts) не грузятся заново при листании периода/месяца.
    var periodDateRange: (String, String) {
        let cal = Calendar.current
        switch periodMode {
        case "day": return (key(currentDate), key(currentDate))
        case "week": let (mon, sun) = weekRange; return (key(mon), key(sun))
        default:
            let monthStart = cal.date(from: cal.dateComponents([.year, .month], from: currentDate)) ?? currentDate
            let monthEnd = cal.date(byAdding: DateComponents(month: 1, day: -1), to: monthStart) ?? monthStart
            return (key(monthStart), key(monthEnd))
        }
    }
    var periodDebts: [DebtRow] {
        let (start, end) = periodDateRange
        return debts.filter { $0.date >= start && $0.date <= end }
    }
    var periodDebtHistory: [DebtRow] {
        let (start, end) = periodDateRange
        return debtHistory.filter { $0.date >= start && $0.date <= end }
    }

    var pIncome: Double { periodShifts.reduce(0) { $0 + ($1.income ?? 0) } }
    var pExpense: Double { periodShifts.reduce(0) { $0 + ($1.total_expense ?? 0) } }
    var pInkass: Double { periodShifts.reduce(0) { $0 + ($1.inkassation ?? 0) } }
    var pClosing: Double { periodShifts.last?.closing_balance ?? lastClosing }

    var totalInkassNet: Double {
        shiftsWithInk.reduce(0) { acc, s in
            if let ink = inkDetails[s.id] { return acc + (ink.total ?? (s.inkassation ?? 0)) }
            return acc + (s.inkassation ?? 0)
        }
    }

    struct DailyIncome: Identifiable { let id = UUID(); let day: Int; let date: String; let income: Double }
    var dailyIncome: [DailyIncome] {
        periodShifts.compactMap { s in
            guard let d = Int(s.date.suffix(2)) else { return nil }
            return DailyIncome(day: d, date: s.date, income: s.income ?? 0)
        }
    }

    // зарплата: сумма на карту — строго помесячная (своя на каждый месяц, 0 если не вбита)
    var ymKey: String { String(key(currentDate).prefix(7)) }
    func cardOf(_ e: Employee) -> Double {
        cardAmounts.first(where: { $0.employee_id == e.id })?.card_amount ?? 0
    }
    struct SalaryRow: Identifiable {
        let id: String; let name: String; let salary: Double; let abs: Int
        let deduct: Double; let card: Double; let cash: Double; let total: Double
        let advance: Double; let advanceList: [SalaryAdvance]
        let paid: Double; let remaining: Double
    }
    // paid/remaining — паритет с PeopleModel.computeSalary (canon-расчёт 2026-07-28): без
    // вычета salary_payments Analytics показывала «к выплате» без учёта уже выданного, расходясь
    // с People после первой частичной выплаты за месяц (аудит 2026-08-09).
    var salaryRows: [SalaryRow] {
        employees.map { e in
            let absN = absences.filter { $0.employee_id == e.id }.count
            let deduct = Double(absN) * (e.deduct_per_absence ?? 0)
            let card = cardOf(e)
            let advList = advances.filter { $0.employee_id == e.id }
            let advance = advList.reduce(0) { $0 + ($1.amount ?? 0) }
            let total = max(0, (e.salary ?? 0) - deduct)
            let cash = max(0, total - advance - card)
            let paid = payments.filter { $0.employee_id == e.id }.reduce(0) { $0 + ($1.amount ?? 0) }
            let remaining = max(0, cash - paid)
            return SalaryRow(id: e.id, name: e.name, salary: e.salary ?? 0, abs: absN, deduct: deduct, card: card, cash: cash, total: total, advance: advance, advanceList: advList, paid: paid, remaining: remaining)
        }
    }
    var payrollTotal: Double { employees.reduce(0) { $0 + ($1.salary ?? 0) } }
    var salTotal: Double { salaryRows.reduce(0) { $0 + $1.total } }
    var salCard: Double { salaryRows.reduce(0) { $0 + $1.card } }
    var salCash: Double { salaryRows.reduce(0) { $0 + $1.cash } }
    var salAdvance: Double { salaryRows.reduce(0) { $0 + $1.advance } }
    // Та же формула salCash, но по прошлому месяцу — нужна, пока не наступил payout_day.
    func prevCardOf(_ e: Employee) -> Double {
        prevCardAmounts.first(where: { $0.employee_id == e.id })?.card_amount ?? 0
    }
    var prevSalCash: Double {
        employees.reduce(0.0) { s, e in
            let absN = prevAbsences.filter { $0.employee_id == e.id }.count
            let deduct = Double(absN) * (e.deduct_per_absence ?? 0)
            let card = prevCardOf(e)
            let advance = prevAdvances.filter { $0.employee_id == e.id }.reduce(0) { $0 + ($1.amount ?? 0) }
            let total = max(0, (e.salary ?? 0) - deduct)
            return s + max(0, total - advance - card)
        }
    }
    var prevDaysInMonth: Int {
        let cal = Calendar.current
        guard let prevMonth = cal.date(byAdding: .month, value: -1, to: currentDate) else { return 30 }
        return cal.range(of: .day, in: .month, for: prevMonth)?.count ?? 30
    }
    // Цикл начисления привязан к payout_day, не к 1-му числу: с payout_day этого месяца
    // стартует новый цикл (копит на ЗП текущего месяца, выплата — в следующем месяце на
    // payout_day); до payout_day ещё идёт дособор на прошлый месяц (выплата — в этом
    // месяце на payout_day). Без настройки payout_day — обычный календарный месяц.
    var cycleStart: Int { payoutDay ?? 1 }
    var salToday: Double {
        // Рамп завязан на РЕАЛЬНУЮ сегодняшнюю дату — при просмотре прошлого/будущего
        // месяца (стрелками) даёт бессмысленную цифру (% от чужого месяца по чужому дню).
        // Прошлый закрытый месяц уже полностью начислен — 100%.
        guard isCurrentMonth else { return salCash }
        let today = Calendar.current.component(.day, from: Date())
        if today >= cycleStart {
            return max(0, (salCash / Double(daysInMonth) * Double(today - cycleStart + 1)).rounded())
        } else {
            return max(0, (prevSalCash / Double(prevDaysInMonth) * Double(prevDaysInMonth - cycleStart + today + 1)).rounded())
        }
    }
    // Аванс/сумма-на-карту (запись) — переехали в Manager→Зарплата (ManagerSalary.swift,
    // реструктура 2026-08-14). advances/cardAmounts здесь остаются read-only для отображения.


    // MARK: Долги по расходам (Б, 2026-08-09; переработано по фидбеку юзера — касса дня
    // возникновения долга и дня погашения не должны задним числом пересчитываться)
    //
    // Правило подсчёта в отчётах (см. countsInRollup): строка считается расходом, только если
    // paid_shift_id пуст (обычная, сразу оплаченная запись) ИЛИ paid_shift_id == её же shift_id
    // (запись погашения — см. ниже). Строка с paid_shift_id, указывающим на ДРУГУЮ смену —
    // историческая пометка «здесь был долг», НИКОГДА не считается в тратах.
    //
    // При создании долга (ManagerView, тогл «в долг»): is_paid=false, paid_shift_id=nil —
    // не считается в кассе/отчётах дня возникновения (уже сделано в ManagerView.calc).
    //
    // При погашении (settleDebts):
    //   1. Исходная строка (день возникновения) помечается is_paid=true, paid_at=день
    //      погашения, paid_shift_id=смена погашения — статус «оплачено», но paid_shift_id
    //      теперь ≠ её собственный shift_id → навсегда исключена из подсчёта (день
    //      возникновения не меняется задним числом).
    //   2. Новая строка вставляется В ДЕНЬ ПОГАШЕНИЯ: та же категория/сотрудник, та же сумма,
    //      shift_id = paid_shift_id = смена погашения (совпадают) → считается в расходах ИМЕННО
    //      этого дня. ManagerView её не видит и не трогает (loadDay/persistExpenses фильтруют
    //      paid_shift_id != nil) — живёт только в отчётах Analytics.
    //   3. inkassations.expense дня погашения увеличивается на сумму — реальные наличные
    //      физически ушли из инкассационного резерва в этот день (как и авансы).
    struct DebtRow: Identifiable, Sendable {
        let id: String; let shiftId: String; let date: String
        let categoryId: String?; let categoryName: String; let employeeId: String?
        let amount: Double; let paidAt: String?
    }
    var debts: [DebtRow] = []
    var debtHistory: [DebtRow] = []
    var debtTotal: Double { debts.reduce(0) { $0 + $1.amount } }

    // Считается ли строка расходом в отчётах — см. правило выше.
    func countsInRollup(_ e: ShiftExpense) -> Bool {
        if e.is_paid == false { return false }
        guard let paidShiftId = e.paid_shift_id else { return true }
        return paidShiftId == e.shift_id
    }

    func loadDebts() async {
        nonisolated struct DebtExp: Codable, Sendable {
            let id: String; let shift_id: String?; let category_id: String?; let category_name: String?
            let employee_id: String?; let amount: Double?; let is_paid: Bool?; let paid_at: String?
            let paid_shift_id: String?
        }
        // Долг = ещё не оплачен (is_paid=false) ИЛИ историческая запись погашённого долга
        // (paid_shift_id указывает на ДРУГУЮ смену, не свою — п.1 выше). Два отдельных запроса,
        // «или» по paid_shift_id != shift_id нельзя выразить в PostgREST-фильтре напрямую.
        async let unpaidQ = (try? await DB.from("shift_expenses").select("id, shift_id, category_id, category_name, employee_id, amount, is_paid, paid_at, paid_shift_id").eq("is_paid", false).list(DebtExp.self)) ?? []
        // DB.swift не даёт IS NOT NULL — neq на заведомо невозможный uuid даёт тот же результат
        // (NULL≠X в SQL не true, такие строки не пройдут фильтр — ровно то, что нужно).
        async let settledQ = (try? await DB.from("shift_expenses").select("id, shift_id, category_id, category_name, employee_id, amount, is_paid, paid_at, paid_shift_id").neq("paid_shift_id", "00000000-0000-0000-0000-000000000000").list(DebtExp.self)) ?? []
        let unpaid = await unpaidQ
        let settled = (await settledQ).filter { $0.paid_shift_id != $0.shift_id }
        let all = unpaid + settled
        guard !all.isEmpty else { debts = []; debtHistory = []; return }
        let shiftIds = Array(Set(all.compactMap { $0.shift_id }))
        nonisolated struct ShiftDateRow: Codable, Sendable { let id: String; let date: String }
        let shiftDates = (try? await DB.from("shifts").select("id, date").in("id", shiftIds).list(ShiftDateRow.self)) ?? []
        let dateById = Dictionary(uniqueKeysWithValues: shiftDates.map { ($0.id, $0.date) })
        func toRow(_ e: DebtExp) -> DebtRow? {
            guard let sid = e.shift_id, let date = dateById[sid] else { return nil }
            return DebtRow(id: e.id, shiftId: sid, date: date, categoryId: e.category_id,
                categoryName: e.category_name ?? "—", employeeId: e.employee_id, amount: e.amount ?? 0, paidAt: e.paid_at)
        }
        debts = unpaid.compactMap(toRow).sorted { $0.date < $1.date }
        debtHistory = settled.compactMap(toRow).sorted { $0.date > $1.date }
    }

    // кальян
    func rowG(_ r: HookahSale) -> Double { (r.quantity ?? 0) * (r.portion_g ?? hkPortion) }
    var qtyMonth: Int { Int(hookahRows.filter { $0.is_free != true }.reduce(0) { $0 + ($1.quantity ?? 0) }) }
    var qtyFree: Int { Int(hookahRows.filter { $0.is_free == true }.reduce(0) { $0 + ($1.quantity ?? 0) }) }
    var revMonth: Double { hookahRows.filter { $0.is_free != true }.reduce(0) { $0 + ($1.quantity ?? 0) * ($1.price ?? hkPrice) } }
    var usedMonthG: Double { hookahRows.reduce(0) { $0 + rowG($1) } }
    var venueG: Double { issuedG - allHookah.reduce(0) { $0 + rowG($1) } }
    struct TypeRow: Identifiable { let id: String; let name: String; let paid: Int; let free: Int }
    var byType: [TypeRow] {
        var m: [String: (Int, Int)] = [:]
        for r in hookahRows {
            guard let id = r.hookah_type_id else { continue }
            var v = m[id] ?? (0, 0)
            if r.is_free == true { v.1 += Int(r.quantity ?? 0) } else { v.0 += Int(r.quantity ?? 0) }
            m[id] = v
        }
        return m.map { TypeRow(id: $0.key, name: typeName($0.key), paid: $0.value.0, free: $0.value.1) }
            .sorted { ($0.paid + $0.free) > ($1.paid + $1.free) }
    }
    private func typeName(_ id: String) -> String { types.first { $0.id == id }?.name ?? "—" }

    // Бесплатные — по категории (владелец/сотрудник/кальянщик и т.д., см. StashView
    // freeCats), не по виду кальяна: категория списания хранится в поле flavor.
    struct CatLine: Identifiable { let id: String; let name: String; let count: Int }
    private func freeByCategory(_ rows: [HookahSale]) -> [CatLine] {
        var m: [String: Int] = [:]
        for r in rows where r.is_free == true {
            let cat = (r.flavor?.isEmpty == false) ? r.flavor! : "—"
            m[cat, default: 0] += Int(r.quantity ?? 0)
        }
        return m.map { CatLine(id: $0.key, name: $0.key, count: $0.value) }.sorted { $0.count > $1.count }
    }
    var freeByCat: [CatLine] { freeByCategory(hookahRows) }

    var venueStockG: Double { stockG }                                  // на складе
    var venueAtPlaceG: Double { issuedG - allHookah.reduce(0) { $0 + rowG($1) } } // в заведении: выдано − продано (может быть минус)

    struct TypeLine: Identifiable { let id: String; let name: String; let paid: Int; let free: Int; let grams: Double; let revenue: Double }
    struct DayHookah: Identifiable { let id: String; let date: String; let qty: Int; let free: Int; let revenue: Double; let types: [TypeLine]; let freeByCat: [CatLine] }
    var hookahByDay: [DayHookah] {
        var byDate: [String: [HookahSale]] = [:]
        for r in hookahRows { byDate[r.date ?? "", default: []].append(r) }
        return byDate.map { date, rows in
            let qty = Int(rows.filter { $0.is_free != true }.reduce(0) { $0 + ($1.quantity ?? 0) })
            let free = Int(rows.filter { $0.is_free == true }.reduce(0) { $0 + ($1.quantity ?? 0) })
            let rev = rows.filter { $0.is_free != true }.reduce(0.0) { $0 + ($1.quantity ?? 0) * ($1.price ?? hkPrice) }
            var tm: [String: (paid: Int, free: Int, grams: Double, rev: Double)] = [:]
            for r in rows {
                guard let id = r.hookah_type_id else { continue }
                var v = tm[id] ?? (0, 0, 0, 0)
                let q = Int(r.quantity ?? 0)
                v.grams += (r.quantity ?? 0) * (r.portion_g ?? hkPortion)
                if r.is_free == true { v.free += q } else { v.paid += q; v.rev += (r.quantity ?? 0) * (r.price ?? hkPrice) }
                tm[id] = v
            }
            let tList = tm.map { TypeLine(id: $0.key, name: typeName($0.key), paid: $0.value.paid, free: $0.value.free, grams: $0.value.grams, revenue: $0.value.rev) }
                .sorted { ($0.paid + $0.free) > ($1.paid + $1.free) }
            return DayHookah(id: date, date: date, qty: qty, free: free, revenue: rev, types: tList, freeByCat: freeByCategory(rows))
        }
        .sorted { $0.date > $1.date }
    }

    // MARK: - Export

    /// Build a CSV string for the current month's shifts.
    func buildCSV() -> String {
        let cols = [t("an.csvDate"), t("an.csvOpening"), t("an.csvIncome"),
                    t("an.csvExpense"), t("an.csvInkass"), t("an.csvClosing")]
        var lines = [cols.joined(separator: ",")]
        for s in filledShiftsDisplay {
            let row = [
                s.date,
                String(format: "%.2f", s.opening_balance ?? 0),
                String(format: "%.2f", s.income ?? 0),
                String(format: "%.2f", s.total_expense ?? 0),
                String(format: "%.2f", s.inkassation ?? 0),
                String(format: "%.2f", s.closing_balance ?? 0),
            ]
            lines.append(row.joined(separator: ","))
        }
        // totals row
        let totals = [
            t("an.csvTotal"),
            "",
            String(format: "%.2f", totalIncome),
            String(format: "%.2f", totalExpense),
            String(format: "%.2f", totalInkass),
            "",
        ]
        lines.append(totals.joined(separator: ","))
        return lines.joined(separator: "\n")
    }

    /// Write CSV to a temp file and return its URL.
    func csvFileURL() -> URL? {
        let csv = buildCSV()
        guard let data = csv.data(using: .utf8) else { return nil }
        let name = "analytics-\(navLabel.replacingOccurrences(of: " ", with: "-")).csv"
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(name)
        try? data.write(to: url)
        return url
    }

    /// Render an A4 analytics report: header, trend-aware summary cards, an income/expense
    /// mini bar chart, and a shaded, monospaced-digit daily table for legibility at print size.
    func buildPDF() -> Data {
        let pageW: CGFloat = 595, pageH: CGFloat = 842, margin: CGFloat = 40
        let accent = UIColor(red: 0.20, green: 0.78, blue: 0.35, alpha: 1)   // BrandKit.analytics
        let expenseColor = UIColor.systemRed
        let inkassColor = UIColor.systemOrange
        let avgColor = UIColor.systemGray

        let cols: [(String, CGFloat)] = [
            (t("an.csvDate"),    95),
            (t("an.csvOpening"), 80),
            (t("an.csvIncome"),  80),
            (t("an.csvExpense"), 80),
            (t("an.csvInkass"),  80),
            (t("an.csvClosing"), 100),
        ]
        let tableW = cols.reduce(0) { $0 + $1.1 }

        let renderer = UIGraphicsPDFRenderer(bounds: CGRect(x: 0, y: 0, width: pageW, height: pageH))
        // Форсируем светлую тему для резолва семантических цветов — см. коммент
        // в ReportExportView.buildPDF (та же причина нечитаемого PDF в тёмной теме).
        // performAsCurrent мостится из ObjC как Void-closure, результат — через var.
        var pdf = Data()
        UITraitCollection(userInterfaceStyle: .light).performAsCurrent {
        pdf = renderer.pdfData { ctx in
            ctx.beginPage()
            var y: CGFloat = 0

            // helper: draw text in a rect (clips/aligns); mono uses tabular figures so
            // decimal points in money columns line up vertically.
            func text(_ s: String, _ x: CGFloat, _ yy: CGFloat, size: CGFloat,
                      weight: UIFont.Weight = .regular, color: UIColor = .label,
                      width: CGFloat? = nil, align: NSTextAlignment = .left, mono: Bool = false) {
                let p = NSMutableParagraphStyle(); p.alignment = align; p.lineBreakMode = .byTruncatingTail
                let font = mono ? UIFont.monospacedDigitSystemFont(ofSize: size, weight: weight)
                                : UIFont.systemFont(ofSize: size, weight: weight)
                let attrs: [NSAttributedString.Key: Any] = [
                    .font: font, .foregroundColor: color, .paragraphStyle: p,
                ]
                (s as NSString).draw(in: CGRect(x: x, y: yy, width: width ?? (pageW - x - margin), height: size + 8),
                                     withAttributes: attrs)
            }

            // Accent bar + title
            accent.setFill(); UIRectFill(CGRect(x: 0, y: 0, width: pageW, height: 6))
            y = margin
            text(t("an.pdfTitle"), margin, y, size: 22, weight: .bold)
            let genDf = DateFormatter(); genDf.dateFormat = "dd.MM.yyyy"; genDf.locale = appLocale()
            text(t("an.pdfGenerated") + " " + genDf.string(from: Date()), margin, y + 6,
                 size: 11, color: .secondaryLabel, width: tableW, align: .right)
            y += 32
            text(navLabel, margin, y, size: 13, weight: .semibold, color: .secondaryLabel)
            y += 30

            // Summary cards — colored edge stripe + trend vs. previous month on income/expense
            let gap: CGFloat = 10
            let cardW = (tableW - gap * 3) / 4
            let cardH: CGFloat = 64
            struct Card { let label: String; let value: String; let color: UIColor; let delta: Double? }
            let incomeDelta: Double? = prevIncome > 0 ? (totalIncome - prevIncome) / prevIncome * 100 : nil
            let expenseDelta: Double? = prevExpense > 0 ? (totalExpense - prevExpense) / prevExpense * 100 : nil
            let cards: [Card] = [
                Card(label: t("an.income"),    value: Money.s(totalIncome),        color: accent,       delta: incomeDelta),
                Card(label: t("an.expense"),   value: Money.s(totalExpense),       color: expenseColor, delta: expenseDelta),
                Card(label: t("mg.inkass"),    value: Money.s(totalInkass),        color: inkassColor,  delta: nil),
                Card(label: t("an.avgPerDay"), value: Money.s(dailyAvg.rounded()), color: avgColor,      delta: nil),
            ]
            for (i, c) in cards.enumerated() {
                let cx = margin + CGFloat(i) * (cardW + gap)
                let cardRect = CGRect(x: cx, y: y, width: cardW, height: cardH)
                UIColor.systemGray6.setFill(); UIBezierPath(roundedRect: cardRect, cornerRadius: 10).fill()
                c.color.setFill()
                UIBezierPath(roundedRect: CGRect(x: cx, y: y, width: 4, height: cardH),
                             byRoundingCorners: [.topLeft, .bottomLeft],
                             cornerRadii: CGSize(width: 10, height: 10)).fill()
                text(c.label.uppercased(), cx + 12, y + 9, size: 8, weight: .semibold, color: .secondaryLabel, width: cardW - 22)
                text(c.value, cx + 12, y + 25, size: 15, weight: .bold, color: c.color, width: cardW - 22, mono: true)
                if let d = c.delta {
                    let up = d >= 0
                    let dColor: UIColor = up ? accent : expenseColor
                    let deltaStr = "\(up ? "▲" : "▼") \(String(format: "%.0f", abs(d)))% \(t("an.prevMonth"))"
                    text(deltaStr, cx + 12, y + 46, size: 7.5, weight: .medium, color: dColor, width: cardW - 22)
                }
            }
            y += cardH + 26

            guard !filledShifts.isEmpty else {
                text(t("an.byDay"), margin, y, size: 11, weight: .semibold, color: .secondaryLabel)
                text(t("an.noShiftData"), margin, y + 26, size: 13, color: .secondaryLabel)
                return
            }

            // Section title + legend
            text(t("an.byDay"), margin, y, size: 11, weight: .semibold, color: .secondaryLabel)
            let legendX = margin + tableW - 150
            accent.setFill(); UIRectFill(CGRect(x: legendX, y: y + 2, width: 7, height: 7))
            text(t("an.income"), legendX + 11, y, size: 8.5, color: .secondaryLabel)
            expenseColor.setFill(); UIRectFill(CGRect(x: legendX + 75, y: y + 2, width: 7, height: 7))
            text(t("an.expense"), legendX + 86, y, size: 8.5, color: .secondaryLabel)
            y += 18

            // Income vs. expense mini bar chart
            if filledShiftsDisplay.count > 1 {
                let chartH: CGFloat = 100
                let chartBottom = y + chartH
                let maxVal = max((filledShiftsDisplay.map { max($0.income ?? 0, $0.total_expense ?? 0) }.max() ?? 1) * 1.15, 1)

                for frac: CGFloat in [0, 0.5, 1.0] {
                    let gy = chartBottom - chartH * frac
                    UIColor.systemGray5.setStroke()
                    let grid = UIBezierPath()
                    grid.move(to: CGPoint(x: margin, y: gy)); grid.addLine(to: CGPoint(x: margin + tableW, y: gy))
                    grid.lineWidth = 0.5; grid.stroke()
                }

                let n = filledShiftsDisplay.count
                let slotW = tableW / CGFloat(n)
                let barGap: CGFloat = max((slotW - 2) / 5, 0.5)
                let barW = max((slotW - barGap * 3) / 2, 0.8)
                let labelStep = max(n / 8, 1)

                for (i, s) in filledShiftsDisplay.enumerated() {
                    let slotX = margin + CGFloat(i) * slotW
                    let incH = chartH * CGFloat(min((s.income ?? 0) / maxVal, 1))
                    let expH = chartH * CGFloat(min((s.total_expense ?? 0) / maxVal, 1))
                    accent.setFill()
                    UIBezierPath(roundedRect: CGRect(x: slotX + barGap, y: chartBottom - incH, width: barW, height: max(incH, 0.5)), cornerRadius: 0.8).fill()
                    expenseColor.setFill()
                    UIBezierPath(roundedRect: CGRect(x: slotX + barGap * 2 + barW, y: chartBottom - expH, width: barW, height: max(expH, 0.5)), cornerRadius: 0.8).fill()
                    if i % labelStep == 0 || i == n - 1 {
                        let dayNum = s.date.split(separator: "-").last.map(String.init) ?? ""
                        text(dayNum, slotX, chartBottom + 4, size: 6.5, color: .tertiaryLabel, width: slotW, align: .center)
                    }
                }
                y = chartBottom + 22
            }

            let headerH: CGFloat = 26, rowH: CGFloat = 24
            func drawCells(_ cells: [String], yy: CGFloat, size: CGFloat, weight: UIFont.Weight, color: UIColor, mono: Bool = false) {
                var x = margin
                for (ci, col) in cols.enumerated() {
                    text(cells[ci], x + 8, yy, size: size, weight: weight, color: color,
                         width: col.1 - 14, align: ci == 0 ? .left : .right, mono: mono && ci > 0)
                    x += col.1
                }
            }

            // Table header — solid accent fill, white text, rounded top corners
            let headerRect = CGRect(x: margin, y: y, width: tableW, height: headerH)
            accent.setFill()
            UIBezierPath(roundedRect: headerRect, byRoundingCorners: [.topLeft, .topRight],
                         cornerRadii: CGSize(width: 8, height: 8)).fill()
            drawCells(cols.map { $0.0 }, yy: y + 8, size: 9, weight: .bold, color: .white)
            y += headerH

            // Rows (with pagination) — zebra shading + hairline separators for scan-ability
            for (i, s) in filledShiftsDisplay.enumerated() {
                if y + rowH > pageH - margin { ctx.beginPage(); y = margin }
                if i % 2 == 1 { UIColor.systemGray6.setFill(); UIRectFill(CGRect(x: margin, y: y, width: tableW, height: rowH)) }
                drawCells([
                    s.date,
                    Money.s(s.opening_balance ?? 0),
                    Money.s(s.income ?? 0),
                    Money.s(s.total_expense ?? 0),
                    Money.s(s.inkassation ?? 0),
                    Money.s(s.closing_balance ?? 0),
                ], yy: y + 7, size: 9.5, weight: .regular, color: .label, mono: true)
                UIColor.separator.withAlphaComponent(0.3).setStroke()
                let sep = UIBezierPath()
                sep.move(to: CGPoint(x: margin, y: y + rowH)); sep.addLine(to: CGPoint(x: margin + tableW, y: y + rowH))
                sep.lineWidth = 0.4; sep.stroke()
                y += rowH
            }

            // Totals
            if y + rowH > pageH - margin { ctx.beginPage(); y = margin }
            UIColor.systemGray5.setFill(); UIRectFill(CGRect(x: margin, y: y, width: tableW, height: rowH))
            drawCells([t("an.csvTotal"), "", Money.s(totalIncome), Money.s(totalExpense), Money.s(totalInkass), ""],
                      yy: y + 7, size: 9.5, weight: .bold, color: .label, mono: true)
        }
        }
        return pdf
    }

    #if DEBUG
    private func seedDemo() {
        includeCard = true; hkPrice = 15; hkPortion = 20
        func d(_ day: Int) -> String { String(format: "2026-06-%02d", day) }
        shiftsRaw = (1...15).map { i in
            Shift(id: "s\(i)", date: d(i), status: "closed",
                  income: Double(1200 + (i * 137) % 900), income_card: Double(300 + (i * 53) % 400),
                  total_expense: Double(400 + (i * 71) % 500), inkassation: Double(800 + (i * 90) % 600),
                  closing_balance: Double(200 + i * 30), opening_balance: 200)
        }
        prevShiftsRaw = (1...30).map { i in
            Shift(id: "p\(i)", date: String(format: "2026-05-%02d", i), status: "closed",
                  income: 1400, income_card: 300, total_expense: 500, inkassation: 900, closing_balance: 200, opening_balance: 200)
        }
        expenses = [
            ShiftExpense(id: "exp1", employee_id: nil, category_id: "c1", category_name: "Продукты", amount: 3200, note: nil, shift_id: "s1"),
            ShiftExpense(id: "exp2", employee_id: nil, category_id: "c2", category_name: "Бар", amount: 1800, note: nil, shift_id: "s1"),
            ShiftExpense(id: "exp3", employee_id: nil, category_id: "c3", category_name: "Хозтовары", amount: 600, note: nil, shift_id: "s2"),
        ]
        employees = [
            .init(id: "e1", name: "Анна Кузнецова", deduct_per_absence: 20, salary: 1200, card_amount: 400),
            .init(id: "e2", name: "Игорь Петров", deduct_per_absence: 20, salary: 1100, card_amount: 0),
            .init(id: "e3", name: "Мария Соколова", deduct_per_absence: 15, salary: 900, card_amount: 300),
        ]
        absences = [.init(employee_id: "e3", source: "manager", date: "2026-06-10"), .init(employee_id: "e3", source: "manager", date: "2026-06-14")]
        cardAmounts = [.init(id: "ca1", employee_id: "e1", card_amount: 450)]
        types = [.init(id: "h1", name: "Классический", price: 15, portion_g: 20), .init(id: "h2", name: "Премиум", price: 22, portion_g: 25)]
        hookahRows = [
            .init(hookah_type_id: "h1", quantity: 60, portion_g: 20, price: 15, is_free: false, date: d(10), brand: "Darkside", flavor: "Supernova"),
            .init(hookah_type_id: "h2", quantity: 30, portion_g: 25, price: 22, is_free: false, date: d(11), brand: "MustHave", flavor: "Pinkman"),
            .init(hookah_type_id: "h1", quantity: 5, portion_g: 20, price: 0, is_free: true, date: d(11), brand: nil, flavor: "Сотрудники"),
        ]
        allHookah = hookahRows
        stockRows = [.init(id: "s1", brand: "Darkside", flavor: "Supernova", quantity_g: 1200, min_quantity_g: 200)]
        stockG = 1200; issuedG = 3000
        cumulativeInkass = 48650
        loading = false
    }
    #endif
}

// MARK: - Экран Analytics

struct AnalyticsView: View {
    @Environment(AppModel.self) private var app
    @State private var m: AnalyticsModel?

    var body: some View {
        Group {
            if let m {
                AnalyticsBody(m: m, aiEnabled: app.aiEnabled)
                    .transition(.opacity)
            } else {
                AnalyticsSkeleton()
                    .transition(.opacity)
            }
        }
        .animation(.easeOut(duration: 0.3), value: m == nil)
        .task {
            if m == nil {
                let model = AnalyticsModel(rid: app.restaurant?.id ?? "", dayStartHour: app.dayStartHour)
                m = model
                #if DEBUG
                if let t = ProcessInfo.processInfo.environment["MISE_DEMO_TAB"] { model.tab = t }
                #endif
                // Переход из уведомления «Смена закрыта» (см. AppModel.routeNotification) —
                // сразу на день этой смены, а не просто в модуль (юзер-фидбек 2026-07-22).
                if let dateStr = app.pendingAnalyticsDate, let d = Self.parseDateKey(dateStr) {
                    app.pendingAnalyticsDate = nil
                    model.tab = "period"; model.periodMode = "day"; model.currentDate = d
                }
                await model.load()
            }
        }
        // Analytics уже открыт (модель жива) и прилетело новое уведомление — прыгаем на лету.
        .onChange(of: app.pendingAnalyticsDate) { _, dateStr in
            guard let dateStr, let d = Self.parseDateKey(dateStr), let m else { return }
            app.pendingAnalyticsDate = nil
            m.tab = "period"; m.periodMode = "day"
            Task { await m.setDate(d) }
        }
    }

    private static func parseDateKey(_ s: String) -> Date? {
        let df = DateFormatter(); df.dateFormat = "yyyy-MM-dd"; df.locale = Locale(identifier: "en_US_POSIX")
        return df.date(from: s)
    }
}

private struct AnalyticsBody: View {
    @Environment(AppModel.self) private var app
    @Bindable var m: AnalyticsModel
    let aiEnabled: Bool
    @State private var showDatePicker = false

    var body: some View {
        ZStack {
            Group {
                Color.miseBg.ignoresSafeArea()
                VStack(spacing: 0) {
                    monthNav
                    TabView(selection: $m.tab) {
                        AppTabPage(refresh: { await m.load(forceRefresh: true) }, scrollResetKey: m.tab) { PeriodTab(m: m, aiEnabled: aiEnabled) }
                            .tabItem { Label(t("tab.period"), systemImage: "calendar") }.tag("period")
                        AppTabPage(refresh: { await m.load(forceRefresh: true) }, scrollResetKey: m.tab) { KassaTab(m: m) }
                            .tabItem { Label(t("tab.kassa"), systemImage: "banknote.fill") }.tag("kassa")
                        AppTabPage(refresh: { await m.load(forceRefresh: true) }, scrollResetKey: m.tab) { BankTab(m: m, bankEnabled: aiEnabled) }
                            .tabItem { Label(t("tab.bank"), systemImage: "building.columns.fill") }.tag("bank")
                        AppTabPage(refresh: { await m.load(forceRefresh: true) }, scrollResetKey: m.tab) { SalaryTab(m: m) }
                            .tabItem { Label(t("tab.salary"), systemImage: "creditcard.fill") }.tag("salary")
                        AppTabPage(refresh: { await m.load(forceRefresh: true) }, scrollResetKey: m.tab) { HookahTab(m: m) }
                            .tabItem { Label(t("tab.hookah"), systemImage: "flame.fill") }.tag("hookah")
                    }
                    .tint(BrandKit.analytics)
                    .sensoryFeedback(.selection, trigger: m.tab)
                    // «Долги» убраны из таб-бара (юзер-фидбок 2026-08-14) — при 6 вкладках iOS
                    // автоматически прятал 5-ю и 6-ю («Сессии»/«Долги») за системный «Ещё», из-за
                    // чего «Сессии» были не видны напрямую. Теперь ровно 5 вкладок — без «Ещё».
                    // Долги переехали в PeriodTab — блок под «Расходами», period-aware
                    // (periodDebts/periodDebtHistory), тап открывает DebtsTab шторкой.
                    .tabEdgeSwipe(tabs: ["period", "kassa", "bank", "salary", "hookah"],
                                  selection: $m.tab,
                                  onFirstBack: app.availableApps.count > 1 ? { app.backToLauncher() } : nil)
                }
            }
            .blur(radius: AIChat.shared.open ? 2 : 0)
            .animation(.easeInOut(duration: 0.25), value: AIChat.shared.open)
            if aiEnabled {
                AIButton(module: "analytics") { msg in await m.handleAI(msg) }
            }
            if let toast = m.toast {
                Text(toast).font(.system(size: 14, weight: .semibold)).foregroundStyle(.primary)
                    .padding(.horizontal, 18).padding(.vertical, 12)
                    .background(.ultraThinMaterial, in: Capsule())
                    .padding(.bottom, 60)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .animation(.easeInOut(duration: 0.2), value: m.toast)
    }

    private var monthNav: some View {
        HStack {
            Button { Task { await m.navigate(-1) } } label: {
                Image(systemName: "chevron.left").foregroundStyle(.primary).frame(width: 36, height: 36)
            }
            Spacer()
            Button { if m.navTappableForDate { showDatePicker = true } } label: {
                HStack(spacing: 6) {
                    Text(m.navLabel).font(.system(size: 16, weight: .bold)).foregroundStyle(.primary)
                    if m.navTappableForDate {
                        Image(systemName: "calendar").font(.system(size: 12)).foregroundStyle(.primary.opacity(0.4))
                    }
                }
            }
            .buttonStyle(.plain).disabled(!m.navTappableForDate)
            Spacer()
            Button { Task { await m.navigate(1) } } label: {
                Image(systemName: "chevron.right").foregroundStyle(.primary).frame(width: 36, height: 36)
            }
        }
        // Swipe для сравнения с прошлым месяцем
        .gesture(
            DragGesture(minimumDistance: 50)
                .onEnded { value in
                    if value.translation.width < -50 { // свайп влево → показать прошлый
                        withAnimation { m.showPrevious = true }
                    } else if value.translation.width > 50 { // свайп вправо → скрыть
                        withAnimation { m.showPrevious = false }
                    }
                }
        )
        .padding(.horizontal, 16).padding(.bottom, 6)
        // Бейдж сравнения
        .overlay(alignment: .bottom) {
            if m.showPrevious {
                HStack(spacing: 6) {
                    Image(systemName: "arrow.left.arrow.right").font(.system(size: 10))
                    Text(t("an.comparing")).font(.system(size: 11, weight: .medium))
                    Button { withAnimation { m.showPrevious = false } } label: {
                        Image(systemName: "xmark.circle.fill").font(.system(size: 12))
                    }
                }
                .foregroundStyle(BrandKit.analytics)
                .padding(.horizontal, 10).padding(.vertical, 4)
                .background(BrandKit.analytics.opacity(0.12), in: Capsule())
                .padding(.bottom, -20)
            }
        }
        .sheet(isPresented: $showDatePicker) {
            NavigationStack {
                ZStack {
                    Color.miseBg.ignoresSafeArea()
                    DatePicker(t("an.date"), selection: Binding(get: { m.currentDate }, set: { d in Task { await m.setDate(d) } }),
                               displayedComponents: .date)
                        .datePickerStyle(.graphical).tint(BrandKit.analytics).padding()
                }
                .navigationTitle(t("an.pickDay")).navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button(t("done")) { showDatePicker = false } } }
                .toolbarBackground(Color.miseBg, for: .navigationBar)
            }
            .presentationDetents([.medium])
        }
    }
}

// MARK: Период

private struct PeriodTab: View {
    @Bindable var m: AnalyticsModel
    let aiEnabled: Bool
    private var isMonth: Bool { m.periodMode == "month" }
    @State private var selectedDay: Int?
    @State private var showDebts = false

    var body: some View {
        Picker("", selection: $m.periodMode) {
            Text(t("an.day")).tag("day"); Text(t("an.week")).tag("week"); Text(t("an.month")).tag("month")
        }.pickerStyle(.segmented)
        .onChange(of: m.periodMode) { _, newValue in
            guard newValue == "day" else { return }
            Task { await m.setDate(m.lastFilledDate ?? Date()) }
        }

        incomeCard

        if m.periodMode != "day" && !m.dailyIncome.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                Text(t("an.incomeByDay")).font(.system(size: 12, weight: .semibold)).foregroundStyle(.primary.opacity(0.45)).kerning(0.5)
                Chart(m.dailyIncome) { d in
                    BarMark(x: .value("День", d.day), y: .value("Доход", d.income))
                        .foregroundStyle(BrandKit.analytics.opacity(selectedDay == nil || selectedDay == d.day ? 1 : 0.35))
                        .cornerRadius(3)
                    if selectedDay == d.day {
                        RuleMark(x: .value("День", d.day))
                            .foregroundStyle(.primary.opacity(0.18))
                            .lineStyle(StrokeStyle(lineWidth: 1))
                            .zIndex(-1)
                            .annotation(position: .top, spacing: 6, overflowResolution: .init(x: .fit(to: .chart), y: .disabled)) {
                                dayBubble(d)
                            }
                    }
                }
                .chartXAxis { AxisMarks(values: .automatic(desiredCount: 6)) { v in AxisValueLabel().foregroundStyle(.primary.opacity(0.4)) } }
                .chartYAxis { AxisMarks { _ in AxisValueLabel().foregroundStyle(.primary.opacity(0.4)) } }
                .chartXSelection(value: $selectedDay)
                .frame(height: 160)
            }
            .padding(14).frame(maxWidth: .infinity)
            .background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 16))
        }

        if !m.catMap.isEmpty {
            VStack(alignment: .leading, spacing: 0) {
                HStack {
                    Text(m.periodMode == "day" ? t("an.expenses") : t("an.topExpenses"))
                        .font(.system(size: 12, weight: .semibold)).foregroundStyle(.primary.opacity(0.45)).kerning(0.5)
                    Spacer()
                    Text(cur(m.catMap.reduce(0) { $0 + $1.1 })).font(.system(size: 12, weight: .semibold)).foregroundStyle(.primary.opacity(0.55))
                }
                .padding(.bottom, 8)
                ForEach(Array(m.catMap.enumerated()), id: \.offset) { i, c in
                    HStack {
                        Text(c.0).font(.system(size: 15)).foregroundStyle(.primary)
                        Spacer()
                        Text(cur(c.1)).font(.system(size: 15, weight: .semibold)).foregroundStyle(.primary)
                    }
                    .padding(.vertical, 10)
                    if i < m.catMap.count - 1 { Divider().overlay(Color.primary.opacity(0.08)) }
                }
            }
            .padding(14)
            .background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 16))
        }

        // Долги (юзер-фидбок 2026-08-14) — под «Расходами», только если есть открытые долги
        // ИМЕННО в выбранном периоде (m.periodDebts уже фильтрует по day/week/month —
        // periodDateRange/periodDebts были готовы, использовались только внутри старой
        // отдельной вкладки «Долги»). Тап — «погружение» в детальную зону (шторка DebtsTab):
        // каждый долг, когда появился, сумма, когда погашен.
        if !m.periodDebts.isEmpty {
            Button { showDebts = true } label: {
                HStack(spacing: 10) {
                    Image(systemName: "exclamationmark.circle.fill").font(.system(size: 16)).foregroundStyle(BrandKit.stash)
                    Text(t("an.debts")).font(.system(size: 15, weight: .medium)).foregroundStyle(.primary)
                    Text("\(m.periodDebts.count)")
                        .font(.system(size: 12, weight: .bold)).foregroundStyle(.white)
                        .padding(.horizontal, 7).padding(.vertical, 2)
                        .background(BrandKit.stash, in: Capsule())
                    Spacer()
                    Text(cur(m.periodDebts.reduce(0) { $0 + $1.amount })).font(.system(size: 13, weight: .semibold)).foregroundStyle(BrandKit.stash)
                    Image(systemName: "chevron.right").font(.system(size: 11)).foregroundStyle(.primary.opacity(0.3))
                }
                .padding(14)
                .background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 16))
            }
            .buttonStyle(.plain)
            // Тап — «See all»-паттерн (Revolut): погружение в отдельный полноэкранный лист с
            // полной детализацией (когда образован, сумма, когда погашен) — DebtsTab целиком,
            // без изменений, просто переехал из вкладки таб-бара в шторку.
            .sheet(isPresented: $showDebts) {
                NavigationStack {
                    ScrollView { VStack(spacing: 12) { DebtsTab(m: m) }.padding(16) }
                        .background(Color.miseBg.ignoresSafeArea())
                        .navigationTitle(t("an.debts")).navigationBarTitleDisplayMode(.inline)
                        .toolbar { ToolbarItem(placement: .confirmationAction) { Button(t("done")) { showDebts = false } } }
                }
            }
        }

        if aiEnabled {
            AIAdvisorCard(m: m)
        }
    }

    private var incomeCard: some View {
        let total = m.pTotal
        let cashPct = total > 0 ? m.pCash / total : 0
        let cardPct = total > 0 ? m.pCard / total : 0
        let cashInt = Int((cashPct * 100).rounded())
        let cardInt = 100 - cashInt
        return VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(t("an.income")).font(.system(size: 12, weight: .semibold)).foregroundStyle(.primary.opacity(0.45)).kerning(0.5)
                    Text(cur(total)).font(.system(size: 30, weight: .heavy)).foregroundStyle(BrandKit.analytics)
                        .minimumScaleFactor(0.7).lineLimit(1)
                    if isMonth, let p = m.pct(m.pTotal, m.prevTotal) {
                        Text((p >= 0 ? "▲ " : "▼ ") + String(format: "%.0f%%", abs(p)))
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundStyle(p >= 0 ? BrandKit.analytics : BrandKit.menu)
                    }
                }
                Spacer()
            }
            .padding(.horizontal, 14).padding(.top, 14).padding(.bottom, 10)

            if total > 0 {
                GeometryReader { geo in
                    HStack(spacing: 2) {
                        if cashPct > 0 {
                            RoundedRectangle(cornerRadius: 3).fill(BrandKit.analytics)
                                .frame(width: max(6, (geo.size.width - (cardPct > 0 ? 2 : 0)) * CGFloat(cashPct)))
                        }
                        if cardPct > 0 {
                            RoundedRectangle(cornerRadius: 3).fill(BrandKit.manager).frame(maxWidth: .infinity)
                        }
                    }
                }
                .frame(height: 6).padding(.horizontal, 14)
            }

            HStack(spacing: 0) {
                periodCol(t("an.cashShort"), cur(m.pCash), BrandKit.analytics, cashPct > 0 ? "\(cashInt)%" : nil)
                Divider().frame(height: 28).overlay(Color.primary.opacity(0.12))
                periodCol(t("an.cardShort"), cur(m.pCard), BrandKit.manager, cardPct > 0 ? "\(cardInt)%" : nil)
                Divider().frame(height: 28).overlay(Color.primary.opacity(0.12))
                periodCol(t("an.inkShort"), cur(m.pInkass), BrandKit.stash, nil)
            }
            .padding(.horizontal, 4).padding(.vertical, 10)
        }
        .background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 16))
    }

    private func dayBubble(_ d: AnalyticsModel.DailyIncome) -> some View {
        VStack(spacing: 1) {
            Text(cur(d.income)).font(.system(size: 12, weight: .bold)).foregroundStyle(.primary)
            Text(dayLabelRu(d.date)).font(.system(size: 9)).foregroundStyle(.primary.opacity(0.5))
        }
        .padding(.horizontal, 8).padding(.vertical, 5)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 8))
        .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(Color.primary.opacity(0.08)))
    }

    private func periodCol(_ label: String, _ value: String, _ color: Color, _ pct: String?) -> some View {
        VStack(spacing: 2) {
            Text(value).font(.system(size: 14, weight: .bold)).foregroundStyle(color).lineLimit(1).minimumScaleFactor(0.6)
            HStack(spacing: 3) {
                Text(label).font(.system(size: 10)).foregroundStyle(.primary.opacity(0.45)).lineLimit(1)
                if let p = pct { Text(p).font(.system(size: 10, weight: .semibold)).foregroundStyle(.primary.opacity(0.3)) }
            }
        }
        .frame(maxWidth: .infinity)
    }
}

// MARK: Зарплата

// Read-only (реструктура 2026-08-14, паритет с Долгами 92f6076) — редактирование аванса/
// карты переехало в Manager→Зарплата (ManagerSalary.swift), единая точка правки.
private struct SalaryTab: View {
    @Bindable var m: AnalyticsModel
    @State private var expanded: String?

    var body: some View {
        VStack(spacing: 10) {
            Text(t("an.payrollFund")).font(.system(size: 12, weight: .semibold)).foregroundStyle(.primary.opacity(0.45)).kerning(0.5)
            Text(cur(m.salTotal)).font(.system(size: 30, weight: .heavy)).foregroundStyle(BrandKit.analytics)
            HStack(spacing: 0) {
                miniTotal(t("byCash"), cur(m.salCash), BrandKit.analytics)
                Divider().frame(height: 30).overlay(Color.primary.opacity(0.12))
                miniTotal(t("toCard"), cur(m.salCard), BrandKit.manager)
            }
        }
        .frame(maxWidth: .infinity).padding(.vertical, 18)
        .background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 16))

        ForEach(m.salaryRows) { r in
            VStack(spacing: 0) {
                Button { withAnimation(.easeInOut(duration: 0.18)) { expanded = expanded == r.id ? nil : r.id } } label: {
                    HStack {
                        Text(r.name).font(.system(size: 15, weight: .medium)).foregroundStyle(.primary)
                        Spacer()
                        // «Наличными» подпись под суммой убрана (юзер-фидбок 2026-08-14) — свёрнутая
                        // шапка теперь показывает только имя + остаток к выплате, разбивка
                        // (аванс/карта/оплачено) только в развёрнутом виде (detail() ниже).
                        Text(cur(r.remaining)).font(.system(size: 16, weight: .bold)).foregroundStyle(.primary)
                        Image(systemName: expanded == r.id ? "chevron.up" : "chevron.down")
                            .font(.system(size: 11)).foregroundStyle(.primary.opacity(0.4))
                    }
                    .padding(14)
                }
                .buttonStyle(.plain)
                if expanded == r.id {
                    VStack(spacing: 8) {
                        detail(t("baseSalary"), cur(r.salary))
                        if r.abs > 0 { detail(t("absencesN", ["n": "\(r.abs)"]), "−" + cur(r.deduct)) }
                        ForEach(r.advanceList.sorted { ($0.date ?? "") < ($1.date ?? "") }) { a in
                            detail(a.date.map { dayLabelRu($0) + " · " + t("an.advance") } ?? t("an.advance"), "−" + cur(a.amount ?? 0))
                        }
                        detail(t("byCash"), cur(r.cash))
                        if r.paid > 0 { detail(t("pe.paidStatus"), "−" + cur(r.paid)) }
                        if r.card > 0 { detail(t("an.cardThisMonth"), cur(r.card)) }
                    }
                    .padding(.horizontal, 14).padding(.bottom, 14)
                }
            }
            .background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 14))
        }
    }
    private func detail(_ l: String, _ v: String) -> some View {
        HStack {
            Text(l).font(.system(size: 13)).foregroundStyle(.primary.opacity(0.5))
            Spacer()
            Text(v).font(.system(size: 13, weight: .medium)).foregroundStyle(.primary.opacity(0.85))
        }
    }
    private func miniTotal(_ l: String, _ v: String, _ c: Color) -> some View {
        VStack(spacing: 2) {
            Text(v).font(.system(size: 16, weight: .bold)).foregroundStyle(c)
            Text(l).font(.system(size: 11)).foregroundStyle(.primary.opacity(0.45))
        }
        .frame(maxWidth: .infinity)
    }

}

// MARK: Долги (только просмотр — оплата теперь в Manager, прямо при закрытии смены)

private struct DebtsTab: View {
    @Bindable var m: AnalyticsModel
    @State private var showHistory = false

    var body: some View {
        VStack(spacing: 10) {
            Text(t("an.debts")).font(.system(size: 12, weight: .semibold)).foregroundStyle(.primary.opacity(0.45)).kerning(0.5)
            Text(cur(m.debtTotal)).font(.system(size: 30, weight: .heavy)).foregroundStyle(BrandKit.stash)
            Text(t("an.debtTotalHint")).font(.system(size: 11)).foregroundStyle(.primary.opacity(0.4))
        }
        .frame(maxWidth: .infinity).padding(.vertical, 18)
        .background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 16))

        if m.periodDebts.isEmpty {
            VStack(spacing: 6) {
                Image(systemName: "checkmark.circle").font(.system(size: 28)).foregroundStyle(.primary.opacity(0.25))
                Text(t("an.debtsNonePeriod")).font(.system(size: 13)).foregroundStyle(.primary.opacity(0.45))
            }
            .frame(maxWidth: .infinity).padding(.vertical, 28)
        } else {
            VStack(spacing: 0) {
                ForEach(m.periodDebts) { d in
                    HStack(spacing: 10) {
                        Image(systemName: "exclamationmark.circle.fill").font(.system(size: 14)).foregroundStyle(BrandKit.stash)
                        VStack(alignment: .leading, spacing: 1) {
                            Text(d.categoryName).font(.system(size: 14, weight: .medium)).foregroundStyle(.primary)
                            Text(dayLabelRu(d.date)).font(.system(size: 11)).foregroundStyle(.primary.opacity(0.45))
                        }
                        Spacer()
                        Text(cur(d.amount)).font(.system(size: 14, weight: .semibold)).foregroundStyle(BrandKit.stash)
                    }
                    .padding(.horizontal, 14).padding(.vertical, 10)
                    if d.id != m.periodDebts.last?.id { Divider().overlay(Color.primary.opacity(0.08)).padding(.leading, 38) }
                }
            }
            .background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 14))
        }

        if !m.periodDebtHistory.isEmpty {
            VStack(spacing: 0) {
                Button { withAnimation(.easeInOut(duration: 0.18)) { showHistory.toggle() } } label: {
                    HStack {
                        Text(t("an.debtHistory")).font(.system(size: 12, weight: .medium)).foregroundStyle(.primary.opacity(0.5))
                        Spacer()
                        Image(systemName: showHistory ? "chevron.up" : "chevron.down")
                            .font(.system(size: 10)).foregroundStyle(.primary.opacity(0.4))
                    }
                    .padding(14)
                }
                .buttonStyle(.plain)
                if showHistory {
                    ForEach(m.periodDebtHistory) { d in
                        HStack(spacing: 10) {
                            Image(systemName: "checkmark.circle.fill").font(.system(size: 14)).foregroundStyle(.green)
                            VStack(alignment: .leading, spacing: 1) {
                                Text(d.categoryName).font(.system(size: 13, weight: .medium)).foregroundStyle(.primary.opacity(0.8))
                                Text(d.paidAt.map { dayLabelRu(d.date) + " · " + t("pe.paidOn", ["date": dayLabelRu($0)]) } ?? dayLabelRu(d.date))
                                    .font(.system(size: 11)).foregroundStyle(.primary.opacity(0.4))
                            }
                            Spacer()
                            Text(cur(d.amount)).font(.system(size: 13, weight: .medium)).foregroundStyle(.primary.opacity(0.5))
                        }
                        .padding(.horizontal, 14).padding(.vertical, 8)
                        if d.id != m.periodDebtHistory.last?.id { Divider().overlay(Color.primary.opacity(0.08)).padding(.leading, 38) }
                    }
                    .padding(.bottom, 8)
                }
            }
            .background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 14))
        }
    }
}

/// Поле ввода суммы «на карту в этом месяце».
// Не private — переиспользуется Manager→Зарплата (ManagerSalary.swift, реструктура 2026-08-14).
struct CardInputRow: View {
    let empId: String
    let current: Double
    let onSave: (Double) -> Void
    @State private var text = ""
    @FocusState private var focused: Bool

    var body: some View {
        HStack {
            Text(t("an.cardThisMonth")).font(.system(size: 13)).foregroundStyle(.primary.opacity(0.5))
            Spacer()
            HStack(spacing: 6) {
                Text(Money.symbol).foregroundStyle(.primary.opacity(0.4))
                TextField("0", text: $text)
                    .keyboardType(.numberPad).multilineTextAlignment(.trailing)
                    .font(.system(size: 14, weight: .semibold)).foregroundStyle(BrandKit.manager)
                    .frame(width: 60).focused($focused)
                // Явная кнопка «Готово» рядом с полем при фокусе (надёжнее keyboard-тулбара,
                // который в ForEach внутри TabView не всегда показывался).
                if focused {
                    Button(t("done")) { onSave(Double(text) ?? 0); focused = false }
                        .font(.system(size: 13, weight: .bold)).foregroundStyle(BrandKit.analytics)
                }
            }
            .padding(.vertical, 6).padding(.horizontal, 10)
            .background(Color.primary.opacity(0.07), in: RoundedRectangle(cornerRadius: 8))
        }
        .onAppear { text = current > 0 ? String(Int(current)) : "" }
        .onChange(of: focused) { _, isFocused in
            if !isFocused { onSave(Double(text) ?? 0) }
        }
    }
}

// Не private — переиспользуется Manager→Зарплата (ManagerSalary.swift, реструктура 2026-08-14).
struct AdvanceAddSheet: View {
    let monthRange: ClosedRange<Date>
    let onSave: (Double, String) -> Void
    @State private var amount = ""
    @State private var date: Date
    @Environment(\.dismiss) private var dismiss

    // Дефолт — реальное «сегодня», но зажатое в границы ПРОСМАТРИВАЕМОГО месяца: иначе если
    // добавить аванс, листая Analytics на прошлый/будущий месяц, и не потрогать пикер —
    // запись улетала под сегодняшнее число (другой месяц), инкассация списывалась со смены
    // просматриваемого месяца, а сама запись при следующей загрузке пропадала из Зарплаты
    // (не попадала в date-фильтр текущего просмотра) — юзер-репорт 2026-08-04.
    init(monthRange: ClosedRange<Date>, onSave: @escaping (Double, String) -> Void) {
        self.monthRange = monthRange
        self.onSave = onSave
        _date = State(initialValue: min(max(Date(), monthRange.lowerBound), monthRange.upperBound))
    }

    var body: some View {
        NavigationStack {
            ZStack {
                Color.miseBg.ignoresSafeArea()
                VStack(spacing: 20) {
                    HStack(spacing: 8) {
                        Text(Money.symbol).font(.system(size: 22, weight: .bold)).foregroundStyle(.primary.opacity(0.4))
                        TextField("0", text: $amount)
                            .keyboardType(.decimalPad)
                            .font(.system(size: 28, weight: .heavy)).foregroundStyle(BrandKit.analytics)
                    }
                    .padding(16)
                    .background(Color.primary.opacity(0.07), in: RoundedRectangle(cornerRadius: 14))

                    DatePicker(t("an.date"), selection: $date, in: monthRange, displayedComponents: .date)
                        .datePickerStyle(.compact).tint(BrandKit.analytics)

                    Spacer()
                }
                .padding(20)
            }
            .navigationTitle(t("an.addAdvance")).navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(t("cancel")) { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(t("done")) {
                        let df = DateFormatter()
                        df.dateFormat = "yyyy-MM-dd"
                        df.locale = Locale(identifier: "en_US_POSIX")
                        onSave(Double(amount.replacingOccurrences(of: ",", with: ".")) ?? 0, df.string(from: date))
                        dismiss()
                    }
                    .disabled((Double(amount.replacingOccurrences(of: ",", with: ".")) ?? 0) <= 0)
                    .fontWeight(.bold)
                }
            }
            .toolbarBackground(Color.miseBg, for: .navigationBar)
        }
        .presentationDetents([.medium])
    }
}

// MARK: Кальян

private struct HookahTab: View {
    @Bindable var m: AnalyticsModel
    @State private var showBreakdown = false
    private func openBreakdown() {
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        showBreakdown = true
    }
    var body: some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 10), count: 2), spacing: 10) {
            stat(t("st.sold"), "\(m.qtyMonth)", BrandKit.stash).onLongPressGesture(minimumDuration: 0.4) { openBreakdown() }
            stat(t("st.revenue"), cur(m.revMonth), BrandKit.analytics)
            stat(t("st.free"), "\(m.qtyFree)", BrandKit.people).onLongPressGesture(minimumDuration: 0.4) { openBreakdown() }
            stat(t("st.tobacco"), kg(m.usedMonthG), BrandKit.manager)
        }
        .sheet(isPresented: $showBreakdown) {
            HookahBreakdownSheet(
                title: t("tab.hookah"),
                paid: m.byType.map { (name: $0.name, count: $0.paid) },
                free: m.freeByCat.map { (name: $0.name, count: $0.count) }
            )
        }
        // Где какой объём табака: на складе и в заведении
        HStack(spacing: 10) {
            volCard(t("an.inStock"), m.venueStockG, BrandKit.manager)
            volCard(t("an.atVenue"), m.venueAtPlaceG, BrandKit.stash)
        }

        // Смены по дням: дата · количество · сумма; раскрытие → по видам
        if m.hookahByDay.isEmpty {
            Text(t("an.noHookahShifts"))
                .font(.system(size: 14)).foregroundStyle(.primary.opacity(0.4)).padding(.top, 20)
        } else {
            Text(t("an.shiftsByDay")).font(.system(size: 12, weight: .semibold)).foregroundStyle(.primary.opacity(0.45)).kerning(0.5)
                .frame(maxWidth: .infinity, alignment: .leading).padding(.top, 4)
            ForEach(m.hookahByDay) { day in DayRow(day: day) }
        }
    }

    private func volCard(_ label: String, _ g: Double, _ color: Color) -> some View {
        VStack(spacing: 3) {
            Text(kg(g)).font(.system(size: 20, weight: .heavy)).foregroundStyle(color)
            Text(label).font(.system(size: 12)).foregroundStyle(.primary.opacity(0.45))
        }
        .frame(maxWidth: .infinity).padding(.vertical, 14)
        .background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 14))
    }
    private func stat(_ label: String, _ value: String, _ color: Color) -> some View {
        VStack(spacing: 3) {
            Text(value).font(.system(size: 20, weight: .heavy)).foregroundStyle(color).minimumScaleFactor(0.6).lineLimit(1)
            Text(label).font(.system(size: 12)).foregroundStyle(.primary.opacity(0.45))
        }
        .frame(maxWidth: .infinity).padding(.vertical, 14)
        .background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 14))
    }
}

// MARK: Экспорт

/// UIActivityViewController bridge for sharing files.
private struct ShareSheet: UIViewControllerRepresentable {
    let activityItems: [Any]
    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: activityItems, applicationActivities: nil)
    }
    func updateUIViewController(_ vc: UIActivityViewController, context: Context) {}
}

private struct SharePayload: Identifiable { let id = UUID(); let url: URL }

/// A small export menu button (CSV + PDF) for analytics tabs.
/// `compact` — иконка без подписи, для встраивания в строку заголовка («ПО ДНЯМ»).
private struct ExportMenuButton: View {
    let m: AnalyticsModel
    var compact: Bool = false
    @State private var payload: SharePayload?

    private func writePDF() -> URL? {
        let data = m.buildPDF()
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("analytics-\(m.navLabel.replacingOccurrences(of: " ", with: "-")).pdf")
        return (try? data.write(to: url)) != nil ? url : nil
    }

    // Презентация share-листа прямо из Menu-действия в SwiftUI ненадёжна (лист не
    // открывается) — даём меню закрыться и только потом ставим item.
    private func present(_ url: URL?) {
        guard let url else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { payload = SharePayload(url: url) }
    }

    var body: some View {
        Menu {
            Button { present(m.csvFileURL()) } label: {
                Label(t("an.exportCSV"), systemImage: "tablecells")
            }
            Button { present(writePDF()) } label: {
                Label(t("an.exportPDF"), systemImage: "doc.richtext")
            }
        } label: {
            if compact {
                Image(systemName: "square.and.arrow.up")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(BrandKit.analytics)
                    .padding(6)
                    .background(Color.primary.opacity(0.07), in: Circle())
            } else {
                Label(t("an.export"), systemImage: "square.and.arrow.up")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(BrandKit.analytics)
                    .padding(.vertical, 6).padding(.horizontal, 12)
                    .background(Color.primary.opacity(0.07), in: Capsule())
            }
        }
        .sheet(item: $payload) { p in
            ShareSheet(activityItems: [p.url])
        }
    }
}

// MARK: Касса

private struct KassaTab: View {
    @Bindable var m: AnalyticsModel
    @State private var reasonPopoverShiftID: String?
    @State private var selectedKassaDate: String?

    /// Точка, для которой сейчас показан бейдж: то, что тронул пальцем, либо последний
    /// день по умолчанию — так график всегда «говорящий», даже без взаимодействия.
    private var effectiveKassaShift: Shift? {
        if let selectedKassaDate { return m.filledShifts.first { $0.date == selectedKassaDate } }
        return m.filledShifts.last
    }

    private func kassaBubble(_ s: Shift) -> some View {
        VStack(spacing: 1) {
            Text(cur(s.closing_balance ?? 0)).font(.system(size: 12, weight: .bold)).foregroundStyle(.primary)
            Text(dayLabelRu(s.date)).font(.system(size: 9)).foregroundStyle(.primary.opacity(0.5))
        }
        .padding(.horizontal, 8).padding(.vertical, 5)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 8))
        .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(Color.primary.opacity(0.08)))
    }

    var body: some View {
        Picker("", selection: $m.kassaMode) {
            Text(t("tab.kassa")).tag("kassa"); Text(t("mg.inkass")).tag("inkass")
        }.pickerStyle(.segmented)

        if m.kassaMode == "kassa" {
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 10), count: 2), spacing: 10) {
                stat(t("an.balance"), cur(m.shifts.last?.closing_balance ?? 0), BrandKit.manager)
                stat(t("an.lastIncome"), cur(m.shifts.last?.income ?? 0), BrandKit.analytics)
            }
            if m.filledShifts.count > 1 {
                chartCard(t("an.tillBalance")) {
                    Chart(m.filledShifts) { s in
                        AreaMark(x: .value("Дата", s.date), y: .value("Касса", s.closing_balance ?? 0))
                            .foregroundStyle(LinearGradient(
                                colors: [BrandKit.manager.opacity(0.32), BrandKit.manager.opacity(0)],
                                startPoint: .top, endPoint: .bottom))
                            .interpolationMethod(.catmullRom)
                        LineMark(x: .value("Дата", s.date), y: .value("Касса", s.closing_balance ?? 0))
                            .foregroundStyle(BrandKit.manager).interpolationMethod(.catmullRom)
                            .lineStyle(StrokeStyle(lineWidth: 2, lineCap: .round))
                        if let eff = effectiveKassaShift, eff.id == s.id {
                            PointMark(x: .value("Дата", s.date), y: .value("Касса", s.closing_balance ?? 0))
                                .foregroundStyle(BrandKit.manager)
                                .symbolSize(90)
                            RuleMark(x: .value("Дата", s.date))
                                .foregroundStyle(.primary.opacity(selectedKassaDate == nil ? 0 : 0.18))
                                .lineStyle(StrokeStyle(lineWidth: 1))
                                .zIndex(-1)
                                .annotation(position: .top, spacing: 6, overflowResolution: .init(x: .fit(to: .chart), y: .disabled)) {
                                    kassaBubble(eff)
                                }
                        }
                    }
                    .chartXAxis(.hidden)
                    .chartYAxis { AxisMarks { _ in AxisValueLabel().foregroundStyle(.primary.opacity(0.4)) } }
                    .chartXSelection(value: $selectedKassaDate)
                    .frame(height: 150)
                }
            }
            if m.filledShifts.isEmpty {
                Text(t("an.noShiftData")).font(.system(size: 14)).foregroundStyle(.primary.opacity(0.4)).padding(.top, 30)
            } else {
                VStack(alignment: .leading, spacing: 0) {
                    HStack {
                        Text(t("an.byDay")).font(.system(size: 12, weight: .semibold)).foregroundStyle(.primary.opacity(0.45)).kerning(0.5)
                        Spacer()
                        ExportMenuButton(m: m, compact: true)
                    }
                    .padding(.bottom, 8)
                    HStack {
                        Text(t("an.date")).frame(width: 44, alignment: .leading)
                        Text(t("an.income")).frame(maxWidth: .infinity, alignment: .trailing)
                        Text(t("an.expense")).frame(maxWidth: .infinity, alignment: .trailing)
                        Text(t("mg.inkass")).frame(maxWidth: .infinity, alignment: .trailing)
                        Text(t("tab.kassa")).frame(maxWidth: .infinity, alignment: .trailing)
                    }
                    .font(.system(size: 11)).foregroundStyle(.primary.opacity(0.35)).padding(.bottom, 6)
                    ForEach(Array(m.filledShiftsDisplay.enumerated()), id: \.element.id) { i, s in
                        let expenseNoInk = max((s.total_expense ?? 0) - (s.inkassation ?? 0), 0)
                        HStack {
                            Text(dd(s.date)).frame(width: 44, alignment: .leading).foregroundStyle(.primary.opacity(0.5))
                            cell((s.income ?? 0) > 0 ? cur(s.income ?? 0) : "—", BrandKit.analytics)
                            cell(expenseNoInk > 0 ? cur(expenseNoInk) : "—", BrandKit.menu)
                            cell((s.inkassation ?? 0) > 0 ? cur(s.inkassation ?? 0) : "—", BrandKit.stash)
                            cell(cur(s.closing_balance ?? 0), BrandKit.manager, bold: true)
                        }
                        .font(.system(size: 12)).padding(.vertical, 9)
                        if i < m.filledShifts.count - 1 { Divider().overlay(Color.primary.opacity(0.07)) }
                    }
                }
                .padding(14).background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 16))
            }
        } else {
            // Нетто (salCash = оклад − прогулы − аванс − карта), а не оклад: та же логика,
            // что в per-employee строках People→Зарплата, иначе выданный аванс/карта не
            // уменьшают «начислено» и цифра расходится с реальным долгом. Цикл рампа
            // привязан к payout_day, см. m.salToday.
            let salToday = m.salToday
            // Инкассация — накопительная (деньги заведения, перетекают из месяца в месяц).
            let diff = m.cumulativeInkass - salToday
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 10), count: 2), spacing: 10) {
                stat(t("an.totalInkass"), cur(m.cumulativeInkass), BrandKit.stash)
                stat(t("an.salaryToday"), cur(salToday), diff >= 0 ? BrandKit.analytics : BrandKit.menu)
            }
            if m.shiftsWithInk.isEmpty {
                Text(t("an.noInkass")).font(.system(size: 14)).foregroundStyle(.primary.opacity(0.4)).padding(.top, 30)
            } else {
                VStack(spacing: 0) {
                    HStack {
                        Text(t("an.date")).frame(width: 32, alignment: .leading)
                        Text(t("mg.inkass")).frame(maxWidth: .infinity, alignment: .trailing)
                        Text(t("an.expense")).frame(maxWidth: .infinity, alignment: .trailing)
                        Spacer().frame(width: 26)
                        Text(t("an.inkNet")).frame(width: 84, alignment: .trailing)
                    }
                    .font(.system(size: 11)).foregroundStyle(.primary.opacity(0.35))
                    .padding(.horizontal, 14).padding(.top, 12).padding(.bottom, 6)
                    Divider().overlay(Color.primary.opacity(0.08))
                    ForEach(Array(m.shiftsWithInk.enumerated()), id: \.element.id) { i, s in
                        let ink = m.inkDetails[s.id]
                        // C6 (юзер-фидбок 2026-08-15): иконка заметки проверяла только reason,
                        // salary_note (выплаты ЗП) не подсвечивала — записи о зарплате были
                        // невидимы в Кассе/Инкассации, хотя реально пишутся в БД.
                        let hasReason = ink?.reason?.isEmpty == false || ink?.salary_note?.isEmpty == false
                        HStack {
                            Text(dd(s.date)).frame(width: 32, alignment: .leading).foregroundStyle(.primary.opacity(0.5))
                            Text(cur(s.inkassation ?? 0)).frame(maxWidth: .infinity, alignment: .trailing)
                                .foregroundStyle(BrandKit.stash).lineLimit(1).minimumScaleFactor(0.75)
                            // Не только expense — salary тоже реально списывается из фонда
                            // (юзер-фидбок 2026-08-16: колонка «Расход» показывала «—» для
                            // ЗП-выплаты, хотя «Итого» уже честно её учитывало — путало).
                            Text({ let d = (ink?.expense ?? 0) + (ink?.salary ?? 0); return d > 0 ? "−" + cur(d) : "—" }())
                                .frame(maxWidth: .infinity, alignment: .trailing).foregroundStyle(BrandKit.menu)
                                .lineLimit(1).minimumScaleFactor(0.75)
                            Button {
                                reasonPopoverShiftID = (reasonPopoverShiftID == s.id) ? nil : s.id
                            } label: {
                                Image(systemName: "note.text")
                                    .font(.system(size: 12, weight: .semibold))
                                    .foregroundStyle(hasReason ? BrandKit.stash : .primary.opacity(0.25))
                            }
                            .buttonStyle(.plain)
                            .contentShape(Rectangle())
                            .frame(width: 26, alignment: .center)
                            .disabled(!hasReason)
                            .popover(isPresented: Binding(
                                get: { reasonPopoverShiftID == s.id },
                                set: { if !$0 { reasonPopoverShiftID = nil } }
                            ), attachmentAnchor: .point(.top), arrowEdge: .top) {
                                // C6 (юзер-фидбок 2026-08-15): попап показывал только reason,
                                // salary_note (выплаты ЗП с этого дня) не показывался вообще.
                                // Нет ветки «оба пустые — показать —»: кнопка задизейблена
                                // (.disabled(!hasReason)) как раз тогда, когда оба пустые, так что
                                // попап физически не может открыться в этом состоянии (аудит 2026-08-15).
                                VStack(alignment: .leading, spacing: 8) {
                                    if let reason = ink?.reason, !reason.isEmpty {
                                        Text(reason).font(.system(size: 13)).foregroundStyle(.primary)
                                    }
                                    if let note = ink?.salary_note, !note.isEmpty {
                                        Text(t("mg.tabSalary") + ": " + note).font(.system(size: 13)).foregroundStyle(BrandKit.manager)
                                    }
                                }
                                .padding(14)
                                .frame(maxWidth: 230, alignment: .leading)
                                .fixedSize(horizontal: false, vertical: true)
                                .presentationCompactAdaptation(.popover)
                            }
                            Text(cur(ink?.total ?? (s.inkassation ?? 0)))
                                .frame(width: 84, alignment: .trailing).fontWeight(.semibold)
                                .lineLimit(1).minimumScaleFactor(0.7)
                        }
                        .font(.system(size: 12)).padding(.vertical, 9).padding(.horizontal, 14)
                        if i < m.shiftsWithInk.count - 1 { Divider().overlay(Color.primary.opacity(0.07)) }
                    }
                }
                .background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 16))
            }
        }
    }

    private func cell(_ v: String, _ c: Color, bold: Bool = false) -> some View {
        Text(v).frame(maxWidth: .infinity, alignment: .trailing)
            .foregroundStyle(c).fontWeight(bold ? .bold : .regular)
    }
    private func stat(_ label: String, _ value: String, _ color: Color) -> some View {
        VStack(spacing: 3) {
            Text(value).font(.system(size: 20, weight: .heavy)).foregroundStyle(color).minimumScaleFactor(0.6).lineLimit(1)
            Text(label).font(.system(size: 12)).foregroundStyle(.primary.opacity(0.45))
        }
        .frame(maxWidth: .infinity).padding(.vertical, 14)
        .background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 14))
    }
    private func chartCard<C: View>(_ title: String, @ViewBuilder _ content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title).font(.system(size: 12, weight: .semibold)).foregroundStyle(.primary.opacity(0.45)).kerning(0.5)
            content()
        }
        .padding(14).frame(maxWidth: .infinity).background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 16))
    }
}

private struct DayRow: View {
    let day: AnalyticsModel.DayHookah
    @State private var open = false
    @State private var showBreakdown = false
    var body: some View {
        VStack(spacing: 0) {
            Button { withAnimation(.easeInOut(duration: 0.18)) { open.toggle() } } label: {
                HStack {
                    Text(dayLabelRu(day.date)).font(.system(size: 15, weight: .semibold)).foregroundStyle(.primary)
                    Spacer()
                    Text(t("an.pcs", ["n": "\(day.qty)"])).font(.system(size: 14)).foregroundStyle(.primary.opacity(0.6))
                    Text(cur(day.revenue)).font(.system(size: 15, weight: .bold)).foregroundStyle(BrandKit.analytics)
                    Image(systemName: open ? "chevron.up" : "chevron.down").font(.system(size: 11)).foregroundStyle(.primary.opacity(0.4))
                }
                .padding(14)
            }
            .buttonStyle(.plain)
            if open {
                VStack(spacing: 8) {
                    ForEach(day.types) { t in
                        HStack(spacing: 8) {
                            Text(t.name).font(.system(size: 14, weight: .medium)).foregroundStyle(.primary)
                            Spacer(minLength: 4)
                            Text("\(t.paid)× · \(kg(t.grams))" + (t.free > 0 ? " · +\(t.free)" : ""))
                                .font(.system(size: 12)).foregroundStyle(.primary.opacity(0.45))
                            Text(cur(t.revenue)).font(.system(size: 14, weight: .semibold)).foregroundStyle(BrandKit.analytics)
                                .frame(minWidth: 56, alignment: .trailing)
                        }
                    }
                }
                .padding(.horizontal, 14).padding(.bottom, 14)
            }
        }
        .background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 14))
        .onLongPressGesture(minimumDuration: 0.4) {
            UIImpactFeedbackGenerator(style: .medium).impactOccurred()
            showBreakdown = true
        }
        .sheet(isPresented: $showBreakdown) {
            HookahBreakdownSheet(
                title: dayLabelRu(day.date),
                paid: day.types.map { (name: $0.name, count: $0.paid) },
                free: day.freeByCat.map { (name: $0.name, count: $0.count) }
            )
        }
    }
}

// Долгое нажатие на карточку "продано"/"бесплатно" → сколько именно по видам кальяна
// (продано) и по категориям списания (бесплатно — владелец/сотрудник/кальянщик и т.д.,
// см. StashView.freeCats), без пересечения этих двух разрезов.
private struct HookahBreakdownSheet: View {
    let title: String
    let paid: [(name: String, count: Int)]
    let free: [(name: String, count: Int)]
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                Section(t("an.byType")) {
                    if paid.isEmpty {
                        Text("—").foregroundStyle(.primary.opacity(0.4))
                    } else {
                        ForEach(paid, id: \.name) { row in
                            HStack { Text(row.name); Spacer(); Text("\(row.count)").fontWeight(.semibold) }
                        }
                    }
                }
                Section(t("an.byCategory")) {
                    if free.isEmpty {
                        Text("—").foregroundStyle(.primary.opacity(0.4))
                    } else {
                        ForEach(free, id: \.name) { row in
                            HStack { Text(row.name); Spacer(); Text("\(row.count)").fontWeight(.semibold) }
                        }
                    }
                }
            }
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button(t("done")) { dismiss() } } }
        }
        .presentationDetents([.medium, .large])
    }
}

func dayLabelRu(_ ymd: String) -> String {
    let inF = DateFormatter(); inF.dateFormat = "yyyy-MM-dd"; inF.locale = Locale(identifier: "en_US_POSIX")
    guard let d = inF.date(from: ymd) else { return ymd }
    let f = DateFormatter(); f.locale = appLocale(); f.dateFormat = "EEE, d MMM"
    return f.string(from: d).capitalized
}

// MARK: Банк (Open Banking, Enable Banking) — заменила «Прогноз» (юзер-фидбок 2026-08-16,
// паритет с вебом app/analytics/page.tsx renderBank). Гейт Pro переиспользует aiEnabled
// (тот же флаг, что открывает AI-ассистента) — не заводим отдельный.

private let bankCountries = ["IT", "CH", "FR", "DE", "GB", "LT", "TR", "AZ"]
private func regionName(_ code: String) -> String {
    Locale.current.localizedString(forRegionCode: code) ?? code
}
private func bankTimestamp(_ iso: String?) -> String {
    guard let d = parseISO(iso) else { return "" }
    let f = DateFormatter(); f.locale = appLocale(); f.dateStyle = .short; f.timeStyle = .short
    return f.string(from: d)
}

private struct BankTab: View {
    @Bindable var m: AnalyticsModel
    let bankEnabled: Bool

    var body: some View {
        if !bankEnabled {
            VStack(spacing: 6) {
                Text(t("an.bankProOnly")).font(.system(size: 15, weight: .semibold)).foregroundStyle(.primary)
                Text(t("an.bankProOnlyHint")).font(.system(size: 13)).foregroundStyle(.primary.opacity(0.5))
                    .multilineTextAlignment(.center)
            }
            .frame(maxWidth: .infinity).padding(.vertical, 28).padding(.horizontal, 20)
            .background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 18))
        } else if m.bankConnection == nil {
            connectCard
        } else {
            connectedView
        }
    }

    private var connectCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(t("an.bankConnectCta")).font(.system(size: 15, weight: .semibold)).foregroundStyle(.primary)
            if let err = m.bankError {
                Text(err).font(.system(size: 13)).foregroundStyle(BrandKit.menu)
            }
            if !m.bankInstitutions.isEmpty {
                ForEach(m.bankInstitutions) { inst in
                    Button { Task { await m.connectBank(institutionName: inst.name) } } label: {
                        Text(inst.name).font(.system(size: 14)).foregroundStyle(.primary)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal, 14).padding(.vertical, 12)
                            .background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 12))
                    }
                }
                Button(t("an.back")) { m.bankInstitutions = [] }
                    .font(.system(size: 13)).foregroundStyle(.primary.opacity(0.5))
            } else {
                VStack(alignment: .leading, spacing: 6) {
                    Text(t("an.bankCountry")).font(.system(size: 12)).foregroundStyle(.primary.opacity(0.45))
                    Picker(t("an.bankCountry"), selection: $m.bankCountry) {
                        ForEach(bankCountries, id: \.self) { Text(regionName($0)).tag($0) }
                    }
                    .pickerStyle(.menu).tint(.primary)
                }
                VStack(alignment: .leading, spacing: 6) {
                    Text(t("an.bankName")).font(.system(size: 12)).foregroundStyle(.primary.opacity(0.45))
                    TextField(t("an.bankNamePlaceholder"), text: $m.bankQuery)
                        .font(.system(size: 14)).padding(.horizontal, 12).padding(.vertical, 10)
                        .background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 10))
                }
                Button {
                    Task { await m.connectBank() }
                } label: {
                    Text(m.bankBusy ? "···" : t("an.bankConnect"))
                        .font(.system(size: 15, weight: .bold)).foregroundStyle(.white)
                        .frame(maxWidth: .infinity).padding(.vertical, 14)
                        .background(BrandKit.analytics, in: RoundedRectangle(cornerRadius: 14))
                }
                .disabled(m.bankBusy || m.bankQuery.trimmingCharacters(in: .whitespaces).isEmpty)
                .opacity(m.bankBusy || m.bankQuery.trimmingCharacters(in: .whitespaces).isEmpty ? 0.6 : 1)
            }
        }
        .padding(18).background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 18))
    }

    private var connectedView: some View {
        let c = m.bankConnection!
        let daysLeft = parseISO(c.consent_expires_at).map { Int(ceil($0.timeIntervalSinceNow / 86400)) }
        let grouped = Dictionary(grouping: m.bankTx) { $0.booking_date ?? "—" }
        let days = grouped.keys.sorted(by: >)

        return VStack(alignment: .leading, spacing: 12) {
            if let err = m.bankError {
                Text(err).font(.system(size: 13)).foregroundStyle(BrandKit.menu)
            }
            if let daysLeft, daysLeft <= 7 {
                HStack {
                    Text(t("an.bankReconsentSoon", ["n": "\(max(0, daysLeft))"]))
                        .font(.system(size: 13)).foregroundStyle(BrandKit.stash)
                    Spacer()
                    Button(t("an.bankReconnect")) {
                        Task { await m.connectBank(institutionName: c.institution_name, countryOverride: c.institution_id) }
                    }
                    .font(.system(size: 13, weight: .bold)).foregroundStyle(BrandKit.stash)
                }
                .padding(12).background(BrandKit.stash.opacity(0.1), in: RoundedRectangle(cornerRadius: 14))
            }
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 6) {
                    Text(t("an.bankBalance")).font(.system(size: 12, weight: .semibold)).foregroundStyle(.primary.opacity(0.45)).kerning(0.5)
                    Text(cur(c.balance ?? 0)).font(.system(size: 34, weight: .heavy)).foregroundStyle(.primary)
                    if let ts = c.balance_synced_at {
                        Text(t("an.bankUpdated", ["d": bankTimestamp(ts)])).font(.system(size: 12)).foregroundStyle(.primary.opacity(0.45))
                    }
                }
                Spacer()
                Button { Task { await m.refreshBank() } } label: {
                    Image(systemName: "arrow.triangle.2.circlepath")
                        .font(.system(size: 16, weight: .semibold)).foregroundStyle(.primary)
                        .frame(width: 40, height: 40).background(Color.primary.opacity(0.07), in: Circle())
                }
                .disabled(m.bankBusy).opacity(m.bankBusy ? 0.5 : 1)
            }
            .padding(18).background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 18))
            .frame(maxWidth: .infinity)

            Text(t("an.history")).font(.system(size: 12, weight: .semibold)).foregroundStyle(.primary.opacity(0.45)).kerning(0.5)
            if days.isEmpty {
                Text(t("an.bankNoTransactions")).font(.system(size: 14)).foregroundStyle(.primary.opacity(0.4))
                    .frame(maxWidth: .infinity).padding(.vertical, 30)
            } else {
                VStack(spacing: 0) {
                    ForEach(days, id: \.self) { day in
                        VStack(alignment: .leading, spacing: 0) {
                            Text(dayLabelRu(day)).font(.system(size: 12, weight: .semibold)).foregroundStyle(.primary.opacity(0.45))
                                .padding(.horizontal, 14).padding(.top, 10).padding(.bottom, 4)
                            ForEach(grouped[day] ?? []) { row in
                                let amt = row.amount ?? 0
                                HStack(spacing: 10) {
                                    Image(systemName: amt >= 0 ? "arrow.up" : "arrow.down")
                                        .font(.system(size: 12, weight: .bold))
                                        .foregroundStyle(amt >= 0 ? BrandKit.analytics : BrandKit.menu)
                                        .frame(width: 30, height: 30)
                                        .background((amt >= 0 ? BrandKit.analytics : BrandKit.menu).opacity(0.12), in: Circle())
                                    Text(row.description ?? row.counterparty ?? "—")
                                        .font(.system(size: 14)).foregroundStyle(.primary).lineLimit(1)
                                    Spacer()
                                    Text((amt >= 0 ? "+" : "") + cur(amt))
                                        .font(.system(size: 14, weight: .semibold))
                                        .foregroundStyle(amt >= 0 ? BrandKit.analytics : BrandKit.menu)
                                }
                                .padding(.horizontal, 14).padding(.vertical, 8)
                            }
                        }
                        if day != days.last { Divider().overlay(Color.primary.opacity(0.07)) }
                    }
                }
                .background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 16))
            }
        }
    }
}

// MARK: AI Advisor Card

/// Proactive AI insights card shown on the Period tab when AI is enabled.
private struct AIAdvisorCard: View {
    @Bindable var m: AnalyticsModel
    @State private var insights: String = ""
    @State private var loading = false
    @State private var error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text(t("an.advisor"))
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(.primary.opacity(0.45))
                    .kerning(0.5)
                Spacer()
                Button {
                    Task { await refresh() }
                } label: {
                    if loading {
                        ProgressView().scaleEffect(0.7)
                    } else {
                        Image(systemName: "arrow.clockwise")
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(BrandKit.analytics)
                    }
                }
                .disabled(loading)
            }

            if loading {
                Text(t("an.advisorLoading"))
                    .font(.system(size: 13))
                    .foregroundStyle(.primary.opacity(0.4))
            } else if let err = error {
                Text(err)
                    .font(.system(size: 13))
                    .foregroundStyle(BrandKit.menu)
            } else if insights.isEmpty {
                Text(t("an.advisorEmpty"))
                    .font(.system(size: 13))
                    .foregroundStyle(.primary.opacity(0.4))
            } else {
                // Render each line as a bullet point
                let lines = insights
                    .components(separatedBy: "\n")
                    .map { $0.trimmingCharacters(in: .whitespaces) }
                    .filter { !$0.isEmpty }
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(lines.indices, id: \.self) { i in
                        HStack(alignment: .top, spacing: 8) {
                            Text("–")
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundStyle(BrandKit.analytics)
                                .frame(width: 10, alignment: .leading)
                            Text(cleanBullet(lines[i]))
                                .font(.system(size: 13))
                                .foregroundStyle(.primary.opacity(0.85))
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                }
            }
        }
        .padding(14)
        .background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 16))
        .task { if insights.isEmpty && !loading { await refresh() } }
    }

    private func refresh() async {
        loading = true; error = nil
        let prompt = t("an.advisorPrompt")
        if let reply = await m.handleAI(prompt) {
            if reply.hasPrefix(t("ai.err")) || reply.hasPrefix(t("ai.errGeneric")) {
                error = reply
            } else {
                insights = reply
            }
        } else {
            error = t("ai.noReply")
        }
        loading = false
    }

    /// Strip markdown bullet prefixes (*, -, •, 1.) that the AI might return.
    private func cleanBullet(_ s: String) -> String {
        var r = s
        for prefix in ["* ", "- ", "• ", "– ", "— "] {
            if r.hasPrefix(prefix) { r = String(r.dropFirst(prefix.count)); break }
        }
        // strip leading "1. ", "2. " etc.
        if let dot = r.firstIndex(of: "."), r.distance(from: r.startIndex, to: dot) <= 2,
           r.index(after: dot) < r.endIndex, r[r.index(after: dot)] == " " {
            r = String(r[r.index(dot, offsetBy: 2)...])
        }
        return r
    }
}

private func dd(_ ymd: String) -> String {
    guard ymd.count >= 10 else { return ymd }
    return String(ymd.suffix(2)) // день месяца
}

private func monthLabel(_ d: Date) -> String {
    let f = DateFormatter(); f.locale = appLocale(); f.dateFormat = "LLLL yyyy"
    return f.string(from: d).capitalized
}
