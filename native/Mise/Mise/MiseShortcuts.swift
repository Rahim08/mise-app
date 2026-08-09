import AppIntents
import WidgetKit

// MARK: - Siri / Spotlight / App Shortcuts
//
// Читают последний снимок из App Group (без сети). Для обнаружения Siri
// AppShortcutsProvider должен компилироваться в основной таргет приложения —
// см. README.md (членство WidgetShared.swift + этого файла в обоих таргетах).
//
// Локализация здесь двух родов:
// - title/description/shortTitle — `static var` протокола AppIntent/AppShortcutsProvider.
//   AppIntents metadata compiler требует буквальный string-литерал в месте объявления
//   (не вызов функции), поэтому эти строки — фиксированный английский литерал; видны
//   только в приложении Shortcuts, не спикаются Siri.
// - dialog-текст внутри perform() — тело @MainActor, там t()/L10n доступны напрямую.
// - phrases (фразы распознавания Siri) — Siri слушает на языке СИСТЕМЫ/Siri устройства, а не
//   на выбранном в приложении языке, поэтому перечислены литералами на всех 8 языках продукта —
//   иначе распознавание работало только при системном Siri на русском или английском.

/// «Выручка сегодня» — Siri зачитывает кассу дня из снимка.
struct RevenueTodayIntent: AppIntent {
    static var title: LocalizedStringResource = "Today's revenue"
    static var description: IntentDescription = IntentDescription("Today's cash from the latest widget snapshot.")

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        let snap = MiseSnapshotStore.read() ?? MiseSnapshot()
        guard snap.cashAvailable else {
            return .result(dialog: IntentDialog(stringLiteral: t("sc.revenueNoShift")))
        }
        let income = SnapMoney.s(snap.cashIncome, symbol: snap.currencySymbol)
        let closing = SnapMoney.s(snap.cashClosing, symbol: snap.currencySymbol)
        let dialog = t("sc.revenueDialog", ["income": income, "closing": closing])
        return .result(dialog: IntentDialog(stringLiteral: dialog))
    }
}

/// «Брони сегодня» — Siri зачитывает ближайшую бронь.
struct NextBookingIntent: AppIntent {
    static var title: LocalizedStringResource = "Today's bookings"
    static var description: IntentDescription = IntentDescription("Nearest booking from the latest widget snapshot.")

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        let snap = MiseSnapshotStore.read() ?? MiseSnapshot()
        guard let b = snap.bookings.first else {
            return .result(dialog: IntentDialog(stringLiteral: t("sc.bookingNone")))
        }
        let extra = b.table.isEmpty ? "" : t("sc.bookingDialogTable", ["table": b.table])
        let dialog = t("sc.bookingDialog", [
            "time": b.time, "guest": b.guest, "party": String(b.party),
            "extra": extra, "count": String(snap.bookings.count),
        ])
        return .result(dialog: IntentDialog(stringLiteral: dialog))
    }
}

/// «Открой смену» — открывает приложение на вкладке Manager.
struct OpenShiftIntent: AppIntent {
    static var title: LocalizedStringResource = "Open shift"
    static var description: IntentDescription = IntentDescription("Opens Mise on the shift screen.")

    @MainActor
    func perform() async throws -> some IntentResult & OpensIntent {
        return .result(opensIntent: OpenManagerIntent())
    }
}

/// Внутренний intent для навигации на Manager.
struct OpenManagerIntent: AppIntent {
    static var title: LocalizedStringResource = "Open Manager"
    func perform() async throws -> some IntentResult {
        NotificationCenter.default.post(name: .quickAction, object: "com.rahim.mise.openManager")
        return .result()
    }
}

/// «Сколько броней» — Siri зачитывает количество броней из снимка.
struct BookingCountIntent: AppIntent {
    static var title: LocalizedStringResource = "Booking count"
    static var description: IntentDescription = IntentDescription("Today's booking count from the widget.")

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        let snap = MiseSnapshotStore.read() ?? MiseSnapshot()
        let count = snap.bookings.count
        if count == 0 {
            return .result(dialog: IntentDialog(stringLiteral: t("sc.bookingNone")))
        }
        let next = snap.bookings.first!
        let extra = next.table.isEmpty ? "" : t("sc.bookingDialogTable", ["table": next.table])
        let dialog = t("sc.countDialog", ["count": String(count), "time": next.time, "guest": next.guest, "extra": extra])
        return .result(dialog: IntentDialog(stringLiteral: dialog))
    }
}

struct MiseShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        // Siri распознаёт по языку СИСТЕМЫ (Siri устройства), не по выбранному в приложении
        // языку — поэтому, в отличие от title/description выше, фразы перечислены литералами
        // сразу на всех 8 языках продукта, а не читаются из ScI18n рантаймом.
        AppShortcut(
            intent: RevenueTodayIntent(),
            phrases: [
                "Выручка в \(.applicationName)", "\(.applicationName) выручка сегодня", "Today's revenue in \(.applicationName)",
                "Incasso di oggi in \(.applicationName)", "Recettes du jour dans \(.applicationName)",
                "\(.applicationName) bugünün cirosu", "\(.applicationName) bu günün gəliri",
                "Виручка сьогодні в \(.applicationName)", "\(.applicationName) бүгінгі түсім",
            ],
            shortTitle: "Today's revenue",
            systemImageName: "creditcard.fill"
        )
        AppShortcut(
            intent: NextBookingIntent(),
            phrases: [
                "Брони в \(.applicationName)", "\(.applicationName) ближайшая бронь", "Next booking in \(.applicationName)",
                "Prenotazioni in \(.applicationName)", "Réservations dans \(.applicationName)",
                "\(.applicationName) yaklaşan rezervasyon", "\(.applicationName) yaxın rezerv",
                "Броні в \(.applicationName)", "\(.applicationName) жақын брондау",
            ],
            shortTitle: "Today's bookings",
            systemImageName: "calendar.badge.clock"
        )
        AppShortcut(
            intent: OpenShiftIntent(),
            phrases: [
                "Открой смену в \(.applicationName)", "Open shift in \(.applicationName)", "\(.applicationName) открой смену",
                "Apri turno in \(.applicationName)", "Ouvrir le service dans \(.applicationName)",
                "\(.applicationName) vardiyayı aç", "\(.applicationName) növbəni aç",
                "Відкрий зміну в \(.applicationName)", "\(.applicationName) ауысымды аш",
            ],
            shortTitle: "Open shift",
            systemImageName: "lock.open.fill"
        )
        AppShortcut(
            intent: BookingCountIntent(),
            phrases: [
                "Сколько броней в \(.applicationName)", "How many bookings in \(.applicationName)", "\(.applicationName) брони на сегодня",
                "Numero prenotazioni in \(.applicationName)", "Nombre de réservations dans \(.applicationName)",
                "\(.applicationName) kaç rezervasyon", "\(.applicationName) neçə rezerv",
                "Скільки броней в \(.applicationName)", "\(.applicationName) неше брондау",
            ],
            shortTitle: "Booking count",
            systemImageName: "questionmark.circle"
        )
    }
}
