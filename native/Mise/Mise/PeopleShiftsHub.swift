import SwiftUI
import CoreLocation
import UIKit
// Хаб Смены: уведомления, явка, дисциплина, обмены
// Распил PeopleView.swift (Д2, 2026-07-18): секция вынесена без изменений логики.

// MARK: Смены (хаб: Расписание / Явка / Обмены)

struct ShiftsHubTab: View {
    @Bindable var m: PeopleModel
    var body: some View {
        // Колокольчик уведомлений переехал в MainView (глобальный, видим на любом модуле) —
        // раньше был только тут, но уведомления бывают о чём угодно, не только о сменах.
        // «Аудит» (Рутина+Аудиты) переехал сюда из «Зала» (Д4, 2026-07-31) — семантически
        // про жизнь смены, не про физическое пространство.
        // Дисциплина переехала в Manager→Дисциплина (реструктура 2026-08-13, ManagerDiscipline.swift) —
        // это отчёт менеджера по ДРУГИМ сотрудникам, личного эквивалента у People нет.
        Picker("", selection: $m.shiftsView) {
            Text(t("tab.shifts")).tag("shifts")
            Text(t("pe.auditTab")).tag("audit")
            Text(t("pe.swaps")).tag("swaps")
        }.pickerStyle(.segmented)

        switch m.shiftsView {
        case "swaps": SwapsTab(m: m)
        case "audit": ShiftAuditHub(m: m)
        default: CombinedShifts(m: m)
        }
    }
}

/// «Проверки»: один ряд пилюль по типу контента — Смена | Восьмёрка (менеджер).
/// Статистика — под кнопку-шторку, не постоянный третий ряд табов (Д5, флаттенинг по
/// фидбеку юзера: 3 уровня вложенности читались как повторяющиеся подпункты).
/// Д6: пилюля «Аудиты» скрыта из навигации по просьбе юзера (термин не понравился, разовые
/// проверки пока не нужны) — AuditsTab/loadAudits остаются нетронутыми, просто не вызываются
/// отсюда. Чтобы вернуть — восстановить showAudits/тег "audits"/case ниже.
struct ShiftAuditHub: View {
    @Bindable var m: PeopleModel
    @State private var showStats = false

    var body: some View {
        Group {
            HStack(spacing: 8) {
                Picker("", selection: $m.checklistsSubTab) {
                    Text(t("pe.shiftTab")).tag("shift")
                    if m.isManager { Text(t("pe.walks")).tag("walk") }
                }.pickerStyle(.segmented)
                if m.isManager {
                    Button { showStats = true } label: {
                        Image(systemName: "chart.bar.fill").font(.system(size: 14))
                            .foregroundStyle(.primary.opacity(0.6))
                            .frame(width: 36, height: 32)
                            .background(RoundedRectangle(cornerRadius: 10).fill(.primary.opacity(0.06)))
                    }
                }
            }
            switch m.checklistsSubTab {
            case "walk" where m.isManager: WalkTab(m: m)
            default: RoutineTab(m: m)
            }
        }
        .task {
            if !m.checklistsLoaded { await m.loadChecklists() }
        }
        .sheet(isPresented: $showStats) {
            NavigationStack {
                ScrollView { StatisticsSection(m: m, initialKind: m.checklistsSubTab == "walk" ? "walk" : m.checklistsSubTab == "audits" ? "audit" : "shift").padding(16) }
                    .navigationTitle(t("pe.statistics")).navigationBarTitleDisplayMode(.inline)
            }
        }
    }
}

/// Журнал уведомлений (ревью Г2): notifications с перерендером title_key/body_key на языке
/// зрителя (NotifyStrings.swift) — тот же механизм, что веб-колокольчик. Открытие = прочитано.
// NotificationsSheet переехал в MainView.swift (глобальный колокольчик, читает AppModel).

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
            } else if m.mySchedToday == nil {
                // Хард-гейт по графику (Д4, 2026-07-31): без опубликованной смены на сегодня
                // кнопка «Я здесь» вообще не показывается.
                VStack(spacing: 6) {
                    Image(systemName: "calendar.badge.exclamationmark").font(.system(size: 32)).foregroundStyle(.secondary)
                    Text(t("pe.noScheduledShift")).font(.system(size: 15, weight: .semibold)).foregroundStyle(.primary)
                    Text(t("pe.noScheduledShiftHint")).font(.system(size: 12)).foregroundStyle(.primary.opacity(0.5)).multilineTextAlignment(.center)
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

