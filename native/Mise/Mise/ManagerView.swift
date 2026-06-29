import SwiftUI

// MARK: - Числовые помощники

private func num(_ s: String) -> Double {
    Double(s.replacingOccurrences(of: ",", with: ".")) ?? 0
}
private func money(_ v: Double) -> String { Money.s(v) }

// MARK: - Модель Manager (касса/смена дня) — логика повторяет app/manager/page.tsx

@MainActor
@Observable
final class ManagerModel {
    let rid: String

    var currentDate = Date()
    var shift: Shift?
    var employees: [Employee] = []
    var categories: [Category] = []
    var absences: Set<String> = []
    var autoAbsences: Set<String> = []
    var empExtras: [String: String] = [:]
    var catAmounts: [String: String] = [:]
    var catNotes: [String: String] = [:]
    var income = ""
    var incomeCard = ""
    var inkSum = ""
    var inkExpense = ""
    var inkReason = ""
    var inkSalary = ""
    var inkSalaryNote = ""

    var locked = false
    var saving = false
    var loading = true
    var toast: String?

    init(rid: String) { self.rid = rid }

    private let dfKey: DateFormatter = {
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.locale = Locale(identifier: "en_US_POSIX")
        return f
    }()
    func key(_ d: Date) -> String { dfKey.string(from: d) }
    private func activity(_ s: Shift) -> Double { (s.income ?? 0) + (s.total_expense ?? 0) + (s.inkassation ?? 0) }

    struct Calc {
        var inc = 0.0, card = 0.0, ink = 0.0
        var catTotal = 0.0, empExtraTotal = 0.0, totalExp = 0.0
        var opening = 0.0, balance = 0.0, salary = 0.0, inkNet = 0.0
    }

    var calc: Calc {
        var c = Calc()
        c.inc = num(income); c.card = num(incomeCard); c.ink = num(inkSum)
        c.catTotal = categories.reduce(0) { $0 + num(catAmounts[$1.id] ?? "") }
        c.empExtraTotal = employees.reduce(0) { $0 + num(empExtras[$1.id] ?? "") }
        c.totalExp = c.catTotal + c.empExtraTotal + c.ink
        c.opening = shift?.opening_balance ?? 0
        c.balance = c.opening + c.inc - c.totalExp
        c.salary = num(inkSalary)
        c.inkNet = c.ink - num(inkExpense) - c.salary
        return c
    }

    // MARK: загрузка

    func start() async {
        #if DEBUG
        if ProcessInfo.processInfo.environment["MISE_DEMO_UI"] == "1" {
            seedDemo(); return
        }
        #endif
        async let emps = (try? DB.from("employees").select("id,name,deduct_per_absence")
            .eq("is_active", true).order("name").list(Employee.self)) ?? []
        async let cats = (try? DB.from("expense_categories").select("id,name")
            .order("name").list(Category.self)) ?? []
        employees = await emps
        categories = await cats
        await loadDay(currentDate)
    }

    private func prevClosing(before date: Date) async -> Double {
        let y = Calendar.current.date(byAdding: .day, value: -1, to: date) ?? date
        let rows = (try? await DB.from("shifts").select("closing_balance")
            .eq("date", key(y)).order("opened_at", ascending: false).limit(1).list(ClosingOnly.self)) ?? []
        return rows.first?.closing_balance ?? 0
    }

    func loadDay(_ date: Date) async {
        loading = true
        defer { loading = false }
        let dateStr = key(date)
        // Только при успехе обрабатываем — сбой на refresh не должен сбрасывать открытую смену.
        guard let shifts = try? await DB.from("shifts").select()
            .eq("date", dateStr).order("opened_at").list(Shift.self) else {
            if shift != nil { flash(t("refreshFailed")) }
            return
        }
        let opening = await prevClosing(before: date)

        // На случай дублей на одну дату (до миграции shifts-date-fix.sql) берём смену
        // с наибольшими данными, чтобы не показывать пустую/«открыть смену».
        let best = shifts.max { activity($0) < activity($1) } ?? shifts.first
        guard var sh = best else {
            shift = nil; locked = false
            income = ""; incomeCard = ""; inkSum = ""; inkExpense = ""; inkReason = ""
            inkSalary = ""; inkSalaryNote = ""
            catAmounts = [:]; catNotes = [:]; empExtras = [:]; absences = []; autoAbsences = []
            return
        }
        sh.opening_balance = opening
        shift = sh
        locked = (sh.income ?? 0) > 0 || (sh.total_expense ?? 0) > 0 || (sh.inkassation ?? 0) > 0
        income = (sh.income ?? 0) > 0 ? trimNum(sh.income!) : ""
        incomeCard = (sh.income_card ?? 0) > 0 ? trimNum(sh.income_card!) : ""
        inkSum = (sh.inkassation ?? 0) > 0 ? trimNum(sh.inkassation!) : ""

        let exps = (try? await DB.from("shift_expenses").select().eq("shift_id", sh.id).list(ShiftExpense.self)) ?? []
        var amounts: [String: String] = [:], notes: [String: String] = [:], extras: [String: String] = [:]
        for e in exps {
            if let emp = e.employee_id { extras[emp] = trimNum(e.amount ?? 0) }
            else if let cat = e.category_id {
                amounts[cat] = trimNum(e.amount ?? 0); if let n = e.note, !n.isEmpty { notes[cat] = n }
            }
        }
        catAmounts = amounts; catNotes = notes; empExtras = extras
        await loadAbsences(dateStr)

        let inks = (try? await DB.from("inkassations").select().eq("shift_id", sh.id).limit(1).list(Inkassation.self)) ?? []
        if let ink = inks.first {
            inkExpense = (ink.expense ?? 0) > 0 ? trimNum(ink.expense!) : ""
            inkReason = ink.reason ?? ""
            inkSalary = (ink.salary ?? 0) > 0 ? trimNum(ink.salary!) : ""
            inkSalaryNote = ink.salary_note ?? ""
        } else {
            inkExpense = ""; inkReason = ""; inkSalary = ""; inkSalaryNote = ""
        }
    }

    private func loadAbsences(_ dateStr: String) async {
        nonisolated struct Abs: Codable { let employee_id: String?; let source: String? }
        let abs = (try? await DB.from("shift_absences").select().eq("date", dateStr).list(Abs.self)) ?? []
        absences = Set(abs.compactMap { $0.employee_id })
        autoAbsences = Set(abs.filter { $0.source == "auto" }.compactMap { $0.employee_id })
    }

    private func trimNum(_ v: Double) -> String {
        v == v.rounded() ? String(format: "%.0f", v) : String(v)
    }

    // MARK: действия

    func changeDate(_ dir: Int) async {
        if shift != nil && !locked { _ = try? await persist() }
        currentDate = Calendar.current.date(byAdding: .day, value: dir, to: currentDate) ?? currentDate
        await loadDay(currentDate)
    }

    func openShift() async {
        saving = true; defer { saving = false }
        let opening = await prevClosing(before: currentDate)
        // Защита от дублей: если смена на эту дату уже есть — используем её, не создаём новую.
        let existing = (try? await DB.from("shifts").select()
            .eq("date", key(currentDate)).order("opened_at").list(Shift.self)) ?? []
        if !existing.isEmpty {
            await loadDay(currentDate)
            return
        }
        let values: [String: Any] = [
            "restaurant_id": rid, "date": key(currentDate),
            "opening_balance": opening, "income": 0, "inkassation": 0,
            "closing_balance": opening, "status": "open",
        ]
        if var sh = try? await DB.from("shifts").insert(values).single(Shift.self) {
            sh.opening_balance = opening
            shift = sh
            await loadAbsences(key(currentDate))
            flash(t("mg.shiftOpened"))
            await Notify.send(type: "cash_open", title: "Касса открыта", body: "Смена открыта", audience: ["managers": true])
        } else {
            await loadDay(currentDate)
        }
    }

    func toggleAbsence(_ empId: String) async {
        guard let sh = shift else { return }
        let dateStr = key(currentDate)
        if absences.contains(empId) {
            try? await DB.from("shift_absences").delete().eq("date", dateStr).eq("employee_id", empId).run()
            absences.remove(empId)
        } else {
            try? await DB.from("shift_absences")
                .insert(["shift_id": sh.id, "restaurant_id": rid, "employee_id": empId, "date": dateStr]).run()
            absences.insert(empId)
        }
        autoAbsences.remove(empId)
    }

    @discardableResult
    private func persist() async throws -> Double? {
        guard let sh = shift else { return nil }
        let c = calc

        try await DB.from("shifts").update([
            "income": c.inc, "income_card": c.card, "inkassation": c.ink,
            "total_expense": c.totalExp, "closing_balance": c.balance,
        ]).eq("id", sh.id).run()

        try? await DB.from("shift_expenses").delete().eq("shift_id", sh.id).run()
        var catInserts: [[String: Any]] = []
        for cat in categories {
            let amt = num(catAmounts[cat.id] ?? "")
            if amt > 0 {
                catInserts.append(["shift_id": sh.id, "restaurant_id": rid, "category_id": cat.id,
                                   "category_name": cat.name, "amount": amt, "note": catNotes[cat.id] ?? ""])
            }
        }
        if !catInserts.isEmpty { try await DB.from("shift_expenses").insert(catInserts).run() }
        // Экстры по сотрудникам — отдельной вставкой и best-effort: нужна колонка
        // shift_expenses.employee_id (миграция shift-expenses-employee-id.sql). Без неё
        // экстры просто не сохранятся, но касса/категории/инкассация сохранятся нормально.
        var empInserts: [[String: Any]] = []
        for emp in employees {
            let extra = num(empExtras[emp.id] ?? "")
            if extra > 0 {
                empInserts.append(["shift_id": sh.id, "restaurant_id": rid, "employee_id": emp.id,
                                   "category_name": emp.name + " (экстра)", "amount": extra])
            }
        }
        if !empInserts.isEmpty { try? await DB.from("shift_expenses").insert(empInserts).run() }

        try await DB.from("inkassations").delete().eq("shift_id", sh.id).run()
        if c.ink > 0 || !inkExpense.isEmpty || !inkReason.isEmpty || c.salary > 0 || !inkSalaryNote.isEmpty {
            try await DB.from("inkassations").insert([
                "shift_id": sh.id, "restaurant_id": rid, "date": key(currentDate),
                "amount": c.ink, "expense": num(inkExpense), "reason": inkReason,
                "salary": c.salary, "salary_note": inkSalaryNote, "total": c.inkNet,
            ]).run()
        }
        // best-effort: подтвердить прогулы дня (привязать к смене, снять авто-черновик)
        _ = try? await DB.from("shift_absences").update(["shift_id": sh.id, "source": "manager"])
            .eq("date", key(currentDate)).run()
        autoAbsences = []
        return c.balance
    }

    func save() async {
        guard shift != nil else { return }
        saving = true
        do {
            try await persist()
            locked = true
            flash(t("mg.shiftSaved"))
            let c = calc
            // Дайджест дня: сводка в защищённом теле (показывается, если включён show_cash_amount).
            nonisolated struct HkSale: Codable, Sendable { let quantity: Double?; let price: Double?; let is_free: Bool? }
            var hk = ""
            if let sales = try? await DB.from("hookah_sales").select("quantity, price, is_free, date")
                .eq("date", key(currentDate)).list(HkSale.self) {
                let paid = sales.filter { $0.is_free != true }.reduce(0) { $0 + Int($1.quantity ?? 0) }
                let rev = sales.filter { $0.is_free != true }.reduce(0.0) { $0 + ($1.quantity ?? 0) * ($1.price ?? 0) }
                if paid > 0 { hk = " · Кальяны \(paid) (\(Money.s(rev)))" }
            }
            var digest = "Выручка \(Money.s(c.inc))"
            if c.card > 0 { digest += " + карта \(Money.s(c.card))" }
            digest += " · Расход \(Money.s(c.totalExp))"
            if c.ink > 0 { digest += " · Инкасс \(Money.s(c.ink))" }
            digest += " · Касса \(Money.s(c.balance))" + hk
            await Notify.send(type: "cash_close", title: "Касса закрыта — итоги дня", body: "Смена закрыта",
                              audience: ["managers": true],
                              secureBody: digest)
        } catch {
            flash(t("saveFailed", ["err": error.localizedDescription]))
        }
        saving = false
    }

    #if DEBUG
    private func seedDemo() {
        employees = [
            .init(id: "e1", name: "Анна Кузнецова", deduct_per_absence: 20),
            .init(id: "e2", name: "Игорь Петров", deduct_per_absence: 20),
            .init(id: "e3", name: "Мария Соколова", deduct_per_absence: 15),
        ]
        categories = [
            .init(id: "c1", name: "Продукты"),
            .init(id: "c2", name: "Бар"),
            .init(id: "c3", name: "Хозтовары"),
        ]
        shift = Shift(id: "s1", date: key(currentDate), status: "open",
                      income: 0, income_card: 0, total_expense: 0, inkassation: 0,
                      closing_balance: 0, opening_balance: 200)
        income = "1850"; incomeCard = "640"
        catAmounts = ["c1": "320", "c2": "90"]
        empExtras = ["e2": "40"]
        absences = ["e3"]; autoAbsences = ["e3"]
        inkSum = "1500"; inkSalary = "200"; inkSalaryNote = "Аванс Анне"
        loading = false
    }
    #endif

    func handleAI(_ message: String) async -> String? {
        let empNames = employees.map(\.name).joined(separator: ", ")
        let catNames = categories.map(\.name).joined(separator: ", ")
        let ctx = "Employees: \(empNames). Expense categories: \(catNames)."
        do {
            let result = try await API.aiChat(module: "manager", message: message, context: ctx)
            guard let type = result["type"] as? String, type == "prefill" else {
                flash(t("ai.noData")); return nil
            }
            func str(_ key: String) -> String { (result[key] as? String) ?? "" }
            if !str("income").isEmpty      { income = str("income") }
            if !str("incomeCard").isEmpty  { incomeCard = str("incomeCard") }
            if !str("inkSum").isEmpty      { inkSum = str("inkSum") }
            if !str("inkExpense").isEmpty  { inkExpense = str("inkExpense") }
            if !str("inkReason").isEmpty   { inkReason = str("inkReason") }
            if !str("inkSalary").isEmpty   { inkSalary = str("inkSalary") }
            flash(t("ai.applied"))
        } catch let err as APIError {
            switch err {
            case .http(403, _): flash(t("ai.err403"))
            case .http(500, _): flash(t("ai.err500"))
            case .http(502, _): flash(t("ai.err502"))
            default: flash(t("ai.errGeneric"))
            }
        } catch {
            flash(t("ai.errGeneric"))
        }
        return nil
    }

    private func flash(_ m: String) {
        toast = m
        Task { try? await Task.sleep(nanoseconds: 2_400_000_000); if toast == m { toast = nil } }
    }
}

// MARK: - Экран Manager

struct ManagerView: View {
    @Environment(AppModel.self) private var app
    @State private var m: ManagerModel?

    var body: some View {
        Group {
            if let m {
                ManagerBody(m: m, aiEnabled: app.aiEnabled)
                    .transition(.opacity)
            } else {
                ManagerSkeleton()
                    .transition(.opacity)
            }
        }
        .animation(.easeOut(duration: 0.3), value: m == nil)
        .tabEdgeSwipe(tabs: ["only"], selection: .constant("only"),
                      onFirstBack: app.availableApps.count > 1 ? { app.backToLauncher() } : nil)
        .task {
            if m == nil {
                let model = ManagerModel(rid: app.restaurant?.id ?? "")
                m = model
                await model.start()
            }
        }
    }
}

private struct ManagerBody: View {
    @Bindable var m: ManagerModel
    let aiEnabled: Bool
    private let accent = BrandKit.manager

    var body: some View {
        ZStack(alignment: .top) {
            Color.miseBg.ignoresSafeArea()
            ScrollView {
                VStack(spacing: 14) {
                    dateRow
                    Group {
                        if m.shift == nil {
                            emptyState
                                .transition(.opacity)
                        } else {
                            shiftBody
                                .transition(.opacity.combined(with: .move(edge: .bottom)))
                        }
                    }
                    .animation(.spring(duration: 0.4, bounce: 0.08), value: m.shift == nil)
                }
                .padding(16)
                .padding(.bottom, 40)
                .opacity(m.loading ? 0 : 1)
                .offset(y: m.loading ? 18 : 0)
                .animation(.spring(duration: 0.45, bounce: 0.1), value: m.loading)
            }
            .refreshable { await m.loadDay(m.currentDate) }

            if let toast = m.toast {
                Text(toast)
                    .font(.system(size: 14, weight: .semibold)).foregroundStyle(.primary)
                    .padding(.horizontal, 18).padding(.vertical, 12)
                    .background(.ultraThinMaterial, in: Capsule())
                    .padding(.top, 8)
                    .transition(.move(edge: .top).combined(with: .opacity))
            }

            if aiEnabled {
                AIButton(module: "manager") { msg in await m.handleAI(msg) }
            }
        }
        .animation(.easeInOut(duration: 0.2), value: m.toast)
        .scrollDismissesKeyboard(.interactively)
    }

    // дата
    private var dateRow: some View {
        HStack(spacing: 12) {
            circleBtn("chevron.left") { Task { await m.changeDate(-1) } }
            VStack(spacing: 2) {
                Text(displayDate(m.currentDate))
                    .font(.system(size: 17, weight: .bold)).foregroundStyle(.primary)
                Text(dow(m.currentDate)).font(.system(size: 13, weight: .medium)).foregroundStyle(accent)
            }
            .frame(maxWidth: .infinity)
            circleBtn("chevron.right") { Task { await m.changeDate(1) } }
        }
        .padding(14)
        .background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    private var emptyState: some View {
        VStack(spacing: 16) {
            ZStack {
                RoundedRectangle(cornerRadius: 22, style: .continuous).fill(accent.opacity(0.14)).frame(width: 80, height: 80)
                Image(systemName: "clock").font(.system(size: 34, weight: .light)).foregroundStyle(accent)
            }
            Text(t("mg.noShift")).font(.system(size: 20, weight: .bold)).foregroundStyle(.primary)
            Text(t("mg.noShiftHint"))
                .font(.system(size: 14)).foregroundStyle(.primary.opacity(0.5)).multilineTextAlignment(.center)
            Button { Task { await m.openShift() } } label: {
                Text(t("mg.openShift")).font(.system(size: 16, weight: .bold)).foregroundStyle(.white)
                    .padding(.horizontal, 40).padding(.vertical, 16)
                    .background(accent, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            }
            .disabled(m.saving)
        }
        .padding(.top, 50)
    }

    @ViewBuilder private var shiftBody: some View {
        let c = m.calc
        // Закрытая смена: данные видно сквозь матовое стекло, поля заблокированы,
        // поверх — статус «Смена закрыта» и кнопка открыть на редактирование.
        ZStack(alignment: .top) {
            VStack(spacing: 14) {
                staffSection
                if !m.categories.isEmpty {
                    sectionTitle(t("mg.expenses"))
                    card {
                        ForEach(Array(m.categories.enumerated()), id: \.element.id) { i, cat in
                            fieldRow(cat.name, text: binding(\.catAmounts, cat.id))
                            if i < m.categories.count - 1 { divider }
                        }
                    }
                }
                sectionTitle(t("mg.inkass"))
                card {
                    fieldRow(t("mg.inkSum"), text: $m.inkSum)
                    divider
                    fieldRow(t("mg.inkExpense"), text: $m.inkExpense)
                    divider
                    textRow(t("mg.inkReason"), text: $m.inkReason)
                    divider
                    fieldRow(t("mg.salary"), text: $m.inkSalary)
                }
                sectionTitle(t("mg.cash"))
                card {
                    fieldRow(t("mg.cashIncome"), text: $m.income)
                    divider
                    fieldRow(t("mg.cardIncome"), text: $m.incomeCard)
                }
                summary(c)
            }
            .blur(radius: m.locked ? 3.5 : 0)
            .disabled(m.locked)
            .allowsHitTesting(!m.locked)

            if m.locked { closedOverlay }
        }
        if !m.locked { saveBar }
    }

    private var closedOverlay: some View {
        VStack(spacing: 10) {
            HStack(spacing: 7) {
                Image(systemName: "lock.fill").font(.system(size: 14, weight: .bold))
                Text(t("mg.shiftClosed")).font(.system(size: 16, weight: .bold))
            }
            .foregroundStyle(.primary)
            Text(t("mg.shiftSavedSub"))
                .font(.system(size: 13)).foregroundStyle(.primary.opacity(0.6))
            Button { withAnimation(.easeInOut(duration: 0.2)) { m.locked = false } } label: {
                Label(t("mg.openForEdit"), systemImage: "pencil")
                    .font(.system(size: 15, weight: .semibold)).foregroundStyle(.white)
                    .padding(.horizontal, 22).padding(.vertical, 13)
                    .background(accent, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            }
            .padding(.top, 2)
            Text(t("mg.cascadeNote"))
                .font(.system(size: 12)).foregroundStyle(.primary.opacity(0.5))
                .multilineTextAlignment(.center)
        }
        .padding(22)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 22, style: .continuous).strokeBorder(Color.primary.opacity(0.12)))
        .padding(.horizontal, 24)
        .padding(.top, 60)
        .transition(.opacity)
    }

    @ViewBuilder private var staffSection: some View {
        if !m.employees.isEmpty {
                sectionTitle(t("mg.staff"))
                card {
                    ForEach(Array(m.employees.enumerated()), id: \.element.id) { i, emp in
                        HStack(spacing: 10) {
                            Button { Task { await m.toggleAbsence(emp.id) } } label: {
                                Image(systemName: m.absences.contains(emp.id) ? "xmark.circle.fill" : "circle")
                                    .font(.system(size: 20))
                                    .foregroundStyle(m.absences.contains(emp.id) ? Color.red : Color.primary.opacity(0.25))
                            }
                            Text(emp.name)
                                .font(.system(size: 15))
                                .foregroundStyle(m.absences.contains(emp.id) ? Color.primary.opacity(0.35) : Color.primary)
                                .strikethrough(m.absences.contains(emp.id))
                            if m.autoAbsences.contains(emp.id) && m.absences.contains(emp.id) {
                                Text(t("mg.auto")).font(.system(size: 9, weight: .heavy)).foregroundStyle(BrandKit.stash)
                                    .padding(.horizontal, 5).padding(.vertical, 2)
                                    .background(BrandKit.stash.opacity(0.16), in: RoundedRectangle(cornerRadius: 5))
                            }
                            Spacer()
                            amountField(binding(\.empExtras, emp.id))
                        }
                        .padding(.vertical, 11).padding(.horizontal, 14)
                        if i < m.employees.count - 1 { divider }
                    }
                }
        }
    }

    private func summary(_ c: ManagerModel.Calc) -> some View {
        VStack(spacing: 0) {
            sumRow(t("mg.openingBalance"), money(c.opening))
            sumRow(t("mg.cashRevenue"), money(c.inc))
            sumRow(t("mg.expenses"), "−" + money(c.totalExp).replacingOccurrences(of: "−", with: ""))
            Divider().overlay(Color.primary.opacity(0.12)).padding(.vertical, 4)
            HStack {
                Text(t("mg.closingBalance")).font(.system(size: 16, weight: .bold)).foregroundStyle(.primary)
                Spacer()
                Text(money(c.balance)).font(.system(size: 20, weight: .heavy))
                    .foregroundStyle(c.balance < 0 ? .red : .green)
                    .lineLimit(1).minimumScaleFactor(0.7)
            }
            .padding(.top, 2)
            if c.inkNet != 0 {
                sumRow(t("mg.inkNet"), money(c.inkNet)).padding(.top, 6)
            }
        }
        .padding(16)
        .background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .padding(.top, 4)
    }

    private var saveBar: some View {
        Group {
            if m.locked {
                Button { m.locked = false } label: {
                    Label(t("edit"), systemImage: "pencil")
                        .font(.system(size: 16, weight: .semibold)).foregroundStyle(accent)
                        .frame(maxWidth: .infinity).padding(.vertical, 15)
                        .background(accent.opacity(0.14), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                }
            } else {
                Button { Task { await m.save() } } label: {
                    Text(m.saving ? t("saving") : t("mg.saveShift"))
                        .font(.system(size: 16, weight: .bold)).foregroundStyle(.white)
                        .frame(maxWidth: .infinity).padding(.vertical, 16)
                        .background(accent, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                }
                .disabled(m.saving)
            }
        }
        .padding(.top, 4)
    }

    // MARK: мелкие элементы

    private func binding(_ kp: ReferenceWritableKeyPath<ManagerModel, [String: String]>, _ id: String) -> Binding<String> {
        Binding(get: { m[keyPath: kp][id] ?? "" }, set: { m[keyPath: kp][id] = $0 })
    }

    private func sectionTitle(_ s: String) -> some View {
        HStack {
            Text(s.uppercased()).font(.system(size: 12, weight: .semibold)).foregroundStyle(.primary.opacity(0.45))
                .kerning(0.5)
            Spacer()
        }
        .padding(.horizontal, 4).padding(.top, 8)
    }

    private func card<C: View>(@ViewBuilder _ content: () -> C) -> some View {
        VStack(spacing: 0) { content() }
            .background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    private var divider: some View { Divider().overlay(Color.primary.opacity(0.08)).padding(.leading, 14) }

    private func fieldRow(_ label: String, text: Binding<String>) -> some View {
        HStack {
            Text(label).font(.system(size: 15)).foregroundStyle(.primary)
            Spacer()
            amountField(text)
        }
        .padding(.vertical, 11).padding(.horizontal, 14)
    }

    private func textRow(_ label: String, text: Binding<String>) -> some View {
        HStack {
            Text(label).font(.system(size: 15)).foregroundStyle(.primary)
            Spacer()
            TextField("", text: text)
                .font(.system(size: 15)).foregroundStyle(.primary.opacity(0.85))
                .multilineTextAlignment(.trailing).frame(maxWidth: 160)
        }
        .padding(.vertical, 11).padding(.horizontal, 14)
    }

    private func amountField(_ text: Binding<String>) -> some View {
        TextField("€ 0", text: text)
            .keyboardType(.decimalPad)
            .multilineTextAlignment(.trailing)
            .font(.system(size: 15, weight: .semibold)).foregroundStyle(.primary)
            .frame(width: 96)
            .padding(.vertical, 7).padding(.horizontal, 10)
            .background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 10))
    }

    private func sumRow(_ label: String, _ value: String) -> some View {
        HStack {
            Text(label).font(.system(size: 14)).foregroundStyle(.primary.opacity(0.55))
            Spacer()
            Text(value).font(.system(size: 15, weight: .semibold)).foregroundStyle(.primary)
        }
        .padding(.vertical, 3)
    }

    private func circleBtn(_ symbol: String, _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol).font(.system(size: 15, weight: .bold)).foregroundStyle(.primary)
                .frame(width: 40, height: 40)
        }
    }
}

// MARK: - даты

private func displayDate(_ d: Date) -> String {
    let f = DateFormatter(); f.locale = appLocale(); f.dateFormat = "d MMMM"
    return f.string(from: d)
}
private func dow(_ d: Date) -> String {
    let f = DateFormatter(); f.locale = appLocale(); f.dateFormat = "EEEE"
    return f.string(from: d).capitalized
}
