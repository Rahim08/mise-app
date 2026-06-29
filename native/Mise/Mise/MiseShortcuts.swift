import AppIntents
import WidgetKit

// MARK: - Siri / Spotlight / App Shortcuts
//
// Читают последний снимок из App Group (без сети). Для обнаружения Siri
// AppShortcutsProvider должен компилироваться в основной таргет приложения —
// см. README.md (членство WidgetShared.swift + этого файла в обоих таргетах).

/// «Выручка сегодня» — Siri зачитывает кассу дня из снимка.
struct RevenueTodayIntent: AppIntent {
    static var title: LocalizedStringResource = "Выручка сегодня / Today's revenue"
    static var description = IntentDescription("Касса за день из последнего снимка виджета.")

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        let snap = MiseSnapshotStore.read() ?? MiseSnapshot()
        guard snap.cashAvailable else {
            return .result(dialog: "Сейчас нет открытой смены.")
        }
        let income = SnapMoney.s(snap.cashIncome, symbol: snap.currencySymbol)
        let closing = SnapMoney.s(snap.cashClosing, symbol: snap.currencySymbol)
        return .result(dialog: "Приход \(income), остаток \(closing).")
    }
}

/// «Брони сегодня» — Siri зачитывает ближайшую бронь.
struct NextBookingIntent: AppIntent {
    static var title: LocalizedStringResource = "Брони сегодня / Today's bookings"
    static var description = IntentDescription("Ближайшая бронь из последнего снимка виджета.")

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        let snap = MiseSnapshotStore.read() ?? MiseSnapshot()
        guard let b = snap.bookings.first else {
            return .result(dialog: "Броней на сегодня нет.")
        }
        let extra = b.table.isEmpty ? "" : ", стол \(b.table)"
        return .result(dialog: "Ближайшая бронь: \(b.time), \(b.guest), \(b.party) гост.\(extra). Всего броней: \(snap.bookings.count).")
    }
}

struct MiseShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: RevenueTodayIntent(),
            phrases: ["Выручка в \(.applicationName)", "\(.applicationName) выручка сегодня", "Today's revenue in \(.applicationName)"],
            shortTitle: "Выручка сегодня",
            systemImageName: "creditcard.fill"
        )
        AppShortcut(
            intent: NextBookingIntent(),
            phrases: ["Брони в \(.applicationName)", "\(.applicationName) ближайшая бронь", "Next booking in \(.applicationName)"],
            shortTitle: "Брони сегодня",
            systemImageName: "calendar.badge.clock"
        )
    }
}
