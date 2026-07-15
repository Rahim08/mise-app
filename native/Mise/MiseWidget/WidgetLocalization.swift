import Foundation

// MARK: - Widget-only localization
//
// Виджет — отдельный таргет/процесс, у него нет доступа к Mise/Localization.swift
// (тот тянет UIKit/SwiftUI-состояние всего приложения — L10n.applyThemeToWindows() и
// т.п. недопустимы в extension-процессе). Поэтому здесь — минимальный самостоятельный
// словарь с ТОЛЬКО теми ключами, что реально показываются в виджете.
//
// Язык берётся из App Group (kMiseWidgetLangKey), куда его пишет L10n.lang.didSet в
// основном приложении при каждой смене — сам виджет язык не выбирает.

enum WLang: String { case en, ru, it, fr, az, tr, uk, kk }

private func wRow(_ en: String, _ ru: String, _ it: String, _ fr: String, _ az: String, _ tr: String, _ uk: String, _ kk: String) -> [WLang: String] {
    [.en: en, .ru: ru, .it: it, .fr: fr, .az: az, .tr: tr, .uk: uk, .kk: kk]
}

private let WIDGET_STRINGS: [String: [WLang: String]] = [
    "wg.cashTitle":     wRow("Cash of the day", "Касса дня", "Cassa del giorno", "Caisse du jour", "Günün kassası", "Günün kasası", "Каса дня", "Күндізгі касса"),
    "wg.noShift":       wRow("No shift", "Нет смены", "Nessun turno", "Aucun service", "Növbə yoxdur", "Vardiya yok", "Немає зміни", "Ауысым жоқ"),
    "wg.balance":       wRow("Balance", "Остаток", "Saldo", "Solde", "Qalıq", "Bakiye", "Залишок", "Қалдық"),
    "wg.revenue":       wRow("Revenue", "Выручка", "Ricavi", "Recettes", "Gəlir", "Ciro", "Виручка", "Түсім"),
    "wg.expense":       wRow("Expense", "Расход", "Spesa", "Dépense", "Xərc", "Gider", "Витрата", "Шығыс"),
    "wg.cash":          wRow("Cash", "Нал", "Contanti", "Espèces", "Nağd", "Nakit", "Готівка", "Қолма-қол"),
    "wg.card":          wRow("Card", "Карта", "Carta", "Carte", "Kart", "Kart", "Картка", "Карта"),
    "wg.inkassation":   wRow("Collection", "Инкассация", "Incasso", "Encaissement", "İnkassasiya", "Tahsilat", "Інкасація", "Инкассация"),
    "wg.hookahTitle":   wRow("Hookahs of the shift", "Кальяны смены", "Narghilè del turno", "Chichas du service", "Növbənin qəlyanları", "Vardiyanın nargileleri", "Кальяни зміни", "Ауысымның кальяндары"),
    "wg.hookahShort":   wRow("Hookahs", "Кальяны", "Narghilè", "Chichas", "Qəlyanlar", "Nargileler", "Кальяни", "Кальяндар"),
    "wg.bookingsShort": wRow("Bookings", "Брони", "Prenotazioni", "Réservations", "Rezervlər", "Rezervasyonlar", "Броні", "Брондар"),
    "wg.paid":          wRow("paid", "платных", "a pagamento", "payants", "ödənişli", "ücretli", "платних", "ақылы"),
    "wg.free":          wRow("free", "бесплатных", "gratuiti", "gratuits", "pulsuz", "ücretsiz", "безкоштовних", "тегін"),
    "wg.bookingsTitle": wRow("Upcoming bookings", "Ближайшие брони", "Prenotazioni in arrivo", "Réservations à venir", "Yaxın rezervlər", "Yaklaşan rezervasyonlar", "Найближчі броні", "Жақын брондар"),
    "wg.noBookings":    wRow("No bookings", "Броней нет", "Nessuna prenotazione", "Aucune réservation", "Rezerv yoxdur", "Rezervasyon yok", "Броней немає", "Брондар жоқ"),
    "wg.guest":         wRow("Guest", "Гость", "Ospite", "Client", "Qonaq", "Misafir", "Гість", "Қонақ"),
    "wg.guestsShort":   wRow("guests", "гост.", "ospiti", "pers.", "qonaq", "kişi", "гостей", "қонақ"),
    "wg.hookahsShort":  wRow("hookahs", "кальянов", "narghilè", "chichas", "qəlyan", "nargile", "кальянів", "кальян"),
]

enum WidgetI18n {
    static var current: WLang {
        let raw = UserDefaults(suiteName: kMiseAppGroup)?.string(forKey: kMiseWidgetLangKey)
        if let raw, let l = WLang(rawValue: raw) { return l }
        let sys = String(Locale.preferredLanguages.first?.prefix(2).lowercased() ?? "en")
        return WLang(rawValue: sys) ?? .en
    }

    static func t(_ key: String) -> String {
        let lang = current
        let row = WIDGET_STRINGS[key]
        return row?[lang] ?? row?[.en] ?? key
    }
}

func wt(_ key: String) -> String { WidgetI18n.t(key) }
