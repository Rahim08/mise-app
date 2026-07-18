import SwiftUI
import CoreLocation
import UIKit
// Хаб Смены: уведомления, явка, дисциплина, обмены
// Распил PeopleView.swift (Д2, 2026-07-18): секция вынесена без изменений логики.

// MARK: Смены (хаб: Расписание / Явка / Обмены)

struct ShiftsHubTab: View {
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
struct NotificationsSheet: View {
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
                        Text(t("pe.noNotifsHint")).font(.system(size: 13)).foregroundStyle(.primary.opacity(0.3)).multilineTextAlignment(.center).padding(.horizontal, 30)
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
struct CombinedShifts: View {
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

struct AttendanceTab: View {
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

struct DisciplineTab: View {
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
                VStack(spacing: 4) {
                    Text(t("pe.disEmpty")).font(.system(size: 15)).foregroundStyle(.primary.opacity(0.4))
                    Text(t("pe.disEmptyHint")).font(.system(size: 13)).foregroundStyle(.primary.opacity(0.3)).multilineTextAlignment(.center).padding(.horizontal, 30)
                }
                .frame(maxWidth: .infinity).padding(.top, 50)
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

struct SwapsTab: View {
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

struct SwapCreateSheet: View {
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

