import SwiftUI

// Хаб приложений (LauncherView, MainView.swift): плитки можно перетаскивать местами и
// менять размер. Long-press на любую плитку → правка (плитки «трясутся», как иконки на
// springboard). В правке: тащишь плитку целиком — переставляешь; тащишь за ручку в углу —
// меняешь размер (живой снап между 3 формами, как ресайз виджета). Порядок и размер —
// per-сотрудник, хранится локально (UserDefaults), не синхронизируется между устройствами.

enum HubTileSize: String, Codable, CaseIterable {
    case small, medium, large

    /// Small — квадратик, 3 в ряд. Medium и large — ВСЕГДА на всю ширину (6 из 6 единиц
    /// строки), отличаются только высотой: medium — тонкая полоска-строка, large — большой
    /// «квадрат»-герой. Так задумано по правке юзера: не 2 средних плитки бок о бок, а три
    /// чётко разных формы (маленький квадрат / длинная полоска / большой блок).
    var units: Int {
        switch self {
        case .small: return 2
        case .medium, .large: return 6
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

/// Жадная упаковка по строкам (сумма единиц в строке ≤ 6). Medium/large всегда заполняют
/// строку целиком и оказываются в ней одни; small пакуются по 3. Порядок карточек всегда
/// сохраняется (не переставляет ради плотности).
func packHubRows(_ items: [HubItem]) -> [[HubItem]] {
    var rows: [[HubItem]] = []
    var current: [HubItem] = []
    var used = 0
    for item in items {
        let u = item.size.units
        if used + u > 6, !current.isEmpty {
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

struct HubGridView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Binding var editing: Bool

    @State private var order: [HubItem] = []
    // Кто сейчас перетаскивается — только для косметики (притушить исходник, подсказать
    // соседям кого подвинуть). Позицию/перекладку ведёт СИСТЕМА через .draggable/
    // .dropDestination (Transferable, iOS 17+), а не свой DragGesture с офсетом — см. заметку
    // о переделке 2026-08-16 ниже.
    @State private var draggingItemID: String?
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

    // ПЕРЕДЕЛКА 2026-08-16 (юзер-фидбок: «дёрганная», «застревает», «то замирает, то прыгает»
    // — старая реализация ловила это не первым патчем, а системно не работала):
    //
    // Было: свой DragGesture на весь тайл (.simultaneousGesture) + словарь CGRect всех тайлов
    // через PreferenceKey + офсет = dragPoint − center(frames[id]). Три структурных проблемы:
    // 1) .simultaneousGesture на тайле и .gesture на ручке ресайза (её дочерний вью внутри
    //    того же тайла) СРАБАТЫВАЛИ ОДНОВРЕМЕННО на один тач — это буквально смысл
    //    "simultaneous" в SwiftUI. Тащишь за уголок — тайл одновременно думает, что его
    //    перетаскивают целиком (offset улетает к пальцу поверх соседей = «застревает»).
    // 2) onChanged драга стреляет на КАЖДЫЙ тик тача (десятки раз в секунду), каждый раз
    //    перезапуская withAnimation(reflow) поверх ещё не осевшей предыдущей — соседи дёргались
    //    между целями, matchedGeometryEffect никогда не долетал («дёрганная»).
    // 3) Собственный DragGesture теоретически может не долучить .onEnded, если система
    //    перехватит жест (скролл/другой recognizer) — тогда draggingID/dragPoint застревают
    //    навсегда, тайл висит смещённым и не реагирует («замирает»).
    //
    // Стало: перестановка — через .draggable/.dropDestination (Transferable, iOS 17+,
    // Apple's own DnD API, документирован именно для reorder в скроллящихся сетках). Три
    // структурных плюса, а не заплатки: (a) ручка ресайза больше не в том же дерева узле, что
    // .draggable — вынесена сайблингом в ZStack, а не .overlay поверх draggable-вью, так что
    // хит-тест на уголок физически не долетает до drag-интеракции тайла; (b) isTargeted
    // срабатывает по границе (вошёл/вышел из тайла), а НЕ на каждый пиксель тача — реордер
    // сам по себе троттлится геометрией, без ручного дебаунса; (c) состояние — только
    // косметическое (draggingItemID для затемнения), поэтому даже в худшем случае (юзер бросил
    // драг мимо всех тайлов) ничего не «зависает» функционально: скролл/тап продолжают
    // работать, максимум — тайл на секунду останется притушенным до следующего .onChange.
    var body: some View {
        let rows = packHubRows(order)
        ScrollView {
            VStack(spacing: 10) {
                ForEach(rows.indices, id: \.self) { i in
                    rowView(rows[i])
                }
            }
            // Ширину сетки берём один раз через .background (не заставляет VStack
            // растягиваться на весь ScrollView, как это делает GeometryReader в основном
            // потоке layout).
            .background(
                GeometryReader { g in
                    Color.clear
                        .onAppear { gridWidth = g.size.width }
                        .onChange(of: g.size.width) { _, w in gridWidth = w }
                }
            )
            .padding(.horizontal, 20).padding(.bottom, 20)
        }
        // Catch-all на контейнере: если юзер отпускает драг МИМО всех тайлов (пустая зона под
        // последним рядом, между рядами разной ширины) — per-тайловый .dropDestination внутри
        // tile() физически не может сработать (точка вне его границ), draggingItemID навсегда
        // остаётся выставленным → тайл-источник виснет притушенным (opacity .45) до выхода из
        // edit-режима. Юзер это увидел на устройстве как «что-то ломается». Вложенный
        // dropDestination на ScrollView — тот же тип (String), тот же сброс; SwiftUI отдаёт
        // приоритет самому вложенному попаданию (тайл), этот срабатывает только на промахе.
        .dropDestination(for: String.self) { _, _ in
            draggingItemID = nil
            persist()
            return true
        }
        // Скролл гасим только во время ресайза (свой DragGesture на ручке) — reorder теперь
        // системный .draggable внутри ScrollView, это его штатный сценарий использования,
        // насильно гасить скролл под него не нужно (и раньше было лишним источником «дёрганости»).
        .scrollDisabled(resizingID != nil)
        .onAppear { loadOrder() }
        .onChange(of: app.availableApps) { _, _ in loadOrder() }
        .onChange(of: editing) { _, now in
            if !now {
                // Выход из правки — жёсткий сброс любого зависшего drag/resize состояния
                // (защита от края: если .dropDestination почему-то не отработал).
                draggingItemID = nil
                resizingID = nil
                resizePreview = nil
            }
        }
        .task { await stats.load(canSeeMoney: app.canSeeMoney, dayStartHour: app.dayStartHour) }
    }

    private func rowView(_ items: [HubItem]) -> some View {
        let totalUnits = max(items.reduce(0) { $0 + $1.size.units }, 1)
        let spacing: CGFloat = 10
        let totalSpacing = spacing * CGFloat(max(items.count - 1, 0))
        let unitWidth = gridWidth > totalSpacing ? (gridWidth - totalSpacing) / CGFloat(totalUnits) : 0
        return HStack(spacing: spacing) {
            ForEach(items) { item in
                tile(item).frame(width: unitWidth > 0 ? unitWidth * CGFloat(item.size.units) : nil)
            }
        }
    }

    /// Минимальная, НЕ фиксированная высота — контент может занять больше места (длинный
    /// перевод, крупная сумма), плитка должна вырасти сама, а не обрезаться/наезжать на
    /// следующий ряд.
    private func tileMinHeight(_ size: HubTileSize) -> CGFloat {
        switch size {
        case .small: return 76
        case .medium: return 62
        case .large: return 150
        }
    }

    // MARK: - плитка

    @ViewBuilder
    private func tile(_ item: HubItem) -> some View {
        if let mod = miseModules[item.id] {
            let isResizing = resizingID == item.id
            let isDragging = draggingItemID == item.id

            let body = tileContent(item, mod: mod)
                .padding(item.size == .large ? 16 : (item.size == .small ? 12 : 14))
                .frame(maxWidth: .infinity, minHeight: tileMinHeight(item.size), maxHeight: .infinity, alignment: .topLeading)
                .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(mod.color.opacity(0.10)))
                .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(mod.color.opacity(isResizing ? 0.55 : 0.22), lineWidth: isResizing ? 1.6 : 1))
                // Один и тот же id в общем неймспейсе — SwiftUI интерполирует позицию/размер
                // сама при РЕАЛЬНОЙ перекладке (committed resize на .onEnded, reorder на
                // .dropDestination), даже когда плитка перескакивает в другой ряд.
                .matchedGeometryEffect(id: item.id, in: hubNS)
                .contentShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                .opacity(isDragging ? 0.45 : 1)
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
                    active: editing && !isDragging && !isResizing && !reduceMotion
                ))
                .zIndex(isResizing ? 10 : 0)
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
                if editing {
                    body
                        .draggable(item.id) {
                            dragPreview(item, mod: mod)
                                .onAppear { draggingItemID = item.id }
                        }
                        .dropDestination(for: String.self) { _, _ in
                            draggingItemID = nil
                            persist()
                            return true
                        } isTargeted: { targeted in
                            guard targeted, let dragID = draggingItemID, dragID != item.id else { return }
                            moveItem(dragID, before: item.id)
                        }
                } else {
                    body
                }
                if editing { resizeHandle(item).padding(6) }
            }
        }
    }

    /// Компактный «призрак» под пальцем во время переноса — системный drag preview
    /// (Transferable), не сам тайл: не обязан повторять его геометрию 1:1. Цвет модуля вместо
    /// нейтрального .regularMaterial — юзер-фидбок 2026-08-16 «выглядит дёшево»: безликая
    /// серая таблетка не читалась как часть той же карточки, которую тащишь. .fixedSize()
    /// защищает от того, что система предложит превью произвольный размер контейнера.
    private func dragPreview(_ item: HubItem, mod: MiseModule) -> some View {
        HStack(spacing: 8) {
            iconChip(mod, size: 24)
            Text(mod.title).font(.system(size: 14, weight: .bold)).foregroundStyle(.primary)
        }
        .padding(.horizontal, 14).padding(.vertical, 10)
        .background(
            RoundedRectangle(cornerRadius: 16, style: .continuous).fill(.thinMaterial)
                .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(mod.color.opacity(0.22)))
        )
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(mod.color.opacity(0.5), lineWidth: 1))
        .shadow(color: .black.opacity(0.25), radius: 10, y: 4)
        .fixedSize()
    }

    /// Ручка в углу — тащишь по диагонали: вправо-вниз крупнее, влево-вверх мельче. Живой
    /// снап к ближайшей из 3 форм с лейблом (S/M/L) над пальцем И живым масштабом самого
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
        .overlay(alignment: .top) {
            if isActive, let preview = resizePreview {
                Text(preview.label)
                    .font(.system(size: 11, weight: .heavy, design: .rounded)).foregroundStyle(.white)
                    .padding(.horizontal, 8).padding(.vertical, 4)
                    .background(Capsule().fill(mod(item).opacity(0.9)))
                    .offset(y: -26)
                    .transition(.scale.combined(with: .opacity))
            }
        }
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
                    Text(stat).font(.system(size: 13, weight: .semibold, design: .rounded)).foregroundStyle(mod.color).lineLimit(1)
                } else {
                    Image(systemName: "chevron.right").font(.system(size: 11, weight: .bold)).foregroundStyle(.secondary)
                }
            }
        case .large:
            HStack(alignment: .center, spacing: 12) {
                VStack(alignment: .leading, spacing: 3) {
                    iconChip(mod, size: 34)
                    Spacer(minLength: 10)
                    Text(mod.title).font(.system(size: 19, weight: .bold)).foregroundStyle(.primary)
                    Text(t("mod.\(mod.id).sub")).font(.system(size: 12.5)).foregroundStyle(.secondary)
                }
                .frame(maxHeight: .infinity, alignment: .topLeading)
                Spacer(minLength: 8)
                if let stat = statLine(for: mod.id) {
                    Text(stat)
                        .font(.system(size: 30, weight: .heavy, design: .rounded))
                        .foregroundStyle(mod.color)
                        .multilineTextAlignment(.trailing)
                        .lineLimit(2)
                        .minimumScaleFactor(0.55)
                        .frame(maxWidth: 130, alignment: .trailing)
                } else {
                    Image(systemName: mod.symbol)
                        .font(.system(size: 60, weight: .thin))
                        .foregroundStyle(mod.color.opacity(0.16))
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
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
            guard let v = stats.analyticsIncome else { return nil }
            return Money.s(v)
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

    /// Дошёл драг до тайла targetId — переставить перетаскиваемый на его место (соседи сами
    /// сдвигаются под ним/над ним, стандартное поведение springboard-реордера). Вызывается
    /// СИСТЕМОЙ через .dropDestination.isTargeted только на пересечении границы (вошли в
    /// тайл), не на каждый пиксель тача — отдельный ручной троттлинг тут не нужен, геометрия
    /// уже даёт его бесплатно.
    private func moveItem(_ id: String, before targetId: String) {
        guard let from = order.firstIndex(where: { $0.id == id }),
              var to = order.firstIndex(where: { $0.id == targetId }),
              from != to else { return }
        withAnimation(Self.reflow) {
            let moved = order.remove(at: from)
            if from < to { to -= 1 }
            order.insert(moved, at: to)
        }
        UISelectionFeedbackGenerator().selectionChanged()
    }

    private func loadOrder() {
        guard let staffId = app.staff?.id else { return }
        order = HubLayoutStore.load(staffId: staffId, fallback: app.availableApps)
    }

    private func persist() {
        guard let staffId = app.staff?.id else { return }
        HubLayoutStore.save(order, staffId: staffId)
    }
}
