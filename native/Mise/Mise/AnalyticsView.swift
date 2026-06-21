import SwiftUI
import Charts

private func cur(_ v: Double) -> String { Money.s(v) }
private func kg(_ g: Double) -> String {
    if g >= 1000 {
        let f = NumberFormatter(); f.numberStyle = .decimal; f.maximumFractionDigits = 1
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
    var currentDate = Date()

    var includeCard = false
    var hkPrice = 0.0
    var hkPortion = 20.0
    var revGoal = 0.0
    var kassaMode = "kassa"
    var periodMode = "month" // day | week | month
    var cumulativeInkass = 0.0 // инкассация накопительно (до конца выбранного месяца)

    var shiftsRaw: [Shift] = []
    var prevShiftsRaw: [Shift] = []
    var expenses: [ShiftExpense] = []
    var employees: [Employee] = []
    var cardAmounts: [CardAmount] = []
    var absences: [Absence] = []

    var inkDetails: [String: Inkassation] = [:]

    func handleAI(_ message: String) async -> String? {
        let ctx = """
            Period: \(navLabel).
            Revenue: \(Money.s(totalIncome)), expenses: \(Money.s(totalExpense)).
            Shifts: \(shiftsRaw.count). Cash collections (inkassations): \(shiftsWithInk.count) times, gross \(Money.s(totalInkass)), net \(Money.s(totalInkassNet)).
            Payroll fund: \(Money.s(payrollTotal)), employees: \(employees.count).
            Hookah: \(qtyMonth) paid + \(qtyFree) free, revenue \(Money.s(revMonth)).
            """
        do {
            let result = try await API.aiChat(module: "analytics", message: message, context: ctx)
            return result["reply"] as? String ?? t("ai.noReply")
        } catch let err as APIError {
            switch err {
            case .http(401, _): return t("ai.err401")
            case .http(403, _): return t("ai.err403")
            case .http(500, _): return t("ai.err500")
            case .http(502, _): return t("ai.err502")
            default: return "\(t("ai.errGeneric")): \(err.localizedDescription)"
            }
        } catch {
            return "\(t("ai.errGeneric")): \(error.localizedDescription)"
        }
    }

    var hookahRows: [HookahSale] = []
    var allHookah: [HookahSale] = []
    var stockRows: [StockItem] = []
    var issuedG = 0.0
    var stockG = 0.0
    var types: [HookahType] = []

    init(rid: String) { self.rid = rid }

    private let df: DateFormatter = {
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.locale = Locale(identifier: "en_US_POSIX"); return f
    }()
    func key(_ d: Date) -> String { df.string(from: d) }

    func load() async {
        #if DEBUG
        if ProcessInfo.processInfo.environment["MISE_DEMO_UI"] == "1" { seedDemo(); return }
        #endif
        loading = true; defer { loading = false }
        let cal = Calendar.current
        let monthStart = cal.date(from: cal.dateComponents([.year, .month], from: currentDate))!
        let monthEnd = cal.date(byAdding: DateComponents(month: 1, day: -1), to: monthStart)!
        let prevStart = cal.date(byAdding: .month, value: -1, to: monthStart)!
        let prevEnd = cal.date(byAdding: .day, value: -1, to: monthStart)!
        let ym = String(key(currentDate).prefix(7))

        if let s = try? await DB.from("restaurant_settings").select().limit(1).list(AnalyticsSettings.self).first {
            includeCard = s.include_card_in_analytics ?? false
            hkPrice = s.hookah_price ?? 0
            hkPortion = s.hookah_portion_g ?? 20
            revGoal = s.monthly_revenue_goal ?? 0
        }

        // Грузим в optional и присваиваем в state ТОЛЬКО при успехе: при сетевом сбое
        // (напр. pull-to-refresh без связи) прошлые данные сохраняются, а не обнуляются.
        async let sh = try? DB.from("shifts").select().gte("date", key(monthStart)).lte("date", key(monthEnd)).order("date").list(Shift.self)
        async let prev = try? DB.from("shifts").select().gte("date", key(prevStart)).lte("date", key(prevEnd)).order("date").list(Shift.self)
        async let emps = try? DB.from("employees").select().eq("is_active", true).order("name").list(Employee.self)
        async let cards = try? DB.from("monthly_card_amounts").select("id, employee_id, card_amount").eq("month", ym).list(CardAmount.self)
        async let abs = try? DB.from("shift_absences").select().gte("date", key(monthStart)).lte("date", key(monthEnd)).list(Absence.self)
        async let hk = try? DB.from("hookah_sales").select().gte("date", key(monthStart)).lte("date", key(monthEnd)).order("date").list(HookahSale.self)

        shiftsRaw = (await sh) ?? shiftsRaw
        prevShiftsRaw = (await prev) ?? prevShiftsRaw
        employees = (await emps) ?? employees
        cardAmounts = (await cards) ?? cardAmounts
        if let a = await abs { absences = a.filter { $0.source != "auto" } }
        hookahRows = (await hk) ?? hookahRows

        let ids = shiftsRaw.map(\.id)
        if !ids.isEmpty {
            if let e = try? await DB.from("shift_expenses").select().in("shift_id", ids).list(ShiftExpense.self) { expenses = e }
            if let inks = try? await DB.from("inkassations").select("shift_id, amount, expense, reason, total").in("shift_id", ids).list(Inkassation.self) {
                var d: [String: Inkassation] = [:]
                for ink in inks { if let sid = ink.shift_id { d[sid] = ink } }
                inkDetails = d
            }
        } else { expenses = []; inkDetails = [:] }

        // Инкассация копится: сумма нетто (total) из inkassations до конца выбранного месяца.
        nonisolated struct InkNetOnly: Codable, Sendable { let total: Double? }
        if let inkRows = try? await DB.from("inkassations").select("total").lte("date", key(monthEnd)).list(InkNetOnly.self) {
            cumulativeInkass = inkRows.reduce(0) { $0 + ($1.total ?? 0) }
        }

        // кальян all-time + склад
        async let allHk = try? DB.from("hookah_sales").select("quantity, portion_g").list(HookahSale.self)
        async let stock = try? DB.from("tobacco_stock").select("id, brand, flavor, quantity_g, min_quantity_g").list(StockItem.self)
        async let movs = try? DB.from("tobacco_movements").select().list(Movement.self)
        async let tps = try? DB.from("hookah_types").select("id, name").list(HookahType.self)
        allHookah = (await allHk) ?? allHookah
        stockRows = (await stock) ?? stockRows
        if let mv = await movs { issuedG = mv.filter { $0.type == "out" }.reduce(0) { $0 + $1.quantity_g } }
        stockG = stockRows.reduce(0) { $0 + $1.quantity_g }
        types = (await tps) ?? types
    }

    func changeMonth(_ d: Int) async {
        currentDate = Calendar.current.date(byAdding: .month, value: d, to: currentDate)!
        await load()
    }

    /// Шаг навигации зависит от вкладки и режима Периода: день/неделя/месяц.
    private var navUnitIsDay: Bool { tab == "period" && periodMode == "day" }
    private var navUnitIsWeek: Bool { tab == "period" && periodMode == "week" }
    func navigate(_ dir: Int) async {
        let cal = Calendar.current
        if navUnitIsDay { currentDate = cal.date(byAdding: .day, value: dir, to: currentDate)! }
        else if navUnitIsWeek { currentDate = cal.date(byAdding: .day, value: dir * 7, to: currentDate)! }
        else { currentDate = cal.date(byAdding: .month, value: dir, to: currentDate)! }
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
            // только расходы смен выбранного периода (день/неделя/месяц).
            // Экстры сотрудников (employee_id != nil) тоже учитываем — у них
            // category_name = "Имя (экстра)", т.е. показываются именованной строкой.
            if let sid = e.shift_id, !ids.contains(sid) { continue }
            m[e.category_name ?? "—", default: 0] += e.amount ?? 0
        }
        return m.sorted { $0.value > $1.value }
    }

    // касса
    var filledShifts: [Shift] { shifts.filter { ($0.income ?? 0) > 0 || ($0.total_expense ?? 0) > 0 } }
    var shiftsWithInk: [Shift] { shifts.filter { ($0.inkassation ?? 0) > 0 } }

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
    var goalPct: Double { revGoal > 0 ? min(100, totalIncome / revGoal * 100) : 0 }
    var daysLeft: Int { max(0, daysInMonth - daysPassed) }
    var needPerDay: Double { (revGoal > totalIncome && daysLeft > 0) ? (revGoal - totalIncome) / Double(daysLeft) : 0 }
    var onTrack: Bool { revGoal > 0 && projected >= revGoal }

    func saveGoal(_ v: Double) async {
        guard v != revGoal else { return }
        revGoal = v
        try? await DB.from("restaurant_settings").update(["monthly_revenue_goal": v]).eq("restaurant_id", rid).run()
    }

    // Период: срез смен по режиму относительно ВЫБРАННОЙ даты (currentDate).
    private var allLoaded: [Shift] { adj(shiftsRaw + prevShiftsRaw) }
    var weekRange: (Date, Date) {
        let cal = Calendar.current
        let wd = cal.component(.weekday, from: currentDate)
        let monday = cal.date(byAdding: .day, value: -((wd + 5) % 7), to: currentDate)!
        return (monday, cal.date(byAdding: .day, value: 6, to: monday)!)
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

    struct DailyIncome: Identifiable { let id = UUID(); let day: Int; let income: Double }
    var dailyIncome: [DailyIncome] {
        periodShifts.compactMap { s in
            guard let d = Int(s.date.suffix(2)) else { return nil }
            return DailyIncome(day: d, income: s.income ?? 0)
        }
    }

    // зарплата: сумма на карту — строго помесячная (своя на каждый месяц, 0 если не вбита)
    var ymKey: String { String(key(currentDate).prefix(7)) }
    func cardOf(_ e: Employee) -> Double {
        cardAmounts.first(where: { $0.employee_id == e.id })?.card_amount ?? 0
    }
    struct SalaryRow: Identifiable { let id: String; let name: String; let salary: Double; let abs: Int; let deduct: Double; let card: Double; let cash: Double; let total: Double }
    var salaryRows: [SalaryRow] {
        employees.map { e in
            let absN = absences.filter { $0.employee_id == e.id }.count
            let deduct = Double(absN) * (e.deduct_per_absence ?? 0)
            let card = cardOf(e)
            let cash = (e.salary ?? 0) - deduct - card
            return SalaryRow(id: e.id, name: e.name, salary: e.salary ?? 0, abs: absN, deduct: deduct, card: card, cash: cash, total: cash + card)
        }
    }
    var payrollTotal: Double { employees.reduce(0) { $0 + ($1.salary ?? 0) } }
    var salTotal: Double { salaryRows.reduce(0) { $0 + $1.total } }
    var salCard: Double { salaryRows.reduce(0) { $0 + $1.card } }
    var salCash: Double { salaryRows.reduce(0) { $0 + $1.cash } }
    /// Сохранить сумму «на карту» за выбранный месяц.
    func saveMonthlyCard(_ empId: String, _ amount: Double) async {
        if let ex = cardAmounts.first(where: { $0.employee_id == empId }), let cid = ex.id {
            try? await DB.from("monthly_card_amounts").update(["card_amount": amount]).eq("id", cid).run()
        } else {
            try? await DB.from("monthly_card_amounts").insert([
                "restaurant_id": rid, "employee_id": empId, "month": ymKey, "card_amount": amount,
            ]).run()
        }
        // локально отразить, чтобы пересчитались строки
        var arr = cardAmounts.filter { $0.employee_id != empId }
        arr.append(CardAmount(id: cardAmounts.first { $0.employee_id == empId }?.id, employee_id: empId, card_amount: amount))
        cardAmounts = arr
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

    var venueStockG: Double { stockG }                                  // на складе
    var venueAtPlaceG: Double { issuedG - allHookah.reduce(0) { $0 + rowG($1) } } // в заведении: выдано − продано (может быть минус)

    struct TypeLine: Identifiable { let id: String; let name: String; let paid: Int; let free: Int; let grams: Double; let revenue: Double }
    struct DayHookah: Identifiable { let id: String; let date: String; let qty: Int; let free: Int; let revenue: Double; let types: [TypeLine] }
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
            return DayHookah(id: date, date: date, qty: qty, free: free, revenue: rev, types: tList)
        }
        .sorted { $0.date > $1.date }
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
            .init(employee_id: nil, category_id: "c1", category_name: "Продукты", amount: 3200, note: nil, shift_id: "s1"),
            .init(employee_id: nil, category_id: "c2", category_name: "Бар", amount: 1800, note: nil, shift_id: "s1"),
            .init(employee_id: nil, category_id: "c3", category_name: "Хозтовары", amount: 600, note: nil, shift_id: "s2"),
        ]
        employees = [
            .init(id: "e1", name: "Анна Кузнецова", deduct_per_absence: 20, salary: 1200, card_amount: 400),
            .init(id: "e2", name: "Игорь Петров", deduct_per_absence: 20, salary: 1100, card_amount: 0),
            .init(id: "e3", name: "Мария Соколова", deduct_per_absence: 15, salary: 900, card_amount: 300),
        ]
        absences = [.init(employee_id: "e3", source: "manager"), .init(employee_id: "e3", source: "manager")]
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
                let model = AnalyticsModel(rid: app.restaurant?.id ?? "")
                m = model
                #if DEBUG
                if let t = ProcessInfo.processInfo.environment["MISE_DEMO_TAB"] { model.tab = t }
                #endif
                await model.load()
            }
        }
    }
}

private struct AnalyticsBody: View {
    @Bindable var m: AnalyticsModel
    let aiEnabled: Bool
    @State private var showDatePicker = false

    var body: some View {
        ZStack {
            Color.miseBg.ignoresSafeArea()
            VStack(spacing: 0) {
                monthNav
                TabView(selection: $m.tab) {
                    AppTabPage(refresh: { await m.load() }) { PeriodTab(m: m) }
                        .tabItem { Label(t("tab.period"), systemImage: "calendar") }.tag("period")
                    AppTabPage(refresh: { await m.load() }) { KassaTab(m: m) }
                        .tabItem { Label(t("tab.kassa"), systemImage: "banknote.fill") }.tag("kassa")
                    AppTabPage(refresh: { await m.load() }) { ForecastTab(m: m) }
                        .tabItem { Label(t("tab.forecast"), systemImage: "chart.line.uptrend.xyaxis") }.tag("forecast")
                    AppTabPage(refresh: { await m.load() }) { SalaryTab(m: m) }
                        .tabItem { Label(t("tab.salary"), systemImage: "creditcard.fill") }.tag("salary")
                    AppTabPage(refresh: { await m.load() }) { HookahTab(m: m) }
                        .tabItem { Label(t("tab.hookah"), systemImage: "flame.fill") }.tag("hookah")
                }
                .tint(BrandKit.analytics)
                .sensoryFeedback(.selection, trigger: m.tab)
            }
            if aiEnabled {
                AIButton(module: "analytics") { msg in await m.handleAI(msg) }
            }
        }
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
        .padding(.horizontal, 16).padding(.bottom, 6)
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
                .preferredColorScheme(.dark)
            }
            .presentationDetents([.medium])
        }
    }
}

// MARK: Период

private struct PeriodTab: View {
    @Bindable var m: AnalyticsModel
    private var isMonth: Bool { m.periodMode == "month" }
    var body: some View {
        Picker("", selection: $m.periodMode) {
            Text(t("an.day")).tag("day"); Text(t("an.week")).tag("week"); Text(t("an.month")).tag("month")
        }.pickerStyle(.segmented)

        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 10), count: 2), spacing: 10) {
            stat(t("an.income"), cur(m.pIncome), BrandKit.analytics, isMonth ? m.pct(m.totalIncome, m.prevIncome) : nil)
            stat(t("an.expense"), cur(m.pExpense), BrandKit.menu, isMonth ? m.pct(m.totalExpense, m.prevExpense) : nil)
            stat(t("tab.kassa"), cur(m.pClosing), BrandKit.manager, nil)
            stat(t("mg.inkass"), cur(m.cumulativeInkass), BrandKit.stash, nil)
        }
        if m.periodMode != "day" && !m.dailyIncome.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                Text(t("an.incomeByDay")).font(.system(size: 12, weight: .semibold)).foregroundStyle(.primary.opacity(0.45)).kerning(0.5)
                Chart(m.dailyIncome) { d in
                    BarMark(x: .value("День", d.day), y: .value("Доход", d.income))
                        .foregroundStyle(BrandKit.analytics)
                        .cornerRadius(3)
                }
                .chartXAxis { AxisMarks(values: .automatic(desiredCount: 6)) { v in AxisValueLabel().foregroundStyle(.primary.opacity(0.4)) } }
                .chartYAxis { AxisMarks { _ in AxisValueLabel().foregroundStyle(.primary.opacity(0.4)) } }
                .frame(height: 160)
            }
            .padding(14).frame(maxWidth: .infinity)
            .background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 16))
        }
        if !m.catMap.isEmpty {
            VStack(alignment: .leading, spacing: 0) {
                Text(m.periodMode == "day" ? t("an.expenses") : t("an.topExpenses")).font(.system(size: 12, weight: .semibold)).foregroundStyle(.primary.opacity(0.45)).kerning(0.5)
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
    }

    private func stat(_ label: String, _ value: String, _ color: Color, _ pct: Double?) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label).font(.system(size: 12)).foregroundStyle(.primary.opacity(0.45))
            Text(value).font(.system(size: 22, weight: .heavy)).foregroundStyle(color).minimumScaleFactor(0.6).lineLimit(1)
            if let p = pct {
                Text((p >= 0 ? "▲ " : "▼ ") + String(format: "%.0f%%", abs(p)))
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(p >= 0 ? BrandKit.analytics : BrandKit.menu)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading).padding(14)
        .background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 16))
    }
}

// MARK: Зарплата

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
                        Text(cur(r.total)).font(.system(size: 16, weight: .bold)).foregroundStyle(.primary)
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
                        detail(t("byCash"), cur(r.cash))
                        CardInputRow(empId: r.id, current: r.card) { amt in
                            Task { await m.saveMonthlyCard(r.id, amt) }
                        }
                        .id(m.ymKey + r.id) // пересоздать поле при смене месяца → не тянуть сумму прошлого
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

/// Поле ввода суммы «на карту в этом месяце».
private struct CardInputRow: View {
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

// MARK: Кальян

private struct HookahTab: View {
    @Bindable var m: AnalyticsModel
    var body: some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 10), count: 2), spacing: 10) {
            stat(t("st.sold"), "\(m.qtyMonth)", BrandKit.stash)
            stat(t("st.revenue"), cur(m.revMonth), BrandKit.analytics)
            stat(t("st.free"), "\(m.qtyFree)", BrandKit.people)
            stat(t("st.tobacco"), kg(m.usedMonthG), BrandKit.manager)
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

// MARK: Касса

private struct KassaTab: View {
    @Bindable var m: AnalyticsModel
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
                        LineMark(x: .value("Дата", s.date), y: .value("Касса", s.closing_balance ?? 0))
                            .foregroundStyle(BrandKit.manager).interpolationMethod(.catmullRom)
                        PointMark(x: .value("Дата", s.date), y: .value("Касса", s.closing_balance ?? 0))
                            .foregroundStyle(BrandKit.manager)
                    }
                    .chartXAxis(.hidden)
                    .chartYAxis { AxisMarks { _ in AxisValueLabel().foregroundStyle(.primary.opacity(0.4)) } }
                    .frame(height: 150)
                }
            }
            if m.filledShifts.isEmpty {
                Text(t("an.noShiftData")).font(.system(size: 14)).foregroundStyle(.primary.opacity(0.4)).padding(.top, 30)
            } else {
                VStack(alignment: .leading, spacing: 0) {
                    Text(t("an.byDay")).font(.system(size: 12, weight: .semibold)).foregroundStyle(.primary.opacity(0.45)).kerning(0.5).padding(.bottom, 8)
                    HStack {
                        Text(t("an.date")).frame(width: 44, alignment: .leading)
                        Text(t("an.inCol")).frame(maxWidth: .infinity, alignment: .trailing)
                        Text(t("an.income")).frame(maxWidth: .infinity, alignment: .trailing)
                        Text(t("an.expense")).frame(maxWidth: .infinity, alignment: .trailing)
                        Text(t("tab.kassa")).frame(maxWidth: .infinity, alignment: .trailing)
                    }
                    .font(.system(size: 11)).foregroundStyle(.primary.opacity(0.35)).padding(.bottom, 6)
                    ForEach(Array(m.filledShifts.enumerated()), id: \.element.id) { i, s in
                        HStack {
                            Text(dd(s.date)).frame(width: 44, alignment: .leading).foregroundStyle(.primary.opacity(0.5))
                            cell((s.opening_balance ?? 0) > 0 ? cur(s.opening_balance ?? 0) : "—", BrandKit.manager)
                            cell((s.income ?? 0) > 0 ? cur(s.income ?? 0) : "—", BrandKit.analytics)
                            cell((s.total_expense ?? 0) > 0 ? cur(s.total_expense ?? 0) : "—", BrandKit.menu)
                            cell(cur(s.closing_balance ?? 0), BrandKit.manager, bold: true)
                        }
                        .font(.system(size: 12)).padding(.vertical, 9)
                        if i < m.filledShifts.count - 1 { Divider().overlay(Color.primary.opacity(0.07)) }
                    }
                }
                .padding(14).background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 16))
            }
        } else {
            let salToday = (m.payrollTotal / Double(m.daysInMonth) * Double(m.daysPassed)).rounded()
            let diff = m.totalInkassNet - salToday
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 10), count: 2), spacing: 10) {
                stat(t("an.totalInkass"), cur(m.totalInkassNet), BrandKit.stash)
                stat(t("an.salaryToday"), cur(salToday), diff >= 0 ? BrandKit.analytics : BrandKit.menu)
            }
            if m.shiftsWithInk.isEmpty {
                Text(t("an.noInkass")).font(.system(size: 14)).foregroundStyle(.primary.opacity(0.4)).padding(.top, 30)
            } else {
                VStack(spacing: 0) {
                    HStack {
                        Text(t("an.date")).frame(width: 44, alignment: .leading)
                        Text(t("mg.inkass")).frame(maxWidth: .infinity, alignment: .trailing)
                        Text(t("an.expense")).frame(maxWidth: .infinity, alignment: .trailing)
                        Text(t("mg.inkReason")).frame(maxWidth: .infinity, alignment: .trailing)
                        Text(t("an.inkNet")).frame(width: 60, alignment: .trailing)
                    }
                    .font(.system(size: 11)).foregroundStyle(.primary.opacity(0.35))
                    .padding(.horizontal, 14).padding(.top, 12).padding(.bottom, 6)
                    Divider().overlay(Color.primary.opacity(0.08))
                    ForEach(Array(m.shiftsWithInk.enumerated()), id: \.element.id) { i, s in
                        let ink = m.inkDetails[s.id]
                        HStack {
                            Text(dd(s.date)).frame(width: 44, alignment: .leading).foregroundStyle(.primary.opacity(0.5))
                            Text(cur(s.inkassation ?? 0)).frame(maxWidth: .infinity, alignment: .trailing).foregroundStyle(BrandKit.stash)
                            Text((ink?.expense ?? 0) > 0 ? "−" + cur(ink?.expense ?? 0) : "—")
                                .frame(maxWidth: .infinity, alignment: .trailing).foregroundStyle(BrandKit.menu)
                            Text(ink?.reason?.isEmpty == false ? (ink?.reason ?? "—") : "—")
                                .frame(maxWidth: .infinity, alignment: .trailing)
                                .foregroundStyle(.primary.opacity(0.45))
                                .lineLimit(1)
                            Text(cur(ink?.total ?? (s.inkassation ?? 0)))
                                .frame(width: 60, alignment: .trailing).fontWeight(.semibold)
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
    }
}

private func dayLabelRu(_ ymd: String) -> String {
    let inF = DateFormatter(); inF.dateFormat = "yyyy-MM-dd"; inF.locale = Locale(identifier: "en_US_POSIX")
    guard let d = inF.date(from: ymd) else { return ymd }
    let f = DateFormatter(); f.locale = appLocale(); f.dateFormat = "EEE, d MMM"
    return f.string(from: d).capitalized
}

// MARK: Прогноз

private struct ForecastTab: View {
    @Bindable var m: AnalyticsModel
    @State private var goalText = ""
    @FocusState private var goalFocused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(m.isCurrentMonth ? t("an.forecastMonth") : t("an.revenueMonth"))
                .font(.system(size: 12, weight: .semibold)).foregroundStyle(.primary.opacity(0.45)).kerning(0.5)
            Text(cur(m.isCurrentMonth ? m.projected : m.totalIncome))
                .font(.system(size: 34, weight: .heavy)).foregroundStyle(.primary)
            if m.isCurrentMonth {
                Text(t("an.atPace", ["v": cur(m.dailyAvg.rounded())]))
                    .font(.system(size: 13)).foregroundStyle(.primary.opacity(0.45))
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading).padding(18)
        .background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 18))

        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 3), spacing: 8) {
            mini(t("an.sinceMonthStart"), cur(m.totalIncome), BrandKit.manager)
            mini(t("an.avgPerDay"), cur(m.dailyAvg.rounded()), BrandKit.stash)
            mini(t("an.prevMonth"), cur(m.prevIncome), BrandKit.people)
        }

        VStack(alignment: .leading, spacing: 12) {
            Text(t("an.monthGoal")).font(.system(size: 12, weight: .semibold)).foregroundStyle(.primary.opacity(0.45)).kerning(0.5)
            HStack {
                Text(t("an.revenueGoal")).font(.system(size: 14)).foregroundStyle(.primary)
                Spacer()
                if goalFocused {
                    Button(t("done")) { Task { await m.saveGoal(Double(goalText) ?? 0) }; goalFocused = false }
                        .font(.system(size: 13, weight: .bold)).foregroundStyle(BrandKit.analytics)
                }
                Text(Money.symbol).foregroundStyle(.primary.opacity(0.4))
                TextField("0", text: $goalText)
                    .keyboardType(.numberPad).multilineTextAlignment(.trailing)
                    .font(.system(size: 15, weight: .bold)).foregroundStyle(.primary)
                    .frame(width: 100).padding(.vertical, 7).padding(.horizontal, 10)
                    .background(Color.primary.opacity(0.07), in: RoundedRectangle(cornerRadius: 10))
                    .focused($goalFocused)
                    .onChange(of: goalFocused) { _, f in if !f { Task { await m.saveGoal(Double(goalText) ?? 0) } } }
            }
            if m.revGoal > 0 {
                GeometryReader { geo in
                    ZStack(alignment: .leading) {
                        Capsule().fill(Color.primary.opacity(0.1)).frame(height: 8)
                        Capsule().fill(m.onTrack ? BrandKit.analytics : BrandKit.stash)
                            .frame(width: geo.size.width * m.goalPct / 100, height: 8)
                    }
                }
                .frame(height: 8)
                HStack {
                    Text(t("an.goalProgress", ["pct": "\(Int(m.goalPct))", "cur": cur(m.totalIncome), "goal": cur(m.revGoal)]))
                        .font(.system(size: 12)).foregroundStyle(.primary.opacity(0.5))
                    Spacer()
                    if m.isCurrentMonth && m.daysLeft > 0 {
                        Text(m.onTrack ? t("an.onTrack") : t("an.needPerDay", ["v": cur(m.needPerDay.rounded())]))
                            .font(.system(size: 12, weight: .semibold)).foregroundStyle(m.onTrack ? BrandKit.analytics : BrandKit.stash)
                    } else {
                        Text(m.totalIncome >= m.revGoal ? t("an.goalReached") : t("an.short", ["v": cur(m.revGoal - m.totalIncome)]))
                            .font(.system(size: 12, weight: .semibold)).foregroundStyle(m.totalIncome >= m.revGoal ? BrandKit.analytics : BrandKit.menu)
                    }
                }
            }
        }
        .padding(16).background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 16))
        .onAppear { goalText = m.revGoal > 0 ? String(Int(m.revGoal)) : "" }
    }

    private func mini(_ label: String, _ value: String, _ color: Color) -> some View {
        VStack(spacing: 3) {
            Text(value).font(.system(size: 15, weight: .heavy)).foregroundStyle(color).minimumScaleFactor(0.5).lineLimit(1)
            Text(label).font(.system(size: 10)).foregroundStyle(.primary.opacity(0.45)).multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity).padding(.vertical, 12)
        .background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 12))
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
