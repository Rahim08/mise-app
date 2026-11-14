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
    var creatingTask = false
    var creatingReport = false
    var creatingPurchase = false
    var creatingSwap = false
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
    /// Своя опубликованная смена на сегодня — гейт «Я здесь» (Д4, 2026-07-31). nil, пока не
    /// проверено ИЛИ смены нет; published-фильтр серверный (.eq), поле в модель не тащим.
    var mySchedToday: Schedule? = nil
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
    var checklistsSubTab = "shift" // shift | walk | audits — пилюля контента в ShiftAuditHub (Д5).
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
        // Открытые — все (старая незакрытая задача не должна выпадать из-за 200 свежих),
        // выполненные — свежие 200.
        async let openR = try? DB.from("staff_tasks").select().neq("status", "done").order("created_at", ascending: false).limit(1000).list(StaffTask.self)
        async let doneR = try? DB.from("staff_tasks").select().eq("status", "done").order("created_at", ascending: false).limit(200).list(StaffTask.self)
        async let dR = try? DB.from("staff_directory").select().eq("is_active", true).order("name").list(StaffDir.self)
        let openO = await openR, doneO = await doneR, dO = await dR
        if let o = openO, let d = doneO { tasks = o + d } else if !tasks.isEmpty { flash(t("refreshFailed")) }
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
        // Повторный тап, пока идёт запись, создавал дубль.
        guard !creatingTask else { return false }
        creatingTask = true; defer { creatingTask = false }
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
            // Форма остаётся открытой с введённым текстом (раньше возвращали true — шторка
            // закрывалась и текст терялся).
            flash(t("saveFailed", ["err": lastError.localizedDescription]))
            return false
        } else {
            // При частичном сбое (задача «на роль») — честное число созданных, а не всех целей.
            let created = targets.count - failed
            flash(targets.count > 1 ? t("pe.taskCreatedN", ["n": "\(created)"]) : t("pe.taskCreated"))
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
        _ = await createTask(title: title, desc: "", assignee: assignee, priority: "medium", due: "")
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
    // Личный вид: свои заявки, независимо от роли (реструктура 2026-08-13) — разбор ВСЕХ
    // заявок сотрудников переехал в Manager→Настройки→Заявки (ManagerReports.swift).
    var visibleReports: [StaffReport] { reports.filter { $0.author_id == myId } }

    func createReport(type: String, title: String, desc: String) async -> Bool {
        guard !title.trimmingCharacters(in: .whitespaces).isEmpty else { flash(t("pe.reportNeedTitle")); return false }
        guard !creatingReport else { return false }
        creatingReport = true; defer { creatingReport = false }
        var v: [String: Any] = [
            "restaurant_id": rid, "type": type, "title": title, "status": "new",
            "author_id": myId == "owner" || myId.isEmpty ? NSNull() : myId,
        ]
        if !desc.isEmpty { v["description"] = desc }
        do {
            try await DB.from("staff_reports").insert(v).run()
        } catch { flash(t("saveFailed", ["err": error.localizedDescription])); return false }
        flash(t("pe.reportSent"))
        // Юзер-фидбок 2026-08-14: менеджер видел новую заявку только зайдя в Manager сам —
        // добавлен пуш, тот же паттерн, что покупки/явка (audience managers).
        await Notify.send(type: "report", title: t("pe.newReport"), body: title,
                          audience: ["managers": true], titleKey: "notify.newReportTitle")
        await loadReports()
        return true
    }
    func deleteReport(_ id: String) async {
        reports.removeAll { $0.id == id }
        do {
            try await DB.from("staff_reports").delete().eq("id", id).run()
        } catch { flash(t("saveFailed", ["err": error.localizedDescription])); await loadReports() }
    }
    func canDeleteReport(_ r: StaffReport) -> Bool { isManager || r.author_id == myId }

    // MARK: зарплата (личный вид; фонд/оплата/долг всех сотрудников — Manager→Зарплата,
    // реструктура 2026-08-13, см. docs/MANAGER-PEOPLE-RESTRUCTURE-2026-08-13.md)

    struct SalRow: Identifiable {
        let id: String; let name: String; let salary: Double; let absences: Int
        let absenceList: [String]  // absence dates for display
        let deduct: Double; let card: Double; let advance: Double
        let advanceList: [SalaryAdvance]; let total: Double; let cash: Double
        var paid: Double = 0; var remaining: Double = 0; var lastPaidAt: String? = nil
        /// Открытый ЗП-долг — обещание выплатить позже, не выплата.
        var openDebt: Double = 0
        /// paid | debt | partial | unpaid | none — считает сервер.
        var status: String = "none"
    }
    var salaryFailed = false
    private var salarySeq = 0

    var salaryViewMonth: Date = Date()

    var salaryIsCurrentMonth: Bool { Calendar.current.isDate(salaryViewMonth, equalTo: Date(), toGranularity: .month) }

    func changeSalaryMonth(_ dir: Int) {
        if dir > 0 && salaryIsCurrentMonth { return }
        guard let d = Calendar.current.date(byAdding: .month, value: dir, to: salaryViewMonth) else { return }
        salaryViewMonth = d
        salaryLoaded = false
        Task { await loadSalary() }
    }

    /// Ответ /api/people/salary — личная строка, посчитанная сервером.
    private nonisolated struct PersonalSalaryDTO: Decodable, Sendable {
        let id: String; let name: String; let salary: Double; let dates: [String]; let absences: Int
        let deduct: Double; let card: Double; let advance: Double; let advances: [SalaryAdvance]
        let paid: Double; let total: Double; let cash: Double; let remaining: Double
        let openDebt: Double; let lastPaidAt: String?; let status: String
    }

    /// Личный расчёт ЗП делает сервер (аудит People 2026-11-14): только своя строка по
    /// staff.employee_id (не по имени — однофамильцы видели чужую сумму), сбой любой
    /// составляющей — ошибка, а не нули; запоздавший ответ прошлого месяца отбрасывается.
    func loadSalary() async {
        #if DEBUG
        if ProcessInfo.processInfo.environment["MISE_DEMO_UI"] == "1" { seedSalary(); return }
        #endif
        salarySeq += 1
        let seq = salarySeq
        let ym = String(key(salaryViewMonth).prefix(7))
        do {
            let r = try await API.people("/api/people/salary?month=\(ym)", method: "GET", as: PersonalSalaryDTO.self)
            guard seq == salarySeq else { return }
            salaryRows = r.map { d in
                [SalRow(id: d.id, name: d.name, salary: d.salary, absences: d.absences, absenceList: d.dates, deduct: d.deduct,
                        card: d.card, advance: d.advance, advanceList: d.advances, total: d.total, cash: d.cash,
                        paid: d.paid, remaining: d.remaining, lastPaidAt: d.lastPaidAt, openDebt: d.openDebt, status: d.status)]
            } ?? []
            salaryFailed = false
        } catch {
            guard seq == salarySeq else { return }
            salaryRows = []
            salaryFailed = true
        }
        salaryLoaded = true
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
        // Личный вид (реструктура 2026-08-13): всегда своя смена, даже у менеджера —
        // весь график всех сотрудников теперь Manager→Настройки→Расписание.
        // Черновики (published=false) сотруднику не показываем — менеджер ещё не опубликовал.
        let rows = schAll.filter { $0.staff_id == myId && (isManager || $0.published != false) }
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

    // MARK: явка

    func loadAttendance() async {
        #if DEBUG
        if ProcessInfo.processInfo.environment["MISE_DEMO_UI"] == "1" { seedAttendance(); return }
        #endif
        // Показать отложенную явку из очереди до запроса сети
        pendingCheckIn = UserDefaults.standard.data(forKey: pendingCheckInKey) != nil

        let cal = Calendar.current
        let monthStart = cal.date(from: cal.dateComponents([.year, .month], from: Date())) ?? Date()
        // Нет строки настроек = гео-явка не настроена (не «неизвестно»): иначе гейт навсегда закрыт.
        if let rows = try? await DB.from("restaurant_settings").select().limit(1).list(GeoSettings.self) {
            geo = rows.first ?? GeoSettings(attendance_enabled: false, latitude: nil, longitude: nil, geo_radius_m: nil, late_grace_min: nil)
        }
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
            let day = todayKey
            // Сбой сети не должен стирать график (Б7): раньше try? превращал ошибку в «смены нет».
            if let rows = try? await DB.from("staff_schedules").select()
                .eq("staff_id", myId).eq("date", day).eq("published", true).limit(1).list(Schedule.self) {
                mySchedToday = rows.first
                mySchedDate = day
            } else if mySchedDate != day { mySchedToday = nil }
        }
        attLoaded = true

        // Попытка сбросить очередь офлайн-явки
        if !isManager && pendingCheckIn { await flushPendingCheckIn() }
    }
    /// Рабочий день заведения (до day_start_hour — ещё вчера), как shifts.date в Manager:
    /// раньше после полуночи явка, график и чек-лист закрытия искались на «завтра» (Б5).
    var todayKey: String { key(AppModel.businessDate(dayStartHour: geo?.day_start_hour ?? 6)) }
    /// Сегодняшняя запись явки. Ночная смена: незакрытая вчерашняя запись до полудня остаётся
    /// «текущей» — иначе после 00:00 нельзя было ни уйти, ни отметить пункты чек-листа.
    var todayRec: AttendanceRecord? {
        if let r = attendance.first(where: { $0.staff_id == myId && $0.date == todayKey }) { return r }
        let bday = AppModel.businessDate(dayStartHour: geo?.day_start_hour ?? 6)
        guard Calendar.current.component(.hour, from: Date()) < 12,
              let y = Calendar.current.date(byAdding: .day, value: -1, to: bday) else { return nil }
        let yk = key(y)
        return attendance.first { $0.staff_id == myId && $0.date == yk && $0.check_in_at != nil && $0.check_out_at == nil }
    }
    /// Дата, на которую загружен mySchedToday: после полуночи экран не должен жить вчерашним графиком.
    var mySchedDate: String? = nil

    // MARK: ключ очереди офлайн-явки
    private var pendingCheckInKey: String { "mise_pending_checkin_\(rid)_\(myId)" }

    func checkIn() async {
        // Перешли через полночь с открытым экраном — перечитываем график на новую дату.
        if mySchedDate != todayKey { await loadAttendance() }
        guard todayRec == nil else { return }
        // Мягкий гейт графика (аудит People 2026-11-14, Б3): без смены по графику явка всё равно
        // отмечается — «вне графика» видно менеджеру. Жёсткий гейт блокировал весь день в SO.
        // Настройки не загрузились — неизвестно, нужна ли проверка места: закрыто (Б6).
        guard let g = geo else { flash(t("refreshFailed")); return }
        checking = true; defer { checking = false }

        var sentCoord: CLLocationCoordinate2D?
        if g.active, let lat = g.latitude, let lng = g.longitude {
            guard let coord = await LocationOneShot().current() else { flash(t("pe.noGeo")); return }
            if distanceMeters(coord, lat, lng) > (g.geo_radius_m ?? 150) { flash(t("pe.outOfZone")); return }
            sentCoord = coord
        }

        // Идемпотентность: убедиться, что записи за сегодня нет (двойная проверка)
        let existing = (try? await DB.from("attendance_records").select()
            .eq("staff_id", myId).eq("date", todayKey).limit(1).list(AttendanceRecord.self)) ?? []
        guard existing.isEmpty else { await loadAttendance(); return }

        // Опоздание — как на вебе (checkIn в tabs-shifts.tsx): от начала смены по графику.
        // Порог — настраиваемый грейс (restaurant_settings.late_grace_min), не хардкод: раньше
        // 5 мин было зашито в статус/бейдж/пуш «опоздал», хотя в статистике Дисциплины грейс
        // уже применялся корректно — несостыковка внутри одной фичи (аудит 2026-08-04).
        let grace = geo?.late_grace_min ?? 5
        var late: Int? = nil, status = "present"
        if let start = mySchedToday?.shift_start, start.count >= 5 {
            let hh = Int(start.prefix(2)) ?? 0, mm = Int(start.dropFirst(3).prefix(2)) ?? 0
            var comps = Calendar.current.dateComponents([.year, .month, .day], from: Date())
            comps.hour = hh; comps.minute = mm
            if let startDate = Calendar.current.date(from: comps) {
                let mins = max(0, Int(Date().timeIntervalSince(startDate) / 60))
                late = mins; status = mins > grace ? "late" : "present"
            }
        }
        var payload: [String: Any] = [
            "restaurant_id": rid, "staff_id": myId, "date": todayKey,
            "check_in_at": ISO8601DateFormatter().string(from: Date()), "late_minutes": late as Any, "status": status, "source": "manual",
        ]
        // Координаты — чтобы сервер сам проверил радиус и посчитал дистанцию (аудит 2026-11-14, К3).
        if let c = sentCoord { payload["check_in_lat"] = c.latitude; payload["check_in_lng"] = c.longitude }
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
            // Опоздание и статус фиксируются в момент нажатия — при досылке из очереди их уже
            // не восстановить (раньше офлайн-приход всегда уходил как «вовремя»).
            var pending: [String: String] = ["date": todayKey, "ts": ISO8601DateFormatter().string(from: Date()), "status": status]
            if let late { pending["late"] = String(late) }
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
        if geo?.active == true, let coord = await LocationOneShot().current() {
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
        var row: [String: Any] = [
            "restaurant_id": rid, "staff_id": myId, "date": date,
            "check_in_at": ts, "status": pending["status"] ?? "present", "source": "manual",
        ]
        if let l = pending["late"].flatMap(Int.init) { row["late_minutes"] = l }
        do {
            try await DB.from("attendance_records").insert(row).run()
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
    /// Заявка и график меняются одной серверной операцией (/api/people/swap): раньше смена
    /// перевешивалась, а статус мог не сохраниться — обмен применялся наполовину, но
    /// приложение всё равно писало «Обмен утверждён».
    func swapApprove(_ r: SwapRequest) async {
        struct Ok: Decodable { let id: String }
        do {
            _ = try await API.people("/api/people/swap", body: ["id": r.id], as: Ok.self)
        } catch {
            flash(t("saveFailed", ["err": error.localizedDescription])); await loadSwaps(); return
        }
        if let i = swaps.firstIndex(where: { $0.id == r.id }) { swaps[i].status = "approved" }
        if let rid = r.requester_id {
            await Notify.send(type: "swap_result", title: t("pe.swapApproved"), body: t("pe.swapApproved"),
                              audience: ["staff_ids": [rid]], titleKey: "notify.swapApprovedTitle", bodyKey: "notify.swapApprovedBody")
        }
        flash(t("pe.swapApproved"))
        await loadSwaps()
    }

    // MARK: чек-листы

    func loadChecklists() async {
        #if DEBUG
        if ProcessInfo.processInfo.environment["MISE_DEMO_UI"] == "1" { seedChecklists(); return }
        #endif
        // Чек-лист привязан к открытой смене модуля Manager: пока на сегодня есть смена,
        // чек-лист активен, а его прохождение пишется по shift_id этой смены. Новая смена
        // (новый день/новый shift_id) → чистые галочки.
        // Рабочий день зависит от day_start_hour — настройки нужны до поиска смены (Б5).
        if geo == nil, let rows = try? await DB.from("restaurant_settings").select().limit(1).list(GeoSettings.self) {
            geo = rows.first ?? GeoSettings(attendance_enabled: false, latitude: nil, longitude: nil, geo_radius_m: nil, late_grace_min: nil)
        }
        guard let sh = try? await DB.from("shifts").select("id, status, date")
            .eq("date", todayKey).order("opened_at", ascending: false).limit(1).list(ShiftRef.self) else {
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

    /// Атомарная отметка одного пункта на сервере (/api/people/checklist-item, аудит People
    /// 2026-11-14): сервер сливает пункт по compare-and-swap — параллельные отметки коллег
    /// больше не затираются (раньше клиент перезаписывал весь items_state).
    /// Сетевой сбой → URLError (вызывающий кладёт в офлайн-очередь), отказ сервера → APIError.
    func saveChecklistItemRemote(checklistId: String, idx: Int, item: ChecklistItemState, completionId: String?,
                                 shiftId: String?, date: String, verify: Bool = false) async throws -> ChecklistCompletion? {
        var body: [String: Any] = ["checklist_id": checklistId, "idx": idx, "item": item.asDict, "date": date]
        if let completionId { body["completion_id"] = completionId }
        if let shiftId { body["shift_id"] = shiftId }
        if let att = attendance.first(where: { $0.staff_id == myId && $0.date == todayKey })?.id { body["attendance_id"] = att }
        if verify { body["verify"] = true }
        return try await API.people("/api/people/checklist-item", body: body, as: ChecklistCompletion.self)
    }

    /// Общая запись пункта аудита (toggle/grade/note). Сеть недоступна — офлайн-очередь;
    /// отказ сервера — сообщение и перечитка (раньше любой сбой молча уходил в очередь).
    private func persistAuditItem(_ list: ShiftChecklist, _ idx: Int, _ newItem: ChecklistItemState) async {
        let cid = auditRuns.first(where: { $0.checklist_id == list.id && $0.date == todayKey })?.id
        do {
            let row = try await saveChecklistItemRemote(checklistId: list.id, idx: idx, item: newItem, completionId: cid,
                                                        shiftId: nil, date: todayKey)
            if let row {
                if let i = auditRuns.firstIndex(where: { $0.id == row.id }) { auditRuns[i] = row } else { auditRuns.insert(row, at: 0) }
                if row.status == "done" { flash(t("pe.auditDone")) }
            }
        } catch is URLError {
            queuePendingChecklistToggle(completionId: cid, checklistId: list.id, date: todayKey, idx: idx, done: newItem.done, photoURL: newItem.photo_url, newState: newItem)
        } catch {
            flash(t("saveFailed", ["err": error.localizedDescription])); await loadAudits()
        }
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


    /// Гео-гейт: если явка с геолокацией включена, пункт можно отмечать только если у
    /// сотрудника уже есть сегодняшняя запись attendance_records — иначе открытая касса
    /// (Manager) одна не доказывает физическое присутствие ИМЕННО этого человека.
    private func requireGeoCheckIn() async -> Bool {
        // Должностные лица явку не отмечают («Я здесь» только у сотрудника) — раньше при
        // включённой гео-явке менеджер/владелец не мог отметить ни одного пункта.
        if isManager { return true }
        // Настройки ещё не загружены — сначала грузим, а не пропускаем проверку (раньше geo == nil
        // трактовался как «гео выключена»). Не удалось загрузить — закрыто, а не открыто.
        if geo == nil || !attLoaded { await loadAttendance() }
        guard let g = geo else { flash(t("refreshFailed")); return false }
        guard g.active else { return true }
        guard todayRec != nil else {
            flash(t("pe.needCheckInFirst")); return false
        }
        return true
    }

    func toggleChecklistItem(_ list: ShiftChecklist, _ idx: Int, photoURL: String? = nil) async {
        guard let sid = openShiftId else { flash(t(isManager ? "pe.openShiftFirst" : "pe.askManagerOpenShift")); return }
        guard await requireGeoCheckIn() else { return }
        let itemsList = list.itemDetails ?? []
        let comp = completion(list)
        var item = (comp?.items_state ?? []).indices.contains(idx) ? comp!.items_state![idx] : ChecklistItemState(done: false)
        let willBeDone = !item.done
        if willBeDone, idx < itemsList.count, itemsList[idx].photo_required, photoURL == nil {
            flash(t("pe.photoRequired")); return
        }
        item.done = willBeDone
        if let photoURL { item.photo_url = photoURL }
        do {
            let row = try await saveChecklistItemRemote(checklistId: list.id, idx: idx, item: item, completionId: comp?.id,
                                                        shiftId: sid, date: todayKey)
            if let row {
                if let i = completions.firstIndex(where: { $0.id == row.id }) { completions[i] = row } else { completions.append(row) }
                if row.status == "done" { flash(clType == "open" ? t("pe.checklistOpenDone") : t("pe.checklistCloseDone")) }
            }
        } catch is URLError {
            queuePendingChecklistToggle(completionId: comp?.id, checklistId: list.id, date: todayKey, shiftId: sid,
                                        idx: idx, done: item.done, photoURL: photoURL, newState: item)
        } catch {
            flash(t("saveFailed", ["err": error.localizedDescription])); await loadChecklists()
        }
    }

    // gradeChecklistItem (менеджерская верификация сменного чек-листа) переехала в
    // ManagerChecklistsModel (ManagerChecklists.swift, реструктура 2026-08-14) — People
    // больше не верифицирует чужие прогоны, только свои проходит.

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
    @ObservationIgnored private var flushingChecklistQueue = false
    func flushPendingChecklistQueue() async {
        // loadChecklists и loadAudits зовут досылку параллельно — без замка одни и те же
        // отметки уходили дважды.
        guard !flushingChecklistQueue else { return }
        flushingChecklistQueue = true; defer { flushingChecklistQueue = false }
        let queue = loadPendingChecklistQueue()
        guard !queue.isEmpty else { return }
        var remaining: [PendingChecklistToggle] = []
        for item in queue {
            guard let clId = item.checklistId ?? (completions + auditRuns).first(where: { $0.id == item.completionId })?.checklist_id else {
                // Старый элемент без checklist_id и прогон не найден в памяти — пробуем позже.
                if item.completionId != nil { remaining.append(item) }
                continue
            }
            let state = item.newState ?? ChecklistItemState(done: item.done, photo_url: item.photoURL)
            do {
                _ = try await saveChecklistItemRemote(checklistId: clId, idx: item.idx, item: state, completionId: item.completionId,
                                                      shiftId: item.shiftId, date: item.date ?? todayKey)
            } catch is URLError {
                remaining.append(item)
            } catch {
                // Сервер отверг (прогон удалён/нет доступа) — повтор бесполезен, выбрасываем.
            }
        }
        // Пока досылали (await на каждом пункте), могли добавиться новые офлайн-отметки —
        // очередь только дописывается в конец, поэтому сохраняем всё, что добавилось после
        // прочитанного в начале, а не затираем остатком (аудит 2026-11-14, К4).
        let appended = Array(loadPendingChecklistQueue().dropFirst(queue.count))
        let keep = remaining + appended
        if keep.isEmpty { UserDefaults.standard.removeObject(forKey: pendingChecklistKey) }
        else if let data = try? JSONEncoder().encode(keep) { UserDefaults.standard.set(data, forKey: pendingChecklistKey) }
        if remaining.count < queue.count { await loadChecklists(); await loadAudits() }
    }

    // -> Bool: раньше Void и вызывающая шторка закрывалась (dismiss()) независимо от
    // результата — сбой сети молча терял весь введённый шаблон, юзер видел только
    // мимолётный flash (аудит 2026-08-04). Теперь вызывающая сторона гейтит dismiss на true.
    @discardableResult
    func saveChecklistTemplate(id: String?, role: String?, items: [ChecklistItem], kind: String = "shift", targetScope: String = "role", assignedStaffId: String? = nil, title: String? = nil, type: String? = nil, recurrence: String = "none", recurrenceWeekdays: [Int]? = nil, recurrenceDayOfMonth: Int? = nil) async -> Bool {
        let clean = items.map { ChecklistItem(id: $0.id, label: $0.label.trimmingCharacters(in: .whitespaces), photo_required: $0.photo_required, weight: $0.weight) }.filter { !$0.label.isEmpty }
        guard !clean.isEmpty else { flash(t("pe.addItem")); return false }
        let roleVal: Any = role ?? NSNull()
        let itemDicts = clean.map { $0.asDict }
        // Расписание имеет смысл только для разовых аудитов — для kind="shift" всегда "none"/NULL.
        let recurrenceVal: Any = kind == "audit" ? recurrence : "none"
        let weekdaysVal: Any = kind == "audit" ? ((recurrenceWeekdays as Any?) ?? NSNull()) : NSNull()
        let domVal: Any = kind == "audit" ? ((recurrenceDayOfMonth as Any?) ?? NSNull()) : NSNull()
        do {
            if let id {
                var patch: [String: Any] = [
                    "items": itemDicts, "role": roleVal,
                    "recurrence": recurrenceVal, "recurrence_weekdays": weekdaysVal, "recurrence_day_of_month": domVal,
                ]
                // Форма аудита даёт менять название, охват и исполнителя — раньше update их не
                // писал, правка молча терялась (аудит 2026-11-14, В2). Шаблоны смены их не имеют.
                if kind == "audit" {
                    patch["title"] = title ?? NSNull()
                    patch["target_scope"] = targetScope
                    patch["assigned_staff_id"] = assignedStaffId ?? NSNull()
                }
                try await DB.from("shift_checklists").update(patch).eq("id", id).run()
            } else {
                try await DB.from("shift_checklists").insert([
                    // kind="audit": type — семантика открытия/закрытия смены к разовым аудитам не относится, NULL.
                    "restaurant_id": rid, "type": kind == "audit" ? NSNull() : (type ?? clType), "items": itemDicts, "role": roleVal,
                    "kind": kind, "target_scope": targetScope, "assigned_staff_id": assignedStaffId ?? NSNull(),
                    "title": title ?? NSNull(),
                    "recurrence": recurrenceVal, "recurrence_weekdays": weekdaysVal, "recurrence_day_of_month": domVal,
                ] as [String: Any]).run()
            }
        } catch { flash(t("saveFailed", ["err": error.localizedDescription])); return false }
        flash(t("pe.checklistSaved"))
        if kind == "audit" { await loadAudits() } else { await loadChecklists() }
        return true
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

    /// Восьмёрка — общий пул для менеджеров (Д3, 2026-07-30): по исследованию обход-восьмёрка
    /// исторически обязанность сменного менеджера, не рядового персонала — рядовой сотрудник
    /// не видит вкладку вообще (гейтится в ZalTab). Редактирование шаблонов переехало в
    /// Manager→Настройки (реструктура 2026-08-13, ManagerWalkModel) — здесь менеджер только
    /// запускает обход и смотрит историю, как личное действие.
    func relevantWalks() -> [WalkTemplate] { isManager ? walkTemplates : [] }

    /// Итог прогона восьмёрки — пишется ОДНИМ запросом по завершению обхода (не поштучно,
    /// как аудиты: чекбоксы копятся локально в раннере, таймер/шагомер — тоже; сеть нужна
    /// только один раз в конце, обход не прерывается офлайн-очередями на каждый тап).
    @discardableResult
    func finishWalkRun(template: WalkTemplate, itemsState: [ChecklistItemState], durationSeconds: Int, steps: Int) async -> Bool {
        guard await requireGeoCheckIn() else { return false }
        let staffVal: Any = myId == "owner" || myId.isEmpty ? NSNull() : myId
        do {
            try await DB.from("shift_checklist_completions").insert([
                "restaurant_id": rid, "checklist_id": template.id, "date": todayKey,
                "staff_id": staffVal, "items_state": itemsState.map { $0.asDict },
                "completed_at": ISO8601DateFormatter().string(from: Date()), "status": "done",
                "duration_seconds": durationSeconds, "steps": steps,
            ] as [String: Any]).run()
        } catch { flash(t("saveFailed", ["err": error.localizedDescription])); return false }
        flash(t("pe.auditDone"))
        await loadWalks()
        return true
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
    // -> Bool: см. saveChecklistTemplate — dismiss на вызывающей стороне гейтится на true.
    @discardableResult
    func saveTechCard(id: String?, name: String, category: String, items: [String]) async -> Bool {
        guard !name.trimmingCharacters(in: .whitespaces).isEmpty else { flash(t("pe.needName")); return false }
        let clean = items.map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        do {
            if let id {
                try await DB.from("tech_cards").update(["name": name, "category": category, "items": clean]).eq("id", id).run()
            } else {
                try await DB.from("tech_cards").insert(["restaurant_id": rid, "name": name, "category": category, "items": clean]).run()
            }
        } catch { flash(t("saveFailed", ["err": error.localizedDescription])); return false }
        flash(t("pe.saved"))
        await loadTechCards()
        return true
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
        guard !creatingSwap else { return false }
        creatingSwap = true; defer { creatingSwap = false }
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
        // «К закупке» — все открытые; общий лимит 300 выбрасывал старые некупленные позиции.
        async let todoR = try? DB.from("purchase_items").select().eq("status", "todo").order("created_at", ascending: false).limit(1000).list(PurchaseItem.self)
        async let doneR = try? DB.from("purchase_items").select().neq("status", "todo").order("created_at", ascending: false).limit(300).list(PurchaseItem.self)
        if let a = await todoR, let b = await doneR { purchase = a + b } else if !purchase.isEmpty { flash(t("refreshFailed")) }
        purchaseLoaded = true
    }
    var purchaseTodo: [PurchaseItem] { purchase.filter { $0.status == "todo" } }
    var purchaseDone: [PurchaseItem] { purchase.filter { $0.status != "todo" } }

    // -> Bool: см. saveChecklistTemplate — dismiss на вызывающей стороне гейтится на true.
    @discardableResult
    func addPurchase(category: String, rows: [(name: String, qty: String, unit: String)], catLabel: String) async -> Bool {
        let valid = rows.map { ($0.name.trimmingCharacters(in: .whitespaces), $0.qty, $0.unit) }.filter { !$0.0.isEmpty }
        if valid.isEmpty { return false }
        guard !creatingPurchase else { return false }
        creatingPurchase = true; defer { creatingPurchase = false }
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
        } catch { flash(t("saveFailed", ["err": error.localizedDescription])); return false }
        let who = myName.isEmpty ? "" : "\(myName): "
        let body = valid.count == 1 ? "\(who)\(valid[0].0)" : "\(who)\(t("st.positions", ["n": "\(valid.count)"]))"
        await Notify.send(type: "purchase", title: "\(catLabel) · \(t("pe.pTab"))", body: body,
                          audience: ["managers": true], titleKey: "notify.purchaseTitle", titleParams: ["category": category],
                          bodyKey: valid.count > 1 ? "notify.purchasePositionsBody" : nil,
                          bodyParams: valid.count > 1 ? ["who": who, "n": "\(valid.count)"] : nil,
                          data: ["category": category])
        await loadPurchase()
        return true
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
        let demoAdv = SalaryAdvance(id: "adv1", employee_id: "e1", amount: 200, date: "2026-06-12", note: "Анна Кузнецова аванс", period: "2026-06-01")
        salaryRows = [
            .init(id: "e1", name: "Анна Кузнецова", salary: 1200, absences: 0, absenceList: [], deduct: 0, card: 450, advance: 200, advanceList: [demoAdv], total: 1200, cash: 550),
            .init(id: "e2", name: "Игорь Петров",   salary: 1100, absences: 1, absenceList: ["2026-06-14"], deduct: 20, card: 0, advance: 0, advanceList: [], total: 1080, cash: 1080),
            .init(id: "e3", name: "Мария Соколова", salary: 900,  absences: 2, absenceList: ["2026-06-10", "2026-06-18"], deduct: 30, card: 300, advance: 0, advanceList: [], total: 870, cash: 570),
        ]
        salaryRows = salaryRows.filter { $0.name == myName }
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
        geo = .init(attendance_enabled: false, latitude: nil, longitude: nil, geo_radius_m: 150, late_grace_min: 5)
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

