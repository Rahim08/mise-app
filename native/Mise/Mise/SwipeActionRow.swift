import SwiftUI

// MARK: - SwipeActionRow — свайп-действия в стиле WhatsApp для строк в ScrollView
//
// `.swipeActions` работает только в List; наши списки — ScrollView+ForEach, поэтому
// делаем кастомный жест: свайп вправо = ведущее действие (коммит сразу), свайп влево —
// неполный открывает кнопки справа, полный сразу запускает последнее (обычно «Удалить»).
// Тап по контенту проходит насквозь (например, открыть редактирование).

struct SwipeAction: Identifiable {
    let id = UUID()
    let label: String
    let systemImage: String
    let tint: Color
    let handler: () -> Void
}

struct SwipeActionRow<Content: View>: View {
    var leading: SwipeAction? = nil          // свайп вправо (зелёное, мгновенно)
    var trailing: [SwipeAction] = []         // свайп влево (порядок слева→направо)
    var fullSwipeTrailing: Bool = true       // полный свайп влево запускает последнее действие
    @ViewBuilder var content: Content

    @State private var offset: CGFloat = 0
    @State private var settled: CGFloat = 0

    private let btnW: CGFloat = 78
    private var trailingW: CGFloat { btnW * CGFloat(trailing.count) }

    var body: some View {
        ZStack {
            // Фон с кнопками: слева — ведущее, справа — trailing.
            HStack(spacing: 0) {
                if let l = leading, offset > 1 {
                    actionLabel(l).frame(width: max(offset, btnW), alignment: .leading)
                        .background(l.tint)
                    Spacer(minLength: 0)
                } else if offset < -1 {
                    Spacer(minLength: 0)
                    ForEach(trailing) { a in
                        Button { trigger(a) } label: {
                            actionLabel(a).frame(width: btnW)
                        }
                        .buttonStyle(.plain).background(a.tint)
                    }
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))

            content
                .offset(x: offset)
                .gesture(drag)
        }
    }

    private func actionLabel(_ a: SwipeAction) -> some View {
        VStack(spacing: 4) {
            Image(systemName: a.systemImage).font(.system(size: 17, weight: .bold))
            Text(a.label).font(.system(size: 11, weight: .semibold)).lineLimit(1)
        }
        .foregroundStyle(.white)
        .frame(maxHeight: .infinity)
        .padding(.horizontal, 10)
    }

    private var drag: some Gesture {
        DragGesture(minimumDistance: 16)
            .onChanged { v in
                // Реагируем только на явный горизонтальный жест (не мешаем вертикальному скроллу).
                guard abs(v.translation.width) > abs(v.translation.height) else { return }
                var x = settled + v.translation.width
                if leading == nil { x = min(x, 0) }
                if trailing.isEmpty { x = max(x, 0) }
                offset = min(max(x, -(trailingW + 90)), 150)
            }
            .onEnded { v in
                guard abs(v.translation.width) > abs(v.translation.height) || settled != 0 else { return }
                let x = offset
                if let l = leading, x > 110 {
                    UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                    settle(0); l.handler()
                } else if fullSwipeTrailing, let last = trailing.last, x < -(trailingW + 50) {
                    UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                    settle(0); last.handler()
                } else if !trailing.isEmpty, x < -(trailingW * 0.5) {
                    settle(-trailingW)
                } else {
                    settle(0)
                }
            }
    }

    private func trigger(_ a: SwipeAction) {
        settle(0); a.handler()
    }
    private func settle(_ to: CGFloat) {
        settled = to
        withAnimation(.spring(duration: 0.3, bounce: 0.1)) { offset = to }
    }
}

// MARK: - Краевой свайп переключения вкладок (сохраняет нативный liquid-glass таб-бар)
//
// Свайп от ЛЕВОГО края вправо → предыдущая вкладка (или в хаб с первой); от ПРАВОГО
// края влево → следующая. Краевые зоны не пересекаются со свайпами строк (их тянут от
// середины) и с горизонтальными контролами (календарь/графики) — поэтому без конфликтов.

extension View {
    func tabEdgeSwipe(tabs: [String], selection: Binding<String>, onFirstBack: (() -> Void)? = nil) -> some View {
        modifier(TabEdgeSwipe(tabs: tabs, selection: selection, onFirstBack: onFirstBack))
    }
}

struct TabEdgeSwipe: ViewModifier {
    let tabs: [String]
    @Binding var selection: String
    var onFirstBack: (() -> Void)?
    @State private var width: CGFloat = 1

    func body(content: Content) -> some View {
        content
            .background(GeometryReader { g in
                Color.clear
                    .onAppear { width = g.size.width }
                    .onChange(of: g.size.width) { _, w in width = w }
            })
            .simultaneousGesture(
                DragGesture(minimumDistance: 24)
                    .onEnded { v in
                        let dx = v.translation.width, dy = v.translation.height
                        guard abs(dx) > 55, abs(dx) > abs(dy) * 1.6 else { return }
                        let fromLeft = v.startLocation.x < 40
                        let fromRight = v.startLocation.x > width - 40
                        let idx = tabs.firstIndex(of: selection) ?? 0
                        if dx > 0, fromLeft {            // вправо от левого края — назад
                            if idx > 0 {
                                UISelectionFeedbackGenerator().selectionChanged()
                                withAnimation(.easeInOut(duration: 0.2)) { selection = tabs[idx - 1] }
                            } else { onFirstBack?() }
                        } else if dx < 0, fromRight {    // влево от правого края — вперёд
                            if idx < tabs.count - 1 {
                                UISelectionFeedbackGenerator().selectionChanged()
                                withAnimation(.easeInOut(duration: 0.2)) { selection = tabs[idx + 1] }
                            }
                        }
                    }
            )
    }
}
