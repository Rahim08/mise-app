import SwiftUI
import CoreLocation
import UIKit
// Чек-листы и аудиты: прогоны, оценки, отчёты, PDF, статистика
// Распил PeopleView.swift (Д2, 2026-07-18): секция вынесена без изменений логики.

// MARK: Чек-листы

struct ChecklistEdit: Identifiable {
    var id = UUID(); var listId: String?; var role: String?; var items: [ChecklistItem]
    var kind: String = "shift"; var targetScope: String = "role"; var assignedStaffId: String?; var title: String = ""
    var recurrence: String = "none"; var recurrenceWeekdays: Set<Int> = []; var recurrenceDayOfMonth: Int = 1
}

// «Смена» — открытие/закрытие, весь персонал по цеху. Восьмёрка выделена в отдельную пилюлю
// в ShiftAuditHub (Д5, флаттенинг: раньше был пикер Смена|Восьмёрка внутри «Рутины», теперь
// это отдельные пилюли одного уровня — ShiftAuditHub переключает контент напрямую).
// Редактирование шаблонов (создание/роль/пункты) переехало в Manager→Настройки→Чек-листы
// (реструктура 2026-08-13). Менеджерская верификация (grading, было Д4 2026-07-31) —
// переехала туда же (реструктура 2026-08-14, юзер-фидбок + индустрия: SafetyCulture/Jolt/
// Zenput — «field team исполняет → quality/manager team проверяет через отдельный
// dashboard», а не внутри той же карточки, что использует исполнитель). Здесь, в People,
// менеджер теперь только проходит СВОИ чек-листы, как рядовой сотрудник — ничего не
// верифицирует за других.
struct RoutineTab: View {
    @Bindable var m: PeopleModel

    var body: some View {
        Group {
            if !m.checklistsLoaded {
                RowListSkeleton(rows: 3)
            } else {
                shiftSection
            }
        }
    }

    private var shiftSection: some View {
        Group {
            if m.openShiftId == nil { inactiveBanner }
            Picker("", selection: $m.clType) {
                Text(t("pe.open")).tag("open"); Text(t("pe.close")).tag("close")
            }.pickerStyle(.segmented)
            let lists = m.relevantChecklists()
            if lists.isEmpty {
                Text(t("pe.noChecklists")).font(.system(size: 15)).foregroundStyle(.primary.opacity(0.4)).padding(.top, 40)
            } else {
                ForEach(lists) { list in checklistRow(list) }
            }
        }
    }

    @ViewBuilder private func checklistRow(_ list: ShiftChecklist) -> some View {
        ChecklistRunCard(m: m, list: list, run: m.completion(list), showManagerControls: false,
                          onToggle: { i, photo in await m.toggleChecklistItem(list, i, photoURL: photo) },
                          onEdit: {}, onDelete: {})
    }

    private var inactiveBanner: some View {
        HStack(spacing: 10) {
            Image(systemName: "clock.badge.exclamationmark").font(.system(size: 18)).foregroundStyle(BrandKit.stash)
            VStack(alignment: .leading, spacing: 2) {
                Text(t("mg.noShift")).font(.system(size: 14, weight: .semibold)).foregroundStyle(.primary)
                Text(t("pe.checklistNoShiftHint"))
                    .font(.system(size: 12)).foregroundStyle(.primary.opacity(0.5))
            }
            Spacer()
        }
        .padding(14).background(BrandKit.stash.opacity(0.12), in: RoundedRectangle(cornerRadius: 14))
    }
}

// «Аудиты»: список/создание/история/отчёт разовых проверок. Статистика вынесена в
// шторку в ShiftAuditHub (Д5). Видимость самой пилюли «Аудиты» решает isManager ||
// relevantAudits() в ShiftAuditHub.
struct AuditsTab: View {
    @Bindable var m: PeopleModel
    @State private var edit: ChecklistEdit?
    @State private var auditHistoryOf: ShiftChecklist?

    var body: some View {
        Group {
            if !m.auditsLoaded {
                RowListSkeleton(rows: 3)
            } else {
                auditsSection
            }
        }
        .sheet(item: $edit) { e in ChecklistEditSheet(m: m, edit: e) }
        .sheet(item: $auditHistoryOf) { a in AuditHistorySheet(m: m, list: a) }
    }

    private var auditsSection: some View {
        Group {
            if m.isManager {
                Button {
                    edit = ChecklistEdit(listId: nil, role: nil, items: [ChecklistItem(label: "")], kind: "audit", targetScope: "venue", title: "")
                } label: {
                    Label(t("pe.newAuditTemplate"), systemImage: "plus")
                        .font(.system(size: 14, weight: .semibold)).foregroundStyle(PEOPLE_ACCENT)
                        .frame(maxWidth: .infinity).padding(.vertical, 13)
                        .background(RoundedRectangle(cornerRadius: 14).strokeBorder(style: StrokeStyle(lineWidth: 1.5, dash: [5])).foregroundStyle(.primary.opacity(0.2)))
                }
                .padding(.bottom, 4)
            }
            let list = m.relevantAudits()
            if list.isEmpty {
                Text(t("pe.noChecklists")).font(.system(size: 15)).foregroundStyle(.primary.opacity(0.4)).padding(.top, 40)
            } else {
                ForEach(list) { a in
                    let run = m.auditRun(a)
                    if run != nil || m.isManager {
                        VStack(alignment: .leading, spacing: 8) {
                            HStack {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(a.title?.isEmpty == false ? a.title! : (a.itemDetails?.first?.label ?? "—"))
                                        .font(.system(size: 14, weight: .bold)).foregroundStyle(.primary)
                                    if let rec = a.recurrence, rec != "none" {
                                        HStack(spacing: 3) {
                                            Image(systemName: "repeat").font(.system(size: 9, weight: .bold))
                                            Text(recurrenceSummary(rec, a.recurrenceWeekdays, a.recurrenceDayOfMonth))
                                        }
                                        .font(.system(size: 11, weight: .semibold)).foregroundStyle(PEOPLE_ACCENT.opacity(0.8))
                                    }
                                }
                                Spacer()
                                if m.isManager {
                                    Button { Task { await m.startAudit(templateId: a.id) } } label: {
                                        Image(systemName: "paperplane.fill").font(.system(size: 13)).foregroundStyle(PEOPLE_ACCENT)
                                    }
                                    Button { auditHistoryOf = a } label: {
                                        Image(systemName: "clock.arrow.circlepath").font(.system(size: 13)).foregroundStyle(.primary.opacity(0.45))
                                    }
                                    Button {
                                        edit = ChecklistEdit(listId: a.id, role: a.role, items: (a.itemDetails?.isEmpty == false) ? a.itemDetails! : [ChecklistItem(label: "")],
                                                              kind: "audit", targetScope: a.target_scope ?? "venue", assignedStaffId: a.assigned_staff_id, title: a.title ?? "",
                                                              recurrence: a.recurrence ?? "none", recurrenceWeekdays: Set(a.recurrenceWeekdays ?? []), recurrenceDayOfMonth: a.recurrenceDayOfMonth ?? 1)
                                    } label: { Image(systemName: "pencil").font(.system(size: 13)).foregroundStyle(PEOPLE_ACCENT) }
                                    Button { Task { await m.deleteChecklist(a.id) } } label: {
                                        Image(systemName: "trash").font(.system(size: 13)).foregroundStyle(.primary.opacity(0.3))
                                    }
                                }
                            }
                            if let run {
                                ChecklistRunCard(m: m, list: a, run: run, showManagerControls: false,
                                                  onToggle: { i, photo in await m.toggleAuditItem(a, i, photoURL: photo) },
                                                  onEdit: {}, onDelete: {}, grading: true,
                                                  onGrade: { i, r, photo in await m.gradeAuditItem(a, i, result: r, photoURL: photo) },
                                                  onNote: { i, text in await m.setAuditItemNote(a, i, note: text) })
                            } else {
                                Text(t("pe.noRunYet")).font(.system(size: 12)).foregroundStyle(.primary.opacity(0.4))
                            }
                        }
                        .padding(12).background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 16))
                    }
                }
            }
        }
    }
}

@MainActor func roleTitle(_ role: String?) -> String {
    guard let role else { return t("pe.role.general") }
    let known = ["kitchen", "bar", "hookah", "waiter", "host", "cleaner"]
    return known.contains(role) ? t("pe.role." + role) : role
}

/// Карточка одного прогона чек-листа/аудита — используется и «Сменой», и «Аудитами».
struct ChecklistRunCard: View {
    @Bindable var m: PeopleModel
    let list: ShiftChecklist
    let run: ChecklistCompletion?
    let showManagerControls: Bool
    let onToggle: (Int, String?) async -> Void
    let onEdit: () -> Void
    let onDelete: () -> Void
    // Оценки Б1/Б2 (разовые аудиты): ✓/✗/N/A + комментарий вместо бинарной галки.
    var grading: Bool = false
    var onGrade: ((Int, String?, String?) async -> Void)? = nil  // (idx, result | nil = снять, photoURL)
    var onNote: ((Int, String?) async -> Void)? = nil

    @State private var showCamera = false
    @State private var pendingIndex: Int?
    @State private var pendingResult: String?
    @State private var uploading = false
    @State private var report: ReportTarget?
    @State private var noteTarget: NoteTarget?

    struct ReportTarget: Identifiable { var id = UUID(); var index: Int; var label: String }
    struct NoteTarget: Identifiable { var id = UUID(); var index: Int; var text: String }

    var body: some View {
        let items = list.itemDetails ?? []
        let state = run?.items_state ?? []
        let done = items.indices.filter { $0 < state.count && state[$0].done }.count
        // Нарушения в заголовке (grading): зелёный «ГОТОВО» при провалах вводит в заблуждение.
        let fails = grading ? items.indices.filter { i in
            guard i < state.count else { return false }
            return (state[i].result ?? (state[i].done ? "pass" : nil)) == "fail"
        }.count : 0
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("\(roleTitle(list.role)) · \(done)/\(items.count)")
                    .font(.system(size: 12, weight: .semibold)).foregroundStyle(list.role != nil ? PEOPLE_ACCENT : .white.opacity(0.45)).kerning(0.5)
                Spacer()
                if fails > 0 {
                    HStack(spacing: 3) {
                        Image(systemName: "xmark").font(.system(size: 9, weight: .bold))
                        Text("\(fails)")
                    }
                    .font(.system(size: 11, weight: .bold)).foregroundStyle(BrandKit.menu)
                    .padding(.horizontal, 8).padding(.vertical, 2).background(BrandKit.menu.opacity(0.16), in: Capsule())
                } else if done == items.count && !items.isEmpty {
                    Text(t("pe.readyCaps")).font(.system(size: 11, weight: .bold)).foregroundStyle(BrandKit.analytics)
                        .padding(.horizontal, 8).padding(.vertical, 2).background(BrandKit.analytics.opacity(0.16), in: Capsule())
                }
                if showManagerControls {
                    Button(action: onEdit) { Image(systemName: "pencil").font(.system(size: 13)).foregroundStyle(PEOPLE_ACCENT) }
                    Button(action: onDelete) { Image(systemName: "trash").font(.system(size: 13)).foregroundStyle(.primary.opacity(0.3)) }
                }
            }
            .padding(.bottom, 8)
            VStack(spacing: 0) {
                ForEach(Array(items.enumerated()), id: \.offset) { i, item in
                    let st: ChecklistItemState? = i < state.count ? state[i] : nil
                    if grading {
                        gradingRow(i, item, st)
                    } else {
                        let on = st?.done == true
                        HStack(spacing: 8) {
                        Button {
                            guard !uploading else { return }
                            if item.photo_required && !on { pendingIndex = i; showCamera = true }
                            else { Task { await onToggle(i, nil) } }
                        } label: {
                            HStack(spacing: 12) {
                                ZStack {
                                    Circle().stroke(on ? PEOPLE_ACCENT : Color.primary.opacity(0.25), lineWidth: 2).frame(width: 22, height: 22)
                                    if on { Circle().fill(PEOPLE_ACCENT).frame(width: 22, height: 22)
                                        Image(systemName: "checkmark").font(.system(size: 11, weight: .bold)).foregroundStyle(.primary) }
                                }
                                Text(item.label).font(.system(size: 15)).foregroundStyle(.primary.opacity(on ? 0.5 : 1)).strikethrough(on)
                                if item.photo_required {
                                    Image(systemName: "camera.fill").font(.system(size: 10)).foregroundStyle(.primary.opacity(0.3))
                                }
                                Spacer()
                            }
                        }
                        .buttonStyle(.plain)
                        Button { report = ReportTarget(index: i, label: item.label) } label: {
                            Image(systemName: "exclamationmark.bubble").font(.system(size: 13)).foregroundStyle(BrandKit.menu.opacity(0.6))
                        }
                        }
                        .padding(.vertical, 12).padding(.horizontal, 14)
                    }
                    if i < items.count - 1 { Divider().overlay(Color.primary.opacity(0.07)).padding(.leading, 48) }
                }
            }
            .background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 16))
        }
        .padding(.top, 4)
        .sheet(isPresented: $showCamera) {
            CameraCaptureView { image in
                showCamera = false
                guard let idx = pendingIndex, let image else { pendingResult = nil; return }
                let result = pendingResult
                pendingResult = nil
                uploading = true
                Task {
                    defer { uploading = false }
                    let itemId = idx < items.count ? items[idx].id : "\(idx)"
                    if let url = await uploadAuditPhoto(image: image, restaurantId: m.rid, completionId: run?.id ?? list.id, itemId: itemId) {
                        if let result, let onGrade { await onGrade(idx, result, url) }
                        else { await onToggle(idx, url) }
                    } else {
                        m.flash(t("saveFailed", ["err": "upload"]))
                    }
                }
            }
        }
        .sheet(item: $report) { target in
            ReportProblemSheet(m: m, list: list, run: run, itemIndex: target.index, itemLabel: target.label)
        }
        .sheet(item: $noteTarget) { target in
            ItemNoteSheet(initial: target.text) { text in
                Task { await onNote?(target.index, text) }
            }
        }
    }

    /// Строка пункта в grading-режиме: исход ✓ / ✗ / N/A + комментарий (ревью Б1/Б2).
    /// Старые записи без result: done трактуем как pass.
    @ViewBuilder
    private func gradingRow(_ i: Int, _ item: ChecklistItem, _ st: ChecklistItemState?) -> some View {
        let eff = st?.result ?? (st?.done == true ? "pass" : nil)
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Text(item.label).font(.system(size: 15)).foregroundStyle(.primary.opacity(eff == "pass" ? 0.55 : 1))
                if item.photo_required {
                    Image(systemName: "camera.fill").font(.system(size: 10)).foregroundStyle(.primary.opacity(0.3))
                }
                Spacer()
                Button { report = ReportTarget(index: i, label: item.label) } label: {
                    Image(systemName: "exclamationmark.bubble").font(.system(size: 13)).foregroundStyle(BrandKit.menu.opacity(0.6))
                }
            }
            HStack(spacing: 8) {
                gradePill(on: eff == "pass", color: BrandKit.analytics) {
                    Image(systemName: "checkmark").font(.system(size: 12, weight: .bold))
                } action: {
                    guard !uploading else { return }
                    if eff == "pass" { Task { await onGrade?(i, nil, nil) } }
                    else if item.photo_required && st?.photo_url == nil { pendingIndex = i; pendingResult = "pass"; showCamera = true }
                    else { Task { await onGrade?(i, "pass", nil) } }
                }
                gradePill(on: eff == "fail", color: BrandKit.menu) {
                    Image(systemName: "xmark").font(.system(size: 12, weight: .bold))
                } action: {
                    if eff == "fail" { Task { await onGrade?(i, nil, nil) } }
                    else {
                        Task { await onGrade?(i, "fail", nil) }
                        // Фейл сразу предлагает завести задачу-нарушение (паттерн SafetyCulture).
                        report = ReportTarget(index: i, label: item.label)
                    }
                }
                gradePill(on: eff == "na", color: Color.primary.opacity(0.45)) {
                    Text("N/A").font(.system(size: 12, weight: .bold))
                } action: {
                    Task { await onGrade?(i, eff == "na" ? nil : "na", nil) }
                }
                Spacer()
                Button { noteTarget = NoteTarget(index: i, text: st?.note ?? "") } label: {
                    Image(systemName: "text.bubble")
                        .font(.system(size: 13))
                        .foregroundStyle((st?.note?.isEmpty == false) ? PEOPLE_ACCENT : Color.primary.opacity(0.3))
                }
            }
            if uploading && pendingIndex == i {
                ProgressView().controlSize(.small)
            }
            if let note = st?.note, !note.isEmpty {
                Text(note).font(.system(size: 12)).foregroundStyle(.primary.opacity(0.5))
            }
        }
        .padding(.vertical, 12).padding(.horizontal, 14)
    }

    private func gradePill(on: Bool, color: Color, @ViewBuilder label: () -> some View, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            label()
                .foregroundStyle(on ? Color.white : Color.primary.opacity(0.45))
                .frame(minWidth: 34)
                .padding(.vertical, 6).padding(.horizontal, 8)
                .background(on ? AnyShapeStyle(color) : AnyShapeStyle(Color.primary.opacity(0.08)), in: RoundedRectangle(cornerRadius: 9))
        }
        .buttonStyle(.plain)
    }
}

/// Комментарий к пункту аудита (ревью Б2): маленький шит с TextEditor.
struct ItemNoteSheet: View {
    @Environment(\.dismiss) private var dismiss
    let initial: String
    let onSave: (String?) -> Void
    @State private var text = ""

    var body: some View {
        NavigationStack {
            ZStack {
                Color.miseBg.ignoresSafeArea()
                TextEditor(text: $text)
                    .scrollContentBackground(.hidden)
                    .padding(12)
                    .background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 14))
                    .padding(16)
                    .frame(maxHeight: 180, alignment: .top)
                    .frame(maxHeight: .infinity, alignment: .top)
            }
            .navigationTitle(t("pe.itemNote"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(t("cancel")) { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(t("save")) { onSave(text); dismiss() }.fontWeight(.semibold)
                }
            }
            .toolbarBackground(Color.miseBg, for: .navigationBar)
        }
        .presentationDetents([.height(280)])
        .onAppear { text = initial }
    }
}

/// Счёт прогона (ревью Б3/Б4, весы — Б6): N/A вне знаменателя, pass = выполнено;
/// legacy-записи без result — done = pass. Пункт весит item.weight (по умолчанию 1 —
/// чек-листы смены без весов считаются как раньше, поштучно).
nonisolated func auditRunScore(_ items: [ChecklistItem], _ state: [ChecklistItemState]) -> (pass: Int, total: Int) {
    var pass = 0, total = 0
    for i in items.indices {
        let st: ChecklistItemState? = i < state.count ? state[i] : nil
        let eff = st?.result ?? (st?.done == true ? "pass" : nil)
        if eff == "na" { continue }
        let w = items[i].weight > 0 ? items[i].weight : 1
        total += w
        if eff == "pass" { pass += w }
    }
    return (pass, total)
}

/// История прогонов аудита за 30 дней (ревью Б4) — вход в отчёт прогона (Б3).
/// Данные уже в m.auditRuns (loadAudits тянет 30 дней) — без отдельного запроса.
struct AuditHistorySheet: View {
    @Bindable var m: PeopleModel
    let list: ShiftChecklist
    @State private var openRun: ChecklistCompletion?

    private var runs: [ChecklistCompletion] {
        m.auditRuns.filter { $0.checklist_id == list.id }.sorted { ($0.date ?? "") > ($1.date ?? "") }
    }

    var body: some View {
        NavigationStack {
            ZStack {
                Color.miseBg.ignoresSafeArea()
                if runs.isEmpty {
                    Text(t("pe.auditHistoryEmpty")).font(.system(size: 14)).foregroundStyle(.primary.opacity(0.4))
                } else {
                    ScrollView {
                        VStack(spacing: 0) {
                            ForEach(runs) { run in
                                let score = auditRunScore(list.itemDetails ?? [], run.items_state ?? [])
                                let pct = score.total > 0 ? Int((Double(score.pass) / Double(score.total) * 100).rounded()) : 0
                                Button { openRun = run } label: {
                                    HStack {
                                        VStack(alignment: .leading, spacing: 2) {
                                            Text(run.date ?? "—").font(.system(size: 14, weight: .semibold)).foregroundStyle(.primary)
                                            Text(m.staffName(run.staff_id)).font(.system(size: 12)).foregroundStyle(.primary.opacity(0.5))
                                        }
                                        Spacer()
                                        if run.status == "pending" {
                                            Text(t("pe.notChecked")).font(.system(size: 12, weight: .semibold)).foregroundStyle(.primary.opacity(0.4))
                                        } else {
                                            Text("\(pct)%").font(.system(size: 14, weight: .bold))
                                                .foregroundStyle(pct >= 80 ? BrandKit.analytics : pct >= 50 ? BrandKit.stash : BrandKit.menu)
                                        }
                                    }
                                    .padding(.vertical, 12).padding(.horizontal, 16)
                                }
                                .buttonStyle(.plain)
                                Divider().overlay(Color.primary.opacity(0.07)).padding(.leading, 16)
                            }
                        }
                    }
                }
            }
            .navigationTitle(t("pe.auditHistory"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(Color.miseBg, for: .navigationBar)
        }
        .sheet(item: $openRun) { run in AuditRunReportView(m: m, list: list, run: run) }
    }
}

// Снапшот PDF-отчёта прогона: строки локализуются на MainActor, фото качаются заранее —
// рендер (тяжёлый) уходит в Task.detached, как renderPDF бизнес-отчёта.
nonisolated struct AuditPdfRow: @unchecked Sendable {
    let tag: String; let kind: String?; let label: String; let note: String?
}
nonisolated struct AuditPdfSnapshot: @unchecked Sendable {
    let title, meta, scoreLine: String
    let rows: [AuditPdfRow]
    let photos: [Int: UIImage]
}

nonisolated func renderAuditPdf(_ s: AuditPdfSnapshot) -> Data {
    let pageW: CGFloat = 595, pageH: CGFloat = 842, margin: CGFloat = 40
    let contentW = pageW - margin * 2
    let renderer = UIGraphicsPDFRenderer(bounds: CGRect(x: 0, y: 0, width: pageW, height: pageH))
    var pdf = Data()
    // Светлая палитра принудительно — как в renderPDF (тёмная тема делала PDF нечитаемым).
    UITraitCollection(userInterfaceStyle: .light).performAsCurrent {
        pdf = renderer.pdfData { ctx in
            ctx.beginPage()
            var y: CGFloat = margin

            @discardableResult
            func draw(_ str: String, x: CGFloat, atY: CGFloat, size: CGFloat, weight: UIFont.Weight = .regular, color: UIColor = .black, width: CGFloat) -> CGFloat {
                let p = NSMutableParagraphStyle(); p.lineBreakMode = .byWordWrapping
                let attrs: [NSAttributedString.Key: Any] = [.font: UIFont.systemFont(ofSize: size, weight: weight), .foregroundColor: color, .paragraphStyle: p]
                let h = ceil((str as NSString).boundingRect(with: CGSize(width: width, height: .greatestFiniteMagnitude), options: [.usesLineFragmentOrigin], attributes: attrs, context: nil).height)
                (str as NSString).draw(in: CGRect(x: x, y: atY, width: width, height: h), withAttributes: attrs)
                return h
            }

            y += draw(s.title, x: margin, atY: y, size: 17, weight: .bold, width: contentW) + 6
            y += draw(s.meta, x: margin, atY: y, size: 10, color: .darkGray, width: contentW) + 2
            y += draw(s.scoreLine, x: margin, atY: y, size: 10, color: .darkGray, width: contentW) + 10
            UIColor.lightGray.setStroke()
            let sep = UIBezierPath(); sep.move(to: CGPoint(x: margin, y: y)); sep.addLine(to: CGPoint(x: pageW - margin, y: y)); sep.lineWidth = 0.5; sep.stroke()
            y += 14

            for (i, row) in s.rows.enumerated() {
                if y > pageH - 80 { ctx.beginPage(); y = margin }
                let tagColor: UIColor = row.kind == "fail" ? UIColor(red: 0.8, green: 0.16, blue: 0.16, alpha: 1)
                    : row.kind == "pass" ? UIColor(red: 0.12, green: 0.55, blue: 0.27, alpha: 1) : .gray
                draw(row.tag, x: margin, atY: y, size: 10, weight: .bold, color: tagColor, width: 88)
                let labelH = draw(row.label, x: margin + 95, atY: y, size: 11, width: contentW - 95)
                y += max(labelH, 13) + 3
                if let note = row.note, !note.isEmpty {
                    if y > pageH - 60 { ctx.beginPage(); y = margin }
                    y += draw(note, x: margin + 95, atY: y, size: 9, color: .darkGray, width: contentW - 95) + 3
                }
                if let img = s.photos[i] {
                    let h: CGFloat = 90
                    let w = img.size.height > 0 ? min(140, h * img.size.width / img.size.height) : h
                    if y + h > pageH - margin { ctx.beginPage(); y = margin }
                    img.draw(in: CGRect(x: margin + 95, y: y, width: w, height: h))
                    y += h + 6
                }
                y += 7
            }
        }
    }
    return pdf
}

struct AuditShareSheet: UIViewControllerRepresentable {
    let url: URL
    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: [url], applicationActivities: nil)
    }
    func updateUIViewController(_ vc: UIActivityViewController, context: Context) {}
}
struct AuditPdfPayload: Identifiable { let id = UUID(); let url: URL }

/// Отчёт по прогону (ревью Б3): пункты со статусами, комментарии, фото + экспорт PDF.
struct AuditRunReportView: View {
    @Bindable var m: PeopleModel
    let list: ShiftChecklist
    let run: ChecklistCompletion
    @State private var generating = false
    @State private var payload: AuditPdfPayload?

    var body: some View {
        let items = list.itemDetails ?? []
        let state = run.items_state ?? []
        let score = auditRunScore(items, state)
        let pct = score.total > 0 ? Int((Double(score.pass) / Double(score.total) * 100).rounded()) : 0
        NavigationStack {
            ZStack {
                Color.miseBg.ignoresSafeArea()
                ScrollView {
                    VStack(alignment: .leading, spacing: 14) {
                        VStack(spacing: 4) {
                            Text("\(pct)%").font(.system(size: 34, weight: .bold))
                                .foregroundStyle(pct >= 80 ? BrandKit.analytics : pct >= 50 ? BrandKit.stash : BrandKit.menu)
                            Text("\(run.date ?? "—") · \(m.staffName(run.staff_id)) · \(score.pass)/\(score.total)")
                                .font(.system(size: 12)).foregroundStyle(.primary.opacity(0.5))
                        }
                        .frame(maxWidth: .infinity)
                        .padding(16).background(Color.primary.opacity(0.05), in: RoundedRectangle(cornerRadius: 16))

                        VStack(spacing: 0) {
                            ForEach(Array(items.enumerated()), id: \.offset) { i, item in
                                let st: ChecklistItemState? = i < state.count ? state[i] : nil
                                let eff = st?.result ?? (st?.done == true ? "pass" : nil)
                                VStack(alignment: .leading, spacing: 6) {
                                    HStack(alignment: .top, spacing: 10) {
                                        resultTag(eff)
                                        Text(item.label).font(.system(size: 14)).foregroundStyle(.primary)
                                        Spacer(minLength: 0)
                                    }
                                    if let note = st?.note, !note.isEmpty {
                                        Text(note).font(.system(size: 12)).foregroundStyle(.primary.opacity(0.5))
                                    }
                                    if let photo = st?.photo_url, let url = URL(string: photo) {
                                        AsyncImage(url: url) { img in img.resizable().scaledToFill() } placeholder: { Color.primary.opacity(0.08) }
                                            .frame(width: 64, height: 64).clipShape(RoundedRectangle(cornerRadius: 10))
                                    }
                                }
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(.vertical, 12).padding(.horizontal, 14)
                                if i < items.count - 1 { Divider().overlay(Color.primary.opacity(0.07)) }
                            }
                        }
                        .background(Color.primary.opacity(0.05), in: RoundedRectangle(cornerRadius: 16))
                    }
                    .padding(16)
                }
            }
            .navigationTitle(list.title?.isEmpty == false ? list.title! : t("pe.auditReport"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button { export() } label: {
                        if generating { ProgressView().controlSize(.small) }
                        else { Image(systemName: "square.and.arrow.up") }
                    }
                    .disabled(generating)
                }
            }
            .toolbarBackground(Color.miseBg, for: .navigationBar)
        }
        .sheet(item: $payload) { p in AuditShareSheet(url: p.url) }
    }

    private func resultTag(_ eff: String?) -> some View {
        let (label, color): (String, Color) = eff == "pass" ? ("OK", BrandKit.analytics)
            : eff == "fail" ? (t("pe.resultFail"), BrandKit.menu)
            : eff == "na" ? ("N/A", Color.primary.opacity(0.45))
            : (t("pe.notChecked"), Color.primary.opacity(0.45))
        return Text(label).font(.system(size: 10, weight: .bold)).foregroundStyle(color)
            .padding(.horizontal, 7).padding(.vertical, 3)
            .background(color.opacity(0.14), in: RoundedRectangle(cornerRadius: 6))
    }

    private func export() {
        guard !generating else { return }
        generating = true
        let items = list.itemDetails ?? []
        let state = run.items_state ?? []
        let score = auditRunScore(items, state)
        let pct = score.total > 0 ? Int((Double(score.pass) / Double(score.total) * 100).rounded()) : 0
        var rows: [AuditPdfRow] = []
        var photoURLs: [Int: URL] = [:]
        for (i, item) in items.enumerated() {
            let st: ChecklistItemState? = i < state.count ? state[i] : nil
            let eff = st?.result ?? (st?.done == true ? "pass" : nil)
            let tag = eff == "pass" ? "OK" : eff == "fail" ? t("pe.resultFail") : eff == "na" ? "N/A" : t("pe.notChecked")
            rows.append(AuditPdfRow(tag: tag, kind: eff, label: item.label, note: st?.note))
            if let p = st?.photo_url, let u = URL(string: p) { photoURLs[i] = u }
        }
        let snap0 = (
            title: list.title?.isEmpty == false ? list.title! : t("pe.auditReport"),
            meta: "\(run.date ?? "") · \(m.staffName(run.staff_id))",
            scoreLine: "\(t("pe.statsCompletionRate")): \(pct)% (\(score.pass)/\(score.total))"
        )
        Task {
            var photos: [Int: UIImage] = [:]
            for (i, u) in photoURLs {
                if let (data, _) = try? await URLSession.shared.data(from: u), let img = UIImage(data: data) { photos[i] = img }
            }
            let snap = AuditPdfSnapshot(title: snap0.title, meta: snap0.meta, scoreLine: snap0.scoreLine, rows: rows, photos: photos)
            let data = await Task.detached(priority: .userInitiated) { renderAuditPdf(snap) }.value
            let url = FileManager.default.temporaryDirectory.appendingPathComponent("mise-audit-\(Int(Date().timeIntervalSince1970)).pdf")
            if (try? data.write(to: url)) != nil {
                // Как в ReportExportView: даём Task осесть, иначе share-лист не открывается.
                try? await Task.sleep(nanoseconds: 300_000_000)
                payload = AuditPdfPayload(url: url)
            } else {
                m.flash(t("saveFailed", ["err": "pdf"]))
            }
            generating = false
        }
    }
}

/// Камера-онли захват фото (без доступа к галерее) — антифрод-требование для фото-пунктов.
struct CameraCaptureView: UIViewControllerRepresentable {
    let onCapture: (UIImage?) -> Void

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        // На симуляторе камеры нет — деградируем на галерею только для разработки,
        // на реальном устройстве всегда .camera (антифрод: свежее фото, не из архива).
        picker.sourceType = UIImagePickerController.isSourceTypeAvailable(.camera) ? .camera : .photoLibrary
        picker.delegate = context.coordinator
        return picker
    }
    func updateUIViewController(_ uiViewController: UIImagePickerController, context: Context) {}
    func makeCoordinator() -> Coordinator { Coordinator(onCapture: onCapture) }

    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let onCapture: (UIImage?) -> Void
        init(onCapture: @escaping (UIImage?) -> Void) { self.onCapture = onCapture }
        func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            onCapture(info[.originalImage] as? UIImage)
        }
        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) { onCapture(nil) }
    }
}

/// Загрузка фото пункта через серверный прокси (клиент не обращается к Supabase Storage
/// напрямую — тот же принцип, что и /api/db для данных). Контракт:
/// POST /api/storage/audit-photo {restaurant_id, completion_id, item_id, data_base64} -> {url}
func uploadAuditPhoto(image: UIImage, restaurantId: String, completionId: String, itemId: String) async -> String? {
    guard let jpeg = image.jpegData(compressionQuality: 0.7),
          let url = URL(string: API.base + "/api/storage/audit-photo") else { return nil }
    var req = URLRequest(url: url)
    req.httpMethod = "POST"
    req.setValue("application/json", forHTTPHeaderField: "Content-Type")
    let payload: [String: Any] = [
        "restaurant_id": restaurantId, "completion_id": completionId, "item_id": itemId,
        "data_base64": jpeg.base64EncodedString(),
    ]
    req.httpBody = try? JSONSerialization.data(withJSONObject: payload)
    guard let (data, resp) = try? await URLSession.shared.data(for: req),
          let http = resp as? HTTPURLResponse, http.statusCode == 200,
          let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          let urlStr = obj["url"] as? String else { return nil }
    return urlStr
}

/// «Сообщить о проблеме»: опциональное фото + назначение ответственного → задача
/// (staff_tasks), с дедупом против уже открытой задачи по этому же пункту (паттерн
/// SafetyCulture Actions — не плодить дубли).
struct ReportProblemSheet: View {
    @Bindable var m: PeopleModel
    @Environment(\.dismiss) private var dismiss
    let list: ShiftChecklist
    let run: ChecklistCompletion?
    let itemIndex: Int
    let itemLabel: String

    @State private var assignee = ""
    @State private var comment = ""
    @State private var photo: UIImage?
    @State private var showCamera = false
    @State private var saving = false
    @State private var existingTask: StaffTask?

    var body: some View {
        NavigationStack {
            ZStack {
                Color.miseBg.ignoresSafeArea()
                Form {
                    if let existingTask {
                        Section {
                            Text(t("pe.linkExistingTask")).font(.system(size: 13)).foregroundStyle(.primary.opacity(0.6))
                            Text(existingTask.title).font(.system(size: 14, weight: .semibold))
                        }
                    } else {
                        Section(t("pe.assignee")) {
                            Picker(t("pe.assignee"), selection: $assignee) {
                                Text(t("pe.pick")).tag("")
                                ForEach(TASK_ROLE_CODES, id: \.self) { r in Text(checklistRoleLabel(r)).tag("role:" + r) }
                                ForEach(m.dir) { d in Text(d.name).tag(d.id) }
                            }
                        }
                        Section(t("pe.comment")) { TextField(t("pe.comment"), text: $comment, axis: .vertical) }
                        Section {
                            if let photo {
                                Image(uiImage: photo).resizable().scaledToFit().frame(height: 160)
                            }
                            Button { showCamera = true } label: { Label(t("pe.addPhoto"), systemImage: "camera") }
                        }
                    }
                }
                .scrollContentBackground(.hidden)
            }
            .navigationTitle(t("pe.reportProblem")).navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(t("cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(existingTask != nil ? t("pe.openExisting") : t("save")) {
                        if existingTask != nil { dismiss(); return }
                        guard !saving, !assignee.isEmpty else { return }
                        saving = true
                        Task {
                            defer { saving = false }
                            var photoURL: String? = nil
                            if let photo {
                                photoURL = await uploadAuditPhoto(image: photo, restaurantId: m.rid, completionId: run?.id ?? list.id,
                                                                   itemId: (itemIndex < (list.itemDetails?.count ?? 0)) ? list.itemDetails![itemIndex].id : "\(itemIndex)")
                            }
                            _ = await m.createTask(title: itemLabel, desc: comment, assignee: assignee, priority: "high", due: m.todayKey,
                                                    sourceCompletionId: run?.id, sourceItemLabel: itemLabel, photoURL: photoURL)
                            dismiss()
                        }
                    }.disabled(existingTask == nil && (assignee.isEmpty || saving))
                }
            }
            .toolbarBackground(Color.miseBg, for: .navigationBar)
        }
        .sheet(isPresented: $showCamera) { CameraCaptureView { img in showCamera = false; photo = img } }
        .task {
            if !m.tasksLoaded { await m.loadTasks() }
            existingTask = m.openTaskFor(itemLabel: itemLabel)
        }
    }
}

/// Статистика по чек-листам/аудитам за 30 дней — только менеджер/владелец.
struct StatisticsSection: View {
    @Bindable var m: PeopleModel
    @State private var loaded = false
    // Раздельная статистика (audit | shift | walk, 'walk' добавлен Д3 2026-07-30 — до этого
    // восьмёрка вообще не участвовала в статистике): рутина открытия/закрытия размывала «%
    // выполнения» аудитов. Топ нарушений (из задач) — только в сегменте аудитов.
    // initialKind (Д5): открывается из конкретной пилюли хаба — статистика сразу того же типа.
    @State private var kind: String
    @State private var completionPct = 0
    @State private var topViolations: [(String, Int)] = []
    @State private var staffRating: [(String, Int)] = []
    @State private var avgDurationSec = 0
    @State private var runsCount = 0

    init(m: PeopleModel, initialKind: String = "audit") {
        self.m = m
        _kind = State(initialValue: initialKind)
    }

    var body: some View {
        Group {
            if !loaded {
                RowListSkeleton(rows: 3)
            } else {
                VStack(alignment: .leading, spacing: 16) {
                    Picker("", selection: $kind) {
                        Text(t("pe.audits")).tag("audit")
                        Text(t("pe.shiftTab")).tag("shift")
                        Text(t("pe.walks")).tag("walk")
                    }
                    .pickerStyle(.segmented)
                    if completionPct == 0 && topViolations.isEmpty && staffRating.isEmpty && runsCount == 0 {
                        Text(t("pe.statsNoData")).font(.system(size: 15)).foregroundStyle(.primary.opacity(0.4))
                            .frame(maxWidth: .infinity).padding(.top, 40)
                    } else {
                        statsContent
                    }
                }
            }
        }
        .task { await load() }
        .onChange(of: kind) { Task { if kind == "walk" && !m.walksLoaded { await m.loadWalks() }; recompute() } }
    }

    private var statsContent: some View {
                VStack(alignment: .leading, spacing: 16) {
                    if kind == "walk" {
                        HStack(spacing: 10) {
                            statCard(title: t("pe.statsCompletionRate")) {
                                Text("\(completionPct)%").font(.system(size: 26, weight: .bold)).foregroundStyle(PEOPLE_ACCENT)
                            }
                            statCard(title: t("pe.statsAvgDuration")) {
                                Text(fmtStatsElapsed(avgDurationSec)).font(.system(size: 26, weight: .bold)).foregroundStyle(.primary)
                            }
                            statCard(title: t("pe.statsRunsCount")) {
                                Text("\(runsCount)").font(.system(size: 26, weight: .bold)).foregroundStyle(.primary)
                            }
                        }
                    } else {
                        statCard(title: t("pe.statsCompletionRate")) {
                            Text("\(completionPct)%").font(.system(size: 32, weight: .bold)).foregroundStyle(PEOPLE_ACCENT)
                        }
                    }
                    if !topViolations.isEmpty {
                        statCard(title: t("pe.statsTopViolations")) {
                            VStack(alignment: .leading, spacing: 6) {
                                ForEach(Array(topViolations.enumerated()), id: \.offset) { _, row in
                                    HStack {
                                        Text(row.0).font(.system(size: 13)).foregroundStyle(.primary.opacity(0.8))
                                        Spacer()
                                        Text("\(row.1)").font(.system(size: 13, weight: .semibold)).foregroundStyle(BrandKit.menu)
                                    }
                                }
                            }
                        }
                    }
                    if !staffRating.isEmpty {
                        statCard(title: kind == "walk" ? t("pe.walkConductedBy") : t("pe.statsStaffRating")) {
                            VStack(alignment: .leading, spacing: 6) {
                                ForEach(Array(staffRating.enumerated()), id: \.offset) { _, row in
                                    HStack {
                                        Text(row.0).font(.system(size: 13)).foregroundStyle(.primary.opacity(0.8))
                                        Spacer()
                                        Text("\(row.1)%").font(.system(size: 13, weight: .semibold)).foregroundStyle(BrandKit.analytics)
                                    }
                                }
                            }
                        }
                    }
                }
    }

    private func statCard<Content: View>(title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.system(size: 12, weight: .semibold)).foregroundStyle(.primary.opacity(0.5)).kerning(0.3)
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14).background(Color.primary.opacity(0.05), in: RoundedRectangle(cornerRadius: 16))
    }

    private func load() async {
        if !m.clHistoryLoaded { await m.loadChecklistHistory() }
        if !m.tasksLoaded { await m.loadTasks() }
        if !m.walksLoaded { await m.loadWalks() }
        recompute()
        loaded = true
    }

    // Восьмёрка (Д3, 2026-07-30): нет pass/fail/N/A — только done, плюс своя механика
    // (таймер/шагомер), поэтому отдельная ветка вместо effResult-логики ниже.
    private func recomputeWalk() {
        var total = 0, done = 0
        var uncheckedCounts: [String: Int] = [:]
        var staffTotal: [String: Int] = [:], staffDone: [String: Int] = [:]
        var totalDuration = 0
        let byId = Dictionary(uniqueKeysWithValues: m.walkTemplates.map { ($0.id, $0) })
        for run in m.walkRuns {
            guard let cid = run.checklist_id, let template = byId[cid] else { continue }
            let flat = template.flatItems
            let state = run.items_state ?? []
            let staffLabel = m.staffName(run.staff_id)
            for i in flat.indices {
                let on = i < state.count && state[i].done
                total += 1
                staffTotal[staffLabel, default: 0] += 1
                if on { done += 1; staffDone[staffLabel, default: 0] += 1 }
                else { uncheckedCounts[flat[i].label, default: 0] += 1 }
            }
            totalDuration += run.duration_seconds ?? 0
        }
        completionPct = total > 0 ? Int((Double(done) / Double(total) * 100).rounded()) : 0
        topViolations = uncheckedCounts.sorted { $0.value > $1.value }.prefix(5).map { ($0.key, $0.value) }
        staffRating = staffTotal.compactMap { name, tot -> (String, Int)? in
            guard tot > 0, name != "—" else { return nil }
            let pct = Int((Double(staffDone[name] ?? 0) / Double(tot) * 100).rounded())
            return (name, pct)
        }.sorted { $0.1 > $1.1 }
        runsCount = m.walkRuns.count
        avgDurationSec = runsCount > 0 ? totalDuration / runsCount : 0
    }

    private func recompute() {
        if kind == "walk" { recomputeWalk(); return }
        var total = 0, done = 0
        var violationCounts: [String: Int] = [:]
        var staffTotal: [String: Int] = [:], staffDone: [String: Int] = [:]
        for c in m.clHistory {
            guard let cl = m.checklistTitle(c.checklist_id), let items = cl.itemDetails else { continue }
            guard (cl.kind ?? "shift") == kind else { continue }
            let state = c.items_state ?? []
            let staffLabel = m.staffName(c.staff_id)
            for i in items.indices {
                // Оценки Б1: N/A выпадает из знаменателя, pass = выполнено, fail = нет;
                // старые записи без result — по done (бинарная модель).
                let st: ChecklistItemState? = i < state.count ? state[i] : nil
                let eff = st?.result ?? (st?.done == true ? "pass" : nil)
                if eff == "na" { continue }
                total += 1
                staffTotal[staffLabel, default: 0] += 1
                if eff == "pass" {
                    done += 1
                    staffDone[staffLabel, default: 0] += 1
                }
            }
        }
        // Задачи-нарушения не несут kind чек-листа — показываем топ только в сегменте аудитов.
        if kind == "audit" {
            for tsk in m.tasks where tsk.source_item_label != nil {
                violationCounts[tsk.source_item_label!, default: 0] += 1
            }
        }
        completionPct = total > 0 ? Int((Double(done) / Double(total) * 100).rounded()) : 0
        topViolations = violationCounts.sorted { $0.value > $1.value }.prefix(5).map { ($0.key, $0.value) }
        staffRating = staffTotal.compactMap { name, tot -> (String, Int)? in
            guard tot > 0, name != "—" else { return nil }
            let pct = Int((Double(staffDone[name] ?? 0) / Double(tot) * 100).rounded())
            return (name, pct)
        }.sorted { $0.1 > $1.1 }
        runsCount = 0; avgDurationSec = 0
    }
}

private func fmtStatsElapsed(_ seconds: Int) -> String {
    let m = seconds / 60, s = seconds % 60
    return String(format: "%d:%02d", m, s)
}

let CHECKLIST_ROLE_CODES: [String?] = [nil, "kitchen", "bar", "hookah", "waiter", "host", "cleaner"]
let TASK_ROLE_CODES: [String] = ["kitchen", "bar", "hookah", "waiter", "host", "cleaner"]
@MainActor func checklistRoleLabel(_ role: String?) -> String {
    guard let role else { return t("pe.role.general") }
    return t("pe.role." + role)
}

struct ChecklistEditSheet: View {
    @Bindable var m: PeopleModel
    @Environment(\.dismiss) private var dismiss
    @State var edit: ChecklistEdit
    @State private var saving = false

    var body: some View {
        NavigationStack {
            ZStack {
                Color.miseBg.ignoresSafeArea()
                Form {
                    if edit.kind == "audit" {
                        Section(t("pe.auditTitle")) { TextField(t("pe.auditTitle"), text: $edit.title) }
                        Section(t("pe.targetScope")) {
                            Picker(t("pe.targetScope"), selection: $edit.targetScope) {
                                Text(t("pe.targetVenue")).tag("venue")
                                Text(t("pe.targetRole")).tag("role")
                                Text(t("pe.targetStaff")).tag("staff")
                            }.pickerStyle(.segmented)
                            if edit.targetScope == "role" {
                                Picker(t("pe.workshop"), selection: Binding(get: { edit.role ?? "" }, set: { edit.role = $0.isEmpty ? nil : $0 })) {
                                    ForEach(CHECKLIST_ROLE_CODES, id: \.self) { code in Text(checklistRoleLabel(code)).tag(code ?? "") }
                                }
                            } else if edit.targetScope == "staff" {
                                Picker(t("pe.assignee"), selection: Binding(get: { edit.assignedStaffId ?? "" }, set: { edit.assignedStaffId = $0.isEmpty ? nil : $0 })) {
                                    Text(t("pe.pick")).tag("")
                                    ForEach(m.dir) { d in Text(d.name).tag(d.id) }
                                }
                            }
                        }
                        Section(t("pe.recurrenceLabel")) {
                            Picker(t("pe.recurrenceLabel"), selection: $edit.recurrence) {
                                Text(t("pe.recurrenceNone")).tag("none")
                                Text(t("pe.recurrenceDaily")).tag("daily")
                                Text(t("pe.recurrenceWeekly")).tag("weekly")
                                Text(t("pe.recurrenceMonthly")).tag("monthly")
                            }
                            if edit.recurrence == "weekly" {
                                weekdayPicker
                            } else if edit.recurrence == "monthly" {
                                Stepper(t("pe.dayOfMonth") + ": \(edit.recurrenceDayOfMonth)", value: $edit.recurrenceDayOfMonth, in: 1...31)
                            }
                        }
                    } else {
                        Section(t("pe.workshop")) {
                            Picker(t("pe.workshop"), selection: Binding(get: { edit.role ?? "" }, set: { edit.role = $0.isEmpty ? nil : $0 })) {
                                ForEach(CHECKLIST_ROLE_CODES, id: \.self) { code in Text(checklistRoleLabel(code)).tag(code ?? "") }
                            }
                        }
                    }
                    Section(t("pe.items")) {
                        ForEach(edit.items.indices, id: \.self) { i in
                            HStack {
                                TextField(t("pe.itemN", ["n": "\(i + 1)"]), text: $edit.items[i].label)
                                Spacer()
                                // Вес пункта (Б6) — только для разовых аудитов, чек-листы смены без весов.
                                if edit.kind == "audit" {
                                    Stepper(value: $edit.items[i].weight, in: 1...9) {
                                        Text("×\(edit.items[i].weight)").font(.system(size: 12, weight: .semibold)).foregroundStyle(.primary.opacity(0.6))
                                    }.fixedSize()
                                }
                                Button { edit.items[i].photo_required.toggle() } label: {
                                    Image(systemName: edit.items[i].photo_required ? "camera.fill" : "camera")
                                        .font(.system(size: 15))
                                        .foregroundStyle(edit.items[i].photo_required ? PEOPLE_ACCENT : .primary.opacity(0.25))
                                }.buttonStyle(.plain)
                            }
                        }
                        Button { edit.items.append(ChecklistItem(label: "")) } label: { Label(t("pe.moreItem"), systemImage: "plus") }
                    }
                }
                .scrollContentBackground(.hidden)
            }
            .navigationTitle(navTitle).navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(t("cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(t("save")) {
                        guard !saving else { return }
                        saving = true
                        Task {
                            defer { saving = false }
                            // dismiss только на успехе — раньше шторка закрывалась при сбое сети,
                            // весь введённый шаблон терялся без возможности повторить (аудит 2026-08-04).
                            let ok = await m.saveChecklistTemplate(id: edit.listId, role: edit.role, items: edit.items,
                                                           kind: edit.kind, targetScope: edit.targetScope,
                                                           assignedStaffId: edit.assignedStaffId, title: edit.title,
                                                           recurrence: edit.recurrence,
                                                           recurrenceWeekdays: edit.recurrence == "weekly" ? Array(edit.recurrenceWeekdays).sorted() : nil,
                                                           recurrenceDayOfMonth: edit.recurrence == "monthly" ? edit.recurrenceDayOfMonth : nil)
                            if ok { dismiss() }
                        }
                    }.disabled(saving)
                }
            }
            .toolbarBackground(Color.miseBg, for: .navigationBar)
        }
    }

    private var navTitle: String {
        if edit.kind == "audit" { return edit.title.isEmpty ? t("pe.newAuditTemplate") : edit.title }
        return m.clType == "open" ? t("pe.checklistOpenTitle") : t("pe.checklistCloseTitle")
    }

    /// Мультиселект дней недели (0=вс..6=сб на проводе, показываем Пн-Вс для читаемости).
    private var weekdayPicker: some View {
        let order = [1, 2, 3, 4, 5, 6, 0] // Пн..Вс
        return HStack(spacing: 6) {
            ForEach(order, id: \.self) { d in
                let on = edit.recurrenceWeekdays.contains(d)
                Button {
                    if on { edit.recurrenceWeekdays.remove(d) } else { edit.recurrenceWeekdays.insert(d) }
                } label: {
                    Text(weekdayShort(d))
                        .font(.system(size: 12, weight: .semibold))
                        .frame(width: 32, height: 32)
                        .background(Circle().fill(on ? PEOPLE_ACCENT : Color.primary.opacity(0.08)))
                        .foregroundStyle(on ? .white : .primary.opacity(0.6))
                }.buttonStyle(.plain)
            }
        }
        .listRowInsets(EdgeInsets())
        .padding(.vertical, 4)
        .frame(maxWidth: .infinity)
    }
}

/// Короткая подпись дня недели (0=вс..6=сб). Переиспользуй, если такой helper уже есть в проекте —
/// не нашлось, завожу локально под чек-листы.
func weekdayShort(_ d: Int) -> String {
    let keys = ["pe.wdSun", "pe.wdMon", "pe.wdTue", "pe.wdWed", "pe.wdThu", "pe.wdFri", "pe.wdSat"]
    guard d >= 0, d < keys.count else { return "?" }
    return t(keys[d])
}

/// Короткое summary расписания для карточки аудита (не занимает много места).
@MainActor func recurrenceSummary(_ recurrence: String, _ weekdays: [Int]?, _ dayOfMonth: Int?) -> String {
    switch recurrence {
    case "daily": return t("pe.recurrenceDaily")
    case "weekly":
        let days = (weekdays ?? []).sorted().map { weekdayShort($0) }
        return days.isEmpty ? t("pe.recurrenceWeekly") : days.joined(separator: ",")
    case "monthly": return t("pe.dayOfMonthSummary", ["n": "\(dayOfMonth ?? 1)"])
    default: return ""
    }
}

// ChecklistHistorySheet удалена (C7, аудит 2026-08-13/15) — была осиротевшей (0 вызовов) после
// реструктуры 2026-08-13, портирована в ManagerChecklistsModel/ManagerChecklistHistoryList
// (ManagerChecklists.swift) как третий сегмент «История» в Manager→Настройки→Чек-листы.

