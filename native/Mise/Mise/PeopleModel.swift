import SwiftUI
import CoreLocation
import UIKit
// Модель People + общие хелперы модуля (статусы, приоритеты, форматтеры)
// Распил PeopleView.swift (Д2, 2026-07-18): секция вынесена без изменений логики.

// MARK: - Модель People (логика app/people/page.tsx)

@MainActor
@Observable
final class PeopleModel {
    let rid: String
    let myId: String
    let myName: String
    let isManager: Bool
    let myRole: String?
    var tab = "shifts"
    var toast: String?

    // задачи
    var tasks: [StaffTask] = []
    var dir: [StaffDir] = []
    var tasksLoaded = false
    var tasksSeg = "tasks" // tasks | reports
    var speech = SpeechManager()

    // заявки менеджеру (предложение / заказать / поломка)
    var reports: [StaffReport] = []
    var reportsLoaded = false

    // зарплата
    var salaryRows: [SalRow] = []
    var salaryLoaded = false

    // расписание
    var schedules: [Schedule] = []
    var schedLoaded = false
    var shiftsView = "shifts" // shifts | swaps
    var calendarMonth: Date = {
        Calendar.current.date(from: Calendar.current.dateComponents([.year, .month], from: Date())) ?? Date()
    }()
    var selectedCalDate: String? = nil

    // явка
    var attendance: [AttendanceRecord] = []
    var geo: GeoSettings?
    var attLoaded = false
    var checking = false
    var todayScheduledIds: Set<String> = []
    /// true — есть отложенная явка (сеть не работала при отметке)
    var pendingCheckIn = false

    // обмены
    var swaps: [SwapRequest] = []
    var swapScheds: [Schedule] = []
    var swapsLoaded = false
    var swapSeg = "incoming"

    // чек-листы
    var checklists: [ShiftChecklist] = []
    var completions: [ChecklistCompletion] = []
    var checklistsLoaded = false
    var checklistsSubTab = "shift" // shift | audits | walk | stats — вынесено из ChecklistsTab
                                    // ради маршрутизации из уведомлений (AppModel.PeopleRoute)
    var clType = "open"
    var openShiftId: String?           // id открытой смены Manager на сегодня (чек-лист привязан к ней)
    var clHistory: [ChecklistCompletion] = []
    var clHistoryLoaded = false

    // аудиты (разовые проверки, kind="audit" в тех же таблицах)
    var audits: [ShiftChecklist] = []
    var auditRuns: [ChecklistCompletion] = []
    var auditsLoaded = false

    // восьмёрка (обход-восьмёрка, kind="walk" в тех же таблицах)
    var walkTemplates: [WalkTemplate] = []
    var walkRuns: [WalkRun] = []
    var walksLoaded = false

    // техкарты
    var techCards: [TechCard] = []
    var techLoaded = false
    var canTech: Bool { isManager || myRole == "kitchen" || myRole == "bar" }

    // зал: стоп-лист + заказы
    var menu: [MenuItem] = []
    var menuLoaded = false
    var opsView = "stop"
    var orders: [MenuOrder] = []
    var ordersLoaded = false
    var ordersSeg = "active"

    // закуп
    var purchase: [PurchaseItem] = []
    var purchaseLoaded = false
    var purchaseSeg = "todo" // todo | done

    // дисциплина (история опозданий)
    var discRecords: [AttendanceRecord] = []
    var discGrace = 5
    var discLoaded = false
    var discPeriod = "thisMonth" // thisMonth | lastMonth | 30d | 90d
    var discSel: String? = nil

    init(rid: String, myId: String, myName: String, isManager: Bool, myRole: String?) {
        self.rid = rid; self.myId = myId; self.myName = myName; self.isManager = isManager; self.myRole = myRole
    }

    private let df: DateFormatter = {
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.locale = Locale(identifier: "en_US_POSIX"); return f
    }()
    func key(_ d: Date) -> String { df.string(from: d) }

    var canStop: Bool { isManager || myRole == "kitchen" }

    // MARK: задачи

    func loadTasks() async {
        #if DEBUG
        if ProcessInfo.processInfo.environment["MISE_DEMO_UI"] == "1" { seedTasks(); return }
        #endif
        // Лимит на растущую таблицу (ревью Д1) — как на вебе.
        async let tkR = try? DB.from("staff_tasks").select().order("created_at", ascending: false).limit(200).list(StaffTask.self)
        async let dR = try? DB.from("staff_directory").select().eq("is_active", true).order("name").list(StaffDir.self)
        let tkO = await tkR, dO = await dR
        if let tk = tkO { tasks = tk } else if !tasks.isEmpty { flash(t("refreshFailed")) }
        if let d = dO { dir = d }
        tasksLoaded = true
    }
    func staffName(_ id: String?) -> String { dir.first { $0.id == id }?.name ?? "—" }
    var visibleTasks: [StaffTask] {
        isManager ? tasks : tasks.filter { $0.assigned_to == myId || $0.created_by == myId }
    }
    func tasks(_ status: String) -> [StaffTask] { visibleTasks.filter { ($0.status ?? "todo") == status } }

    func setStatus(_ task: StaffTask, _ status: String) async {
        if let i = tasks.firstIndex(where: { $0.id == task.id }) { tasks[i].status = status }
        let completed: Any = status == "done" ? ISO8601DateFormatter().string(from: Date()) : NSNull()
        do {
            try await DB.from("staff_tasks").update(["status": status, "completed_at": completed]).eq("id", task.id).run()
        } catch { flash(t("saveFailed", ["err": error.localizedDescription])); await loadTasks() }
    }
    func removeTask(_ id: String) async {
        tasks.removeAll { $0.id == id }
        do {
            try await DB.from("staff_tasks").delete().eq("id", id).run()
        } catch { flash(t("saveFailed", ["err": error.localizedDescription])); await loadTasks() }
    }
    func canDelete(_ t: StaffTask) -> Bool { isManager || t.created_by == myId }

    /// Дедуп нарушений (паттерн SafetyCulture Actions): если по этому же пункту уже есть
    /// открытая задача — предложить открыть её, а не плодить дубль.
    func openTaskFor(itemLabel: String) -> StaffTask? {
        tasks.first { $0.source_item_label == itemLabel && ($0.status ?? "todo") != "done" }
    }

    func createTask(title: String, desc: String, assignee: String, priority: String, due: String,
                     sourceCompletionId: String? = nil, sourceItemLabel: String? = nil, photoURL: String? = nil) async -> Bool {
        guard !title.trimmingCharacters(in: .whitespaces).isEmpty, !assignee.isEmpty else { flash(t("pe.taskNeedTitle")); return false }
        var base: [String: Any] = [
            "restaurant_id": rid, "title": title, "priority": priority, "status": "todo",
            "created_by": myId == "owner" ? NSNull() : myId,
        ]
        if !desc.isEmpty { base["description"] = desc }
        if !due.isEmpty { base["due_date"] = due }
        if let sourceCompletionId { base["source_completion_id"] = sourceCompletionId }
        if let sourceItemLabel { base["source_item_label"] = sourceItemLabel }
        if let photoURL { base["photo_url"] = photoURL }
        var targets = [assignee]
        if assignee.hasPrefix("role:") {
            let role = String(assignee.dropFirst(5))
            targets = dir.filter { $0.role == role }.map(\.id)
            if targets.isEmpty { flash(t("pe.noRoleStaff")); return false }
        }
        var failed = 0, lastError: Error?
        for tid in targets {
            var v = base; v["assigned_to"] = tid
            do {
                try await DB.from("staff_tasks").insert(v).run()
                if tid != myId {
                    await Notify.send(type: "task", title: t("pe.newTask"), body: title, audience: ["staff_ids": [tid]], titleKey: "notify.newTaskTitle")
                }
            } catch { failed += 1; lastError = error }
        }
        if failed == targets.count, let lastError {
            flash(t("saveFailed", ["err": lastError.localizedDescription]))
        } else {
            flash(targets.count > 1 ? t("pe.taskCreatedN", ["n": "\(targets.count)"]) : t("pe.taskCreated"))
        }
        await loadTasks()
        return true
    }

    /// Голосовое создание задачи: распознаёт речь → создаёт задачу.
    func voiceTask() async {
        guard await speech.start() else {
            flash(t("pe.voiceUnavailable")); return
        }
        // Ждём 4 секунды распознавания
        try? await Task.sleep(nanoseconds: 4_000_000_000)
        let text = speech.stop()
        guard !text.isEmpty else { flash(t("pe.voiceEmpty")); return }
        // Парсим: "Задача: помыть кальянную" → title = "Помыть кальянную"
        let title: String
        if text.lowercased().hasPrefix("задача") || text.lowercased().hasPrefix("task") {
            title = String(text.dropFirst(6)).trimmingCharacters(in: .whitespacesAndNewlines)
                .trimmingCharacters(in: CharacterSet(charactersIn: ":"))
                .trimmingCharacters(in: .whitespacesAndNewlines)
        } else {
            title = text
        }
        // Назначаем на первого сотрудника (или себя)
        let assignee = dir.first?.id ?? myId
        _ = await createTask(title: title, desc: "", assignee: assignee, priority: "normal", due: "")
    }

    // MARK: заявки менеджеру

    func loadReports() async {
        #if DEBUG
        if ProcessInfo.processInfo.environment["MISE_DEMO_UI"] == "1" { seedReports(); return }
        #endif
        if let r = try? await DB.from("staff_reports").select().order("created_at", ascending: false).limit(100).list(StaffReport.self) {
            reports = r
        }
        if dir.isEmpty { dir = (try? await DB.from("staff_directory").select().eq("is_active", true).order("name").list(StaffDir.self)) ?? [] }
        reportsLoaded = true
    }
    /// Видимость: менеджер/владелец видит все; сотрудник — только свои.
    var visibleReports: [StaffReport] {
        isManager ? reports : reports.filter { $0.author_id == myId }
    }
    var newReportsCount: Int { isManager ? reports.filter { ($0.status ?? "new") == "new" }.count : 0 }

    func createReport(type: String, title: String, desc: String) async -> Bool {
        guard !title.trimmingCharacters(in: .whitespaces).isEmpty else { flash(t("pe.reportNeedTitle")); return false }
        var v: [String: Any] = [
            "restaurant_id": rid, "type": type, "title": title, "status": "new",
            "author_id": myId == "owner" || myId.isEmpty ? NSNull() : myId,
        ]
        if !desc.isEmpty { v["description"] = desc }
        do {
            try await DB.from("staff_reports").insert(v).run()
        } catch { flash(t("saveFailed", ["err": error.localizedDescription])); return false }
        flash(t("pe.reportSent"))
        await loadReports()
        return true
    }
    func setReportStatus(_ r: StaffReport, _ status: String) async {
        if let i = reports.firstIndex(where: { $0.id == r.id }) { reports[i].status = status }
        let resolvedAt: Any = status == "resolved" ? ISO8601DateFormatter().string(from: Date()) : NSNull()
        do {
            try await DB.from("staff_reports").update(["status": status, "resolved_at": resolvedAt]).eq("id", r.id).run()
        } catch { flash(t("saveFailed", ["err": error.localizedDescription])); await loadReports() }
    }
    func deleteReport(_ id: String) async {
        reports.removeAll { $0.id == id }
        do {
            try await DB.from("staff_reports").delete().eq("id", id).run()
        } catch { flash(t("saveFailed", ["err": error.localizedDescription])); await loadReports() }
    }
    func canDeleteReport(_ r: StaffReport) -> Bool { isManager || r.author_id == myId }

    // MARK: зарплата

    struct SalRow: Identifiable {
        let id: String; let name: String; let salary: Double; let absences: Int
        let absenceList: [String]  // absence dates for display
        let deduct: Double; let card: Double; let advance: Double
        let advanceList: [SalaryAdvance]; let total: Double; let cash: Double
        var paid: Double = 0; var remaining: Double = 0; var lastPaidAt: String? = nil
    }

    var salaryViewMonth: Date = Date()
    var salaryDebtTotal: Double = 0
    var salaryDebtByEmp: [String: Double] = [:]
    var salaryPayoutDay: Int? = nil

    var salaryIsCurrentMonth: Bool { Calendar.current.isDate(salaryViewMonth, equalTo: Date(), toGranularity: .month) }

    func changeSalaryMonth(_ dir: Int) {
        if dir > 0 && salaryIsCurrentMonth { return }
        guard let d = Calendar.current.date(byAdding: .month, value: dir, to: salaryViewMonth) else { return }
        salaryViewMonth = d
        Task { await loadSalary() }
    }

    // Расчёт зарплаты за произвольный месяц — канон расчёта решение 2026-07-17, долг/выплаты
    // добавлены 2026-07-28 (salary_payments — факт фактической выдачи, отдельно от авансов
    // и от monthly_card_amounts, который не трогаем — юзер вводит его сам помесячно).
    private func computeSalary(monthOf date: Date) async -> [SalRow] {
        let cal = Calendar.current
        let ym = String(key(date).prefix(7))
        let monthStart = cal.date(from: cal.dateComponents([.year, .month], from: date)) ?? date
        // ym+"-31" в 30-дневных месяцах — невалидная дата для колонки типа date (400 → записи
        // молча пропадали). Считаем реальный конец месяца.
        let monthEnd = cal.date(byAdding: DateComponents(month: 1, day: -1), to: monthStart) ?? monthStart
        async let empsR = try? DB.from("employees").select("id, name, salary, deduct_per_absence").eq("is_active", true).order("name").list(Employee.self)
        async let absR = try? DB.from("shift_absences").select("employee_id, date, source").gte("date", ym + "-01").lte("date", key(monthEnd)).list(Absence.self)
        async let cardsR = try? DB.from("monthly_card_amounts").select("employee_id, card_amount").eq("month", ym).list(CardAmount.self)
        async let advR = try? DB.from("salary_advances").select().gte("date", ym + "-01").lte("date", key(monthEnd)).list(SalaryAdvance.self)
        async let paysR = try? DB.from("salary_payments").select().eq("period", ym + "-01").list(SalaryPayment.self)
        guard let employees = await empsR else { return [] }
        let absences = (await absR) ?? [], cardAmounts = (await cardsR) ?? []
        let advances = (await advR) ?? [], payments = (await paysR) ?? []

        return employees.map { e -> SalRow in
            let absForEmp = absences.filter { $0.employee_id == e.id && $0.source != "auto" }
            let absN = absForEmp.count
            let absenceList = absForEmp.compactMap { $0.date }.sorted()
            let deduct = Double(absN) * (e.deduct_per_absence ?? 0)
            // Строго помесячно: сумма «на карту» берётся из monthly_card_amounts за этот
            // месяц; без записи — 0 (без fallback на employees.card_amount, иначе одно
            // значение «прилипало» ко всем месяцам).
            let card = cardAmounts.first { $0.employee_id == e.id }?.card_amount ?? 0
            let advForEmp = advances.filter { $0.employee_id == e.id }
            let advance = advForEmp.reduce(0) { $0 + ($1.amount ?? 0) }
            let paysForEmp = payments.filter { $0.employee_id == e.id }
            let paid = paysForEmp.reduce(0) { $0 + ($1.amount ?? 0) }
            let lastPaidAt = paysForEmp.compactMap { $0.paid_at }.max()
            let total = max(0, (e.salary ?? 0) - deduct)
            let cash = max(0, total - advance - card)
            let remaining = max(0, cash - paid)
            return SalRow(id: e.id, name: e.name, salary: e.salary ?? 0, absences: absN, absenceList: absenceList, deduct: deduct, card: card, advance: advance, advanceList: advForEmp, total: total, cash: cash, paid: paid, remaining: remaining, lastPaidAt: lastPaidAt)
        }
    }

    func loadSalary() async {
        #if DEBUG
        if ProcessInfo.processInfo.environment["MISE_DEMO_UI"] == "1" { seedSalary(); return }
        #endif
        if salaryPayoutDay == nil {
            salaryPayoutDay = (try? await DB.from("restaurant_settings").select("salary_payout_day").limit(1).list(PayoutDayRow.self))?.first?.salary_payout_day
        }
        var list = await computeSalary(monthOf: salaryViewMonth)
        if !isManager { list = list.filter { $0.name == myName } }
        salaryRows = list; salaryLoaded = true
    }
    var salaryFund: Double { salaryRows.reduce(0) { $0 + $1.total } }
    // Буфер до реального дня выплаты (salary_payout_day, ЗП-долг 2026-07-28): ЗП за месяц
    // выдаётся 10-15 числа СЛЕДУЮЩЕГО месяца, поэтому 100% начисления должно достигаться не
    // в конце текущего месяца, а на payout_day следующего.
    var salaryAccruedToday: Double {
        guard salaryIsCurrentMonth else { return salaryFund }
        let cal = Calendar.current
        let day = cal.component(.day, from: Date())
        let daysInMonth = cal.range(of: .day, in: .month, for: salaryViewMonth)?.count ?? 30
        let denom = salaryPayoutDay.map { daysInMonth + $0 } ?? daysInMonth
        return salaryFund * Double(min(day, denom)) / Double(denom)
    }

    // Задолженность = сумма непокрытого остатка по всем ЗАКРЫТЫМ месяцам (строго раньше
    // текущего), окно 6 месяцев назад (дальше пересчёт дороже — 5 запросов на месяц).
    func loadSalaryDebt() async {
        guard isManager else { return }
        var total = 0.0; var byEmp: [String: Double] = [:]
        for i in 1...6 {
            guard let d = Calendar.current.date(byAdding: .month, value: -i, to: Date()) else { continue }
            let list = await computeSalary(monthOf: d)
            for r in list where r.remaining > 0 {
                total += r.remaining
                byEmp[r.id, default: 0] += r.remaining
            }
        }
        salaryDebtTotal = total; salaryDebtByEmp = byEmp
    }

    func markSalaryPaid(employeeId: String, amount: Double, method: String, date: Date, note: String) async {
        guard amount > 0 else { return }
        let period = String(key(salaryViewMonth).prefix(7)) + "-01"
        let paidAt = ISO8601DateFormatter().string(from: date)
        let noteVal: Any = note.isEmpty ? NSNull() : note
        do {
            try await DB.from("salary_payments").insert([
                "employee_id": employeeId, "period": period, "amount": amount, "method": method,
                "paid_at": paidAt, "note": noteVal,
            ]).run()
        } catch { flash(t("saveFailed", ["err": error.localizedDescription])); return }
        flash(t("pe.paymentSaved"))
        await loadSalary()
        await loadSalaryDebt()
    }

    // MARK: расписание

    func loadSchedule() async {
        #if DEBUG
        if ProcessInfo.processInfo.environment["MISE_DEMO_UI"] == "1" { seedSchedule(); return }
        #endif
        let cal = Calendar.current
        let monthStart = cal.date(from: cal.dateComponents([.year, .month], from: calendarMonth)) ?? calendarMonth
        let lastDay = cal.date(byAdding: .day, value: -1,
                               to: cal.date(byAdding: .month, value: 1, to: monthStart) ?? monthStart) ?? monthStart
        async let dirL = try? DB.from("staff_directory").select().eq("is_active", true).order("name").list(StaffDir.self)
        async let schR = try? DB.from("staff_schedules").select().gte("date", key(monthStart)).lte("date", key(lastDay)).list(Schedule.self)
        let dO = await dirL
        if dir.isEmpty, let d = dO { dir = d }
        guard let schAll = await schR else {
            if !schedules.isEmpty { flash(t("refreshFailed")) }
            return
        }
        var rows = schAll
        if !isManager { rows = rows.filter { $0.staff_id == myId } }
        schedules = rows.sorted { $0.date < $1.date }
        schedLoaded = true
    }

    func prevMonth() async {
        calendarMonth = Calendar.current.date(byAdding: .month, value: -1, to: calendarMonth) ?? calendarMonth
        selectedCalDate = nil; schedLoaded = false
        await loadSchedule()
    }
    func nextMonth() async {
        calendarMonth = Calendar.current.date(byAdding: .month, value: 1, to: calendarMonth) ?? calendarMonth
        selectedCalDate = nil; schedLoaded = false
        await loadSchedule()
    }
    var schedByDate: [(String, [Schedule])] {
        var m: [String: [Schedule]] = [:]
        for s in schedules { m[s.date, default: []].append(s) }
        return m.sorted { $0.key < $1.key }
    }

    // Менеджер строит график: добавление / удаление смен + копирование прошлой недели.
    func createSchedule(staffId: String, date: String, start: String, end: String, note: String) async -> Bool {
        guard !staffId.isEmpty else { flash(t("pe.pickStaff")); return false }
        var v: [String: Any] = ["restaurant_id": rid, "staff_id": staffId, "date": date,
                                "shift_start": start, "shift_end": end]
        if !note.isEmpty { v["note"] = note }
        do {
            try await DB.from("staff_schedules").insert(v).run()
        } catch { flash(t("saveFailed", ["err": error.localizedDescription])); return false }
        flash(t("pe.shiftAdded"))
        await loadSchedule()
        return true
    }
    func deleteSchedule(_ id: String) async {
        schedules.removeAll { $0.id == id }
        do {
            try await DB.from("staff_schedules").delete().eq("id", id).run()
        } catch { flash(t("saveFailed", ["err": error.localizedDescription])); await loadSchedule() }
    }
    /// Пакетное добавление: один сотрудник на несколько дат с одним временем.
    func createSchedules(staffId: String, dates: [String], start: String, end: String, note: String) async -> Bool {
        guard !staffId.isEmpty else { flash(t("pe.pickStaff")); return false }
        guard !dates.isEmpty else { flash(t("pe.pickDates")); return false }
        var inserts: [[String: Any]] = []
        for d in dates {
            var v: [String: Any] = ["restaurant_id": rid, "staff_id": staffId, "date": d, "shift_start": start, "shift_end": end]
            if !note.isEmpty { v["note"] = note }
            inserts.append(v)
        }
        do {
            try await DB.from("staff_schedules").insert(inserts).run()
        } catch { flash(t("saveFailed", ["err": error.localizedDescription])); return false }
        flash(t("pe.copied", ["n": "\(inserts.count)"]))
        await loadSchedule()
        return true
    }
    func copyLastWeek() async {
        let cal = Calendar.current
        let weekday = cal.component(.weekday, from: Date())
        let monday = cal.date(byAdding: .day, value: -((weekday + 5) % 7), to: Date()) ?? Date()
        let lastMon = cal.date(byAdding: .day, value: -7, to: monday) ?? monday
        let lastSun = cal.date(byAdding: .day, value: -1, to: monday) ?? monday
        let prev = (try? await DB.from("staff_schedules").select()
            .gte("date", key(lastMon)).lte("date", key(lastSun)).list(Schedule.self)) ?? []
        guard !prev.isEmpty else { flash(t("pe.noPrevWeek")); return }
        var inserts: [[String: Any]] = []
        for s in prev {
            guard let d = df.date(from: s.date), let nd = cal.date(byAdding: .day, value: 7, to: d) else { continue }
            var v: [String: Any] = ["restaurant_id": rid, "staff_id": s.staff_id ?? "", "date": key(nd)]
            if let st = s.shift_start { v["shift_start"] = st }
            if let en = s.shift_end { v["shift_end"] = en }
            if let n = s.note { v["note"] = n }
            inserts.append(v)
        }
        if !inserts.isEmpty {
            do {
                try await DB.from("staff_schedules").insert(inserts).run()
            } catch { flash(t("saveFailed", ["err": error.localizedDescription])); return }
        }
        flash(t("pe.copied", ["n": "\(inserts.count)"]))
        await loadSchedule()
    }

    // MARK: явка

    func loadAttendance() async {
        #if DEBUG
        if ProcessInfo.processInfo.environment["MISE_DEMO_UI"] == "1" { seedAttendance(); return }
        #endif
        // Показать отложенную явку из очереди до запроса сети
        pendingCheckIn = UserDefaults.standard.data(forKey: pendingCheckInKey) != nil

        let cal = Calendar.current
        let monthStart = cal.date(from: cal.dateComponents([.year, .month], from: Date())) ?? Date()
        if let g = try? await DB.from("restaurant_settings").select().limit(1).list(GeoSettings.self).first { geo = g }
        if isManager {
            if let a = try? await DB.from("attendance_records").select().gte("date", key(monthStart)).order("date", ascending: false).limit(500).list(AttendanceRecord.self) {
                attendance = a
            } else if !attendance.isEmpty { flash(t("refreshFailed")) }
            if dir.isEmpty, let d = try? await DB.from("staff_directory").select().eq("is_active", true).order("name").list(StaffDir.self) { dir = d }
            struct SchedStub: Codable { let staff_id: String }
            if let todayScheds = try? await DB.from("staff_schedules").select("staff_id").eq("date", todayKey).list(SchedStub.self) {
                todayScheduledIds = Set(todayScheds.map { $0.staff_id })
            }
        } else {
            if let a = try? await DB.from("attendance_records").select().eq("staff_id", myId).order("date", ascending: false).limit(62).list(AttendanceRecord.self) {
                attendance = a
            } else if !attendance.isEmpty { flash(t("refreshFailed")) }
        }
        attLoaded = true

        // Попытка сбросить очередь офлайн-явки
        if !isManager && pendingCheckIn { await flushPendingCheckIn() }
    }
    var todayKey: String { key(Date()) }
    var todayRec: AttendanceRecord? { attendance.first { $0.staff_id == myId && $0.date == todayKey } }

    // MARK: ключ очереди офлайн-явки
    private var pendingCheckInKey: String { "mise_pending_checkin_\(rid)_\(myId)" }

    func checkIn() async {
        guard todayRec == nil else { return }
        checking = true; defer { checking = false }

        if let g = geo, g.attendance_enabled == true, let lat = g.latitude, let lng = g.longitude {
            guard let coord = await LocationOneShot().current() else { flash(t("pe.noGeo")); return }
            if distanceMeters(coord, lat, lng) > (g.geo_radius_m ?? 150) { flash(t("pe.outOfZone")); return }
        }

        // Идемпотентность: убедиться, что записи за сегодня нет (двойная проверка)
        let existing = (try? await DB.from("attendance_records").select()
            .eq("staff_id", myId).eq("date", todayKey).limit(1).list(AttendanceRecord.self)) ?? []
        guard existing.isEmpty else { await loadAttendance(); return }

        let payload: [String: Any] = [
            "restaurant_id": rid, "staff_id": myId, "date": todayKey,
            "check_in_at": ISO8601DateFormatter().string(from: Date()), "status": "present", "source": "manual",
        ]
        do {
            try await DB.from("attendance_records").insert(payload).run()
            UserDefaults.standard.removeObject(forKey: pendingCheckInKey)
            pendingCheckIn = false
            await Notify.send(type: "attendance", title: t("pe.onShift"), body: myName.isEmpty ? t("pe.iCame") : "\(myName) \(t("pe.iCame"))",
                              audience: ["managers": true], titleKey: "notify.attendanceTitle",
                              bodyKey: "notify.attendanceBody", bodyParams: ["name": myName])
            flash(t("pe.checkedIn"))
            await loadAttendance()
        } catch {
            // Сеть недоступна — сохранить в очередь
            let pending: [String: String] = ["date": todayKey, "ts": ISO8601DateFormatter().string(from: Date())]
            if let data = try? JSONEncoder().encode(pending) {
                UserDefaults.standard.set(data, forKey: pendingCheckInKey)
            }
            pendingCheckIn = true
            flash(t("pe.checkInPending"))
        }
    }

    /// Чек-аут «Я ушёл» — порт веб-версии (app/people/page.tsx checkOut).
    func checkOut() async {
        guard let rec = todayRec, rec.check_out_at == nil else { return }
        checking = true; defer { checking = false }
        var payload: [String: Any] = ["check_out_at": ISO8601DateFormatter().string(from: Date())]
        // Гео как в checkIn: при включённой геоявке фиксируем точку ухода (зону не проверяем —
        // уход возможен и вне зоны).
        if geo?.attendance_enabled == true, let coord = await LocationOneShot().current() {
            payload["check_out_lat"] = coord.latitude
            payload["check_out_lng"] = coord.longitude
        }
        do {
            try await DB.from("attendance_records").update(payload).eq("id", rec.id).run()
            flash(t("pe.checkedOut"))
            await loadAttendance()
        } catch { flash(t("saveFailed", ["err": error.localizedDescription])) }
    }

    /// Сбросить отложенную явку (при загрузке и возврате в foreground).
    func flushPendingCheckIn() async {
        guard let data = UserDefaults.standard.data(forKey: pendingCheckInKey),
              let pending = try? JSONDecoder().decode([String: String].self, from: data),
              let date = pending["date"], let ts = pending["ts"] else {
            pendingCheckIn = false; return
        }
        // Не создавать дубликат
        let existing = (try? await DB.from("attendance_records").select()
            .eq("staff_id", myId).eq("date", date).limit(1).list(AttendanceRecord.self)) ?? []
        if !existing.isEmpty {
            UserDefaults.standard.removeObject(forKey: pendingCheckInKey)
            pendingCheckIn = false; return
        }
        do {
            try await DB.from("attendance_records").insert([
                "restaurant_id": rid, "staff_id": myId, "date": date,
                "check_in_at": ts, "status": "present", "source": "manual",
            ] as [String: Any]).run()
            UserDefaults.standard.removeObject(forKey: pendingCheckInKey)
            pendingCheckIn = false
            flash(t("pe.checkedIn"))
            await loadAttendance()
        } catch {
            pendingCheckIn = true
        }
    }

    // MARK: обмены

    func loadSwaps() async {
        #if DEBUG
        if ProcessInfo.processInfo.environment["MISE_DEMO_UI"] == "1" { seedSwaps(); return }
        #endif
        let cal = Calendar.current
        let from = key(cal.date(byAdding: .day, value: -14, to: Date()) ?? Date())
        let to = key(cal.date(byAdding: .day, value: 60, to: Date()) ?? Date())
        // Лимит на растущую таблицу (ревью Д1).
        if let s = try? await DB.from("shift_swap_requests").select().order("created_at", ascending: false).limit(200).list(SwapRequest.self) {
            swaps = s
        } else if !swaps.isEmpty { flash(t("refreshFailed")) }
        if dir.isEmpty, let d = try? await DB.from("staff_directory").select().eq("is_active", true).order("name").list(StaffDir.self) { dir = d }
        if let ss = try? await DB.from("staff_schedules").select().gte("date", from).lte("date", to).list(Schedule.self) { swapScheds = ss }
        swapsLoaded = true
    }
    func swapSched(_ id: String?) -> Schedule? { swapScheds.first { $0.id == id } }
    var incomingSwaps: [SwapRequest] { swaps.filter { $0.target_id == myId } }
    var outgoingSwaps: [SwapRequest] { swaps.filter { $0.requester_id == myId } }
    var managerQueueSwaps: [SwapRequest] { swaps.filter { $0.status == "peer_accepted" } }

    private func patchSwap(_ r: SwapRequest, _ status: String) async {
        if let i = swaps.firstIndex(where: { $0.id == r.id }) { swaps[i].status = status }
        do {
            try await DB.from("shift_swap_requests").update(["status": status]).eq("id", r.id).run()
        } catch { flash(t("saveFailed", ["err": error.localizedDescription])); await loadSwaps() }
    }
    func swapPeerAccept(_ r: SwapRequest) async { await patchSwap(r, "peer_accepted") }
    func swapPeerDecline(_ r: SwapRequest) async { await patchSwap(r, "peer_declined") }
    func swapCancel(_ r: SwapRequest) async { await patchSwap(r, "cancelled") }
    func swapReject(_ r: SwapRequest) async { await patchSwap(r, "rejected") }
    func swapApprove(_ r: SwapRequest) async {
        if let sid = r.schedule_id, let tid = r.target_id {
            do {
                try await DB.from("staff_schedules").update(["staff_id": tid]).eq("id", sid).run()
            } catch { flash(t("saveFailed", ["err": error.localizedDescription])); return }
        }
        await patchSwap(r, "approved")
        flash(t("pe.swapApproved"))
    }

    // MARK: чек-листы

    func loadChecklists() async {
        #if DEBUG
        if ProcessInfo.processInfo.environment["MISE_DEMO_UI"] == "1" { seedChecklists(); return }
        #endif
        // Чек-лист привязан к открытой смене модуля Manager: пока на сегодня есть смена,
        // чек-лист активен, а его прохождение пишется по shift_id этой смены. Новая смена
        // (новый день/новый shift_id) → чистые галочки.
        guard let sh = try? await DB.from("shifts").select("id, status, date")
            .eq("date", key(Date())).order("opened_at", ascending: false).limit(1).list(ShiftRef.self) else {
            if !checklists.isEmpty { flash(t("refreshFailed")) }
            return
        }
        openShiftId = sh.first?.id
        if let cls = try? await DB.from("shift_checklists").select().list(ShiftChecklist.self) { checklists = cls }
        if let sid = openShiftId {
            if let c = try? await DB.from("shift_checklist_completions").select().eq("shift_id", sid).list(ChecklistCompletion.self) { completions = c }
        } else {
            completions = []
        }
        checklistsLoaded = true
        await flushPendingChecklistQueue()
    }

    func loadChecklistHistory() async {
        #if DEBUG
        if ProcessInfo.processInfo.environment["MISE_DEMO_UI"] == "1" { clHistoryLoaded = true; return }
        #endif
        let from = key(Calendar.current.date(byAdding: .day, value: -30, to: Date()) ?? Date())
        clHistory = (try? await DB.from("shift_checklist_completions").select()
            .gte("date", from).order("date", ascending: false).list(ChecklistCompletion.self)) ?? []
        if checklists.isEmpty {
            checklists = (try? await DB.from("shift_checklists").select().list(ShiftChecklist.self)) ?? []
        }
        clHistoryLoaded = true
    }
    /// История по дням: дата → прохождения (каждый день = смена).
    var historyByDate: [(String, [ChecklistCompletion])] {
        var m: [String: [ChecklistCompletion]] = [:]
        for c in clHistory { m[c.date ?? "", default: []].append(c) }
        return m.sorted { $0.key > $1.key }
    }
    func checklistTitle(_ id: String?) -> ShiftChecklist? { (checklists + audits).first { $0.id == id } }
    func relevantChecklists() -> [ShiftChecklist] {
        checklists.filter { ($0.kind ?? "shift") == "shift" && ($0.type ?? "open") == clType && (isManager || $0.role == nil || $0.role == myRole) }
    }
    func completion(_ list: ShiftChecklist) -> ChecklistCompletion? { completions.first { $0.checklist_id == list.id } }

    // MARK: аудиты (разовые проверки)

    func loadAudits() async {
        #if DEBUG
        if ProcessInfo.processInfo.environment["MISE_DEMO_UI"] == "1" { auditsLoaded = true; return }
        #endif
        if let cls = try? await DB.from("shift_checklists").select().eq("kind", "audit").list(ShiftChecklist.self) { audits = cls }
        else if !audits.isEmpty { flash(t("refreshFailed")) }
        let from = key(Calendar.current.date(byAdding: .day, value: -30, to: Date()) ?? Date())
        let auditIds = Set(audits.map(\.id))
        auditRuns = ((try? await DB.from("shift_checklist_completions").select()
            .gte("date", from).order("date", ascending: false).list(ChecklistCompletion.self)) ?? [])
            .filter { auditIds.contains($0.checklist_id ?? "") }
        if dir.isEmpty, let d = try? await DB.from("staff_directory").select().eq("is_active", true).order("name").list(StaffDir.self) { dir = d }
        auditsLoaded = true
        await flushPendingChecklistQueue()
    }

    /// Аудиты, релевантные текущему пользователю: менеджер видит все, сотрудник — только те,
    /// что нацелены на всю смену / его цех / лично на него.
    func relevantAudits() -> [ShiftChecklist] {
        audits.filter { a in
            isManager || a.target_scope == "venue"
                || (a.target_scope == "role" && (a.role == nil || a.role == myRole))
                || (a.target_scope == "staff" && a.assigned_staff_id == myId)
        }
    }
    /// Только сегодняшние прогоны (аудит — разовый, не имеет смысла тащить старые в рабочий список).
    func todayAuditRuns() -> [ChecklistCompletion] { auditRuns.filter { $0.date == todayKey } }
    func auditRun(_ list: ShiftChecklist) -> ChecklistCompletion? { todayAuditRuns().first { $0.checklist_id == list.id } }

    func toggleAuditItem(_ list: ShiftChecklist, _ idx: Int, photoURL: String? = nil) async {
        guard await requireGeoCheckIn() else { return }
        let itemsList = list.itemDetails ?? []
        var state = auditRun(list)?.items_state ?? []
        while state.count <= idx { state.append(ChecklistItemState(done: false)) }
        var item = state[idx]
        let willBeDone = !item.done
        if willBeDone, idx < itemsList.count, itemsList[idx].photo_required, photoURL == nil {
            flash(t("pe.photoRequired")); return
        }
        item.done = willBeDone
        if let photoURL { item.photo_url = photoURL }
        await persistAuditItem(list, idx, item)
    }

    /// Оценка пункта аудита (ревью Б1): result = "pass" | "fail" | "na" | nil (снять оценку).
    /// done ставится при любой оценке — «пункт проверен», прогон завершается как раньше.
    func gradeAuditItem(_ list: ShiftChecklist, _ idx: Int, result: String?, photoURL: String? = nil) async {
        guard await requireGeoCheckIn() else { return }
        let itemsList = list.itemDetails ?? []
        var state = auditRun(list)?.items_state ?? []
        while state.count <= idx { state.append(ChecklistItemState(done: false)) }
        var item = state[idx]
        // Подстраховка: UI сам открывает камеру для pass с обязательным фото.
        if result == "pass", idx < itemsList.count, itemsList[idx].photo_required, photoURL == nil, item.photo_url == nil {
            flash(t("pe.photoRequired")); return
        }
        item.result = result
        item.done = result != nil
        if let photoURL { item.photo_url = photoURL }
        await persistAuditItem(list, idx, item)
    }

    /// Комментарий к пункту аудита (ревью Б2).
    func setAuditItemNote(_ list: ShiftChecklist, _ idx: Int, note: String?) async {
        guard await requireGeoCheckIn() else { return }
        var state = auditRun(list)?.items_state ?? []
        while state.count <= idx { state.append(ChecklistItemState(done: false)) }
        var item = state[idx]
        let clean = note?.trimmingCharacters(in: .whitespacesAndNewlines)
        item.note = clean?.isEmpty == false ? clean : nil
        await persistAuditItem(list, idx, item)
    }

    /// Общая запись пункта аудита (toggle/grade/note): мерж со свежей копией, update/insert,
    /// офлайн-очередь. newItem кладётся ЦЕЛИКОМ в свой индекс — чужие индексы не трогаем.
    private func persistAuditItem(_ list: ShiftChecklist, _ idx: Int, _ newItem: ChecklistItemState) async {
        let itemsList = list.itemDetails ?? []
        var state = auditRun(list)?.items_state ?? Array(repeating: ChecklistItemState(done: false), count: itemsList.count)
        while state.count < max(itemsList.count, idx + 1) { state.append(ChecklistItemState(done: false)) }
        state[idx] = newItem
        var allDone = state.allSatisfy { $0.done }
        let staffVal: Any = myId == "owner" || myId.isEmpty ? NSNull() : myId
        if let i = auditRuns.firstIndex(where: { $0.checklist_id == list.id && $0.date == todayKey }) {
            let cid = auditRuns[i].id
            // Против lost update: свежая копия с сервера (мимо кеша), мержим ТОЛЬКО свой индекс —
            // параллельные отметки коллег не затираем. Сеть упала → работаем со своей копией, уйдёт в очередь.
            if let freshState = try? await DB.from("shift_checklist_completions").select().fresh().eq("id", cid).limit(1).list(ChecklistCompletion.self).first?.items_state {
                var merged = freshState
                while merged.count < max(itemsList.count, idx + 1) { merged.append(ChecklistItemState(done: false)) }
                merged[idx] = newItem
                state = merged
                allDone = state.allSatisfy { $0.done }
            }
            let completedAt: Any = allDone ? ISO8601DateFormatter().string(from: Date()) : NSNull()
            auditRuns[i].items_state = state
            auditRuns[i].status = allDone ? "done" : "in_progress"
            do {
                try await DB.from("shift_checklist_completions").update([
                    "items_state": state.map { $0.asDict }, "completed_at": completedAt,
                    "status": allDone ? "done" : "in_progress", "staff_id": staffVal,
                ] as [String: Any]).eq("id", cid).run()
            } catch { queuePendingChecklistToggle(completionId: cid, idx: idx, done: newItem.done, photoURL: newItem.photo_url, newState: newItem) }
        } else {
            let completedAt: Any = allDone ? ISO8601DateFormatter().string(from: Date()) : NSNull()
            let attId: Any = attendance.first(where: { $0.staff_id == myId && $0.date == todayKey })?.id ?? NSNull()
            do {
                try await DB.from("shift_checklist_completions").insert([
                    "restaurant_id": rid, "checklist_id": list.id, "shift_id": openShiftId ?? NSNull(), "date": todayKey,
                    "staff_id": staffVal, "items_state": state.map { $0.asDict }, "completed_at": completedAt,
                    "attendance_id": attId, "status": allDone ? "done" : "in_progress",
                ] as [String: Any]).run()
            } catch {
                // Офлайн: прогона ещё нет — кладём отметку в очередь по (checklist_id, date), flush создаст строку.
                queuePendingChecklistToggle(checklistId: list.id, date: todayKey, shiftId: openShiftId, idx: idx, done: newItem.done, photoURL: newItem.photo_url, newState: newItem)
                return
            }
            await loadAudits()
        }
        if allDone { flash(t("pe.auditDone")) }
    }

    /// Менеджер запускает разовую проверку по существующему шаблону: заводит прогон
    /// (status="pending") и пушит целевой аудитории.
    func startAudit(templateId: String) async {
        guard isManager, let template = audits.first(where: { $0.id == templateId }) else { return }
        let items = (template.itemDetails ?? []).map { _ in ChecklistItemState(done: false).asDict }
        do {
            try await DB.from("shift_checklist_completions").insert([
                "restaurant_id": rid, "checklist_id": template.id, "shift_id": openShiftId ?? NSNull(), "date": todayKey,
                "requested_by": myId == "owner" || myId.isEmpty ? NSNull() : myId,
                "items_state": items, "status": "pending",
            ] as [String: Any]).run()
        } catch { flash(t("saveFailed", ["err": error.localizedDescription])); return }
        await loadAudits()
        let title = template.title?.isEmpty == false ? template.title! : (template.itemDetails?.first?.label ?? t("pe.newAudit"))
        let params = ["name": myName, "title": title]
        switch template.target_scope {
        case "staff":
            if let sid = template.assigned_staff_id {
                await Notify.send(type: "audit", title: t("pe.newAudit"), body: title, audience: ["staff_ids": [sid]],
                                  titleKey: "notify.auditAssignedTitle", bodyKey: "notify.auditAssignedBody", bodyParams: params)
            }
        case "role":
            let targets = dir.filter { $0.role == template.role }.map(\.id)
            if !targets.isEmpty {
                await Notify.send(type: "audit", title: t("pe.newAudit"), body: title, audience: ["staff_ids": targets],
                                  titleKey: "notify.auditAssignedTitle", bodyKey: "notify.auditAssignedBody", bodyParams: params)
            }
        default: // "venue" — вся смена
            await Notify.send(type: "audit", title: t("pe.newAudit"), body: title, audience: ["all": true],
                              titleKey: "notify.auditAssignedTitle", bodyKey: "notify.auditAssignedBody", bodyParams: params)
        }
    }

    /// Готовые шаблоны под общепит — по явному нажатию менеджера, не автоматически.
    func addPresetTemplates() async {
        guard isManager else { return }
        let presets: [(type: String, role: String?, items: [String])] = [
            ("open", nil, [t("pe.presetOpenHall1"), t("pe.presetOpenHall2"), t("pe.presetOpenHall3")]),
            ("close", nil, [t("pe.presetCloseHall1"), t("pe.presetCloseHall2"), t("pe.presetCloseHall3")]),
            ("open", "bar", [t("pe.presetOpenBar1"), t("pe.presetOpenBar2")]),
        ]
        for p in presets {
            let items = p.items.map { ChecklistItem(label: $0) }
            await saveChecklistTemplate(id: nil, role: p.role, items: items, kind: "shift", targetScope: "role", title: nil, type: p.type)
        }
        let sanitationItems = [t("pe.presetSanitation1"), t("pe.presetSanitation2"), t("pe.presetSanitation3"), t("pe.presetSanitation4")].map { ChecklistItem(label: $0, photo_required: true) }
        await saveChecklistTemplate(id: nil, role: nil, items: sanitationItems, kind: "audit", targetScope: "venue", title: t("pe.presetSanitationTitle"))
    }

    /// Гео-гейт: если явка с геолокацией включена, пункт можно отмечать только если у
    /// сотрудника уже есть сегодняшняя запись attendance_records — иначе открытая касса
    /// (Manager) одна не доказывает физическое присутствие ИМЕННО этого человека.
    private func requireGeoCheckIn() async -> Bool {
        guard geo?.attendance_enabled == true else { return true }
        if !attLoaded { await loadAttendance() }
        guard attendance.contains(where: { $0.staff_id == myId && $0.date == todayKey }) else {
            flash(t("pe.needCheckInFirst")); return false
        }
        return true
    }

    func toggleChecklistItem(_ list: ShiftChecklist, _ idx: Int, photoURL: String? = nil) async {
        guard let sid = openShiftId else { flash(t("pe.openShiftFirst")); return }
        guard await requireGeoCheckIn() else { return }
        let itemsList = list.itemDetails ?? []
        var state = completion(list)?.items_state ?? Array(repeating: ChecklistItemState(done: false), count: itemsList.count)
        while state.count < itemsList.count { state.append(ChecklistItemState(done: false)) }
        let willBeDone = !state[idx].done
        if willBeDone, idx < itemsList.count, itemsList[idx].photo_required, photoURL == nil {
            flash(t("pe.photoRequired")); return
        }
        state[idx].done = willBeDone
        if let photoURL { state[idx].photo_url = photoURL }
        var allDone = state.allSatisfy { $0.done }
        if let i = completions.firstIndex(where: { $0.checklist_id == list.id }) {
            let cid = completions[i].id
            // Против lost update: свежая копия с сервера (мимо кеша), мержим ТОЛЬКО свой индекс.
            if let freshState = try? await DB.from("shift_checklist_completions").select().fresh().eq("id", cid).limit(1).list(ChecklistCompletion.self).first?.items_state {
                var merged = freshState
                while merged.count < max(itemsList.count, idx + 1) { merged.append(ChecklistItemState(done: false)) }
                merged[idx] = state[idx]
                state = merged
                allDone = state.allSatisfy { $0.done }
            }
            let completedAt: Any = allDone ? ISO8601DateFormatter().string(from: Date()) : NSNull()
            completions[i].items_state = state
            do {
                try await DB.from("shift_checklist_completions").update([
                    "items_state": state.map { $0.asDict }, "completed_at": completedAt,
                    "status": allDone ? "done" : "in_progress",
                    "staff_id": myId == "owner" || myId.isEmpty ? NSNull() : myId,
                ] as [String: Any]).eq("id", cid).run()
            } catch {
                queuePendingChecklistToggle(completionId: cid, idx: idx, done: state[idx].done, photoURL: photoURL)
            }
        } else {
            let completedAt: Any = allDone ? ISO8601DateFormatter().string(from: Date()) : NSNull()
            let attId: Any = attendance.first(where: { $0.staff_id == myId && $0.date == todayKey })?.id ?? NSNull()
            do {
                try await DB.from("shift_checklist_completions").insert([
                    "restaurant_id": rid, "checklist_id": list.id, "shift_id": sid, "date": key(Date()),
                    "staff_id": myId == "owner" || myId.isEmpty ? NSNull() : myId,
                    "items_state": state.map { $0.asDict }, "completed_at": completedAt, "attendance_id": attId, "status": allDone ? "done" : "in_progress",
                ] as [String: Any]).run()
            } catch {
                // Офлайн: строки ещё нет — очередь по (checklist_id, date), flush создаст прогон.
                queuePendingChecklistToggle(checklistId: list.id, date: key(Date()), shiftId: sid, idx: idx, done: state[idx].done, photoURL: photoURL)
                return
            }
            await loadChecklists()
        }
        if allDone { flash(clType == "open" ? t("pe.checklistOpenDone") : t("pe.checklistCloseDone")) }
    }

    // Журнал уведомлений переехал в AppModel (глобальный колокольчик, см. MainView.swift) —
    // раньше жил только тут (People→Смены), но уведомления бывают о любом модуле.

    // MARK: оффлайн-очередь отметок чек-листа/аудита (по образцу pendingCheckIn)

    /// completionId != nil — отметка в существующем прогоне; иначе прогона ещё не было
    /// (офлайн-INSERT): ищем/создаём по (checklistId, date) при flush.
    private struct PendingChecklistToggle: Codable {
        var completionId: String?
        var checklistId: String?
        var date: String?
        var shiftId: String?
        let idx: Int
        let done: Bool
        let photoURL: String?
        // Полное состояние пункта (оценки Б1/Б2: result/note). Есть — при flush кладётся
        // целиком; nil (старые элементы очереди) — применяются done/photoURL как раньше.
        var newState: ChecklistItemState? = nil
    }
    private var pendingChecklistKey: String { "mise_pending_checklist_\(rid)_\(myId)" }

    private func loadPendingChecklistQueue() -> [PendingChecklistToggle] {
        guard let data = UserDefaults.standard.data(forKey: pendingChecklistKey),
              let queue = try? JSONDecoder().decode([PendingChecklistToggle].self, from: data) else { return [] }
        return queue
    }

    private func queuePendingChecklistToggle(completionId: String? = nil, checklistId: String? = nil, date: String? = nil, shiftId: String? = nil, idx: Int, done: Bool, photoURL: String?, newState: ChecklistItemState? = nil) {
        var queue = loadPendingChecklistQueue()
        queue.append(.init(completionId: completionId, checklistId: checklistId, date: date, shiftId: shiftId, idx: idx, done: done, photoURL: photoURL, newState: newState))
        if let data = try? JSONEncoder().encode(queue) { UserDefaults.standard.set(data, forKey: pendingChecklistKey) }
        flash(t("pe.checkInPending"))
    }

    /// Досылает отметки, накопленные без сети. Вызывается там же, где flushPendingCheckIn —
    /// при загрузке раздела/возврате в foreground.
    func flushPendingChecklistQueue() async {
        let queue = loadPendingChecklistQueue()
        guard !queue.isEmpty else { return }
        let staffVal: Any = myId == "owner" || myId.isEmpty ? NSNull() : myId
        var remaining: [PendingChecklistToggle] = []
        for item in queue {
            // Находим прогон: по id либо (checklist_id, date) — офлайн-INSERT строку так и не создал.
            // Читаем мимо кеша: мерж по устаревшей копии = lost update.
            var comp: ChecklistCompletion?
            if let cid = item.completionId {
                guard let found = try? await DB.from("shift_checklist_completions").select().fresh().eq("id", cid).limit(1).list(ChecklistCompletion.self).first else {
                    remaining.append(item); continue
                }
                comp = found
            } else if let clId = item.checklistId, let date = item.date {
                do {
                    comp = try await DB.from("shift_checklist_completions").select().fresh().eq("checklist_id", clId).eq("date", date).limit(1).list(ChecklistCompletion.self).first
                } catch { remaining.append(item); continue } // сеть — попробуем позже
            } else { continue } // битый элемент старого формата — выкидываем

            if let comp {
                var state = comp.items_state ?? []
                while state.count <= item.idx { state.append(.init(done: false)) }
                if let ns = item.newState { state[item.idx] = ns }
                else {
                    state[item.idx].done = item.done
                    if let p = item.photoURL { state[item.idx].photo_url = p }
                }
                let allDone = state.allSatisfy { $0.done }
                do {
                    try await DB.from("shift_checklist_completions").update([
                        "items_state": state.map { $0.asDict },
                        "completed_at": allDone ? ISO8601DateFormatter().string(from: Date()) : NSNull(),
                        "status": allDone ? "done" : "in_progress",
                        "staff_id": staffVal,
                    ] as [String: Any]).eq("id", comp.id).run()
                } catch { remaining.append(item) }
            } else {
                // Прогона нет — создаём со своей отметкой; размер по шаблону, чтобы не резать чужие индексы.
                let tplCount = (checklists + audits).first { $0.id == item.checklistId }?.itemDetails?.count ?? 0
                var state = Array(repeating: ChecklistItemState(done: false), count: max(tplCount, item.idx + 1))
                if let ns = item.newState { state[item.idx] = ns }
                else {
                    state[item.idx].done = item.done
                    if let p = item.photoURL { state[item.idx].photo_url = p }
                }
                let allDone = state.allSatisfy { $0.done }
                do {
                    try await DB.from("shift_checklist_completions").insert([
                        "restaurant_id": rid, "checklist_id": item.checklistId ?? "", "shift_id": item.shiftId ?? NSNull(), "date": item.date ?? todayKey,
                        "staff_id": staffVal, "items_state": state.map { $0.asDict },
                        "completed_at": allDone ? ISO8601DateFormatter().string(from: Date()) : NSNull(),
                        "status": allDone ? "done" : "in_progress",
                    ] as [String: Any]).run()
                } catch { remaining.append(item) }
            }
        }
        if remaining.isEmpty { UserDefaults.standard.removeObject(forKey: pendingChecklistKey) }
        else if let data = try? JSONEncoder().encode(remaining) { UserDefaults.standard.set(data, forKey: pendingChecklistKey) }
        if remaining.count < queue.count { await loadChecklists(); await loadAudits() }
    }

    func saveChecklistTemplate(id: String?, role: String?, items: [ChecklistItem], kind: String = "shift", targetScope: String = "role", assignedStaffId: String? = nil, title: String? = nil, type: String? = nil, recurrence: String = "none", recurrenceWeekdays: [Int]? = nil, recurrenceDayOfMonth: Int? = nil) async {
        let clean = items.map { ChecklistItem(id: $0.id, label: $0.label.trimmingCharacters(in: .whitespaces), photo_required: $0.photo_required, weight: $0.weight) }.filter { !$0.label.isEmpty }
        guard !clean.isEmpty else { flash(t("pe.addItem")); return }
        let roleVal: Any = role ?? NSNull()
        let itemDicts = clean.map { $0.asDict }
        // Расписание имеет смысл только для разовых аудитов — для kind="shift" всегда "none"/NULL.
        let recurrenceVal: Any = kind == "audit" ? recurrence : "none"
        let weekdaysVal: Any = kind == "audit" ? ((recurrenceWeekdays as Any?) ?? NSNull()) : NSNull()
        let domVal: Any = kind == "audit" ? ((recurrenceDayOfMonth as Any?) ?? NSNull()) : NSNull()
        do {
            if let id {
                try await DB.from("shift_checklists").update([
                    "items": itemDicts, "role": roleVal,
                    "recurrence": recurrenceVal, "recurrence_weekdays": weekdaysVal, "recurrence_day_of_month": domVal,
                ] as [String: Any]).eq("id", id).run()
            } else {
                try await DB.from("shift_checklists").insert([
                    // kind="audit": type — семантика открытия/закрытия смены к разовым аудитам не относится, NULL.
                    "restaurant_id": rid, "type": kind == "audit" ? NSNull() : (type ?? clType), "items": itemDicts, "role": roleVal,
                    "kind": kind, "target_scope": targetScope, "assigned_staff_id": assignedStaffId ?? NSNull(),
                    "title": title ?? NSNull(),
                    "recurrence": recurrenceVal, "recurrence_weekdays": weekdaysVal, "recurrence_day_of_month": domVal,
                ] as [String: Any]).run()
            }
        } catch { flash(t("saveFailed", ["err": error.localizedDescription])); return }
        flash(t("pe.checklistSaved"))
        if kind == "audit" { await loadAudits() } else { await loadChecklists() }
    }
    func deleteChecklist(_ id: String) async {
        checklists.removeAll { $0.id == id }
        do {
            try await DB.from("shift_checklists").delete().eq("id", id).run()
        } catch { flash(t("saveFailed", ["err": error.localizedDescription])); await loadChecklists() }
    }

    // MARK: восьмёрка (обход-восьмёрка)

    func loadWalks() async {
        #if DEBUG
        if ProcessInfo.processInfo.environment["MISE_DEMO_UI"] == "1" { walksLoaded = true; return }
        #endif
        if let rows = try? await DB.from("shift_checklists").select().eq("kind", "walk").list(WalkTemplate.self) {
            walkTemplates = rows
        } else if !walkTemplates.isEmpty { flash(t("refreshFailed")) }
        let from = key(Calendar.current.date(byAdding: .day, value: -30, to: Date()) ?? Date())
        let ids = Set(walkTemplates.map(\.id))
        walkRuns = ((try? await DB.from("shift_checklist_completions").select()
            .gte("date", from).order("date", ascending: false).list(WalkRun.self)) ?? [])
            .filter { ids.contains($0.checklist_id ?? "") }
        walksLoaded = true
    }

    /// Личные шаблоны сотрудника + те, что владелец/менеджер назначил его должности
    /// (только запуск — правка гейтится в UI через canEditWalk).
    func relevantWalks() -> [WalkTemplate] {
        walkTemplates.filter { w in
            (w.target_scope == "staff" && w.assigned_staff_id == myId)
                || (w.target_scope == "role" && (w.role == nil || w.role == myRole))
                || isManager
        }
    }
    /// Редактировать может: автор личного шаблона, или owner/manager у ролевого.
    func canEditWalk(_ w: WalkTemplate) -> Bool {
        (w.target_scope == "staff" && w.assigned_staff_id == myId) || isManager
    }

    func saveWalkTemplate(_ template: WalkTemplate) async {
        let clean = template.blocks
            .map { WalkBlock(id: $0.id, label: $0.label.trimmingCharacters(in: .whitespaces), categories:
                $0.categories.map { WalkCategory(id: $0.id, label: $0.label.trimmingCharacters(in: .whitespaces), items:
                    $0.items.map { WalkItem(id: $0.id, label: $0.label.trimmingCharacters(in: .whitespaces)) }.filter { !$0.label.isEmpty }) }
                    .filter { !$0.label.isEmpty && !$0.items.isEmpty }) }
            .filter { !$0.label.isEmpty && !$0.categories.isEmpty }
        guard !clean.isEmpty else { flash(t("pe.addItem")); return }
        var t2 = template; t2.blocks = clean
        let isNew = !walkTemplates.contains { $0.id == template.id }
        do {
            if isNew {
                var values = t2.asUpdateDict
                values["restaurant_id"] = rid
                values["id"] = t2.id
                try await DB.from("shift_checklists").insert(values).run()
            } else {
                try await DB.from("shift_checklists").update(t2.asUpdateDict).eq("id", t2.id).run()
            }
        } catch { flash(t("saveFailed", ["err": error.localizedDescription])); return }
        flash(t("pe.checklistSaved"))
        await loadWalks()
    }

    func deleteWalkTemplate(_ id: String) async {
        walkTemplates.removeAll { $0.id == id }
        do {
            try await DB.from("shift_checklists").delete().eq("id", id).run()
        } catch { flash(t("saveFailed", ["err": error.localizedDescription])); await loadWalks() }
    }

    /// Итог прогона восьмёрки — пишется ОДНИМ запросом по завершению обхода (не поштучно,
    /// как аудиты: чекбоксы копятся локально в раннере, таймер/шагомер — тоже; сеть нужна
    /// только один раз в конце, обход не прерывается офлайн-очередями на каждый тап).
    func finishWalkRun(template: WalkTemplate, itemsState: [ChecklistItemState], durationSeconds: Int, steps: Int) async {
        guard await requireGeoCheckIn() else { return }
        let staffVal: Any = myId == "owner" || myId.isEmpty ? NSNull() : myId
        do {
            try await DB.from("shift_checklist_completions").insert([
                "restaurant_id": rid, "checklist_id": template.id, "date": todayKey,
                "staff_id": staffVal, "items_state": itemsState.map { $0.asDict },
                "completed_at": ISO8601DateFormatter().string(from: Date()), "status": "done",
                "duration_seconds": durationSeconds, "steps": steps,
            ] as [String: Any]).run()
        } catch { flash(t("saveFailed", ["err": error.localizedDescription])); return }
        flash(t("pe.auditDone"))
        await loadWalks()
    }

    // MARK: техкарты

    func loadTechCards() async {
        #if DEBUG
        if ProcessInfo.processInfo.environment["MISE_DEMO_UI"] == "1" { seedTech(); return }
        #endif
        if let tc = try? await DB.from("tech_cards").select().eq("is_active", true).order("name").list(TechCard.self) {
            techCards = tc
        } else if !techCards.isEmpty { flash(t("refreshFailed")) }
        techLoaded = true
    }
    func saveTechCard(id: String?, name: String, category: String, items: [String]) async {
        guard !name.trimmingCharacters(in: .whitespaces).isEmpty else { flash(t("pe.needName")); return }
        let clean = items.map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        do {
            if let id {
                try await DB.from("tech_cards").update(["name": name, "category": category, "items": clean]).eq("id", id).run()
            } else {
                try await DB.from("tech_cards").insert(["restaurant_id": rid, "name": name, "category": category, "items": clean]).run()
            }
        } catch { flash(t("saveFailed", ["err": error.localizedDescription])); return }
        flash(t("pe.saved"))
        await loadTechCards()
    }
    func deleteTechCard(_ id: String) async {
        techCards.removeAll { $0.id == id }
        do {
            try await DB.from("tech_cards").update(["is_active": false]).eq("id", id).run()
        } catch { flash(t("saveFailed", ["err": error.localizedDescription])); await loadTechCards() }
    }

    // создание обмена сотрудником
    var myUpcomingScheds: [Schedule] {
        swapScheds.filter { $0.staff_id == myId && $0.date >= todayKey }.sorted { $0.date < $1.date }
    }
    func createSwap(scheduleId: String, targetId: String, note: String) async -> Bool {
        guard !scheduleId.isEmpty, !targetId.isEmpty else { flash(t("pe.pickShiftPeer")); return false }
        let noteVal: Any = note.isEmpty ? NSNull() : note
        do {
            try await DB.from("shift_swap_requests").insert([
                "restaurant_id": rid, "schedule_id": scheduleId, "requester_id": myId,
                "target_id": targetId, "status": "pending_peer", "note": noteVal,
            ]).run()
        } catch { flash(t("saveFailed", ["err": error.localizedDescription])); return false }
        let dateLabel = swapSched(scheduleId).map { dayLabel($0.date) } ?? ""
        await Notify.send(type: "swap_request", title: t("pe.swapRequestTitle"), body: t("pe.swapRequestBody", ["name": myName]),
                          audience: ["staff_ids": [targetId]], titleKey: "notify.swapRequestTitle",
                          bodyKey: "notify.swapRequestBody", bodyParams: ["name": myName, "date": dateLabel])
        flash(t("pe.requestSent"))
        await loadSwaps()
        return true
    }

    // MARK: стоп-лист

    func loadMenu() async {
        #if DEBUG
        if ProcessInfo.processInfo.environment["MISE_DEMO_UI"] == "1" { seedMenu(); return }
        #endif
        if let mi = try? await DB.from("menu_items").select().eq("is_visible", true).order("position").list(MenuItem.self) {
            menu = mi
        } else if !menu.isEmpty { flash(t("refreshFailed")) }
        menuLoaded = true
    }
    func toggleItem(_ item: MenuItem) async {
        guard let i = menu.firstIndex(where: { $0.id == item.id }) else { return }
        let next = !(menu[i].is_available ?? true)
        menu[i].is_available = next
        do {
            try await DB.from("menu_items").update(["is_available": next]).eq("id", item.id).run()
        } catch { flash(t("saveFailed", ["err": error.localizedDescription])); await loadMenu() }
    }
    var stopCount: Int { menu.filter { $0.is_available == false }.count }

    // заказы (инбокс)
    func loadOrders() async {
        #if DEBUG
        if ProcessInfo.processInfo.environment["MISE_DEMO_UI"] == "1" { seedOrders(); return }
        #endif
        let from = key(Calendar.current.date(byAdding: .day, value: -2, to: Date()) ?? Date())
        if let o = try? await DB.from("menu_orders").select().gte("created_at", from)
            .order("created_at", ascending: false).limit(100).list(MenuOrder.self) {
            orders = o
        } else if !orders.isEmpty { flash(t("refreshFailed")) }
        ordersLoaded = true
    }
    var activeOrders: [MenuOrder] { orders.filter { $0.status == "new" || $0.status == "in_progress" } }
    var finishedOrders: [MenuOrder] { orders.filter { $0.status == "done" || $0.status == "cancelled" } }
    func setOrderStatus(_ o: MenuOrder, _ status: String) async {
        if let i = orders.firstIndex(where: { $0.id == o.id }) { orders[i].status = status }
        do {
            try await DB.from("menu_orders").update(["status": status]).eq("id", o.id).run()
        } catch { flash(t("saveFailed", ["err": error.localizedDescription])); await loadOrders() }
    }

    // закуп
    func loadPurchase() async {
        if let p = try? await DB.from("purchase_items").select().order("created_at", ascending: false).limit(300).list(PurchaseItem.self) {
            purchase = p
        } else if !purchase.isEmpty { flash(t("refreshFailed")) }
        purchaseLoaded = true
    }
    var purchaseTodo: [PurchaseItem] { purchase.filter { $0.status == "todo" } }
    var purchaseDone: [PurchaseItem] { purchase.filter { $0.status != "todo" } }

    func addPurchase(category: String, rows: [(name: String, qty: String, unit: String)], catLabel: String) async {
        let valid = rows.map { ($0.name.trimmingCharacters(in: .whitespaces), $0.qty, $0.unit) }.filter { !$0.0.isEmpty }
        if valid.isEmpty { return }
        let creator: Any = myId == "owner" ? NSNull() : myId
        let payload: [[String: Any]] = valid.map { r in
            var v: [String: Any] = [
                "category": category, "name": r.0, "status": "todo",
                "created_by": creator,
                "created_by_name": myName,
            ]
            let q = r.1.replacingOccurrences(of: ",", with: ".").trimmingCharacters(in: .whitespaces)
            v["qty"] = Double(q) ?? NSNull()
            let unitTrim = r.2.trimmingCharacters(in: .whitespaces)
            v["unit"] = unitTrim.isEmpty ? NSNull() : unitTrim
            return v
        }
        do {
            try await DB.from("purchase_items").insert(payload).run()
        } catch { flash(t("saveFailed", ["err": error.localizedDescription])); return }
        let who = myName.isEmpty ? "" : "\(myName): "
        let body = valid.count == 1 ? "\(who)\(valid[0].0)" : "\(who)\(t("st.positions", ["n": "\(valid.count)"]))"
        await Notify.send(type: "purchase", title: "\(catLabel) · \(t("pe.pTab"))", body: body,
                          audience: ["managers": true], titleKey: "notify.purchaseTitle", titleParams: ["category": category],
                          bodyKey: valid.count > 1 ? "notify.purchasePositionsBody" : nil,
                          bodyParams: valid.count > 1 ? ["who": who, "n": "\(valid.count)"] : nil,
                          data: ["category": category])
        await loadPurchase()
    }

    func setPurchaseStatus(_ it: PurchaseItem, _ status: String) async {
        if let i = purchase.firstIndex(where: { $0.id == it.id }) { purchase[i].status = status }
        var v: [String: Any] = ["status": status]
        let boughtBy: Any = (status == "bought" && myId != "owner") ? myId : NSNull()
        v["bought_by"] = boughtBy
        v["bought_at"] = status == "bought" ? ISO8601DateFormatter().string(from: Date()) : NSNull()
        do {
            try await DB.from("purchase_items").update(v).eq("id", it.id).run()
        } catch { flash(t("saveFailed", ["err": error.localizedDescription])); await loadPurchase() }
    }

    func removePurchase(_ it: PurchaseItem) async {
        purchase.removeAll { $0.id == it.id }
        do {
            try await DB.from("purchase_items").delete().eq("id", it.id).run()
        } catch { flash(t("saveFailed", ["err": error.localizedDescription])); await loadPurchase() }
    }

    /// Текст списка к закупке (по цехам) — для копирования/отправки поставщику.
    func purchaseText(catLabel: (String) -> String) -> String {
        let cats = Array(Set(purchaseTodo.map { $0.category }))
        var lines: [String] = []
        for c in cats {
            let arr = purchaseTodo.filter { $0.category == c }
            if arr.isEmpty { continue }
            lines.append("\(catLabel(c)):")
            for x in arr {
                var amt = ""
                if let q = x.qty { amt = " — \(q.clean)\(x.unit.map { " \($0)" } ?? "")" }
                else if let u = x.unit { amt = " — \(u)" }
                lines.append("• \(x.name)\(amt)")
            }
            lines.append("")
        }
        return lines.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
    }

    // дисциплина
    struct DiscStat { var shifts = 0; var evaluable = 0; var onTime = 0; var late = 0; var extra = 0; var totalMin = 0; var avgMin = 0; var maxMin = 0; var punct: Int? = nil }

    func discRange() -> (String, String) {
        let cal = Calendar.current; let now = Date()
        switch discPeriod {
        case "lastMonth":
            let startThis = cal.date(from: cal.dateComponents([.year, .month], from: now)) ?? now
            let startLast = cal.date(byAdding: .month, value: -1, to: startThis) ?? startThis
            let endLast = cal.date(byAdding: .day, value: -1, to: startThis) ?? startThis
            return (key(startLast), key(endLast))
        case "30d": return (key(cal.date(byAdding: .day, value: -29, to: now) ?? now), key(now))
        case "90d": return (key(cal.date(byAdding: .day, value: -89, to: now) ?? now), key(now))
        default:
            let start = cal.date(from: cal.dateComponents([.year, .month], from: now)) ?? now
            return (key(start), key(now))
        }
    }

    func loadDiscipline() async {
        let (from, to) = discRange()
        let recs = (try? await DB.from("attendance_records").select().gte("date", from).lte("date", to).order("date", ascending: false).limit(3000).list(AttendanceRecord.self)) ?? []
        if dir.isEmpty {
            dir = (try? await DB.from("staff_directory").select().eq("is_active", true).order("name").list(StaffDir.self)) ?? []
        }
        let g = (try? await DB.from("restaurant_settings").select("late_grace_min").limit(1).list(GraceRow.self))?.first
        discRecords = recs; discGrace = g?.late_grace_min ?? 5; discLoaded = true
    }

    func discStat(_ sid: String) -> DiscStat {
        let recs = discRecords.filter { $0.staff_id == sid }
        let eval = recs.filter { $0.late_minutes != nil }
        let lateR = eval.filter { ($0.late_minutes ?? 0) > discGrace }
        let total = lateR.reduce(0) { $0 + ($1.late_minutes ?? 0) }
        var s = DiscStat()
        s.shifts = recs.count; s.evaluable = eval.count; s.onTime = eval.count - lateR.count
        s.late = lateR.count; s.extra = recs.count - eval.count; s.totalMin = total
        s.avgMin = lateR.isEmpty ? 0 : total / lateR.count
        s.maxMin = lateR.reduce(0) { max($0, $1.late_minutes ?? 0) }
        s.punct = eval.isEmpty ? nil : Int((Double(eval.count - lateR.count) / Double(eval.count) * 100).rounded())
        return s
    }

    func saveDiscGrace(_ v: Int) async {
        let prev = discGrace
        discGrace = v
        do {
            try await DB.from("restaurant_settings").update(["late_grace_min": v]).run()
        } catch { flash(t("saveFailed", ["err": error.localizedDescription])); discGrace = prev }
    }

    func flash(_ m: String) {
        toast = m
        Task { try? await Task.sleep(nanoseconds: 2_400_000_000); if toast == m { toast = nil } }
    }

    #if DEBUG
    private func seedTasks() {
        dir = [.init(id: "e1", name: "Анна Кузнецова", role: "waiter"),
               .init(id: "e2", name: "Игорь Петров", role: "kitchen"),
               .init(id: "e3", name: "Мария Соколова", role: "bar")]
        tasks = [
            .init(id: "t1", title: "Принять поставку", description: "Сверить накладную", assigned_to: "e2", created_by: nil, priority: "high", due_date: "2026-06-16", status: "todo", source_completion_id: nil, source_item_label: nil, photo_url: nil),
            .init(id: "t2", title: "Помыть кофемашину", description: nil, assigned_to: "e3", created_by: nil, priority: "medium", due_date: nil, status: "in_progress", source_completion_id: nil, source_item_label: nil, photo_url: nil),
            .init(id: "t3", title: "Обновить стоп-лист", description: nil, assigned_to: "e1", created_by: nil, priority: "low", due_date: nil, status: "done", source_completion_id: nil, source_item_label: nil, photo_url: nil),
        ]
        tasksLoaded = true
    }
    private func seedSalary() {
        let demoAdv = SalaryAdvance(id: "adv1", employee_id: "e1", amount: 200, date: "2026-06-12", note: "Анна Кузнецова аванс")
        salaryRows = [
            .init(id: "e1", name: "Анна Кузнецова", salary: 1200, absences: 0, absenceList: [], deduct: 0, card: 450, advance: 200, advanceList: [demoAdv], total: 1200, cash: 550),
            .init(id: "e2", name: "Игорь Петров",   salary: 1100, absences: 1, absenceList: ["2026-06-14"], deduct: 20, card: 0, advance: 0, advanceList: [], total: 1080, cash: 1080),
            .init(id: "e3", name: "Мария Соколова", salary: 900,  absences: 2, absenceList: ["2026-06-10", "2026-06-18"], deduct: 30, card: 300, advance: 0, advanceList: [], total: 870, cash: 570),
        ]
        if !isManager { salaryRows = salaryRows.filter { $0.name == myName } }
        salaryLoaded = true
    }
    private func seedSchedule() {
        dir = [.init(id: "e1", name: "Анна Кузнецова", role: "waiter"),
               .init(id: "e2", name: "Игорь Петров", role: "kitchen")]
        schedules = [
            .init(id: "s1", staff_id: "e1", date: "2026-06-15", shift_start: "10:00:00", shift_end: "22:00:00", note: nil),
            .init(id: "s2", staff_id: "e2", date: "2026-06-15", shift_start: "12:00:00", shift_end: "00:00:00", note: nil),
            .init(id: "s3", staff_id: "e1", date: "2026-06-16", shift_start: "10:00:00", shift_end: "18:00:00", note: nil),
        ]
        schedLoaded = true
    }
    private func seedMenu() {
        menu = [
            .init(id: "m1", name: "Хумус", price: 8, is_available: true, category_id: "c1"),
            .init(id: "m2", name: "Фалафель", price: 9, is_available: false, category_id: "c1"),
            .init(id: "m3", name: "Шаурма", price: 12, is_available: true, category_id: "c2"),
        ]
        menuLoaded = true
    }
    private func seedAttendance() {
        if dir.isEmpty {
            dir = [.init(id: "e1", name: "Анна Кузнецова", role: "waiter"),
                   .init(id: "e2", name: "Игорь Петров", role: "kitchen"),
                   .init(id: "e3", name: "Мария Соколова", role: "bar")]
        }
        geo = .init(attendance_enabled: false, latitude: nil, longitude: nil, geo_radius_m: 150)
        attendance = [
            .init(id: "a1", staff_id: "e1", date: todayKey, check_in_at: "2026-06-15T09:58:00Z", check_out_at: nil, status: "present", late_minutes: 0),
            .init(id: "a2", staff_id: "e2", date: todayKey, check_in_at: "2026-06-15T12:14:00Z", check_out_at: nil, status: "late", late_minutes: 14),
        ]
        attLoaded = true
    }
    private func seedSwaps() {
        if dir.isEmpty {
            dir = [.init(id: "e1", name: "Анна Кузнецова", role: "waiter"),
                   .init(id: "e2", name: "Игорь Петров", role: "kitchen")]
        }
        swapScheds = [.init(id: "sc1", staff_id: "e1", date: "2026-06-18", shift_start: "10:00:00", shift_end: "22:00:00", note: nil)]
        swaps = [
            .init(id: "sw1", schedule_id: "sc1", target_schedule_id: nil, requester_id: "e1", target_id: myId == "owner" ? "e2" : myId, status: "pending_peer", note: "Не смогу, ДР у друга"),
        ]
        swapsLoaded = true
    }
    private func seedChecklists() {
        checklists = [
            .init(id: "cl1", type: "open", role: nil, items: ["Включить свет и музыку", "Проверить кассу", "Протереть столы"]),
            .init(id: "cl2", type: "open", role: "bar", items: ["Проверить лёд", "Заправить кофемашину"]),
            .init(id: "cl3", type: "close", role: nil, items: ["Сдать кассу", "Выключить оборудование", "Закрыть зал"]),
        ]
        completions = [.init(id: "cm1", checklist_id: "cl1", date: key(Date()), items_state: [.init(done: true), .init(done: true), .init(done: false)])]
        openShiftId = "demo-shift"
        checklistsLoaded = true
    }
    private func seedReports() {
        if dir.isEmpty {
            dir = [.init(id: "e1", name: "Анна Кузнецова", role: "waiter"),
                   .init(id: "e2", name: "Игорь Петров", role: "kitchen")]
        }
        reports = [
            .init(id: "r1", author_id: "e2", type: "order", title: "Закончился кофе", description: "Нужно заказать 2 кг", status: "new", created_at: "2026-06-15T10:00:00Z"),
            .init(id: "r2", author_id: "e1", type: "breakdown", title: "Не работает кондиционер в зале", description: nil, status: "new", created_at: "2026-06-15T12:30:00Z"),
            .init(id: "r3", author_id: "e1", type: "suggestion", title: "Добавить веганское меню", description: "Часто спрашивают гости", status: "reviewed", created_at: "2026-06-14T18:00:00Z"),
        ]
        reportsLoaded = true
    }
    private func seedTech() {
        techCards = [
            .init(id: "tc1", name: "Хумус", category: "dish", items: ["Нут 200г замочить на ночь", "Отварить 1.5ч", "Блендер: нут, тахини, чеснок, лимон", "Оливковое масло сверху"]),
            .init(id: "tc2", name: "Маринад для шаурмы", category: "prep", items: ["Йогурт 500мл", "Паприка, кумин, чеснок", "Курица, мариновать 4ч"]),
        ]
        techLoaded = true
    }
    private func seedOrders() {
        orders = [
            .init(id: "o1", table_number: "4", status: "new", total: 29, created_at: "2026-06-15T17:40:00Z",
                  items: [.init(name: "Хумус", qty: 1, price: 8, opts: nil, call: nil),
                          .init(name: "Шаурма", qty: 1, price: 12, opts: ["острая"], call: nil),
                          .init(name: "Чай", qty: 3, price: 3, opts: nil, call: nil)]),
            .init(id: "o2", table_number: "7", status: "in_progress", total: 0, created_at: "2026-06-15T17:55:00Z",
                  items: [.init(name: nil, qty: nil, price: nil, opts: nil, call: "waiter")]),
            .init(id: "o3", table_number: "2", status: "done", total: 16, created_at: "2026-06-15T16:10:00Z",
                  items: [.init(name: "Фалафель", qty: 1, price: 9, opts: nil, call: nil),
                          .init(name: "Лимонад", qty: 1, price: 7, opts: nil, call: nil)]),
        ]
        ordersLoaded = true
    }
    #endif
}

