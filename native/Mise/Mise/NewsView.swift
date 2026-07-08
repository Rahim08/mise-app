import SwiftUI

// MARK: - Mise News — лента объявлений ресторана
//
// Публикуют должностные лица (owner/manager): стоп-лист, нововведения, акции, информация.
// Читают все сотрудники. Подтверждение прочтения не требуется (v1).

private let NW_ACCENT = BrandKit.news

private enum NewsPriority: String, CaseIterable {
    case normal, important, urgent
    /// Вес для сортировки: срочные выше важных, важные выше обычных.
    var rank: Int { switch self { case .urgent: return 2; case .important: return 1; case .normal: return 0 } }
    var color: Color {
        switch self {
        case .normal:    return BrandKit.accent
        case .important: return BrandKit.stash
        case .urgent:    return BrandKit.news
        }
    }
    var label: String {
        switch self {
        case .normal:    return t("nw.pNormal")
        case .important: return t("nw.pImportant")
        case .urgent:    return t("nw.pUrgent")
        }
    }
}

private enum NewsKind: String, CaseIterable {
    case info, stop, promo, update
    var color: Color {
        switch self {
        case .info:   return BrandKit.manager
        case .stop:   return BrandKit.news
        case .promo:  return BrandKit.analytics
        case .update: return BrandKit.stash
        }
    }
    var icon: String {
        switch self {
        case .info:   return "info.circle.fill"
        case .stop:   return "nosign"
        case .promo:  return "tag.fill"
        case .update: return "sparkles"
        }
    }
    var label: String {
        switch self {
        case .info:   return t("nw.kInfo")
        case .stop:   return t("nw.kStop")
        case .promo:  return t("nw.kPromo")
        case .update: return t("nw.kUpdate")
        }
    }
}

@MainActor
@Observable
final class NewsModel {
    let rid: String
    var posts: [NewsPost] = []
    var loading = true
    var toast: String?
    private var lastOK: Date?            // время последнего успешного load — гасим ложный тост

    init(rid: String) { self.rid = rid }

    func flash(_ m: String) {
        toast = m
        Task { try? await Task.sleep(nanoseconds: 2_400_000_000); if toast == m { toast = nil } }
    }

    func load() async {
        loading = true
        defer { loading = false }
        do {
            // Только при успехе перезаписываем — сбой/пустой ответ на refresh не должен стирать данные.
            let rows = try await DB.from("news_posts").select()
                .order("created_at", ascending: false).limit(100).list(NewsPost.self)
            // Важные/срочные закрепляем сверху, внутри уровня — новее выше.
            posts = rows.sorted { a, b in
                let ra = NewsPriority(rawValue: a.priority ?? "normal")?.rank ?? 0
                let rb = NewsPriority(rawValue: b.priority ?? "normal")?.rank ?? 0
                if ra != rb { return ra > rb }
                return (a.created_at ?? "") > (b.created_at ?? "")
            }
            lastOK = Date()
        } catch {
            #if DEBUG
            print("[News] load failed: \(error)")
            #endif
            // Не пугаем тостом, если данные уже есть и только что был успешный показ
            // (гонка publish→pull даёт два load подряд — второй не должен ругаться).
            let recentOK = lastOK.map { Date().timeIntervalSince($0) < 4 } ?? false
            if !posts.isEmpty && !recentOK { flash(t("refreshFailed")) }
        }
    }

    func publish(kind: String, priority: String, title: String?, body: String, author: (String, String)) async {
        let values: [String: Any] = [
            "kind": kind,
            "priority": priority,
            "title": title ?? NSNull(),
            "body": body,
            "created_by": author.0,
            "created_by_name": author.1,
        ]
        try? await DB.from("news_posts").insert(values).run()
        let pfx = priority == "urgent" ? t("nw.pUrgent") + " · " : (priority == "important" ? t("nw.pImportant") + " · " : "")
        let head = pfx + ((title?.isEmpty == false) ? title! : (NewsKind(rawValue: kind)?.label ?? t("nw.post")))
        await Notify.send(type: "news", title: head, body: body,
                          audience: ["all": true], data: ["module": "news"])
        await load()
    }

    func delete(_ p: NewsPost) async {
        try? await DB.from("news_posts").delete().eq("id", p.id).run()
        await load()
    }
}

struct NewsView: View {
    @Environment(AppModel.self) private var app
    @State private var m: NewsModel?
    @State private var showCompose = false
    @State private var pendingDelete: NewsPost?

    var body: some View {
        Group {
            if let m {
                AppTabPage(refresh: { await m.load() }) {
                    if m.loading && m.posts.isEmpty {
                        RowListSkeleton(rows: 4)
                    } else if m.posts.isEmpty {
                        emptyState
                    } else {
                        ForEach(m.posts) { p in
                            SwipeActionRow(trailing: app.isOfficial ? [
                                SwipeAction(label: t("delete"), systemImage: "trash.fill", tint: BrandKit.menu) { pendingDelete = p }
                            ] : []) {
                                NewsCard(p: p, canDelete: app.isOfficial) {
                                    Task { await m.delete(p) }
                                }
                            }
                        }
                    }
                }
                .overlay(alignment: .bottomTrailing) {
                    if app.isOfficial { addButton }
                }
                .overlay(alignment: .bottom) {
                    if let toast = m.toast {
                        Text(toast).font(.system(size: 14, weight: .semibold)).foregroundStyle(.primary)
                            .padding(.horizontal, 18).padding(.vertical, 12)
                            .background(.ultraThinMaterial, in: Capsule())
                            .padding(.bottom, 60)
                            .transition(.move(edge: .bottom).combined(with: .opacity))
                    }
                }
                .animation(.easeInOut(duration: 0.2), value: m.toast)
                .confirmationDialog(t("nw.delete"),
                                    isPresented: Binding(get: { pendingDelete != nil }, set: { if !$0 { pendingDelete = nil } }),
                                    titleVisibility: .visible) {
                    Button(t("delete"), role: .destructive) {
                        if let p = pendingDelete { Task { await m.delete(p) } }; pendingDelete = nil
                    }
                    Button(t("cancel"), role: .cancel) { pendingDelete = nil }
                }
                .sheet(isPresented: $showCompose) {
                    NewsCompose(author: (app.staff?.id ?? "owner", app.staff?.name ?? t("role.owner"))) { kind, priority, title, body in
                        Task { await m.publish(kind: kind, priority: priority, title: title, body: body, author: (app.staff?.id ?? "owner", app.staff?.name ?? t("role.owner"))) }
                    }
                }
            } else {
                NewsSkeleton()
            }
        }
        .tabEdgeSwipe(tabs: ["only"], selection: .constant("only"),
                      onFirstBack: app.availableApps.count > 1 ? { app.backToLauncher() } : nil)
        .task {
            if m == nil, let rid = app.restaurant?.id {
                let model = NewsModel(rid: rid); m = model; await model.load()
            }
        }
    }

    private var emptyState: some View {
        VStack(spacing: 12) {
            Image(systemName: "megaphone.fill").font(.system(size: 32, weight: .light)).foregroundStyle(NW_ACCENT)
            Text(t("nw.empty")).font(.system(size: 16, weight: .semibold)).foregroundStyle(.primary)
            Text(app.isOfficial ? t("nw.emptyHintManager") : t("nw.emptyHint"))
                .font(.system(size: 13)).foregroundStyle(.primary.opacity(0.5)).multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity).padding(.vertical, 40)
    }

    private var addButton: some View {
        Button {
            showCompose = true
            UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        } label: {
            Image(systemName: "square.and.pencil").font(.system(size: 20, weight: .bold)).foregroundStyle(.white)
                .frame(width: 58, height: 58).background(NW_ACCENT, in: Circle())
                .shadow(color: NW_ACCENT.opacity(0.4), radius: 12, y: 4)
        }
        .padding(20)
    }
}

private struct NewsCard: View {
    let p: NewsPost
    let canDelete: Bool
    let onDelete: () -> Void

    private var kind: NewsKind { NewsKind(rawValue: p.kind ?? "info") ?? .info }
    private var priority: NewsPriority { NewsPriority(rawValue: p.priority ?? "normal") ?? .normal }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                HStack(spacing: 4) {
                    Image(systemName: kind.icon).font(.system(size: 11, weight: .bold))
                    Text(kind.label).font(.system(size: 11, weight: .bold))
                }
                .foregroundStyle(kind.color)
                .padding(.horizontal, 8).padding(.vertical, 4)
                .background(kind.color.opacity(0.16), in: Capsule())
                if priority != .normal {
                    HStack(spacing: 4) {
                        Image(systemName: priority == .urgent ? "exclamationmark.2" : "exclamationmark")
                            .font(.system(size: 11, weight: .heavy))
                        Text(priority.label).font(.system(size: 11, weight: .heavy))
                    }
                    .foregroundStyle(priority.color)
                    .padding(.horizontal, 8).padding(.vertical, 4)
                    .background(priority.color.opacity(0.16), in: Capsule())
                }
                Spacer()
                Text(when(p.created_at)).font(.system(size: 11)).foregroundStyle(.primary.opacity(0.4))
                if canDelete {
                    Menu {
                        Button(role: .destructive, action: onDelete) { Label(t("nw.delete"), systemImage: "trash") }
                    } label: {
                        Image(systemName: "ellipsis").font(.system(size: 14, weight: .bold)).foregroundStyle(.primary.opacity(0.4))
                            .frame(width: 28, height: 24)
                    }
                }
            }
            if let title = p.title, !title.isEmpty {
                Text(title).font(.system(size: 16, weight: .bold)).foregroundStyle(.primary)
            }
            if let body = p.body, !body.isEmpty {
                Text(body).font(.system(size: 14)).foregroundStyle(.primary.opacity(0.85))
                    .fixedSize(horizontal: false, vertical: true)
            }
            if let by = p.created_by_name, !by.isEmpty {
                Text(by).font(.system(size: 12)).foregroundStyle(.primary.opacity(0.45))
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(
            priority != .normal
                ? RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(priority.color.opacity(0.7), lineWidth: 1.5)
                : nil
        )
    }

    private func when(_ iso: String?) -> String {
        guard let iso, let d = ISO8601DateFormatter().date(from: iso) ?? flexibleDate(iso) else { return "" }
        let f = DateFormatter(); f.locale = Locale(identifier: I18n.code)
        f.dateFormat = Calendar.current.isDateInToday(d) ? "HH:mm" : "d MMM, HH:mm"
        return f.string(from: d)
    }
    private func flexibleDate(_ s: String) -> Date? {
        let f = DateFormatter(); f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd'T'HH:mm:ss"
        return f.date(from: String(s.prefix(19)))
    }
}

private struct NewsCompose: View {
    let author: (String, String)
    let onPublish: (String, String, String?, String) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var kind = "info"
    @State private var priority = "normal"
    @State private var title = ""
    @State private var message = ""

    var body: some View {
        NavigationStack {
            ZStack {
                Color.miseBg.ignoresSafeArea()
                Form {
                    Section(t("nw.type")) {
                        Picker(t("nw.type"), selection: $kind) {
                            ForEach(NewsKind.allCases, id: \.rawValue) { k in
                                Label(k.label, systemImage: k.icon).tag(k.rawValue)
                            }
                        }.pickerStyle(.menu)
                    }
                    Section(t("nw.priority")) {
                        Picker(t("nw.priority"), selection: $priority) {
                            ForEach(NewsPriority.allCases, id: \.rawValue) { p in
                                Text(p.label).tag(p.rawValue)
                            }
                        }.pickerStyle(.segmented)
                    }
                    Section(t("nw.titleField")) {
                        TextField(t("nw.titlePh"), text: $title)
                    }
                    Section(t("nw.body")) {
                        TextField(t("nw.bodyPh"), text: $message, axis: .vertical).lineLimit(3...10)
                    }
                }
                .scrollContentBackground(.hidden)
                .tint(NW_ACCENT)
            }
            .navigationTitle(t("nw.new")).navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(Color.miseBg, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(t("cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(t("nw.publish")) {
                        let tt = title.trimmingCharacters(in: .whitespacesAndNewlines)
                        let bb = message.trimmingCharacters(in: .whitespacesAndNewlines)
                        onPublish(kind, priority, tt.isEmpty ? nil : tt, bb)
                        dismiss()
                    }
                    .bold()
                    .disabled(message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
        }
    }
}
