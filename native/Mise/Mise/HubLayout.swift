import SwiftUI

// Хаб приложений (LauncherView, MainView.swift): плитки можно перетаскивать местами и
// менять размер. Long-press на любую плитку → правка (плитки «трясутся», как иконки на
// springboard). В правке: тащишь плитку целиком — переставляешь; тащишь за ручку в углу —
// меняешь размер (живой снап между 3 формами, как ресайз виджета). Порядок и размер —
// per-сотрудник, хранится локально (UserDefaults), не синхронизируется между устройствами.

enum HubTileSize: String, Codable, CaseIterable {
    case small, medium, large

    /// Три размера — это ширина в обычной 3-колоночной сетке: маленький занимает одну
    /// колонку, средний две, большой три. Благодаря этому маленькие плитки можно ставить
    /// рядом со средними, а три маленьких всегда ровно равны одной большой.
    var units: Int {
        switch self {
        case .small: return 1
        case .medium: return 2
        case .large: return 3
        }
    }

    static let ordered: [HubTileSize] = [.small, .medium, .large]
    var stepIndex: Int { Self.ordered.firstIndex(of: self) ?? 0 }
    static func at(_ i: Int) -> HubTileSize { ordered[min(max(i, 0), ordered.count - 1)] }

    var minHeight: CGFloat { self == .large ? 150 : 76 }

    static func resized(from size: HubTileSize, translation: CGSize) -> HubTileSize {
        let delta = (translation.width + translation.height) / CGFloat(2).squareRoot()
        guard delta.isFinite else { return size }
        return at(size.stepIndex + Int(min(2, max(-2, (delta / 54).rounded()))))
    }

    var label: String {
        switch self {
        case .small: return "S"
        case .medium: return "M"
        case .large: return "L"
        }
    }
}

struct HubItem: Identifiable, Codable, Equatable {
    let id: String
    var size: HubTileSize
}

/// Жадная упаковка по строкам (сумма единиц в строке ≤ 3). Порядок карточек всегда
/// сохраняется, но свободное место строки не растягивает соседние плитки.
func packHubRows(_ items: [HubItem]) -> [[HubItem]] {
    var rows: [[HubItem]] = []
    var current: [HubItem] = []
    var used = 0
    for item in items {
        let u = item.size.units
        if used + u > 3, !current.isEmpty {
            rows.append(current)
            current = []
            used = 0
        }
        current.append(item)
        used += u
    }
    if !current.isEmpty { rows.append(current) }
    return rows
}

enum HubLayoutStore {
    private static func key(_ staffId: String) -> String { "mise_hub_layout_\(staffId)" }

    /// Дефолт: Manager — большой блок (открывают каждую смену), Analytics/Stash — строки,
    /// People/Bookings/News — маленькие квадраты в ряд.
    private static func defaultSize(for id: String) -> HubTileSize {
        switch id {
        case "manager": return .large
        case "analytics", "stash": return .medium
        default: return .small
        }
    }

    /// `fallback` — актуальный порядок/состав модулей от AppModel.availableApps (зависит
    /// от роли). Сохранённая раскладка фильтруется по нему: модули без доступа выпадают,
    /// новые (выданные позже) добавляются в конец маленькими плитками.
    static func load(staffId: String, fallback: [String]) -> [HubItem] {
        if let data = UserDefaults.standard.data(forKey: key(staffId)),
           let saved = try? JSONDecoder().decode([HubItem].self, from: data) {
            var seen = Set<String>()
            let known = saved.filter { fallback.contains($0.id) && seen.insert($0.id).inserted }
            if !known.isEmpty {
                let knownIds = Set(known.map(\.id))
                let missing = fallback.reduce(into: [String]()) { if !$0.contains($1) { $0.append($1) } }
                let additions = missing.filter { !knownIds.contains($0) }
                    .map { HubItem(id: $0, size: defaultSize(for: $0)) }
                return known + additions
            }
        }
        var seen = Set<String>()
        return fallback.filter { seen.insert($0).inserted }.map { HubItem(id: $0, size: defaultSize(for: $0)) }
    }

    static func save(_ items: [HubItem], staffId: String) {
        guard let data = try? JSONEncoder().encode(items) else { return }
        UserDefaults.standard.set(data, forKey: key(staffId))
    }
}

struct HubGridGeometry {
    let frames: [String: CGRect]
    let height: CGFloat
}

/// Measured row packing shared by Layout and the regression tests.
func hubGridGeometry(_ items: [HubItem], width proposedWidth: CGFloat, heights: [String: CGFloat], spacing: CGFloat = 10) -> HubGridGeometry {
    let width = proposedWidth.isFinite ? max(0, proposedWidth) : 0
    let gap = min(max(0, spacing), width / 2)
    let unit = max(0, (width - gap * 2) / 3)
    var frames: [String: CGRect] = [:]
    var used = 0, y: CGFloat = 0, rowHeight: CGFloat = 0
    for item in items {
        if used + item.size.units > 3 {
            y += rowHeight + gap; used = 0; rowHeight = 0
        }
        let measured = heights[item.id] ?? item.size.minHeight
        let height = measured.isFinite ? max(item.size.minHeight, measured) : item.size.minHeight
        let frame = CGRect(x: CGFloat(used) * (unit + gap), y: y,
                           width: unit * CGFloat(item.size.units) + gap * CGFloat(item.size.units - 1), height: height)
        frames[item.id] = frame
        rowHeight = max(rowHeight, height); used += item.size.units
    }
    return HubGridGeometry(frames: frames, height: items.isEmpty ? 0 : y + rowHeight)
}

/// Destination geometry stays fixed for the lifetime of a touch. Reflow cannot feed
/// back into hit testing and move a stationary tile again.
struct HubDragSession {
    let id: String
    let items: [HubItem]
    let frames: [String: CGRect]
    let origin: CGRect
    private(set) var destination: Int
    private(set) var translation: CGSize = .zero

    init?(items: [HubItem], frames: [String: CGRect], id: String) {
        guard let index = items.firstIndex(where: { $0.id == id }), let origin = frames[id] else { return nil }
        self.items = items; self.frames = frames; self.id = id; self.origin = origin; destination = index
    }

    var previewItems: [HubItem] {
        guard let item = items.first(where: { $0.id == id }) else { return items }
        var result = items.filter { $0.id != id }
        result.insert(item, at: min(max(0, destination), result.count))
        return result
    }

    mutating func update(at point: CGPoint, translation: CGSize) {
        self.translation = translation
        guard !origin.contains(point) else {
            destination = items.firstIndex(where: { $0.id == id }) ?? 0; return
        }
        let remaining = items.filter { $0.id != id }
        let rows = packHubRows(items).compactMap { row -> [(String, CGRect)]? in
            let entries = row.compactMap { item -> (String, CGRect)? in
                guard item.id != id, let frame = frames[item.id] else { return nil }
                return (item.id, frame)
            }
            return entries.isEmpty ? nil : entries
        }
        guard let row = rows.min(by: { distance(point.y, row: $0) < distance(point.y, row: $1) }) else { return }
        let entries = row.sorted { $0.1.minX < $1.1.minX }
        if point.y < (rows.first?.map { $0.1.minY }.min() ?? 0) { destination = 0; return }
        if point.y > (rows.last?.map { $0.1.maxY }.max() ?? 0) { destination = remaining.count; return }
        for entry in entries where point.x < entry.1.midX {
            destination = remaining.firstIndex(where: { $0.id == entry.0 }) ?? destination; return
        }
        if let last = entries.last, let index = remaining.firstIndex(where: { $0.id == last.0 }) { destination = index + 1 }
    }

    private func distance(_ y: CGFloat, row: [(String, CGRect)]) -> CGFloat {
        let low = row.map { $0.1.minY }.min() ?? 0, high = row.map { $0.1.maxY }.max() ?? 0
        return y < low ? low - y : max(0, y - high)
    }
}

/// Springboard-«тряска» плиток в edit-режиме — время читается через TimelineView, а не через
/// `withAnimation(...repeatForever...)`. ПЕРЕДЕЛКА (юзер-фидбок 2026-08-27: «лагает, когда
/// двигаешь» — воспроизводилось именно во время drag/resize, не в покое): `repeatForever` —
/// это АНИМАЦИЯ в терминах SwiftUI-транзакций, зарегистрированная на тех же вью-узлах, что
/// несут `matchedGeometryEffect` (committed reflow при reorder/resize). Бесконечная implicit-
/// анимация и explicit spring-анимация reflow конкурируют за один и тот же transform-стек —
/// отсюда рывки именно в момент драга. TimelineView просто читает текущее время каждый кадр,
/// это не "Animation" в терминах транзакций — конфликтовать со spring-реflow нечему. Изолирован
/// как отдельный модификатор (не на весь ScrollView) — тикает только для тайлов, у которых
/// `active`, не заставляет пересчитывать layout/статистику всей сетки 60 раз в секунду.
private struct WiggleRotation: ViewModifier {
    let idx: Int
    let size: HubTileSize
    let active: Bool

    // Угол откалиброван per-размер (юзер-фидбок 2026-08-16: «сильно дрожат», «выглядит дёшево»)
    // — константный угол на плитках сильно разной площади даёт разное визуальное смещение
    // углов; амплитуда подобрана так, чтобы смещение угла карточки было примерно одинаковым
    // на всех трёх формах.
    private var base: Double {
        switch size {
        case .small: return 1.5
        case .medium: return 0.6
        case .large: return 0.45
        }
    }
    private var period: Double { 0.26 }
    private var phase: Double { idx % 2 == 0 ? 0 : .pi }

    func body(content: Content) -> some View {
        if active {
            TimelineView(.animation) { timeline in
                let t = timeline.date.timeIntervalSinceReferenceDate
                let angle = sin((t / period) * 2 * .pi + phase) * base
                content.rotationEffect(.degrees(angle), anchor: .center)
            }
        } else {
            content
        }
    }
}

private struct HubTileFramesKey: PreferenceKey {
    static var defaultValue: [String: CGRect] = [:]

    static func reduce(value: inout [String: CGRect], nextValue: () -> [String: CGRect]) {
        value.merge(nextValue(), uniquingKeysWith: { _, new in new })
    }
}

/// Flat identity is retained when a tile moves to another packed row.
private struct HubFlowLayout: Layout {
    let items: [HubItem]

    private func geometry(width: CGFloat, subviews: Subviews) -> HubGridGeometry {
        let widths = hubGridGeometry(items, width: width, heights: [:])
        var heights: [String: CGFloat] = [:]
        for index in subviews.indices where index < items.count {
            let item = items[index]
            heights[item.id] = subviews[index].sizeThatFits(
                ProposedViewSize(width: widths.frames[item.id]?.width, height: nil)).height
        }
        return hubGridGeometry(items, width: width, heights: heights)
    }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? 320
        return CGSize(width: width, height: geometry(width: width, subviews: subviews).height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let layout = geometry(width: bounds.width, subviews: subviews)
        for index in subviews.indices where index < items.count {
            guard let frame = layout.frames[items[index].id] else { continue }
            subviews[index].place(at: CGPoint(x: bounds.minX + frame.minX, y: bounds.minY + frame.minY),
                                  anchor: .topLeading, proposal: ProposedViewSize(frame.size))
        }
    }
}

/// GestureState also resets when UIKit cancels a touch, unlike onEnded alone.
private struct HubTileTouch: ViewModifier {
    let editing: Bool
    let changed: (DragGesture.Value) -> Void
    let ended: (DragGesture.Value) -> Void
    let cancelled: () -> Void
    @GestureState private var touching = false

    func body(content: Content) -> some View {
        // Compensate for UIKit touch slop so adjacent gaps remain scrollable.
        content.contentShape(Rectangle().inset(by: 20)).simultaneousGesture(
            DragGesture(minimumDistance: 8, coordinateSpace: .named("hubGrid"))
                .updating($touching) { _, active, _ in active = true }
                .onChanged(changed).onEnded(ended),
            including: editing ? .all : .subviews
        )
        .onChange(of: touching) { _, active in
            guard !active else { return }
            Task { @MainActor in
                await Task.yield()
                if !touching { cancelled() }
            }
        }
        .onDisappear { cancelled() }
    }
}

struct HubGridView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Binding var editing: Bool
    @State private var order: [HubItem] = []
    @State private var drag: HubDragSession?
    @State private var resizingID: String?
    @State private var resizeStartSize: HubTileSize?
    @State private var resizePreview: HubTileSize?
    @State private var ignoredTouchID: String?
    @State private var sizePickerID: String?
    @State private var tileFrames: [String: CGRect] = [:]
    @State private var stats = HubStatsModel()
    @State private var gridWidth: CGFloat = 0
    private static let reflow = Animation.spring(response: 0.36, dampingFraction: 0.9)
    private var displayedOrder: [HubItem] { drag?.previewItems ?? order }
    private var activeID: String? { drag?.id ?? resizingID }

    var body: some View {
        ZStack(alignment: .topLeading) {
            ScrollView {
                HubFlowLayout(items: displayedOrder) {
                    ForEach(displayedOrder) { item in
                        tile(item)
                            .background(GeometryReader { geometry in
                                Color.clear.preference(key: HubTileFramesKey.self,
                                    value: [item.id: geometry.frame(in: .named("hubGrid"))])
                            })
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .animation(reduceMotion ? nil : Self.reflow, value: displayedOrder)
                .background(GeometryReader { geometry in
                    Color.clear.onAppear { gridWidth = geometry.size.width }
                        .onChange(of: geometry.size.width) { _, width in
                            cancelInteraction(); gridWidth = width
                        }
                })
                .padding(.horizontal, 20).padding(.bottom, 24)
                .contentShape(Rectangle())
            }
            .scrollDisabled(activeID != nil)
            dragOverlay()
        }
        .coordinateSpace(name: "hubGrid")
        .onPreferenceChange(HubTileFramesKey.self) { tileFrames = $0 }
        .onAppear { loadOrder() }
        .onChange(of: app.availableApps) { _, _ in loadOrder() }
        .onChange(of: app.staff?.id) { _, _ in loadOrder() }
        .onChange(of: editing) { _, value in if !value { cancelInteraction(); sizePickerID = nil } }
        .onChange(of: dynamicTypeSize) { _, _ in cancelInteraction() }
        .onDisappear { cancelInteraction() }
        .task { await refreshStats() }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { Task { await refreshStats() } }
            else { cancelInteraction(); sizePickerID = nil }
        }
        .confirmationDialog(t("hub.tileSize"), isPresented: Binding(
            get: { sizePickerID != nil }, set: { if !$0 { sizePickerID = nil } }
        ), titleVisibility: .visible) {
            ForEach(HubTileSize.ordered, id: \.self) { size in
                Button(size.label) {
                    if let id = sizePickerID { setSize(size, for: id) }
                    sizePickerID = nil
                }
            }
            Button(t("cancel"), role: .cancel) { sizePickerID = nil }
        }
    }

    @ViewBuilder private func tile(_ item: HubItem) -> some View {
        if let mod = miseModules[item.id] {
            ZStack(alignment: .topTrailing) {
                tileBody(item, mod: mod, placeholder: drag?.id == item.id)
                    .contentShape(RoundedRectangle(cornerRadius: 18))
                    .gesture(TapGesture().onEnded {
                        UIImpactFeedbackGenerator(style: .medium).impactOccurred(); app.openApp(item.id)
                    }, including: editing ? .subviews : .all)
                    .simultaneousGesture(LongPressGesture(minimumDuration: 0.4).onEnded { _ in
                        guard !editing else { return }
                        UIImpactFeedbackGenerator(style: .medium).impactOccurred(); editing = true
                    }, including: editing ? .subviews : .all)
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel(mod.title)
                    .accessibilityValue(editing ? item.size.label : (statLine(for: item.id) ?? ""))
                    .accessibilityAddTraits(.isButton)
                    .accessibilityIdentifier("hub-tile-" + item.id)
                    .accessibilityAction {
                        if editing { sizePickerID = item.id } else { app.openApp(item.id) }
                    }
                    .accessibilityActions {
                        if editing {
                            Button(t("hub.moveEarlier")) { move(item.id, by: -1) }
                            Button(t("hub.moveLater")) { move(item.id, by: 1) }
                        }
                    }
                if editing {
                    ZStack {
                        Circle().fill(.black.opacity(0.38)).frame(width: 24, height: 24)
                        if resizingID == item.id, let preview = resizePreview {
                            Text(preview.label).font(.system(size: 11, weight: .bold)).foregroundStyle(.white)
                        } else {
                            Image(systemName: "arrow.up.left.and.arrow.down.right")
                                .font(.system(size: 10, weight: .black)).foregroundStyle(.white)
                        }
                    }
                    .frame(width: 44, height: 44)
                    .contentShape(Rectangle())
                    .onTapGesture { guard activeID == nil else { return }; sizePickerID = item.id }
                    .accessibilityLabel(t("hub.tileSize") + " · " + mod.title)
                    .accessibilityValue(item.size.label)
                    .accessibilityAddTraits(.isButton)
                    .accessibilityIdentifier("hub-resize-" + item.id)
                    .accessibilityAction { sizePickerID = item.id }
                    .accessibilityAdjustableAction { direction in
                        let step = direction == .increment ? 1 : -1
                        setSize(.at(item.size.stepIndex + step), for: item.id)
                    }
                    .padding(2)
                }
            }
            .modifier(HubTileTouch(editing: editing,
                changed: { changeTouch($0, itemID: item.id) },
                ended: { endTouch($0, itemID: item.id) },
                cancelled: { cancelTouch(item.id) }))
        }
    }

    private func tileBody(_ item: HubItem, mod: MiseModule, placeholder: Bool) -> some View {
        tileContent(item, mod: mod)
            .padding(item.size == .large ? 16 : (item.size == .small ? 12 : 14))
            .frame(maxWidth: .infinity, minHeight: item.size.minHeight, maxHeight: .infinity, alignment: .topLeading)
            .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(mod.color.opacity(placeholder ? 0.045 : 0.10)))
            .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous)
                .strokeBorder(mod.color.opacity(resizingID == item.id ? 0.55 : (placeholder ? 0.42 : 0.22)), lineWidth: resizingID == item.id ? 1.6 : 1))
            .opacity(placeholder ? 0.28 : 1)
            .modifier(WiggleRotation(idx: order.firstIndex(where: { $0.id == item.id }) ?? 0,
                size: item.size, active: editing && activeID == nil && !reduceMotion))
    }

    @ViewBuilder private func dragOverlay() -> some View {
        if let drag, let item = order.first(where: { $0.id == drag.id }), let mod = miseModules[item.id] {
            tileBody(item, mod: mod, placeholder: false)
                .frame(width: drag.origin.width, height: drag.origin.height)
                .shadow(color: .black.opacity(0.28), radius: 16, y: 8)
                .offset(x: drag.origin.minX + drag.translation.width, y: drag.origin.minY + drag.translation.height)
                .allowsHitTesting(false).accessibilityHidden(true).zIndex(100)
        }
    }

    /// Три формы — три разных смысла, не одно и то же содержимое в разных обёртках:
    /// - small: только опознать и открыть — иконка+имя, БЕЗ данных, отцентрованы (не
    ///   прижаты в угол — юзер-фидбок 2026-08-16: «сдвинута слева, справа пустота»);
    /// - medium: тонкая строка-статус — имя + одна компактная цифра инлайном (или шеврон,
    ///   если для модуля пока нечего показать) — читается на бегу, как строка в списке;
    ///   без подписи, места на неё в узкой полоске нет;
    /// - large: две колонки на всю ширину — слева иконка+имя+подпись, справа КРУПНАЯ
    ///   герой-цифра (а не довесок под текстом, как раньше — при полной ширине тайла текст
    ///   слева оставлял голую пустоту справа). Если цифры для модуля пока нет — не пустое
    ///   место, а крупная полупрозрачная иконка-водяной знак справа (общий приём хиро-карточек
    ///   вроде Apple Card/банковских виджетов — заполняет объём без выдуманных данных).
    @ViewBuilder
    private func tileContent(_ item: HubItem, mod: MiseModule) -> some View {
        switch item.size {
        case .small:
            VStack(spacing: 8) {
                iconChip(mod, size: 34)
                Text(mod.title).font(.system(size: 12.5, weight: .bold)).foregroundStyle(.primary).lineLimit(1)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .medium:
            HStack(spacing: 12) {
                iconChip(mod, size: 30)
                Text(mod.title).font(.system(size: 15, weight: .bold)).foregroundStyle(.primary).lineLimit(1)
                Spacer(minLength: 8)
                if let stat = statLine(for: mod.id) {
                    Text(statDisplay(stat))
                        .font(.system(size: 13, weight: .semibold, design: .rounded))
                        .foregroundStyle(mod.color)
                        .lineLimit(1)
                        .minimumScaleFactor(0.78)
                } else {
                    Image(systemName: "chevron.right").font(.system(size: 11, weight: .bold)).foregroundStyle(.secondary)
                }
            }
        case .large:
            HStack(alignment: .center, spacing: 12) {
                VStack(alignment: .leading, spacing: 3) {
                    iconChip(mod, size: 34)
                    Spacer(minLength: 10)
                    Text(mod.title).font(.system(size: 19, weight: .bold)).foregroundStyle(.primary).lineLimit(1)
                    Text(t("mod.\(mod.id).sub")).font(.system(size: 12.5)).foregroundStyle(.secondary).lineLimit(1)
                }
                .frame(maxHeight: .infinity, alignment: .topLeading)
                .layoutPriority(0)
                Spacer(minLength: 8)
                if let stat = statLine(for: mod.id) {
                    Text(statDisplay(stat))
                        .font(.system(size: 28, weight: .heavy, design: .rounded))
                        .foregroundStyle(mod.color)
                        .multilineTextAlignment(.trailing)
                        .lineLimit(1)
                        .minimumScaleFactor(0.62)
                        .monospacedDigit()
                        .layoutPriority(2)
                        .frame(minWidth: 142, maxWidth: .infinity, alignment: .trailing)
                } else {
                    Image(systemName: mod.symbol)
                        .font(.system(size: 60, weight: .thin))
                        .foregroundStyle(mod.color.opacity(0.16))
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private func statDisplay(_ value: String) -> String {
        guard value.hasPrefix(Money.symbol) || value.hasPrefix("−" + Money.symbol) else { return value }
        return value.replacingOccurrences(of: Money.symbol, with: Money.symbol + "\u{2060}", options: [], range: value.startIndex..<value.endIndex)
    }

    private func iconChip(_ mod: MiseModule, size: CGFloat) -> some View {
        ZStack {
            RoundedRectangle(cornerRadius: size * 0.32, style: .continuous).fill(mod.color.opacity(0.18))
            Image(systemName: mod.symbol).font(.system(size: size * 0.46)).foregroundStyle(mod.color)
        }
        .frame(width: size, height: size)
    }

    /// Только реальные, уже посчитанные цифры (без заглушек): касса/статус смены и
    /// ближайшая бронь берутся из тех же лёгких запросов, что и виджет
    /// (WidgetSnapshot.swift), склад/люди/новости — свои короткие запросы (HubStats.swift).
    /// Если данных ещё нет или показывать нечего — просто пусто.
    private func statLine(for id: String) -> String? {
        switch id {
        case "manager":
            guard let open = stats.managerOpen else { return nil }
            return open ? t("hub.stat.shiftOpen") : t("hub.stat.shiftClosed")
        case "analytics":
            guard app.canSeeMoney else { return nil }
            return Money.s(stats.analyticsIncome ?? 0)
        case "stash":
            guard let n = stats.stashLowCount, n > 0 else { return nil }
            return "\(n) \(t("hub.stat.lowStock"))"
        case "people":
            guard let n = stats.peopleOnShift else { return nil }
            return "\(n) \(t("hub.stat.onShift"))"
        case "bookings":
            guard let time = stats.nextBookingTime, !time.isEmpty else { return nil }
            return time
        case "news":
            let n = app.notifs.filter { $0.type == "news" && $0.read_at == nil }.count
            guard n > 0 else { return nil }
            return "\(n) \(t("hub.stat.unreadNews"))"
        default:
            return nil
        }
    }


    private func changeTouch(_ value: DragGesture.Value, itemID: String) {
        guard editing, scenePhase == .active, ignoredTouchID != itemID else { return }
        if activeID == nil {
            guard let item = order.first(where: { $0.id == itemID }), let frame = tileFrames[itemID], frame.contains(value.startLocation) else { return }
            let handle = CGRect(x: frame.maxX - 48, y: frame.minY, width: 48, height: 48)
            if handle.contains(value.startLocation) {
                resizingID = itemID; resizeStartSize = item.size; resizePreview = item.size
            } else { drag = HubDragSession(items: order, frames: tileFrames, id: itemID) }
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
        }
        if var session = drag, session.id == itemID {
            let old = session.destination
            session.update(at: value.location, translation: value.translation); drag = session
            if old != session.destination { UISelectionFeedbackGenerator().selectionChanged() }
        } else if resizingID == itemID, let start = resizeStartSize {
            let preview = HubTileSize.resized(from: start, translation: value.translation)
            if resizePreview != preview { resizePreview = preview; UISelectionFeedbackGenerator().selectionChanged() }
        }
    }

    private func endTouch(_ value: DragGesture.Value, itemID: String) {
        guard editing, ignoredTouchID != itemID else { cancelTouch(itemID); return }
        if var session = drag, session.id == itemID {
            session.update(at: value.location, translation: value.translation)
            let result = session.previewItems
            clearInteraction()
            if result != order { order = result; persist() }
        } else if resizingID == itemID, let start = resizeStartSize {
            let size = HubTileSize.resized(from: start, translation: value.translation)
            clearInteraction(); setSize(size, for: itemID)
        }
    }

    private func clearInteraction() {
        drag = nil; resizingID = nil; resizeStartSize = nil; resizePreview = nil
    }

    private func cancelInteraction() {
        if let id = activeID { ignoredTouchID = id }
        clearInteraction()
    }

    private func cancelTouch(_ id: String) {
        if activeID == id { clearInteraction() }
        if ignoredTouchID == id { ignoredTouchID = nil }
    }

    private func setSize(_ size: HubTileSize, for id: String) {
        guard editing, activeID == nil, let index = order.firstIndex(where: { $0.id == id }), order[index].size != size else { return }
        order[index].size = size; persist(); UISelectionFeedbackGenerator().selectionChanged()
    }

    private func move(_ id: String, by step: Int) {
        guard editing, activeID == nil, let index = order.firstIndex(where: { $0.id == id }) else { return }
        let target = min(max(0, index + step), order.count - 1)
        guard index != target else { return }
        let item = order.remove(at: index); order.insert(item, at: target); persist()
    }

    private func loadOrder() {
        cancelInteraction(); sizePickerID = nil; tileFrames = [:]
        guard let staffID = app.staff?.id else { order = []; return }
        order = HubLayoutStore.load(staffId: staffID, fallback: app.availableApps)
    }

    private func persist() {
        guard let staffID = app.staff?.id else { return }
        HubLayoutStore.save(order, staffId: staffID)
    }

    private func refreshStats() async {
        await stats.load(canSeeMoney: app.canSeeMoney, dayStartHour: app.dayStartHour)
    }
}
