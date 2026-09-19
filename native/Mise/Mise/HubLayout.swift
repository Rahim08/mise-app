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
            let known = saved.filter { fallback.contains($0.id) }
            if !known.isEmpty {
                let knownIds = Set(known.map(\.id))
                let missing = fallback.filter { !knownIds.contains($0) }
                    .map { HubItem(id: $0, size: defaultSize(for: $0)) }
                return known + missing
            }
        }
        return fallback.map { HubItem(id: $0, size: defaultSize(for: $0)) }
    }

    static func save(_ items: [HubItem], staffId: String) {
        guard let data = try? JSONEncoder().encode(items) else { return }
        UserDefaults.standard.set(data, forKey: key(staffId))
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

struct HubGridView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    @Binding var editing: Bool

    @State private var order: [HubItem] = []
    // Кто сейчас перетаскивается. В сетке этот тайл остаётся как placeholder, а настоящая
    // карточка летит отдельным overlay-слоем от исходного фрейма. Так reflow соседей не
    // сдвигает сам объект под пальцем.
    @State private var draggingItemID: String?
    @State private var dragTranslation: CGSize = .zero
    @State private var dragTargetIndex: Int?
    @State private var dragOriginFrame: CGRect?
    @State private var tileFrames: [String: CGRect] = [:]
    @State private var stats = HubStatsModel()
    @State private var gridWidth: CGFloat = 0
    // Живой ресайз за уголок: preview держит форму, в которую плитка "перетекла бы" при
    // отпускании — сам массив order (и раскладка) меняется только на .onEnded, чтобы не
    // дёргать layout всей сетки на каждый пиксель драга. Сам тайл при этом визуально
    // растёт/сжимается под пальцем через scaleEffect (см. tile()) — это чистый рендер-слой,
    // соседей по HStack не толкает, поэтому дёшево и не дёргает раскладку на каждый кадр.
    @State private var resizingID: String?
    @State private var resizePreview: HubTileSize?
    @Namespace private var hubNS

    /// Общая пружина для reflow (resize/reorder) — один и тот же профиль везде, чтобы
    /// плитки не "спорили" разными кривыми в одном кадре. Задемпфирована сильнее дефолтной
    /// SwiftUI-пружины: почти без перехлёста — тяжеловесное, а не дёрганое движение.
    private static let reflow = Animation.spring(response: 0.42, dampingFraction: 0.87)

    // Reorder теперь контролируем сами: один DragGesture на плитке, ручка ресайза — отдельный
    // sibling поверх неё. Активная плитка не участвует в matchedGeometryEffect как летящий
    // объект; в layout остаётся только placeholder, поэтому смена строк не дёргает карточку
    // под пальцем.
    var body: some View {
        let rows = packHubRows(order)
        ZStack(alignment: .topLeading) {
            ScrollView {
                VStack(spacing: 10) {
                    ForEach(rows.indices, id: \.self) { i in
                        rowView(rows[i])
                    }
                }
                .background(
                    GeometryReader { g in
                        Color.clear
                            .onAppear { gridWidth = g.size.width }
                            .onChange(of: g.size.width) { _, w in gridWidth = w }
                    }
                )
                .padding(.horizontal, 20).padding(.bottom, 20)
            }

            dragOverlay()
        }
        .coordinateSpace(name: "hubGrid")
        // Жест живёт на корневом контейнере, а не на конкретной плитке. Во время reorder
        // плитка может перейти в другую строку, из-за чего SwiftUI пересоздаёт её subtree и
        // отменяет gesture, прикреплённый к самой плитке. Корень сетки при этом стабилен.
        .simultaneousGesture(hubReorderGesture(), including: .all)
        .onPreferenceChange(HubTileFramesKey.self) { tileFrames = $0 }
        // Скролл гасим во время активного редактирования жестом: ScrollView иначе конкурирует
        // за тот же палец и даёт ощущение рывка/потери захвата.
        .scrollDisabled(draggingItemID != nil || resizingID != nil)
        .onAppear { loadOrder() }
        .onChange(of: app.availableApps) { _, _ in loadOrder() }
        .onChange(of: editing) { _, now in
            if !now {
                // Выход из правки — жёсткий сброс любого зависшего drag/resize состояния
                // (защита от края: если .dropDestination почему-то не отработал).
                draggingItemID = nil
                dragTranslation = .zero
                dragTargetIndex = nil
                dragOriginFrame = nil
                resizingID = nil
                resizePreview = nil
            }
        }
        .task { await refreshStats() }
        .onChange(of: scenePhase) { _, phase in
            guard phase == .active else { return }
            Task { await refreshStats() }
        }
    }

    private func rowView(_ items: [HubItem]) -> some View {
        let spacing: CGFloat = 10
        let unitWidth = gridWidth > spacing * 2 ? (gridWidth - spacing * 2) / 3 : 0
        return HStack(alignment: .top, spacing: spacing) {
            ForEach(items) { item in
                tile(item)
                    .frame(width: unitWidth > 0
                           ? unitWidth * CGFloat(item.size.units) + spacing * CGFloat(item.size.units - 1)
                           : nil)
                    .background(
                        GeometryReader { g in
                            Color.clear.preference(
                                key: HubTileFramesKey.self,
                                value: [item.id: g.frame(in: .named("hubGrid"))]
                            )
                        }
                    )
            }
        }
    }

    /// Минимальная, НЕ фиксированная высота — контент может занять больше места (длинный
    /// перевод, крупная сумма), плитка должна вырасти сама, а не обрезаться/наезжать на
    /// следующий ряд.
    private func tileMinHeight(_ size: HubTileSize) -> CGFloat {
        switch size {
        case .small: return 76
        case .medium: return 76
        case .large: return 150
        }
    }

    // MARK: - плитка

    @ViewBuilder
    private func tile(_ item: HubItem) -> some View {
        if let mod = miseModules[item.id] {
            let isResizing = resizingID == item.id
            let isDragging = draggingItemID == item.id

            let body = tileBody(item, mod: mod, isResizing: isResizing, isDraggingPlaceholder: isDragging, useMatchedGeometry: true)
                .onTapGesture { if !editing { UIImpactFeedbackGenerator(style: .medium).impactOccurred(); app.openApp(item.id) } }
                .simultaneousGesture(
                    LongPressGesture(minimumDuration: 0.4).onEnded { _ in
                        guard !editing else { return }
                        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                        withAnimation(Self.reflow) { editing = true }
                    }
                )

            // Ручка ресайза — САЙБЛИНГ в ZStack, а не .overlay поверх draggable-вью: раньше
            // она была декорацией той же вью-ноды, что и жест переноса, и оба срабатывали на
            // один тач. Отдельный узел дерева — хит-тест на уголок физически не долетает до
            // .draggable ниже (draggable конкурирует за область как обычный interaction, а не
            // как simultaneousGesture, так что более вложенный узел с СВОИМ жестом выигрывает
            // приоритет на свою область без ручных гейтов).
            ZStack(alignment: .topTrailing) {
                body
                if editing {
                    resizeHandle(item).padding(6)
                    if isResizing, let preview = resizePreview {
                        resizeIndicator(preview, color: mod.color)
                            .padding(.top, 8)
                            .padding(.trailing, 44)
                            .allowsHitTesting(false)
                            .transition(.scale.combined(with: .opacity))
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func tileBody(_ item: HubItem, mod: MiseModule, isResizing: Bool, isDraggingPlaceholder: Bool, useMatchedGeometry: Bool) -> some View {
        let activeGesture = draggingItemID != nil || resizingID != nil
        // Small/medium/large меняют не только ширину, но и место в строке. Поэтому во
        // время жеста оставляем текущую форму и меняем её только после отпускания.
        // Иначе контент перескакивает в новый режим раньше самой раскладки.
        let body = tileContent(item, mod: mod)
            .padding(item.size == .large ? 16 : (item.size == .small ? 12 : 14))
            .frame(maxWidth: .infinity, minHeight: tileMinHeight(item.size), maxHeight: .infinity, alignment: .topLeading)
            .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(mod.color.opacity(isDraggingPlaceholder ? 0.045 : 0.10)))
            .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(mod.color.opacity(isResizing ? 0.55 : (isDraggingPlaceholder ? 0.42 : 0.22)), lineWidth: isResizing ? 1.6 : 1))
            .contentShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
            .opacity(isDraggingPlaceholder ? 0.28 : 1)
            // ПРАВКА 2026-08-16 (юзер прислал скриншот: «такая херня» — плитка «размазана»
            // поверх соседей): раньше здесь был scaleEffect(x:,y:) на реальное
            // соотношение target/current units — для перехода small→medium/large это
            // scaleX ≈ 3 (2 юнита → 6) при anchor: .topLeading, т.е. маленький квадратик
            // растягивался в 3 раза по ширине и рисовался мимо своего слота в HStack,
            // наезжая на всё, что справа/снизу. Small↔medium/large — это не плавное
            // изменение размера, а смена ФОРМЫ и членства в ряду (из тройки в full-width
            // строку); честно превью такое трансформом нельзя, только имитировать
            // «живость» без искажения формы — единый лёгкий пульс по центру.
            .scaleEffect(isResizing ? 1.025 : 1, anchor: .center)
            .shadow(color: .black.opacity(isResizing ? 0.22 : 0), radius: 14, y: 8)
            .modifier(WiggleRotation(
                idx: order.firstIndex(where: { $0.id == item.id }) ?? 0,
                size: item.size,
                active: editing && !activeGesture && !reduceMotion
            ))
            .zIndex(isResizing ? 10 : 0)

        if useMatchedGeometry {
            body.matchedGeometryEffect(id: item.id, in: hubNS)
        } else {
            body
        }
    }

    @ViewBuilder
    private func dragOverlay() -> some View {
        if let id = draggingItemID,
           let item = order.first(where: { $0.id == id }),
           let mod = miseModules[id],
           let frame = dragOriginFrame ?? tileFrames[id] {
            tileBody(item, mod: mod, isResizing: false, isDraggingPlaceholder: false, useMatchedGeometry: false)
                .frame(width: frame.width, height: frame.height, alignment: .topLeading)
                .scaleEffect(1.035)
                .shadow(color: .black.opacity(0.28), radius: 18, y: 10)
                .offset(x: frame.minX + dragTranslation.width, y: frame.minY + dragTranslation.height)
                .zIndex(100)
                .allowsHitTesting(false)
        }
    }

    /// Ручка в углу — тащишь по диагонали: вправо-вниз крупнее, влево-вверх мельче. Живой
    /// снап к ближайшей из 3 форм с визуальным индикатором над пальцем И лёгким масштабом самого
    /// тайла (см. scaleEffect в tile()), как при ресайзе виджета на Домашнем экране. Сама
    /// раскладка (order/packHubRows) перекладывается один раз на отпускании — не на каждый
    /// кадр драга, чтобы не дёргать соседние плитки хаотично.
    @ViewBuilder
    private func resizeHandle(_ item: HubItem) -> some View {
        let isActive = resizingID == item.id
        ZStack {
            Circle().fill(.black.opacity(0.38))
            Image(systemName: "arrow.up.left.and.arrow.down.right")
                .font(.system(size: 9, weight: .black)).foregroundStyle(.white)
        }
        .frame(width: 24, height: 24)
        // Видимый кружок остаётся 24pt, но тач-зона расширена до HIG-минимума (~44pt) —
        // маленькая ручка в углу иначе легко промахивается, что читается как «прыгает».
        .contentShape(Circle().inset(by: -10))
        .scaleEffect(isActive ? 1.3 : 1)
        .animation(.spring(response: 0.25, dampingFraction: 0.7), value: resizePreview)
        .highPriorityGesture(
            DragGesture(minimumDistance: 2)
                .onChanged { value in
                    if resizingID != item.id {
                        resizingID = item.id
                        resizePreview = item.size
                        UIImpactFeedbackGenerator(style: .light).impactOccurred()
                    }
                    // Диагональ (width+height) была не откалибрована: чистый диагональный
                    // драг физической длины L даёт width=height=L/√2, значит width+height ≈
                    // 1.41×L — на 41% чувствительнее, чем горизонтальный/вертикальный драг
                    // той же длины (порог 54pt настроен под одну ось). Делим на √2, чтобы
                    // порог был одинаков независимо от угла драга.
                    let delta = (value.translation.width + value.translation.height) / 1.4142135
                    let steps = Int((delta / 54).rounded())
                    let preview = HubTileSize.at(item.size.stepIndex + steps)
                    if preview != resizePreview {
                        resizePreview = preview
                        UISelectionFeedbackGenerator().selectionChanged()
                    }
                }
                .onEnded { _ in
                    if let idx = order.firstIndex(where: { $0.id == item.id }), let preview = resizePreview, preview != order[idx].size {
                        withAnimation(Self.reflow) { order[idx].size = preview }
                        persist()
                    }
                    withAnimation(.spring(response: 0.25, dampingFraction: 0.8)) {
                        resizingID = nil
                        resizePreview = nil
                    }
                }
        )
    }

    private func mod(_ item: HubItem) -> Color { miseModules[item.id]?.color ?? .accentColor }

    private func resizeIndicator(_ selected: HubTileSize, color: Color) -> some View {
        HStack(spacing: 5) {
            ForEach(HubTileSize.ordered, id: \.self) { size in
                RoundedRectangle(cornerRadius: 2, style: .continuous)
                    .fill(size == selected ? color : Color.primary.opacity(0.22))
                    .frame(width: size == .small ? 9 : 18, height: size == .large ? 13 : (size == .medium ? 8 : 9))
            }
        }
        .padding(.horizontal, 7).padding(.vertical, 5)
        .background(.ultraThinMaterial, in: Capsule())
        .overlay(Capsule().strokeBorder(color.opacity(0.28), lineWidth: 1))
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

    // MARK: - drag/reorder/persist

    private func moveItem(_ id: String, to rawIndex: Int) {
        guard let from = order.firstIndex(where: { $0.id == id }) else { return }
        let insertion = min(max(rawIndex, 0), order.count)
        let to = insertion > from ? insertion - 1 : insertion
        guard from != to else { return }
        withAnimation(Self.reflow) {
            let moved = order.remove(at: from)
            order.insert(moved, at: min(max(to, 0), order.count))
        }
        UISelectionFeedbackGenerator().selectionChanged()
    }

    private func hubReorderGesture() -> some Gesture {
        DragGesture(minimumDistance: 8, coordinateSpace: .named("hubGrid"))
            .onChanged { value in
                guard editing, resizingID == nil else { return }
                if draggingItemID == nil {
                    guard let item = item(at: value.startLocation),
                          !isResizeHandle(at: value.startLocation, for: item) else { return }
                    draggingItemID = item.id
                    dragTranslation = .zero
                    dragTargetIndex = order.firstIndex(where: { $0.id == item.id })
                    dragOriginFrame = tileFrames[item.id]
                    UIImpactFeedbackGenerator(style: .light).impactOccurred()
                }
                dragTranslation = value.translation
                guard let id = draggingItemID,
                      let target = insertionIndex(at: value.location, moving: id),
                      target != dragTargetIndex else { return }
                dragTargetIndex = target
                moveItem(id, to: target)
            }
            .onEnded { _ in
                guard draggingItemID != nil else { return }
                persist()
                withAnimation(.spring(response: 0.26, dampingFraction: 0.86)) {
                    draggingItemID = nil
                    dragTranslation = .zero
                    dragTargetIndex = nil
                    dragOriginFrame = nil
                }
            }
    }

    private func item(at point: CGPoint) -> HubItem? {
        order.first { item in
            guard let frame = tileFrames[item.id] else { return false }
            return frame.contains(point)
        }
    }

    private func isResizeHandle(at point: CGPoint, for item: HubItem) -> Bool {
        guard let frame = tileFrames[item.id] else { return false }
        // Визуальный кружок 24pt, но его интерактивная область расширена до 44pt.
        let hitArea = CGRect(x: frame.maxX - 50, y: frame.minY - 6, width: 56, height: 56)
        return hitArea.contains(point)
    }

    private func insertionIndex(at point: CGPoint, moving id: String) -> Int? {
        let visible = order.enumerated().filter { $0.element.id != id }
        guard !visible.isEmpty else { return nil }

        // Сначала выбираем визуальный ряд по вертикали, затем точку вставки по центрам
        // плиток. Старый алгоритм считал любую точку в нижней половине карточки командой
        // «после неё», из-за чего плитки магнитились и перескакивали при движении вбок.
        let rows = packHubRows(order)
        var rowCandidates: [(items: [HubItem], distance: CGFloat)] = []
        for row in rows {
            let frames = row.compactMap { tileFrames[$0.id] }
            guard !frames.isEmpty else { continue }
            let minY = frames.map(\.minY).min() ?? 0
            let maxY = frames.map(\.maxY).max() ?? 0
            let distance: CGFloat = point.y < minY ? minY - point.y : (point.y > maxY ? point.y - maxY : 0)
            rowCandidates.append((row, distance))
        }
        guard let row = rowCandidates.min(by: { $0.distance < $1.distance })?.items else { return nil }

        let visibleRow = row.compactMap { item -> (item: HubItem, index: Int, frame: CGRect)? in
            guard item.id != id,
                  let index = order.firstIndex(where: { $0.id == item.id }),
                  let frame = tileFrames[item.id] else { return nil }
            return (item, index, frame)
        }.sorted { $0.frame.minX < $1.frame.minX }

        for entry in visibleRow where point.x < entry.frame.midX {
            return entry.index
        }
        return (visibleRow.last?.index ?? order.count - 1) + 1
    }

    private func loadOrder() {
        guard let staffId = app.staff?.id else { return }
        order = HubLayoutStore.load(staffId: staffId, fallback: app.availableApps)
    }

    private func persist() {
        guard let staffId = app.staff?.id else { return }
        HubLayoutStore.save(order, staffId: staffId)
    }

    private func refreshStats() async {
        await stats.load(canSeeMoney: app.canSeeMoney, dayStartHour: app.dayStartHour)
    }
}
