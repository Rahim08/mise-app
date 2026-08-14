import SwiftUI

// MARK: - Manager → Настройки → Чек-листы (реструктура 2026-08-13/14, см.
// docs/MANAGER-PEOPLE-RESTRUCTURE-2026-08-13.md). Только обычные чек-листы смены
// (kind="shift", открытие/закрытие) — БЕЗ разовых аудитов (kind="audit", Б6-веса): та фича
// сейчас нигде не доступна в навигации (Д6, "пилюля «Аудиты» скрыта из навигации по просьбе
// юзера"), сознательно не трогаем. Два раздела: Шаблоны (редактирование, было
// showManagerControls в RoutineTab) и Верификация (pass/fail проверка прогонов сотрудников,
// было Д4 2026-07-31/grading в ChecklistRunCard). Верификация переехала сюда 2026-08-14
// по индустрии (SafetyCulture/Jolt/Zenput: field team исполняет → manager/quality team
// проверяет через отдельный dashboard, не внутри карточки исполнителя) — в People менеджер
// теперь только проходит СВОИ чек-листы, ничего не верифицирует за других.

private let CL_ACCENT = BrandKit.manager

@MainActor
@Observable
final class ManagerChecklistsModel {
    let rid: String
    init(rid: String) { self.rid = rid }

    var checklists: [ShiftChecklist] = []
    var loaded = false
    var clType = "open" // open | close
    var toast: String?
    private func flash(_ m: String) {
        toast = m
        Task { try? await Task.sleep(nanoseconds: 2_400_000_000); if toast == m { toast = nil } }
    }

    func load() async {
        if let cls = try? await DB.from("shift_checklists").select().eq("kind", "shift").list(ShiftChecklist.self) {
            checklists = cls
        } else if !checklists.isEmpty { flash(t("refreshFailed")) }
        loaded = true
    }

    var relevant: [ShiftChecklist] { checklists.filter { ($0.type ?? "open") == clType } }

    @discardableResult
    func save(id: String?, role: String?, items: [ChecklistItem], type: String) async -> Bool {
        let clean = items.map { ChecklistItem(id: $0.id, label: $0.label.trimmingCharacters(in: .whitespaces), photo_required: $0.photo_required, weight: $0.weight) }.filter { !$0.label.isEmpty }
        guard !clean.isEmpty else { flash(t("pe.addItem")); return false }
        let roleVal: Any = role ?? NSNull()
        let itemDicts = clean.map { $0.asDict }
        do {
            if let id {
                try await DB.from("shift_checklists").update([
                    "items": itemDicts, "role": roleVal,
                ] as [String: Any]).eq("id", id).run()
            } else {
                try await DB.from("shift_checklists").insert([
                    "restaurant_id": rid, "type": type, "items": itemDicts, "role": roleVal,
                    "kind": "shift", "target_scope": "role", "assigned_staff_id": NSNull(), "title": NSNull(),
                    "recurrence": "none", "recurrence_weekdays": NSNull(), "recurrence_day_of_month": NSNull(),
                ] as [String: Any]).run()
            }
        } catch { flash(t("saveFailed", ["err": error.localizedDescription])); return false }
        flash(t("pe.checklistSaved"))
        await load()
        return true
    }

    func delete(_ id: String) async {
        checklists.removeAll { $0.id == id }
        do { try await DB.from("shift_checklists").delete().eq("id", id).run() }
        catch { flash(t("saveFailed", ["err": error.localizedDescription])); await load() }
    }

    // MARK: Верификация (grading) — реструктура 2026-08-14, перенесено из
    // PeopleModel.gradeChecklistItem без изменений логики.

    var completions: [ChecklistCompletion] = []
    private let dfKey: DateFormatter = {
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.locale = Locale(identifier: "en_US_POSIX")
        return f
    }()
    func loadCompletions() async {
        let today = dfKey.string(from: Date())
        completions = (try? await DB.from("shift_checklist_completions").select().eq("date", today).list(ChecklistCompletion.self)) ?? []
    }
    func completion(_ list: ShiftChecklist) -> ChecklistCompletion? { completions.first { $0.checklist_id == list.id } }
    /// Прогоны, готовые к верификации — сотрудник дожал чек-лист до status="done".
    var verifiable: [ShiftChecklist] { checklists.filter { completion($0)?.status == "done" } }

    func gradeChecklistItem(_ list: ShiftChecklist, _ idx: Int, result: String?) async {
        let itemsList = list.itemDetails ?? []
        var state = completion(list)?.items_state ?? Array(repeating: ChecklistItemState(done: false), count: itemsList.count)
        while state.count <= idx { state.append(ChecklistItemState(done: false)) }
        var item = state[idx]
        item.result = result
        item.done = result != nil
        state[idx] = item
        var allDone = state.allSatisfy { $0.done }
        guard let i = completions.firstIndex(where: { $0.checklist_id == list.id }) else { return }
        let cid = completions[i].id
        // Против lost update: свежая копия с сервера, мержим ТОЛЬКО свой индекс.
        if let freshState = try? await DB.from("shift_checklist_completions").select().fresh().eq("id", cid).limit(1).list(ChecklistCompletion.self).first?.items_state {
            var merged = freshState
            while merged.count <= idx { merged.append(ChecklistItemState(done: false)) }
            merged[idx] = item
            state = merged
            allDone = state.allSatisfy { $0.done }
        }
        completions[i].items_state = state
        do {
            try await DB.from("shift_checklist_completions").update([
                "items_state": state.map { $0.asDict }, "status": allDone ? "done" : "in_progress",
            ] as [String: Any]).eq("id", cid).run()
        } catch { flash(t("saveFailed", ["err": error.localizedDescription])) }
    }

    // MARK: История (C7, аудит 2026-08-13/15) — ChecklistHistorySheet осиротела при реструктуре
    // 2026-08-13 (жила в PeopleChecklists.swift, привязана к PeopleModel, но нигде не вызывалась
    // после переноса — история чек-листов у менеджера была недоступна нигде). Портировано сюда
    // (та же query-логика, что PeopleModel.loadChecklistHistory/historyByDate/checklistTitle),
    // без изменений: 30 дней, все прохождения ресторана (не только свои), kind="shift".

    var history: [ChecklistCompletion] = []
    var historyLoaded = false
    private let dfDayKey: DateFormatter = {
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.locale = Locale(identifier: "en_US_POSIX")
        return f
    }()
    func loadHistory() async {
        let from = dfDayKey.string(from: Calendar.current.date(byAdding: .day, value: -30, to: Date()) ?? Date())
        history = (try? await DB.from("shift_checklist_completions").select()
            .gte("date", from).order("date", ascending: false).list(ChecklistCompletion.self)) ?? []
        historyLoaded = true
    }
    var historyByDate: [(String, [ChecklistCompletion])] {
        var m: [String: [ChecklistCompletion]] = [:]
        for c in history { m[c.date ?? "", default: []].append(c) }
        return m.sorted { $0.key > $1.key }
    }
    func checklistTitle(_ id: String?) -> ShiftChecklist? { checklists.first { $0.id == id } }
}

struct ManagerChecklistsTab: View {
    let rid: String
    @State private var cm: ManagerChecklistsModel?
    @State private var edit: ChecklistEdit?
    @State private var section = "templates" // templates | verify | history

    var body: some View {
        Group {
            if let cm {
                VStack(spacing: 12) {
                    Picker("", selection: $section) {
                        Text(t("pe.checklistTemplates")).tag("templates")
                        Text(t("pe.verification")).tag("verify")
                        Text(t("pe.checklistHistory")).tag("history")
                    }.pickerStyle(.segmented).padding(.horizontal, 16).padding(.top, 8)
                    if section == "templates" {
                        ManagerChecklistsList(cm: cm, edit: $edit)
                    } else if section == "verify" {
                        ManagerVerifyList(cm: cm)
                    } else {
                        ManagerChecklistHistoryList(cm: cm)
                    }
                }
            } else {
                RowListSkeleton(rows: 3)
            }
        }
        .navigationTitle(t("pe.auditTab")).navigationBarTitleDisplayMode(.inline)
        .task {
            if cm == nil {
                let model = ManagerChecklistsModel(rid: rid)
                cm = model
                await model.load()
            }
        }
        .task(id: section) {
            if section == "verify" { await cm?.loadCompletions() }
        }
        .sheet(item: $edit) { e in if let cm { ManagerChecklistEditSheet(cm: cm, edit: e) } }
    }
}

private struct ManagerVerifyList: View {
    @Bindable var cm: ManagerChecklistsModel

    var body: some View {
        ScrollView {
            VStack(spacing: 10) {
                let lists = cm.verifiable
                if lists.isEmpty {
                    Text(t("pe.noRunYet")).font(.system(size: 15)).foregroundStyle(.primary.opacity(0.4)).padding(.top, 40)
                } else {
                    ForEach(lists) { list in
                        ManagerGradingCard(cm: cm, list: list)
                    }
                }
            }
            .padding(16)
        }
    }
}

/// История (C7, аудит 2026-08-13/15) — портировано из ChecklistHistorySheet (PeopleChecklists.swift,
/// была осиротевшей после реструктуры 2026-08-13), без изменений вёрстки dayCard.
private struct ManagerChecklistHistoryList: View {
    @Bindable var cm: ManagerChecklistsModel

    var body: some View {
        ScrollView {
            VStack(spacing: 12) {
                if !cm.historyLoaded {
                    RowListSkeleton(rows: 3)
                } else if cm.historyByDate.isEmpty {
                    Text(t("pe.historyEmpty")).font(.system(size: 15)).foregroundStyle(.primary.opacity(0.4)).padding(.top, 60)
                } else {
                    ForEach(cm.historyByDate, id: \.0) { date, comps in dayCard(date, comps) }
                }
            }
            .padding(16)
        }
        .task { if !cm.historyLoaded { await cm.loadHistory() } }
    }

    private func dayCard(_ date: String, _ comps: [ChecklistCompletion]) -> some View {
        var total = 0, done = 0
        var missed: [String] = []
        for c in comps {
            guard let cl = cm.checklistTitle(c.checklist_id), let items = cl.items else { continue }
            let state = c.items_state ?? []
            for (i, it) in items.enumerated() {
                total += 1
                if i < state.count && state[i].done { done += 1 } else { missed.append(it) }
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

/// Карточка верификации — pass/fail/N/A по пунктам, упрощённый форк gradingRow из
/// ChecklistRunCard (PeopleChecklists.swift): без фото/report-a-problem — только решение.
private struct ManagerGradingCard: View {
    @Bindable var cm: ManagerChecklistsModel
    let list: ShiftChecklist

    var body: some View {
        let items = list.itemDetails ?? []
        let state = cm.completion(list)?.items_state ?? []
        VStack(alignment: .leading, spacing: 0) {
            Text(roleTitle(list.role)).font(.system(size: 13, weight: .bold)).foregroundStyle(CL_ACCENT).padding(.bottom, 6)
            ForEach(Array(items.enumerated()), id: \.offset) { i, item in
                let st: ChecklistItemState? = i < state.count ? state[i] : nil
                let eff = st?.result ?? (st?.done == true ? "pass" : nil)
                VStack(alignment: .leading, spacing: 6) {
                    Text(item.label).font(.system(size: 14)).foregroundStyle(.primary.opacity(eff == "pass" ? 0.55 : 1))
                    HStack(spacing: 8) {
                        gradePill(on: eff == "pass", color: BrandKit.analytics, icon: "checkmark") {
                            Task { await cm.gradeChecklistItem(list, i, result: eff == "pass" ? nil : "pass") }
                        }
                        gradePill(on: eff == "fail", color: BrandKit.menu, icon: "xmark") {
                            Task { await cm.gradeChecklistItem(list, i, result: eff == "fail" ? nil : "fail") }
                        }
                        gradePill(on: eff == "na", color: .primary.opacity(0.45), icon: nil, text: "N/A") {
                            Task { await cm.gradeChecklistItem(list, i, result: eff == "na" ? nil : "na") }
                        }
                        Spacer()
                    }
                }
                .padding(.vertical, 8)
                if i < items.count - 1 { Divider().overlay(Color.primary.opacity(0.07)) }
            }
        }
        .padding(14).background(Color.primary.opacity(0.05), in: RoundedRectangle(cornerRadius: 16))
    }

    private func gradePill(on: Bool, color: Color, icon: String?, text: String? = nil, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Group {
                if let icon { Image(systemName: icon).font(.system(size: 12, weight: .bold)) }
                else { Text(text ?? "").font(.system(size: 12, weight: .bold)) }
            }
            .foregroundStyle(on ? Color.white : Color.primary.opacity(0.45))
            .frame(minWidth: 34)
            .padding(.vertical, 6).padding(.horizontal, 8)
            .background(on ? AnyShapeStyle(color) : AnyShapeStyle(Color.primary.opacity(0.08)), in: RoundedRectangle(cornerRadius: 9))
        }
        .buttonStyle(.plain)
    }
}

private struct ManagerChecklistsList: View {
    @Bindable var cm: ManagerChecklistsModel
    @Binding var edit: ChecklistEdit?

    var body: some View {
        ScrollView {
            VStack(spacing: 10) {
                Picker("", selection: $cm.clType) {
                    Text(t("pe.open")).tag("open"); Text(t("pe.close")).tag("close")
                }.pickerStyle(.segmented)

                Button {
                    edit = ChecklistEdit(listId: nil, role: nil, items: [ChecklistItem(label: "")])
                } label: {
                    Label(t("pe.checklistForRole"), systemImage: "plus")
                        .font(.system(size: 14, weight: .semibold)).foregroundStyle(CL_ACCENT)
                        .frame(maxWidth: .infinity).padding(.vertical, 13)
                        .background(RoundedRectangle(cornerRadius: 14).strokeBorder(style: StrokeStyle(lineWidth: 1.5, dash: [5])).foregroundStyle(.primary.opacity(0.2)))
                }

                let list = cm.relevant
                if list.isEmpty {
                    Text(t("pe.noChecklists")).font(.system(size: 15)).foregroundStyle(.primary.opacity(0.4)).padding(.top, 40)
                } else {
                    ForEach(list) { l in
                        HStack {
                            VStack(alignment: .leading, spacing: 3) {
                                Text(roleTitle(l.role)).font(.system(size: 14, weight: .bold)).foregroundStyle(.primary)
                                Text(t("pe.walkBlocksN", ["n": "\(l.itemDetails?.count ?? 0)"])).font(.system(size: 12)).foregroundStyle(.primary.opacity(0.45))
                            }
                            Spacer()
                            Button {
                                edit = ChecklistEdit(listId: l.id, role: l.role, items: (l.itemDetails?.isEmpty == false) ? l.itemDetails! : [ChecklistItem(label: "")])
                            } label: { Image(systemName: "pencil").font(.system(size: 13)).foregroundStyle(CL_ACCENT) }
                            Button { Task { await cm.delete(l.id) } } label: {
                                Image(systemName: "trash").font(.system(size: 13)).foregroundStyle(.primary.opacity(0.3))
                            }
                        }
                        .padding(12).background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 16))
                    }
                }
            }
            .padding(16)
        }
        .overlay(alignment: .bottom) {
            if let toast = cm.toast {
                Text(toast).font(.system(size: 13, weight: .semibold)).foregroundStyle(.primary)
                    .padding(.horizontal, 16).padding(.vertical, 10)
                    .background(.ultraThinMaterial, in: Capsule())
                    .padding(.bottom, 20)
            }
        }
    }
}

/// Только role+items (без audit-полей — target_scope/recurrence/weight), в отличие от
/// ChecklistEditSheet (PeopleChecklists.swift), которая обслуживает и kind="audit".
private struct ManagerChecklistEditSheet: View {
    @Bindable var cm: ManagerChecklistsModel
    @Environment(\.dismiss) private var dismiss
    @State var edit: ChecklistEdit
    @State private var saving = false

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
                            HStack {
                                TextField(t("pe.itemN", ["n": "\(i + 1)"]), text: $edit.items[i].label)
                                Spacer()
                                Button { edit.items[i].photo_required.toggle() } label: {
                                    Image(systemName: edit.items[i].photo_required ? "camera.fill" : "camera")
                                        .font(.system(size: 15))
                                        .foregroundStyle(edit.items[i].photo_required ? CL_ACCENT : .primary.opacity(0.25))
                                }.buttonStyle(.plain)
                            }
                        }
                        Button { edit.items.append(ChecklistItem(label: "")) } label: { Label(t("pe.moreItem"), systemImage: "plus") }
                    }
                }
                .scrollContentBackground(.hidden)
            }
            .navigationTitle(cm.clType == "open" ? t("pe.checklistOpenTitle") : t("pe.checklistCloseTitle"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(t("cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(t("save")) {
                        guard !saving else { return }
                        saving = true
                        Task {
                            defer { saving = false }
                            if await cm.save(id: edit.listId, role: edit.role, items: edit.items, type: cm.clType) { dismiss() }
                        }
                    }.disabled(saving)
                }
            }
            .toolbarBackground(Color.miseBg, for: .navigationBar)
        }
    }
}
