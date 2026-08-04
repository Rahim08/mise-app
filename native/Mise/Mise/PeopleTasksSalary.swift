import SwiftUI
import CoreLocation
import UIKit
// Вкладки: Задачи, Заявки, Зарплата
// Распил PeopleView.swift (Д2, 2026-07-18): секция вынесена без изменений логики.

// MARK: Задачи

struct TasksTab: View {
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
            VStack(spacing: 4) {
                Text(t("pe.noTasks")).font(.system(size: 15)).foregroundStyle(.primary.opacity(0.4))
                Text(t("pe.assignTaskHint")).font(.system(size: 13)).foregroundStyle(.primary.opacity(0.3)).multilineTextAlignment(.center)
            }
            .frame(maxWidth: .infinity).padding(.top, 50)
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

struct TaskFormSheet: View {
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

let REPORT_TYPES: [(String, String, String)] = [
    ("suggestion", "Предложение", "lightbulb"),
    ("order", "Заказать", "cart"),
    ("breakdown", "Поломка", "wrench.and.screwdriver"),
    ("other", "Другое", "text.bubble"),
]
@MainActor func reportTypeLabel(_ code: String?) -> String {
    let c = ["suggestion", "order", "breakdown", "other"].contains(code ?? "") ? code! : "other"
    return t("pe.rt." + c)
}
func reportTypeIcon(_ t: String?) -> String { REPORT_TYPES.first { $0.0 == t }?.2 ?? "text.bubble" }
func reportTypeColor(_ t: String?) -> Color {
    ["suggestion": BrandKit.analytics, "order": BrandKit.stash, "breakdown": BrandKit.menu][t ?? ""] ?? BrandKit.people
}

struct ReportsTab: View {
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
                    VStack(spacing: 4) {
                        Text(m.isManager ? t("pe.noReports") : t("pe.noReportsMine"))
                            .font(.system(size: 15)).foregroundStyle(.primary.opacity(0.4))
                        Text(t("pe.reportHint")).font(.system(size: 13)).foregroundStyle(.primary.opacity(0.3)).multilineTextAlignment(.center)
                    }
                    .frame(maxWidth: .infinity).padding(.top, 40)
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

struct ReportFormSheet: View {
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

struct PeopleSalaryTab: View {
    @Bindable var m: PeopleModel
    @State private var open: String?
    @State private var payFor: PeopleModel.SalRow?

    var body: some View {
        VStack(spacing: 12) {
            monthNav
            if !m.salaryLoaded {
                RowListSkeleton(rows: 3)
            } else if m.salaryRows.isEmpty {
                Text(t("pe.noSalary")).font(.system(size: 15)).foregroundStyle(.primary.opacity(0.4)).padding(.top, 50)
            } else if !m.isManager, let r = m.salaryRows.first {
                staffCard(r)
                staffBreakdown(r)
            } else {
                if m.salaryDebtTotal > 0 { debtCard }
                heroCard
                ForEach(m.salaryRows) { r in
                    VStack(spacing: 0) {
                        Button { withAnimation(.easeInOut(duration: 0.18)) { open = open == r.id ? nil : r.id } } label: {
                            HStack(spacing: 10) {
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(r.name).font(.system(size: 15, weight: .semibold)).foregroundStyle(.primary)
                                    rowSubtitle(r)
                                    if let st = payStatus(r) {
                                        Text(st.0).font(.system(size: 11, weight: .semibold)).foregroundStyle(st.1)
                                    }
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
        .sheet(item: $payFor) { r in MarkPaidSheet(m: m, row: r) }
    }

    // MARK: месяц-навигация («‹ Июль 2026 ›», как в Manager)
    private var monthNav: some View {
        HStack(spacing: 10) {
            Button { m.changeSalaryMonth(-1) } label: {
                Image(systemName: "chevron.left").font(.system(size: 13, weight: .bold))
                    .frame(width: 34, height: 34).foregroundStyle(.primary)
                    .background(Color.primary.opacity(0.06), in: Circle())
            }
            Text(monthLabel(m.salaryViewMonth)).font(.system(size: 13, weight: .bold)).foregroundStyle(.primary.opacity(0.55))
                .textCase(.uppercase).frame(maxWidth: .infinity)
            Button { m.changeSalaryMonth(1) } label: {
                Image(systemName: "chevron.right").font(.system(size: 13, weight: .bold))
                    .frame(width: 34, height: 34).foregroundStyle(.primary.opacity(m.salaryIsCurrentMonth ? 0.25 : 1))
                    .background(Color.primary.opacity(0.06), in: Circle())
            }
            .disabled(m.salaryIsCurrentMonth)
        }
    }
    private func monthLabel(_ d: Date) -> String {
        let f = DateFormatter(); f.locale = appLocale(); f.dateFormat = "LLLL yyyy"
        return f.string(from: d)
    }

    // MARK: задолженность (сумма непокрытого остатка за прошлые закрытые месяцы)
    private var debtCard: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(t("pe.debtTitle")).font(.system(size: 11, weight: .bold)).foregroundStyle(.red.opacity(0.85)).kerning(0.4).textCase(.uppercase)
            Text(eur(m.salaryDebtTotal)).font(.system(size: 22, weight: .heavy)).foregroundStyle(.red)
            Text(t("pe.debtHint")).font(.system(size: 12)).foregroundStyle(.primary.opacity(0.4))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(Color.red.opacity(0.08), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    // MARK: статус выплаты — «Выплачено»/«Осталось X€», только если начисление в месяце есть.
    // Если remaining == total (ничего не платили/не авансировали) — сумма уже видна в
    // заголовке строки, повторять её тут не надо (юзер-фидбек: «дублируется») — нейтральная
    // пометка «Не выплачено» вместо числа.
    private func payStatus(_ r: PeopleModel.SalRow) -> (String, Color)? {
        guard r.total > 0 else { return nil }
        if r.remaining <= 0 {
            let fFrac = ISO8601DateFormatter(); fFrac.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            if let last = r.lastPaidAt, let d = fFrac.date(from: last) ?? ISO8601DateFormatter().date(from: last) {
                return (t("pe.paidOn", ["date": shortDate2(d)]), .green)
            }
            return (t("pe.paidStatus"), .green)
        }
        if r.remaining == r.total { return (t("pe.notPaidYet"), .orange) }
        return (t("pe.oweAmount", ["amount": eur(r.remaining)]), .orange)
    }
    private func shortDate2(_ d: Date) -> String {
        let f = DateFormatter(); f.locale = appLocale(); f.dateFormat = "d MMM"
        return f.string(from: d)
    }

    // MARK: hero (manager only)
    private var heroCard: some View {
        let totalCash = m.salaryRows.reduce(0) { $0 + $1.cash }
        let totalCard = m.salaryRows.reduce(0) { $0 + $1.card }
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
            }
            .padding(.vertical, 10)
            if m.salaryIsCurrentMonth {
                Divider().overlay(Color.white.opacity(0.15))
                Text("\(t("pe.accruedToday")) \(eur(m.salaryAccruedToday)) · \(t("pe.accruedTodayHint"))")
                    .font(.system(size: 11)).foregroundStyle(.white.opacity(0.75))
                    .padding(.horizontal, 18).padding(.vertical, 10)
            }
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
                if let st = payStatus(r) {
                    Text(st.0).font(.system(size: 13, weight: .bold)).foregroundStyle(.white).padding(.top, 2)
                }
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

            if let st = payStatus(r) {
                Divider().overlay(Color.primary.opacity(0.07)).padding(.vertical, 4)
                HStack {
                    Text(st.0).font(.system(size: 13, weight: .semibold)).foregroundStyle(st.1)
                    Spacer()
                    if m.isManager, r.remaining > 0 {
                        Button { payFor = r } label: {
                            Text(t("pe.markPaid")).font(.system(size: 12, weight: .bold)).foregroundStyle(.white)
                                .padding(.horizontal, 12).padding(.vertical, 6)
                                .background(PEOPLE_ACCENT, in: Capsule())
                        }
                    }
                }
            }
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

// MARK: — Отметить выплату ЗП (People→Зарплата, ЗП-долг 2026-07-28)

private struct MarkPaidSheet: View {
    let m: PeopleModel
    let row: PeopleModel.SalRow
    @Environment(\.dismiss) private var dismiss
    @State private var amount: String
    @State private var method: String = "cash"
    @State private var date = Date()
    @State private var note = ""
    @State private var saving = false

    init(m: PeopleModel, row: PeopleModel.SalRow) {
        self.m = m; self.row = row
        _amount = State(initialValue: String(Int(row.remaining.rounded())))
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    HStack {
                        Text(t("pe.paymentAmount"))
                        Spacer()
                        TextField("0", text: $amount).keyboardType(.decimalPad).multilineTextAlignment(.trailing)
                    }
                    Picker(t("pe.paymentMethod"), selection: $method) {
                        Text(t("pe.methodCash")).tag("cash")
                        Text(t("pe.methodCard")).tag("card")
                    }.pickerStyle(.segmented)
                    DatePicker(t("pe.paymentDate"), selection: $date, displayedComponents: .date)
                    TextField(t("pe.paymentNote"), text: $note)
                }
            }
            .navigationTitle(t("pe.markPaid") + " · " + row.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(t("cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(t("pe.savePayment")) {
                        saving = true
                        Task {
                            await m.markSalaryPaid(employeeId: row.id, amount: Double(amount.replacingOccurrences(of: ",", with: ".")) ?? 0,
                                                    method: method, date: date, note: note)
                            saving = false; dismiss()
                        }
                    }.disabled(saving || (Double(amount) ?? 0) <= 0)
                }
            }
            .toolbarBackground(Color.miseBg, for: .navigationBar)
        }
    }
}

