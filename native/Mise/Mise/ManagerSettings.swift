import SwiftUI

// MARK: - Manager → Настройки (реструктура 2026-08-13, см.
// docs/MANAGER-PEOPLE-RESTRUCTURE-2026-08-13.md). Хаб-меню на редактирование: восьмёрка,
// чек-листы/аудиты, расписание. В People у менеджера остаётся только прохождение —
// как у рядового сотрудника.

struct ManagerSettingsTab: View {
    let rid: String
    @State private var newReportsCount = 0

    var body: some View {
        NavigationStack {
            List {
                // C1 (аудит 2026-08-13): бейдж фетчился один раз в .task — NavigationLink push
                // не «убивает» родителя (List остаётся смонтирован, просто закрыт сверху), так
                // что счётчик оставался стейл после разбора заявок. .onDisappear на самом пуше
                // (реально размонтируется при возврате назад) — надёжный момент для рефетча.
                NavigationLink(destination: ManagerReportsTab(rid: rid).onDisappear { Task { await reloadBadge() } }) {
                    settingsRow(icon: "tray.full", label: t("pe.reports"), badge: newReportsCount)
                }
                NavigationLink(destination: ManagerWalkTab(rid: rid)) {
                    settingsRow(icon: "figure.walk", label: t("pe.walks"))
                }
                NavigationLink(destination: ManagerScheduleTab(rid: rid)) {
                    settingsRow(icon: "calendar", label: t("tab.shifts"))
                }
                NavigationLink(destination: ManagerChecklistsTab(rid: rid)) {
                    settingsRow(icon: "checklist", label: t("pe.auditTab"))
                }
            }
            // .inline (юзер-фидбок 2026-08-14) — large-title поверх уже существующего кастомного
            // хедера приложения («mise Manager») давал огромный пустой отступ сверху.
            .navigationTitle(t("tab.settings")).navigationBarTitleDisplayMode(.inline)
        }
        .task { await reloadBadge() }
    }

    private func reloadBadge() async {
        if let rows = try? await DB.from("staff_reports").select("id").eq("status", "new").list(ReportIdRow.self) {
            newReportsCount = rows.count
        }
    }

    private func settingsRow(icon: String, label: String, badge: Int = 0) -> some View {
        HStack(spacing: 12) {
            Image(systemName: icon).font(.system(size: 16)).foregroundStyle(BrandKit.manager).frame(width: 24)
            Text(label).font(.system(size: 15, weight: .medium))
            if badge > 0 {
                Spacer()
                Text("\(badge)").font(.system(size: 12, weight: .bold)).foregroundStyle(.white)
                    .frame(minWidth: 20, minHeight: 20).background(BrandKit.menu, in: Circle())
            }
        }
    }
}

private struct ReportIdRow: Codable, Sendable { let id: String }

// MARK: - Восьмёрка: список шаблонов + CRUD (перенесено из PeopleWalk.swift, реструктура
// 2026-08-13). Прежде — "по исследованию обход-восьмёрка исторически обязанность сменного
// менеджера" (Д3, 2026-07-30) — эта логика не менялась, поменялось только МЕСТО редактирования.

private let WALK_ACCENT = BrandKit.manager

@MainActor
@Observable
final class ManagerWalkModel {
    let rid: String
    init(rid: String) { self.rid = rid }

    var walkTemplates: [WalkTemplate] = []
    var loaded = false
    var toast: String?
    private func flash(_ m: String) {
        toast = m
        Task { try? await Task.sleep(nanoseconds: 2_400_000_000); if toast == m { toast = nil } }
    }

    func load() async {
        if let rows = try? await DB.from("shift_checklists").select().eq("kind", "walk").list(WalkTemplate.self) {
            walkTemplates = rows
        } else if !walkTemplates.isEmpty { flash(t("refreshFailed")) }
        loaded = true
    }

    @discardableResult
    func save(_ template: WalkTemplate) async -> Bool {
        let clean = template.blocks
            .map { WalkBlock(id: $0.id, label: $0.label.trimmingCharacters(in: .whitespaces), categories:
                $0.categories.map { WalkCategory(id: $0.id, label: $0.label.trimmingCharacters(in: .whitespaces), items:
                    $0.items.map { WalkItem(id: $0.id, label: $0.label.trimmingCharacters(in: .whitespaces)) }.filter { !$0.label.isEmpty }) }
                    .filter { !$0.label.isEmpty && !$0.items.isEmpty }) }
            .filter { !$0.label.isEmpty && !$0.categories.isEmpty }
        guard !clean.isEmpty else { flash(t("pe.addItem")); return false }
        var t2 = template; t2.blocks = clean
        let isNew = !walkTemplates.contains { $0.id == template.id }
        do {
            if isNew {
                var values = t2.asUpdateDict
                values["restaurant_id"] = rid
                values["id"] = t2.id
                try await DB.from("shift_checklists").insert(values).run()
            } else {
                try await DB.from("shift_checklists").update(t2.asUpdateDict).eq("id", t2.id).run()
            }
        } catch { flash(t("saveFailed", ["err": error.localizedDescription])); return false }
        flash(t("pe.checklistSaved"))
        await load()
        return true
    }

    func delete(_ id: String) async {
        walkTemplates.removeAll { $0.id == id }
        do {
            try await DB.from("shift_checklists").delete().eq("id", id).run()
        } catch { flash(t("saveFailed", ["err": error.localizedDescription])); await load() }
    }
}

struct ManagerWalkTab: View {
    let rid: String
    @State private var wm: ManagerWalkModel?
    @State private var edit: WalkTemplate?

    var body: some View {
        Group {
            if let wm {
                ManagerWalkList(wm: wm, edit: $edit)
            } else {
                RowListSkeleton(rows: 3)
            }
        }
        .navigationTitle(t("pe.walks")).navigationBarTitleDisplayMode(.inline)
        .task {
            if wm == nil {
                let model = ManagerWalkModel(rid: rid)
                wm = model
                await model.load()
            }
        }
        .sheet(item: $edit) { w in if let wm { WalkEditSheet(m: wm, template: w) } }
    }
}

private struct ManagerWalkList: View {
    @Bindable var wm: ManagerWalkModel
    @Binding var edit: WalkTemplate?

    var body: some View {
        ScrollView {
            VStack(spacing: 10) {
                Button { edit = WalkTemplate() } label: {
                    Label(t("pe.newWalkTemplate"), systemImage: "plus")
                        .font(.system(size: 14, weight: .semibold)).foregroundStyle(WALK_ACCENT)
                        .frame(maxWidth: .infinity).padding(.vertical, 13)
                        .background(RoundedRectangle(cornerRadius: 14).strokeBorder(style: StrokeStyle(lineWidth: 1.5, dash: [5])).foregroundStyle(.primary.opacity(0.2)))
                }
                if wm.walkTemplates.isEmpty {
                    Text(t("pe.noChecklists")).font(.system(size: 15)).foregroundStyle(.primary.opacity(0.4)).padding(.top, 40)
                } else {
                    ForEach(wm.walkTemplates) { w in
                        HStack {
                            VStack(alignment: .leading, spacing: 3) {
                                Text(w.title?.isEmpty == false ? w.title! : t("pe.newWalkTemplate"))
                                    .font(.system(size: 14, weight: .bold)).foregroundStyle(.primary)
                                Text(t("pe.walkBlocksN", ["n": "\(w.blocks.count)"]))
                                    .font(.system(size: 12)).foregroundStyle(.primary.opacity(0.45))
                            }
                            Spacer()
                            Button { edit = w } label: { Image(systemName: "pencil").font(.system(size: 13)).foregroundStyle(WALK_ACCENT) }
                            Button { Task { await wm.delete(w.id) } } label: {
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
            if let toast = wm.toast {
                Text(toast).font(.system(size: 13, weight: .semibold)).foregroundStyle(.primary)
                    .padding(.horizontal, 16).padding(.vertical, 10)
                    .background(.ultraThinMaterial, in: Capsule())
                    .padding(.bottom, 20)
            }
        }
    }
}

// MARK: - Конструктор шаблона (блок → категория → пункт), перенесено из PeopleWalk.swift без
// изменений — только источник данных сменился с PeopleModel на ManagerWalkModel.

struct WalkEditSheet: View {
    @Bindable var m: ManagerWalkModel
    @Environment(\.dismiss) private var dismiss
    @State var template: WalkTemplate
    @State private var saving = false

    var body: some View {
        NavigationStack {
            ZStack {
                Color.miseBg.ignoresSafeArea()
                Form {
                    Section(t("pe.walkTitleLabel")) {
                        TextField(t("pe.walkTitlePh"), text: Binding(get: { template.title ?? "" }, set: { template.title = $0 }))
                    }
                    Section(t("pe.walkPauseMode")) {
                        Picker(t("pe.walkPauseMode"), selection: $template.walk_pause_mode) {
                            Text(t("pe.walkPauseModePause")).tag("pause")
                            Text(t("pe.walkPauseModeContinuous")).tag("continuous")
                        }.pickerStyle(.segmented)
                    }
                    ForEach($template.blocks) { $block in
                        blockSection($block)
                    }
                    Section {
                        Button { template.blocks.append(WalkBlock(label: "")) } label: {
                            Label(t("pe.walkAddBlock"), systemImage: "plus")
                        }
                    }
                }
                .scrollContentBackground(.hidden)
            }
            .navigationTitle(template.title?.isEmpty == false ? template.title! : t("pe.newWalkTemplate"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(t("cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(t("save")) {
                        guard !saving else { return }
                        saving = true
                        // dismiss только на успехе — раньше шторка закрывалась при сбое сети,
                        // весь введённый шаблон терялся (аудит 2026-08-04).
                        Task { defer { saving = false }; if await m.save(template) { dismiss() } }
                    }.disabled(saving)
                }
            }
            .toolbarBackground(Color.miseBg, for: .navigationBar)
        }
    }

    @ViewBuilder private func blockSection(_ block: Binding<WalkBlock>) -> some View {
        Section {
            HStack {
                TextField(t("pe.walkBlockPh"), text: block.label)
                    .font(.system(size: 15, weight: .bold))
                Spacer()
                Button {
                    template.blocks.removeAll { $0.id == block.wrappedValue.id }
                } label: { Image(systemName: "trash").font(.system(size: 13)).foregroundStyle(.primary.opacity(0.3)) }
            }
            ForEach(block.categories) { $cat in
                categoryBlock($cat, in: block)
            }
            Button {
                block.wrappedValue.categories.append(WalkCategory(label: ""))
            } label: { Label(t("pe.walkAddCategory"), systemImage: "plus").font(.system(size: 13)) }
        }
    }

    @ViewBuilder private func categoryBlock(_ cat: Binding<WalkCategory>, in block: Binding<WalkBlock>) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                TextField(t("pe.walkCategoryPh"), text: cat.label)
                    .font(.system(size: 13, weight: .semibold)).foregroundStyle(WALK_ACCENT)
                Spacer()
                Button {
                    block.wrappedValue.categories.removeAll { $0.id == cat.wrappedValue.id }
                } label: { Image(systemName: "xmark").font(.system(size: 11)).foregroundStyle(.primary.opacity(0.3)) }
            }
            ForEach(cat.items.indices, id: \.self) { i in
                HStack {
                    Text("•").foregroundStyle(.primary.opacity(0.3))
                    TextField(t("pe.walkItemPh"), text: cat.items[i].label)
                }
            }
            Button {
                cat.wrappedValue.items.append(WalkItem(label: ""))
            } label: { Label(t("pe.walkAddItem"), systemImage: "plus").font(.system(size: 12)).foregroundStyle(.primary.opacity(0.5)) }
        }
        .padding(.leading, 8)
    }
}
