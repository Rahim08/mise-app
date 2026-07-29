import SwiftUI
import Combine
import ActivityKit
import CoreMotion

// MARK: - «Восьмёрка» (обход-восьмёрка) — kind="walk" в тех же таблицах, что аудиты.
// Свободное дерево блок→категория→пункт, таймер (пауза между блоками или непрерывно —
// выбирается при создании шаблона), живой шагомер, Live Activity в Dynamic Island.

private let WALK_ACCENT = BrandKit.people

// MARK: - Список шаблонов

struct WalkTab: View {
    @Bindable var m: PeopleModel
    @State private var edit: WalkTemplate?
    @State private var running: WalkTemplate?
    @State private var showHistory = false

    var body: some View {
        Group {
            if !m.walksLoaded {
                RowListSkeleton(rows: 3)
            } else {
                Button {
                    edit = WalkTemplate(target_scope: "staff", assigned_staff_id: m.myId)
                } label: {
                    Label(t("pe.newWalkTemplate"), systemImage: "plus")
                        .font(.system(size: 14, weight: .semibold)).foregroundStyle(WALK_ACCENT)
                        .frame(maxWidth: .infinity).padding(.vertical, 13)
                        .background(RoundedRectangle(cornerRadius: 14).strokeBorder(style: StrokeStyle(lineWidth: 1.5, dash: [5])).foregroundStyle(.primary.opacity(0.2)))
                }
                .padding(.bottom, 4)

                let list = m.relevantWalks()
                if list.isEmpty {
                    Text(t("pe.noChecklists")).font(.system(size: 15)).foregroundStyle(.primary.opacity(0.4)).padding(.top, 40)
                } else {
                    ForEach(list) { w in
                        walkRow(w)
                    }
                }

                Button { showHistory = true } label: {
                    Label(t("pe.checklistHistory"), systemImage: "clock.arrow.circlepath")
                        .font(.system(size: 14, weight: .semibold)).foregroundStyle(.primary.opacity(0.6))
                        .frame(maxWidth: .infinity).padding(.vertical, 12)
                }
            }
        }
        .task { if !m.walksLoaded { await m.loadWalks() } }
        .sheet(item: $edit) { w in WalkEditSheet(m: m, template: w) }
        .fullScreenCover(item: $running) { w in WalkRunnerView(m: m, template: w) }
        .sheet(isPresented: $showHistory) { WalkHistorySheet(m: m) }
    }

    private func walkRow(_ w: WalkTemplate) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 3) {
                Text(w.title?.isEmpty == false ? w.title! : t("pe.newWalkTemplate"))
                    .font(.system(size: 14, weight: .bold)).foregroundStyle(.primary)
                Text(t("pe.walkBlocksN", ["n": "\(w.blocks.count)"]))
                    .font(.system(size: 12)).foregroundStyle(.primary.opacity(0.45))
            }
            Spacer()
            Button { running = w } label: {
                Label(t("pe.walkStart"), systemImage: "play.fill")
                    .font(.system(size: 13, weight: .semibold)).foregroundStyle(.white)
                    .padding(.horizontal, 12).padding(.vertical, 8)
                    .background(WALK_ACCENT, in: Capsule())
            }.buttonStyle(.plain)
            if m.canEditWalk(w) {
                Button { edit = w } label: { Image(systemName: "pencil").font(.system(size: 13)).foregroundStyle(WALK_ACCENT) }
                Button { Task { await m.deleteWalkTemplate(w.id) } } label: {
                    Image(systemName: "trash").font(.system(size: 13)).foregroundStyle(.primary.opacity(0.3))
                }
            }
        }
        .padding(12).background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 16))
    }
}

// MARK: - Конструктор шаблона (блок → категория → пункт)

struct WalkEditSheet: View {
    @Bindable var m: PeopleModel
    @Environment(\.dismiss) private var dismiss
    @State var template: WalkTemplate
    @State private var saving = false

    private var isNew: Bool { !m.walkTemplates.contains { $0.id == template.id } }
    private var isManagerEditingRole: Bool { m.isManager }

    var body: some View {
        NavigationStack {
            ZStack {
                Color.miseBg.ignoresSafeArea()
                Form {
                    Section(t("pe.walkTitleLabel")) {
                        TextField(t("pe.walkTitlePh"), text: Binding(get: { template.title ?? "" }, set: { template.title = $0 }))
                    }
                    if isManagerEditingRole {
                        Section(t("pe.targetScope")) {
                            Picker(t("pe.targetScope"), selection: Binding(get: { template.target_scope ?? "staff" }, set: { newVal in
                                template.target_scope = newVal
                                if newVal == "staff" { template.assigned_staff_id = m.myId; template.role = nil }
                                else { template.assigned_staff_id = nil }
                            })) {
                                Text(t("pe.walkTargetSelf")).tag("staff")
                                Text(t("pe.targetRole")).tag("role")
                            }.pickerStyle(.segmented)
                            if template.target_scope == "role" {
                                Picker(t("pe.workshop"), selection: Binding(get: { template.role ?? "" }, set: { template.role = $0.isEmpty ? nil : $0 })) {
                                    ForEach(CHECKLIST_ROLE_CODES, id: \.self) { code in Text(checklistRoleLabel(code)).tag(code ?? "") }
                                }
                            }
                        }
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
                        Task { defer { saving = false }; await m.saveWalkTemplate(template); dismiss() }
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

// MARK: - Прохождение (раннер)

private enum WalkStage: Equatable { case blockList, inBlock(String) }

struct WalkRunnerView: View {
    @Bindable var m: PeopleModel
    let template: WalkTemplate
    @Environment(\.dismiss) private var dismiss

    @State private var stage: WalkStage = .blockList
    @State private var checked: Set<String> = []          // WalkItem.id отмеченных
    @State private var started = false
    @State private var accumulated: TimeInterval = 0
    @State private var segmentStart: Date? = nil
    @State private var steps = 0
    @State private var tick = Date()                       // форс-рефреш раз в секунду
    @State private var confirmFinish = false

    // @State, не let — View это value type, SwiftUI пересоздаёт структуру на КАЖДЫЙ ре-рендер
    // (тап по чекбоксу и т.д.). С let каждый ре-рендер плодил новый WalkPedometer/
    // WalkActivityManager с нуля — реальный CMPedometer и реальная Activity терялись,
    // update() уходил в "мёртвый" объект. Отсюда и заморожен таймер, и пустой Dynamic Island
    // при активном использовании (обновлялось только когда бэкграундили — рендеры прекращались
    // на последнем ДО поломки состоянии). @State хранит идентичность объекта между рендерами.
    @State private var pedometer = WalkPedometer()
    @State private var activity = WalkActivityManager()

    // Явно завязано на tick (а не на живой Date()) — иначе SwiftUI не видит, что elapsed
    // зависит от тикера, и не перерисовывает текст каждую секунду (обновлялось только
    // «случайно», когда другой тап триггерил ре-рендер по другой причине).
    private var elapsed: Int {
        Int(accumulated + (segmentStart != nil ? tick.timeIntervalSince(segmentStart!) : 0))
    }
    private var isContinuous: Bool { template.walk_pause_mode == "continuous" }
    private var isPaused: Bool { started && segmentStart == nil }

    private func doneCount(in block: WalkBlock) -> (Int, Int) {
        let items = block.categories.flatMap(\.items)
        return (items.filter { checked.contains($0.id) }.count, items.count)
    }

    var body: some View {
        NavigationStack {
            ZStack {
                Color.miseBg.ignoresSafeArea()
                VStack(spacing: 0) {
                    timerHeader
                    ScrollView {
                        switch stage {
                        case .blockList: blockList
                        case .inBlock(let id):
                            if let block = template.blocks.first(where: { $0.id == id }) {
                                blockDetail(block)
                            }
                        }
                    }
                }
            }
            .navigationTitle(template.title ?? t("pe.newWalkTemplate"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(Color.miseBg, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(t("cancel")) { Task { await teardown(save: false) }; dismiss() } }
                if started {
                    ToolbarItem(placement: .confirmationAction) {
                        Button(t("pe.walkFinish")) { confirmFinish = true }
                    }
                }
            }
            .confirmationDialog(t("pe.walkFinishConfirm"), isPresented: $confirmFinish, titleVisibility: .visible) {
                Button(t("pe.walkFinish")) { Task { await teardown(save: true); dismiss() } }
                Button(t("cancel"), role: .cancel) {}
            }
        }
        .onReceive(Timer.publish(every: 1, on: .main, in: .common).autoconnect()) { now in
            tick = now
            // Раз в 10с — только чтобы освежить шаги в Island (таймер сам себя считает
            // системой и в частых пушах не нуждается).
            if started, Int(now.timeIntervalSince1970) % 10 == 0 { pushActivity() }
        }
        .onAppear { pedometer.onUpdate = { n in steps = n } }
    }

    private var timerHeader: some View {
        HStack(spacing: 16) {
            VStack(alignment: .leading, spacing: 2) {
                Text(fmtElapsed(elapsed)).font(.system(size: 28, weight: .bold, design: .rounded)).foregroundStyle(.primary)
                Text(isPaused ? t("pe.walkPaused") : t("pe.walkActive"))
                    .font(.system(size: 11, weight: .semibold)).foregroundStyle(isPaused ? .secondary : WALK_ACCENT)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 2) {
                HStack(spacing: 4) {
                    Image(systemName: "shoeprints.fill").font(.system(size: 13))
                    Text("\(steps)").font(.system(size: 20, weight: .bold, design: .rounded))
                }.foregroundStyle(.primary)
                Text(t("pe.walkSteps")).font(.system(size: 11)).foregroundStyle(.secondary)
            }
        }
        .padding(16)
        .background(.ultraThinMaterial)
    }

    private var blockList: some View {
        LazyVStack(spacing: 10) {
            if !started {
                Button {
                    started = true
                    if isContinuous { segmentStart = Date() }
                    pedometer.start()
                    activity.start(title: template.title ?? t("pe.newWalkTemplate"))
                    pushActivity()
                } label: {
                    Label(t("pe.walkStartWalk"), systemImage: "play.fill")
                        .font(.system(size: 15, weight: .semibold)).foregroundStyle(.white)
                        .frame(maxWidth: .infinity).padding(.vertical, 14)
                        .background(WALK_ACCENT, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                }
                .padding(.horizontal, 16).padding(.top, 16)
            }
            ForEach(template.blocks) { block in
                let (done, total) = doneCount(in: block)
                Button {
                    guard started else { return }
                    enterBlock(block.id)
                } label: {
                    HStack {
                        VStack(alignment: .leading, spacing: 3) {
                            Text(block.label.isEmpty ? t("pe.walkBlockPh") : block.label)
                                .font(.system(size: 15, weight: .semibold)).foregroundStyle(.primary)
                            Text("\(done)/\(total)")
                                .font(.system(size: 12)).foregroundStyle(.primary.opacity(0.45))
                        }
                        Spacer()
                        if total > 0 && done == total {
                            Image(systemName: "checkmark.circle.fill").foregroundStyle(WALK_ACCENT)
                        }
                        Image(systemName: "chevron.right").font(.system(size: 12)).foregroundStyle(.primary.opacity(0.25))
                    }
                    .padding(14).background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                }
                .buttonStyle(.plain)
                .opacity(started ? 1 : 0.4)
            }
        }
        .padding(16)
    }

    private func blockDetail(_ block: WalkBlock) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            Button {
                exitBlock()
            } label: {
                Label(t("pe.walkBackToBlocks"), systemImage: "chevron.left").font(.system(size: 13, weight: .semibold))
            }
            .padding(.horizontal, 16).padding(.top, 12)

            ForEach(block.categories) { cat in
                VStack(alignment: .leading, spacing: 8) {
                    Text(cat.label).font(.system(size: 13, weight: .bold)).foregroundStyle(WALK_ACCENT)
                    ForEach(cat.items) { item in
                        Button {
                            if checked.contains(item.id) { checked.remove(item.id) } else { checked.insert(item.id) }
                        } label: {
                            HStack {
                                Image(systemName: checked.contains(item.id) ? "checkmark.square.fill" : "square")
                                    .foregroundStyle(checked.contains(item.id) ? WALK_ACCENT : .primary.opacity(0.3))
                                Text(item.label).font(.system(size: 14)).foregroundStyle(.primary)
                                Spacer()
                            }
                            .padding(12).background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                        }.buttonStyle(.plain)
                    }
                }
            }
        }
        .padding(.horizontal, 16).padding(.bottom, 24)
    }

    private func enterBlock(_ id: String) {
        stage = .inBlock(id)
        if !isContinuous, segmentStart == nil { segmentStart = Date() }
        pushActivity()
    }
    private func exitBlock() {
        if !isContinuous, let s = segmentStart { accumulated += Date().timeIntervalSince(s); segmentStart = nil }
        stage = .blockList
        pushActivity()
    }

    /// Апдейт Live Activity ТОЛЬКО на событиях (старт/пауза/резюм/смена блока) — сам таймер
    /// в Island считает система через Text(startDate, style: .timer), апдейт от приложения
    /// каждую секунду ей не нужен (и именно такие частые пуши система троттлит/останавливает —
    /// см. фидбек «шёл по 2 секунды, потом замер»).
    private func pushActivity() {
        guard started else { return }
        let label: String
        if case .inBlock(let id) = stage { label = template.blocks.first { $0.id == id }?.label ?? "" }
        else { label = "" }
        if isPaused {
            activity.update(blockLabel: label, startDate: Date(), isPaused: true, pausedSeconds: elapsed, steps: steps)
        } else {
            activity.update(blockLabel: label, startDate: Date().addingTimeInterval(-accumulated), isPaused: false, pausedSeconds: 0, steps: steps)
        }
    }

    private func teardown(save: Bool) async {
        if !isContinuous, let s = segmentStart { accumulated += Date().timeIntervalSince(s); segmentStart = nil }
        pedometer.stop()
        await activity.end()
        guard save, started else { return }
        let state = template.flatItems.map { ChecklistItemState(done: checked.contains($0.id)) }
        await m.finishWalkRun(template: template, itemsState: state, durationSeconds: elapsed, steps: steps)
    }
}

private func fmtElapsed(_ seconds: Int) -> String {
    let m = seconds / 60, s = seconds % 60
    return String(format: "%d:%02d", m, s)
}

// MARK: - Шагомер (CoreMotion)

@MainActor final class WalkPedometer {
    private let pedometer = CMPedometer()
    private let startDate = Date()
    var onUpdate: ((Int) -> Void)?

    func start() {
        guard CMPedometer.isStepCountingAvailable() else { return }
        pedometer.startUpdates(from: startDate) { [weak self] data, _ in
            guard let data else { return }
            Task { @MainActor in self?.onUpdate?(data.numberOfSteps.intValue) }
        }
    }
    func stop() { pedometer.stopUpdates() }
}

// MARK: - Live Activity менеджер (обёртка над ActivityKit)

@MainActor final class WalkActivityManager {
    private var activity: Activity<WalkActivityAttributes>?

    func start(title: String) {
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
        let attrs = WalkActivityAttributes(templateTitle: title)
        let state = WalkActivityAttributes.ContentState(blockLabel: "", startDate: Date(), isPaused: false, pausedSeconds: 0, steps: 0)
        activity = try? Activity.request(attributes: attrs, content: .init(state: state, staleDate: nil))
    }
    func update(blockLabel: String, startDate: Date, isPaused: Bool, pausedSeconds: Int, steps: Int) {
        guard let activity else { return }
        let state = WalkActivityAttributes.ContentState(blockLabel: blockLabel, startDate: startDate, isPaused: isPaused, pausedSeconds: pausedSeconds, steps: steps)
        Task { await activity.update(.init(state: state, staleDate: nil)) }
    }
    func end() async {
        guard let activity else { return }
        await activity.end(nil, dismissalPolicy: .immediate)
        self.activity = nil
    }
}

// MARK: - История прогонов восьмёрки

struct WalkHistorySheet: View {
    @Bindable var m: PeopleModel
    @Environment(\.dismiss) private var dismiss
    @State private var openRun: WalkRun?

    var body: some View {
        NavigationStack {
            ZStack {
                Color.miseBg.ignoresSafeArea()
                ScrollView {
                    LazyVStack(spacing: 10) {
                        if m.walkRuns.isEmpty {
                            Text(t("pe.noRunYet")).font(.system(size: 14)).foregroundStyle(.primary.opacity(0.4)).padding(.top, 40)
                        } else {
                            ForEach(m.walkRuns) { run in
                                Button { openRun = run } label: { runRow(run) }.buttonStyle(.plain)
                            }
                        }
                    }.padding(16)
                }
            }
            .navigationTitle(t("pe.checklistHistory")).navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(Color.miseBg, for: .navigationBar)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button(t("done")) { dismiss() } } }
        }
        .sheet(item: $openRun) { run in
            if let template = m.walkTemplates.first(where: { $0.id == run.checklist_id }) {
                WalkRunReportView(m: m, template: template, run: run)
            }
        }
    }

    private func runRow(_ run: WalkRun) -> some View {
        let title = m.walkTemplates.first { $0.id == run.checklist_id }?.title ?? "—"
        let doneN = run.items_state?.filter(\.done).count ?? 0
        let totalN = run.items_state?.count ?? 0
        return VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(title).font(.system(size: 14, weight: .bold)).foregroundStyle(.primary)
                Spacer()
                Text(run.date ?? "—").font(.system(size: 12)).foregroundStyle(.primary.opacity(0.5))
            }
            HStack(spacing: 14) {
                Label(fmtElapsed(run.duration_seconds ?? 0), systemImage: "clock").font(.system(size: 12))
                Label("\(run.steps ?? 0)", systemImage: "shoeprints.fill").font(.system(size: 12))
                Label("\(doneN)/\(totalN)", systemImage: "checkmark.circle").font(.system(size: 12))
            }.foregroundStyle(.primary.opacity(0.6))
        }
        .padding(12).background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 14))
    }
}

// MARK: - Детальный отчёт прогона восьмёрки + PDF (переиспользует renderAuditPdf/AuditPdfRow
// из PeopleChecklists.swift — та же форма отчёта, что у обычных аудитов, без фото).

struct WalkRunReportView: View {
    @Bindable var m: PeopleModel
    let template: WalkTemplate
    let run: WalkRun
    @Environment(\.dismiss) private var dismiss
    @State private var generating = false
    @State private var payload: AuditPdfPayload?

    private var flatItems: [WalkItem] { template.flatItems }
    private var state: [ChecklistItemState] { run.items_state ?? [] }
    private var doneN: Int { state.filter(\.done).count }
    private var totalN: Int { flatItems.count }
    private var pct: Int { totalN > 0 ? Int((Double(doneN) / Double(totalN) * 100).rounded()) : 0 }

    var body: some View {
        NavigationStack {
            ZStack {
                Color.miseBg.ignoresSafeArea()
                ScrollView {
                    VStack(alignment: .leading, spacing: 14) {
                        VStack(spacing: 4) {
                            Text("\(pct)%").font(.system(size: 34, weight: .bold))
                                .foregroundStyle(pct >= 80 ? BrandKit.analytics : pct >= 50 ? BrandKit.stash : BrandKit.menu)
                            Text("\(run.date ?? "—") · \(m.staffName(run.staff_id)) · \(doneN)/\(totalN)")
                                .font(.system(size: 12)).foregroundStyle(.primary.opacity(0.5))
                            HStack(spacing: 14) {
                                Label(fmtElapsed(run.duration_seconds ?? 0), systemImage: "clock")
                                Label("\(run.steps ?? 0)", systemImage: "shoeprints.fill")
                            }.font(.system(size: 12)).foregroundStyle(.primary.opacity(0.45))
                        }
                        .frame(maxWidth: .infinity)
                        .padding(16).background(Color.primary.opacity(0.05), in: RoundedRectangle(cornerRadius: 16))

                        ForEach(template.blocks) { block in
                            VStack(alignment: .leading, spacing: 8) {
                                Text(block.label).font(.system(size: 13, weight: .bold)).foregroundStyle(WALK_ACCENT)
                                ForEach(block.categories) { cat in
                                    ForEach(cat.items) { item in
                                        let idx = flatItems.firstIndex { $0.id == item.id } ?? -1
                                        let done = idx >= 0 && idx < state.count && state[idx].done
                                        HStack(spacing: 10) {
                                            Image(systemName: done ? "checkmark.circle.fill" : "xmark.circle")
                                                .foregroundStyle(done ? BrandKit.analytics : .primary.opacity(0.3))
                                            Text(item.label).font(.system(size: 14)).foregroundStyle(.primary)
                                            Spacer(minLength: 0)
                                        }
                                        .padding(.vertical, 6)
                                    }
                                }
                            }
                            .padding(12).background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 14))
                        }
                    }
                    .padding(16)
                }
            }
            .navigationTitle(template.title ?? t("pe.auditReport"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button { export() } label: {
                        if generating { ProgressView().controlSize(.small) }
                        else { Image(systemName: "square.and.arrow.up") }
                    }.disabled(generating)
                }
            }
            .toolbarBackground(Color.miseBg, for: .navigationBar)
        }
        .sheet(item: $payload) { p in AuditShareSheet(url: p.url) }
    }

    private func export() {
        guard !generating else { return }
        generating = true
        var rows: [AuditPdfRow] = []
        for block in template.blocks {
            rows.append(AuditPdfRow(tag: "", kind: nil, label: "— \(block.label) —", note: nil))
            for cat in block.categories {
                for item in cat.items {
                    let idx = flatItems.firstIndex { $0.id == item.id } ?? -1
                    let done = idx >= 0 && idx < state.count && state[idx].done
                    rows.append(AuditPdfRow(tag: done ? "OK" : t("pe.notChecked"), kind: done ? "pass" : "fail", label: item.label, note: nil))
                }
            }
        }
        let snap = AuditPdfSnapshot(
            title: template.title ?? t("pe.auditReport"),
            meta: "\(run.date ?? "") · \(m.staffName(run.staff_id))",
            scoreLine: "\(t("pe.statsCompletionRate")): \(pct)% (\(doneN)/\(totalN)) · \(fmtElapsed(run.duration_seconds ?? 0)) · \(run.steps ?? 0) \(t("pe.walkSteps"))",
            rows: rows, photos: [:]
        )
        Task {
            let data = await Task.detached(priority: .userInitiated) { renderAuditPdf(snap) }.value
            let url = FileManager.default.temporaryDirectory.appendingPathComponent("mise-walk-\(Int(Date().timeIntervalSince1970)).pdf")
            if (try? data.write(to: url)) != nil {
                try? await Task.sleep(nanoseconds: 300_000_000)
                payload = AuditPdfPayload(url: url)
            } else {
                m.flash(t("saveFailed", ["err": "pdf"]))
            }
            generating = false
        }
    }
}
