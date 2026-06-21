import SwiftUI

/// Текст с плавно переливающимся градиентом бренда (для буквы «e»).
/// Палитра аналоговая (синий→фиолетовый→розовый) и зеркальная — поэтому переходы
/// мягкие (без резких «полос») и цикл бесшовный (концы совпадают, без шва на повторе).
struct FlowingGradientText: View {
    let text: String
    var font: Font

    @State private var phase: CGFloat = 0

    private var colors: [Color] {
        let g = BrandKit.eGradient
        return g + g.reversed()   // blue→…→pink→…→blue: мягко и без шва
    }

    var body: some View {
        Text(text)
            .font(font)
            .foregroundStyle(.clear)
            .overlay {
                GeometryReader { geo in
                    let w = max(geo.size.width, 1)
                    LinearGradient(colors: colors, startPoint: .leading, endPoint: .trailing)
                        .frame(width: w * 3)
                        .offset(x: -w * 2 * phase)
                }
            }
            .mask(Text(text).font(font))
            .onAppear {
                phase = 0
                withAnimation(.linear(duration: 6).repeatForever(autoreverses: false)) {
                    phase = 1
                }
            }
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
