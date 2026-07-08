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
/// Устанавливается после входа (AppModel, @MainActor) и читается из View — @MainActor
/// на enum'е реально изолирует доступ, никакого nonisolated(unsafe) не нужно.
@MainActor
enum Money {
    static var symbol = "€"
    // Неразрывный пробел: «1 234,00» не переносится по разделителю тысяч на 2 строки.
    // Формат фиксирован (не зависит от symbol/locale), поэтому форматтер можно кэшировать.
    private static let formatter: NumberFormatter = {
        let f = NumberFormatter()
        f.numberStyle = .decimal
        f.groupingSeparator = "\u{00A0}"
        f.decimalSeparator = ","
        f.minimumFractionDigits = 2
        f.maximumFractionDigits = 2
        return f
    }()
    /// «<symbol>1 500»; отрицательные — «−<symbol>1 500».
    static func s(_ v: Double) -> String {
        // Всегда 2 знака после запятой — как на вебе (app/manager/page.tsx fv).
        // «95,60», «1 500,00». Копейки не теряются и формат единый во всех приложениях.
        let body = formatter.string(from: NSNumber(value: abs(v))) ?? "0"
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

    /// Адаптивный фон: чёрный в тёмной теме, белый в светлой.
    static let miseBg = Color(UIColor.systemBackground)
}

/// Бренд Mise: тёмные glow-иконки приложений + типографический вордмарк «mise»
/// с акцентной «e». Цвета пяти приложений используются в переливающейся «e».
enum BrandKit {
    static let manager   = Color(hex: 0x007aff)
    static let analytics = Color(hex: 0x34c759)
    static let stash     = Color(hex: 0xff9500)
    static let people    = Color(hex: 0x5856d6)
    static let menu      = Color(hex: 0xff2d55)
    static let bookings  = Color(hex: 0x00c7be)
    static let news      = Color(hex: 0xff375f)
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
