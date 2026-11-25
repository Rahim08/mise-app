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

    var currentDate: Date
    var shift: Shift?
    var employees: [Employee] = []
    var categories: [Category] = []
    var absences: Set<String> = []
    var autoAbsences: Set<String> = []
    var empExtras: [String: String] = [:]
    var catAmounts: [String: String] = [:]
    var catNotes: [String: String] = [:]
    var customExpenses: [CustomExpenseDraft] = []
    var customExpenseError: String?
    private var loadedCustomExpenses: [String: CustomExpenseDraft] = [:]
    // «В долг» (Б, 2026-08-09): расход вписан, но наличных в кассе не хватило — не уменьшает
    // c.catTotal/empExtraTotal сегодня (кассы физически не покидал), но всё равно попадает в
    // shift_expenses с реальной датой (is_paid=false) — Analytics уже суммирует по датам,
    // так что месячный итог категории видит долг сразу, а не в день погашения.
    var catUnpaid: [String: Bool] = [:]
    var empUnpaid: [String: Bool] = [:]

    // Долги (Б, 2026-08-09, переработано по фидбоку юзера — оплата долга происходит ПРЯМО
    // здесь, при закрытии текущей смены, а не отдельным действием в Analytics). Список — ВСЕ
    // открытые долги ресторана (не только за текущий день): менеджер мог не смочь заплатить
    // неделю назад, долг всё ещё висит и должен быть виден сегодня.
    struct DebtRow: Identifiable, Sendable {
        let id: String; let shiftId: String; let date: String
        let categoryId: String?; let categoryName: String; let employeeId: String?; let amount: Double
        // note — нужен только чтобы отличить ЗП-долг (note начинается с "SALPERIOD:", см.
        // ManagerSalary.swift syncLedger) от обычного expense-долга при погашении (MISE-001,
        // аудит 2026-08-28) — сама карточка долга его не показывает.
        let note: String?
        var isCustom = false
    }
    var openDebts: [DebtRow] = []
    var selectedDebtIds: Set<String> = []
    // Долг самой смены не погашается ею же (двойной счёт) — вместо этого снимается «в долг».
    var selectableDebts: [DebtRow] { openDebts.filter { $0.shiftId != shift?.id } }
    var debtSettleTotal: Double { selectableDebts.filter { selectedDebtIds.contains($0.id) }.reduce(0) { $0 + $1.amount } }
    // Сумма долгов, УЖЕ погашенных сегодняшней сменой (persistDebtSettlements вставляет строку
    // с paid_shift_id == shift_id самой этой смены) — loadDay исключает такие строки из
    // catAmounts/empExtras (см. ниже), поэтому без этого поля пересохранение того же дня
    // теряло сумму погашения из totalExp/closing_balance (A1, аудит 2026-08-13).
    var settledTodayTotal: Double = 0
    // Оплаченные строки смены вне формы (уволенный сотрудник, выключенная категория) — форма
    // их не показывает и не удаляет, но они остаются расходом дня (ShiftForm.swift, аудит 2026-09-27).
    var unmanagedPaidTotal: Double = 0
    // Загрузка сотрудников/категорий — loadDay ждёт её перед разбором строк смены (splitShiftExpenses
    // должен знать, кто активен), не блокируя свои собственные запросы.
    private var catalogLoad: Task<Void, Never>?

    var income = ""
    var incomeCard = ""
    var inkSum = ""
    var inkExpense = ""
    var inkReason = ""
    // Снэпшот значений на момент loadDay — на persist() переносим только правку менеджера
    // (дельту), а не затираем то, что параллельно записал addAdvance/settleDebt в Analytics
    // (A2, аудит 2026-08-09: delete+insert без этого стирал чужие правки инкассации).
    private var loadedInkExpense = ""
    private var loadedInkReason = ""

    var locked = false
    var saving = false
    var loading = true
    var loadError = false        // реальная ошибка загрузки (не отмена) → показать «Повторить»
    var toast: String?
    var showChecklistWarn = false
    var showDebtNegativeWarn = false
    private var loadGen = 0       // поколение загрузки — защита от гонок при быстрой смене даты

    // Вкладки Manager (реструктура 2026-08-13): Смена/Зарплата/Настройки/Дисциплина.
    var tab = "shift"

    // Поступления в баланс инкассации — отдельная таблица, не часть смены (см. InkTopups.swift).
    let topups: InkTopupsModel

    init(rid: String, dayStartHour: Int = 6) {
        self.rid = rid
        self.topups = InkTopupsModel(rid: rid)
        self.currentDate = AppModel.businessDate(dayStartHour: dayStartHour)
    }

    private let dfKey: DateFormatter = {
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.locale = Locale(identifier: "en_US_POSIX")
        return f
    }()
    func key(_ d: Date) -> String { dfKey.string(from: d) }
    private let dfDayMonth: DateFormatter = {
        let f = DateFormatter(); f.dateFormat = "dd.MM"; f.locale = Locale(identifier: "en_US_POSIX")
        return f
    }()
    // {date} для тела кассовых пушей (notify.cashOpenBody/cashCloseBody) — dd.MM.
    func dayMonth(_ d: Date) -> String { dfDayMonth.string(from: d) }
    private func activity(_ s: Shift) -> Double { (s.income ?? 0) + (s.total_expense ?? 0) + (s.inkassation ?? 0) }

    /// Отмена задачи в любом виде (CancellationError, URLError.cancelled, Task.isCancelled).
    private func isCancellation(_ e: Error) -> Bool {
        if e is CancellationError { return true }
        if (e as? URLError)?.code == .cancelled { return true }
        return Task.isCancelled
    }

    struct Calc {
        var inc = 0.0, card = 0.0, ink = 0.0
        var catTotal = 0.0, customTotal = 0.0, empExtraTotal = 0.0, debtTotal = 0.0, totalExp = 0.0
        var opening = 0.0, balance = 0.0, inkNet = 0.0
    }

    var calc: Calc {
        var c = Calc()
        c.inc = num(income); c.card = num(incomeCard); c.ink = num(inkSum)
        // «В долг» — не покидал кассу сегодня, не входит в дневной расход/баланс.
        c.catTotal = categories.reduce(0) { catUnpaid[$1.id] == true ? $0 : $0 + num(catAmounts[$1.id] ?? "") }
        c.customTotal = customExpenseTotal(customExpenses)
        c.empExtraTotal = employees.reduce(0) { empUnpaid[$1.id] == true ? $0 : $0 + num(empExtras[$1.id] ?? "") }
        // Погашение отмеченных долгов — реальные наличные уходят из кассы ИМЕННО сегодня.
        // + уже погашенные сегодня в предыдущем save этого же дня (settledTodayTotal) — иначе
        // пересохранение дня теряет сумму погашения (A1, аудит 2026-08-13).
        c.debtTotal = debtSettleTotal + settledTodayTotal
        c.totalExp = round2(c.catTotal + c.customTotal + c.empExtraTotal + c.debtTotal + unmanagedPaidTotal + c.ink)
        c.opening = shift?.opening_balance ?? 0
        c.balance = round2(c.opening + c.inc - c.totalExp)
        c.inkNet = c.ink - num(inkExpense)
        return c
    }

    // MARK: загрузка

    func start() async {
        #if DEBUG
        if ProcessInfo.processInfo.environment["MISE_DEMO_UI"] == "1" {
            seedDemo(); return
        }
        #endif
        // 4 независимых загрузки — раньше шли одна за другой (юзер-фидбок 2026-09-23:
        // «зона смены в Manager долго грузится»). loadDay/loadOpenDebts не читают
        // employees/categories на этапе загрузки (только на этапе рендера calc), так что
        // все четыре можно запускать одновременно, а не ждать сотрудников/категории первыми.
        let catalog = Task { @MainActor in
            async let emps = (try? DB.from("employees").select("id,name,deduct_per_absence")
                .eq("is_active", true).order("name").list(Employee.self)) ?? []
            async let cats = (try? DB.from("expense_categories").select("id,name")
                .eq("is_active", true).order("name").list(Category.self)) ?? []
            self.employees = await emps
            self.categories = await cats
        }
        catalogLoad = catalog
        async let dayTask: () = loadDay(currentDate)
        async let debtsTask: () = loadOpenDebts()
        await catalog.value
        await dayTask
        await debtsTask
    }

    func loadOpenDebts() async {
        nonisolated struct DebtExp: Codable, Sendable {
            let id: String; let shift_id: String?; let category_id: String?; let category_name: String?
            let employee_id: String?; let amount: Double?; let note: String?; let is_custom: Bool?
        }
        guard let unpaid = try? await DB.from("shift_expenses")
            .select("id, shift_id, category_id, category_name, employee_id, amount, note, is_custom")
            .eq("is_paid", false).list(DebtExp.self), !unpaid.isEmpty else { openDebts = []; return }
        let shiftIds = Array(Set(unpaid.compactMap { $0.shift_id }))
        nonisolated struct ShiftDateRow: Codable, Sendable { let id: String; let date: String }
        let shiftDates = (try? await DB.from("shifts").select("id, date").in("id", shiftIds).list(ShiftDateRow.self)) ?? []
        let dateById = Dictionary(uniqueKeysWithValues: shiftDates.map { ($0.id, $0.date) })
        openDebts = unpaid.compactMap { e -> DebtRow? in
            guard let sid = e.shift_id, let date = dateById[sid] else { return nil }
            return DebtRow(id: e.id, shiftId: sid, date: date, categoryId: e.category_id,
                categoryName: e.category_name ?? "—", employeeId: e.employee_id, amount: e.amount ?? 0, note: e.note, isCustom: e.is_custom == true)
        }.sorted { $0.date < $1.date }
    }

    // Последняя смена НЕ ПОЗЖЕ вчера (не обязательно ровно вчера) — пропущенный день
    // (выходной, забыли открыть смену) не должен молча обнулять остаток кассы.
    // throws: ошибка сети НЕ равна «предыдущих смен нет» — иначе openShift навсегда
    // записывал бы opening_balance = 0 при обычном обрыве связи («замороженный 0»).
    private func prevClosing(before date: Date) async throws -> Double {
        let y = Calendar.current.date(byAdding: .day, value: -1, to: date) ?? date
        let rows = try await DB.from("shifts").select("closing_balance")
            .lte("date", key(y)).order("date", ascending: false).order("opened_at", ascending: false).limit(1).list(ClosingOnly.self)
        return rows.first?.closing_balance ?? 0
    }

    func loadDay(_ date: Date) async {
        loadGen += 1
        let gen = loadGen
        loading = true
        loadError = false
        defer { if gen == loadGen { loading = false } }
        let dateStr = key(date)
        customExpenseError = nil
        selectedDebtIds = [] // выбор долгов относится только к открытому дню
        // prevClosing не зависит от shifts — грузим параллельно, не друг за другом.
        async let openingTask = prevClosing(before: date)
        // do/catch вместо try?: отмену (быстрые тапы по датам) игнорируем без ошибки,
        // реальный сбой → состояние ошибки с кнопкой «Повторить».
        let shifts: [Shift]
        do {
            shifts = try await DB.from("shifts").select()
                .eq("date", dateStr).order("opened_at").list(Shift.self)
        } catch {
            guard gen == loadGen else { return }
            if isCancellation(error) { return }   // быстрые тапы / pull-to-refresh — не ошибка
            #if DEBUG
            print("[Manager] loadDay failed for \(dateStr): \(error)")
            #endif
            // Экран-ошибку показываем, только когда смена ещё не загружена; иначе тихий тост.
            if shift == nil { loadError = true } else { flash(t("refreshFailed")) }
            return
        }
        guard gen == loadGen else { return }   // пользователь уже сменил дату — игнор
        // nil = не смогли узнать остаток (сеть) → оставить хранимое значение, не показывать 0

        // На случай дублей на одну дату (до миграции shifts-date-fix.sql) берём смену
        // с наибольшими данными, чтобы не показывать пустую/«открыть смену».
        let best = shifts.max { activity($0) < activity($1) } ?? shifts.first
        guard let sh = best else {
            shift = nil; locked = false
            income = ""; incomeCard = ""; inkSum = ""; inkExpense = ""; inkReason = ""
            loadedInkExpense = ""; loadedInkReason = ""
            catAmounts = [:]; catNotes = [:]; empExtras = [:]; absences = []; autoAbsences = []
            customExpenses = []; loadedCustomExpenses = [:]
            catUnpaid = [:]; empUnpaid = [:]; settledTodayTotal = 0; unmanagedPaidTotal = 0
            return
        }
        shift = sh
        locked = (sh.income ?? 0) > 0 || (sh.total_expense ?? 0) > 0 || (sh.inkassation ?? 0) > 0
        income = (sh.income ?? 0) > 0 ? trimNum(sh.income!) : ""
        incomeCard = (sh.income_card ?? 0) > 0 ? trimNum(sh.income_card!) : ""
        inkSum = (sh.inkassation ?? 0) > 0 ? trimNum(sh.inkassation!) : ""

        // Три независимых запроса — грузим параллельно, не друг за другом.
        // sh — var (мутируется чуть выше), поэтому фиксируем id в let до захвата в async let.
        let shId = sh.id
        async let expsTask = (try? await DB.from("shift_expenses").select().eq("shift_id", shId).order("created_at").order("id").list(ShiftExpense.self)) ?? []
        async let inksTask = (try? await DB.from("inkassations").select().eq("shift_id", shId).limit(1).list(Inkassation.self)) ?? []
        async let absencesTask: Void = loadAbsences(dateStr, generation: gen)

        let opening = try? await openingTask
        guard gen == loadGen, !Task.isCancelled else { return }
        if let opening { shift?.opening_balance = opening }
        let exps = await expsTask
        await catalogLoad?.value
        guard gen == loadGen else { return }
        // Разбор строк смены — ShiftForm.swift (аудит 2026-09-27): settledTodayTotal — погашения
        // этой сменой; ЗП-долги, строки уволенных/выключенных — вне формы, не удаляются.
        let split = splitShiftExpenses(exps, shiftId: shId,
                                       activeCategoryIds: Set(categories.map(\.id)),
                                       activeEmployeeIds: Set(employees.map(\.id)), includeCustom: true)
        customExpenses = split.customExpenses
        loadedCustomExpenses = Dictionary(uniqueKeysWithValues: split.customExpenses.map { ($0.id, $0) })
        settledTodayTotal = split.settledTodayTotal
        unmanagedPaidTotal = split.unmanagedPaidTotal
        catAmounts = split.catAmounts.mapValues { trimNum(round2($0)) }
        catNotes = split.catNotes
        empExtras = split.empExtras.mapValues { trimNum(round2($0)) }
        catUnpaid = split.catUnpaid; empUnpaid = split.empUnpaid

        let inks = await inksTask
        await absencesTask
        guard gen == loadGen, !Task.isCancelled else { return }
        if let ink = inks.first {
            inkExpense = (ink.expense ?? 0) > 0 ? trimNum(ink.expense!) : ""
            inkReason = ink.reason ?? ""
        } else {
            inkExpense = ""; inkReason = ""
        }
        loadedInkExpense = inkExpense; loadedInkReason = inkReason

        // Черновик несохранённой формы — восстановить, только если смена ещё не сохранена
        // (locked == false); если уже сохранена (реальные данные из БД) — стереть как устаревший.
        if locked { clearDraft(dateStr) } else { restoreDraftIfAny(dateStr) }
    }

    private func loadAbsences(_ dateStr: String, generation: Int? = nil) async {
        nonisolated struct Abs: Codable { let employee_id: String?; let source: String? }
        let abs = (try? await DB.from("shift_absences").select().eq("date", dateStr).list(Abs.self)) ?? []
        guard generation.map({ $0 == loadGen }) ?? true, !Task.isCancelled else { return }
        absences = Set(abs.compactMap { $0.employee_id })
        autoAbsences = Set(abs.filter { $0.source == "auto" }.compactMap { $0.employee_id })
    }

    private func trimNum(_ v: Double) -> String {
        v == v.rounded() ? String(format: "%.0f", v) : String(v)
    }

    // MARK: - Черновик несохранённой формы (юзер-фидбок 2026-08-14). Смена открыта, но
    // «Сохранить смену» ещё не нажата — до сих пор вбитые цифры жили только в @State и
    // терялись, если приложение убивали (свайпом/системой памяти) до сохранения. Черновик
    // лежит в UserDefaults (переживает перезапуск), восстанавливается ТОЛЬКО поверх пустой
    // несохранённой формы (locked == false) и НИКОГДА не считается частью кассы/Analytics —
    // это чисто восстановление ввода, реальные данные появляются лишь по нажатию «Сохранить».
    private struct Draft: Codable {
        var income = "", incomeCard = "", inkSum = "", inkExpense = "", inkReason = ""
        var catAmounts: [String: String] = [:], catNotes: [String: String] = [:], empExtras: [String: String] = [:]
        var catUnpaid: [String: Bool] = [:], empUnpaid: [String: Bool] = [:]
        var customExpenses: [CustomExpenseDraft]? = nil
    }
    private func draftKey(_ dateStr: String) -> String { "mgDraft_\(rid)_\(dateStr)" }

    /// Вызывается при уходе экрана в фон (см. `.onChange(of: scenePhase)` в `ManagerBody`).
    func saveDraft() {
        guard shift != nil, !locked else { return }
        let d = Draft(income: income, incomeCard: incomeCard, inkSum: inkSum, inkExpense: inkExpense,
                      inkReason: inkReason, catAmounts: catAmounts, catNotes: catNotes, empExtras: empExtras,
                      catUnpaid: catUnpaid, empUnpaid: empUnpaid, customExpenses: customExpenses)
        guard let data = try? JSONEncoder().encode(d) else { return }
        UserDefaults.standard.set(data, forKey: draftKey(key(currentDate)))
    }

    private func clearDraft(_ dateStr: String) {
        UserDefaults.standard.removeObject(forKey: draftKey(dateStr))
    }

    private func restoreDraftIfAny(_ dateStr: String) {
        guard let data = UserDefaults.standard.data(forKey: draftKey(dateStr)),
              let d = try? JSONDecoder().decode(Draft.self, from: data) else { return }
        income = d.income; incomeCard = d.incomeCard; inkSum = d.inkSum
        inkExpense = d.inkExpense; inkReason = d.inkReason
        catAmounts = d.catAmounts; catNotes = d.catNotes; empExtras = d.empExtras
        catUnpaid = d.catUnpaid; empUnpaid = d.empUnpaid
        customExpenses = d.customExpenses ?? customExpenses
    }

    // MARK: действия

    func changeDate(_ dir: Int) async {
        guard !saving else { return }
        if shift != nil && !locked {
            do { try await persist() } catch {
                flash(t("saveFailed", ["err": error.localizedDescription])); return
            }
        }
        currentDate = Calendar.current.date(byAdding: .day, value: dir, to: currentDate) ?? currentDate
        await loadDay(currentDate)
    }

    func setDate(_ d: Date) async {
        guard !saving else { return }
        if shift != nil && !locked {
            do { try await persist() } catch {
                flash(t("saveFailed", ["err": error.localizedDescription])); return
            }
        }
        currentDate = d
        await loadDay(d)
    }

    func openShift() async {
        saving = true; defer { saving = false }
        guard let opening = try? await prevClosing(before: currentDate) else {
            flash(t("refreshFailed")); return
        }
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
        do {
            guard var sh = try await DB.from("shifts").insert(values).single(Shift.self) else {
                flash(t("refreshFailed")); return
            }
            sh.opening_balance = opening
            shift = sh
            await loadAbsences(key(currentDate))
            flash(t("mg.shiftOpened"))
            // Пуш «смена открыта» отключён по запросу — низкая ценность, шумит (юзер-фидбек 2026-07-22).
            // Запланировать напоминание о закрытии смены
            if ShiftReminder.isEnabled() { ShiftReminder.schedule() }
        } catch {
            // Раньше try? молчал: пользователь жмёт «Открыть смену», ничего не происходит.
            flash(t("saveFailed", ["err": error.localizedDescription]))
        }
    }

    func toggleAbsence(_ empId: String) async {
        guard !saving, let sh = shift else { return }
        let dateStr = key(currentDate)
        if absences.contains(empId) {
            do {
                try await DB.from("shift_absences").delete().eq("date", dateStr).eq("employee_id", empId).run()
            } catch { flash(t("saveFailed", ["err": error.localizedDescription])); return }
            absences.remove(empId)
        } else {
            do {
                try await DB.from("shift_absences")
                    .insert(["shift_id": sh.id, "restaurant_id": rid, "employee_id": empId, "date": dateStr]).run()
            } catch { flash(t("saveFailed", ["err": error.localizedDescription])); return }
            absences.insert(empId)
        }
        autoAbsences.remove(empId)
    }

    private func validatedCustomExpenses() throws -> [PreparedCustomExpense] {
        do {
            guard !openDebts.contains(where: { $0.isCustom && $0.shiftId == shift?.id && selectedDebtIds.contains($0.id) }) else {
                throw CustomExpenseValidationError.invalid
            }
            let prepared = try prepareCustomExpenses(customExpenses)
            for id in selectedDebtIds {
                guard let original = loadedCustomExpenses[id] else { continue }
                guard let current = customExpenses.first(where: { $0.id == id }),
                      normalizeExpenseName(current.name) == normalizeExpenseName(original.name),
                      parseExpenseCents(current.amount) == parseExpenseCents(original.amount),
                      current.unpaid == original.unpaid, current.note == original.note else {
                    throw CustomExpenseValidationError.invalid
                }
            }
            customExpenseError = nil
            return prepared
        } catch {
            let message = t("mg.customExpenseInvalid")
            customExpenseError = message
            throw NSError(domain: "CustomExpense", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
        }
    }

    /// Saved names only. The gateway supplies the authenticated restaurant scope.
    func expenseNameSuggestions(prefix: String) async throws -> [String] {
        let prefix = normalizeExpenseName(prefix)
        guard !prefix.isEmpty, prefix.utf16.count <= 120 else { return [] }
        #if DEBUG
        if ProcessInfo.processInfo.environment["MISE_DEMO_UI"] == "1" {
            return ["Perfume", "Parking"].filter { $0.lowercased().hasPrefix(prefix.lowercased()) }
        }
        #endif
        nonisolated struct NameRow: Decodable { let name: String }
        nonisolated struct Response: Decodable { let data: [NameRow]? }
        let data = try await API.dbRequest(["op": "rpc", "fn": "shift_expense_name_suggestions", "args": ["p_prefix": prefix]])
        let response = try JSONDecoder().decode(Response.self, from: data)
        var seen = Set<String>()
        return (response.data ?? []).compactMap { row in
            let name = normalizeExpenseName(row.name)
            guard name.utf16.count <= 120, name.lowercased().hasPrefix(prefix.lowercased()),
                  seen.insert(name.lowercased()).inserted else { return nil }
            return name
        }.prefix(20).map { $0 }
    }

    private func persistCustomExpenses(shiftId: String, custom: [PreparedCustomExpense]) async throws -> [ShiftExpense] {
        let fresh = try await DB.from("shift_expenses").fresh()
            .select("id, employee_id, category_id, category_name, amount, note, is_paid, paid_shift_id, is_custom")
            .eq("shift_id", shiftId).order("created_at").order("id").list(ShiftExpense.self)
        let customRows = fresh.filter { $0.is_custom == true }
        let byId = Dictionary(uniqueKeysWithValues: customRows.map { ($0.id.lowercased(), $0) })
        let desiredIds = Set(custom.map { $0.id.lowercased() })
        let knownIds = Set(loadedCustomExpenses.keys)
        func matches(_ current: ShiftExpense, _ name: String, _ amount: Double, _ unpaid: Bool, _ note: String) -> Bool {
            current.paid_shift_id == nil && current.category_id == nil && current.employee_id == nil
                && normalizeExpenseName(current.category_name ?? "") == normalizeExpenseName(name)
                && round2(current.amount ?? 0) == round2(amount)
                && (current.is_paid == false) == unpaid && (current.note ?? "") == note
        }
        let desiredById = Dictionary(uniqueKeysWithValues: custom.map { ($0.id.lowercased(), $0) })
        var valid = true
        for (id, snapshot) in loadedCustomExpenses {
            guard let current = byId[id] else {
                // A preceding attempt may have deleted the row before a later write failed.
                if !desiredIds.contains(id) { continue }
                valid = false; break
            }
            let originalMatches = matches(current, snapshot.name, Double(parseExpenseCents(snapshot.amount) ?? 0) / 100,
                                          snapshot.unpaid, snapshot.note)
            let desiredMatches = desiredById[id].map { matches(current, $0.name, $0.amount, $0.unpaid, $0.note) } ?? false
            guard originalMatches || desiredMatches else { valid = false; break }
        }
        for current in customRows where !knownIds.contains(current.id.lowercased())
            && current.paid_shift_id == nil && current.category_id == nil && current.employee_id == nil
            && !normalizeExpenseName(current.category_name ?? "").isEmpty
            && !(current.note?.hasPrefix(Self.salperiodPrefix) ?? false) {
            // New local IDs may be present after a lost response. Unseen remote rows
            // require a reload so their amounts cannot be omitted from shift totals.
            guard desiredIds.contains(current.id.lowercased()), current.paid_shift_id == nil,
                  current.category_id == nil, current.employee_id == nil else { valid = false; break }
        }
        guard valid else {
            throw NSError(domain: "CustomExpense", code: 2,
                          userInfo: [NSLocalizedDescriptionKey: t("mg.customExpenseChanged")])
        }
        if !custom.isEmpty {
            try await DB.from("shift_expenses").upsert(custom.map { $0.values(restaurantId: rid, shiftId: shiftId) },
                                                       onConflict: "restaurant_id,id").run()
        }
        let removed = knownIds.subtracting(desiredIds)
        if !removed.isEmpty { try await DB.from("shift_expenses").delete().in("id", Array(removed)).run() }
        // Advance the ledger snapshot now: later template/shift failures remain retryable.
        loadedCustomExpenses = Dictionary(uniqueKeysWithValues: custom.map {
            ($0.id.lowercased(), CustomExpenseDraft(id: $0.id, name: $0.name, amount: String($0.amount), unpaid: $0.unpaid, note: $0.note))
        })
        return fresh
    }

    // Расходы: СНАЧАЛА вставить новые, удалить старые по id — ПОТОМ.
    // Старая схема delete→insert при обрыве сети между шагами молча стирала
    // все расходы смены. Если теперь упадёт delete — будут видимые дубли,
    // которые следующее успешное сохранение само подчистит (старые id уже собраны).
    private func persistExpenses(shiftId: String, unchangedSnapshot: [ShiftExpense]? = nil) async throws {
        // paid_shift_id != nil — строка управляется экраном «Долги» (Analytics), не формой
        // закрытия смены: удалять/пересоздавать её здесь нельзя (см. loadDay).
        // Удаляем только строки, которыми владеет форма (ShiftForm.swift) — по свежему чтению:
        // ЗП-долги и строки уволенных/выключенных категорий остаются нетронутыми (аудит 2026-09-27).
        let fresh: [ShiftExpense]
        if let unchangedSnapshot { fresh = unchangedSnapshot }
        else {
            fresh = try await DB.from("shift_expenses").fresh().select("id, employee_id, category_id, category_name, amount, note, is_paid, paid_shift_id, is_custom")
                .eq("shift_id", shiftId).order("created_at").order("id").list(ShiftExpense.self)
        }
        let oldIds = splitShiftExpenses(fresh, shiftId: shiftId,
                                        activeCategoryIds: Set(categories.map(\.id)),
                                        activeEmployeeIds: Set(employees.map(\.id))).ownedIds
        var catInserts: [[String: Any]] = []
        for cat in categories {
            let amt = num(catAmounts[cat.id] ?? "")
            if amt > 0 {
                catInserts.append(["shift_id": shiftId, "restaurant_id": rid, "category_id": cat.id,
                                   "category_name": cat.name, "amount": amt, "note": catNotes[cat.id] ?? "",
                                   "is_paid": catUnpaid[cat.id] != true])
            }
        }
        // Same ledger and schema: one insert for categories and employee extras.
        // A failed batch must still leave every prior owned row in place.
        var empInserts: [[String: Any]] = []
        for emp in employees {
            let extra = num(empExtras[emp.id] ?? "")
            if extra > 0 {
                empInserts.append(["shift_id": shiftId, "restaurant_id": rid, "employee_id": emp.id,
                                   "category_name": emp.name + " (экстра)", "amount": extra,
                                   "is_paid": empUnpaid[emp.id] != true])
            }
        }
        let inserts = catInserts + empInserts
        if !inserts.isEmpty { try await DB.from("shift_expenses").insert(inserts).run() }
        if !oldIds.isEmpty {
            try await DB.from("shift_expenses").delete().in("id", oldIds).run()
        }
    }

    // UPDATE по id вместо delete+insert (A2, аудит 2026-08-09) — раньше окно между delete и
    // insert теряло инкассацию при обрыве сети, а сам delete+insert затирал expense/reason
    // значениями, загруженными в форму ДО того как Analytics (addAdvance/settleDebt) успел
    // дописать туда свою правку. Delta-merge: переносим именно то, что поменял МЕНЕДЖЕР
    // (разницу между текущим полем формы и снэпшотом на момент loadDay), поверх АКТУАЛЬНОГО
    // значения в БД на момент сохранения — а не поверх устаревшего снэпшота.
    private func persistInkassation(shiftId: String, _ c: Calc) async throws {
        struct InkRow: Codable, Sendable { let id: String; let expense: Double?; let salary: Double?; let reason: String? }
        let current = try await DB.from("inkassations").select("id, expense, salary, reason")
            .eq("shift_id", shiftId).limit(1).list(InkRow.self).first

        let finalExpense = (current?.expense ?? 0) + (num(inkExpense) - num(loadedInkExpense))
        let currentReason = current?.reason ?? ""
        // Если ни менеджер, ни параллельная запись не трогали reason — берём как есть; если
        // менеджер сам не редактировал поле, а в БД оно уже другое — не затираем чужую правку.
        let finalReason = (currentReason == loadedInkReason || inkReason != loadedInkReason)
            ? inkReason : currentReason
        // salary — выплата ЗП из инкассации (ManagerSalary.markSalaryPaid): строка только с ней
        // (инкассация дня 0, расхода/причины нет) не «пустая» — иначе сохранение смены удаляло
        // её вместе со списанием (потеря €1100, Владимир, SO, 2026-09-14).
        let curSalary = current?.salary ?? 0
        let finalTotal = c.ink - finalExpense - curSalary

        guard c.ink > 0 || finalExpense != 0 || !finalReason.isEmpty || curSalary != 0 else {
            if let id = current?.id { try await DB.from("inkassations").delete().eq("id", id).run() }
            return
        }
        let values: [String: Any] = [
            "restaurant_id": rid, "date": key(currentDate),
            "amount": c.ink, "expense": finalExpense, "reason": finalReason, "total": finalTotal,
        ]
        if let id = current?.id {
            try await DB.from("inkassations").update(values).eq("id", id).run()
        } else {
            do {
                try await DB.from("inkassations").insert(values.merging(["shift_id": shiftId]) { a, _ in a }).run()
            } catch {
                // unique(shift_id): строку успели создать параллельно (выплата ЗП/аванс, другое
                // устройство) — переносим дельту менеджера поверх неё, второй строки не будет.
                guard let raced = try? await DB.from("inkassations").select("id, expense, salary, reason")
                    .eq("shift_id", shiftId).limit(1).list(InkRow.self).first else { throw error }
                let exp2 = (raced.expense ?? 0) + (num(inkExpense) - num(loadedInkExpense))
                var v2 = values
                v2["expense"] = exp2
                v2["total"] = c.ink - exp2 - (raced.salary ?? 0)
                try await DB.from("inkassations").update(v2).eq("id", raced.id).run()
            }
        }
    }

    // Погашение отмеченных долгов — прямо здесь, в текущей смене (не отдельным действием
    // в Analytics): 1) новая строка расхода датой ТЕКУЩЕЙ смены (считается в кассе/отчётах
    // именно сегодня) — вставляем ПЕРВОЙ, чтобы при сбое сети старый долг остался открытым
    // (видимо и безопасно), а не тихо потерялся; 2) исходная строка помечается «оплачено» —
    // статус для истории, paid_shift_id ≠ её собственный shift_id → навсегда исключена из
    // подсчёта своего родного дня (Analytics.countsInRollup).
    // Один RPC вместо 2-3 независимых запросов (MISE-002, аудит 2026-08-28): раньше сбой сети
    // между insert новой строки и update исходной оставлял систему в несогласованном
    // состоянии — settle_debts (docs/migrations/atomic-debt-settlement-2026-08.sql) делает
    // всё в одной транзакции. Тот же RPC, что и на вебе (app/manager/page.tsx). ЗП-долг
    // определяется по префиксу note (MISE-001, аудит 2026-08-28: iOS теперь тоже
    // материализует его через ManagerSalaryModel.syncLedger, той же строкой shift_expenses,
    // что и обычные expense-долги — так это уже видно здесь, без отдельного UI).
    private static let salperiodPrefix = "SALPERIOD:"
    private func persistDebtSettlements(shiftId: String) async throws {
        let ids = selectedDebtIds
        guard !ids.isEmpty else { return }
        let selected = selectableDebts.filter { ids.contains($0.id) }
        guard !selected.isEmpty else { return }
        let debts: [[String: Any]] = selected.map { d in
            let isSalary = d.employeeId != nil && (d.note?.hasPrefix(Self.salperiodPrefix) ?? false)
            var row: [String: Any] = [
                "id": d.id, "amount": d.amount,
                "category_id": d.categoryId ?? NSNull(), "category_name": d.categoryName,
                "employee_id": d.employeeId ?? NSNull(),
                "is_salary": isSalary,
                "expense_note": t("an.debtSettleNote") + " (\(d.date))",
            ]
            if isSalary {
                row["salary_period"] = String((d.note ?? "").dropFirst(Self.salperiodPrefix.count))
                row["salary_note"] = t("an.debtSettleNote")
            }
            return row
        }
        try await DB.rpc(
            "settle_debts",
            args: ["p_shift_id": shiftId, "p_date_str": key(currentDate), "p_debts": debts],
            cacheInvalidate: ["shift_expenses", "salary_payments"]
        )
    }

    // Параллельный вызов для той же смены (двойной тап, «Сохранить» + автосейв при смене даты)
    // присоединяется к уже идущему сохранению, а не запускает второе: два прогона читали один
    // и тот же набор старых расходов, оба вставляли новый — набор задваивался (аудит 2026-10-26).
    private var persistInFlight: (id: String, task: Task<Double?, Error>)?
    var customPersistenceBusy: Bool { persistInFlight != nil }

    @discardableResult
    private func persist() async throws -> Double? {
        guard let sh = shift else { return nil }
        if let cur = persistInFlight, cur.id == sh.id { return try await cur.task.value }
        let task = Task { try await self.persistOnce(sh) }
        persistInFlight = (sh.id, task)
        defer { if persistInFlight?.task == task { persistInFlight = nil } }
        return try await task.value
    }

    private func persistOnce(_ sh: Shift) async throws -> Double? {
        // Validate every custom row before debt settlement or any other financial write.
        let preparedCustom = try validatedCustomExpenses()
        // До любых записей: долг мог быть погашен/изменён с другого устройства.
        let chosenDebts = selectableDebts.filter { selectedDebtIds.contains($0.id) }
        if !chosenDebts.isEmpty {
            let fresh = try await DB.from("shift_expenses").fresh()
                .select("id, employee_id, category_id, category_name, amount, note, shift_id, is_paid, paid_shift_id")
                .in("id", chosenDebts.map(\.id)).list(ShiftExpense.self)
            if hasStaleDebt(chosenDebts.map { ($0.id, $0.amount) }, fresh: fresh, shiftId: sh.id) {
                selectedDebtIds = []
                await loadOpenDebts()
                throw NSError(domain: "DebtStale", code: 1, userInfo: [NSLocalizedDescriptionKey: t("mg.debtStale")])
            }
        }
        let selectedCustomIds = Set(preparedCustom.map(\.id)).intersection(selectedDebtIds)
        let c = calc
        // Custom writes can be rejected by settlement guards. Finish them before
        // updating the shift balance or starting the existing template save flow.
        let unchangedLedger = preparedCustom.isEmpty && loadedCustomExpenses.isEmpty && selectedDebtIds.isEmpty
        let preflight = try await persistCustomExpenses(shiftId: sh.id, custom: preparedCustom.filter { !selectedCustomIds.contains($0.id) })

        // Погашение долгов — ПЕРВЫМ и ОТДЕЛЬНО от остального (C3, аудит 2026-08-13/15): если
        // сам погашаемый долг был создан СЕГОДНЯ (shift_id == текущей смене), запуск параллельно
        // с persistExpenses создавал race — persistExpenses мог удалить ту же строку по своему
        // снэпшоту раньше, чем persistDebtSettlements успевал пометить её paid, и апдейт молча
        // терялся (деньги не страдали, но исторический маркер «оплачено» на исходной строке —
        // да). Settlement теперь всегда завершается ДО того как persistExpenses читает
        // oldExpenses — к этому моменту paid_shift_id на исходной строке уже проставлен, так что
        // persistExpenses естественным образом её не тронет (см. фильтр там же).
        try await persistDebtSettlements(shiftId: sh.id)

        // Смена/расходы/инкассация/прогулы трогают разные таблицы и не зависят друг от
        // друга — параллелим, чтобы не ждать round-trip'ы подряд. Порядок ВНУТРИ каждой
        // цепочки (например insert-перед-delete в расходах) не меняется.
        async let shiftUpdate: () = DB.from("shifts").update([
            "income": c.inc, "income_card": c.card, "inkassation": c.ink,
            "total_expense": c.totalExp, "closing_balance": c.balance,
        ]).eq("id", sh.id).run()
        // With no custom/debt mutations there has been no ledger write since preflight.
        // Mutation paths retain their fresh read AFTER settlement/custom writes.
        async let expensesResult: () = persistExpenses(shiftId: sh.id, unchangedSnapshot: unchangedLedger ? preflight : nil)
        async let inkResult: () = persistInkassation(shiftId: sh.id, c)
        // best-effort: подтвердить прогулы дня (привязать к смене, снять авто-черновик)
        async let absResult: Void = { _ = try? await DB.from("shift_absences").update(["shift_id": sh.id, "source": "manager"])
            .eq("date", key(currentDate)).run() }()

        try await shiftUpdate
        try await expensesResult
        try await inkResult
        await absResult
        autoAbsences = []
        customExpenses.removeAll { selectedCustomIds.contains($0.id) }
        if !selectedDebtIds.isEmpty {
            // A1 (аудит 2026-08-15): бампаем settledTodayTotal ДО очистки selectedDebtIds —
            // иначе calc на следующий рендер теряет только что погашенную сумму, баланс кассы
            // на экране на секунду показывает больше, чем реально сохранено в БД.
            settledTodayTotal += debtSettleTotal
            openDebts.removeAll { selectedDebtIds.contains($0.id) }
            selectedDebtIds = []
        }
        clearDraft(key(currentDate))
        return c.balance
    }

    // Мягкий гейт (не блокирует): если чек-лист закрытия смены на сегодня не пройден целиком,
    // спрашиваем подтверждение вместо тихого закрытия кассы (юзер-фидбек 2026-07-28).
    nonisolated struct CloseChecklistId: Codable, Sendable { let id: String }
    nonisolated struct ChecklistCompletionStatus: Codable, Sendable { let checklist_id: String?; let status: String? }
    func closeChecklistIncomplete() async -> Bool {
        guard let lists = try? await DB.from("shift_checklists").select("id")
            .eq("kind", "shift").eq("type", "close").list(CloseChecklistId.self), !lists.isEmpty else { return false }
        let ids = lists.map(\.id)
        let completions = (try? await DB.from("shift_checklist_completions").select("checklist_id, status")
            .eq("date", key(currentDate)).in("checklist_id", ids).list(ChecklistCompletionStatus.self)) ?? []
        return !ids.allSatisfy { id in completions.contains { $0.checklist_id == id && $0.status == "done" } }
    }

    func save(force: Bool = false) async {
        // saving ставим ДО первого await (аудит дублей 2026-10-26): раньше — после
        // closeChecklistIncomplete(), и второй тап во время этого запроса проходил, persist
        // выполнялся дважды — расходы смены и инкассация задваивались (SO, 25.10).
        guard shift != nil, !saving else { return }
        do { _ = try validatedCustomExpenses() } catch { flash(error.localizedDescription); return }
        saving = true
        defer { saving = false }
        if !force, await closeChecklistIncomplete() { showChecklistWarn = true; saving = false; return }
        // C8 (юзер-фидбок 2026-08-15) — мягкий гейт: панель долгов позволяет отметить сразу ВСЕ
        // открытые долги ресторана (любых дат), одним save может увести кассу глубоко в минус
        // без подтверждения. Обычные расходы это НЕ блокируют (существующее поведение — только
        // красный текст), но батч-погашение долгов достаточно рискованно, чтобы спросить лишний раз.
        if !force, debtSettleTotal > 0, calc.balance < 0 { showDebtNegativeWarn = true; saving = false; return }
        let closedDate = currentDate
        let closedTotals = calc
        let restaurantSession = UserDefaults.standard.data(forKey: "mise_restaurant")
        let staffSession = UserDefaults.standard.data(forKey: "mise_staff")
        do {
            try await persist()
            locked = true
            // Новая база для delta-merge (A2) — если в этой же сессии откроют смену на правку
            // ещё раз, дельта должна считаться от того, что менеджер сам только что сохранил.
            loadedInkExpense = inkExpense; loadedInkReason = inkReason
            ShiftReminder.cancel() // отменить напоминание — смена закрыта
            flash(t("mg.shiftSaved"))
            Task { @MainActor in
                await sendCloseNotification(closedTotals, date: closedDate,
                                            restaurantSession: restaurantSession, staffSession: staffSession)
            }
        } catch {
            flash(t("saveFailed", ["err": error.localizedDescription]))
        }
    }

    private func sendCloseNotification(_ c: Calc, date: Date, restaurantSession: Data?, staffSession: Data?) async {
        func sameSession() -> Bool {
            UserDefaults.standard.data(forKey: "mise_restaurant") == restaurantSession
                && UserDefaults.standard.data(forKey: "mise_staff") == staffSession
        }
        guard sameSession() else { return }
        // Дайджест дня: сводка в защищённом теле (показывается, если включён show_cash_amount).
        nonisolated struct HkSale: Codable, Sendable { let quantity: Double?; let price: Double?; let is_free: Bool? }
        var hk = "", paid = 0, rev = 0.0
        if let sales = try? await DB.from("hookah_sales").select("quantity, price, is_free, date")
            .eq("date", key(date)).list(HkSale.self) {
            paid = sales.filter { $0.is_free != true }.reduce(0) { $0 + Int($1.quantity ?? 0) }
            rev = sales.filter { $0.is_free != true }.reduce(0.0) { $0 + ($1.quantity ?? 0) * ($1.price ?? 0) }
            if paid > 0 { hk = " · \(t("mg.dHookah")) \(paid) (\(Money.s(rev)))" }
        }
        var digest = "\(t("mg.dRevenue")) \(Money.s(c.inc))"
        if c.card > 0 { digest += " + \(t("mg.dCard")) \(Money.s(c.card))" }
        digest += " · \(t("mg.dExpense")) \(Money.s(c.totalExp))"
        if c.ink > 0 { digest += " · \(t("mg.dCollection")) \(Money.s(c.ink))" }
        digest += " · \(t("mg.dCash")) \(Money.s(c.balance))" + hk

        var segs: [[String: String]] = [["key": "notify.dRevenue", "value": Money.s(c.inc)]]
        if c.card > 0 { segs.append(["key": "notify.dCard", "value": Money.s(c.card), "sep": " + "]) }
        segs.append(["key": "notify.dExpense", "value": Money.s(c.totalExp)])
        if c.ink > 0 { segs.append(["key": "notify.dCollection", "value": Money.s(c.ink)]) }
        segs.append(["key": "notify.dCash", "value": Money.s(c.balance)])
        if paid > 0 { segs.append(["key": "notify.dHookah", "value": "\(paid) (\(Money.s(rev)))"]) }

        // shift_date в data — тап по уведомлению открывает Analytics сразу на эту смену
        // (юзер-фидбек 2026-07-22), не просто модуль.
        guard sameSession() else { return }
        await Notify.send(type: "cash_close", title: t("mg.pushCashClosed"), body: t("mg.pushShiftClosed"),
                          audience: ["managers": true],
                          titleKey: "notify.cashCloseTitle", bodyKey: "notify.cashCloseBody",
                          bodyParams: ["date": dayMonth(date)],
                          secureBody: digest, secureBodySegments: segs,
                          data: ["module": "analytics", "shift_date": key(date)])
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
        inkSum = "1500"
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
            flash(t("ai.applied"))
        } catch {
            flash(aiErrorMessage(error))
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
                ManagerTabs(m: m, aiEnabled: app.aiEnabled)
                    .transition(.opacity)
            } else {
                ManagerSkeleton()
                    .transition(.opacity)
            }
        }
        .animation(.easeOut(duration: 0.3), value: m == nil)
        .task {
            if m == nil {
                let model = ManagerModel(rid: app.restaurant?.id ?? "", dayStartHour: app.dayStartHour)
                m = model
                await model.start()
            }
        }
    }
}

// Вкладки Manager (реструктура 2026-08-13). «Смена» = прежнее тело ManagerView без
// изменений в логике. Зарплата/Настройки/Дисциплина — заглушки, контент переезжает
// сюда из People отдельными блоками (см. docs/MANAGER-PEOPLE-RESTRUCTURE-2026-08-13.md).
private struct ManagerTabs: View {
    @Environment(AppModel.self) private var app
    @Bindable var m: ManagerModel
    let aiEnabled: Bool

    var body: some View {
        TabView(selection: $m.tab) {
            ManagerBody(m: m, aiEnabled: aiEnabled)
                .tabItem { Label(t("tab.shift"), systemImage: "cart.fill") }.tag("shift")
            AppTabPage { ManagerSalaryTab(rid: m.rid) }
                .tabItem { Label(t("tab.salary"), systemImage: "creditcard.fill") }.tag("salary")
            // Дисциплина перед Настройками (юзер-фидбок 2026-08-14) — шестерёнка по конвенции
            // всегда последняя вкладка, раньше была третьей из четырёх.
            NavigationStack { ManagerDisciplineTab(rid: m.rid).navigationTitle(t("tab.discipline")).navigationBarTitleDisplayMode(.inline) }
                .tabItem { Label(t("tab.discipline"), systemImage: "exclamationmark.shield.fill") }.tag("discipline")
            ManagerSettingsTab(rid: m.rid)
                .tabItem { Label(t("tab.settings"), systemImage: "gearshape.fill") }.tag("settings")
        }
        .tint(BrandKit.manager)
        .sensoryFeedback(.selection, trigger: m.tab)
        .tabEdgeSwipe(tabs: ["shift", "salary", "discipline", "settings"], selection: $m.tab,
                      onFirstBack: app.availableApps.count > 1 ? { app.backToLauncher() } : nil)
    }
}

private struct ManagerComingSoon: View {
    let title: String
    let icon: String
    var body: some View {
        VStack(spacing: 10) {
            Image(systemName: icon).font(.system(size: 34)).foregroundStyle(.secondary)
            Text(title).font(.system(size: 17, weight: .semibold))
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 80)
        .foregroundStyle(.secondary)
    }
}

private struct ManagerBody: View {
    @Bindable var m: ManagerModel
    let aiEnabled: Bool
    private let accent = BrandKit.manager
    @State private var showDatePicker = false
    @State private var showDebts = false
    @State private var newCustomExpenseId: String?
    @State private var customScrollTarget: String?
    @State private var customScrollRequest = 0
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        ZStack(alignment: .top) {
            Group {
                Color.miseBg.ignoresSafeArea()
                ScrollViewReader { proxy in
                ScrollView {
                    VStack(spacing: 14) {
                        dateRow
                        Group {
                            if m.loadError {
                                loadErrorState
                                    .transition(.opacity)
                            } else if m.shift == nil {
                                VStack(spacing: 24) {
                                    emptyState
                                    // Поступление можно внести и в день без смены (задним числом)
                                    InkTopupsCard(m: m.topups)
                                }
                                .transition(.opacity)
                            } else {
                                shiftBody
                                    .transition(.opacity.combined(with: .move(edge: .bottom)))
                            }
                        }
                        .animation(.spring(duration: 0.4, bounce: 0.08), value: m.shift == nil)
                        .animation(.easeInOut(duration: 0.25), value: m.loadError)
                    }
                    .disabled(m.saving || m.customPersistenceBusy)
                    .padding(16)
                    .padding(.bottom, 40)
                    .opacity(m.loading ? 0 : 1)
                    .offset(y: m.loading ? 18 : 0)
                    .animation(.spring(duration: 0.45, bounce: 0.1), value: m.loading)
                }
                .refreshable {
                    guard !m.saving, !m.customPersistenceBusy else { return }
                    await DB.clearCacheNow() // pull-to-refresh должен идти в сеть, не в кеш
                    await m.loadDay(m.currentDate)
                }
                .onChange(of: customScrollRequest) { _, _ in
                    guard let id = customScrollTarget else { return }
                    withAnimation(.easeOut(duration: 0.2)) { proxy.scrollTo(id, anchor: .top) }
                }
                }
            }
            // Spotlight-эффект под ИИ-чатом: слегка размываем реальный контент модуля,
            // а не показываем матовую панель поверх (см. AIButton.swift AIChat).
            .blur(radius: AIChat.shared.open ? 2 : 0)
            .animation(.easeInOut(duration: 0.25), value: AIChat.shared.open)

            if let toast = m.toast {
                Text(toast)
                    .font(.system(size: 14, weight: .semibold)).foregroundStyle(.primary)
                    .padding(.horizontal, 18).padding(.vertical, 12)
                    .background(.ultraThinMaterial, in: Capsule())
                    .padding(.bottom, 60)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }

            if aiEnabled {
                AIButton(module: "manager") { msg in await m.handleAI(msg) }
            }
        }
        .animation(.easeInOut(duration: 0.2), value: m.toast)
        .scrollDismissesKeyboard(.interactively)
        // Черновик формы — юзер-фидбок 2026-08-14: не терять вбитые, но не сохранённые
        // цифры при уходе в фон/убийстве приложения (см. ManagerModel.saveDraft).
        .onChange(of: scenePhase) { _, phase in if phase != .active { m.saveDraft() } }
    }

    // дата
    private var dateRow: some View {
        HStack(spacing: 12) {
            circleBtn("chevron.left") { Task { await m.changeDate(-1) } }
            Button { showDatePicker = true } label: {
                VStack(spacing: 2) {
                    HStack(spacing: 6) {
                        Text(displayDate(m.currentDate))
                            .font(.system(size: 17, weight: .bold)).foregroundStyle(.primary)
                        Image(systemName: "calendar").font(.system(size: 12)).foregroundStyle(.primary.opacity(0.4))
                    }
                    Text(dow(m.currentDate)).font(.system(size: 13, weight: .medium)).foregroundStyle(accent)
                }
            }
            .buttonStyle(.plain)
            .frame(maxWidth: .infinity)
            circleBtn("chevron.right") { Task { await m.changeDate(1) } }
        }
        .padding(14)
        .background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .sheet(isPresented: $showDatePicker) {
            NavigationStack {
                ZStack {
                    Color.miseBg.ignoresSafeArea()
                    DatePicker(t("an.date"), selection: Binding(get: { m.currentDate }, set: { d in Task { await m.setDate(d) } }),
                               displayedComponents: .date)
                        .datePickerStyle(.graphical).tint(accent).padding()
                }
                .navigationTitle(t("an.pickDay")).navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button(t("done")) { showDatePicker = false } } }
                .toolbarBackground(Color.miseBg, for: .navigationBar)
            }
            .presentationDetents([.medium])
        }
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

    private var loadErrorState: some View {
        VStack(spacing: 16) {
            ZStack {
                RoundedRectangle(cornerRadius: 22, style: .continuous).fill(Color.orange.opacity(0.14)).frame(width: 80, height: 80)
                Image(systemName: "wifi.exclamationmark").font(.system(size: 32, weight: .light)).foregroundStyle(.orange)
            }
            Text(t("loadFailed")).font(.system(size: 20, weight: .bold)).foregroundStyle(.primary)
            Button { Task { await m.loadDay(m.currentDate) } } label: {
                Text(t("retry")).font(.system(size: 16, weight: .bold)).foregroundStyle(.white)
                    .padding(.horizontal, 40).padding(.vertical, 16)
                    .background(accent, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            }
        }
        .padding(.top, 50)
    }

    @ViewBuilder private var shiftBody: some View {
        let c = m.calc
        // Закрытая смена: данные видно сквозь матовое стекло, поля заблокированы,
        // поверх — статус «Смена закрыта» и кнопка открыть на редактирование.
        ZStack(alignment: .top) {
            VStack(spacing: 14) {
              // Блок поступлений стоит между двумя «закрываемыми» группами и остаётся
              // доступным при закрытой смене: он не часть смены (свои записи, своя таблица).
              Group {
                staffSection
                if !m.selectableDebts.isEmpty {
                    debtsBadge
                }
                if !m.categories.isEmpty {
                    sectionTitle(t("mg.expenses"))
                    card {
                        ForEach(Array(m.categories.enumerated()), id: \.element.id) { i, cat in
                            HStack {
                                Text(cat.name).font(.system(size: 15)).foregroundStyle(.primary)
                                Spacer()
                                debtToggle(unpaidBinding(\.catUnpaid, cat.id))
                                amountField(binding(\.catAmounts, cat.id))
                            }
                            .padding(.vertical, 11).padding(.horizontal, 14)
                            if i < m.categories.count - 1 { divider }
                        }
                    }
                }
                customExpenseSection
                sectionTitle(t("mg.inkass"))
                card {
                    fieldRow(t("mg.inkSum"), text: $m.inkSum)
                    divider
                    fieldRow(t("mg.inkExpense"), text: $m.inkExpense)
                    divider
                    textRow(t("mg.inkReason"), text: $m.inkReason)
                }
              }
              .blur(radius: m.locked ? 3.5 : 0)
              .disabled(m.locked)
              .allowsHitTesting(!m.locked)

              InkTopupsCard(m: m.topups)

              Group {
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
            }

            if m.locked { closedOverlay }
        }
        if !m.locked { saveBar }
    }

    private var customExpenseSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            if !m.customExpenses.isEmpty {
                sectionTitle(t("mg.customExpenses"))
                card {
                    ForEach($m.customExpenses) { $row in
                        let rowId = row.id
                        CustomExpenseRow(row: $row, focusName: row.id == newCustomExpenseId,
                                         scope: "\(m.rid):\(m.key(m.currentDate))",
                                         reveal: { customScrollTarget = rowId; customScrollRequest += 1 },
                                         suggestions: { try await m.expenseNameSuggestions(prefix: $0) }) {
                            m.customExpenses.removeAll { $0.id == rowId }
                        }
                        .id(rowId)
                        if row.id != m.customExpenses.last?.id { divider }
                    }
                }
            }
            Button {
                let row = CustomExpenseDraft()
                m.customExpenses.append(row)
                newCustomExpenseId = row.id
            } label: {
                Label(t("mg.addExpense"), systemImage: "plus.circle.fill")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(accent)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .frame(minHeight: 44)
            }
            .buttonStyle(.plain)
            if let error = m.customExpenseError {
                Text(error).font(.system(size: 13)).foregroundStyle(.red)
                    .accessibilityIdentifier("custom-expense-error")
            }
        }
        .disabled(m.saving || m.customPersistenceBusy)
        .onChange(of: m.customExpenses) { _, _ in m.customExpenseError = nil }
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
                            debtToggle(unpaidBinding(\.empUnpaid, emp.id))
                            amountField(binding(\.empExtras, emp.id))
                        }
                        .padding(.vertical, 11).padding(.horizontal, 14)
                        if i < m.employees.count - 1 { divider }
                    }
                }
        }
    }

    // Долги (Б, 2026-08-09) — плашка со счётчиком между сотрудниками и категориями расходов.
    // Раскрывается в список ВСЕХ открытых долгов ресторана (любых дат), галочки отмечают, что
    // менеджер гасит сегодня — сумма сразу входит в c.debtTotal/расчёт кассы, никакой отдельной
    // кнопки «Погасить» нет: сохраняется вместе с обычным «Сохранить смену».
    @ViewBuilder private var debtsBadge: some View {
        VStack(spacing: 0) {
            Button { withAnimation(.easeInOut(duration: 0.18)) { showDebts.toggle() } } label: {
                HStack(spacing: 10) {
                    Image(systemName: "exclamationmark.circle.fill")
                        .font(.system(size: 16)).foregroundStyle(BrandKit.stash)
                    Text(t("an.debts")).font(.system(size: 15, weight: .medium)).foregroundStyle(.primary)
                    Text("\(m.selectableDebts.count)")
                        .font(.system(size: 12, weight: .bold)).foregroundStyle(.white)
                        .padding(.horizontal, 7).padding(.vertical, 2)
                        .background(BrandKit.stash, in: Capsule())
                    Spacer()
                    if m.debtSettleTotal > 0 {
                        Text("−" + money(m.debtSettleTotal)).font(.system(size: 13, weight: .semibold)).foregroundStyle(BrandKit.stash)
                    }
                    Image(systemName: showDebts ? "chevron.up" : "chevron.down")
                        .font(.system(size: 11)).foregroundStyle(.primary.opacity(0.4))
                }
                .padding(14)
            }
            .buttonStyle(.plain)
            if showDebts {
                ForEach(Array(m.selectableDebts.enumerated()), id: \.element.id) { i, d in
                    Button {
                        if m.selectedDebtIds.contains(d.id) { m.selectedDebtIds.remove(d.id) } else { m.selectedDebtIds.insert(d.id) }
                    } label: {
                        HStack(spacing: 10) {
                            Image(systemName: m.selectedDebtIds.contains(d.id) ? "checkmark.circle.fill" : "circle")
                                .font(.system(size: 18))
                                .foregroundStyle(m.selectedDebtIds.contains(d.id) ? BrandKit.stash : Color.primary.opacity(0.25))
                            VStack(alignment: .leading, spacing: 1) {
                                Text(d.categoryName).font(.system(size: 14, weight: .medium)).foregroundStyle(.primary)
                                Text(dayLabelRu(d.date)).font(.system(size: 11)).foregroundStyle(.primary.opacity(0.45))
                            }
                            Spacer()
                            Text(money(d.amount)).font(.system(size: 14, weight: .semibold)).foregroundStyle(BrandKit.stash)
                        }
                        .padding(.horizontal, 14).padding(.vertical, 10)
                    }
                    .buttonStyle(.plain)
                    if i < m.selectableDebts.count - 1 { divider }
                }
                .padding(.bottom, 8)
            }
        }
        .background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    private func summary(_ c: ManagerModel.Calc) -> some View {
        VStack(spacing: 0) {
            sumRow(t("mg.cashRevenue"), money(c.inc))
            // totalExp − ink: вкл. «прочие расходы дня» вне формы (ShiftForm.swift) — сумма сходится с кассой.
            sumRow(t("mg.expenses"), "−" + money(c.totalExp - c.ink).replacingOccurrences(of: "−", with: ""))
            sumRow(t("mg.cellInk"), money(c.ink))
            Divider().overlay(Color.primary.opacity(0.12)).padding(.vertical, 4)
            HStack {
                Text(t("mg.closingBalance")).font(.system(size: 16, weight: .bold)).foregroundStyle(.primary)
                Spacer()
                Text(money(c.balance)).font(.system(size: 20, weight: .heavy))
                    .foregroundStyle(c.balance < 0 ? .red : .green)
                    .lineLimit(1).minimumScaleFactor(0.7)
            }
            .padding(.top, 2)
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
        .confirmationDialog(t("mg.closeChecklistWarnTitle"), isPresented: Binding(get: { m.showChecklistWarn }, set: { m.showChecklistWarn = $0 }),
                             titleVisibility: .visible) {
            Button(t("mg.closeChecklistWarnAnyway"), role: .destructive) { Task { await m.save(force: true) } }
            Button(t("mg.closeChecklistWarnBack"), role: .cancel) {}
        } message: {
            Text(t("mg.closeChecklistWarnBody"))
        }
        .confirmationDialog(t("mg.debtNegativeWarnTitle"), isPresented: Binding(get: { m.showDebtNegativeWarn }, set: { m.showDebtNegativeWarn = $0 }),
                             titleVisibility: .visible) {
            Button(t("mg.debtNegativeWarnAnyway"), role: .destructive) { Task { await m.save(force: true) } }
            Button(t("mg.debtNegativeWarnBack"), role: .cancel) {}
        } message: {
            Text(t("mg.debtNegativeWarnBody", ["amount": money(m.calc.balance)]))
        }
    }

    // MARK: мелкие элементы

    private func binding(_ kp: ReferenceWritableKeyPath<ManagerModel, [String: String]>, _ id: String) -> Binding<String> {
        Binding(get: { m[keyPath: kp][id] ?? "" }, set: { m[keyPath: kp][id] = $0 })
    }

    private func unpaidBinding(_ kp: ReferenceWritableKeyPath<ManagerModel, [String: Bool]>, _ id: String) -> Binding<Bool> {
        Binding(get: { m[keyPath: kp][id] == true }, set: { m[keyPath: kp][id] = $0 ? true : nil })
    }

    // «В долг» (Б, 2026-08-09) — расход вписан, но наличных не хватило: не покидает кассу
    // сегодня, попадает в shift_expenses как is_paid=false с реальной датой.
    private func debtToggle(_ unpaid: Binding<Bool>) -> some View {
        Button { unpaid.wrappedValue.toggle() } label: {
            Image(systemName: unpaid.wrappedValue ? "exclamationmark.circle.fill" : "exclamationmark.circle")
                .font(.system(size: 18))
                .foregroundStyle(unpaid.wrappedValue ? BrandKit.stash : Color.primary.opacity(0.2))
        }
        .accessibilityLabel(t("mg.debtToggle"))
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
        TextField(Money.symbol + " 0", text: text)
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

private struct CustomExpenseRow: View {
    @Binding var row: CustomExpenseDraft
    let focusName: Bool
    let scope: String
    let reveal: () -> Void
    let suggestions: (String) async throws -> [String]
    let remove: () -> Void
    private enum Field: Hashable { case name, amount }
    @FocusState private var focused: Field?
    @State private var names: [String] = []
    @State private var suggestionsFailed = false
    private var query: String { "\(scope)|\(row.name)|\(focused == .name)" }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 8) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(t("mg.expenseName")).font(.system(size: 12)).foregroundStyle(.secondary)
                    TextField(t("mg.expenseName"), text: $row.name)
                        .font(.system(size: 15)).textInputAutocapitalization(.sentences)
                        .autocorrectionDisabled().focused($focused, equals: .name)
                        .submitLabel(.next).onSubmit { focused = .amount }
                        .accessibilityIdentifier("custom-expense-name")
                        .frame(minHeight: 34)
                }
                Button(role: .destructive, action: remove) {
                    Image(systemName: "trash").frame(width: 44, height: 44)
                }
                .accessibilityLabel(t("delete"))
            }
            if focused == .name, !names.isEmpty {
                ScrollView {
                VStack(spacing: 0) {
                    ForEach(names, id: \.self) { name in
                        Button {
                            row.name = name
                            names = []
                            focused = .amount
                        } label: {
                            Text(name).font(.system(size: 15)).foregroundStyle(.primary)
                                .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                                .padding(.horizontal, 10)
                        }
                        .buttonStyle(.plain)
                    }
                }
                }
                .frame(height: min(CGFloat(names.count) * 44, 176))
                .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 10))
            }
            if focused == .name, suggestionsFailed {
                Text(t("mg.expenseSuggestionsUnavailable"))
                    .font(.system(size: 12)).foregroundStyle(.secondary)
            }
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(t("mg.topupAmount")).font(.system(size: 12)).foregroundStyle(.secondary)
                    TextField(Money.symbol + " 0", text: $row.amount)
                        .keyboardType(.decimalPad).focused($focused, equals: .amount)
                        .font(.system(size: 15, weight: .semibold))
                        .padding(10).background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 10))
                        .accessibilityLabel(t("mg.topupAmount"))
                        .accessibilityIdentifier("custom-expense-amount")
                }
                Toggle(isOn: $row.unpaid) { Text(t("mg.expenseUnpaid")).font(.system(size: 14)) }
                    .toggleStyle(.button).tint(BrandKit.stash)
                    .accessibilityHint(t("mg.debtToggle"))
                    .frame(minHeight: 44)
            }
        }
        .padding(14)
        .task { if focusName { focused = .name } }
        .onChange(of: focused) { _, field in if field != nil { reveal() } }
        .task(id: query) {
            names = []; suggestionsFailed = false
            let prefix = normalizeExpenseName(row.name)
            guard focused == .name, !prefix.isEmpty else { return }
            do {
                try await Task.sleep(for: .milliseconds(300))
                let matches = try await suggestions(prefix)
                try Task.checkCancellation()
                names = matches
                if !matches.isEmpty { reveal() }
            } catch {
                if !Task.isCancelled { suggestionsFailed = true }
            }
        }
        .toolbar {
            if focused != nil {
                ToolbarItemGroup(placement: .keyboard) {
                    Spacer()
                    Button(t("done")) { focused = nil }
                }
            }
        }
    }
}

// MARK: - даты

// Кэшированные форматтеры (аллокация DateFormatter не бесплатна) — locale обновляется
// на каждый вызов (дёшево), т.к. может смениться при смене языка в настройках.
private let displayDateFormatter: DateFormatter = { let f = DateFormatter(); f.dateFormat = "d MMMM"; return f }()
private let dowFormatter: DateFormatter = { let f = DateFormatter(); f.dateFormat = "EEEE"; return f }()

private func displayDate(_ d: Date) -> String {
    displayDateFormatter.locale = appLocale()
    return displayDateFormatter.string(from: d)
}
private func dow(_ d: Date) -> String {
    dowFormatter.locale = appLocale()
    return dowFormatter.string(from: d).capitalized
}
