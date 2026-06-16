import SwiftUI

/// Надёжный парсер ISO-времени из Supabase (timestamptz с микросекундами и/или зоной).
/// ISO8601DateFormatter без опций спотыкается о дробные секунды → даты были «—».
func parseISO(_ s: String?) -> Date? {
    guard let s, !s.isEmpty else { return nil }
    let iso = ISO8601DateFormatter()
    iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let d = iso.date(from: s) { return d }
    iso.formatOptions = [.withInternetDateTime]
    if let d = iso.date(from: s) { return d }
    let df = DateFormatter(); df.locale = Locale(identifier: "en_US_POSIX")
    for fmt in ["yyyy-MM-dd'T'HH:mm:ss.SSSSSSXXXXX", "yyyy-MM-dd'T'HH:mm:ssXXXXX",
                "yyyy-MM-dd'T'HH:mm:ss.SSSSSS", "yyyy-MM-dd'T'HH:mm:ss", "yyyy-MM-dd"] {
        df.dateFormat = fmt
        if let d = df.date(from: s) { return d }
    }
    return nil
}

/// Валюта заведения. Владелец выбирает её в веб-дашборде (restaurants.currency);
/// нативное приложение только читает символ и подставляет во все суммы.
/// Устанавливается один раз после входа (AppModel) и читается из View (главный поток),
/// поэтому nonisolated(unsafe) безопасен.
enum Money {
    nonisolated(unsafe) static var symbol = "€"
    /// «<symbol>1 500»; отрицательные — «−<symbol>1 500».
    static func s(_ v: Double) -> String {
        let f = NumberFormatter(); f.numberStyle = .decimal; f.groupingSeparator = " "; f.maximumFractionDigits = 0
        let body = f.string(from: NSNumber(value: abs(v))) ?? "0"
        return (v < 0 ? "−" + symbol : symbol) + body
    }
}

extension Color {
    init(hex: UInt, alpha: Double = 1) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xff) / 255,
            green: Double((hex >> 8) & 0xff) / 255,
            blue: Double(hex & 0xff) / 255,
            opacity: alpha
        )
    }
}

/// Бренд Mise: тёмные glow-иконки приложений + типографический вордмарк «mise»
/// с акцентной «e». Цвета пяти приложений используются в переливающейся «e».
enum BrandKit {
    static let manager   = Color(hex: 0x007aff)
    static let analytics = Color(hex: 0x34c759)
    static let stash     = Color(hex: 0xff9500)
    static let people    = Color(hex: 0x5856d6)
    static let menu      = Color(hex: 0xff2d55)
    static let accent    = Color(hex: 0x8e8e93)

    /// Порядок как в иконке/лендинге.
    static let appColors: [Color] = [manager, analytics, stash, people, menu]

    /// Плавный диагональный градиент буквы «e» (синий → фиолетовый → розовый) — как на референсе.
    static let eGradient: [Color] = [
        Color(hex: 0x0a84ff), Color(hex: 0x5e5ce6), Color(hex: 0xbf5af2), Color(hex: 0xff375f),
    ]

    static func display(_ size: CGFloat, _ weight: Font.Weight = .heavy) -> Font {
        .system(size: size, weight: weight, design: .default)
    }
}
