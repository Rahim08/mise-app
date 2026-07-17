import SwiftUI

/// Текст с плавно переливающимся градиентом бренда (для буквы «e»).
/// Палитра повторена с периодом (g + g + [g[0]]) — сдвиг ровно на один период
/// бесшовен: не зеркало (без «отката» цвета), а настоящий цикл.
struct FlowingGradientText: View {
    let text: String
    var font: Font

    private var colors: [Color] {
        let g = BrandKit.eGradient
        return g + g + [g[0]]   // период n: colors[i] == colors[i+n] → шва на повторе нет
    }

    var body: some View {
        Text(text)
            .font(font)
            .foregroundStyle(.clear)
            .overlay {
                // Фаза — чистая функция времени (TimelineView), не @State-анимация:
                // state-вариант при пересоздании view (logout→onAppear) наслаивал новую
                // repeatForever-анимацию на старую — «бегущие слова».
                TimelineView(.animation) { timeline in
                    GeometryReader { geo in
                        let w = max(geo.size.width, 1)
                        let period: Double = 6
                        let phase = timeline.date.timeIntervalSinceReferenceDate
                            .truncatingRemainder(dividingBy: period) / period
                        // Ширина 3w, период палитры в пространстве = 1.5w; окно w всегда покрыто.
                        LinearGradient(colors: colors, startPoint: .leading, endPoint: .trailing)
                            .frame(width: w * 3)
                            .offset(x: -w * 1.5 * CGFloat(phase))
                    }
                }
            }
            .mask(Text(text).font(font))
    }
}

/// Вордмарк «mise»: «mis» цветом темы + акцентная «e».
struct Wordmark: View {
    var size: CGFloat = 72
    var color: Color = .primary
    /// true — «e» с фирменным градиентом (плавный диагональный); false — сплошной цвет `accent`.
    var animated: Bool = true
    /// Цвет сплошной «e» (внутри приложения = цвет приложения; в покое — серый бренд).
    var accent: Color = BrandKit.accent

    var body: some View {
        let f = BrandKit.display(size)
        HStack(alignment: .firstTextBaseline, spacing: 0) {
            Text("mis").font(f).foregroundStyle(color)
            if animated {
                FlowingGradientText(text: "e", font: f)
            } else {
                Text("e").font(f).foregroundStyle(accent)
            }
        }
        .kerning(-size * 0.03)
    }
}

/// Заставка приложения.
struct SplashView: View {
    var body: some View {
        ZStack {
            Color.miseBg.ignoresSafeArea()
            Wordmark(size: 56)
        }
    }
}

#Preview {
    SplashView()
}
