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
    var onTap: (() -> Void)? = nil           // тап по всему ряду (контент — не Button)
    @ViewBuilder var content: Content

    @State private var offset: CGFloat = 0
    @State private var settled: CGFloat = 0

    private let btnW: CGFloat = 78
    private var trailingW: CGFloat { btnW * CGFloat(trailing.count) }

    var body: some View {
        ZStack {
            // Фон с кнопками: слева — ведущее, справа — trailing. Без alignment на leading —
            // дефолтный .center, чтобы иконка+текст центрировались в растущей зоне при оверпуле,
            // как у trailing (было .leading — контент прилипал слева, пустое место справа).
            HStack(spacing: 0) {
                if let l = leading, offset > 1 {
                    // Каждая кнопка — отдельный полностью скруглённый чип со всех 4 сторон.
                    // Не пытаемся стыковать её со швом контента (там и была дыра) — независимая
                    // скруглённая форма гарантированно не даёт квадратных/дырявых углов нигде.
                    actionLabel(l).frame(width: max(offset, btnW))
                        .background(l.tint)
                        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                    Spacer(minLength: 0)
                } else if offset < -1 {
                    Spacer(minLength: 0)
                    // Полный оверпул (сверх trailingW) растягивает ПОСЛЕДНЮю кнопку — как в Apple:
                    // красная зона расширяется вместе с пальцем, сигналя «отпустишь — удалится».
                    let overpull = fullSwipeTrailing ? max(0, -offset - trailingW) : 0
                    ForEach(Array(trailing.enumerated()), id: \.element.id) { idx, a in
                        let isLast = idx == trailing.count - 1
                        let extra = isLast ? overpull : 0
                        Button { trigger(a) } label: {
                            actionLabel(a).frame(width: btnW + extra)
                        }
                        .buttonStyle(.plain).background(a.tint)
                        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                    }
                }
            }

            // .simultaneousGesture (не .gesture) — голый .gesture поверх Button/суб-кнопок в
            // content крадёт/задерживает их тап (известный SwiftUI-конфликт). onTapGesture
            // весится только когда onTap задан (Bookings — весь ряд открывает редактор);
            // остальные экраны параметр не передают, их суб-кнопки не затронуты.
            // content.clipShape(Rectangle()) — контент (BookingCard и т.п.) сам скруглён по ВСЕМ
            // 4 углам всегда. При свайпе он съезжает офсетом, и его СОБСТВЕННЫЙ скруглённый угол
            // оказывается посреди ряда (на границе с открывшейся кнопкой) — там, где кривая уходит
            // внутрь, видно чёрный/прозрачный фон вместо цвета кнопки (тот самый «пустой уголок»).
            // Квадратим контент здесь — скругление даёт только внешний clipShape ниже + свои
            // угловые маски у кнопок; у внутреннего шва скругляться нечему, шов всегда ровный.
            Group {
                if let onTap {
                    content.clipShape(Rectangle()).offset(x: offset).simultaneousGesture(drag).onTapGesture(perform: onTap)
                } else {
                    content.clipShape(Rectangle()).offset(x: offset).simultaneousGesture(drag)
                }
            }
        }
        // Один clipShape на ОБА слоя (фон-кнопки + контент) вместо двух отдельных — иначе два
        // независимых расчёта одной и той же скруглённой формы дают волосяной зазор по углам
        // (особенно заметно с .ultraThinMaterial: чёрная щель в углу при свайпе до конца).
        // compositingGroup ОБЯЗАТЕЛЕН перед clipShape: без него SwiftUI клипует .ultraThinMaterial
        // отдельным слоем от цветных Button-фонов — маска не берёт материал, угол остаётся квадратным.
        // С compositingGroup весь ZStack сначала сплющивается в один растр, потом обрезается целиком.
        .compositingGroup()
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
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
                // offset уже отфильтрован в onChanged (только горизонтальный жест двигает его) —
                // решаем по нему всегда, без доп. гарда. Раньше при вертикальном завершении жеста
                // (ScrollView перехватывает свайп на полпути) settle() не вызывался — offset
                // замирал недвинутым, строка «зависала» приоткрытой.
                let x = offset
                if let l = leading, x > 110 {
                    UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                    settle(0); fire(l.handler)
                } else if fullSwipeTrailing, let last = trailing.last, x < -(trailingW + 50) {
                    UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                    settle(0); fire(last.handler)
                } else if !trailing.isEmpty, x < -(trailingW * 0.5) {
                    settle(-trailingW)
                } else {
                    settle(0)
                }
            }
    }

    private func trigger(_ a: SwipeAction) {
        // Свайп закрывается со спрингом (не рывком — юзер-фидбек 2026-07-22: «резко отскакивает,
        // дёрганая анимация»). handler откладывается на длительность спринга: если он открывает
        // confirmationDialog (напр. «Удалить»), презентация не должна стартовать, пока offset ещё
        // едет — иначе UIKit берёт transitional anchor строки и рисует диалог как поповер-«пузырь»
        // не на месте (было и с рывком, и с анимацией — дело не в резкости, а в тайминге).
        settle(0); fire(a.handler)
    }
    private func fire(_ handler: @escaping () -> Void) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3, execute: handler)
    }
    private func settle(_ to: CGFloat, animated: Bool = true) {
        settled = to
        if animated {
            withAnimation(.spring(duration: 0.3, bounce: 0.1)) { offset = to }
        } else {
            offset = to
        }
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
                        // Гаптику даёт .sensoryFeedback(.selection, trigger:) на самой вкладке —
                        // здесь её НЕ дублируем (иначе двойной отклик при смене вкладки свайпом).
                        if dx > 0, fromLeft {            // вправо от левого края — назад
                            if idx > 0 {
                                withAnimation(.easeInOut(duration: 0.2)) { selection = tabs[idx - 1] }
                            } else { onFirstBack?() }
                        } else if dx < 0, fromRight {    // влево от правого края — вперёд
                            if idx < tabs.count - 1 {
                                withAnimation(.easeInOut(duration: 0.2)) { selection = tabs[idx + 1] }
                            }
                        }
                    }
            )
    }
}
