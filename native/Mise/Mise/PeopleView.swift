import SwiftUI
import CoreLocation

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
        Calendar.current.date(from: Calendar.current.dateComponents([.year, .month], from: Date()))!
    }()
    var selectedCalDate: String? = nil

    // явка
    var attendance: [AttendanceRecord] = []
    var geo: GeoSettings?
    var attLoaded = false
    var checking = false
    var todayScheduledIds: Set<String> = []

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
        async let tk = (try? DB.from("staff_tasks").select().order("created_at", ascending: false).list(StaffTask.self)) ?? []
        async let d = (try? DB.from("staff_directory").select().eq("is_active", true).order("name").list(StaffDir.self)) ?? []
        tasks = await tk; dir = await d; tasksLoaded = true
    }
    func staffName(_ id: String?) -> String { dir.first { $0.id == id }?.name ?? "—" }
    var visibleTasks: [StaffTask] {
        isManager ? tasks : tasks.filter { $0.assigned_to == myId || $0.created_by == myId }
    }
    func tasks(_ status: String) -> [StaffTask] { visibleTasks.filter { ($0.status ?? "todo") == status } }

    func setStatus(_ task: StaffTask, _ status: String) async {
        if let i = tasks.firstIndex(where: { $0.id == task.id }) { tasks[i].status = status }
        let completed: Any = status == "done" ? ISO8601DateFormatter().string(from: Date()) : NSNull()
        try? await DB.from("staff_tasks").update(["status": status, "completed_at": completed]).eq("id", task.id).run()
    }
    func removeTask(_ id: String) async {
        tasks.removeAll { $0.id == id }
        try? await DB.from("staff_tasks").delete().eq("id", id).run()
    }
    func canDelete(_ t: StaffTask) -> Bool { isManager || t.created_by == myId }

    func createTask(title: String, desc: String, assignee: String, priority: String, due: String) async -> Bool {
        guard !title.trimmingCharacters(in: .whitespaces).isEmpty, !assignee.isEmpty else { flash(t("pe.taskNeedTitle")); return false }
        var base: [String: Any] = [
            "restaurant_id": rid, "title": title, "priority": priority, "status": "todo",
            "created_by": myId == "owner" ? NSNull() : myId,
        ]
        if !desc.isEmpty { base["description"] = desc }
        if !due.isEmpty { base["due_date"] = due }
        var targets = [assignee]
        if assignee.hasPrefix("role:") {
            let role = String(assignee.dropFirst(5))
            targets = dir.filter { $0.role == role }.map(\.id)
            if targets.isEmpty { flash(t("pe.noRoleStaff")); return false }
        }
        for tid in targets {
            var v = base; v["assigned_to"] = tid
            try? await DB.from("staff_tasks").insert(v).run()
            if tid != myId {
                try? await DB.from("notifications").insert([
                    "restaurant_id": rid, "staff_id": tid, "type": "task", "title": "Новая задача", "body": title,
                ]).run()
            }
        }
        flash(targets.count > 1 ? t("pe.taskCreatedN", ["n": "\(targets.count)"]) : t("pe.taskCreated"))
        await loadTasks()
        return true
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
        try? await DB.from("staff_reports").insert(v).run()
        flash(t("pe.reportSent"))
        await loadReports()
        return true
    }
    func setReportStatus(_ r: StaffReport, _ status: String) async {
        if let i = reports.firstIndex(where: { $0.id == r.id }) { reports[i].status = status }
        let resolvedAt: Any = status == "resolved" ? ISO8601DateFormatter().string(from: Date()) : NSNull()
        try? await DB.from("staff_reports").update(["status": status, "resolved_at": resolvedAt]).eq("id", r.id).run()
    }
    func deleteReport(_ id: String) async {
        reports.removeAll { $0.id == id }
        try? await DB.from("staff_reports").delete().eq("id", id).run()
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
        async let emps = (try? DB.from("employees").select("id, name, salary, deduct_per_absence").eq("is_active", true).order("name").list(Employee.self)) ?? []
        async let abs = (try? DB.from("shift_absences").select("employee_id, date, source").gte("date", ym + "-01").list(Absence.self)) ?? []
        async let cards = (try? DB.from("monthly_card_amounts").select("employee_id, card_amount").eq("month", ym).list(CardAmount.self)) ?? []
        let employees = await emps, absences = await abs, cardAmounts = await cards

        let advances = (try? await DB.from("salary_advances").select()
            .gte("date", ym + "-01").lte("date", ym + "-31").list(SalaryAdvance.self)) ?? []

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
        let monthStart = cal.date(from: cal.dateComponents([.year, .month], from: calendarMonth))!
        let lastDay = cal.date(byAdding: .day, value: -1,
                               to: cal.date(byAdding: .month, value: 1, to: monthStart)!)!
        async let dirL = (try? DB.from("staff_directory").select().eq("is_active", true).order("name").list(StaffDir.self)) ?? []
        async let sch = (try? DB.from("staff_schedules").select().gte("date", key(monthStart)).lte("date", key(lastDay)).list(Schedule.self)) ?? []
        if dir.isEmpty { dir = await dirL } else { _ = await dirL }
        var rows = await sch
        if !isManager { rows = rows.filter { $0.staff_id == myId } }
        schedules = rows.sorted { $0.date < $1.date }
        schedLoaded = true
    }

    func prevMonth() async {
        calendarMonth = Calendar.current.date(byAdding: .month, value: -1, to: calendarMonth)!
        selectedCalDate = nil; schedLoaded = false
        await loadSchedule()
    }
    func nextMonth() async {
        calendarMonth = Calendar.current.date(byAdding: .month, value: 1, to: calendarMonth)!
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
        try? await DB.from("staff_schedules").insert(v).run()
        flash(t("pe.shiftAdded"))
        await loadSchedule()
        return true
    }
    func deleteSchedule(_ id: String) async {
        schedules.removeAll { $0.id == id }
        try? await DB.from("staff_schedules").delete().eq("id", id).run()
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
        try? await DB.from("staff_schedules").insert(inserts).run()
        flash(t("pe.copied", ["n": "\(inserts.count)"]))
        await loadSchedule()
        return true
    }
    func copyLastWeek() async {
        let cal = Calendar.current
        let weekday = cal.component(.weekday, from: Date())
        let monday = cal.date(byAdding: .day, value: -((weekday + 5) % 7), to: Date())!
        let lastMon = cal.date(byAdding: .day, value: -7, to: monday)!
        let lastSun = cal.date(byAdding: .day, value: -1, to: monday)!
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
        if !inserts.isEmpty { try? await DB.from("staff_schedules").insert(inserts).run() }
        flash(t("pe.copied", ["n": "\(inserts.count)"]))
        await loadSchedule()
    }

    // MARK: явка

    func loadAttendance() async {
        #if DEBUG
        if ProcessInfo.processInfo.environment["MISE_DEMO_UI"] == "1" { seedAttendance(); return }
        #endif
        let cal = Calendar.current
        let monthStart = cal.date(from: cal.dateComponents([.year, .month], from: Date()))!
        if let g = try? await DB.from("restaurant_settings").select().limit(1).list(GeoSettings.self).first { geo = g }
        if isManager {
            attendance = (try? await DB.from("attendance_records").select().gte("date", key(monthStart)).order("date", ascending: false).limit(500).list(AttendanceRecord.self)) ?? []
            if dir.isEmpty { dir = (try? await DB.from("staff_directory").select().eq("is_active", true).order("name").list(StaffDir.self)) ?? [] }
            struct SchedStub: Codable { let staff_id: String }
            let todayScheds = (try? await DB.from("staff_schedules").select("staff_id").eq("date", todayKey).list(SchedStub.self)) ?? []
            todayScheduledIds = Set(todayScheds.map { $0.staff_id })
        } else {
            attendance = (try? await DB.from("attendance_records").select().eq("staff_id", myId).order("date", ascending: false).limit(62).list(AttendanceRecord.self)) ?? []
        }
        attLoaded = true
    }
    var todayKey: String { key(Date()) }
    var todayRec: AttendanceRecord? { attendance.first { $0.staff_id == myId && $0.date == todayKey } }

    func checkIn() async {
        guard todayRec == nil else { return }
        checking = true; defer { checking = false }
        if let g = geo, g.attendance_enabled == true, let lat = g.latitude, let lng = g.longitude {
            guard let coord = await LocationOneShot().current() else { flash(t("pe.noGeo")); return }
            if distanceMeters(coord, lat, lng) > (g.geo_radius_m ?? 150) { flash(t("pe.outOfZone")); return }
        }
        try? await DB.from("attendance_records").insert([
            "restaurant_id": rid, "staff_id": myId, "date": todayKey,
            "check_in_at": ISO8601DateFormatter().string(from: Date()), "status": "present", "source": "manual",
        ]).run()
        await Notify.send(type: "attendance", title: "Сотрудник на смене", body: "\(myName.isEmpty ? "Сотрудник" : myName) пришёл(а)", audience: ["managers": true])
        flash(t("pe.checkedIn"))
        await loadAttendance()
    }

    // MARK: обмены

    func loadSwaps() async {
        #if DEBUG
        if ProcessInfo.processInfo.environment["MISE_DEMO_UI"] == "1" { seedSwaps(); return }
        #endif
        let cal = Calendar.current
        let from = key(cal.date(byAdding: .day, value: -14, to: Date())!)
        let to = key(cal.date(byAdding: .day, value: 60, to: Date())!)
        swaps = (try? await DB.from("shift_swap_requests").select().order("created_at", ascending: false).list(SwapRequest.self)) ?? []
        if dir.isEmpty { dir = (try? await DB.from("staff_directory").select().eq("is_active", true).order("name").list(StaffDir.self)) ?? [] }
        swapScheds = (try? await DB.from("staff_schedules").select().gte("date", from).lte("date", to).list(Schedule.self)) ?? []
        swapsLoaded = true
    }
    func swapSched(_ id: String?) -> Schedule? { swapScheds.first { $0.id == id } }
    var incomingSwaps: [SwapRequest] { swaps.filter { $0.target_id == myId } }
    var outgoingSwaps: [SwapRequest] { swaps.filter { $0.requester_id == myId } }
    var managerQueueSwaps: [SwapRequest] { swaps.filter { $0.status == "peer_accepted" } }

    private func patchSwap(_ r: SwapRequest, _ status: String) async {
        if let i = swaps.firstIndex(where: { $0.id == r.id }) { swaps[i].status = status }
        try? await DB.from("shift_swap_requests").update(["status": status]).eq("id", r.id).run()
    }
    func swapPeerAccept(_ r: SwapRequest) async { await patchSwap(r, "peer_accepted") }
    func swapPeerDecline(_ r: SwapRequest) async { await patchSwap(r, "peer_declined") }
    func swapCancel(_ r: SwapRequest) async { await patchSwap(r, "cancelled") }
    func swapReject(_ r: SwapRequest) async { await patchSwap(r, "rejected") }
    func swapApprove(_ r: SwapRequest) async {
        if let sid = r.schedule_id, let tid = r.target_id {
            try? await DB.from("staff_schedules").update(["staff_id": tid]).eq("id", sid).run()
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
        let sh = (try? await DB.from("shifts").select("id, status, date")
            .eq("date", key(Date())).order("opened_at", ascending: false).limit(1).list(ShiftRef.self)) ?? []
        openShiftId = sh.first?.id
        if let cls = try? await DB.from("shift_checklists").select().list(ShiftChecklist.self) { checklists = cls }
        if let sid = openShiftId {
            completions = (try? await DB.from("shift_checklist_completions").select().eq("shift_id", sid).list(ChecklistCompletion.self)) ?? []
        } else {
            completions = []
        }
        checklistsLoaded = true
    }

    func loadChecklistHistory() async {
        #if DEBUG
        if ProcessInfo.processInfo.environment["MISE_DEMO_UI"] == "1" { clHistoryLoaded = true; return }
        #endif
        let from = key(Calendar.current.date(byAdding: .day, value: -30, to: Date())!)
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
    func checklistTitle(_ id: String?) -> ShiftChecklist? { checklists.first { $0.id == id } }
    func relevantChecklists() -> [ShiftChecklist] {
        checklists.filter { ($0.type ?? "open") == clType && (isManager || $0.role == nil || $0.role == myRole) }
    }
    func completion(_ list: ShiftChecklist) -> ChecklistCompletion? { completions.first { $0.checklist_id == list.id } }

    func toggleChecklistItem(_ list: ShiftChecklist, _ idx: Int) async {
        guard let sid = openShiftId else { flash(t("pe.openShiftFirst")); return }
        let items = list.items ?? []
        var state = completion(list)?.items_state ?? Array(repeating: false, count: items.count)
        while state.count < items.count { state.append(false) }
        state[idx].toggle()
        let allDone = state.allSatisfy { $0 }
        let completedAt: Any = allDone ? ISO8601DateFormatter().string(from: Date()) : NSNull()
        if let i = completions.firstIndex(where: { $0.checklist_id == list.id }), let cid = completions[i].id as String? {
            completions[i].items_state = state
            try? await DB.from("shift_checklist_completions").update(["items_state": state, "completed_at": completedAt]).eq("id", cid).run()
        } else {
            try? await DB.from("shift_checklist_completions").insert([
                "restaurant_id": rid, "checklist_id": list.id, "shift_id": sid, "date": key(Date()),
                "staff_id": myId == "owner" || myId.isEmpty ? NSNull() : myId,
                "items_state": state, "completed_at": completedAt,
            ]).run()
            await loadChecklists()
        }
        if allDone { flash(clType == "open" ? "Открытие готово" : "Закрытие готово") }
    }

    func saveChecklistTemplate(id: String?, role: String?, items: [String]) async {
        let clean = items.map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        guard !clean.isEmpty else { flash(t("pe.addItem")); return }
        let roleVal: Any = role ?? NSNull()
        if let id {
            try? await DB.from("shift_checklists").update(["items": clean, "role": roleVal]).eq("id", id).run()
        } else {
            try? await DB.from("shift_checklists").insert([
                "restaurant_id": rid, "type": clType, "items": clean, "role": roleVal,
            ]).run()
        }
        flash(t("pe.checklistSaved"))
        await loadChecklists()
    }
    func deleteChecklist(_ id: String) async {
        checklists.removeAll { $0.id == id }
        try? await DB.from("shift_checklists").delete().eq("id", id).run()
    }

    // MARK: техкарты

    func loadTechCards() async {
        #if DEBUG
        if ProcessInfo.processInfo.environment["MISE_DEMO_UI"] == "1" { seedTech(); return }
        #endif
        techCards = (try? await DB.from("tech_cards").select().eq("is_active", true).order("name").list(TechCard.self)) ?? []
        techLoaded = true
    }
    func saveTechCard(id: String?, name: String, category: String, items: [String]) async {
        guard !name.trimmingCharacters(in: .whitespaces).isEmpty else { flash(t("pe.needName")); return }
        let clean = items.map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        if let id {
            try? await DB.from("tech_cards").update(["name": name, "category": category, "items": clean]).eq("id", id).run()
        } else {
            try? await DB.from("tech_cards").insert(["restaurant_id": rid, "name": name, "category": category, "items": clean]).run()
        }
        flash(t("pe.saved"))
        await loadTechCards()
    }
    func deleteTechCard(_ id: String) async {
        techCards.removeAll { $0.id == id }
        try? await DB.from("tech_cards").update(["is_active": false]).eq("id", id).run()
    }

    // создание обмена сотрудником
    var myUpcomingScheds: [Schedule] {
        swapScheds.filter { $0.staff_id == myId && $0.date >= todayKey }.sorted { $0.date < $1.date }
    }
    func createSwap(scheduleId: String, targetId: String, note: String) async -> Bool {
        guard !scheduleId.isEmpty, !targetId.isEmpty else { flash(t("pe.pickShiftPeer")); return false }
        let noteVal: Any = note.isEmpty ? NSNull() : note
        try? await DB.from("shift_swap_requests").insert([
            "restaurant_id": rid, "schedule_id": scheduleId, "requester_id": myId,
            "target_id": targetId, "status": "pending_peer", "note": noteVal,
        ]).run()
        try? await DB.from("notifications").insert([
            "restaurant_id": rid, "staff_id": targetId, "type": "swap_request",
            "title": "Запрос на обмен", "body": "\(myName) предлагает обмен сменой",
        ]).run()
        flash(t("pe.requestSent"))
        await loadSwaps()
        return true
    }

    // MARK: стоп-лист

    func loadMenu() async {
        #if DEBUG
        if ProcessInfo.processInfo.environment["MISE_DEMO_UI"] == "1" { seedMenu(); return }
        #endif
        menu = (try? await DB.from("menu_items").select().eq("is_visible", true).order("position").list(MenuItem.self)) ?? []
        menuLoaded = true
    }
    func toggleItem(_ item: MenuItem) async {
        guard let i = menu.firstIndex(where: { $0.id == item.id }) else { return }
        let next = !(menu[i].is_available ?? true)
        menu[i].is_available = next
        try? await DB.from("menu_items").update(["is_available": next]).eq("id", item.id).run()
    }
    var stopCount: Int { menu.filter { $0.is_available == false }.count }

    // заказы (инбокс)
    func loadOrders() async {
        #if DEBUG
        if ProcessInfo.processInfo.environment["MISE_DEMO_UI"] == "1" { seedOrders(); return }
        #endif
        let from = key(Calendar.current.date(byAdding: .day, value: -2, to: Date())!)
        orders = (try? await DB.from("menu_orders").select().gte("created_at", from)
            .order("created_at", ascending: false).limit(100).list(MenuOrder.self)) ?? []
        ordersLoaded = true
    }
    var activeOrders: [MenuOrder] { orders.filter { $0.status == "new" || $0.status == "in_progress" } }
    var finishedOrders: [MenuOrder] { orders.filter { $0.status == "done" || $0.status == "cancelled" } }
    func setOrderStatus(_ o: MenuOrder, _ status: String) async {
        if let i = orders.firstIndex(where: { $0.id == o.id }) { orders[i].status = status }
        try? await DB.from("menu_orders").update(["status": status]).eq("id", o.id).run()
    }

    // закуп
    func loadPurchase() async {
        purchase = (try? await DB.from("purchase_items").select().order("created_at", ascending: false).limit(300).list(PurchaseItem.self)) ?? []
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
        try? await DB.from("purchase_items").insert(payload).run()
        let who = myName.isEmpty ? "" : "\(myName): "
        let body = valid.count == 1 ? "\(who)\(valid[0].0)" : "\(who)\(valid.count)"
        await Notify.send(type: "purchase", title: "\(catLabel) · \(t("pe.pTab"))", body: body, audience: ["managers": true], data: ["category": category])
        await loadPurchase()
    }

    func setPurchaseStatus(_ it: PurchaseItem, _ status: String) async {
        if let i = purchase.firstIndex(where: { $0.id == it.id }) { purchase[i].status = status }
        var v: [String: Any] = ["status": status]
        let boughtBy: Any = (status == "bought" && myId != "owner") ? myId : NSNull()
        v["bought_by"] = boughtBy
        v["bought_at"] = status == "bought" ? ISO8601DateFormatter().string(from: Date()) : NSNull()
        try? await DB.from("purchase_items").update(v).eq("id", it.id).run()
    }

    func removePurchase(_ it: PurchaseItem) async {
        purchase.removeAll { $0.id == it.id }
        try? await DB.from("purchase_items").delete().eq("id", it.id).run()
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
            .init(id: "t1", title: "Принять поставку", description: "Сверить накладную", assigned_to: "e2", created_by: nil, priority: "high", due_date: "2026-06-16", status: "todo"),
            .init(id: "t2", title: "Помыть кофемашину", description: nil, assigned_to: "e3", created_by: nil, priority: "medium", due_date: nil, status: "in_progress"),
            .init(id: "t3", title: "Обновить стоп-лист", description: nil, assigned_to: "e1", created_by: nil, priority: "low", due_date: nil, status: "done"),
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
        completions = [.init(id: "cm1", checklist_id: "cl1", date: key(Date()), items_state: [true, true, false])]
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
            .init(id: "o1", table_number: 4, status: "new", total: 29, created_at: "2026-06-15T17:40:00Z",
                  items: [.init(name: "Хумус", qty: 1, price: 8, opts: nil, call: nil),
                          .init(name: "Шаурма", qty: 1, price: 12, opts: ["острая"], call: nil),
                          .init(name: "Чай", qty: 3, price: 3, opts: nil, call: nil)]),
            .init(id: "o2", table_number: 7, status: "in_progress", total: 0, created_at: "2026-06-15T17:55:00Z",
                  items: [.init(name: nil, qty: nil, price: nil, opts: nil, call: "waiter")]),
            .init(id: "o3", table_number: 2, status: "done", total: 16, created_at: "2026-06-15T16:10:00Z",
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
                                        myName: s?.name ?? "", isManager: (s?.isOwner ?? false) || s?.role == "manager",
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

    var body: some View {
        Picker("", selection: $m.tasksSeg) {
            Text(t("tab.tasks")).tag("tasks")
            Text(m.newReportsCount > 0 ? t("pe.reportsN", ["n": "\(m.newReportsCount)"]) : t("pe.reports")).tag("reports")
        }.pickerStyle(.segmented)

        if m.tasksSeg == "reports" {
            ReportsTab(m: m)
        } else {
            tasksContent
        }
    }

    @ViewBuilder private var tasksContent: some View {
        // Любой сотрудник может поставить задачу коллеге/сменщику (раньше — только менеджер).
        Button { showForm = true } label: {
            Label(t("pe.newTask"), systemImage: "plus")
                .font(.system(size: 15, weight: .bold)).foregroundStyle(.white)
                .frame(maxWidth: .infinity).padding(.vertical, 14)
                .background(PEOPLE_ACCENT, in: RoundedRectangle(cornerRadius: 14))
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
        return HStack(alignment: .top, spacing: 12) {
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
            .preferredColorScheme(.dark)
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
                ProgressView().tint(.primary).padding(.top, 40)
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
            .preferredColorScheme(.dark)
        }
    }
}

// MARK: Зарплата

private struct PeopleSalaryTab: View {
    @Bindable var m: PeopleModel
    @State private var open: String?

    var body: some View {
        if !m.salaryLoaded {
            ProgressView().tint(.primary).padding(.top, 40)
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
    var body: some View {
        Picker("", selection: $m.shiftsView) {
            Text(t("tab.shifts")).tag("shifts")
            Text(t("pe.swaps")).tag("swaps")
        }.pickerStyle(.segmented)

        if m.shiftsView == "swaps" {
            SwapsTab(m: m)
        } else {
            CombinedShifts(m: m)
        }
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
                ProgressView().tint(.primary).padding(.top, 40)
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
                }
                .frame(maxWidth: .infinity).padding(20)
                .background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 18))
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
            Text(t("pe.todayCaps")).font(.system(size: 12, weight: .semibold)).foregroundStyle(.primary.opacity(0.45)).kerning(0.5).padding(.bottom, 8)
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

// MARK: Обмены

private struct SwapsTab: View {
    @Bindable var m: PeopleModel
    @State private var showCreate = false
    var body: some View {
        Group {
            if !m.swapsLoaded {
                ProgressView().tint(.primary).padding(.top, 40)
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
            .preferredColorScheme(.dark)
        }
    }
}

// MARK: Смены (расписание)

private struct ShiftsCalendar: View {
    @Bindable var m: PeopleModel

    private let cal = Calendar.current

    private var monthStart: Date {
        cal.date(from: cal.dateComponents([.year, .month], from: m.calendarMonth))!
    }
    private var daysInMonth: Int { cal.range(of: .day, in: .month, for: monthStart)!.count }
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
            ProgressView().tint(.primary).padding(.top, 40)
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
            .preferredColorScheme(.dark)
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
                ProgressView().tint(.primary).padding(.top, 40)
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
    }

    private func row(_ it: PurchaseItem) -> some View {
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
                                TextField(t("pe.pQty"), text: $r.qty).textFieldStyle(.roundedBorder).frame(width: 64).keyboardType(.decimalPad)
                                TextField(t("pe.pUnit"), text: $r.unit).textFieldStyle(.roundedBorder).frame(width: 64)
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

    struct ChecklistEdit: Identifiable { var id = UUID(); var listId: String?; var role: String?; var items: [String] }

    var body: some View {
        Group {
            if !m.checklistsLoaded {
                ProgressView().tint(.primary).padding(.top, 40)
            } else {
                if m.openShiftId == nil { inactiveBanner }
                Picker("", selection: $m.clType) {
                    Text(t("pe.open")).tag("open"); Text(t("pe.close")).tag("close")
                }.pickerStyle(.segmented)
                let lists = m.relevantChecklists()
                if lists.isEmpty {
                    Text(t("pe.noChecklists")).font(.system(size: 15)).foregroundStyle(.primary.opacity(0.4)).padding(.top, 40)
                } else {
                    ForEach(lists) { list in section(list) }
                }
                if m.isManager {
                    Button { edit = ChecklistEdit(listId: nil, role: nil, items: [""]) } label: {
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
                }
            }
        }
        .task(id: m.opsView) { if m.opsView == "check" && !m.checklistsLoaded { await m.loadChecklists() } }
        .sheet(item: $edit) { e in ChecklistEditSheet(m: m, edit: e) }
        .sheet(isPresented: $showHistory) { ChecklistHistorySheet(m: m) }
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

    private func section(_ list: ShiftChecklist) -> some View {
        let items = list.items ?? []
        let state = m.completion(list)?.items_state ?? []
        let done = items.indices.filter { $0 < state.count && state[$0] }.count
        return VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("\(roleTitle(list.role)) · \(done)/\(items.count)")
                    .font(.system(size: 12, weight: .semibold)).foregroundStyle(list.role != nil ? PEOPLE_ACCENT : .white.opacity(0.45)).kerning(0.5)
                Spacer()
                if done == items.count && !items.isEmpty {
                    Text(t("pe.readyCaps")).font(.system(size: 11, weight: .bold)).foregroundStyle(BrandKit.analytics)
                        .padding(.horizontal, 8).padding(.vertical, 2).background(BrandKit.analytics.opacity(0.16), in: Capsule())
                }
                if m.isManager {
                    Button { edit = ChecklistEdit(listId: list.id, role: list.role, items: items.isEmpty ? [""] : items) } label: {
                        Image(systemName: "pencil").font(.system(size: 13)).foregroundStyle(PEOPLE_ACCENT)
                    }
                    Button { Task { await m.deleteChecklist(list.id) } } label: {
                        Image(systemName: "trash").font(.system(size: 13)).foregroundStyle(.primary.opacity(0.3))
                    }
                }
            }
            .padding(.bottom, 8)
            VStack(spacing: 0) {
                ForEach(Array(items.enumerated()), id: \.offset) { i, text in
                    let on = i < state.count && state[i]
                    Button { Task { await m.toggleChecklistItem(list, i) } } label: {
                        HStack(spacing: 12) {
                            ZStack {
                                Circle().stroke(on ? PEOPLE_ACCENT : Color.primary.opacity(0.25), lineWidth: 2).frame(width: 22, height: 22)
                                if on { Circle().fill(PEOPLE_ACCENT).frame(width: 22, height: 22)
                                    Image(systemName: "checkmark").font(.system(size: 11, weight: .bold)).foregroundStyle(.primary) }
                            }
                            Text(text).font(.system(size: 15)).foregroundStyle(.primary.opacity(on ? 0.5 : 1)).strikethrough(on)
                            Spacer()
                        }
                        .padding(.vertical, 12).padding(.horizontal, 14)
                    }
                    .buttonStyle(.plain)
                    if i < items.count - 1 { Divider().overlay(Color.primary.opacity(0.07)).padding(.leading, 48) }
                }
            }
            .background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 16))
        }
        .padding(.top, 4)
    }

    private func roleTitle(_ role: String?) -> String {
        guard let role else { return t("pe.role.general") }
        let known = ["kitchen", "bar", "hookah", "waiter", "host", "cleaner"]
        return known.contains(role) ? t("pe.role." + role) : role
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

    var body: some View {
        NavigationStack {
            ZStack {
                Color.miseBg.ignoresSafeArea()
                Form {
                    Section(t("pe.workshop")) {
                        Picker(t("pe.workshop"), selection: Binding(get: { edit.role ?? "" }, set: { edit.role = $0.isEmpty ? nil : $0 })) {
                            ForEach(CHECKLIST_ROLE_CODES, id: \.self) { code in Text(checklistRoleLabel(code)).tag(code ?? "") }
                        }
                    }
                    Section(t("pe.items")) {
                        ForEach(edit.items.indices, id: \.self) { i in
                            TextField(t("pe.itemN", ["n": "\(i + 1)"]), text: $edit.items[i])
                        }
                        Button { edit.items.append("") } label: { Label(t("pe.moreItem"), systemImage: "plus") }
                    }
                }
                .scrollContentBackground(.hidden)
            }
            .navigationTitle(m.clType == "open" ? t("pe.checklistOpenTitle") : t("pe.checklistCloseTitle")).navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(t("cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(t("save")) {
                        Task { await m.saveChecklistTemplate(id: edit.listId, role: edit.role, items: edit.items); dismiss() }
                    }
                }
            }
            .toolbarBackground(Color.miseBg, for: .navigationBar)
            .preferredColorScheme(.dark)
        }
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
                            ProgressView().tint(.primary).padding(.top, 40)
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
            .preferredColorScheme(.dark)
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
                if i < state.count && state[i] { done += 1 } else { missed.append(it) }
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
                ProgressView().tint(.primary).padding(.top, 40)
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
                        Task { await m.saveTechCard(id: edit.cardId, name: edit.name, category: edit.category, items: edit.items); dismiss() }
                    }
                }
            }
            .toolbarBackground(Color.miseBg, for: .navigationBar)
            .preferredColorScheme(.dark)
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
            ProgressView().tint(.primary).padding(.top, 40)
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
    private var isCall: Bool { o.items?.first?.call == "waiter" }
    private var active: Bool { o.status == "new" || o.status == "in_progress" }

    var body: some View {
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

    private var header: some View {
        HStack(spacing: 8) {
            if isCall { Text(t("pe.callWaiter")).font(.system(size: 15, weight: .bold)).foregroundStyle(.primary) }
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
            ProgressView().tint(.primary).padding(.top, 40)
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
