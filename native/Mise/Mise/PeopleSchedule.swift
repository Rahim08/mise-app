import SwiftUI
import CoreLocation
import UIKit
// Расписание смен: календарь, редактор
// Распил PeopleView.swift (Д2, 2026-07-18): секция вынесена без изменений логики.

// MARK: Смены (расписание)

struct ShiftsCalendar: View {
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

struct ShiftsTab: View {
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

struct ScheduleEditSheet: View {
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

