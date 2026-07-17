import SwiftUI

// MARK: - Бизнес-отчёт (Настройки → «Бизнес-отчёт»)
//
// Один PDF на весь бизнес: обзор/KPI, касса и инкассация, продажи и гости,
// персонал и расходы. Период — месяц (детальные данные) или «весь период»
// (последние 3 года, помесячно — иначе тысячи построчных смен нечитаемы в PDF).

@MainActor
@Observable
final class ReportModel {
    let rid: String
    var periodMode = "month" // "month" | "all"
    var currentDate = Date()
    var loading = false

    private(set) var shiftsRaw: [Shift] = []
    private(set) var prevShiftsRaw: [Shift] = []
    private(set) var expenses: [ShiftExpense] = []
    private(set) var employees: [Employee] = []
    private(set) var absences: [Absence] = []
    private(set) var hookahSales: [HookahSale] = []
    private(set) var bookings12mo: [Booking] = []
    private(set) var periodStart = Date()
    private(set) var periodEnd = Date()
    private var includeCard = false
    private var hkPrice = 0.0

    init(rid: String) { self.rid = rid }

    private let df: DateFormatter = {
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.locale = Locale(identifier: "en_US_POSIX"); return f
    }()
    func key(_ d: Date) -> String { df.string(from: d) }

    var isMonthMode: Bool { periodMode == "month" }

    func load() async {
        loading = true; defer { loading = false }
        let cal = Calendar.current
        let start: Date, end: Date
        if isMonthMode {
            start = cal.date(from: cal.dateComponents([.year, .month], from: currentDate)) ?? currentDate
            end = cal.date(byAdding: DateComponents(month: 1, day: -1), to: start) ?? start
        } else {
            start = cal.date(byAdding: .year, value: -3, to: Date()) ?? Date()
            end = Date()
        }
        periodStart = start; periodEnd = end
        let prevStart = cal.date(byAdding: .month, value: -1, to: start) ?? start
        let prevEnd = cal.date(byAdding: .day, value: -1, to: start) ?? start

        #if DEBUG
        // Визуальная проверка PDF без реального входа/бэкенда — см. AppModel.start().
        if ProcessInfo.processInfo.environment["MISE_DEMO_UI"] == "1" {
            seedDemo(start: start, end: end, prevStart: prevStart, prevEnd: prevEnd)
            return
        }
        #endif

        if let s = try? await DB.from("restaurant_settings").select().limit(1).list(AnalyticsSettings.self).first {
            includeCard = s.include_card_in_analytics ?? false
            hkPrice = s.hookah_price ?? 0
        }

        async let sh = try? DB.from("shifts").select().gte("date", key(start)).lte("date", key(end)).order("date").list(Shift.self)
        async let prev = try? DB.from("shifts").select().gte("date", key(prevStart)).lte("date", key(prevEnd)).list(Shift.self)
        async let emps = try? DB.from("employees").select().eq("is_active", true).order("name").list(Employee.self)
        async let abs = try? DB.from("shift_absences").select().gte("date", key(start)).lte("date", key(end)).list(Absence.self)
        async let hk = try? DB.from("hookah_sales").select().gte("date", key(start)).lte("date", key(end)).list(HookahSale.self)
        let twelveMoAgo = cal.date(byAdding: .month, value: -12, to: Date()) ?? Date()
        async let bks = try? DB.from("bookings").select().gte("booking_date", key(twelveMoAgo)).order("booking_date").list(Booking.self)

        shiftsRaw = (await sh) ?? []
        prevShiftsRaw = (await prev) ?? []
        employees = (await emps) ?? []
        absences = (await abs)?.filter { $0.source != "auto" } ?? []
        hookahSales = (await hk) ?? []
        bookings12mo = (await bks) ?? []

        let ids = shiftsRaw.map(\.id)
        if !ids.isEmpty, let e = try? await DB.from("shift_expenses").select().in("shift_id", ids).list(ShiftExpense.self) {
            expenses = e
        } else { expenses = [] }
    }

    // MARK: - Касса

    // Как в AnalyticsModel: income_card подмешивается в income только если включена
    // настройка include_card_in_analytics — иначе доход задваивается.
    private func adj(_ rows: [Shift]) -> [Shift] {
        guard includeCard else { return rows }
        return rows.map { var s = $0; s.income = ($0.income ?? 0) + ($0.income_card ?? 0); return s }
    }
    var shifts: [Shift] { adj(shiftsRaw) }
    var prevShifts: [Shift] { adj(prevShiftsRaw) }

    var totalIncome: Double { shifts.reduce(0) { $0 + ($1.income ?? 0) } }
    var totalExpense: Double { shifts.reduce(0) { $0 + ($1.total_expense ?? 0) } }
    var totalInkass: Double { shifts.reduce(0) { $0 + ($1.inkassation ?? 0) } }
    var netProfit: Double { totalIncome - totalExpense }
    var prevIncome: Double { prevShifts.reduce(0) { $0 + ($1.income ?? 0) } }
    var prevExpense: Double { prevShifts.reduce(0) { $0 + ($1.total_expense ?? 0) } }

    var filledShifts: [Shift] { shifts.filter { ($0.income ?? 0) > 0 || ($0.total_expense ?? 0) > 0 }.sorted { $0.date < $1.date } }
    var filledShiftsDisplay: [Shift] {
        var rows = filledShifts
        guard rows.count > 1 else { return rows }
        for i in 1..<rows.count { rows[i].opening_balance = rows[i - 1].closing_balance }
        return rows
    }
    var avgPerDay: Double { filledShifts.isEmpty ? 0 : totalIncome / Double(filledShifts.count) }

    struct DayAgg { let label: String; let income: Double; let expense: Double }
    /// Все дни месяца (не только заполненные) — график должен показывать полную
    /// временную ось, иначе при малом числе смен пара баров теряется в пустой странице.
    var calendarDays: [DayAgg] {
        let cal = Calendar.current
        guard let range = cal.range(of: .day, in: .month, for: periodStart) else { return [] }
        var byDate: [String: Shift] = [:]
        for s in shifts { byDate[s.date] = s }
        var comps = cal.dateComponents([.year, .month], from: periodStart)
        return range.map { day in
            comps.day = day
            let d = cal.date(from: comps) ?? periodStart
            let s = byDate[key(d)]
            return DayAgg(label: "\(day)", income: s?.income ?? 0, expense: s?.total_expense ?? 0)
        }
    }

    struct MonthAgg { let label: String; let income: Double; let expense: Double; let inkass: Double }
    /// Помесячные суммы — таблица/график кассы в режиме «весь период».
    var monthlyAgg: [MonthAgg] {
        let bucketKey = DateFormatter(); bucketKey.dateFormat = "yyyy-MM"; bucketKey.locale = Locale(identifier: "en_US_POSIX")
        let labelFmt = DateFormatter(); labelFmt.locale = appLocale(); labelFmt.dateFormat = "LLL yy"
        var buckets: [String: (income: Double, expense: Double, inkass: Double, date: Date)] = [:]
        for s in shifts {
            guard let d = df.date(from: s.date) else { continue }
            let mk = bucketKey.string(from: d)
            var b = buckets[mk] ?? (0, 0, 0, d)
            b.income += s.income ?? 0
            b.expense += s.total_expense ?? 0
            b.inkass += s.inkassation ?? 0
            buckets[mk] = b
        }
        return buckets.values.sorted { $0.date < $1.date }
            .map { MonthAgg(label: labelFmt.string(from: $0.date), income: $0.income, expense: $0.expense, inkass: $0.inkass) }
    }

    // MARK: - Расходы

    var catTotals: [(String, Double)] {
        var m: [String: Double] = [:]
        for e in expenses {
            if e.category_name?.hasPrefix("Аванс") == true { continue }
            m[e.category_name ?? "—", default: 0] += e.amount ?? 0
        }
        return m.sorted { $0.value > $1.value }
    }

    // MARK: - Продажи

    struct FlavorRow { let name: String; let qty: Double; let revenue: Double }
    var topFlavors: [FlavorRow] {
        var m: [String: (qty: Double, rev: Double)] = [:]
        for s in hookahSales {
            let name = s.flavor ?? s.brand ?? "—"
            var cur = m[name] ?? (0, 0)
            let qty = s.quantity ?? 0
            cur.qty += qty
            if s.is_free != true { cur.rev += qty * (s.price ?? hkPrice) }
            m[name] = cur
        }
        return m.map { FlavorRow(name: $0.key, qty: $0.value.qty, revenue: $0.value.rev) }.sorted { $0.revenue > $1.revenue }
    }
    var freePortions: Double { hookahSales.filter { $0.is_free == true }.reduce(0) { $0 + ($1.quantity ?? 0) } }

    // MARK: - Гости (12 мес., как GuestsView)

    var topGuests: [GuestProfile] { Array(buildGuestProfiles(from: bookings12mo).prefix(10)) }

    // MARK: - Персонал
    // Упрощение: используется фиксированная employees.card_amount без помесячных
    // override из monthly_card_amounts (там уже нет единого «месяца» для «всего периода»).

    struct PayrollRow { let name: String; let salary: Double; let absN: Int; let deduct: Double; let card: Double; let cash: Double; let total: Double }
    var payroll: [PayrollRow] {
        employees.map { emp in
            let n = absences.filter { $0.employee_id == emp.id }.count
            let deduct = Double(n) * (emp.deduct_per_absence ?? 0)
            let card = emp.card_amount ?? 0
            let cash = (emp.salary ?? 0) - deduct - card
            return PayrollRow(name: emp.name, salary: emp.salary ?? 0, absN: n, deduct: deduct, card: card, cash: cash, total: cash + card)
        }
    }

    var periodLabel: String {
        if isMonthMode {
            let f = DateFormatter(); f.locale = appLocale(); f.dateFormat = "LLLL yyyy"
            return f.string(from: currentDate).capitalized
        }
        let f = DateFormatter(); f.locale = appLocale(); f.dateFormat = "LLL yyyy"
        return f.string(from: periodStart) + " – " + f.string(from: periodEnd)
    }

    #if DEBUG
    /// Синтетика для визуальной проверки PDF без бэкенда — см. load(). Даты подстраиваются
    /// под выбранный период, чтобы дни попадали в календарный график на обложке.
    private func seedDemo(start: Date, end: Date, prevStart: Date, prevEnd: Date) {
        includeCard = true; hkPrice = 15
        let cal = Calendar.current
        func iso(_ d: Date) -> String { key(d) }
        func day(_ base: Date, _ offset: Int) -> Date { cal.date(byAdding: .day, value: offset, to: base) ?? base }

        if isMonthMode {
            let daysInMonth = cal.range(of: .day, in: .month, for: start)?.count ?? 30
            let workDays = (1...daysInMonth).filter { $0 % 5 != 0 } // немного выходных
            shiftsRaw = workDays.enumerated().map { idx, d in
                let date = day(start, d - 1)
                return Shift(id: "s\(d)", date: iso(date), status: "closed",
                             income: Double(900 + (d * 137) % 700), income_card: Double(150 + (d * 53) % 250),
                             total_expense: Double(150 + (d * 71) % 300), inkassation: Double(500 + (d * 90) % 400),
                             closing_balance: Double(200 + idx * 12), opening_balance: 200)
            }
            prevShiftsRaw = (0..<20).map { i in
                Shift(id: "p\(i)", date: iso(day(prevStart, i)), status: "closed",
                      income: 1050, income_card: 220, total_expense: 260, inkassation: 620, closing_balance: 200, opening_balance: 200)
            }
        } else {
            shiftsRaw = stride(from: 0, to: 90, by: 3).map { off in
                let date = day(end, -off)
                return Shift(id: "s\(off)", date: iso(date), status: "closed",
                             income: Double(900 + (off * 61) % 700), income_card: Double(150 + (off * 37) % 250),
                             total_expense: Double(150 + (off * 41) % 300), inkassation: Double(500 + (off * 53) % 400),
                             closing_balance: 200, opening_balance: 200)
            }
            prevShiftsRaw = []
        }

        let sids = shiftsRaw.map(\.id)
        expenses = [
            ShiftExpense(id: "exp1", employee_id: nil, category_id: "c1", category_name: "Продукты", amount: 2600, note: nil, shift_id: sids.first),
            ShiftExpense(id: "exp2", employee_id: nil, category_id: "c2", category_name: "Бар", amount: 1500, note: nil, shift_id: sids.first),
            ShiftExpense(id: "exp3", employee_id: nil, category_id: "c3", category_name: "Хозтовары", amount: 480, note: nil, shift_id: sids.dropFirst().first),
            ShiftExpense(id: "exp4", employee_id: nil, category_id: "c4", category_name: "Аренда", amount: 3200, note: nil, shift_id: sids.dropFirst().first),
            ShiftExpense(id: "exp5", employee_id: nil, category_id: "c5", category_name: "Коммуналка", amount: 620, note: nil, shift_id: sids.dropFirst(2).first),
        ]
        employees = [
            .init(id: "e1", name: "Артемий", deduct_per_absence: 20, salary: 1200, card_amount: 400),
            .init(id: "e2", name: "Владимир", deduct_per_absence: 20, salary: 1100, card_amount: 0),
            .init(id: "e3", name: "Женя", deduct_per_absence: 15, salary: 950, card_amount: 300),
            .init(id: "e4", name: "Неля", deduct_per_absence: 15, salary: 900, card_amount: 200),
        ]
        absences = [
            .init(employee_id: "e3", source: "manager", date: iso(day(start, 8))),
            .init(employee_id: "e4", source: "manager", date: iso(day(start, 12))),
        ]
        hookahSales = [
            HookahSale(hookah_type_id: "h1", quantity: 62, portion_g: 20, price: 15, is_free: false, date: iso(day(start, 8)), brand: "Darkside", flavor: "Supernova"),
            HookahSale(hookah_type_id: "h2", quantity: 41, portion_g: 25, price: 22, is_free: false, date: iso(day(start, 9)), brand: "MustHave", flavor: "Pinkman"),
            HookahSale(hookah_type_id: "h1", quantity: 30, portion_g: 20, price: 15, is_free: false, date: iso(day(start, 15)), brand: "Darkside", flavor: "Lemon Pie"),
            HookahSale(hookah_type_id: "h3", quantity: 18, portion_g: 20, price: 18, is_free: false, date: iso(day(start, 20)), brand: "Element", flavor: "Ice Mint"),
            HookahSale(hookah_type_id: "h1", quantity: 6, portion_g: 20, price: 0, is_free: true, date: iso(day(start, 9)), brand: nil, flavor: "Сотрудники"),
        ]
        let names = ["Алиса Ким", "Марк Дюбуа", "Ольга Реннер", "Сэм Уокер", "Дарья Ли", "Юсуф Демир", "Ева Шмидт"]
        var bookings: [Booking] = []
        for (i, name) in names.enumerated() {
            let visits = 1 + (i % 4)
            for v in 0..<visits {
                let offset = -(i * 23 + v * 41)
                bookings.append(Booking(id: "b\(i)-\(v)", booking_date: iso(day(end, offset)), booking_time: "20:00",
                                         guest_name: name, guests_count: 2 + (i + v) % 3, phone: "+4179\(1000000 + i)",
                                         table_label: "T\(i + 1)", note: nil, status: "confirmed", created_by: nil, created_by_name: nil))
            }
        }
        bookings12mo = bookings
        loading = false
    }
    #endif

    // MARK: - PDF

    /// Снапшот для рендера PDF вне main thread: все локализованные строки и суммы
    /// (t() и Money.s — @MainActor) считаются здесь, на MainActor; рендер получает
    /// только готовые значения. Поля неизменяемые → @unchecked Sendable безопасен.
    struct PDFSnapshot: @unchecked Sendable {
        struct Table { let cols: [(String, CGFloat)]; let rows: [[String]]; let totals: [String]? }
        let venueName, reportTitle, generatedLine, periodLabel: String
        let byDayLabel, incomeLabel, expenseLabel, noData: String
        let secCash, secSales, secStaff: String
        let topFlavorsLabel, freePortionsLine, topGuestsTitle, staffTitle, expenseByCatLabel: String
        let kpi: [(label: String, value: String, color: UIColor, delta: Double?)]
        let chartBuckets: [(label: String, income: Double, expense: Double)]
        let miniStats: [(String, String)]
        let cashTable: Table
        let flavorBars: [(name: String, value: Double, formatted: String)]
        let guestsTable: Table
        let staffTable: Table
        let expenseBars: [(name: String, value: Double, formatted: String)]
    }

    func pdfSnapshot(venueName: String) -> PDFSnapshot {
        let genDf = DateFormatter(); genDf.dateFormat = "dd.MM.yyyy"; genDf.locale = appLocale()
        let incomeDelta: Double? = isMonthMode && prevIncome > 0 ? (totalIncome - prevIncome) / prevIncome * 100 : nil
        let expenseDelta: Double? = isMonthMode && prevExpense > 0 ? (totalExpense - prevExpense) / prevExpense * 100 : nil
        let green = UIColor(red: 0.20, green: 0.72, blue: 0.38, alpha: 1)
        let red = UIColor(red: 0.92, green: 0.26, blue: 0.24, alpha: 1)
        let brand = UIColor(red: 0.32, green: 0.33, blue: 0.88, alpha: 1)

        let cashTable: PDFSnapshot.Table
        if isMonthMode {
            cashTable = .init(
                cols: [(t("an.csvDate"), 95), (t("an.csvOpening"), 80), (t("an.csvIncome"), 80),
                       (t("an.csvExpense"), 80), (t("an.csvInkass"), 80), (t("an.csvClosing"), 100)],
                rows: filledShiftsDisplay.map {
                    [$0.date, Money.s($0.opening_balance ?? 0), Money.s($0.income ?? 0), Money.s($0.total_expense ?? 0), Money.s($0.inkassation ?? 0), Money.s($0.closing_balance ?? 0)]
                },
                totals: [t("an.csvTotal"), "", Money.s(totalIncome), Money.s(totalExpense), Money.s(totalInkass), ""])
        } else {
            cashTable = .init(
                cols: [(t("rp.periodMonth"), 155), (t("an.csvIncome"), 120), (t("an.csvExpense"), 120), (t("an.csvInkass"), 120)],
                rows: monthlyAgg.map { [$0.label, Money.s($0.income), Money.s($0.expense), Money.s($0.inkass)] },
                totals: [t("an.csvTotal"), Money.s(totalIncome), Money.s(totalExpense), Money.s(totalInkass)])
        }

        let staffTitle: String
        let staffTable: PDFSnapshot.Table
        if isMonthMode {
            staffTitle = t("rp.payroll")
            staffTable = .init(
                cols: [(t("rp.colEmployee"), 110), (t("rp.colSalary"), 65), (t("rp.colAbsences"), 55),
                       (t("rp.colDeduct"), 65), (t("pe.cardShort").capitalized, 55), (t("rp.colCash"), 75), (t("an.csvTotal"), 90)],
                rows: payroll.map { [$0.name, Money.s($0.salary), "\($0.absN)", Money.s($0.deduct), Money.s($0.card), Money.s($0.cash), Money.s($0.total)] },
                totals: [
                    t("an.csvTotal"), Money.s(payroll.reduce(0) { $0 + $1.salary }), "",
                    Money.s(payroll.reduce(0) { $0 + $1.deduct }), Money.s(payroll.reduce(0) { $0 + $1.card }),
                    Money.s(payroll.reduce(0) { $0 + $1.cash }), Money.s(payroll.reduce(0) { $0 + $1.total }),
                ])
        } else {
            staffTitle = t("rp.colAbsences")
            staffTable = .init(
                cols: [(t("rp.colEmployee"), 300), (t("rp.colAbsences"), 100), (t("rp.colDeduct"), 115)],
                rows: employees.map { emp -> [String] in
                    let n = absences.filter { $0.employee_id == emp.id }.count
                    return [emp.name, "\(n)", Money.s(Double(n) * (emp.deduct_per_absence ?? 0))]
                },
                totals: nil)
        }

        return PDFSnapshot(
            venueName: venueName,
            reportTitle: t("rp.title"),
            generatedLine: t("an.pdfGenerated") + " " + genDf.string(from: Date()),
            periodLabel: periodLabel,
            byDayLabel: t("an.byDay"), incomeLabel: t("an.income"), expenseLabel: t("an.expense"), noData: t("rp.noData"),
            secCash: t("rp.secCash"), secSales: t("rp.secSales"), secStaff: t("rp.secStaff"),
            topFlavorsLabel: t("rp.topFlavors"),
            freePortionsLine: t("rp.freePortions") + ": \(Int(freePortions.rounded()))",
            topGuestsTitle: t("rp.topGuests") + " (\(t("rp.last12mo")))",
            staffTitle: staffTitle,
            expenseByCatLabel: t("rp.expenseByCat"),
            kpi: [
                (t("an.income"), Money.s(totalIncome), green, incomeDelta),
                (t("an.expense"), Money.s(totalExpense), red, expenseDelta),
                (t("rp.netProfit"), Money.s(netProfit), netProfit >= 0 ? green : red, nil),
                (t("an.avgPerDay"), Money.s(avgPerDay.rounded()), brand, nil),
            ],
            chartBuckets: isMonthMode
                ? calendarDays.map { ($0.label, $0.income, $0.expense) }
                : monthlyAgg.map { ($0.label, $0.income, $0.expense) },
            miniStats: [
                (t("mg.inkass"), Money.s(totalInkass)),
                (t("rp.filledShifts"), "\(filledShifts.count)"),
                (t("rp.topGuests"), "\(topGuests.count)"),
            ],
            cashTable: cashTable,
            flavorBars: Array(topFlavors.prefix(8)).map { (name: $0.name, value: $0.revenue, formatted: Money.s($0.revenue)) },
            guestsTable: .init(
                cols: [(t("rp.colGuest"), 235), (t("rp.colVisits"), 90), (t("rp.colLast"), 190)],
                rows: topGuests.map { [$0.displayName, "\($0.visitCount)", $0.lastVisitDate ?? "—"] },
                totals: nil),
            staffTable: staffTable,
            expenseBars: Array(catTotals.prefix(8)).map { (name: $0.0, value: $0.1, formatted: Money.s($0.1)) })
    }

    /// Многостраничный отчёт: обложка-хиро с брендовым градиентом + KPI + тренд
    /// по всем дням месяца, затем непрерывный поток разделов (касса, продажи,
    /// гости, персонал, расходы) — разрыв страницы только когда блок реально
    /// не помещается, а не «раздел = страница». Палитра нарочно сдержанная:
    /// один брендовый акцент + зелёный/красный только для дохода/расхода —
    /// без «светофора» из цвета на каждый раздел.
    ///
    /// nonisolated + снапшот: генерация страниц тяжёлая, на main она замораживала UI
    /// (аудит-находка 19) — вызывается из Task.detached, все данные приходят готовыми.
    nonisolated static func renderPDF(_ s: PDFSnapshot) -> Data {
        let pageW: CGFloat = 595, pageH: CGFloat = 842, margin: CGFloat = 40
        let ink = UIColor(red: 0.11, green: 0.11, blue: 0.13, alpha: 1)
        let green = UIColor(red: 0.20, green: 0.72, blue: 0.38, alpha: 1)
        let red = UIColor(red: 0.92, green: 0.26, blue: 0.24, alpha: 1)
        let brand = UIColor(red: 0.32, green: 0.33, blue: 0.88, alpha: 1)
        let tableW = pageW - margin * 2

        let renderer = UIGraphicsPDFRenderer(bounds: CGRect(x: 0, y: 0, width: pageW, height: pageH))
        // UIGraphicsPDFRenderer не привязан к окну — без явного оверрайда
        // семантические цвета (.label, .systemGray6...) резолвятся по текущему
        // UITraitCollection.current, который наследует тёмную тему приложения
        // (Localization.applyThemeToWindows → overrideUserInterfaceStyle). Без
        // этой обёртки в тёмной теме PDF выходит нечитаемым (почти чёрные карточки,
        // невидимые подписи на белом фоне страницы). performAsCurrent мостится из
        // ObjC как Void-closure, поэтому результат забираем через внешнюю переменную.
        var pdf = Data()
        UITraitCollection(userInterfaceStyle: .light).performAsCurrent {
        pdf = renderer.pdfData { ctx in
            var y: CGFloat = 0

            func text(_ s: String, _ x: CGFloat, _ yy: CGFloat, size: CGFloat,
                      weight: UIFont.Weight = .regular, color: UIColor = .label,
                      width: CGFloat? = nil, align: NSTextAlignment = .left, mono: Bool = false) {
                let p = NSMutableParagraphStyle(); p.alignment = align; p.lineBreakMode = .byTruncatingTail
                let font = mono ? UIFont.monospacedDigitSystemFont(ofSize: size, weight: weight) : UIFont.systemFont(ofSize: size, weight: weight)
                let attrs: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: color, .paragraphStyle: p]
                (s as NSString).draw(in: CGRect(x: x, y: yy, width: width ?? (pageW - x - margin), height: size + 10), withAttributes: attrs)
            }
            func hline(_ yy: CGFloat, color: UIColor = .systemGray5, w: CGFloat = 0.5) {
                color.setStroke()
                let p = UIBezierPath(); p.move(to: CGPoint(x: margin, y: yy)); p.addLine(to: CGPoint(x: margin + tableW, y: yy))
                p.lineWidth = w; p.stroke()
            }

            // Универсальная таблица: закрашенная цветом раздела шапка + белый текст,
            // зебра-строки, опциональный итог; переносит шапку на новую страницу.
            func drawTable(cols: [(String, CGFloat)], rows: [[String]], totals: [String]? = nil, accent: UIColor) {
                var colX: [CGFloat] = []; var xx = margin
                for c in cols { colX.append(xx); xx += c.1 }
                let w = cols.reduce(0) { $0 + $1.1 }
                let headerH: CGFloat = 24, rowH: CGFloat = 22

                func drawHeader() {
                    accent.setFill()
                    UIBezierPath(roundedRect: CGRect(x: margin, y: y, width: w, height: headerH),
                                 byRoundingCorners: [.topLeft, .topRight], cornerRadii: CGSize(width: 6, height: 6)).fill()
                    for (i, c) in cols.enumerated() {
                        let align: NSTextAlignment = i == 0 ? .left : .right
                        // Ширина рамки = вся колонка (минус паддинг) — параграф сам
                        // прижмёт текст к нужному краю. Раньше x для .right считался от
                        // правого края колонки, и рамка уезжала на length(колонки) вправо,
                        // утаскивая крайние колонки (Итого, Последний визит) за край листа.
                        text(c.0, colX[i] + 8, y + 7, size: 8.5, weight: .bold, color: .white, width: c.1 - 14, align: align)
                    }
                    y += headerH
                }
                func drawRow(_ cells: [String], bg: UIColor?, bold: Bool = false) {
                    if y + rowH > pageH - margin { ctx.beginPage(); y = margin; drawHeader() }
                    if let bg { bg.setFill(); UIRectFill(CGRect(x: margin, y: y, width: w, height: rowH)) }
                    for (i, c) in cells.enumerated() {
                        let align: NSTextAlignment = i == 0 ? .left : .right
                        text(c, colX[i] + 8, y + 6, size: 9.5, weight: bold ? .bold : .regular, color: .label, width: cols[i].1 - 14, align: align, mono: i > 0)
                    }
                    hline(y + rowH, color: .systemGray6, w: 0.4)
                    y += rowH
                }
                drawHeader()
                for (i, r) in rows.enumerated() { drawRow(r, bg: i % 2 == 1 ? .systemGray6 : nil) }
                if let totals { drawRow(totals, bg: .systemGray5, bold: true) }
                y += 16
            }

            // Горизонтальные бары — разбивка расходов/вкусов по значению.
            // `formatted` считается ДО вызова (Money.s — @MainActor, а эта вложенная
            // func внутри pdfData-замыкания таким изолированным контекстом не является).
            func drawHBars(_ items: [(name: String, value: Double, formatted: String)], color: UIColor) {
                guard let maxV = items.map(\.value).max(), maxV > 0 else { return }
                let labelW: CGFloat = 150, valueW: CGFloat = 70
                let barAreaW = tableW - labelW - valueW
                let rowH: CGFloat = 20
                for item in items {
                    if y + rowH > pageH - margin { ctx.beginPage(); y = margin }
                    text(item.name, margin, y + 4, size: 9.5, color: .label, width: labelW - 8, align: .left)
                    color.withAlphaComponent(0.14).setFill()
                    UIBezierPath(roundedRect: CGRect(x: margin + labelW, y: y + 3, width: barAreaW, height: rowH - 8), cornerRadius: 3).fill()
                    let bw = max(barAreaW * CGFloat(item.value / maxV), 3)
                    color.setFill()
                    UIBezierPath(roundedRect: CGRect(x: margin + labelW, y: y + 3, width: bw, height: rowH - 8), cornerRadius: 3).fill()
                    text(item.formatted, margin + labelW + barAreaW + 8, y + 4, size: 9, weight: .semibold, color: .label, width: valueW - 8, align: .right, mono: true)
                    y += rowH
                }
                y += 12
            }

            // Сгруппированные столбики доход/расход — по дням (месяц) или по месяцам (весь период).
            func drawFlowChart(_ buckets: [(label: String, income: Double, expense: Double)], h: CGFloat = 110) {
                guard buckets.count > 1 else { return }
                let bottom = y + h
                let maxV = max((buckets.map { max($0.income, $0.expense) }.max() ?? 1) * 1.15, 1)
                for frac: CGFloat in [0, 0.5, 1.0] { hline(bottom - h * frac) }
                let n = buckets.count
                let slotW = tableW / CGFloat(n)
                let gap = max((slotW - 2) / 5, 0.5)
                let barW = max((slotW - gap * 3) / 2, 0.8)
                let step = max(n / 10, 1)
                for (i, b) in buckets.enumerated() {
                    let x0 = margin + CGFloat(i) * slotW
                    let ih = h * CGFloat(min(b.income / maxV, 1))
                    let eh = h * CGFloat(min(b.expense / maxV, 1))
                    green.setFill(); UIBezierPath(roundedRect: CGRect(x: x0 + gap, y: bottom - ih, width: barW, height: max(ih, 0.5)), cornerRadius: 0.8).fill()
                    red.setFill(); UIBezierPath(roundedRect: CGRect(x: x0 + gap * 2 + barW, y: bottom - eh, width: barW, height: max(eh, 0.5)), cornerRadius: 0.8).fill()
                    if i % step == 0 || i == n - 1 {
                        text(b.label, x0, bottom + 4, size: 6.5, color: .tertiaryLabel, width: slotW, align: .center)
                    }
                }
                y = bottom + 20
            }

            func kpiCards(_ cards: [(label: String, value: String, color: UIColor, delta: Double?)]) {
                let gap: CGFloat = 10
                let cardW = (tableW - gap * CGFloat(cards.count - 1)) / CGFloat(cards.count)
                let cardH: CGFloat = 64
                for (i, c) in cards.enumerated() {
                    let cx = margin + CGFloat(i) * (cardW + gap)
                    let rect = CGRect(x: cx, y: y, width: cardW, height: cardH)
                    UIColor.systemGray6.setFill(); UIBezierPath(roundedRect: rect, cornerRadius: 10).fill()
                    c.color.setFill()
                    UIBezierPath(roundedRect: CGRect(x: cx, y: y, width: 4, height: cardH),
                                 byRoundingCorners: [.topLeft, .bottomLeft], cornerRadii: CGSize(width: 10, height: 10)).fill()
                    text(c.label.uppercased(), cx + 12, y + 9, size: 7.5, weight: .semibold, color: .secondaryLabel, width: cardW - 22)
                    text(c.value, cx + 12, y + 25, size: 14.5, weight: .bold, color: c.color, width: cardW - 22, mono: true)
                    if let d = c.delta {
                        let up = d >= 0
                        let dColor: UIColor = up ? green : red
                        text("\(up ? "▲" : "▼") \(String(format: "%.0f", abs(d)))%", cx + 12, y + 46, size: 7.5, weight: .medium, color: dColor, width: cardW - 22)
                    }
                }
                y += cardH + 24
            }

            // Разрывает страницу, только если следующему блоку правда не хватает места —
            // разделы текут друг за другом, а не «один раздел = отдельная страница».
            func ensureSpace(_ needed: CGFloat) {
                if y + needed > pageH - margin { ctx.beginPage(); y = margin }
            }
            // Единый минималистичный заголовок раздела: акцентная риска + тёмный текст.
            // Одного и того же брендового цвета на всех страницах — не «светофор».
            func sectionHeader(_ title: String) {
                ensureSpace(44)
                brand.setFill()
                UIBezierPath(roundedRect: CGRect(x: margin, y: y + 3, width: 3, height: 15), cornerRadius: 1.5).fill()
                text(title, margin + 11, y, size: 14, weight: .bold, color: ink)
                y += 28
            }

            // ── Обложка: hero + KPI + тренд по всем дням месяца ──────────────
            ctx.beginPage()
            let heroH: CGFloat = 110
            let cg = ctx.cgContext
            let heroColors = [
                UIColor(red: 0.10, green: 0.12, blue: 0.30, alpha: 1),
                brand,
            ].map(\.cgColor) as CFArray
            if let gradient = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: heroColors, locations: nil) {
                cg.saveGState()
                cg.clip(to: CGRect(x: 0, y: 0, width: pageW, height: heroH))
                cg.drawLinearGradient(gradient, start: .zero, end: CGPoint(x: pageW, y: 0), options: [])
                cg.restoreGState()
            }
            text("mise", margin, 22, size: 23, weight: .heavy, color: .white)
            text(s.reportTitle, margin, 52, size: 19, weight: .bold, color: .white)
            text(s.venueName, margin, 78, size: 12, weight: .medium, color: UIColor.white.withAlphaComponent(0.85))
            text(s.generatedLine, pageW - margin, 22, size: 9.5, color: UIColor.white.withAlphaComponent(0.75), width: 220, align: .right)
            text(s.periodLabel, pageW - margin, 76, size: 13, weight: .semibold, color: .white, width: 220, align: .right)
            y = heroH + 24

            kpiCards(s.kpi)

            text(s.byDayLabel, margin, y, size: 11, weight: .semibold, color: ink)
            let legendX = margin + tableW - 150
            green.setFill(); UIRectFill(CGRect(x: legendX, y: y + 2, width: 7, height: 7))
            text(s.incomeLabel, legendX + 11, y, size: 8.5, color: .secondaryLabel)
            red.setFill(); UIRectFill(CGRect(x: legendX + 75, y: y + 2, width: 7, height: 7))
            text(s.expenseLabel, legendX + 86, y, size: 8.5, color: .secondaryLabel)
            y += 18
            // Полная календарная ось (все дни месяца, не только заполненные смены) —
            // иначе 2-3 смены в месяце дают пару баров на пустой странице.
            drawFlowChart(s.chartBuckets, h: 160)

            // Компактная строка доп. показателей — занимает нижнюю часть обложки
            // содержательно, а не пустым полем.
            let miniW = tableW / CGFloat(s.miniStats.count)
            hline(y)
            y += 12
            for (i, m) in s.miniStats.enumerated() {
                let sx = margin + CGFloat(i) * miniW
                text(m.0.uppercased(), sx, y, size: 7.5, weight: .semibold, color: .secondaryLabel, width: miniW - 10)
                text(m.1, sx, y + 12, size: 13, weight: .bold, color: ink, width: miniW - 10, mono: true)
            }
            y += 40

            // ── Разделы одним потоком: разрыв страницы только по нехватке места ──
            ctx.beginPage(); y = margin

            sectionHeader(s.secCash)
            if s.cashTable.rows.isEmpty { text(s.noData, margin, y + 6, size: 12, color: .secondaryLabel); y += 30 }
            else { drawTable(cols: s.cashTable.cols, rows: s.cashTable.rows, totals: s.cashTable.totals, accent: brand) }

            sectionHeader(s.secSales)
            text(s.topFlavorsLabel, margin, y, size: 10.5, weight: .semibold, color: .secondaryLabel)
            text(s.freePortionsLine, margin + tableW - 170, y, size: 9, color: .secondaryLabel, width: 170, align: .right)
            y += 16
            if s.flavorBars.isEmpty { text(s.noData, margin, y, size: 11, color: .secondaryLabel); y += 24 }
            else { drawHBars(s.flavorBars, color: brand) }

            text(s.topGuestsTitle, margin, y, size: 10.5, weight: .semibold, color: .secondaryLabel)
            y += 16
            if s.guestsTable.rows.isEmpty {
                text(s.noData, margin, y, size: 11, color: .secondaryLabel); y += 24
            } else {
                drawTable(cols: s.guestsTable.cols, rows: s.guestsTable.rows, accent: brand)
            }

            sectionHeader(s.secStaff)
            text(s.staffTitle, margin, y, size: 10.5, weight: .semibold, color: .secondaryLabel); y += 16
            if s.staffTable.rows.isEmpty { text(s.noData, margin, y, size: 11, color: .secondaryLabel); y += 24 }
            else { drawTable(cols: s.staffTable.cols, rows: s.staffTable.rows, totals: s.staffTable.totals, accent: brand) }

            text(s.expenseByCatLabel, margin, y, size: 10.5, weight: .semibold, color: .secondaryLabel)
            y += 16
            if s.expenseBars.isEmpty { text(s.noData, margin, y, size: 11, color: .secondaryLabel) }
            else { drawHBars(s.expenseBars, color: red) }
        }
        }
        return pdf
    }
}

// MARK: - Экран экспорта

private struct ReportShareSheet: UIViewControllerRepresentable {
    let activityItems: [Any]
    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: activityItems, applicationActivities: nil)
    }
    func updateUIViewController(_ vc: UIActivityViewController, context: Context) {}
}
private struct ReportSharePayload: Identifiable { let id = UUID(); let url: URL }

struct ReportExportView: View {
    @Environment(AppModel.self) private var app
    @State private var periodMode = "month"
    @State private var currentDate = Date()
    @State private var generating = false
    @State private var payload: ReportSharePayload?
    @State private var failed = false

    private var monthLabelStr: String {
        let f = DateFormatter(); f.locale = appLocale(); f.dateFormat = "LLLL yyyy"
        return f.string(from: currentDate).capitalized
    }
    private func changeMonth(_ d: Int) {
        currentDate = Calendar.current.date(byAdding: .month, value: d, to: currentDate) ?? currentDate
    }

    private func generate() {
        guard !generating else { return }
        generating = true
        Task {
            let m = ReportModel(rid: app.restaurant?.id ?? "")
            m.periodMode = periodMode
            m.currentDate = currentDate
            await m.load()
            // Рендер вне main: страницы рисуются долго, на main это замораживало UI.
            let snap = m.pdfSnapshot(venueName: app.restaurant?.name ?? "")
            let data = await Task.detached(priority: .userInitiated) { ReportModel.renderPDF(snap) }.value
            let url = FileManager.default.temporaryDirectory.appendingPathComponent("mise-report-\(Int(Date().timeIntervalSince1970)).pdf")
            if (try? data.write(to: url)) != nil {
                // Как в ExportMenuButton: даём Task осесть, иначе share-лист не откроется.
                try? await Task.sleep(nanoseconds: 300_000_000)
                payload = ReportSharePayload(url: url)
            } else {
                failed = true
            }
            generating = false
        }
    }

    var body: some View {
        ZStack {
            Color.miseBg.ignoresSafeArea()
            List {
                Section(t("rp.period")) {
                    Picker(t("rp.period"), selection: $periodMode) {
                        Text(t("rp.periodMonth")).tag("month")
                        Text(t("rp.periodAll")).tag("all")
                    }
                    .pickerStyle(.segmented)
                    .listRowInsets(EdgeInsets(top: 10, leading: 16, bottom: 10, trailing: 16))

                    if periodMode == "month" {
                        HStack {
                            Button { changeMonth(-1) } label: { Image(systemName: "chevron.left") }
                            Spacer()
                            Text(monthLabelStr).font(.system(size: 15, weight: .semibold))
                            Spacer()
                            Button { changeMonth(1) } label: { Image(systemName: "chevron.right") }
                                .disabled(Calendar.current.isDate(currentDate, equalTo: Date(), toGranularity: .month))
                        }
                        .foregroundStyle(BrandKit.analytics)
                    }
                }
                Section(t("rp.includes")) {
                    Label(t("rp.secOverview"), systemImage: "chart.line.uptrend.xyaxis").foregroundStyle(.primary)
                    Label(t("rp.secCash"), systemImage: "banknote").foregroundStyle(.primary)
                    Label(t("rp.secSales"), systemImage: "flame").foregroundStyle(.primary)
                    Label(t("rp.secStaff"), systemImage: "person.2").foregroundStyle(.primary)
                }
                Section {
                    Button { generate() } label: {
                        HStack {
                            Spacer()
                            if generating { ProgressView().tint(.white) }
                            else { Label(t("rp.generate"), systemImage: "square.and.arrow.up") }
                            Spacer()
                        }
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(.white)
                        .padding(.vertical, 4)
                    }
                    .listRowBackground(BrandKit.analytics)
                    .disabled(generating)
                }
            }
            .scrollContentBackground(.hidden)
        }
        .navigationTitle(t("rp.title")).navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(Color.miseBg, for: .navigationBar)
        .sheet(item: $payload) { p in ReportShareSheet(activityItems: [p.url]) }
        .alert(t("an.exportFailed"), isPresented: $failed) { Button(t("done")) {} }
    }
}
