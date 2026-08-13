import SwiftUI

// MARK: - Manager → Настройки → Расписание (реструктура 2026-08-13, см.
// docs/MANAGER-PEOPLE-RESTRUCTURE-2026-08-13.md). Перенесено из PeopleSchedule.swift без
// изменений в логике (график/копирование недели) — только источник данных. В People
// менеджер теперь видит только свой личный график, как рядовой сотрудник.

private let SCHED_ACCENT = BrandKit.manager

@MainActor
@Observable
final class ManagerScheduleModel {
    let rid: String
    init(rid: String) { self.rid = rid }

    var dir: [StaffDir] = []
    var schedules: [Schedule] = []
    var loaded = false
    var calendarMonth: Date = {
        let cal = Calendar.current
        return cal.date(from: cal.dateComponents([.year, .month], from: Date())) ?? Date()
    }()
    var selectedCalDate: String? = nil
    var toast: String?
    private func flash(_ m: String) {
        toast = m
        Task { try? await Task.sleep(nanoseconds: 2_400_000_000); if toast == m { toast = nil } }
    }

    private let dfKey: DateFormatter = {
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.locale = Locale(identifier: "en_US_POSIX")
        return f
    }()
    func key(_ d: Date) -> String { dfKey.string(from: d) }
    func staffName(_ id: String?) -> String { dir.first { $0.id == id }?.name ?? t("pe.unknown") }

    func load() async {
        let cal = Calendar.current
        let monthStart = cal.date(from: cal.dateComponents([.year, .month], from: calendarMonth)) ?? calendarMonth
        let lastDay = cal.date(byAdding: .day, value: -1,
                               to: cal.date(byAdding: .month, value: 1, to: monthStart) ?? monthStart) ?? monthStart
        async let dirL = try? DB.from("staff_directory").select().eq("is_active", true).order("name").list(StaffDir.self)
        async let schR = try? DB.from("staff_schedules").select().gte("date", key(monthStart)).lte("date", key(lastDay)).list(Schedule.self)
        if let d = await dirL { dir = d }
        guard let schAll = await schR else {
            if !schedules.isEmpty { flash(t("refreshFailed")) }
            return
        }
        schedules = schAll.sorted { $0.date < $1.date }
        loaded = true
    }

    func prevMonth() async {
        calendarMonth = Calendar.current.date(byAdding: .month, value: -1, to: calendarMonth) ?? calendarMonth
        selectedCalDate = nil; loaded = false
        await load()
    }
    func nextMonth() async {
        calendarMonth = Calendar.current.date(byAdding: .month, value: 1, to: calendarMonth) ?? calendarMonth
        selectedCalDate = nil; loaded = false
        await load()
    }
    var schedByDate: [(String, [Schedule])] {
        var m: [String: [Schedule]] = [:]
        for s in schedules { m[s.date, default: []].append(s) }
        return m.sorted { $0.key < $1.key }
    }

    func deleteSchedule(_ id: String) async {
        schedules.removeAll { $0.id == id }
        do { try await DB.from("staff_schedules").delete().eq("id", id).run() }
        catch { flash(t("saveFailed", ["err": error.localizedDescription])); await load() }
    }
    func createSchedules(staffId: String, dates: [String], start: String, end: String, note: String) async -> Bool {
        guard !staffId.isEmpty else { flash(t("pe.pickStaff")); return false }
        guard !dates.isEmpty else { flash(t("pe.pickDates")); return false }
        var inserts: [[String: Any]] = []
        for d in dates {
            var v: [String: Any] = ["restaurant_id": rid, "staff_id": staffId, "date": d, "shift_start": start, "shift_end": end]
            if !note.isEmpty { v["note"] = note }
            inserts.append(v)
        }
        do { try await DB.from("staff_schedules").insert(inserts).run() }
        catch { flash(t("saveFailed", ["err": error.localizedDescription])); return false }
        flash(t("pe.copied", ["n": "\(inserts.count)"]))
        await load()
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
            guard let d = dfKey.date(from: s.date), let nd = cal.date(byAdding: .day, value: 7, to: d) else { continue }
            var v: [String: Any] = ["restaurant_id": rid, "staff_id": s.staff_id ?? "", "date": key(nd)]
            if let st = s.shift_start { v["shift_start"] = st }
            if let en = s.shift_end { v["shift_end"] = en }
            if let n = s.note { v["note"] = n }
            inserts.append(v)
        }
        if !inserts.isEmpty {
            do { try await DB.from("staff_schedules").insert(inserts).run() }
            catch { flash(t("saveFailed", ["err": error.localizedDescription])); return }
        }
        flash(t("pe.copied", ["n": "\(inserts.count)"]))
        await load()
    }
}

struct ManagerScheduleTab: View {
    let rid: String
    @State private var sm: ManagerScheduleModel?

    var body: some View {
        Group {
            if let sm {
                ManagerScheduleBody(sm: sm)
            } else {
                RowListSkeleton(rows: 3)
            }
        }
        .navigationTitle(t("tab.shifts"))
        .task {
            if sm == nil {
                let model = ManagerScheduleModel(rid: rid)
                sm = model
                await model.load()
            }
        }
    }
}

private struct ManagerScheduleBody: View {
    @Bindable var sm: ManagerScheduleModel
    @State private var showAdd = false

    var body: some View {
        ScrollView {
            VStack(spacing: 14) {
                calendar
                HStack(spacing: 10) {
                    Button { showAdd = true } label: {
                        Label(t("pe.addShift"), systemImage: "plus")
                            .font(.system(size: 14, weight: .bold)).foregroundStyle(.white)
                            .minimumScaleFactor(0.7).lineLimit(1)
                            .frame(maxWidth: .infinity).padding(.vertical, 12)
                            .background(SCHED_ACCENT, in: RoundedRectangle(cornerRadius: 12))
                    }
                    Button { Task { await sm.copyLastWeek() } } label: {
                        Label(t("pe.lastWeek"), systemImage: "doc.on.doc")
                            .font(.system(size: 14, weight: .semibold)).foregroundStyle(SCHED_ACCENT)
                            .minimumScaleFactor(0.7).lineLimit(1)
                            .frame(maxWidth: .infinity).padding(.vertical, 12)
                            .background(SCHED_ACCENT.opacity(0.14), in: RoundedRectangle(cornerRadius: 12))
                    }
                }
                if sm.schedByDate.isEmpty {
                    Text(t("pe.scheduleEmptyMgr")).font(.system(size: 15)).foregroundStyle(.primary.opacity(0.4))
                        .multilineTextAlignment(.center).padding(.top, 20)
                } else {
                    ForEach(sm.schedByDate, id: \.0) { date, items in
                        VStack(alignment: .leading, spacing: 0) {
                            Text(dayLabel(date).uppercased())
                                .font(.system(size: 12, weight: .semibold))
                                .foregroundStyle(.primary.opacity(0.45)).kerning(0.5)
                                .padding(.bottom, 8)
                            VStack(spacing: 0) {
                                ForEach(Array(items.enumerated()), id: \.element.id) { idx, s in
                                    HStack {
                                        Text(sm.staffName(s.staff_id)).font(.system(size: 15)).foregroundStyle(.primary)
                                        Spacer()
                                        Text("\(hhmm(s.shift_start))–\(hhmm(s.shift_end))")
                                            .font(.system(size: 14, weight: .semibold)).foregroundStyle(SCHED_ACCENT)
                                        Button { Task { await sm.deleteSchedule(s.id) } } label: {
                                            Image(systemName: "trash").font(.system(size: 13)).foregroundStyle(.primary.opacity(0.3))
                                        }.padding(.leading, 8)
                                    }
                                    .padding(.vertical, 11).padding(.horizontal, 14)
                                    if idx < items.count - 1 {
                                        Divider().overlay(Color.primary.opacity(0.08)).padding(.leading, 14)
                                    }
                                }
                            }
                            .background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 14))
                        }
                    }
                }
            }
            .padding(16)
        }
        .overlay(alignment: .bottom) {
            if let toast = sm.toast {
                Text(toast).font(.system(size: 13, weight: .semibold)).foregroundStyle(.primary)
                    .padding(.horizontal, 16).padding(.vertical, 10)
                    .background(.ultraThinMaterial, in: Capsule())
                    .padding(.bottom, 20)
            }
        }
        .sheet(isPresented: $showAdd) { ManagerScheduleEditSheet(sm: sm) }
    }

    private let cal = Calendar.current
    private var monthStart: Date {
        cal.date(from: cal.dateComponents([.year, .month], from: sm.calendarMonth)) ?? sm.calendarMonth
    }
    private var daysInMonth: Int { cal.range(of: .day, in: .month, for: monthStart)?.count ?? 30 }
    private var firstOffset: Int {
        let wd = cal.component(.weekday, from: monthStart)
        return (wd + 5) % 7
    }
    private var monthLabel: String {
        let fmt = DateFormatter(); fmt.dateFormat = "LLLL yyyy"
        let map = ["ru": "ru_RU", "en": "en_US", "it": "it_IT", "fr": "fr_FR",
                   "az": "az_AZ", "tr": "tr_TR", "uk": "uk_UA", "kk": "kk_KZ"]
        fmt.locale = Locale(identifier: map[L10n.shared.lang.rawValue] ?? "en_US")
        return fmt.string(from: monthStart).capitalized
    }
    private var scheduledDates: Set<String> { Set(sm.schedules.map { $0.date }) }
    private func dateStr(day: Int) -> String {
        let comps = DateComponents(year: cal.component(.year, from: monthStart),
                                   month: cal.component(.month, from: monthStart), day: day)
        guard let d = cal.date(from: comps) else { return "" }
        return sm.key(d)
    }
    private var weekdayHeaders: [String] {
        let s = cal.veryShortWeekdaySymbols
        return Array(s[1...]) + [s[0]]
    }

    private var calendar: some View {
        VStack(spacing: 10) {
            HStack {
                Button { Task { await sm.prevMonth() } } label: {
                    Image(systemName: "chevron.left").font(.system(size: 15, weight: .semibold)).foregroundStyle(.primary).frame(width: 32, height: 32)
                }
                Spacer()
                Text(monthLabel).font(.system(size: 15, weight: .bold)).foregroundStyle(.primary)
                Spacer()
                Button { Task { await sm.nextMonth() } } label: {
                    Image(systemName: "chevron.right").font(.system(size: 15, weight: .semibold)).foregroundStyle(.primary).frame(width: 32, height: 32)
                }
            }
            HStack(spacing: 0) {
                ForEach(0..<7, id: \.self) { i in
                    Text(weekdayHeaders[i]).font(.system(size: 11, weight: .semibold)).foregroundStyle(.primary.opacity(0.35)).frame(maxWidth: .infinity)
                }
            }
            let columns = Array(repeating: GridItem(.flexible(), spacing: 0), count: 7)
            LazyVGrid(columns: columns, spacing: 4) {
                ForEach(0..<(firstOffset + daysInMonth), id: \.self) { i in
                    if i < firstOffset {
                        Color.clear.frame(height: 36)
                    } else {
                        let day = i - firstOffset + 1
                        let ds = dateStr(day: day)
                        let isToday = ds == key(Date())
                        let hasShift = scheduledDates.contains(ds)
                        let isSel = sm.selectedCalDate == ds
                        Button {
                            withAnimation(.spring(duration: 0.2)) { sm.selectedCalDate = isSel ? nil : ds }
                        } label: {
                            VStack(spacing: 3) {
                                Text("\(day)").font(.system(size: 13, weight: isToday ? .bold : .regular))
                                    .foregroundStyle(isSel ? .white : (isToday ? SCHED_ACCENT : .primary))
                                Circle().fill(hasShift ? (isSel ? Color.white.opacity(0.8) : SCHED_ACCENT) : Color.clear)
                                    .frame(width: 4, height: 4)
                            }
                            .frame(maxWidth: .infinity, minHeight: 36)
                            .background(isSel ? SCHED_ACCENT : (isToday ? SCHED_ACCENT.opacity(0.12) : Color.clear), in: RoundedRectangle(cornerRadius: 8))
                        }
                        .buttonStyle(.plain)
                        .disabled(!hasShift)
                    }
                }
            }
            if let sel = sm.selectedCalDate {
                let items = sm.schedules.filter { $0.date == sel }
                if !items.isEmpty {
                    VStack(spacing: 0) {
                        ForEach(Array(items.enumerated()), id: \.element.id) { idx, s in
                            HStack {
                                Text(sm.staffName(s.staff_id)).font(.system(size: 14)).foregroundStyle(.primary)
                                Spacer()
                                Text("\(hhmm(s.shift_start))–\(hhmm(s.shift_end))")
                                    .font(.system(size: 14, weight: .semibold)).foregroundStyle(SCHED_ACCENT)
                                Button { Task { await sm.deleteSchedule(s.id) } } label: {
                                    Image(systemName: "trash").font(.system(size: 12)).foregroundStyle(.primary.opacity(0.3))
                                }.padding(.leading, 8)
                            }
                            .padding(.vertical, 10).padding(.horizontal, 14)
                            if idx < items.count - 1 { Divider().overlay(Color.primary.opacity(0.07)).padding(.leading, 14) }
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
    private func key(_ d: Date) -> String { sm.key(d) }
}

private struct ManagerScheduleEditSheet: View {
    @Bindable var sm: ManagerScheduleModel
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
                            ForEach(sm.dir) { Text($0.name).tag($0.id) }
                        }
                    }
                    Section(dates.isEmpty ? t("pe.dates") : t("pe.datesN", ["n": "\(dates.count)"])) {
                        MultiDatePicker(t("pe.dates"), selection: $dates).frame(maxHeight: 320)
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
                        let keys = dates.compactMap { Calendar.current.date(from: $0).map { sm.key($0) } }.sorted()
                        Task {
                            if await sm.createSchedules(staffId: staffId, dates: keys, start: s, end: e, note: note) { dismiss() }
                        }
                    }
                }
            }
            .toolbarBackground(Color.miseBg, for: .navigationBar)
        }
    }
}
