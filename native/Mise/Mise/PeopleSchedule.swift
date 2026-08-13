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

            // Inline detail for selected day — личный вид, всегда своя смена (имя не нужно).
            if let sel = m.selectedCalDate {
                let items = m.schedules.filter { $0.date == sel }
                if !items.isEmpty {
                    VStack(spacing: 0) {
                        ForEach(Array(items.enumerated()), id: \.element.id) { idx, s in
                            HStack {
                                Spacer()
                                Text("\(hhmm(s.shift_start))–\(hhmm(s.shift_end))")
                                    .font(.system(size: 14, weight: .semibold)).foregroundStyle(PEOPLE_ACCENT)
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

// Редактирование графика (добавление/удаление смен, копирование недели) переехало в
// Manager→Настройки→Расписание (реструктура 2026-08-13, ManagerSchedule.swift) — здесь,
// в People, менеджер видит только СВОЙ график, как рядовой сотрудник.
struct ShiftsTab: View {
    @Bindable var m: PeopleModel

    var body: some View {
        if !m.schedLoaded {
            RowListSkeleton(rows: 3)
        } else {
            ShiftsCalendar(m: m)
            if m.schedByDate.isEmpty {
                Text(t("pe.scheduleEmptyStaff"))
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
                                    Text("\(hhmm(s.shift_start))–\(hhmm(s.shift_end))")
                                        .font(.system(size: 14, weight: .semibold)).foregroundStyle(PEOPLE_ACCENT)
                                    Spacer()
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
}

