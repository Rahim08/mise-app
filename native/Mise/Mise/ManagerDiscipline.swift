import SwiftUI
import UIKit

// MARK: - Manager → Дисциплина (история опозданий). Реструктура 2026-08-13, перенесено из
// PeopleShiftsHub.swift (People→Смены→Явка→Дисциплина, manager-only сегмент) без изменений
// в логике — только источник данных и место. Личного эквивалента в People нет: менеджер не
// чекинится «Я здесь» по дизайну (Sprint 1, CLAUDE.md), дисциплина — это отчёт по ДРУГИМ.

private let DISC_ACCENT = BrandKit.manager

@MainActor
@Observable
final class ManagerDisciplineModel {
    let rid: String
    init(rid: String) { self.rid = rid }

    var dir: [StaffDir] = []
    var discRecords: [AttendanceRecord] = []
    var discGrace = 5
    var discLoaded = false
    var discPeriod = "thisMonth" // thisMonth | lastMonth | 30d | 90d
    var discSel: String? = nil
    var checklistFailMap: [String: [ChecklistFailDay]] = [:]
    var toast: String?

    struct ChecklistFailDay { let date: String; let role: String?; let items: [String] }
    struct DiscStat {
        var shifts = 0; var evaluable = 0; var onTime = 0; var late = 0; var extra = 0; var totalMin = 0; var avgMin = 0; var maxMin = 0; var punct: Int? = nil
        var checklistFails = 0; var checklistFailDays: [ChecklistFailDay] = []
    }

    func flash(_ m: String) {
        toast = m
        Task { try? await Task.sleep(nanoseconds: 2_400_000_000); if toast == m { toast = nil } }
    }

    private let dfKey: DateFormatter = {
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.locale = Locale(identifier: "en_US_POSIX")
        return f
    }()
    func key(_ d: Date) -> String { dfKey.string(from: d) }

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
        async let recsL = (try? await DB.from("attendance_records").select().gte("date", from).lte("date", to).order("date", ascending: false).limit(3000).list(AttendanceRecord.self)) ?? []
        async let listsL = (try? await DB.from("shift_checklists").select().eq("kind", "shift").list(ShiftChecklist.self)) ?? []
        async let compsL = (try? await DB.from("shift_checklist_completions").select().gte("date", from).lte("date", to).limit(3000).list(ChecklistCompletion.self)) ?? []
        let recs = await recsL
        if dir.isEmpty {
            dir = (try? await DB.from("staff_directory").select().eq("is_active", true).order("name").list(StaffDir.self)) ?? []
        }
        let g = (try? await DB.from("restaurant_settings").select("late_grace_min").limit(1).list(GraceRow.self))?.first
        discRecords = recs; discGrace = g?.late_grace_min ?? 5

        let lists = await listsL, comps = await compsL
        let listById = Dictionary(uniqueKeysWithValues: lists.map { ($0.id, $0) })
        var attendByDate: [String: [String]] = [:]
        for r in recs { if let d = r.date, let sid = r.staff_id { attendByDate[d, default: []].append(sid) } }
        var roleOf: [String: String?] = [:]
        for s in dir { roleOf[s.id] = s.role }
        var fm: [String: [ChecklistFailDay]] = [:]
        for c in comps {
            guard let cid = c.checklist_id, let list = listById[cid], let date = c.date else { continue }
            let items = list.itemDetails ?? []
            let state = c.items_state ?? []
            var failed: [String] = []
            for i in items.indices {
                let eff = i < state.count ? (state[i].result ?? (state[i].done ? "pass" : nil)) : nil
                if eff == "fail" { failed.append(items[i].label) }
            }
            guard !failed.isEmpty else { continue }
            let attendees = attendByDate[date] ?? []
            let blamed = list.role == nil ? attendees : attendees.filter { (roleOf[$0] ?? nil) == list.role }
            for sid in blamed { fm[sid, default: []].append(ChecklistFailDay(date: date, role: list.role, items: failed)) }
        }
        checklistFailMap = fm
        discLoaded = true
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
        let failDays = checklistFailMap[sid] ?? []
        s.checklistFailDays = failDays; s.checklistFails = failDays.reduce(0) { $0 + $1.items.count }
        return s
    }

    func saveDiscGrace(_ v: Int) async {
        let prev = discGrace
        discGrace = v
        do {
            try await DB.from("restaurant_settings").update(["late_grace_min": v]).run()
        } catch { flash(t("saveFailed", ["err": error.localizedDescription])); discGrace = prev }
    }
}

struct ManagerDisciplineTab: View {
    let rid: String
    @State private var m: ManagerDisciplineModel?

    var body: some View {
        Group {
            if let m {
                ManagerDisciplineBody(m: m)
            } else {
                RowListSkeleton(rows: 3)
            }
        }
        .task {
            if m == nil {
                let model = ManagerDisciplineModel(rid: rid)
                m = model
                await model.loadDiscipline()
            }
        }
    }
}

private struct ManagerDisciplineBody: View {
    @Bindable var m: ManagerDisciplineModel

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
        .overlay(alignment: .bottom) {
            if let toast = m.toast {
                Text(toast).font(.system(size: 13, weight: .semibold)).foregroundStyle(.primary)
                    .padding(.horizontal, 16).padding(.vertical, 10)
                    .background(.ultraThinMaterial, in: Capsule())
                    .padding(.bottom, 20)
            }
        }
    }

    private var overview: some View {
        ScrollView {
        VStack(spacing: 12) {
            Picker("", selection: $m.discPeriod) {
                Text(t("pe.perThisMonth")).tag("thisMonth")
                Text(t("pe.perLastMonth")).tag("lastMonth")
                Text(t("pe.per30")).tag("30d")
                Text(t("pe.per90")).tag("90d")
            }.pickerStyle(.segmented)

            HStack {
                Text(t("pe.disGrace")).font(.system(size: 13)).foregroundStyle(.primary.opacity(0.6))
                Spacer()
                ForEach([0, 5, 10, 15], id: \.self) { v in
                    Button { Task { await m.saveDiscGrace(v) } } label: {
                        Text("\(v)").font(.system(size: 13, weight: m.discGrace == v ? .bold : .regular))
                            .foregroundStyle(m.discGrace == v ? .white : .primary)
                            .frame(width: 32, height: 28)
                            .background(m.discGrace == v ? DISC_ACCENT : Color.primary.opacity(0.08), in: RoundedRectangle(cornerRadius: 8))
                    }
                }
            }
            .padding(12).background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 12))

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
                                if item.st.checklistFails > 0 {
                                    Text("\(item.st.checklistFails) \(t("pe.checklistErrorsShort"))")
                                        .font(.system(size: 11, weight: .bold)).foregroundStyle(.red)
                                        .padding(.horizontal, 8).padding(.vertical, 3).background(Color.red.opacity(0.16), in: Capsule())
                                }
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
        .padding(16)
        }
    }

    private func detail(_ sid: String) -> some View {
        let s = m.dir.first { $0.id == sid }
        let st = m.discStat(sid)
        let recs = m.discRecords.filter { $0.staff_id == sid }
        var byDate: [String: AttendanceRecord] = [:]
        for r in recs { if let d = r.date { byDate[d] = r } }

        let cols = Array(repeating: GridItem(.flexible(), spacing: 8), count: 3)
        return ScrollView {
        VStack(alignment: .leading, spacing: 12) {
            Button { m.discSel = nil } label: {
                HStack(spacing: 6) { Image(systemName: "chevron.left"); Text(s?.name ?? "") }
                    .font(.system(size: 14, weight: .semibold)).foregroundStyle(.primary)
                    .padding(.vertical, 8).padding(.horizontal, 12)
                    .background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 10))
            }

            LazyVGrid(columns: cols, spacing: 8) {
                statCell(t("pe.punctuality"), st.punct == nil ? "—" : "\(st.punct!)%", punctColor(st.punct))
                statCell(t("pe.disLates"), "\(st.late)", st.late > 0 ? .orange : .green)
                statCell(t("pe.disShifts"), "\(st.shifts)", DISC_ACCENT)
                statCell(t("pe.disTotal"), "\(st.totalMin)\(t("pe.disMin"))", .primary)
                statCell(t("pe.disAvg"), "\(st.avgMin)\(t("pe.disMin"))", .primary)
                statCell(t("pe.disMax"), "\(st.maxMin)\(t("pe.disMin"))", .primary)
                statCell(t("pe.checklistErrors"), "\(st.checklistFails)", st.checklistFails > 0 ? .red : .green)
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

            if !st.checklistFailDays.isEmpty {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(Array(st.checklistFailDays.enumerated()), id: \.offset) { i, d in
                        VStack(alignment: .leading, spacing: 3) {
                            HStack {
                                Text("\(dayLabel(d.date)) · \(d.role != nil ? checklistRoleLabel(d.role) : t("pe.role.general"))")
                                    .font(.system(size: 14)).foregroundStyle(.primary)
                                Spacer()
                                Text("\(d.items.count)").font(.system(size: 11, weight: .bold)).foregroundStyle(.red)
                                    .padding(.horizontal, 8).padding(.vertical, 2).background(Color.red.opacity(0.16), in: Capsule())
                            }
                            Text(d.items.joined(separator: ", ")).font(.system(size: 12)).foregroundStyle(.primary.opacity(0.5))
                        }
                        .padding(.vertical, 10).padding(.horizontal, 14)
                        if i < st.checklistFailDays.count - 1 { Divider().overlay(Color.primary.opacity(0.07)).padding(.leading, 14) }
                    }
                }
                .background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 16))
            }

            Button { copySummary(s?.name ?? "", st) } label: {
                Text(t("pe.disCopy")).font(.system(size: 14, weight: .semibold)).foregroundStyle(.primary)
                    .frame(maxWidth: .infinity).padding(.vertical, 12)
                    .background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 12))
            }
        }
        .padding(16)
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
        let lead = (cal.component(.weekday, from: first) + 5) % 7
        let mf = DateFormatter(); mf.locale = appLocale(); mf.dateFormat = "LLLL yyyy"
        let cols = Array(repeating: GridItem(.flexible(), spacing: 5), count: 7)
        let wdf = DateFormatter(); wdf.locale = appLocale()
        let wd = wdf.veryShortWeekdaySymbols ?? ["S", "M", "T", "W", "T", "F", "S"]
        let wdMon = Array(wd[1...] + wd[..<1])

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

    private func copySummary(_ name: String, _ st: ManagerDisciplineModel.DiscStat) {
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
