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
    }
    var openDebts: [DebtRow] = []
    var selectedDebtIds: Set<String> = []
    var debtSettleTotal: Double { openDebts.filter { selectedDebtIds.contains($0.id) }.reduce(0) { $0 + $1.amount } }
    // Сумма долгов, УЖЕ погашенных сегодняшней сменой (persistDebtSettlements вставляет строку
    // с paid_shift_id == shift_id самой этой смены) — loadDay исключает такие строки из
    // catAmounts/empExtras (см. ниже), поэтому без этого поля пересохранение того же дня
    // теряло сумму погашения из totalExp/closing_balance (A1, аудит 2026-08-13).
    var settledTodayTotal: Double = 0

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
    private var loadGen = 0       // поколение загрузки — защита от гонок при быстрой смене даты

    // Вкладки Manager (реструктура 2026-08-13): Смена/Зарплата/Настройки/Дисциплина.
    var tab = "shift"

    init(rid: String, dayStartHour: Int = 6) {
        self.rid = rid
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
        var catTotal = 0.0, empExtraTotal = 0.0, debtTotal = 0.0, totalExp = 0.0
        var opening = 0.0, balance = 0.0, inkNet = 0.0
    }

    var calc: Calc {
        var c = Calc()
        c.inc = num(income); c.card = num(incomeCard); c.ink = num(inkSum)
        // «В долг» — не покидал кассу сегодня, не входит в дневной расход/баланс.
        c.catTotal = categories.reduce(0) { catUnpaid[$1.id] == true ? $0 : $0 + num(catAmounts[$1.id] ?? "") }
        c.empExtraTotal = employees.reduce(0) { empUnpaid[$1.id] == true ? $0 : $0 + num(empExtras[$1.id] ?? "") }
        // Погашение отмеченных долгов — реальные наличные уходят из кассы ИМЕННО сегодня.
        // + уже погашенные сегодня в предыдущем save этого же дня (settledTodayTotal) — иначе
        // пересохранение дня теряет сумму погашения (A1, аудит 2026-08-13).
        c.debtTotal = debtSettleTotal + settledTodayTotal
        c.totalExp = c.catTotal + c.empExtraTotal + c.debtTotal + c.ink
        c.opening = shift?.opening_balance ?? 0
        c.balance = c.opening + c.inc - c.totalExp
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
        async let emps = (try? DB.from("employees").select("id,name,deduct_per_absence")
            .eq("is_active", true).order("name").list(Employee.self)) ?? []
        async let cats = (try? DB.from("expense_categories").select("id,name")
            .eq("is_active", true).order("name").list(Category.self)) ?? []
        employees = await emps
        categories = await cats
        await loadDay(currentDate)
        await loadOpenDebts()
    }

    func loadOpenDebts() async {
        nonisolated struct DebtExp: Codable, Sendable {
            let id: String; let shift_id: String?; let category_id: String?; let category_name: String?
            let employee_id: String?; let amount: Double?
        }
        guard let unpaid = try? await DB.from("shift_expenses")
            .select("id, shift_id, category_id, category_name, employee_id, amount")
            .eq("is_paid", false).list(DebtExp.self), !unpaid.isEmpty else { openDebts = []; return }
        let shiftIds = Array(Set(unpaid.compactMap { $0.shift_id }))
        nonisolated struct ShiftDateRow: Codable, Sendable { let id: String; let date: String }
        let shiftDates = (try? await DB.from("shifts").select("id, date").in("id", shiftIds).list(ShiftDateRow.self)) ?? []
        let dateById = Dictionary(uniqueKeysWithValues: shiftDates.map { ($0.id, $0.date) })
        openDebts = unpaid.compactMap { e -> DebtRow? in
            guard let sid = e.shift_id, let date = dateById[sid] else { return nil }
            return DebtRow(id: e.id, shiftId: sid, date: date, categoryId: e.category_id,
                categoryName: e.category_name ?? "—", employeeId: e.employee_id, amount: e.amount ?? 0)
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
        let opening = try? await openingTask

        // На случай дублей на одну дату (до миграции shifts-date-fix.sql) берём смену
        // с наибольшими данными, чтобы не показывать пустую/«открыть смену».
        let best = shifts.max { activity($0) < activity($1) } ?? shifts.first
        guard var sh = best else {
            shift = nil; locked = false
            income = ""; incomeCard = ""; inkSum = ""; inkExpense = ""; inkReason = ""
            loadedInkExpense = ""; loadedInkReason = ""
            catAmounts = [:]; catNotes = [:]; empExtras = [:]; absences = []; autoAbsences = []
            catUnpaid = [:]; empUnpaid = [:]; settledTodayTotal = 0
            return
        }
        if let opening { sh.opening_balance = opening }
        shift = sh
        locked = (sh.income ?? 0) > 0 || (sh.total_expense ?? 0) > 0 || (sh.inkassation ?? 0) > 0
        income = (sh.income ?? 0) > 0 ? trimNum(sh.income!) : ""
        incomeCard = (sh.income_card ?? 0) > 0 ? trimNum(sh.income_card!) : ""
        inkSum = (sh.inkassation ?? 0) > 0 ? trimNum(sh.inkassation!) : ""

        // Три независимых запроса — грузим параллельно, не друг за другом.
        // sh — var (мутируется чуть выше), поэтому фиксируем id в let до захвата в async let.
        let shId = sh.id
        async let expsTask = (try? await DB.from("shift_expenses").select().eq("shift_id", shId).list(ShiftExpense.self)) ?? []
        async let inksTask = (try? await DB.from("inkassations").select().eq("shift_id", shId).limit(1).list(Inkassation.self)) ?? []
        async let absencesTask: Void = loadAbsences(dateStr)

        let exps = await expsTask
        // Строки погашения долгов, вставленные ЭТОЙ же сменой (paid_shift_id == shId) —
        // исключены из формы ниже, но их сумма должна остаться в кассе дня при пересохранении.
        settledTodayTotal = exps.filter { $0.paid_shift_id == shId }.reduce(0.0) { $0 + ($1.amount ?? 0) }
        var amounts: [String: String] = [:], notes: [String: String] = [:], extras: [String: String] = [:]
        var catUn: [String: Bool] = [:], empUn: [String: Bool] = [:]
        for e in exps {
            // paid_shift_id != nil — строка прошла через погашение долга (Analytics→Долги):
            // либо это историческая запись «долг был здесь, погашен в другой день» (не должна
            // всплывать как редактируемое поле и не должна попасть под persistExpenses'
            // delete-цикл), либо сама запись погашения (считается в отчёте на день погашения,
            // а не здесь). Форма закрытия смены их не трогает вообще.
            guard e.paid_shift_id == nil else { continue }
            let unpaid = e.is_paid == false
            if let emp = e.employee_id {
                extras[emp] = trimNum(e.amount ?? 0)
                if unpaid { empUn[emp] = true }
            } else if let cat = e.category_id {
                amounts[cat] = trimNum(e.amount ?? 0); if let n = e.note, !n.isEmpty { notes[cat] = n }
                if unpaid { catUn[cat] = true }
            }
        }
        catAmounts = amounts; catNotes = notes; empExtras = extras
        catUnpaid = catUn; empUnpaid = empUn

        let inks = await inksTask
        await absencesTask
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

    private func loadAbsences(_ dateStr: String) async {
        nonisolated struct Abs: Codable { let employee_id: String?; let source: String? }
        let abs = (try? await DB.from("shift_absences").select().eq("date", dateStr).list(Abs.self)) ?? []
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
    }
    private func draftKey(_ dateStr: String) -> String { "mgDraft_\(rid)_\(dateStr)" }

    /// Вызывается при уходе экрана в фон (см. `.onChange(of: scenePhase)` в `ManagerBody`).
    func saveDraft() {
        guard shift != nil, !locked else { return }
        let d = Draft(income: income, incomeCard: incomeCard, inkSum: inkSum, inkExpense: inkExpense,
                      inkReason: inkReason, catAmounts: catAmounts, catNotes: catNotes, empExtras: empExtras,
                      catUnpaid: catUnpaid, empUnpaid: empUnpaid)
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
    }

    // MARK: действия

    func changeDate(_ dir: Int) async {
        if shift != nil && !locked {
            do { try await persist() } catch {
                flash(t("saveFailed", ["err": error.localizedDescription])); return
            }
        }
        currentDate = Calendar.current.date(byAdding: .day, value: dir, to: currentDate) ?? currentDate
        await loadDay(currentDate)
    }

    func setDate(_ d: Date) async {
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
        guard let sh = shift else { return }
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

    // Расходы: СНАЧАЛА вставить новые, удалить старые по id — ПОТОМ.
    // Старая схема delete→insert при обрыве сети между шагами молча стирала
    // все расходы смены. Если теперь упадёт delete — будут видимые дубли,
    // которые следующее успешное сохранение само подчистит (старые id уже собраны).
    private func persistExpenses(shiftId: String) async throws {
        // paid_shift_id != nil — строка управляется экраном «Долги» (Analytics), не формой
        // закрытия смены: удалять/пересоздавать её здесь нельзя (см. loadDay).
        let oldExpenses = try await DB.from("shift_expenses").select("id, paid_shift_id")
            .eq("shift_id", shiftId).list(ShiftExpense.self)
            .filter { $0.paid_shift_id == nil }
        var catInserts: [[String: Any]] = []
        for cat in categories {
            let amt = num(catAmounts[cat.id] ?? "")
            if amt > 0 {
                catInserts.append(["shift_id": shiftId, "restaurant_id": rid, "category_id": cat.id,
                                   "category_name": cat.name, "amount": amt, "note": catNotes[cat.id] ?? "",
                                   "is_paid": catUnpaid[cat.id] != true])
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
                empInserts.append(["shift_id": shiftId, "restaurant_id": rid, "employee_id": emp.id,
                                   "category_name": emp.name + " (экстра)", "amount": extra,
                                   "is_paid": empUnpaid[emp.id] != true])
            }
        }
        if !empInserts.isEmpty { try? await DB.from("shift_expenses").insert(empInserts).run() }
        if !oldExpenses.isEmpty {
            try await DB.from("shift_expenses").delete().in("id", oldExpenses.map(\.id)).run()
        }
    }

    // UPDATE по id вместо delete+insert (A2, аудит 2026-08-09) — раньше окно между delete и
    // insert теряло инкассацию при обрыве сети, а сам delete+insert затирал expense/reason
    // значениями, загруженными в форму ДО того как Analytics (addAdvance/settleDebt) успел
    // дописать туда свою правку. Delta-merge: переносим именно то, что поменял МЕНЕДЖЕР
    // (разницу между текущим полем формы и снэпшотом на момент loadDay), поверх АКТУАЛЬНОГО
    // значения в БД на момент сохранения — а не поверх устаревшего снэпшота.
    private func persistInkassation(shiftId: String, _ c: Calc) async throws {
        struct InkRow: Codable, Sendable { let id: String; let expense: Double?; let reason: String? }
        let current = try await DB.from("inkassations").select("id, expense, reason")
            .eq("shift_id", shiftId).limit(1).list(InkRow.self).first

        let finalExpense = (current?.expense ?? 0) + (num(inkExpense) - num(loadedInkExpense))
        let currentReason = current?.reason ?? ""
        // Если ни менеджер, ни параллельная запись не трогали reason — берём как есть; если
        // менеджер сам не редактировал поле, а в БД оно уже другое — не затираем чужую правку.
        let finalReason = (currentReason == loadedInkReason || inkReason != loadedInkReason)
            ? inkReason : currentReason
        let finalTotal = c.ink - finalExpense

        guard c.ink > 0 || finalExpense != 0 || !finalReason.isEmpty else {
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
            try await DB.from("inkassations").insert(values.merging(["shift_id": shiftId]) { a, _ in a }).run()
        }
    }

    // Погашение отмеченных долгов — прямо здесь, в текущей смене (не отдельным действием
    // в Analytics): 1) новая строка расхода датой ТЕКУЩЕЙ смены (считается в кассе/отчётах
    // именно сегодня) — вставляем ПЕРВОЙ, чтобы при сбое сети старый долг остался открытым
    // (видимо и безопасно), а не тихо потерялся; 2) исходная строка помечается «оплачено» —
    // статус для истории, paid_shift_id ≠ её собственный shift_id → навсегда исключена из
    // подсчёта своего родного дня (Analytics.countsInRollup).
    private func persistDebtSettlements(shiftId: String) async throws {
        let ids = selectedDebtIds
        guard !ids.isEmpty else { return }
        let selected = openDebts.filter { ids.contains($0.id) }
        guard !selected.isEmpty else { return }
        let newRows: [[String: Any]] = selected.map { d in
            var row: [String: Any] = [
                "shift_id": shiftId, "restaurant_id": rid, "amount": d.amount,
                "category_name": d.categoryName, "is_paid": true, "paid_shift_id": shiftId,
                "note": t("an.debtSettleNote") + " (\(d.date))",
            ]
            if let cid = d.categoryId { row["category_id"] = cid }
            if let eid = d.employeeId { row["employee_id"] = eid }
            return row
        }
        try await DB.from("shift_expenses").insert(newRows).run()
        try await DB.from("shift_expenses").update([
            "is_paid": true, "paid_at": key(currentDate), "paid_shift_id": shiftId,
        ] as [String: Any]).in("id", Array(ids)).run()
    }

    @discardableResult
    private func persist() async throws -> Double? {
        guard let sh = shift else { return nil }
        let c = calc

        // Смена/расходы/инкассация/прогулы трогают разные таблицы и не зависят друг от
        // друга — параллелим, чтобы не ждать 7 сетевых round-trip'ов подряд. Порядок
        // ВНУТРИ каждой цепочки (например insert-перед-delete в расходах) не меняется.
        async let shiftUpdate: () = DB.from("shifts").update([
            "income": c.inc, "income_card": c.card, "inkassation": c.ink,
            "total_expense": c.totalExp, "closing_balance": c.balance,
        ]).eq("id", sh.id).run()
        async let expensesResult: () = persistExpenses(shiftId: sh.id)
        async let inkResult: () = persistInkassation(shiftId: sh.id, c)
        async let debtResult: () = persistDebtSettlements(shiftId: sh.id)
        // best-effort: подтвердить прогулы дня (привязать к смене, снять авто-черновик)
        async let absResult: Void = { _ = try? await DB.from("shift_absences").update(["shift_id": sh.id, "source": "manager"])
            .eq("date", key(currentDate)).run() }()

        try await shiftUpdate
        try await expensesResult
        try await inkResult
        try await debtResult
        await absResult
        autoAbsences = []
        if !selectedDebtIds.isEmpty {
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
        guard shift != nil else { return }
        if !force, await closeChecklistIncomplete() { showChecklistWarn = true; return }
        saving = true
        do {
            try await persist()
            locked = true
            // Новая база для delta-merge (A2) — если в этой же сессии откроют смену на правку
            // ещё раз, дельта должна считаться от того, что менеджер сам только что сохранил.
            loadedInkExpense = inkExpense; loadedInkReason = inkReason
            ShiftReminder.cancel() // отменить напоминание — смена закрыта
            flash(t("mg.shiftSaved"))
            let c = calc
            // Дайджест дня: сводка в защищённом теле (показывается, если включён show_cash_amount).
            nonisolated struct HkSale: Codable, Sendable { let quantity: Double?; let price: Double?; let is_free: Bool? }
            var hk = "", paid = 0, rev = 0.0
            if let sales = try? await DB.from("hookah_sales").select("quantity, price, is_free, date")
                .eq("date", key(currentDate)).list(HkSale.self) {
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
            await Notify.send(type: "cash_close", title: t("mg.pushCashClosed"), body: t("mg.pushShiftClosed"),
                              audience: ["managers": true],
                              titleKey: "notify.cashCloseTitle", bodyKey: "notify.cashCloseBody",
                              bodyParams: ["date": dayMonth(currentDate)],
                              secureBody: digest, secureBodySegments: segs,
                              data: ["module": "analytics", "shift_date": key(currentDate)])
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
            ManagerSettingsTab(rid: m.rid)
                .tabItem { Label(t("tab.settings"), systemImage: "gearshape.fill") }.tag("settings")
            NavigationStack { ManagerDisciplineTab(rid: m.rid).navigationTitle(t("tab.discipline")) }
                .tabItem { Label(t("tab.discipline"), systemImage: "exclamationmark.shield.fill") }.tag("discipline")
        }
        .tint(BrandKit.manager)
        .sensoryFeedback(.selection, trigger: m.tab)
        .tabEdgeSwipe(tabs: ["shift", "salary", "settings", "discipline"], selection: $m.tab,
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
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        ZStack(alignment: .top) {
            Group {
                Color.miseBg.ignoresSafeArea()
                ScrollView {
                    VStack(spacing: 14) {
                        dateRow
                        Group {
                            if m.loadError {
                                loadErrorState
                                    .transition(.opacity)
                            } else if m.shift == nil {
                                emptyState
                                    .transition(.opacity)
                            } else {
                                shiftBody
                                    .transition(.opacity.combined(with: .move(edge: .bottom)))
                            }
                        }
                        .animation(.spring(duration: 0.4, bounce: 0.08), value: m.shift == nil)
                        .animation(.easeInOut(duration: 0.25), value: m.loadError)
                    }
                    .padding(16)
                    .padding(.bottom, 40)
                    .opacity(m.loading ? 0 : 1)
                    .offset(y: m.loading ? 18 : 0)
                    .animation(.spring(duration: 0.45, bounce: 0.1), value: m.loading)
                }
                .refreshable {
                    await DB.clearCacheNow() // pull-to-refresh должен идти в сеть, не в кеш
                    await m.loadDay(m.currentDate)
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
                staffSection
                if !m.openDebts.isEmpty {
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
                sectionTitle(t("mg.inkass"))
                card {
                    fieldRow(t("mg.inkSum"), text: $m.inkSum)
                    divider
                    fieldRow(t("mg.inkExpense"), text: $m.inkExpense)
                    divider
                    textRow(t("mg.inkReason"), text: $m.inkReason)
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
                    Text("\(m.openDebts.count)")
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
                ForEach(Array(m.openDebts.enumerated()), id: \.element.id) { i, d in
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
                    if i < m.openDebts.count - 1 { divider }
                }
                .padding(.bottom, 8)
            }
        }
        .background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    private func summary(_ c: ManagerModel.Calc) -> some View {
        VStack(spacing: 0) {
            sumRow(t("mg.cashRevenue"), money(c.inc))
            sumRow(t("mg.expenses"), "−" + money(c.catTotal + c.empExtraTotal + c.debtTotal).replacingOccurrences(of: "−", with: ""))
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
