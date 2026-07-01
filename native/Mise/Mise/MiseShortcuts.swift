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

/// «Открой смену» — открывает приложение на вкладке Manager.
struct OpenShiftIntent: AppIntent {
    static var title: LocalizedStringResource = "Открыть смену / Open shift"
    static var description = IntentDescription("Открывает Mise на экране смены.")

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
    static var title: LocalizedStringResource = "Сколько броней / Booking count"
    static var description = IntentDescription("Количество броней на сегодня из виджета.")

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        let snap = MiseSnapshotStore.read() ?? MiseSnapshot()
        let count = snap.bookings.count
        if count == 0 {
            return .result(dialog: "Броней на сегодня нет.")
        }
        let next = snap.bookings.first!
        let extra = next.table.isEmpty ? "" : ", стол \(next.table)"
        return .result(dialog: "\(count) броней. Ближайшая: \(next.time), \(next.guest)\(extra).")
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
        AppShortcut(
            intent: OpenShiftIntent(),
            phrases: ["Открой смену в \(.applicationName)", "Open shift in \(.applicationName)", "\(.applicationName) открой смену"],
            shortTitle: "Открыть смену",
            systemImageName: "lock.open.fill"
        )
        AppShortcut(
            intent: BookingCountIntent(),
            phrases: ["Сколько броней в \(.applicationName)", "How many bookings in \(.applicationName)", "\(.applicationName) брони на сегодня"],
            shortTitle: "Количество броней",
            systemImageName: "questionmark.circle"
        )
    }
}
