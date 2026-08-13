import SwiftUI

// MARK: - Manager → Настройки → Заявки (реструктура 2026-08-13, юзер-фидбок: инбокс заявок
// сотрудников с триажем — конвертация в задачу или в закуп одним тапом, а не ручной
// пересозданием текста). Создание заявки — личное действие сотрудника, остаётся в People
// (ReportsTab/ReportFormSheet, PeopleTasksSalary.swift, не тронуто). Разбор/триаж заявок —
// админ-действие, отдельная модель здесь (не PeopleModel — тот же паттерн, что Salary/Walk).

@MainActor
@Observable
final class ManagerReportsModel {
    let rid: String
    init(rid: String) { self.rid = rid }

    var reports: [StaffReport] = []
    var dir: [StaffDir] = []
    var loaded = false
    var toast: String?
    private func flash(_ m: String) {
        toast = m
        Task { try? await Task.sleep(nanoseconds: 2_400_000_000); if toast == m { toast = nil } }
    }

    func staffName(_ id: String?) -> String { dir.first { $0.id == id }?.name ?? t("pe.unknown") }

    func load() async {
        async let repR = try? DB.from("staff_reports").select().order("created_at", ascending: false).list(StaffReport.self)
        async let dirR = try? DB.from("staff_directory").select().eq("is_active", true).order("name").list(StaffDir.self)
        reports = (await repR) ?? reports
        dir = (await dirR) ?? dir
        loaded = true
    }

    func setStatus(_ r: StaffReport, _ status: String) async {
        if let i = reports.firstIndex(where: { $0.id == r.id }) { reports[i].status = status }
        let resolvedAt: Any = status == "resolved" ? ISO8601DateFormatter().string(from: Date()) : NSNull()
        do {
            try await DB.from("staff_reports").update(["status": status, "resolved_at": resolvedAt]).eq("id", r.id).run()
        } catch { flash(t("saveFailed", ["err": error.localizedDescription])); await load() }
    }

    func delete(_ id: String) async {
        reports.removeAll { $0.id == id }
        do { try await DB.from("staff_reports").delete().eq("id", id).run() }
        catch { flash(t("saveFailed", ["err": error.localizedDescription])); await load() }
    }

    /// Конвертация заявки в задачу — та же вставка в staff_tasks, что PeopleModel.createTask
    /// (role: префикс раскрывается в цех), плюс исходная заявка закрывается «решена».
    @discardableResult
    func convertToTask(_ r: StaffReport, assignee: String, priority: String, due: String) async -> Bool {
        guard !assignee.isEmpty else { flash(t("pe.taskNeedTitle")); return false }
        var base: [String: Any] = [
            "restaurant_id": rid, "title": r.title, "priority": priority, "status": "todo",
            "created_by": NSNull(),
        ]
        if let d = r.description, !d.isEmpty { base["description"] = d }
        if !due.isEmpty { base["due_date"] = due }
        var targets = [assignee]
        if assignee.hasPrefix("role:") {
            let role = String(assignee.dropFirst(5))
            targets = dir.filter { $0.role == role }.map(\.id)
            if targets.isEmpty { flash(t("pe.noRoleStaff")); return false }
        }
        do {
            for tid in targets {
                var v = base; v["assigned_to"] = tid
                try await DB.from("staff_tasks").insert(v).run()
                await Notify.send(type: "task", title: t("pe.newTask"), body: r.title, audience: ["staff_ids": [tid]], titleKey: "notify.newTaskTitle")
            }
        } catch { flash(t("saveFailed", ["err": error.localizedDescription])); return false }
        await setStatus(r, "resolved")
        flash(t("pe.reportConverted"))
        return true
    }

    /// Конвертация заявки в закуп — та же вставка в purchase_items, что PeopleModel.addPurchase.
    @discardableResult
    func convertToPurchase(_ r: StaffReport, category: String, qty: String, unit: String) async -> Bool {
        var v: [String: Any] = ["category": category, "name": r.title, "status": "todo", "created_by": NSNull(), "created_by_name": staffName(r.author_id)]
        let q = qty.replacingOccurrences(of: ",", with: ".").trimmingCharacters(in: .whitespaces)
        v["qty"] = Double(q) ?? NSNull()
        let unitTrim = unit.trimmingCharacters(in: .whitespaces)
        v["unit"] = unitTrim.isEmpty ? NSNull() : unitTrim
        do { try await DB.from("purchase_items").insert(v).run() }
        catch { flash(t("saveFailed", ["err": error.localizedDescription])); return false }
        await setStatus(r, "resolved")
        flash(t("pe.reportConverted"))
        return true
    }
}

struct ManagerReportsTab: View {
    let rid: String
    @State private var rm: ManagerReportsModel?
    @State private var convertTask: StaffReport?
    @State private var convertPurchase: StaffReport?

    var body: some View {
        Group {
            if let rm {
                ManagerReportsList(rm: rm, convertTask: $convertTask, convertPurchase: $convertPurchase)
            } else {
                RowListSkeleton(rows: 3)
            }
        }
        .navigationTitle(t("pe.reports"))
        .task {
            if rm == nil {
                let model = ManagerReportsModel(rid: rid)
                rm = model
                await model.load()
            }
        }
        .sheet(item: $convertTask) { r in if let rm { ManagerConvertToTaskSheet(rm: rm, report: r) } }
        .sheet(item: $convertPurchase) { r in if let rm { ManagerConvertToPurchaseSheet(rm: rm, report: r) } }
    }
}

private struct ManagerReportsList: View {
    @Bindable var rm: ManagerReportsModel
    @Binding var convertTask: StaffReport?
    @Binding var convertPurchase: StaffReport?

    var body: some View {
        ScrollView {
            LazyVStack(spacing: 10) {
                if rm.reports.isEmpty {
                    Text(t("pe.noReports")).font(.system(size: 15)).foregroundStyle(.primary.opacity(0.4)).padding(.top, 40)
                } else {
                    ForEach(rm.reports) { r in card(r) }
                }
            }
            .padding(16)
        }
        .overlay(alignment: .bottom) {
            if let toast = rm.toast {
                Text(toast).font(.system(size: 13, weight: .semibold)).foregroundStyle(.primary)
                    .padding(.horizontal, 16).padding(.vertical, 10)
                    .background(.ultraThinMaterial, in: Capsule())
                    .padding(.bottom, 20)
            }
        }
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
                Text(["new": t("pe.repNew"), "reviewed": t("pe.reviewed"), "resolved": t("pe.resolved")][r.status ?? "new"] ?? t("pe.repNew"))
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(["reviewed": BrandKit.manager, "resolved": BrandKit.analytics][r.status ?? ""] ?? BrandKit.stash)
                    .padding(.horizontal, 8).padding(.vertical, 2)
                    .background((["reviewed": BrandKit.manager, "resolved": BrandKit.analytics][r.status ?? ""] ?? BrandKit.stash).opacity(0.16), in: Capsule())
            }
            Text(r.title).font(.system(size: 15, weight: .semibold))
                .foregroundStyle(.primary.opacity(resolved ? 0.5 : 1)).strikethrough(resolved)
            if let d = r.description, !d.isEmpty {
                Text(d).font(.system(size: 13)).foregroundStyle(.primary.opacity(0.55))
            }
            HStack(spacing: 10) {
                Text(rm.staffName(r.author_id)).font(.system(size: 12)).foregroundStyle(.primary.opacity(0.4))
                Spacer()
                if !resolved {
                    Button(t("pe.convertToTask")) { convertTask = r }
                        .font(.system(size: 12, weight: .semibold)).foregroundStyle(BrandKit.manager)
                    if r.type == "order" {
                        Button(t("pe.convertToPurchase")) { convertPurchase = r }
                            .font(.system(size: 12, weight: .semibold)).foregroundStyle(BrandKit.stash)
                    }
                    if (r.status ?? "new") == "new" {
                        Button(t("pe.reviewed")) { Task { await rm.setStatus(r, "reviewed") } }
                            .font(.system(size: 12, weight: .semibold)).foregroundStyle(.primary.opacity(0.5))
                    }
                }
                Button { Task { await rm.delete(r.id) } } label: {
                    Image(systemName: "trash").font(.system(size: 13)).foregroundStyle(.primary.opacity(0.3))
                }
            }
        }
        .padding(14).background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 16))
    }
}

private struct ManagerConvertToTaskSheet: View {
    @Bindable var rm: ManagerReportsModel
    let report: StaffReport
    @Environment(\.dismiss) private var dismiss
    @State private var assignee = ""
    @State private var priority = "medium"
    @State private var hasDue = false
    @State private var dueDate = Date()
    @State private var saving = false

    private let dfKey: DateFormatter = {
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.locale = Locale(identifier: "en_US_POSIX")
        return f
    }()

    var body: some View {
        NavigationStack {
            Form {
                Section { Text(report.title).font(.system(size: 15, weight: .semibold)) }
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
                        ForEach(rm.dir) { Text($0.name).tag($0.id) }
                    }
                }
                Section(t("pe.priority")) {
                    Picker(t("pe.priority"), selection: $priority) {
                        Text(t("pe.prio.low")).tag("low"); Text(t("pe.prio.medium")).tag("medium"); Text(t("pe.prio.high")).tag("high")
                    }.pickerStyle(.segmented)
                }
                Section {
                    Toggle(t("pe.due"), isOn: $hasDue)
                    if hasDue { DatePicker(t("an.date"), selection: $dueDate, displayedComponents: .date) }
                }
            }
            .navigationTitle(t("pe.convertToTask")).navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(t("cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(t("create")) {
                        guard !saving else { return }
                        saving = true
                        let due = hasDue ? dfKey.string(from: dueDate) : ""
                        Task { defer { saving = false }
                            if await rm.convertToTask(report, assignee: assignee, priority: priority, due: due) { dismiss() }
                        }
                    }.disabled(saving || assignee.isEmpty)
                }
            }
        }
    }
}

private struct ManagerConvertToPurchaseSheet: View {
    @Bindable var rm: ManagerReportsModel
    let report: StaffReport
    @Environment(\.dismiss) private var dismiss
    @State private var category = "general"
    @State private var qty = ""
    @State private var unit = ""
    @State private var saving = false

    var body: some View {
        NavigationStack {
            Form {
                Section { Text(report.title).font(.system(size: 15, weight: .semibold)) }
                Section(t("pe.category")) {
                    Picker(t("pe.category"), selection: $category) {
                        ForEach(PURCHASE_CATS_IOS, id: \.id) { c in Text(t(c.label)).tag(c.id) }
                    }
                }
                Section {
                    TextField(t("pe.qty"), text: $qty).keyboardType(.decimalPad)
                    TextField(t("pe.unit"), text: $unit)
                }
            }
            .navigationTitle(t("pe.convertToPurchase")).navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(t("cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(t("create")) {
                        guard !saving else { return }
                        saving = true
                        Task { defer { saving = false }
                            if await rm.convertToPurchase(report, category: category, qty: qty, unit: unit) { dismiss() }
                        }
                    }.disabled(saving)
                }
            }
        }
    }
}
