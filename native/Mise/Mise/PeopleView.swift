import SwiftUI
import CoreLocation
import UIKit

private let PEOPLE_ACCENT = BrandKit.people

private func eur(_ v: Double) -> String { Money.s(v) }

// Число без хвостовых нулей: 5.0 → "5", 1.5 → "1.5".
extension Double {
    var clean: String {
        truncatingRemainder(dividingBy: 1) == 0 ? String(Int(self)) : String(self)
    }
}

private let STATUS_ORDER = ["todo", "in_progress", "done"]
@MainActor private func statusLabel(_ s: String) -> String { t("pe.st." + (s == "in_progress" ? "inprogress" : s)) }
@MainActor private func prioLabel(_ p: String?) -> String { t("pe.prio." + (p ?? "medium")) }
private func prioColor(_ p: String?) -> Color { ["high": BrandKit.menu, "medium": BrandKit.stash, "low": Color.primary.opacity(0.4)][p ?? "medium"] ?? BrandKit.stash }
/// "yyyy-MM-dd" → "dd.MM" для бейджа срока задачи (ревью Б5/P3).
private func dueLabel(_ due: String) -> String {
    let parts = due.split(separator: "-")
    guard parts.count == 3 else { return due }
    return "\(parts[2]).\(parts[1])"
}

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
    var clType = "open"
    var openShiftId: String?           // id открытой смены Manager на сегодня (чек-лист привязан к ней)
    var clHistory: [ChecklistCompletion] = []
    var clHistoryLoaded = false

    // аудиты (разовые проверки, kind="audit" в тех же таблицах)
    var audits: [ShiftChecklist] = []
    var auditRuns: [ChecklistCompletion] = []
    var auditsLoaded = false

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
    }

    func loadSalary() async {
        #if DEBUG
        if ProcessInfo.processInfo.environment["MISE_DEMO_UI"] == "1" { seedSalary(); return }
        #endif
        let ym = String(key(Date()).prefix(7))
        async let empsR = try? DB.from("employees").select("id, name, salary, deduct_per_absence").eq("is_active", true).order("name").list(Employee.self)
        async let absR = try? DB.from("shift_absences").select("employee_id, date, source").gte("date", ym + "-01").list(Absence.self)
        async let cardsR = try? DB.from("monthly_card_amounts").select("employee_id, card_amount").eq("month", ym).list(CardAmount.self)
        guard let employees = await empsR else {
            if !salaryRows.isEmpty { flash(t("refreshFailed")) }
            return
        }
        let absences = (await absR) ?? [], cardAmounts = (await cardsR) ?? []

        // ym+"-31" в 30-дневных месяцах — невалидная дата для колонки типа date (400 → авансы
        // молча пропадали). Считаем реальный конец месяца.
        let advCal = Calendar.current
        let advStart = advCal.date(from: advCal.dateComponents([.year, .month], from: Date())) ?? Date()
        let advEnd = advCal.date(byAdding: DateComponents(month: 1, day: -1), to: advStart) ?? advStart
        let advances = (try? await DB.from("salary_advances").select()
            .gte("date", ym + "-01").lte("date", key(advEnd)).list(SalaryAdvance.self)) ?? []

        var list = employees.map { e -> SalRow in
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
            let total = max(0, (e.salary ?? 0) - deduct)
            let cash = max(0, total - advance - card)
            return SalRow(id: e.id, name: e.name, salary: e.salary ?? 0, absences: absN, absenceList: absenceList, deduct: deduct, card: card, advance: advance, advanceList: advForEmp, total: total, cash: cash)
        }
        if !isManager { list = list.filter { $0.name == myName } }
        salaryRows = list; salaryLoaded = true
    }
    var salaryFund: Double { salaryRows.reduce(0) { $0 + $1.total } }

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
        if allDone { flash(t("pe.checklistOpenDone")) }
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

    // MARK: журнал уведомлений (ревью Г2)

    var notifs: [AppNotification] = []
    var notifsLoaded = false
    var notifsUnread = 0

    /// Журнал получателя: staff — свои записи, владелец — to_owner.
    func loadNotifications() async {
        var q = DB.from("notifications").select()
        if myId == "owner" || myId.isEmpty { q = q.eq("to_owner", true) }
        else { q = q.eq("staff_id", myId) }
        if let rows = try? await q.order("created_at", ascending: false).limit(50).list(AppNotification.self) {
            notifs = rows
            notifsUnread = rows.filter { $0.read_at == nil }.count
        } else if !notifs.isEmpty {
            flash(t("refreshFailed"))
        }
        notifsLoaded = true
    }

    /// Открыл журнал — всё прочитано (как веб-колокольчик).
    func markNotificationsRead() async {
        let unread = notifs.filter { $0.read_at == nil }.map(\.id)
        guard !unread.isEmpty else { return }
        let now = ISO8601DateFormatter().string(from: Date())
        for i in notifs.indices where notifs[i].read_at == nil { notifs[i].read_at = now }
        notifsUnread = 0
        try? await DB.from("notifications").update(["read_at": now]).in("id", unread).run()
    }

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
        let clean = items.map { ChecklistItem(id: $0.id, label: $0.label.trimmingCharacters(in: .whitespaces), photo_required: $0.photo_required) }.filter { !$0.label.isEmpty }
        guard !clean.isEmpty else { flash(t("pe.addItem")); return }
        let roleVal: Any = role ?? NSNull()
        let itemDicts = clean.map { $0.asDict }
        // Расписание имеет смысл только для разовых аудитов — для kind="shift" всегда "none"/NULL.
        let recurrenceVal: Any = kind == "audit" ? recurrence : "none"
        let weekdaysVal: Any = kind == "audit" ? (recurrenceWeekdays ?? NSNull()) : NSNull()
        let domVal: Any = kind == "audit" ? (recurrenceDayOfMonth ?? NSNull()) : NSNull()
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
        await Notify.send(type: "swap_request", title: t("pe.swapRequestTitle"), body: t("pe.swapRequestBody", ["name": myName]),
                          audience: ["staff_ids": [targetId]], titleKey: "notify.swapRequestTitle",
                          bodyKey: "notify.swapRequestBody", bodyParams: ["name": myName, "date": ""])
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

// MARK: - Экран People

struct PeopleView: View {
    @Environment(AppModel.self) private var app
    @State private var m: PeopleModel?

    var body: some View {
        Group {
            if let m {
                PeopleBody(m: m)
                    .transition(.opacity)
            } else {
                PeopleSkeleton()
                    .transition(.opacity)
            }
        }
        .animation(.easeOut(duration: 0.3), value: m == nil)
        .task {
            if m == nil {
                let s = app.staff
                let model = PeopleModel(rid: app.restaurant?.id ?? "", myId: s?.id ?? "",
                                        myName: s?.name ?? "", isManager: (s?.isOwner ?? false) || s?.role == "manager" || s?.role == "admin",
                                        myRole: s?.role)
                m = model
                #if DEBUG
                if let t = ProcessInfo.processInfo.environment["MISE_DEMO_TAB"] { model.tab = t }
                if let o = ProcessInfo.processInfo.environment["MISE_DEMO_OPS"] { model.opsView = o }
                if let sv = ProcessInfo.processInfo.environment["MISE_DEMO_SHIFTS"] { model.shiftsView = sv }
                #endif
                await model.loadTasks()
                await model.loadOrders() // для бейджа активных заказов на вкладке «Зал»
            }
        }
    }
}

private struct PeopleBody: View {
    @Environment(AppModel.self) private var app
    @Bindable var m: PeopleModel
    @State private var showTaskForm = false

    var body: some View {
        ZStack(alignment: .bottom) {
            TabView(selection: $m.tab) {
                AppTabPage(refresh: { await refreshShifts() }) { ShiftsHubTab(m: m) }
                    .tabItem { Label(t("tab.shifts"), systemImage: "calendar") }.tag("shifts")
                AppTabPage(refresh: { await refreshTasks() }) { TasksTab(m: m, showForm: $showTaskForm) }
                    .tabItem { Label(t("tab.tasks"), systemImage: "checklist") }.tag("tasks")
                    .badge(m.newReportsCount)
                AppTabPage(refresh: { await refreshOps() }) { ZalTab(m: m) }
                    .tabItem { Label(t("tab.hall"), systemImage: "storefront") }.tag("ops")
                    .badge(m.activeOrders.isEmpty ? 0 : m.activeOrders.count)
                AppTabPage(refresh: { await m.loadPurchase() }) { PurchaseTab(m: m) }
                    .tabItem { Label(t("tab.purchase"), systemImage: "cart") }.tag("purchase")
                AppTabPage(refresh: { await m.loadSalary() }) { PeopleSalaryTab(m: m) }
                    .tabItem { Label(t("tab.salary"), systemImage: "creditcard.fill") }.tag("salary")
            }
            .tint(PEOPLE_ACCENT)
            .sensoryFeedback(.selection, trigger: m.tab)
            .tabEdgeSwipe(tabs: ["shifts", "tasks", "ops", "purchase", "salary"],
                          selection: $m.tab,
                          onFirstBack: app.availableApps.count > 1 ? { app.backToLauncher() } : nil)

            if let toast = m.toast {
                Text(toast).font(.system(size: 14, weight: .semibold)).foregroundStyle(.primary)
                    .padding(.horizontal, 18).padding(.vertical, 12)
                    .background(.ultraThinMaterial, in: Capsule())
                    .padding(.bottom, 60)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .animation(.easeInOut(duration: 0.2), value: m.toast)
        .sheet(isPresented: $showTaskForm) { TaskFormSheet(m: m) }
        .task(id: m.tab) {
            switch m.tab {
            case "tasks":
                if !m.tasksLoaded { await m.loadTasks() }
                if !m.reportsLoaded { await m.loadReports() }
            case "ops":
                if !m.menuLoaded { await m.loadMenu() }
                if !m.ordersLoaded { await m.loadOrders() }
            case "purchase": if !m.purchaseLoaded { await m.loadPurchase() }
            case "salary": if !m.salaryLoaded { await m.loadSalary() }
            default:       if !m.schedLoaded { await m.loadSchedule() }
            }
        }
    }

    private func refreshTasks() async {
        if m.tasksSeg == "reports" { await m.loadReports() } else { await m.loadTasks() }
    }
    private func refreshShifts() async {
        if m.shiftsView == "swaps" { await m.loadSwaps() }
        else { await m.loadAttendance(); await m.loadSchedule() }
    }
    private func refreshOps() async {
        switch m.opsView {
        case "orders": await m.loadOrders()
        case "check":  await m.loadChecklists()
        case "tech":   await m.loadTechCards()
        default:       await m.loadMenu()
        }
    }
}

// MARK: Задачи

private struct TasksTab: View {
    @Bindable var m: PeopleModel
    @Binding var showForm: Bool
    @State private var showDone = false
    @State private var pendingDelete: StaffTask?

    var body: some View {
        Picker("", selection: $m.tasksSeg) {
            Text(t("tab.tasks")).tag("tasks")
            Text(m.newReportsCount > 0 ? t("pe.reportsN", ["n": "\(m.newReportsCount)"]) : t("pe.reports")).tag("reports")
        }.pickerStyle(.segmented)

        if m.tasksSeg == "reports" {
            ReportsTab(m: m)
        } else {
            tasksContent
                .confirmationDialog(t("pe.deleteTask"),
                                    isPresented: Binding(get: { pendingDelete != nil }, set: { if !$0 { pendingDelete = nil } }),
                                    titleVisibility: .visible) {
                    Button(t("delete"), role: .destructive) {
                        if let task = pendingDelete { Task { await m.removeTask(task.id) } }; pendingDelete = nil
                    }
                    Button(t("cancel"), role: .cancel) { pendingDelete = nil }
                }
        }
    }

    @ViewBuilder private var tasksContent: some View {
        // Любой сотрудник может поставить задачу коллеге/сменщику (раньше — только менеджер).
        HStack(spacing: 10) {
            Button { showForm = true } label: {
                Label(t("pe.newTask"), systemImage: "plus")
                    .font(.system(size: 15, weight: .bold)).foregroundStyle(.white)
                    .frame(maxWidth: .infinity).padding(.vertical, 14)
                    .background(PEOPLE_ACCENT, in: RoundedRectangle(cornerRadius: 14))
            }
            // Голосовой ввод задачи
            if #available(iOS 17.0, *) {
                Button { Task { await m.voiceTask() } } label: {
                    Image(systemName: m.speech.isListening ? "mic.fill" : "mic")
                        .font(.system(size: 18, weight: .semibold))
                        .foregroundStyle(m.speech.isListening ? .white : PEOPLE_ACCENT)
                        .frame(width: 50, height: 50)
                        .background(m.speech.isListening ? PEOPLE_ACCENT : PEOPLE_ACCENT.opacity(0.12),
                                    in: RoundedRectangle(cornerRadius: 14))
                }
                .disabled(m.speech.isListening)
            }
        }
        if m.visibleTasks.isEmpty {
            Text(t("pe.noTasks")).font(.system(size: 15)).foregroundStyle(.primary.opacity(0.4)).padding(.top, 50)
        } else {
            ForEach(["todo", "in_progress"], id: \.self) { st in
                let group = m.tasks(st)
                if !group.isEmpty { taskGroup(statusLabel(st), group) }
            }
            let done = m.tasks("done")
            if !done.isEmpty {
                Button { withAnimation(.easeInOut(duration: 0.18)) { showDone.toggle() } } label: {
                    HStack {
                        Text(t("pe.doneN", ["n": "\(done.count)"]))
                            .font(.system(size: 12, weight: .semibold)).foregroundStyle(.primary.opacity(0.45)).kerning(0.5)
                        Spacer()
                        Image(systemName: showDone ? "chevron.up" : "chevron.down")
                            .font(.system(size: 11)).foregroundStyle(.primary.opacity(0.4))
                    }
                    .padding(.top, 6)
                }
                .buttonStyle(.plain)
                if showDone {
                    VStack(spacing: 0) {
                        ForEach(Array(done.enumerated()), id: \.element.id) { idx, task in
                            row(task)
                            if idx < done.count - 1 { Divider().overlay(Color.primary.opacity(0.08)).padding(.leading, 50) }
                        }
                    }
                    .background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 16))
                }
            }
        }
    }

    private func taskGroup(_ title: String, _ group: [StaffTask]) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("\(title) · \(group.count)".uppercased())
                .font(.system(size: 12, weight: .semibold)).foregroundStyle(.primary.opacity(0.45)).kerning(0.5)
                .padding(.top, 6)
            VStack(spacing: 0) {
                ForEach(Array(group.enumerated()), id: \.element.id) { idx, task in
                    row(task)
                    if idx < group.count - 1 { Divider().overlay(Color.primary.opacity(0.08)).padding(.leading, 50) }
                }
            }
            .background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 16))
        }
    }

    private func row(_ task: StaffTask) -> some View {
        let done = task.status == "done"
        return SwipeActionRow(
            leading: SwipeAction(label: done ? t("pe.reopen") : t("done"),
                                 systemImage: done ? "arrow.uturn.left" : "checkmark.circle.fill",
                                 tint: BrandKit.analytics) {
                Task { await m.setStatus(task, done ? "todo" : "done") }
            },
            trailing: m.canDelete(task) ? [
                SwipeAction(label: t("delete"), systemImage: "trash.fill", tint: BrandKit.menu) { pendingDelete = task }
            ] : []
        ) {
        HStack(alignment: .top, spacing: 12) {
            Button { Task { await m.setStatus(task, done ? "todo" : "done") } } label: {
                ZStack {
                    Circle().stroke(done ? PEOPLE_ACCENT : Color.primary.opacity(0.25), lineWidth: 2).frame(width: 22, height: 22)
                    if done { Circle().fill(PEOPLE_ACCENT).frame(width: 22, height: 22)
                        Image(systemName: "checkmark").font(.system(size: 11, weight: .bold)).foregroundStyle(.primary) }
                }
            }
            .buttonStyle(.plain)
            VStack(alignment: .leading, spacing: 4) {
                Text(task.title).font(.system(size: 15, weight: .medium))
                    .foregroundStyle(.primary.opacity(done ? 0.5 : 1)).strikethrough(done)
                if let d = task.description, !d.isEmpty {
                    Text(d).font(.system(size: 13)).foregroundStyle(.primary.opacity(0.45))
                }
                HStack(spacing: 8) {
                    Text(prioLabel(task.priority)).font(.system(size: 11, weight: .bold)).foregroundStyle(prioColor(task.priority))
                    Text("· \(m.staffName(task.assigned_to))").font(.system(size: 11)).foregroundStyle(.primary.opacity(0.4))
                    // Срок задачи (ревью Б5/P3): просрочка — красным, как на вебе.
                    if let due = task.due_date, !due.isEmpty {
                        let overdue = !done && due < m.todayKey
                        HStack(spacing: 3) {
                            Image(systemName: "calendar").font(.system(size: 9, weight: .bold))
                            Text(dueLabel(due)).font(.system(size: 11, weight: overdue ? .bold : .semibold))
                        }
                        .foregroundStyle(overdue ? BrandKit.menu : Color.primary.opacity(0.4))
                    }
                    if !done {
                        Button { Task { await m.setStatus(task, task.status == "todo" ? "in_progress" : "todo") } } label: {
                            Text(task.status == "todo" ? t("pe.toWork") : t("pe.return"))
                                .font(.system(size: 11, weight: .semibold)).foregroundStyle(PEOPLE_ACCENT)
                        }
                    }
                }
            }
            Spacer(minLength: 0)
            if m.canDelete(task) {
                Button { Task { await m.removeTask(task.id) } } label: {
                    Image(systemName: "trash").font(.system(size: 14)).foregroundStyle(.primary.opacity(0.3))
                }
                .buttonStyle(.plain)
            }
        }
        .padding(14)
        }
    }
}

private struct TaskFormSheet: View {
    @Bindable var m: PeopleModel
    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var desc = ""
    @State private var assignee = ""
    @State private var priority = "medium"
    @State private var hasDue = false
    @State private var dueDate = Date()

    var body: some View {
        NavigationStack {
            ZStack {
                Color.miseBg.ignoresSafeArea()
                Form {
                    Section {
                        TextField(t("pe.fTitle"), text: $title)
                        TextField(t("pe.descOptional"), text: $desc, axis: .vertical).lineLimit(2...4)
                    }
                    if m.isManager {
                        Section(t("pe.roleSection")) {
                            Picker(t("pe.assignee"), selection: $assignee) {
                                Text("—").tag("")
                                ForEach(TASK_ROLE_CODES, id: \.self) { code in
                                    Text(t("pe.role." + code) + " (\(t("pe.allRole")))").tag("role:" + code)
                                }
                            }
                        }
                        Section(t("pe.staffSection")) {
                            Picker(t("pe.assignee"), selection: $assignee) {
                                Text("—").tag("")
                                ForEach(m.dir) { Text($0.name).tag($0.id) }
                            }
                        }
                    } else {
                        Section(t("pe.assigneeSection")) {
                            Picker(t("pe.assignee"), selection: $assignee) {
                                Text("—").tag("")
                                ForEach(m.dir.filter { $0.role == m.myRole }) { Text($0.name).tag($0.id) }
                            }
                        }
                    }
                    Section(t("pe.priority")) {
                        Picker(t("pe.priority"), selection: $priority) {
                            Text(t("pe.prio.low")).tag("low"); Text(t("pe.prio.medium")).tag("medium"); Text(t("pe.prio.high")).tag("high")
                        }.pickerStyle(.segmented)
                    }
                    Section {
                        Toggle(t("pe.due"), isOn: $hasDue)
                        if hasDue {
                            DatePicker(t("an.date"), selection: $dueDate, displayedComponents: .date)
                        }
                    }
                }
                .scrollContentBackground(.hidden)
            }
            .navigationTitle(t("pe.newTaskTitle")).navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(t("cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(t("create")) {
                        let due = hasDue ? m.key(dueDate) : ""
                        Task { if await m.createTask(title: title, desc: desc, assignee: assignee, priority: priority, due: due) { dismiss() } }
                    }
                }
            }
            .toolbarBackground(Color.miseBg, for: .navigationBar)
        }
    }
}

// MARK: Заявки менеджеру

private let REPORT_TYPES: [(String, String, String)] = [
    ("suggestion", "Предложение", "lightbulb"),
    ("order", "Заказать", "cart"),
    ("breakdown", "Поломка", "wrench.and.screwdriver"),
    ("other", "Другое", "text.bubble"),
]
@MainActor private func reportTypeLabel(_ code: String?) -> String {
    let c = ["suggestion", "order", "breakdown", "other"].contains(code ?? "") ? code! : "other"
    return t("pe.rt." + c)
}
private func reportTypeIcon(_ t: String?) -> String { REPORT_TYPES.first { $0.0 == t }?.2 ?? "text.bubble" }
private func reportTypeColor(_ t: String?) -> Color {
    ["suggestion": BrandKit.analytics, "order": BrandKit.stash, "breakdown": BrandKit.menu][t ?? ""] ?? BrandKit.people
}

private struct ReportsTab: View {
    @Bindable var m: PeopleModel
    @State private var showForm = false

    var body: some View {
        Group {
            if !m.reportsLoaded {
                RowListSkeleton(rows: 3)
            } else {
                Button { showForm = true } label: {
                    Label(t("pe.newReport"), systemImage: "paperplane")
                        .font(.system(size: 15, weight: .bold)).foregroundStyle(.white)
                        .frame(maxWidth: .infinity).padding(.vertical, 14)
                        .background(PEOPLE_ACCENT, in: RoundedRectangle(cornerRadius: 14))
                }
                if m.visibleReports.isEmpty {
                    Text(m.isManager ? t("pe.noReports") : t("pe.noReportsMine"))
                        .font(.system(size: 15)).foregroundStyle(.primary.opacity(0.4)).padding(.top, 40)
                } else {
                    ForEach(m.visibleReports) { r in card(r) }
                }
            }
        }
        .task(id: m.tasksSeg) { if m.tasksSeg == "reports" && !m.reportsLoaded { await m.loadReports() } }
        .sheet(isPresented: $showForm) { ReportFormSheet(m: m) }
    }

    private func card(_ r: StaffReport) -> some View {
        let resolved = (r.status ?? "new") == "resolved"
        return VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Image(systemName: reportTypeIcon(r.type)).font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(reportTypeColor(r.type))
                Text(reportTypeLabel(r.type).uppercased())
                    .font(.system(size: 11, weight: .bold)).foregroundStyle(reportTypeColor(r.type)).kerning(0.5)
                Spacer()
                Text(reportStatusLabel(r.status)).font(.system(size: 11, weight: .bold))
                    .foregroundStyle(reportStatusColor(r.status))
                    .padding(.horizontal, 8).padding(.vertical, 2)
                    .background(reportStatusColor(r.status).opacity(0.16), in: Capsule())
            }
            Text(r.title).font(.system(size: 15, weight: .semibold))
                .foregroundStyle(.primary.opacity(resolved ? 0.5 : 1)).strikethrough(resolved)
            if let d = r.description, !d.isEmpty {
                Text(d).font(.system(size: 13)).foregroundStyle(.primary.opacity(0.55))
            }
            HStack(spacing: 10) {
                Text(m.staffName(r.author_id)).font(.system(size: 12)).foregroundStyle(.primary.opacity(0.4))
                Spacer()
                if m.isManager && !resolved {
                    if (r.status ?? "new") == "new" {
                        Button(t("pe.reviewed")) { Task { await m.setReportStatus(r, "reviewed") } }
                            .font(.system(size: 12, weight: .semibold)).foregroundStyle(PEOPLE_ACCENT)
                    }
                    Button(t("pe.resolved")) { Task { await m.setReportStatus(r, "resolved") } }
                        .font(.system(size: 12, weight: .semibold)).foregroundStyle(BrandKit.analytics)
                }
                if m.canDeleteReport(r) {
                    Button { Task { await m.deleteReport(r.id) } } label: {
                        Image(systemName: "trash").font(.system(size: 13)).foregroundStyle(.primary.opacity(0.3))
                    }
                }
            }
        }
        .padding(14).background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 16))
    }
    private func reportStatusLabel(_ s: String?) -> String {
        ["new": t("pe.repNew"), "reviewed": t("pe.reviewed"), "resolved": t("pe.resolved")][s ?? "new"] ?? t("pe.repNew")
    }
    private func reportStatusColor(_ s: String?) -> Color {
        ["reviewed": BrandKit.manager, "resolved": BrandKit.analytics][s ?? ""] ?? BrandKit.stash
    }
}

private struct ReportFormSheet: View {
    @Bindable var m: PeopleModel
    @Environment(\.dismiss) private var dismiss
    @State private var type = "suggestion"
    @State private var title = ""
    @State private var desc = ""

    var body: some View {
        NavigationStack {
            ZStack {
                Color.miseBg.ignoresSafeArea()
                Form {
                    Section(t("pe.type")) {
                        Picker(t("pe.type"), selection: $type) {
                            ForEach(REPORT_TYPES, id: \.0) { Text(t("pe.rt." + $0.0)).tag($0.0) }
                        }.pickerStyle(.menu)
                    }
                    Section {
                        TextField(t("pe.repShort"), text: $title)
                        TextField(t("pe.detailsOptional"), text: $desc, axis: .vertical).lineLimit(2...5)
                    }
                }
                .scrollContentBackground(.hidden)
            }
            .navigationTitle(t("pe.reportToManager")).navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(t("cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(t("send")) {
                        Task { if await m.createReport(type: type, title: title, desc: desc) { dismiss() } }
                    }
                }
            }
            .toolbarBackground(Color.miseBg, for: .navigationBar)
        }
    }
}

// MARK: Зарплата

private struct PeopleSalaryTab: View {
    @Bindable var m: PeopleModel
    @State private var open: String?

    var body: some View {
        if !m.salaryLoaded {
            RowListSkeleton(rows: 3)
        } else if m.salaryRows.isEmpty {
            Text(t("pe.noSalary")).font(.system(size: 15)).foregroundStyle(.primary.opacity(0.4)).padding(.top, 50)
        } else if !m.isManager, let r = m.salaryRows.first {
            staffCard(r)
            staffBreakdown(r)
        } else {
            heroCard
            ForEach(m.salaryRows) { r in
                VStack(spacing: 0) {
                    Button { withAnimation(.easeInOut(duration: 0.18)) { open = open == r.id ? nil : r.id } } label: {
                        HStack(spacing: 10) {
                            VStack(alignment: .leading, spacing: 3) {
                                Text(r.name).font(.system(size: 15, weight: .semibold)).foregroundStyle(.primary)
                                rowSubtitle(r)
                            }
                            Spacer()
                            VStack(alignment: .trailing, spacing: 2) {
                                Text(eur(r.cash)).font(.system(size: 16, weight: .bold)).foregroundStyle(PEOPLE_ACCENT)
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
                        staffBreakdown(r)
                            .padding(.horizontal, 14).padding(.bottom, 14)
                    }
                }
                .background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 14))
            }
        }
    }

    // MARK: hero (manager only)
    private var heroCard: some View {
        let totalCash = m.salaryRows.reduce(0) { $0 + $1.cash }
        let totalCard = m.salaryRows.reduce(0) { $0 + $1.card }
        let totalAdv  = m.salaryRows.reduce(0) { $0 + $1.advance }
        return VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 4) {
                Text(t("an.payrollFund")).font(.system(size: 12, weight: .semibold)).foregroundStyle(.white.opacity(0.75)).kerning(0.4)
                Text(eur(m.salaryFund)).font(.system(size: 34, weight: .heavy)).foregroundStyle(.white)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 18).padding(.top, 18).padding(.bottom, 14)
            Divider().overlay(Color.white.opacity(0.15))
            HStack(spacing: 0) {
                heroMini(t("byCash"), eur(totalCash), .white)
                Divider().frame(height: 28).overlay(Color.white.opacity(0.15))
                heroMini(t("toCard"), eur(totalCard), .white.opacity(0.85))
                if totalAdv > 0 {
                    Divider().frame(height: 28).overlay(Color.white.opacity(0.15))
                    heroMini(t("an.advance"), eur(totalAdv), .white.opacity(0.7))
                }
            }
            .padding(.vertical, 10)
        }
        .background(LinearGradient(colors: [PEOPLE_ACCENT, PEOPLE_ACCENT.opacity(0.75)],
                                   startPoint: .topLeading, endPoint: .bottomTrailing),
                    in: RoundedRectangle(cornerRadius: 20, style: .continuous))
    }

    // MARK: staff view — personal hero card
    private func staffCard(_ r: PeopleModel.SalRow) -> some View {
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 4) {
                Text(t("pe.toPay")).font(.system(size: 12, weight: .semibold)).foregroundStyle(.white.opacity(0.75)).kerning(0.4)
                Text(eur(r.cash)).font(.system(size: 36, weight: .heavy)).foregroundStyle(.white)
                Text(t("byCash")).font(.system(size: 13)).foregroundStyle(.white.opacity(0.7))
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 18).padding(.top, 18).padding(.bottom, 14)
            if r.card > 0 {
                Divider().overlay(Color.white.opacity(0.15))
                HStack { Text(t("toCard")).font(.system(size: 13)).foregroundStyle(.white.opacity(0.7))
                    Spacer()
                    Text(eur(r.card)).font(.system(size: 14, weight: .bold)).foregroundStyle(.white)
                }.padding(.horizontal, 18).padding(.vertical, 10)
            }
        }
        .background(LinearGradient(colors: [PEOPLE_ACCENT, PEOPLE_ACCENT.opacity(0.75)],
                                   startPoint: .topLeading, endPoint: .bottomTrailing),
                    in: RoundedRectangle(cornerRadius: 20, style: .continuous))
    }

    // MARK: breakdown — shared by staff view and manager expanded row
    @ViewBuilder
    private func staffBreakdown(_ r: PeopleModel.SalRow) -> some View {
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
                    bline(adv.date.map { shortDate($0) } ?? t("an.advance"), "−" + eur(adv.amount ?? 0), BrandKit.stash)
                }
            }

            if r.card > 0 {
                Divider().overlay(Color.primary.opacity(0.07)).padding(.vertical, 4)
                bline(t("toCard"), "−" + eur(r.card), BrandKit.manager)
            }
            Divider().overlay(Color.primary.opacity(0.1)).padding(.vertical, 4)
            bline(t("byCash"), eur(r.cash), PEOPLE_ACCENT, bold: true)
        }
        .padding(14)
        .background(Color.primary.opacity(0.05), in: RoundedRectangle(cornerRadius: 14))
    }

    // MARK: helpers
    private func rowSubtitle(_ r: PeopleModel.SalRow) -> some View {
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

// MARK: Смены (хаб: Расписание / Явка / Обмены)

private struct ShiftsHubTab: View {
    @Bindable var m: PeopleModel
    @State private var showNotifs = false
    var body: some View {
        HStack(spacing: 10) {
            Picker("", selection: $m.shiftsView) {
                Text(t("tab.shifts")).tag("shifts")
                if m.isManager { Text(t("pe.discipline")).tag("discipline") }
                Text(t("pe.swaps")).tag("swaps")
            }.pickerStyle(.segmented)
            // Журнал уведомлений (ревью Г2): пуш смахнул — информация больше не теряется.
            Button { showNotifs = true } label: {
                ZStack(alignment: .topTrailing) {
                    Image(systemName: "bell").font(.system(size: 16, weight: .semibold)).foregroundStyle(.primary.opacity(0.65))
                    if m.notifsUnread > 0 {
                        Circle().fill(BrandKit.menu).frame(width: 8, height: 8).offset(x: 3, y: -2)
                    }
                }
            }
            .buttonStyle(.plain)
        }
        .task { if !m.notifsLoaded { await m.loadNotifications() } }
        .sheet(isPresented: $showNotifs) { NotificationsSheet(m: m) }

        switch m.shiftsView {
        case "swaps": SwapsTab(m: m)
        case "discipline": DisciplineTab(m: m)
        default: CombinedShifts(m: m)
        }
    }
}

/// Журнал уведомлений (ревью Г2): notifications с перерендером title_key/body_key на языке
/// зрителя (NotifyStrings.swift) — тот же механизм, что веб-колокольчик. Открытие = прочитано.
private struct NotificationsSheet: View {
    @Bindable var m: PeopleModel

    var body: some View {
        NavigationStack {
            ZStack {
                Color.miseBg.ignoresSafeArea()
                if !m.notifsLoaded {
                    RowListSkeleton(rows: 4)
                } else if m.notifs.isEmpty {
                    VStack(spacing: 12) {
                        Image(systemName: "bell").font(.system(size: 34)).foregroundStyle(PEOPLE_ACCENT.opacity(0.5))
                        Text(t("pe.noNotifs")).font(.system(size: 15)).foregroundStyle(.primary.opacity(0.4))
                    }
                } else {
                    ScrollView {
                        VStack(spacing: 8) {
                            ForEach(m.notifs) { n in row(n) }
                        }
                        .padding(16)
                    }
                }
            }
            .navigationTitle(t("pe.notifications"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(Color.miseBg, for: .navigationBar)
        }
        .task {
            if !m.notifsLoaded { await m.loadNotifications() }
            await m.markNotificationsRead()
        }
    }

    private func row(_ n: AppNotification) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Circle().fill(n.read_at == nil ? PEOPLE_ACCENT : Color.clear).frame(width: 8, height: 8).padding(.top, 5)
            VStack(alignment: .leading, spacing: 3) {
                Text(notifTitle(n)).font(.system(size: 15, weight: .semibold)).foregroundStyle(.primary)
                if let body = notifBody(n), !body.isEmpty {
                    Text(body).font(.system(size: 13)).foregroundStyle(.primary.opacity(0.55))
                }
                Text(notifDate(n.created_at)).font(.system(size: 11)).foregroundStyle(.primary.opacity(0.35))
            }
            Spacer(minLength: 0)
        }
        .padding(14)
        .background(Color.primary.opacity(0.05), in: RoundedRectangle(cornerRadius: 14))
    }

    private func notifDate(_ iso: String?) -> String {
        guard let iso else { return "" }
        let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let f2 = ISO8601DateFormatter()
        guard let d = f.date(from: iso) ?? f2.date(from: iso) else { return "" }
        let out = DateFormatter(); out.locale = appLocale(); out.dateFormat = "dd.MM · HH:mm"
        return out.string(from: d)
    }
}

/// Смены + явка в одном разделе: сверху отметка прихода/статус, ниже — расписание.
private struct CombinedShifts: View {
    @Bindable var m: PeopleModel
    var body: some View {
        Group {
            AttendanceTab(m: m)
            ShiftsTab(m: m)
        }
        .task {
            if !m.attLoaded { await m.loadAttendance() }
            if !m.schedLoaded { await m.loadSchedule() }
        }
    }
}

// MARK: Явка

private struct AttendanceTab: View {
    @Bindable var m: PeopleModel
    var body: some View {
        Group {
            if !m.attLoaded {
                RowListSkeleton(rows: 3)
            } else if m.isManager {
                managerView
            } else {
                staffView
            }
        }
    }

    private var staffView: some View {
        VStack(spacing: 12) {
            if let rec = m.todayRec {
                VStack(spacing: 6) {
                    Image(systemName: "checkmark.circle.fill").font(.system(size: 40)).foregroundStyle(BrandKit.analytics)
                    Text(t("pe.onShift")).font(.system(size: 17, weight: .bold)).foregroundStyle(.primary)
                    Text(t("pe.arrivedAt", ["t": clock(rec.check_in_at)])).font(.system(size: 13)).foregroundStyle(.primary.opacity(0.5))
                    if rec.status == "late", let l = rec.late_minutes, l > 0 {
                        Text(t("pe.lateMin", ["n": "\(l)"])).font(.system(size: 12, weight: .semibold)).foregroundStyle(BrandKit.stash)
                    }
                    if rec.check_out_at == nil {
                        Button {
                            UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                            Task { await m.checkOut() }
                        } label: {
                            HStack {
                                if m.checking { ProgressView() }
                                else { Image(systemName: "figure.walk.departure"); Text(t("pe.iLeft")) }
                            }
                            .font(.system(size: 14, weight: .semibold)).foregroundStyle(BrandKit.people)
                            .frame(maxWidth: .infinity).padding(.vertical, 11)
                            .background(BrandKit.people.opacity(0.12), in: RoundedRectangle(cornerRadius: 12))
                        }
                        .padding(.top, 6)
                        .disabled(m.checking)
                    } else {
                        Text(t("pe.leftAt", ["t": clock(rec.check_out_at)])).font(.system(size: 13)).foregroundStyle(.primary.opacity(0.5))
                    }
                }
                .frame(maxWidth: .infinity).padding(20)
                .background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 18))
            } else if m.pendingCheckIn {
                // Явка записана локально, ожидает отправки на сервер
                VStack(spacing: 6) {
                    Image(systemName: "clock.badge.exclamationmark").font(.system(size: 36)).foregroundStyle(BrandKit.stash)
                    Text(t("pe.checkInPending")).font(.system(size: 15, weight: .semibold)).foregroundStyle(.primary)
                    Text(t("pe.checkInPendingHint")).font(.system(size: 12)).foregroundStyle(.primary.opacity(0.5)).multilineTextAlignment(.center)
                }
                .frame(maxWidth: .infinity).padding(20)
                .background(BrandKit.stash.opacity(0.12), in: RoundedRectangle(cornerRadius: 18))
            } else {
                Button {
                    UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                    Task { await m.checkIn() }
                } label: {
                    HStack {
                        if m.checking { ProgressView().tint(.white) }
                        else { Image(systemName: "location.fill"); Text(t("pe.iCame")) }
                    }
                    .font(.system(size: 17, weight: .bold)).foregroundStyle(.white)
                    .frame(maxWidth: .infinity).padding(.vertical, 18)
                    .background(PEOPLE_ACCENT, in: RoundedRectangle(cornerRadius: 16))
                }
                .disabled(m.checking)
            }
            historyList
        }
        .onReceive(NotificationCenter.default.publisher(for: UIApplication.willEnterForegroundNotification)) { _ in
            if m.pendingCheckIn { Task { await m.flushPendingCheckIn() } }
        }
    }

    private var historyList: some View {
        Group {
            if !m.attendance.isEmpty {
                VStack(alignment: .leading, spacing: 0) {
                    Text(t("pe.historyCaps")).font(.system(size: 12, weight: .semibold)).foregroundStyle(.primary.opacity(0.45)).kerning(0.5).padding(.bottom, 8)
                    VStack(spacing: 0) {
                        ForEach(Array(m.attendance.enumerated()), id: \.element.id) { i, r in
                            HStack {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(dayLabel(r.date ?? "")).font(.system(size: 14)).foregroundStyle(.primary)
                                    Text(clock(r.check_in_at) + (r.check_out_at != nil ? "–\(clock(r.check_out_at))" : ""))
                                        .font(.system(size: 12)).foregroundStyle(.primary.opacity(0.4))
                                }
                                Spacer()
                                if r.status == "late", let l = r.late_minutes {
                                    badge(t("pe.lateBadge", ["n": "\(l)"]), BrandKit.stash)
                                } else { badge(t("pe.onTime"), BrandKit.analytics) }
                            }
                            .padding(.vertical, 11).padding(.horizontal, 14)
                            if i < m.attendance.count - 1 { Divider().overlay(Color.primary.opacity(0.07)).padding(.leading, 14) }
                        }
                    }
                    .background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 16))
                }
            }
        }
    }

    private var managerView: some View {
        let scheduled = m.todayScheduledIds.isEmpty
            ? m.dir
            : m.dir.filter { m.todayScheduledIds.contains($0.id) }
        return VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text(t("pe.todayCaps")).font(.system(size: 12, weight: .semibold)).foregroundStyle(.primary.opacity(0.45)).kerning(0.5)
                Spacer()
                Button { m.shiftsView = "discipline" } label: {
                    Text(t("pe.disMore")).font(.system(size: 13, weight: .semibold)).foregroundStyle(PEOPLE_ACCENT)
                }
            }.padding(.bottom, 8)
            VStack(spacing: 0) {
                ForEach(Array(scheduled.enumerated()), id: \.element.id) { i, s in
                    let rec = m.attendance.first { $0.staff_id == s.id && $0.date == m.todayKey }
                    HStack {
                        Text(s.name).font(.system(size: 15)).foregroundStyle(.primary)
                        Spacer()
                        if let rec {
                            Text(clock(rec.check_in_at) + (rec.check_out_at != nil ? "–\(clock(rec.check_out_at))" : ""))
                                .font(.system(size: 14, weight: .semibold)).foregroundStyle(.primary)
                            if rec.status == "late", let l = rec.late_minutes { badge(t("pe.lateBadge", ["n": "\(l)"]), BrandKit.stash) }
                        } else {
                            Text(t("pe.notCame")).font(.system(size: 13)).foregroundStyle(.primary.opacity(0.35))
                        }
                    }
                    .padding(.vertical, 12).padding(.horizontal, 14)
                    if i < scheduled.count - 1 { Divider().overlay(Color.primary.opacity(0.07)).padding(.leading, 14) }
                }
            }
            .background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 16))
        }
        .padding(.top, 8)
    }

    private func badge(_ s: String, _ c: Color) -> some View {
        Text(s).font(.system(size: 11, weight: .bold)).foregroundStyle(c)
            .padding(.horizontal, 8).padding(.vertical, 2).background(c.opacity(0.16), in: Capsule())
    }
}

// MARK: Дисциплина (история опозданий)

private struct DisciplineTab: View {
    @Bindable var m: PeopleModel

    private func punctColor(_ p: Int?) -> Color {
        guard let p else { return .secondary }
        return p >= 95 ? .green : p >= 80 ? .orange : .red
    }

    var body: some View {
        Group {
            if !m.discLoaded {
                RowListSkeleton(rows: 3)
            } else if let sel = m.discSel {
                detail(sel)
            } else {
                overview
            }
        }
        .task(id: m.discPeriod) { await m.loadDiscipline() }
    }

    private var overview: some View {
        Group {
            Picker("", selection: $m.discPeriod) {
                Text(t("pe.perThisMonth")).tag("thisMonth")
                Text(t("pe.perLastMonth")).tag("lastMonth")
                Text(t("pe.per30")).tag("30d")
                Text(t("pe.per90")).tag("90d")
            }.pickerStyle(.segmented)

            if m.myId == "owner" {
                HStack {
                    Text(t("pe.disGrace")).font(.system(size: 13)).foregroundStyle(.primary.opacity(0.6))
                    Spacer()
                    ForEach([0, 5, 10, 15], id: \.self) { v in
                        Button { Task { await m.saveDiscGrace(v) } } label: {
                            Text("\(v)").font(.system(size: 13, weight: m.discGrace == v ? .bold : .regular))
                                .foregroundStyle(m.discGrace == v ? .white : .primary)
                                .frame(width: 32, height: 28)
                                .background(m.discGrace == v ? PEOPLE_ACCENT : Color.primary.opacity(0.08), in: RoundedRectangle(cornerRadius: 8))
                        }
                    }
                }
                .padding(12).background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 12))
            }

            if m.discRecords.isEmpty {
                Text(t("pe.disEmpty")).font(.system(size: 15)).foregroundStyle(.primary.opacity(0.4)).frame(maxWidth: .infinity).padding(.top, 50)
            } else {
                let ranked = m.dir.map { (s: $0, st: m.discStat($0.id)) }
                    .sorted { ($0.st.late, $0.st.totalMin) > ($1.st.late, $1.st.totalMin) }
                VStack(spacing: 0) {
                    ForEach(Array(ranked.enumerated()), id: \.element.s.id) { i, item in
                        Button { m.discSel = item.s.id } label: {
                            HStack {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(item.s.name).font(.system(size: 15)).foregroundStyle(.primary)
                                    Text(item.st.shifts == 0 ? t("pe.disNoData")
                                         : "\(item.st.shifts) \(t("pe.disShifts"))" + (item.st.late > 0 ? " · \(item.st.late) \(t("pe.disLates").lowercased()) · \(item.st.totalMin)\(t("pe.disMin"))" : ""))
                                        .font(.system(size: 12)).foregroundStyle(.primary.opacity(0.45))
                                }
                                Spacer()
                                if let p = item.st.punct {
                                    Text("\(p)%").font(.system(size: 14, weight: .bold)).foregroundStyle(punctColor(p))
                                }
                                Image(systemName: "chevron.right").font(.system(size: 13, weight: .semibold)).foregroundStyle(.primary.opacity(0.25))
                            }
                            .padding(.vertical, 12).padding(.horizontal, 14)
                        }
                        if i < ranked.count - 1 { Divider().overlay(Color.primary.opacity(0.07)).padding(.leading, 14) }
                    }
                }
                .background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 16))
            }
        }
    }

    private func detail(_ sid: String) -> some View {
        let s = m.dir.first { $0.id == sid }
        let st = m.discStat(sid)
        let recs = m.discRecords.filter { $0.staff_id == sid }
        var byDate: [String: AttendanceRecord] = [:]
        for r in recs { if let d = r.date { byDate[d] = r } }

        let cols = Array(repeating: GridItem(.flexible(), spacing: 8), count: 3)
        return VStack(alignment: .leading, spacing: 12) {
            Button { m.discSel = nil } label: {
                HStack(spacing: 6) { Image(systemName: "chevron.left"); Text(s?.name ?? "") }
                    .font(.system(size: 14, weight: .semibold)).foregroundStyle(.primary)
                    .padding(.vertical, 8).padding(.horizontal, 12)
                    .background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 10))
            }

            LazyVGrid(columns: cols, spacing: 8) {
                statCell(t("pe.punctuality"), st.punct == nil ? "—" : "\(st.punct!)%", punctColor(st.punct))
                statCell(t("pe.disLates"), "\(st.late)", st.late > 0 ? .orange : .green)
                statCell(t("pe.disShifts"), "\(st.shifts)", PEOPLE_ACCENT)
                statCell(t("pe.disTotal"), "\(st.totalMin)\(t("pe.disMin"))", .primary)
                statCell(t("pe.disAvg"), "\(st.avgMin)\(t("pe.disMin"))", .primary)
                statCell(t("pe.disMax"), "\(st.maxMin)\(t("pe.disMin"))", .primary)
            }

            ForEach(discMonths(), id: \.key) { mn in
                heatmap(year: mn.y, month: mn.m, byDate: byDate)
            }

            VStack(spacing: 0) {
                if recs.isEmpty {
                    Text(t("pe.disEmpty")).font(.system(size: 14)).foregroundStyle(.primary.opacity(0.4)).padding(20)
                } else {
                    ForEach(Array(recs.enumerated()), id: \.element.id) { i, r in
                        HStack {
                            Text("\(dayLabel(r.date ?? "")) · \(clock(r.check_in_at))").font(.system(size: 14)).foregroundStyle(.primary)
                            Spacer()
                            if r.late_minutes == nil {
                                Text(t("pe.disExtra")).font(.system(size: 11, weight: .semibold)).foregroundStyle(.secondary)
                            } else if (r.late_minutes ?? 0) > m.discGrace {
                                Text("+\(r.late_minutes!)\(t("pe.disMin"))").font(.system(size: 11, weight: .bold)).foregroundStyle(.orange)
                            } else {
                                Text(t("pe.disOnTime")).font(.system(size: 11, weight: .bold)).foregroundStyle(.green)
                            }
                        }
                        .padding(.vertical, 11).padding(.horizontal, 14)
                        if i < recs.count - 1 { Divider().overlay(Color.primary.opacity(0.07)).padding(.leading, 14) }
                    }
                }
            }
            .background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 16))

            Button { copySummary(s?.name ?? "", st) } label: {
                Text(t("pe.disCopy")).font(.system(size: 14, weight: .semibold)).foregroundStyle(.primary)
                    .frame(maxWidth: .infinity).padding(.vertical, 12)
                    .background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 12))
            }
        }
    }

    private func statCell(_ label: String, _ value: String, _ color: Color) -> some View {
        VStack(spacing: 3) {
            Text(value).font(.system(size: 16, weight: .bold)).foregroundStyle(color)
            Text(label).font(.system(size: 9.5, weight: .semibold)).foregroundStyle(.primary.opacity(0.45)).kerning(0.3)
        }
        .frame(maxWidth: .infinity).padding(.vertical, 12)
        .background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 14))
    }

    private func heatmap(year: Int, month: Int, byDate: [String: AttendanceRecord]) -> some View {
        let cal = Calendar.current
        let comps = DateComponents(year: year, month: month, day: 1)
        let first = cal.date(from: comps) ?? Date()
        let days = cal.range(of: .day, in: .month, for: first)?.count ?? 30
        let lead = (cal.component(.weekday, from: first) + 5) % 7 // Пн=0
        let mf = DateFormatter(); mf.locale = appLocale(); mf.dateFormat = "LLLL yyyy"
        let cols = Array(repeating: GridItem(.flexible(), spacing: 5), count: 7)
        let wdf = DateFormatter(); wdf.locale = appLocale()
        let wd = wdf.veryShortWeekdaySymbols ?? ["S", "M", "T", "W", "T", "F", "S"]
        let wdMon = Array(wd[1...] + wd[..<1]) // сдвиг с воскресенья на понедельник

        return VStack(alignment: .leading, spacing: 8) {
            Text(mf.string(from: first).capitalized).font(.system(size: 13, weight: .bold)).foregroundStyle(.primary)
            LazyVGrid(columns: cols, spacing: 5) {
                ForEach(wdMon, id: \.self) { d in Text(d).font(.system(size: 9)).foregroundStyle(.secondary) }
                ForEach(0..<lead, id: \.self) { _ in Color.clear.frame(height: 26) }
                ForEach(1...days, id: \.self) { day in
                    let key = String(format: "%04d-%02d-%02d", year, month, day)
                    cell(day: day, rec: byDate[key])
                }
            }
        }
        .padding(14).background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 16))
    }

    private func cell(day: Int, rec: AttendanceRecord?) -> some View {
        let color: Color
        if let r = rec {
            if r.late_minutes == nil { color = Color.secondary.opacity(0.5) }
            else { color = (r.late_minutes! > m.discGrace) ? .orange : .green }
        } else { color = Color.primary.opacity(0.06) }
        return Text("\(day)")
            .font(.system(size: 10, weight: .semibold))
            .foregroundStyle(rec == nil ? Color.secondary : Color.white)
            .frame(maxWidth: .infinity).frame(height: 26)
            .background(color, in: RoundedRectangle(cornerRadius: 6))
    }

    private func discMonths() -> [(key: String, y: Int, m: Int)] {
        let (from, to) = m.discRange()
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.locale = Locale(identifier: "en_US_POSIX")
        guard let start = f.date(from: from), let end = f.date(from: to) else { return [] }
        let cal = Calendar.current
        var cur = cal.date(from: cal.dateComponents([.year, .month], from: start)) ?? start
        var arr: [(key: String, y: Int, m: Int)] = []
        while cur <= end {
            let c = cal.dateComponents([.year, .month], from: cur)
            let y = c.year ?? 0, mo = c.month ?? 0
            arr.append((key: "\(y)-\(mo)", y: y, m: mo))
            guard let next = cal.date(byAdding: .month, value: 1, to: cur) else { break }
            cur = next
        }
        return arr
    }

    private func copySummary(_ name: String, _ st: PeopleModel.DiscStat) {
        let (from, to) = m.discRange()
        let lines = [
            "\(name) · \(from)–\(to)",
            "\(t("pe.punctuality")): \(st.punct == nil ? "—" : "\(st.punct!)%")",
            "\(t("pe.disShifts")): \(st.shifts) · \(t("pe.disOnTime")): \(st.onTime) · \(t("pe.disLates")): \(st.late)",
            "\(t("pe.disTotal")): \(st.totalMin)\(t("pe.disMin")) · \(t("pe.disAvg")): \(st.avgMin)\(t("pe.disMin")) · \(t("pe.disMax")): \(st.maxMin)\(t("pe.disMin"))",
        ]
        UIPasteboard.general.string = lines.joined(separator: "\n")
        m.flash(t("pe.pCopied"))
    }
}

// MARK: Обмены

private struct SwapsTab: View {
    @Bindable var m: PeopleModel
    @State private var showCreate = false
    var body: some View {
        Group {
            if !m.swapsLoaded {
                RowListSkeleton(rows: 3)
            } else {
                if !m.isManager {
                    Button { showCreate = true } label: {
                        Label(t("pe.proposeSwap"), systemImage: "arrow.left.arrow.right")
                            .font(.system(size: 15, weight: .bold)).foregroundStyle(m.myUpcomingScheds.isEmpty ? .white.opacity(0.4) : .white)
                            .frame(maxWidth: .infinity).padding(.vertical, 14)
                            .background(m.myUpcomingScheds.isEmpty ? Color.primary.opacity(0.06) : PEOPLE_ACCENT, in: RoundedRectangle(cornerRadius: 14))
                    }
                    .disabled(m.myUpcomingScheds.isEmpty)
                }
                Picker("", selection: $m.swapSeg) {
                    Text(m.isManager ? t("pe.toApprove") : t("pe.incoming")).tag("incoming")
                    Text(m.isManager ? t("pe.all") : t("pe.outgoing")).tag("outgoing")
                }.pickerStyle(.segmented)
                let list = listFor()
                if list.isEmpty {
                    Text(t("pe.noSwaps")).font(.system(size: 15)).foregroundStyle(.primary.opacity(0.4)).padding(.top, 50)
                } else {
                    ForEach(list) { r in card(r) }
                }
            }
        }
        .task(id: m.shiftsView) { if m.shiftsView == "swaps" && !m.swapsLoaded { await m.loadSwaps() } }
        .sheet(isPresented: $showCreate) { SwapCreateSheet(m: m) }
    }

    private func listFor() -> [SwapRequest] {
        if m.isManager { return m.swapSeg == "incoming" ? m.managerQueueSwaps : m.swaps }
        return m.swapSeg == "incoming" ? m.incomingSwaps : m.outgoingSwaps
    }

    private func card(_ r: SwapRequest) -> some View {
        let sc = m.swapSched(r.schedule_id)
        let iAmTarget = r.target_id == m.myId
        let iAmRequester = r.requester_id == m.myId
        return VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(sc != nil ? "\(dayLabel(sc!.date)) · \(hhmm(sc!.shift_start))–\(hhmm(sc!.shift_end))" : t("pe.shiftWord"))
                    .font(.system(size: 15, weight: .bold)).foregroundStyle(.primary)
                Spacer()
                Text(swapStatusLabel(r.status)).font(.system(size: 11, weight: .bold)).foregroundStyle(swapStatusColor(r.status))
                    .padding(.horizontal, 8).padding(.vertical, 3).background(swapStatusColor(r.status).opacity(0.16), in: Capsule())
            }
            Text("\(m.staffName(r.requester_id)) → \(m.staffName(r.target_id))")
                .font(.system(size: 13)).foregroundStyle(.primary.opacity(0.5))
            if let n = r.note, !n.isEmpty { Text("«\(n)»").font(.system(size: 13)).foregroundStyle(.primary.opacity(0.7)) }

            if r.status == "pending_peer" && iAmTarget {
                HStack(spacing: 8) {
                    actBtn(t("pe.accept"), true) { Task { await m.swapPeerAccept(r) } }
                    actBtn(t("pe.declineBtn"), false) { Task { await m.swapPeerDecline(r) } }
                }
            } else if r.status == "pending_peer" && iAmRequester {
                actBtn(t("pe.cancelReq"), false) { Task { await m.swapCancel(r) } }
            } else if r.status == "peer_accepted" && m.isManager {
                HStack(spacing: 8) {
                    actBtn(t("pe.approve"), true) { Task { await m.swapApprove(r) } }
                    actBtn(t("pe.declineBtn"), false) { Task { await m.swapReject(r) } }
                }
            }
        }
        .padding(14).background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 16))
    }

    private func actBtn(_ title: String, _ primary: Bool, _ a: @escaping () -> Void) -> some View {
        Button(action: a) {
            Text(title).font(.system(size: 14, weight: .semibold))
                .foregroundStyle(primary ? .white : .white.opacity(0.7))
                .frame(maxWidth: .infinity).padding(.vertical, 11)
                .background(primary ? PEOPLE_ACCENT : Color.primary.opacity(0.08), in: RoundedRectangle(cornerRadius: 12))
        }
    }
    private func swapStatusLabel(_ s: String?) -> String {
        ["pending_peer": t("pe.swap.pendingPeer"), "peer_accepted": t("pe.swap.peerAccepted"), "approved": t("pe.swap.approved"),
         "rejected": t("pe.swap.rejected"), "peer_declined": t("pe.swap.rejected"), "cancelled": t("pe.swap.cancelled")][s ?? ""] ?? "—"
    }
    private func swapStatusColor(_ s: String?) -> Color {
        ["approved": BrandKit.analytics, "rejected": BrandKit.menu, "peer_declined": BrandKit.menu,
         "cancelled": Color.primary.opacity(0.4)][s ?? ""] ?? BrandKit.stash
    }
}

private struct SwapCreateSheet: View {
    @Bindable var m: PeopleModel
    @Environment(\.dismiss) private var dismiss
    @State private var scheduleId = ""
    @State private var targetId = ""
    @State private var note = ""

    var body: some View {
        NavigationStack {
            ZStack {
                Color.miseBg.ignoresSafeArea()
                Form {
                    Section(t("pe.myShift")) {
                        Picker(t("pe.shiftWord"), selection: $scheduleId) {
                            Text("—").tag("")
                            ForEach(m.myUpcomingScheds) { s in
                                Text("\(dayLabel(s.date)) · \(hhmm(s.shift_start))–\(hhmm(s.shift_end))").tag(s.id)
                            }
                        }
                    }
                    Section(t("pe.toWhom")) {
                        Picker(t("pe.colleague"), selection: $targetId) {
                            Text("—").tag("")
                            ForEach(m.dir.filter { $0.id != m.myId && $0.role == m.myRole }) { Text($0.name).tag($0.id) }
                        }
                    }
                    Section(t("pe.comment")) {
                        TextField(t("pe.optional"), text: $note, axis: .vertical).lineLimit(1...3)
                    }
                }
                .scrollContentBackground(.hidden)
            }
            .navigationTitle(t("pe.proposeSwap")).navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(t("cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(t("send")) {
                        Task { if await m.createSwap(scheduleId: scheduleId, targetId: targetId, note: note) { dismiss() } }
                    }
                }
            }
            .toolbarBackground(Color.miseBg, for: .navigationBar)
        }
    }
}

// MARK: Смены (расписание)

private struct ShiftsCalendar: View {
    @Bindable var m: PeopleModel

    private let cal = Calendar.current

    private var monthStart: Date {
        cal.date(from: cal.dateComponents([.year, .month], from: m.calendarMonth)) ?? m.calendarMonth
    }
    private var daysInMonth: Int { cal.range(of: .day, in: .month, for: monthStart)?.count ?? 30 }
    private var firstOffset: Int {
        let wd = cal.component(.weekday, from: monthStart) // 1=Sun…7=Sat
        return (wd + 5) % 7 // Mon→0 … Sun→6
    }
    private var monthLabel: String {
        let fmt = DateFormatter()
        fmt.dateFormat = "LLLL yyyy"
        let map = ["ru": "ru_RU", "en": "en_US", "it": "it_IT", "fr": "fr_FR",
                   "az": "az_AZ", "tr": "tr_TR", "uk": "uk_UA", "kk": "kk_KZ"]
        fmt.locale = Locale(identifier: map[L10n.shared.lang.rawValue] ?? "en_US")
        return fmt.string(from: monthStart).capitalized
    }
    private var scheduledDates: Set<String> { Set(m.schedules.map { $0.date }) }
    private func dateStr(day: Int) -> String {
        let comps = DateComponents(year: cal.component(.year, from: monthStart),
                                   month: cal.component(.month, from: monthStart), day: day)
        guard let d = cal.date(from: comps) else { return "" }
        return m.key(d)
    }
    private var weekdayHeaders: [String] {
        let s = cal.veryShortWeekdaySymbols // ["S","M","T","W","T","F","S"] starts Sun
        return Array(s[1...]) + [s[0]]      // Mon first
    }

    var body: some View {
        VStack(spacing: 10) {
            // Month navigation
            HStack {
                Button { Task { await m.prevMonth() } } label: {
                    Image(systemName: "chevron.left")
                        .font(.system(size: 15, weight: .semibold)).foregroundStyle(.primary)
                        .frame(width: 32, height: 32)
                }
                Spacer()
                Text(monthLabel).font(.system(size: 15, weight: .bold)).foregroundStyle(.primary)
                Spacer()
                Button { Task { await m.nextMonth() } } label: {
                    Image(systemName: "chevron.right")
                        .font(.system(size: 15, weight: .semibold)).foregroundStyle(.primary)
                        .frame(width: 32, height: 32)
                }
            }

            // Weekday headers
            HStack(spacing: 0) {
                ForEach(0..<7, id: \.self) { i in
                    Text(weekdayHeaders[i])
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(.primary.opacity(0.35))
                        .frame(maxWidth: .infinity)
                }
            }

            // Day grid
            let columns = Array(repeating: GridItem(.flexible(), spacing: 0), count: 7)
            LazyVGrid(columns: columns, spacing: 4) {
                ForEach(0..<(firstOffset + daysInMonth), id: \.self) { i in
                    if i < firstOffset {
                        Color.clear.frame(height: 36)
                    } else {
                        let day = i - firstOffset + 1
                        let ds = dateStr(day: day)
                        let isToday = ds == m.todayKey
                        let hasShift = scheduledDates.contains(ds)
                        let isSel = m.selectedCalDate == ds

                        Button {
                            withAnimation(.spring(duration: 0.2)) {
                                m.selectedCalDate = isSel ? nil : ds
                            }
                        } label: {
                            VStack(spacing: 3) {
                                Text("\(day)")
                                    .font(.system(size: 13, weight: isToday ? .bold : .regular))
                                    .foregroundStyle(isSel ? .white : (isToday ? PEOPLE_ACCENT : .primary))
                                Circle()
                                    .fill(hasShift
                                          ? (isSel ? Color.white.opacity(0.8) : PEOPLE_ACCENT)
                                          : Color.clear)
                                    .frame(width: 4, height: 4)
                            }
                            .frame(maxWidth: .infinity, minHeight: 36)
                            .background(isSel ? PEOPLE_ACCENT
                                        : (isToday ? PEOPLE_ACCENT.opacity(0.12) : Color.clear),
                                        in: RoundedRectangle(cornerRadius: 8))
                        }
                        .buttonStyle(.plain)
                        .disabled(!hasShift)
                    }
                }
            }

            // Inline detail for selected day
            if let sel = m.selectedCalDate {
                let items = m.schedules.filter { $0.date == sel }
                if !items.isEmpty {
                    VStack(spacing: 0) {
                        ForEach(Array(items.enumerated()), id: \.element.id) { idx, s in
                            HStack {
                                if m.isManager {
                                    Text(m.staffName(s.staff_id))
                                        .font(.system(size: 14)).foregroundStyle(.primary)
                                }
                                Spacer()
                                Text("\(hhmm(s.shift_start))–\(hhmm(s.shift_end))")
                                    .font(.system(size: 14, weight: .semibold)).foregroundStyle(PEOPLE_ACCENT)
                                if m.isManager {
                                    Button { Task { await m.deleteSchedule(s.id) } } label: {
                                        Image(systemName: "trash")
                                            .font(.system(size: 12)).foregroundStyle(.primary.opacity(0.3))
                                    }
                                    .padding(.leading, 8)
                                }
                            }
                            .padding(.vertical, 10).padding(.horizontal, 14)
                            if idx < items.count - 1 {
                                Divider().overlay(Color.primary.opacity(0.07)).padding(.leading, 14)
                            }
                        }
                    }
                    .background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 14))
                    .transition(.move(edge: .top).combined(with: .opacity))
                }
            }
        }
        .padding(14)
        .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 18))
    }
}

private struct ShiftsTab: View {
    @Bindable var m: PeopleModel
    @State private var showAdd = false

    var body: some View {
        if !m.schedLoaded {
            RowListSkeleton(rows: 3)
        } else {
            ShiftsCalendar(m: m)
            if m.isManager { managerControls }
            if m.schedByDate.isEmpty {
                Text(m.isManager ? t("pe.scheduleEmptyMgr") : t("pe.scheduleEmptyStaff"))
                    .font(.system(size: 15)).foregroundStyle(.primary.opacity(0.4))
                    .multilineTextAlignment(.center).padding(.top, 20)
            } else {
                ForEach(m.schedByDate, id: \.0) { date, items in
                    VStack(alignment: .leading, spacing: 0) {
                        Text(dayLabel(date).uppercased())
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(.primary.opacity(0.45)).kerning(0.5)
                            .padding(.bottom, 8)
                        VStack(spacing: 0) {
                            ForEach(Array(items.enumerated()), id: \.element.id) { idx, s in
                                HStack {
                                    Text(m.staffName(s.staff_id))
                                        .font(.system(size: 15)).foregroundStyle(.primary)
                                    Spacer()
                                    Text("\(hhmm(s.shift_start))–\(hhmm(s.shift_end))")
                                        .font(.system(size: 14, weight: .semibold)).foregroundStyle(PEOPLE_ACCENT)
                                    if m.isManager {
                                        Button { Task { await m.deleteSchedule(s.id) } } label: {
                                            Image(systemName: "trash")
                                                .font(.system(size: 13)).foregroundStyle(.primary.opacity(0.3))
                                        }
                                        .padding(.leading, 8)
                                    }
                                }
                                .padding(.vertical, 11).padding(.horizontal, 14)
                                if idx < items.count - 1 {
                                    Divider().overlay(Color.primary.opacity(0.08)).padding(.leading, 14)
                                }
                            }
                        }
                        .background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 14))
                    }
                    .padding(.bottom, 4)
                }
            }
        }
    }

    private var managerControls: some View {
        HStack(spacing: 10) {
            Button { showAdd = true } label: {
                Label(t("pe.addShift"), systemImage: "plus")
                    .font(.system(size: 14, weight: .bold)).foregroundStyle(.white)
                    .minimumScaleFactor(0.7).lineLimit(1)
                    .frame(maxWidth: .infinity).padding(.vertical, 12)
                    .background(PEOPLE_ACCENT, in: RoundedRectangle(cornerRadius: 12))
            }
            Button { Task { await m.copyLastWeek() } } label: {
                Label(t("pe.lastWeek"), systemImage: "doc.on.doc")
                    .font(.system(size: 14, weight: .semibold)).foregroundStyle(PEOPLE_ACCENT)
                    .minimumScaleFactor(0.7).lineLimit(1)
                    .frame(maxWidth: .infinity).padding(.vertical, 12)
                    .background(PEOPLE_ACCENT.opacity(0.14), in: RoundedRectangle(cornerRadius: 12))
            }
        }
        .sheet(isPresented: $showAdd) { ScheduleEditSheet(m: m) }
    }
}

private struct ScheduleEditSheet: View {
    @Bindable var m: PeopleModel
    @Environment(\.dismiss) private var dismiss
    @State private var staffId = ""
    @State private var dates: Set<DateComponents> = []
    @State private var start = Calendar.current.date(bySettingHour: 10, minute: 0, second: 0, of: Date()) ?? Date()
    @State private var end = Calendar.current.date(bySettingHour: 22, minute: 0, second: 0, of: Date()) ?? Date()
    @State private var note = ""

    private let timeFmt: DateFormatter = {
        let f = DateFormatter(); f.dateFormat = "HH:mm:ss"; f.locale = Locale(identifier: "en_US_POSIX"); return f
    }()

    var body: some View {
        NavigationStack {
            ZStack {
                Color.miseBg.ignoresSafeArea()
                Form {
                    Section(t("pe.staffOne")) {
                        Picker(t("pe.who"), selection: $staffId) {
                            Text("—").tag("")
                            ForEach(m.dir) { Text($0.name).tag($0.id) }
                        }
                    }
                    // Несколько дат сразу: выбрать сотрудника → отметить дни → одно время на все.
                    Section(dates.isEmpty ? t("pe.dates") : t("pe.datesN", ["n": "\(dates.count)"])) {
                        MultiDatePicker(t("pe.dates"), selection: $dates)
                            .frame(maxHeight: 320)
                    }
                    Section(t("pe.time")) {
                        DatePicker(t("pe.start"), selection: $start, displayedComponents: .hourAndMinute)
                        DatePicker(t("pe.end"), selection: $end, displayedComponents: .hourAndMinute)
                    }
                    Section(t("pe.note")) {
                        TextField(t("pe.optional"), text: $note)
                    }
                }
                .scrollContentBackground(.hidden)
            }
            .navigationTitle(t("pe.newShift")).navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(t("cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(t("save")) {
                        let s = timeFmt.string(from: start), e = timeFmt.string(from: end)
                        let keys = dates.compactMap { Calendar.current.date(from: $0).map { m.key($0) } }.sorted()
                        Task {
                            if await m.createSchedules(staffId: staffId, dates: keys, start: s, end: e, note: note) { dismiss() }
                        }
                    }
                }
            }
            .toolbarBackground(Color.miseBg, for: .navigationBar)
        }
    }
}

// MARK: Зал (стоп-лист + заказы)

private struct ZalTab: View {
    @Bindable var m: PeopleModel
    var body: some View {
        Picker("", selection: $m.opsView) {
            Text(t("pe.stop")).tag("stop")
            Text(m.activeOrders.isEmpty ? t("pe.orders") : t("pe.ordersN", ["n": "\(m.activeOrders.count)"])).tag("orders")
            Text(t("pe.checklists")).tag("check")
            if m.canTech { Text(t("pe.techcards")).tag("tech") }
        }.pickerStyle(.segmented)
        switch m.opsView {
        case "orders": OrdersInbox(m: m)
        case "check":  ChecklistsTab(m: m)
        case "tech":   TechCardsTab(m: m)
        default:       StopTab(m: m)
        }
    }
}

// MARK: Закуп

let PURCHASE_CATS_IOS: [(id: String, label: String)] = [
    ("kitchen", "pe.catKitchen"), ("bar", "pe.catBar"), ("hookah", "pe.catHookah"),
    ("household", "pe.catHousehold"), ("general", "pe.catGeneral"),
]

@MainActor func purchaseCatLabel(_ id: String) -> String {
    PURCHASE_CATS_IOS.first { $0.id == id }.map { t($0.label) } ?? id
}

private struct PurchaseTab: View {
    @Bindable var m: PeopleModel
    @State private var showForm = false
    @State private var pendingDelete: PurchaseItem?

    var body: some View {
        Group {
            Button { showForm = true } label: {
                Label(t("pe.pAddItems"), systemImage: "plus")
                    .font(.system(size: 15, weight: .bold)).foregroundStyle(.white)
                    .frame(maxWidth: .infinity).padding(.vertical, 13)
                    .background(RoundedRectangle(cornerRadius: 14).fill(PEOPLE_ACCENT))
            }

            Picker("", selection: $m.purchaseSeg) {
                Text(m.purchaseTodo.isEmpty ? t("pe.pToBuy") : "\(t("pe.pToBuy")) · \(m.purchaseTodo.count)").tag("todo")
                Text(t("pe.pDone")).tag("done")
            }.pickerStyle(.segmented)

            if m.purchaseSeg == "todo" && m.isManager && !m.purchaseTodo.isEmpty {
                HStack(spacing: 8) {
                    Button { copyList() } label: {
                        Label(t("pe.pCopy"), systemImage: "doc.on.doc")
                            .font(.system(size: 14, weight: .semibold)).frame(maxWidth: .infinity).padding(.vertical, 10)
                            .background(RoundedRectangle(cornerRadius: 12).fill(.primary.opacity(0.06)))
                    }.tint(.primary)
                    Button { waList() } label: {
                        Label("WhatsApp", systemImage: "paperplane.fill")
                            .font(.system(size: 14, weight: .semibold)).foregroundStyle(Color(red: 0.12, green: 0.67, blue: 0.32))
                            .frame(maxWidth: .infinity).padding(.vertical, 10)
                            .background(RoundedRectangle(cornerRadius: 12).fill(Color(red: 0.12, green: 0.67, blue: 0.32).opacity(0.12)))
                    }
                }
            }

            let list = m.purchaseSeg == "todo" ? m.purchaseTodo : m.purchaseDone
            if !m.purchaseLoaded {
                RowListSkeleton(rows: 3)
            } else if list.isEmpty {
                VStack(spacing: 4) {
                    Text(m.purchaseSeg == "todo" ? t("pe.pEmpty") : t("pe.pDone")).font(.system(size: 16, weight: .semibold)).foregroundStyle(.primary.opacity(0.7))
                    if m.purchaseSeg == "todo" { Text(t("pe.pEmptyHint")).font(.system(size: 13)).foregroundStyle(.primary.opacity(0.4)) }
                }.frame(maxWidth: .infinity).padding(.top, 50)
            } else {
                let cats = list.map { $0.category }.reduce(into: [String]()) { if !$0.contains($1) { $0.append($1) } }
                ForEach(cats, id: \.self) { cid in
                    VStack(alignment: .leading, spacing: 8) {
                        Text(purchaseCatLabel(cid).uppercased()).font(.system(size: 12, weight: .bold)).foregroundStyle(.primary.opacity(0.45))
                            .frame(maxWidth: .infinity, alignment: .leading)
                        ForEach(list.filter { $0.category == cid }) { it in row(it) }
                    }
                }
            }
        }
        .task { if !m.purchaseLoaded { await m.loadPurchase() } }
        .sheet(isPresented: $showForm) { PurchaseFormSheet(m: m) }
        .confirmationDialog(t("pe.deletePurchase"),
                            isPresented: Binding(get: { pendingDelete != nil }, set: { if !$0 { pendingDelete = nil } }),
                            titleVisibility: .visible) {
            Button(t("delete"), role: .destructive) {
                if let it = pendingDelete { Task { await m.removePurchase(it) } }; pendingDelete = nil
            }
            Button(t("cancel"), role: .cancel) { pendingDelete = nil }
        }
    }

    private func row(_ it: PurchaseItem) -> some View {
        SwipeActionRow(
            leading: (m.purchaseSeg == "todo" && m.isManager) ? SwipeAction(label: t("pe.pDone"), systemImage: "checkmark.circle.fill", tint: BrandKit.analytics) {
                Task { await m.setPurchaseStatus(it, "bought") }
            } : nil,
            trailing: (m.isManager || it.created_by == m.myId) ? [
                SwipeAction(label: t("delete"), systemImage: "trash.fill", tint: BrandKit.menu) { pendingDelete = it }
            ] : []
        ) {
        HStack(spacing: 12) {
            if m.purchaseSeg == "todo" && m.isManager {
                Button { Task { await m.setPurchaseStatus(it, "bought") } } label: {
                    Image(systemName: "circle").font(.system(size: 22)).foregroundStyle(.primary.opacity(0.3))
                }
            }
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(it.name).font(.system(size: 15, weight: .semibold)).foregroundStyle(.primary)
                        .strikethrough(it.status == "bought")
                    if let q = it.qty { Text("· \(q.clean)\(it.unit.map { " \($0)" } ?? "")").font(.system(size: 14)).foregroundStyle(.primary.opacity(0.45)) }
                    else if let u = it.unit { Text("· \(u)").font(.system(size: 14)).foregroundStyle(.primary.opacity(0.45)) }
                }
                if let by = it.created_by_name, !by.isEmpty {
                    Text(by + (it.status == "unavailable" ? " · \(t("pe.pUnavail"))" : "")).font(.system(size: 11.5)).foregroundStyle(.primary.opacity(0.4))
                }
            }
            Spacer()
            if m.purchaseSeg == "todo" && m.isManager {
                Button { Task { await m.setPurchaseStatus(it, "unavailable") } } label: {
                    Text(t("pe.pUnavail")).font(.system(size: 12, weight: .semibold)).foregroundStyle(.primary.opacity(0.6))
                }
            }
            if m.isManager || it.created_by == m.myId {
                Button { Task { await m.removePurchase(it) } } label: {
                    Image(systemName: "xmark").font(.system(size: 13, weight: .semibold)).foregroundStyle(.primary.opacity(0.4))
                }
            }
        }
        .padding(.vertical, 12).padding(.horizontal, 14)
        .background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 14))
        .opacity(it.status == "todo" ? 1 : 0.6)
        }
    }

    private func copyList() {
        UIPasteboard.general.string = m.purchaseText(catLabel: purchaseCatLabel)
        m.flash(t("pe.pCopied"))
    }
    private func waList() {
        let text = m.purchaseText(catLabel: purchaseCatLabel)
        if let url = URL(string: "https://wa.me/?text=\(text.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? "")") {
            UIApplication.shared.open(url)
        }
    }
}

private struct PurchaseFormSheet: View {
    @Bindable var m: PeopleModel
    @Environment(\.dismiss) private var dismiss
    @State private var cat = "kitchen"
    @State private var rows: [Row] = [Row()]
    @State private var saving = false

    struct Row: Identifiable { let id = UUID(); var name = ""; var qty = ""; var unit = "" }

    var body: some View {
        NavigationStack {
            ZStack {
                Color.miseBg.ignoresSafeArea()
                ScrollView {
                    VStack(spacing: 14) {
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 8) {
                                ForEach(PURCHASE_CATS_IOS, id: \.id) { c in
                                    Button { cat = c.id } label: {
                                        Text(t(c.label)).font(.system(size: 13, weight: cat == c.id ? .bold : .medium))
                                            .foregroundStyle(cat == c.id ? .white : .primary)
                                            .padding(.horizontal, 14).padding(.vertical, 8)
                                            .background(Capsule().fill(cat == c.id ? PEOPLE_ACCENT : Color.primary.opacity(0.08)))
                                    }
                                }
                            }
                        }
                        ForEach($rows) { $r in
                            HStack(spacing: 8) {
                                TextField(t("pe.pNamePh"), text: $r.name).textFieldStyle(.roundedBorder)
                                TextField(t("pe.pQtyEx"), text: $r.qty).textFieldStyle(.roundedBorder).frame(width: 56).keyboardType(.decimalPad)
                                TextField(t("pe.pUnitEx"), text: $r.unit).textFieldStyle(.roundedBorder).frame(width: 56)
                                if rows.count > 1 {
                                    Button { rows.removeAll { $0.id == r.id } } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(.primary.opacity(0.3)) }
                                }
                            }
                        }
                        Button { rows.append(Row()) } label: {
                            Label(t("pe.pAddRow"), systemImage: "plus").font(.system(size: 14, weight: .semibold)).foregroundStyle(PEOPLE_ACCENT)
                                .frame(maxWidth: .infinity).padding(.vertical, 11)
                                .background(RoundedRectangle(cornerRadius: 12).strokeBorder(style: StrokeStyle(lineWidth: 1.5, dash: [5])).foregroundStyle(.primary.opacity(0.2)))
                        }
                    }.padding(16)
                }
            }
            .navigationTitle(t("pe.pNew")).navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(Color.miseBg, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(t("cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(t("pe.pSubmit")) { submit() }.disabled(saving || !rows.contains { !$0.name.trimmingCharacters(in: .whitespaces).isEmpty })
                }
            }
        }
    }

    private func submit() {
        saving = true
        let payload = rows.map { (name: $0.name, qty: $0.qty, unit: $0.unit) }
        Task {
            await m.addPurchase(category: cat, rows: payload, catLabel: purchaseCatLabel(cat))
            dismiss()
        }
    }
}

// MARK: Чек-листы

private struct ChecklistsTab: View {
    @Bindable var m: PeopleModel
    @State private var edit: ChecklistEdit?
    @State private var showHistory = false
    @State private var auditHistoryOf: ShiftChecklist?
    @State private var subTab = "shift" // shift | audits | stats

    struct ChecklistEdit: Identifiable {
        var id = UUID(); var listId: String?; var role: String?; var items: [ChecklistItem]
        var kind: String = "shift"; var targetScope: String = "role"; var assignedStaffId: String?; var title: String = ""
        var recurrence: String = "none"; var recurrenceWeekdays: Set<Int> = []; var recurrenceDayOfMonth: Int = 1
    }

    var body: some View {
        Group {
            if !m.checklistsLoaded {
                RowListSkeleton(rows: 3)
            } else {
                if m.isManager {
                    Picker("", selection: $subTab) {
                        Text(t("pe.shiftTab")).tag("shift")
                        Text(t("pe.audits")).tag("audits")
                        Text(t("pe.statistics")).tag("stats")
                    }.pickerStyle(.segmented)
                }
                switch subTab {
                case "audits": auditsSection
                case "stats" where m.isManager: StatisticsSection(m: m)
                default: shiftSection
                }
            }
        }
        .task(id: m.opsView) { if m.opsView == "check" && !m.checklistsLoaded { await m.loadChecklists() } }
        .task(id: subTab) { if subTab == "audits" && !m.auditsLoaded { await m.loadAudits() } }
        .sheet(item: $edit) { e in ChecklistEditSheet(m: m, edit: e) }
        .sheet(isPresented: $showHistory) { ChecklistHistorySheet(m: m) }
        .sheet(item: $auditHistoryOf) { a in AuditHistorySheet(m: m, list: a) }
    }

    private var shiftSection: some View {
        Group {
            if m.openShiftId == nil { inactiveBanner }
            Picker("", selection: $m.clType) {
                Text(t("pe.open")).tag("open"); Text(t("pe.close")).tag("close")
            }.pickerStyle(.segmented)
            let lists = m.relevantChecklists()
            if lists.isEmpty {
                Text(t("pe.noChecklists")).font(.system(size: 15)).foregroundStyle(.primary.opacity(0.4)).padding(.top, 40)
            } else {
                ForEach(lists) { list in
                    ChecklistRunCard(m: m, list: list, run: m.completion(list), showManagerControls: m.isManager,
                                      onToggle: { i, photo in await m.toggleChecklistItem(list, i, photoURL: photo) },
                                      onEdit: { edit = ChecklistEdit(listId: list.id, role: list.role, items: (list.itemDetails?.isEmpty == false) ? list.itemDetails! : [ChecklistItem(label: "")]) },
                                      onDelete: { Task { await m.deleteChecklist(list.id) } })
                }
            }
            if m.isManager {
                Button { edit = ChecklistEdit(listId: nil, role: nil, items: [ChecklistItem(label: "")]) } label: {
                    Label(t("pe.checklistForRole"), systemImage: "plus")
                        .font(.system(size: 14, weight: .semibold)).foregroundStyle(PEOPLE_ACCENT)
                        .frame(maxWidth: .infinity).padding(.vertical, 13)
                        .background(RoundedRectangle(cornerRadius: 14).strokeBorder(style: StrokeStyle(lineWidth: 1.5, dash: [5])).foregroundStyle(.primary.opacity(0.2)))
                }
                .padding(.top, 4)
                Button { showHistory = true } label: {
                    Label(t("pe.checklistHistory"), systemImage: "clock.arrow.circlepath")
                        .font(.system(size: 14, weight: .semibold)).foregroundStyle(.primary.opacity(0.6))
                        .frame(maxWidth: .infinity).padding(.vertical, 12)
                }
                Button { Task { await m.addPresetTemplates() } } label: {
                    Label(t("pe.presetTemplates"), systemImage: "wand.and.stars")
                        .font(.system(size: 13, weight: .semibold)).foregroundStyle(.primary.opacity(0.5))
                        .frame(maxWidth: .infinity).padding(.vertical, 10)
                }
            }
        }
    }

    private var auditsSection: some View {
        Group {
            if m.isManager {
                Button {
                    edit = ChecklistEdit(listId: nil, role: nil, items: [ChecklistItem(label: "")], kind: "audit", targetScope: "venue", title: "")
                } label: {
                    Label(t("pe.newAuditTemplate"), systemImage: "plus")
                        .font(.system(size: 14, weight: .semibold)).foregroundStyle(PEOPLE_ACCENT)
                        .frame(maxWidth: .infinity).padding(.vertical, 13)
                        .background(RoundedRectangle(cornerRadius: 14).strokeBorder(style: StrokeStyle(lineWidth: 1.5, dash: [5])).foregroundStyle(.primary.opacity(0.2)))
                }
                .padding(.bottom, 4)
            }
            let list = m.relevantAudits()
            if list.isEmpty {
                Text(t("pe.noChecklists")).font(.system(size: 15)).foregroundStyle(.primary.opacity(0.4)).padding(.top, 40)
            } else {
                ForEach(list) { a in
                    let run = m.auditRun(a)
                    if run != nil || m.isManager {
                        VStack(alignment: .leading, spacing: 8) {
                            HStack {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(a.title?.isEmpty == false ? a.title! : (a.itemDetails?.first?.label ?? "—"))
                                        .font(.system(size: 14, weight: .bold)).foregroundStyle(.primary)
                                    if let rec = a.recurrence, rec != "none" {
                                        HStack(spacing: 3) {
                                            Image(systemName: "repeat").font(.system(size: 9, weight: .bold))
                                            Text(recurrenceSummary(rec, a.recurrenceWeekdays, a.recurrenceDayOfMonth))
                                        }
                                        .font(.system(size: 11, weight: .semibold)).foregroundStyle(PEOPLE_ACCENT.opacity(0.8))
                                    }
                                }
                                Spacer()
                                if m.isManager {
                                    Button { Task { await m.startAudit(templateId: a.id) } } label: {
                                        Image(systemName: "paperplane.fill").font(.system(size: 13)).foregroundStyle(PEOPLE_ACCENT)
                                    }
                                    Button { auditHistoryOf = a } label: {
                                        Image(systemName: "clock.arrow.circlepath").font(.system(size: 13)).foregroundStyle(.primary.opacity(0.45))
                                    }
                                    Button {
                                        edit = ChecklistEdit(listId: a.id, role: a.role, items: (a.itemDetails?.isEmpty == false) ? a.itemDetails! : [ChecklistItem(label: "")],
                                                              kind: "audit", targetScope: a.target_scope ?? "venue", assignedStaffId: a.assigned_staff_id, title: a.title ?? "",
                                                              recurrence: a.recurrence ?? "none", recurrenceWeekdays: Set(a.recurrenceWeekdays ?? []), recurrenceDayOfMonth: a.recurrenceDayOfMonth ?? 1)
                                    } label: { Image(systemName: "pencil").font(.system(size: 13)).foregroundStyle(PEOPLE_ACCENT) }
                                    Button { Task { await m.deleteChecklist(a.id) } } label: {
                                        Image(systemName: "trash").font(.system(size: 13)).foregroundStyle(.primary.opacity(0.3))
                                    }
                                }
                            }
                            if let run {
                                ChecklistRunCard(m: m, list: a, run: run, showManagerControls: false,
                                                  onToggle: { i, photo in await m.toggleAuditItem(a, i, photoURL: photo) },
                                                  onEdit: {}, onDelete: {}, grading: true,
                                                  onGrade: { i, r, photo in await m.gradeAuditItem(a, i, result: r, photoURL: photo) },
                                                  onNote: { i, text in await m.setAuditItemNote(a, i, note: text) })
                            } else {
                                Text(t("pe.noRunYet")).font(.system(size: 12)).foregroundStyle(.primary.opacity(0.4))
                            }
                        }
                        .padding(12).background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 16))
                    }
                }
            }
        }
    }

    private var inactiveBanner: some View {
        HStack(spacing: 10) {
            Image(systemName: "clock.badge.exclamationmark").font(.system(size: 18)).foregroundStyle(BrandKit.stash)
            VStack(alignment: .leading, spacing: 2) {
                Text(t("mg.noShift")).font(.system(size: 14, weight: .semibold)).foregroundStyle(.primary)
                Text(t("pe.checklistNoShiftHint"))
                    .font(.system(size: 12)).foregroundStyle(.primary.opacity(0.5))
            }
            Spacer()
        }
        .padding(14).background(BrandKit.stash.opacity(0.12), in: RoundedRectangle(cornerRadius: 14))
    }
}

@MainActor private func roleTitle(_ role: String?) -> String {
    guard let role else { return t("pe.role.general") }
    let known = ["kitchen", "bar", "hookah", "waiter", "host", "cleaner"]
    return known.contains(role) ? t("pe.role." + role) : role
}

/// Карточка одного прогона чек-листа/аудита — используется и «Сменой», и «Аудитами».
private struct ChecklistRunCard: View {
    @Bindable var m: PeopleModel
    let list: ShiftChecklist
    let run: ChecklistCompletion?
    let showManagerControls: Bool
    let onToggle: (Int, String?) async -> Void
    let onEdit: () -> Void
    let onDelete: () -> Void
    // Оценки Б1/Б2 (разовые аудиты): ✓/✗/N/A + комментарий вместо бинарной галки.
    var grading: Bool = false
    var onGrade: ((Int, String?, String?) async -> Void)? = nil  // (idx, result | nil = снять, photoURL)
    var onNote: ((Int, String?) async -> Void)? = nil

    @State private var showCamera = false
    @State private var pendingIndex: Int?
    @State private var pendingResult: String?
    @State private var uploading = false
    @State private var report: ReportTarget?
    @State private var noteTarget: NoteTarget?

    struct ReportTarget: Identifiable { var id = UUID(); var index: Int; var label: String }
    struct NoteTarget: Identifiable { var id = UUID(); var index: Int; var text: String }

    var body: some View {
        let items = list.itemDetails ?? []
        let state = run?.items_state ?? []
        let done = items.indices.filter { $0 < state.count && state[$0].done }.count
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("\(roleTitle(list.role)) · \(done)/\(items.count)")
                    .font(.system(size: 12, weight: .semibold)).foregroundStyle(list.role != nil ? PEOPLE_ACCENT : .white.opacity(0.45)).kerning(0.5)
                Spacer()
                if done == items.count && !items.isEmpty {
                    Text(t("pe.readyCaps")).font(.system(size: 11, weight: .bold)).foregroundStyle(BrandKit.analytics)
                        .padding(.horizontal, 8).padding(.vertical, 2).background(BrandKit.analytics.opacity(0.16), in: Capsule())
                }
                if showManagerControls {
                    Button(action: onEdit) { Image(systemName: "pencil").font(.system(size: 13)).foregroundStyle(PEOPLE_ACCENT) }
                    Button(action: onDelete) { Image(systemName: "trash").font(.system(size: 13)).foregroundStyle(.primary.opacity(0.3)) }
                }
            }
            .padding(.bottom, 8)
            VStack(spacing: 0) {
                ForEach(Array(items.enumerated()), id: \.offset) { i, item in
                    let st: ChecklistItemState? = i < state.count ? state[i] : nil
                    if grading {
                        gradingRow(i, item, st)
                    } else {
                        let on = st?.done == true
                        HStack(spacing: 8) {
                        Button {
                            guard !uploading else { return }
                            if item.photo_required && !on { pendingIndex = i; showCamera = true }
                            else { Task { await onToggle(i, nil) } }
                        } label: {
                            HStack(spacing: 12) {
                                ZStack {
                                    Circle().stroke(on ? PEOPLE_ACCENT : Color.primary.opacity(0.25), lineWidth: 2).frame(width: 22, height: 22)
                                    if on { Circle().fill(PEOPLE_ACCENT).frame(width: 22, height: 22)
                                        Image(systemName: "checkmark").font(.system(size: 11, weight: .bold)).foregroundStyle(.primary) }
                                }
                                Text(item.label).font(.system(size: 15)).foregroundStyle(.primary.opacity(on ? 0.5 : 1)).strikethrough(on)
                                if item.photo_required {
                                    Image(systemName: "camera.fill").font(.system(size: 10)).foregroundStyle(.primary.opacity(0.3))
                                }
                                Spacer()
                            }
                        }
                        .buttonStyle(.plain)
                        Button { report = ReportTarget(index: i, label: item.label) } label: {
                            Image(systemName: "exclamationmark.bubble").font(.system(size: 13)).foregroundStyle(BrandKit.menu.opacity(0.6))
                        }
                        }
                        .padding(.vertical, 12).padding(.horizontal, 14)
                    }
                    if i < items.count - 1 { Divider().overlay(Color.primary.opacity(0.07)).padding(.leading, 48) }
                }
            }
            .background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 16))
        }
        .padding(.top, 4)
        .sheet(isPresented: $showCamera) {
            CameraCaptureView { image in
                showCamera = false
                guard let idx = pendingIndex, let image else { pendingResult = nil; return }
                let result = pendingResult
                pendingResult = nil
                uploading = true
                Task {
                    defer { uploading = false }
                    let itemId = idx < items.count ? items[idx].id : "\(idx)"
                    if let url = await uploadAuditPhoto(image: image, restaurantId: m.rid, completionId: run?.id ?? list.id, itemId: itemId) {
                        if let result, let onGrade { await onGrade(idx, result, url) }
                        else { await onToggle(idx, url) }
                    } else {
                        m.flash(t("saveFailed", ["err": "upload"]))
                    }
                }
            }
        }
        .sheet(item: $report) { target in
            ReportProblemSheet(m: m, list: list, run: run, itemIndex: target.index, itemLabel: target.label)
        }
        .sheet(item: $noteTarget) { target in
            ItemNoteSheet(initial: target.text) { text in
                Task { await onNote?(target.index, text) }
            }
        }
    }

    /// Строка пункта в grading-режиме: исход ✓ / ✗ / N/A + комментарий (ревью Б1/Б2).
    /// Старые записи без result: done трактуем как pass.
    @ViewBuilder
    private func gradingRow(_ i: Int, _ item: ChecklistItem, _ st: ChecklistItemState?) -> some View {
        let eff = st?.result ?? (st?.done == true ? "pass" : nil)
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Text(item.label).font(.system(size: 15)).foregroundStyle(.primary.opacity(eff == "pass" ? 0.55 : 1))
                if item.photo_required {
                    Image(systemName: "camera.fill").font(.system(size: 10)).foregroundStyle(.primary.opacity(0.3))
                }
                Spacer()
                Button { report = ReportTarget(index: i, label: item.label) } label: {
                    Image(systemName: "exclamationmark.bubble").font(.system(size: 13)).foregroundStyle(BrandKit.menu.opacity(0.6))
                }
            }
            HStack(spacing: 8) {
                gradePill(on: eff == "pass", color: BrandKit.analytics) {
                    Image(systemName: "checkmark").font(.system(size: 12, weight: .bold))
                } action: {
                    guard !uploading else { return }
                    if eff == "pass" { Task { await onGrade?(i, nil, nil) } }
                    else if item.photo_required && st?.photo_url == nil { pendingIndex = i; pendingResult = "pass"; showCamera = true }
                    else { Task { await onGrade?(i, "pass", nil) } }
                }
                gradePill(on: eff == "fail", color: BrandKit.menu) {
                    Image(systemName: "xmark").font(.system(size: 12, weight: .bold))
                } action: {
                    if eff == "fail" { Task { await onGrade?(i, nil, nil) } }
                    else {
                        Task { await onGrade?(i, "fail", nil) }
                        // Фейл сразу предлагает завести задачу-нарушение (паттерн SafetyCulture).
                        report = ReportTarget(index: i, label: item.label)
                    }
                }
                gradePill(on: eff == "na", color: Color.primary.opacity(0.45)) {
                    Text("N/A").font(.system(size: 12, weight: .bold))
                } action: {
                    Task { await onGrade?(i, eff == "na" ? nil : "na", nil) }
                }
                Spacer()
                Button { noteTarget = NoteTarget(index: i, text: st?.note ?? "") } label: {
                    Image(systemName: "text.bubble")
                        .font(.system(size: 13))
                        .foregroundStyle((st?.note?.isEmpty == false) ? PEOPLE_ACCENT : Color.primary.opacity(0.3))
                }
            }
            if uploading && pendingIndex == i {
                ProgressView().controlSize(.small)
            }
            if let note = st?.note, !note.isEmpty {
                Text(note).font(.system(size: 12)).foregroundStyle(.primary.opacity(0.5))
            }
        }
        .padding(.vertical, 12).padding(.horizontal, 14)
    }

    private func gradePill(on: Bool, color: Color, @ViewBuilder label: () -> some View, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            label()
                .foregroundStyle(on ? Color.white : Color.primary.opacity(0.45))
                .frame(minWidth: 34)
                .padding(.vertical, 6).padding(.horizontal, 8)
                .background(on ? AnyShapeStyle(color) : AnyShapeStyle(Color.primary.opacity(0.08)), in: RoundedRectangle(cornerRadius: 9))
        }
        .buttonStyle(.plain)
    }
}

/// Комментарий к пункту аудита (ревью Б2): маленький шит с TextEditor.
private struct ItemNoteSheet: View {
    @Environment(\.dismiss) private var dismiss
    let initial: String
    let onSave: (String?) -> Void
    @State private var text = ""

    var body: some View {
        NavigationStack {
            ZStack {
                Color.miseBg.ignoresSafeArea()
                TextEditor(text: $text)
                    .scrollContentBackground(.hidden)
                    .padding(12)
                    .background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 14))
                    .padding(16)
                    .frame(maxHeight: 180, alignment: .top)
                    .frame(maxHeight: .infinity, alignment: .top)
            }
            .navigationTitle(t("pe.itemNote"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(t("cancel")) { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(t("save")) { onSave(text); dismiss() }.fontWeight(.semibold)
                }
            }
            .toolbarBackground(Color.miseBg, for: .navigationBar)
        }
        .presentationDetents([.height(280)])
        .onAppear { text = initial }
    }
}

/// Счёт прогона (ревью Б3/Б4): N/A вне знаменателя, pass = выполнено;
/// legacy-записи без result — done = pass.
nonisolated private func auditRunScore(_ items: [ChecklistItem], _ state: [ChecklistItemState]) -> (pass: Int, total: Int) {
    var pass = 0, total = 0
    for i in items.indices {
        let st: ChecklistItemState? = i < state.count ? state[i] : nil
        let eff = st?.result ?? (st?.done == true ? "pass" : nil)
        if eff == "na" { continue }
        total += 1
        if eff == "pass" { pass += 1 }
    }
    return (pass, total)
}

/// История прогонов аудита за 30 дней (ревью Б4) — вход в отчёт прогона (Б3).
/// Данные уже в m.auditRuns (loadAudits тянет 30 дней) — без отдельного запроса.
private struct AuditHistorySheet: View {
    @Bindable var m: PeopleModel
    let list: ShiftChecklist
    @State private var openRun: ChecklistCompletion?

    private var runs: [ChecklistCompletion] {
        m.auditRuns.filter { $0.checklist_id == list.id }.sorted { ($0.date ?? "") > ($1.date ?? "") }
    }

    var body: some View {
        NavigationStack {
            ZStack {
                Color.miseBg.ignoresSafeArea()
                if runs.isEmpty {
                    Text(t("pe.auditHistoryEmpty")).font(.system(size: 14)).foregroundStyle(.primary.opacity(0.4))
                } else {
                    ScrollView {
                        VStack(spacing: 0) {
                            ForEach(runs) { run in
                                let score = auditRunScore(list.itemDetails ?? [], run.items_state ?? [])
                                let pct = score.total > 0 ? Int((Double(score.pass) / Double(score.total) * 100).rounded()) : 0
                                Button { openRun = run } label: {
                                    HStack {
                                        VStack(alignment: .leading, spacing: 2) {
                                            Text(run.date ?? "—").font(.system(size: 14, weight: .semibold)).foregroundStyle(.primary)
                                            Text(m.staffName(run.staff_id)).font(.system(size: 12)).foregroundStyle(.primary.opacity(0.5))
                                        }
                                        Spacer()
                                        if run.status == "pending" {
                                            Text(t("pe.notChecked")).font(.system(size: 12, weight: .semibold)).foregroundStyle(.primary.opacity(0.4))
                                        } else {
                                            Text("\(pct)%").font(.system(size: 14, weight: .bold))
                                                .foregroundStyle(pct >= 80 ? BrandKit.analytics : pct >= 50 ? BrandKit.stash : BrandKit.menu)
                                        }
                                    }
                                    .padding(.vertical, 12).padding(.horizontal, 16)
                                }
                                .buttonStyle(.plain)
                                Divider().overlay(Color.primary.opacity(0.07)).padding(.leading, 16)
                            }
                        }
                    }
                }
            }
            .navigationTitle(t("pe.auditHistory"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(Color.miseBg, for: .navigationBar)
        }
        .sheet(item: $openRun) { run in AuditRunReportView(m: m, list: list, run: run) }
    }
}

// Снапшот PDF-отчёта прогона: строки локализуются на MainActor, фото качаются заранее —
// рендер (тяжёлый) уходит в Task.detached, как renderPDF бизнес-отчёта.
nonisolated private struct AuditPdfRow: @unchecked Sendable {
    let tag: String; let kind: String?; let label: String; let note: String?
}
nonisolated private struct AuditPdfSnapshot: @unchecked Sendable {
    let title, meta, scoreLine: String
    let rows: [AuditPdfRow]
    let photos: [Int: UIImage]
}

nonisolated private func renderAuditPdf(_ s: AuditPdfSnapshot) -> Data {
    let pageW: CGFloat = 595, pageH: CGFloat = 842, margin: CGFloat = 40
    let contentW = pageW - margin * 2
    let renderer = UIGraphicsPDFRenderer(bounds: CGRect(x: 0, y: 0, width: pageW, height: pageH))
    var pdf = Data()
    // Светлая палитра принудительно — как в renderPDF (тёмная тема делала PDF нечитаемым).
    UITraitCollection(userInterfaceStyle: .light).performAsCurrent {
        pdf = renderer.pdfData { ctx in
            ctx.beginPage()
            var y: CGFloat = margin

            @discardableResult
            func draw(_ str: String, x: CGFloat, atY: CGFloat, size: CGFloat, weight: UIFont.Weight = .regular, color: UIColor = .black, width: CGFloat) -> CGFloat {
                let p = NSMutableParagraphStyle(); p.lineBreakMode = .byWordWrapping
                let attrs: [NSAttributedString.Key: Any] = [.font: UIFont.systemFont(ofSize: size, weight: weight), .foregroundColor: color, .paragraphStyle: p]
                let h = ceil((str as NSString).boundingRect(with: CGSize(width: width, height: .greatestFiniteMagnitude), options: [.usesLineFragmentOrigin], attributes: attrs, context: nil).height)
                (str as NSString).draw(in: CGRect(x: x, y: atY, width: width, height: h), withAttributes: attrs)
                return h
            }

            y += draw(s.title, x: margin, atY: y, size: 17, weight: .bold, width: contentW) + 6
            y += draw(s.meta, x: margin, atY: y, size: 10, color: .darkGray, width: contentW) + 2
            y += draw(s.scoreLine, x: margin, atY: y, size: 10, color: .darkGray, width: contentW) + 10
            UIColor.lightGray.setStroke()
            let sep = UIBezierPath(); sep.move(to: CGPoint(x: margin, y: y)); sep.addLine(to: CGPoint(x: pageW - margin, y: y)); sep.lineWidth = 0.5; sep.stroke()
            y += 14

            for (i, row) in s.rows.enumerated() {
                if y > pageH - 80 { ctx.beginPage(); y = margin }
                let tagColor: UIColor = row.kind == "fail" ? UIColor(red: 0.8, green: 0.16, blue: 0.16, alpha: 1)
                    : row.kind == "pass" ? UIColor(red: 0.12, green: 0.55, blue: 0.27, alpha: 1) : .gray
                draw(row.tag, x: margin, atY: y, size: 10, weight: .bold, color: tagColor, width: 88)
                let labelH = draw(row.label, x: margin + 95, atY: y, size: 11, width: contentW - 95)
                y += max(labelH, 13) + 3
                if let note = row.note, !note.isEmpty {
                    if y > pageH - 60 { ctx.beginPage(); y = margin }
                    y += draw(note, x: margin + 95, atY: y, size: 9, color: .darkGray, width: contentW - 95) + 3
                }
                if let img = s.photos[i] {
                    let h: CGFloat = 90
                    let w = img.size.height > 0 ? min(140, h * img.size.width / img.size.height) : h
                    if y + h > pageH - margin { ctx.beginPage(); y = margin }
                    img.draw(in: CGRect(x: margin + 95, y: y, width: w, height: h))
                    y += h + 6
                }
                y += 7
            }
        }
    }
    return pdf
}

private struct AuditShareSheet: UIViewControllerRepresentable {
    let url: URL
    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: [url], applicationActivities: nil)
    }
    func updateUIViewController(_ vc: UIActivityViewController, context: Context) {}
}
private struct AuditPdfPayload: Identifiable { let id = UUID(); let url: URL }

/// Отчёт по прогону (ревью Б3): пункты со статусами, комментарии, фото + экспорт PDF.
private struct AuditRunReportView: View {
    @Bindable var m: PeopleModel
    let list: ShiftChecklist
    let run: ChecklistCompletion
    @State private var generating = false
    @State private var payload: AuditPdfPayload?

    var body: some View {
        let items = list.itemDetails ?? []
        let state = run.items_state ?? []
        let score = auditRunScore(items, state)
        let pct = score.total > 0 ? Int((Double(score.pass) / Double(score.total) * 100).rounded()) : 0
        NavigationStack {
            ZStack {
                Color.miseBg.ignoresSafeArea()
                ScrollView {
                    VStack(alignment: .leading, spacing: 14) {
                        VStack(spacing: 4) {
                            Text("\(pct)%").font(.system(size: 34, weight: .bold))
                                .foregroundStyle(pct >= 80 ? BrandKit.analytics : pct >= 50 ? BrandKit.stash : BrandKit.menu)
                            Text("\(run.date ?? "—") · \(m.staffName(run.staff_id)) · \(score.pass)/\(score.total)")
                                .font(.system(size: 12)).foregroundStyle(.primary.opacity(0.5))
                        }
                        .frame(maxWidth: .infinity)
                        .padding(16).background(Color.primary.opacity(0.05), in: RoundedRectangle(cornerRadius: 16))

                        VStack(spacing: 0) {
                            ForEach(Array(items.enumerated()), id: \.offset) { i, item in
                                let st: ChecklistItemState? = i < state.count ? state[i] : nil
                                let eff = st?.result ?? (st?.done == true ? "pass" : nil)
                                VStack(alignment: .leading, spacing: 6) {
                                    HStack(alignment: .top, spacing: 10) {
                                        resultTag(eff)
                                        Text(item.label).font(.system(size: 14)).foregroundStyle(.primary)
                                        Spacer(minLength: 0)
                                    }
                                    if let note = st?.note, !note.isEmpty {
                                        Text(note).font(.system(size: 12)).foregroundStyle(.primary.opacity(0.5))
                                    }
                                    if let photo = st?.photo_url, let url = URL(string: photo) {
                                        AsyncImage(url: url) { img in img.resizable().scaledToFill() } placeholder: { Color.primary.opacity(0.08) }
                                            .frame(width: 64, height: 64).clipShape(RoundedRectangle(cornerRadius: 10))
                                    }
                                }
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(.vertical, 12).padding(.horizontal, 14)
                                if i < items.count - 1 { Divider().overlay(Color.primary.opacity(0.07)) }
                            }
                        }
                        .background(Color.primary.opacity(0.05), in: RoundedRectangle(cornerRadius: 16))
                    }
                    .padding(16)
                }
            }
            .navigationTitle(list.title?.isEmpty == false ? list.title! : t("pe.auditReport"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button { export() } label: {
                        if generating { ProgressView().controlSize(.small) }
                        else { Image(systemName: "square.and.arrow.up") }
                    }
                    .disabled(generating)
                }
            }
            .toolbarBackground(Color.miseBg, for: .navigationBar)
        }
        .sheet(item: $payload) { p in AuditShareSheet(url: p.url) }
    }

    private func resultTag(_ eff: String?) -> some View {
        let (label, color): (String, Color) = eff == "pass" ? ("OK", BrandKit.analytics)
            : eff == "fail" ? (t("pe.resultFail"), BrandKit.menu)
            : eff == "na" ? ("N/A", Color.primary.opacity(0.45))
            : (t("pe.notChecked"), Color.primary.opacity(0.45))
        return Text(label).font(.system(size: 10, weight: .bold)).foregroundStyle(color)
            .padding(.horizontal, 7).padding(.vertical, 3)
            .background(color.opacity(0.14), in: RoundedRectangle(cornerRadius: 6))
    }

    private func export() {
        guard !generating else { return }
        generating = true
        let items = list.itemDetails ?? []
        let state = run.items_state ?? []
        let score = auditRunScore(items, state)
        let pct = score.total > 0 ? Int((Double(score.pass) / Double(score.total) * 100).rounded()) : 0
        var rows: [AuditPdfRow] = []
        var photoURLs: [Int: URL] = [:]
        for (i, item) in items.enumerated() {
            let st: ChecklistItemState? = i < state.count ? state[i] : nil
            let eff = st?.result ?? (st?.done == true ? "pass" : nil)
            let tag = eff == "pass" ? "OK" : eff == "fail" ? t("pe.resultFail") : eff == "na" ? "N/A" : t("pe.notChecked")
            rows.append(AuditPdfRow(tag: tag, kind: eff, label: item.label, note: st?.note))
            if let p = st?.photo_url, let u = URL(string: p) { photoURLs[i] = u }
        }
        let snap0 = (
            title: list.title?.isEmpty == false ? list.title! : t("pe.auditReport"),
            meta: "\(run.date ?? "") · \(m.staffName(run.staff_id))",
            scoreLine: "\(t("pe.statsCompletionRate")): \(pct)% (\(score.pass)/\(score.total))"
        )
        Task {
            var photos: [Int: UIImage] = [:]
            for (i, u) in photoURLs {
                if let (data, _) = try? await URLSession.shared.data(from: u), let img = UIImage(data: data) { photos[i] = img }
            }
            let snap = AuditPdfSnapshot(title: snap0.title, meta: snap0.meta, scoreLine: snap0.scoreLine, rows: rows, photos: photos)
            let data = await Task.detached(priority: .userInitiated) { renderAuditPdf(snap) }.value
            let url = FileManager.default.temporaryDirectory.appendingPathComponent("mise-audit-\(Int(Date().timeIntervalSince1970)).pdf")
            if (try? data.write(to: url)) != nil {
                // Как в ReportExportView: даём Task осесть, иначе share-лист не открывается.
                try? await Task.sleep(nanoseconds: 300_000_000)
                payload = AuditPdfPayload(url: url)
            } else {
                m.flash(t("saveFailed", ["err": "pdf"]))
            }
            generating = false
        }
    }
}

/// Камера-онли захват фото (без доступа к галерее) — антифрод-требование для фото-пунктов.
private struct CameraCaptureView: UIViewControllerRepresentable {
    let onCapture: (UIImage?) -> Void

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        // На симуляторе камеры нет — деградируем на галерею только для разработки,
        // на реальном устройстве всегда .camera (антифрод: свежее фото, не из архива).
        picker.sourceType = UIImagePickerController.isSourceTypeAvailable(.camera) ? .camera : .photoLibrary
        picker.delegate = context.coordinator
        return picker
    }
    func updateUIViewController(_ uiViewController: UIImagePickerController, context: Context) {}
    func makeCoordinator() -> Coordinator { Coordinator(onCapture: onCapture) }

    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let onCapture: (UIImage?) -> Void
        init(onCapture: @escaping (UIImage?) -> Void) { self.onCapture = onCapture }
        func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            onCapture(info[.originalImage] as? UIImage)
        }
        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) { onCapture(nil) }
    }
}

/// Загрузка фото пункта через серверный прокси (клиент не обращается к Supabase Storage
/// напрямую — тот же принцип, что и /api/db для данных). Контракт:
/// POST /api/storage/audit-photo {restaurant_id, completion_id, item_id, data_base64} -> {url}
func uploadAuditPhoto(image: UIImage, restaurantId: String, completionId: String, itemId: String) async -> String? {
    guard let jpeg = image.jpegData(compressionQuality: 0.7),
          let url = URL(string: API.base + "/api/storage/audit-photo") else { return nil }
    var req = URLRequest(url: url)
    req.httpMethod = "POST"
    req.setValue("application/json", forHTTPHeaderField: "Content-Type")
    let payload: [String: Any] = [
        "restaurant_id": restaurantId, "completion_id": completionId, "item_id": itemId,
        "data_base64": jpeg.base64EncodedString(),
    ]
    req.httpBody = try? JSONSerialization.data(withJSONObject: payload)
    guard let (data, resp) = try? await URLSession.shared.data(for: req),
          let http = resp as? HTTPURLResponse, http.statusCode == 200,
          let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          let urlStr = obj["url"] as? String else { return nil }
    return urlStr
}

/// «Сообщить о проблеме»: опциональное фото + назначение ответственного → задача
/// (staff_tasks), с дедупом против уже открытой задачи по этому же пункту (паттерн
/// SafetyCulture Actions — не плодить дубли).
private struct ReportProblemSheet: View {
    @Bindable var m: PeopleModel
    @Environment(\.dismiss) private var dismiss
    let list: ShiftChecklist
    let run: ChecklistCompletion?
    let itemIndex: Int
    let itemLabel: String

    @State private var assignee = ""
    @State private var comment = ""
    @State private var photo: UIImage?
    @State private var showCamera = false
    @State private var saving = false
    @State private var existingTask: StaffTask?

    var body: some View {
        NavigationStack {
            ZStack {
                Color.miseBg.ignoresSafeArea()
                Form {
                    if let existingTask {
                        Section {
                            Text(t("pe.linkExistingTask")).font(.system(size: 13)).foregroundStyle(.primary.opacity(0.6))
                            Text(existingTask.title).font(.system(size: 14, weight: .semibold))
                        }
                    } else {
                        Section(t("pe.assignee")) {
                            Picker(t("pe.assignee"), selection: $assignee) {
                                Text(t("pe.pick")).tag("")
                                ForEach(TASK_ROLE_CODES, id: \.self) { r in Text(checklistRoleLabel(r)).tag("role:" + r) }
                                ForEach(m.dir) { d in Text(d.name).tag(d.id) }
                            }
                        }
                        Section(t("pe.comment")) { TextField(t("pe.comment"), text: $comment, axis: .vertical) }
                        Section {
                            if let photo {
                                Image(uiImage: photo).resizable().scaledToFit().frame(height: 160)
                            }
                            Button { showCamera = true } label: { Label(t("pe.addPhoto"), systemImage: "camera") }
                        }
                    }
                }
                .scrollContentBackground(.hidden)
            }
            .navigationTitle(t("pe.reportProblem")).navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(t("cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(existingTask != nil ? t("pe.openExisting") : t("save")) {
                        if existingTask != nil { dismiss(); return }
                        guard !saving, !assignee.isEmpty else { return }
                        saving = true
                        Task {
                            defer { saving = false }
                            var photoURL: String? = nil
                            if let photo {
                                photoURL = await uploadAuditPhoto(image: photo, restaurantId: m.rid, completionId: run?.id ?? list.id,
                                                                   itemId: (itemIndex < (list.itemDetails?.count ?? 0)) ? list.itemDetails![itemIndex].id : "\(itemIndex)")
                            }
                            _ = await m.createTask(title: itemLabel, desc: comment, assignee: assignee, priority: "high", due: m.todayKey,
                                                    sourceCompletionId: run?.id, sourceItemLabel: itemLabel, photoURL: photoURL)
                            dismiss()
                        }
                    }.disabled(existingTask == nil && (assignee.isEmpty || saving))
                }
            }
            .toolbarBackground(Color.miseBg, for: .navigationBar)
        }
        .sheet(isPresented: $showCamera) { CameraCaptureView { img in showCamera = false; photo = img } }
        .task {
            if !m.tasksLoaded { await m.loadTasks() }
            existingTask = m.openTaskFor(itemLabel: itemLabel)
        }
    }
}

/// Статистика по чек-листам/аудитам за 30 дней — только менеджер/владелец.
private struct StatisticsSection: View {
    @Bindable var m: PeopleModel
    @State private var loaded = false
    @State private var completionPct = 0
    @State private var topViolations: [(String, Int)] = []
    @State private var staffRating: [(String, Int)] = []

    var body: some View {
        Group {
            if !loaded {
                RowListSkeleton(rows: 3)
            } else if completionPct == 0 && topViolations.isEmpty && staffRating.isEmpty {
                Text(t("pe.statsNoData")).font(.system(size: 15)).foregroundStyle(.primary.opacity(0.4)).padding(.top, 40)
            } else {
                VStack(alignment: .leading, spacing: 16) {
                    statCard(title: t("pe.statsCompletionRate")) {
                        Text("\(completionPct)%").font(.system(size: 32, weight: .bold)).foregroundStyle(PEOPLE_ACCENT)
                    }
                    if !topViolations.isEmpty {
                        statCard(title: t("pe.statsTopViolations")) {
                            VStack(alignment: .leading, spacing: 6) {
                                ForEach(Array(topViolations.enumerated()), id: \.offset) { _, row in
                                    HStack {
                                        Text(row.0).font(.system(size: 13)).foregroundStyle(.primary.opacity(0.8))
                                        Spacer()
                                        Text("\(row.1)").font(.system(size: 13, weight: .semibold)).foregroundStyle(BrandKit.menu)
                                    }
                                }
                            }
                        }
                    }
                    if !staffRating.isEmpty {
                        statCard(title: t("pe.statsStaffRating")) {
                            VStack(alignment: .leading, spacing: 6) {
                                ForEach(Array(staffRating.enumerated()), id: \.offset) { _, row in
                                    HStack {
                                        Text(row.0).font(.system(size: 13)).foregroundStyle(.primary.opacity(0.8))
                                        Spacer()
                                        Text("\(row.1)%").font(.system(size: 13, weight: .semibold)).foregroundStyle(BrandKit.analytics)
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        .task { await load() }
    }

    private func statCard<Content: View>(title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.system(size: 12, weight: .semibold)).foregroundStyle(.primary.opacity(0.5)).kerning(0.3)
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14).background(Color.primary.opacity(0.05), in: RoundedRectangle(cornerRadius: 16))
    }

    private func load() async {
        if !m.clHistoryLoaded { await m.loadChecklistHistory() }
        if !m.tasksLoaded { await m.loadTasks() }
        var total = 0, done = 0
        var violationCounts: [String: Int] = [:]
        var staffTotal: [String: Int] = [:], staffDone: [String: Int] = [:]
        for c in m.clHistory {
            guard let cl = m.checklistTitle(c.checklist_id), let items = cl.itemDetails else { continue }
            let state = c.items_state ?? []
            let staffLabel = m.staffName(c.staff_id)
            for i in items.indices {
                // Оценки Б1: N/A выпадает из знаменателя, pass = выполнено, fail = нет;
                // старые записи без result — по done (бинарная модель).
                let st: ChecklistItemState? = i < state.count ? state[i] : nil
                let eff = st?.result ?? (st?.done == true ? "pass" : nil)
                if eff == "na" { continue }
                total += 1
                staffTotal[staffLabel, default: 0] += 1
                if eff == "pass" {
                    done += 1
                    staffDone[staffLabel, default: 0] += 1
                }
            }
        }
        for tsk in m.tasks where tsk.source_item_label != nil {
            violationCounts[tsk.source_item_label!, default: 0] += 1
        }
        completionPct = total > 0 ? Int((Double(done) / Double(total) * 100).rounded()) : 0
        topViolations = violationCounts.sorted { $0.value > $1.value }.prefix(5).map { ($0.key, $0.value) }
        staffRating = staffTotal.compactMap { name, tot -> (String, Int)? in
            guard tot > 0, name != "—" else { return nil }
            let pct = Int((Double(staffDone[name] ?? 0) / Double(tot) * 100).rounded())
            return (name, pct)
        }.sorted { $0.1 > $1.1 }
        loaded = true
    }
}

private let CHECKLIST_ROLE_CODES: [String?] = [nil, "kitchen", "bar", "hookah", "waiter", "host", "cleaner"]
private let TASK_ROLE_CODES: [String] = ["kitchen", "bar", "hookah", "waiter", "host", "cleaner"]
@MainActor private func checklistRoleLabel(_ role: String?) -> String {
    guard let role else { return t("pe.role.general") }
    return t("pe.role." + role)
}

private struct ChecklistEditSheet: View {
    @Bindable var m: PeopleModel
    @Environment(\.dismiss) private var dismiss
    @State var edit: ChecklistsTab.ChecklistEdit
    @State private var saving = false

    var body: some View {
        NavigationStack {
            ZStack {
                Color.miseBg.ignoresSafeArea()
                Form {
                    if edit.kind == "audit" {
                        Section(t("pe.auditTitle")) { TextField(t("pe.auditTitle"), text: $edit.title) }
                        Section(t("pe.targetScope")) {
                            Picker(t("pe.targetScope"), selection: $edit.targetScope) {
                                Text(t("pe.targetVenue")).tag("venue")
                                Text(t("pe.targetRole")).tag("role")
                                Text(t("pe.targetStaff")).tag("staff")
                            }.pickerStyle(.segmented)
                            if edit.targetScope == "role" {
                                Picker(t("pe.workshop"), selection: Binding(get: { edit.role ?? "" }, set: { edit.role = $0.isEmpty ? nil : $0 })) {
                                    ForEach(CHECKLIST_ROLE_CODES, id: \.self) { code in Text(checklistRoleLabel(code)).tag(code ?? "") }
                                }
                            } else if edit.targetScope == "staff" {
                                Picker(t("pe.assignee"), selection: Binding(get: { edit.assignedStaffId ?? "" }, set: { edit.assignedStaffId = $0.isEmpty ? nil : $0 })) {
                                    Text(t("pe.pick")).tag("")
                                    ForEach(m.dir) { d in Text(d.name).tag(d.id) }
                                }
                            }
                        }
                        Section(t("pe.recurrenceLabel")) {
                            Picker(t("pe.recurrenceLabel"), selection: $edit.recurrence) {
                                Text(t("pe.recurrenceNone")).tag("none")
                                Text(t("pe.recurrenceDaily")).tag("daily")
                                Text(t("pe.recurrenceWeekly")).tag("weekly")
                                Text(t("pe.recurrenceMonthly")).tag("monthly")
                            }
                            if edit.recurrence == "weekly" {
                                weekdayPicker
                            } else if edit.recurrence == "monthly" {
                                Stepper(t("pe.dayOfMonth") + ": \(edit.recurrenceDayOfMonth)", value: $edit.recurrenceDayOfMonth, in: 1...31)
                            }
                        }
                    } else {
                        Section(t("pe.workshop")) {
                            Picker(t("pe.workshop"), selection: Binding(get: { edit.role ?? "" }, set: { edit.role = $0.isEmpty ? nil : $0 })) {
                                ForEach(CHECKLIST_ROLE_CODES, id: \.self) { code in Text(checklistRoleLabel(code)).tag(code ?? "") }
                            }
                        }
                    }
                    Section(t("pe.items")) {
                        ForEach(edit.items.indices, id: \.self) { i in
                            HStack {
                                TextField(t("pe.itemN", ["n": "\(i + 1)"]), text: $edit.items[i].label)
                                Spacer()
                                Button { edit.items[i].photo_required.toggle() } label: {
                                    Image(systemName: edit.items[i].photo_required ? "camera.fill" : "camera")
                                        .font(.system(size: 15))
                                        .foregroundStyle(edit.items[i].photo_required ? PEOPLE_ACCENT : .primary.opacity(0.25))
                                }.buttonStyle(.plain)
                            }
                        }
                        Button { edit.items.append(ChecklistItem(label: "")) } label: { Label(t("pe.moreItem"), systemImage: "plus") }
                    }
                }
                .scrollContentBackground(.hidden)
            }
            .navigationTitle(navTitle).navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(t("cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(t("save")) {
                        guard !saving else { return }
                        saving = true
                        Task {
                            defer { saving = false }
                            await m.saveChecklistTemplate(id: edit.listId, role: edit.role, items: edit.items,
                                                           kind: edit.kind, targetScope: edit.targetScope,
                                                           assignedStaffId: edit.assignedStaffId, title: edit.title,
                                                           recurrence: edit.recurrence,
                                                           recurrenceWeekdays: edit.recurrence == "weekly" ? Array(edit.recurrenceWeekdays).sorted() : nil,
                                                           recurrenceDayOfMonth: edit.recurrence == "monthly" ? edit.recurrenceDayOfMonth : nil)
                            dismiss()
                        }
                    }.disabled(saving)
                }
            }
            .toolbarBackground(Color.miseBg, for: .navigationBar)
        }
    }

    private var navTitle: String {
        if edit.kind == "audit" { return edit.title.isEmpty ? t("pe.newAuditTemplate") : edit.title }
        return m.clType == "open" ? t("pe.checklistOpenTitle") : t("pe.checklistCloseTitle")
    }

    /// Мультиселект дней недели (0=вс..6=сб на проводе, показываем Пн-Вс для читаемости).
    private var weekdayPicker: some View {
        let order = [1, 2, 3, 4, 5, 6, 0] // Пн..Вс
        return HStack(spacing: 6) {
            ForEach(order, id: \.self) { d in
                let on = edit.recurrenceWeekdays.contains(d)
                Button {
                    if on { edit.recurrenceWeekdays.remove(d) } else { edit.recurrenceWeekdays.insert(d) }
                } label: {
                    Text(weekdayShort(d))
                        .font(.system(size: 12, weight: .semibold))
                        .frame(width: 32, height: 32)
                        .background(Circle().fill(on ? PEOPLE_ACCENT : Color.primary.opacity(0.08)))
                        .foregroundStyle(on ? .white : .primary.opacity(0.6))
                }.buttonStyle(.plain)
            }
        }
        .listRowInsets(EdgeInsets())
        .padding(.vertical, 4)
        .frame(maxWidth: .infinity)
    }
}

/// Короткая подпись дня недели (0=вс..6=сб). Переиспользуй, если такой helper уже есть в проекте —
/// не нашлось, завожу локально под чек-листы.
private func weekdayShort(_ d: Int) -> String {
    let keys = ["pe.wdSun", "pe.wdMon", "pe.wdTue", "pe.wdWed", "pe.wdThu", "pe.wdFri", "pe.wdSat"]
    guard d >= 0, d < keys.count else { return "?" }
    return t(keys[d])
}

/// Короткое summary расписания для карточки аудита (не занимает много места).
@MainActor private func recurrenceSummary(_ recurrence: String, _ weekdays: [Int]?, _ dayOfMonth: Int?) -> String {
    switch recurrence {
    case "daily": return t("pe.recurrenceDaily")
    case "weekly":
        let days = (weekdays ?? []).sorted().map { weekdayShort($0) }
        return days.isEmpty ? t("pe.recurrenceWeekly") : days.joined(separator: ",")
    case "monthly": return t("pe.dayOfMonthSummary", ["n": "\(dayOfMonth ?? 1)"])
    default: return ""
    }
}

private struct ChecklistHistorySheet: View {
    @Bindable var m: PeopleModel
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        NavigationStack {
            ZStack {
                Color.miseBg.ignoresSafeArea()
                ScrollView {
                    VStack(spacing: 12) {
                        if !m.clHistoryLoaded {
                            RowListSkeleton(rows: 3)
                        } else if m.historyByDate.isEmpty {
                            Text(t("pe.historyEmpty")).font(.system(size: 15)).foregroundStyle(.primary.opacity(0.4)).padding(.top, 60)
                        } else {
                            ForEach(m.historyByDate, id: \.0) { date, comps in dayCard(date, comps) }
                        }
                    }
                    .padding(16)
                }
            }
            .navigationTitle(t("pe.checklistHistory")).navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button(t("done")) { dismiss() } } }
            .toolbarBackground(Color.miseBg, for: .navigationBar)
        }
        .task { if !m.clHistoryLoaded { await m.loadChecklistHistory() } }
    }

    private func dayCard(_ date: String, _ comps: [ChecklistCompletion]) -> some View {
        var total = 0, done = 0
        var missed: [String] = []
        for c in comps {
            guard let cl = m.checklistTitle(c.checklist_id), let items = cl.items else { continue }
            let state = c.items_state ?? []
            for (i, it) in items.enumerated() {
                total += 1
                if i < state.count && state[i].done { done += 1 } else { missed.append(it) }
            }
        }
        let allDone = total > 0 && done == total
        return VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(dayLabel(date)).font(.system(size: 15, weight: .bold)).foregroundStyle(.primary)
                Spacer()
                Text("\(done)/\(total)").font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(allDone ? BrandKit.analytics : BrandKit.stash)
            }
            if missed.isEmpty {
                Text(t("pe.allDone")).font(.system(size: 13)).foregroundStyle(BrandKit.analytics)
            } else {
                ForEach(Array(missed.enumerated()), id: \.offset) { _, it in
                    HStack(spacing: 8) {
                        Image(systemName: "xmark.circle").font(.system(size: 13)).foregroundStyle(BrandKit.menu)
                        Text(it).font(.system(size: 13)).foregroundStyle(.primary.opacity(0.7))
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14).background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 14))
    }
}

// MARK: Техкарты

private let TC_CAT_CODES = ["dish", "prep", "stoplist"]
@MainActor private func tcCatLabel(_ c: String?) -> String {
    switch c { case "dish": return t("pe.tc.dish"); case "prep": return t("pe.tc.prep"); case "stoplist": return t("pe.tc.other"); default: return c ?? "—" }
}

private struct TechCardsTab: View {
    @Bindable var m: PeopleModel
    @State private var openId: String?
    @State private var edit: TechEdit?

    struct TechEdit: Identifiable {
        var id = UUID()
        var cardId: String?
        var name: String
        var category: String
        var items: [String]
    }

    var body: some View {
        Group {
            if !m.techLoaded {
                RowListSkeleton(rows: 3)
            } else {
                if m.isManager {
                    Button { edit = TechEdit(cardId: nil, name: "", category: "dish", items: [""]) } label: {
                        Label(t("pe.newTech"), systemImage: "plus")
                            .font(.system(size: 15, weight: .bold)).foregroundStyle(.white)
                            .frame(maxWidth: .infinity).padding(.vertical, 14)
                            .background(PEOPLE_ACCENT, in: RoundedRectangle(cornerRadius: 14))
                    }
                }
                if m.techCards.isEmpty {
                    Text(t("pe.noTech")).font(.system(size: 15)).foregroundStyle(.primary.opacity(0.4)).padding(.top, 50)
                } else {
                    ForEach(m.techCards) { c in card(c) }
                }
            }
        }
        .task(id: m.opsView) { if m.opsView == "tech" && !m.techLoaded { await m.loadTechCards() } }
        .sheet(item: $edit) { e in TechCardSheet(m: m, edit: e) }
    }

    private func card(_ c: TechCard) -> some View {
        let items = c.items ?? []
        let opened = openId == c.id
        return VStack(alignment: .leading, spacing: 0) {
            Button { withAnimation(.easeInOut(duration: 0.18)) { openId = opened ? nil : c.id } } label: {
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(c.name).font(.system(size: 15, weight: .semibold)).foregroundStyle(.primary)
                        Text("\(tcCatLabel(c.category)) · \(t("pe.stepsCount", ["n": "\(items.count)"]))").font(.system(size: 12)).foregroundStyle(.primary.opacity(0.45))
                    }
                    Spacer()
                    Image(systemName: opened ? "chevron.up" : "chevron.down").font(.system(size: 12)).foregroundStyle(.primary.opacity(0.4))
                }
                .padding(14)
            }
            .buttonStyle(.plain)
            if opened {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(Array(items.enumerated()), id: \.offset) { i, step in
                        HStack(alignment: .top, spacing: 10) {
                            Text("\(i + 1)").font(.system(size: 12, weight: .heavy)).foregroundStyle(PEOPLE_ACCENT).frame(width: 18, alignment: .leading)
                            Text(step).font(.system(size: 14)).foregroundStyle(.primary.opacity(0.8))
                        }
                    }
                    if m.isManager {
                        HStack(spacing: 8) {
                            Button(t("edit")) { edit = TechEdit(cardId: c.id, name: c.name, category: c.category ?? "dish", items: items.isEmpty ? [""] : items) }
                                .font(.system(size: 13, weight: .semibold)).foregroundStyle(PEOPLE_ACCENT)
                            Button(t("delete")) { Task { await m.deleteTechCard(c.id) } }
                                .font(.system(size: 13, weight: .semibold)).foregroundStyle(BrandKit.menu)
                        }
                        .padding(.top, 4)
                    }
                }
                .padding(.horizontal, 14).padding(.bottom, 14)
            }
        }
        .background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 16))
    }
}

private struct TechCardSheet: View {
    @Bindable var m: PeopleModel
    @Environment(\.dismiss) private var dismiss
    @State var edit: TechCardsTab.TechEdit
    @State private var saving = false

    var body: some View {
        NavigationStack {
            ZStack {
                Color.miseBg.ignoresSafeArea()
                Form {
                    Section { TextField(t("pe.techName"), text: $edit.name) }
                    Section(t("pe.type")) {
                        Picker(t("pe.type"), selection: $edit.category) {
                            ForEach(TC_CAT_CODES, id: \.self) { code in Text(tcCatLabel(code)).tag(code) }
                        }.pickerStyle(.segmented)
                    }
                    Section(t("pe.steps")) {
                        ForEach(edit.items.indices, id: \.self) { i in
                            TextField(t("pe.stepN", ["n": "\(i + 1)"]), text: $edit.items[i])
                        }
                        Button { edit.items.append("") } label: { Label(t("pe.moreStep"), systemImage: "plus") }
                    }
                }
                .scrollContentBackground(.hidden)
            }
            .navigationTitle(edit.cardId == nil ? t("pe.newTech") : t("pe.techTitle")).navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(t("cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(t("save")) {
                        guard !saving else { return }
                        saving = true
                        Task {
                            defer { saving = false }
                            await m.saveTechCard(id: edit.cardId, name: edit.name, category: edit.category, items: edit.items)
                            dismiss()
                        }
                    }.disabled(saving)
                }
            }
            .toolbarBackground(Color.miseBg, for: .navigationBar)
        }
    }
}

private struct OrdersInbox: View {
    @Bindable var m: PeopleModel
    var body: some View {
        Picker("", selection: $m.ordersSeg) {
            Text(m.activeOrders.isEmpty ? t("pe.active") : t("pe.activeN", ["n": "\(m.activeOrders.count)"])).tag("active")
            Text(t("pe.finished")).tag("done")
        }.pickerStyle(.segmented)

        let list = m.ordersSeg == "active" ? m.activeOrders : m.finishedOrders
        if !m.ordersLoaded {
            RowListSkeleton(rows: 3)
        } else if list.isEmpty {
            Text(m.ordersSeg == "active" ? t("pe.noActive") : t("empty"))
                .font(.system(size: 15)).foregroundStyle(.primary.opacity(0.4)).padding(.top, 50)
        } else {
            ForEach(list) { o in OrderCard(m: m, o: o) }
        }
    }
}

private struct OrderCard: View {
    @Bindable var m: PeopleModel
    let o: MenuOrder
    // Быстрые вызовы гостя: waiter | coal | water (маркер в items[0].call, см. /api/menu/order).
    private var callKind: String? { o.items?.first?.call }
    private var isCall: Bool { callKind != nil }
    private var callTitle: String {
        switch callKind {
        case "coal": t("pe.callCoal")
        case "water": t("pe.callWater")
        default: t("pe.callWaiter")
        }
    }
    private var active: Bool { o.status == "new" || o.status == "in_progress" }
    @State private var showCancelConfirm = false

    var body: some View {
        SwipeActionRow(
            leading: active ? SwipeAction(label: t("pe.order.done"), systemImage: "checkmark", tint: BrandKit.analytics, handler: {
                Task { await m.setOrderStatus(o, "done") }
            }) : nil,
            trailing: active ? [SwipeAction(label: t("cancel"), systemImage: "xmark", tint: BrandKit.menu, handler: {
                showCancelConfirm = true
            })] : []
        ) {
            VStack(alignment: .leading, spacing: 8) {
                header
                if !isCall {
                    itemsSection
                    Divider().overlay(Color.primary.opacity(0.08))
                    HStack {
                        Text(eur(o.total ?? 0)).font(.system(size: 15, weight: .heavy)).foregroundStyle(.primary)
                        Spacer()
                        buttons
                    }
                } else if active {
                    HStack { Spacer(); Button(t("pe.coming")) { Task { await m.setOrderStatus(o, "done") } }
                        .buttonStyle(.borderedProminent).tint(PEOPLE_ACCENT) }
                }
            }
            .padding(14)
            .background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 16))
            .overlay(alignment: .leading) { if isCall { Rectangle().fill(BrandKit.stash).frame(width: 3) } }
        }
        .confirmationDialog(t("pe.cancelOrder"), isPresented: $showCancelConfirm, titleVisibility: .visible) {
            Button(t("cancel"), role: .destructive) { Task { await m.setOrderStatus(o, "cancelled") } }
            Button(t("pe.keep"), role: .cancel) {}
        }
    }

    private var header: some View {
        HStack(spacing: 8) {
            if isCall { Text(callTitle).font(.system(size: 15, weight: .bold)).foregroundStyle(.primary) }
            if let tn = o.table_number {
                Text(t("pe.tableN", ["n": "\(tn)"])).font(.system(size: 12, weight: .heavy)).foregroundStyle(.primary)
                    .padding(.horizontal, 8).padding(.vertical, 3)
                    .background(isCall ? BrandKit.stash : PEOPLE_ACCENT, in: RoundedRectangle(cornerRadius: 7))
            }
            Text(orderTime(o.created_at)).font(.system(size: 12)).foregroundStyle(.primary.opacity(0.4))
            Spacer()
            Text(statusLabel(o.status)).font(.system(size: 11, weight: .bold)).foregroundStyle(statusColor(o.status))
                .padding(.horizontal, 8).padding(.vertical, 3)
                .background(statusColor(o.status).opacity(0.16), in: Capsule())
        }
    }

    private var itemsSection: some View {
        ForEach(Array((o.items ?? []).enumerated()), id: \.offset) { _, it in
            HStack {
                Text(itemLine(it)).font(.system(size: 14)).foregroundStyle(.primary)
                Spacer()
                if let p = it.price {
                    Text(eur(p * (it.qty ?? 1))).font(.system(size: 13)).foregroundStyle(.primary.opacity(0.4))
                }
            }
        }
    }

    private func itemLine(_ it: OrderItem) -> String {
        var s = it.name ?? "—"
        if let opts = it.opts, !opts.isEmpty { s += " · " + opts.joined(separator: ", ") }
        s += " × \(Int(it.qty ?? 1))"
        return s
    }

    @ViewBuilder private var buttons: some View {
        HStack(spacing: 8) {
            if o.status == "new" {
                Button(t("cancel")) { Task { await m.setOrderStatus(o, "cancelled") } }
                    .font(.system(size: 13, weight: .semibold)).foregroundStyle(.primary.opacity(0.6))
            }
            if o.status == "new" {
                Button(t("pe.cooking")) { Task { await m.setOrderStatus(o, "in_progress") } }
                    .buttonStyle(.borderedProminent).tint(PEOPLE_ACCENT).controlSize(.small)
            } else if o.status == "in_progress" {
                Button(t("pe.readyBtn")) { Task { await m.setOrderStatus(o, "done") } }
                    .buttonStyle(.borderedProminent).tint(PEOPLE_ACCENT).controlSize(.small)
            }
        }
    }

    private func statusLabel(_ s: String?) -> String {
        ["new": t("pe.order.new"), "in_progress": t("pe.order.inProgress"), "done": t("pe.order.done"), "cancelled": t("pe.order.cancelled")][s ?? "new"] ?? t("pe.order.new")
    }
    private func statusColor(_ s: String?) -> Color {
        ["new": BrandKit.stash, "in_progress": BrandKit.manager, "done": BrandKit.analytics, "cancelled": Color.primary.opacity(0.4)][s ?? "new"] ?? BrandKit.stash
    }
    private func orderTime(_ iso: String?) -> String {
        guard let d = parseISO(iso) else { return "" }
        let f = DateFormatter(); f.dateFormat = "HH:mm"; return f.string(from: d)
    }
}

private struct StopTab: View {
    @Bindable var m: PeopleModel
    var body: some View {
        if !m.menuLoaded {
            RowListSkeleton(rows: 3)
        } else if m.menu.isEmpty {
            Text(t("pe.menuEmpty")).font(.system(size: 15)).foregroundStyle(.primary.opacity(0.4)).padding(.top, 50)
        } else {
            HStack {
                Text(t("pe.stopList")).font(.system(size: 12, weight: .semibold)).foregroundStyle(.primary.opacity(0.45)).kerning(0.5)
                Spacer()
                if m.stopCount > 0 {
                    Text(t("pe.inStopN", ["n": "\(m.stopCount)"])).font(.system(size: 11, weight: .bold)).foregroundStyle(BrandKit.menu)
                        .padding(.horizontal, 8).padding(.vertical, 3)
                        .background(BrandKit.menu.opacity(0.16), in: Capsule())
                }
            }
            VStack(spacing: 0) {
                ForEach(Array(m.menu.enumerated()), id: \.element.id) { idx, item in
                    let avail = item.is_available ?? true
                    SwipeActionRow(
                        leading: (m.canStop && !avail) ? SwipeAction(label: t("pe.inMenu"), systemImage: "checkmark.circle", tint: BrandKit.analytics, handler: { Task { await m.toggleItem(item) } }) : nil,
                        trailing: (m.canStop && avail) ? [SwipeAction(label: t("pe.inStop"), systemImage: "minus.circle", tint: BrandKit.menu, handler: { Task { await m.toggleItem(item) } })] : []
                    ) {
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(item.name).font(.system(size: 15)).foregroundStyle(.primary.opacity(avail ? 1 : 0.4)).strikethrough(!avail)
                                if let p = item.price { Text(eur(p)).font(.system(size: 12)).foregroundStyle(.primary.opacity(0.4)) }
                            }
                            Spacer()
                            if m.canStop {
                                Toggle("", isOn: Binding(get: { avail }, set: { _ in Task { await m.toggleItem(item) } }))
                                    .labelsHidden().tint(BrandKit.analytics)
                            } else {
                                Text(avail ? t("pe.inMenu") : t("pe.inStop")).font(.system(size: 12, weight: .semibold))
                                    .foregroundStyle(avail ? BrandKit.analytics : BrandKit.menu)
                            }
                        }
                        .padding(.vertical, 10).padding(.horizontal, 14)
                        .background(Color.primary.opacity(0.06))
                    }
                    if idx < m.menu.count - 1 { Divider().overlay(Color.primary.opacity(0.08)).padding(.leading, 14) }
                }
            }
            .background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 16))
        }
    }
}

// MARK: даты

private func hhmm(_ s: String?) -> String {
    guard let s, s.count >= 5 else { return "—" }
    return String(s.prefix(5))
}
private func clock(_ iso: String?) -> String {
    guard let d = parseISO(iso) else { return "—" }
    let f = DateFormatter(); f.dateFormat = "HH:mm"; return f.string(from: d)
}
private func dayLabel(_ ymd: String) -> String {
    let inF = DateFormatter(); inF.dateFormat = "yyyy-MM-dd"; inF.locale = Locale(identifier: "en_US_POSIX")
    guard let d = inF.date(from: ymd) else { return ymd }
    let f = DateFormatter(); f.locale = appLocale(); f.dateFormat = "EEE, d MMM"
    return f.string(from: d).capitalized
}
