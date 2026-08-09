import AppIntents
import WidgetKit

/// Тап по кружку у брони в виджете — сразу «Пришёл», без открытия приложения.
/// Локальный снапшот правится оптимистично (строка тонет из «ближайших» сразу), сеть —
/// в фоне; следующий реальный refresh из приложения синхронизирует остальное.
struct MarkBookingArrivedIntent: AppIntent {
    static var title: LocalizedStringResource = "Mark arrived / Отметить пришедшим"

    @Parameter(title: "Booking ID")
    var bookingID: String

    init() {}
    init(bookingID: String) { self.bookingID = bookingID }

    func perform() async throws -> some IntentResult {
        var removed: SnapBooking?
        if var snap = MiseSnapshotStore.read() {
            removed = snap.bookings.first { $0.id == bookingID }
            snap.bookings.removeAll { $0.id == bookingID }
            MiseSnapshotStore.write(snap)
        }
        WidgetCenter.shared.reloadTimelines(ofKind: "MiseWidget")
        do {
            try await WidgetAPI.setBookingArrived(id: bookingID)
        } catch {
            // Раньше исход глотался через try?: в виджете гость «пришёл», в БД — нет
            // (типовая причина — 401, у расширения не было PIN-cookie). Возвращаем бронь
            // на место и пробрасываем ошибку, чтобы провал был видим, а не молчал.
            if let removed, var snap = MiseSnapshotStore.read(),
               !snap.bookings.contains(where: { $0.id == bookingID }) {
                snap.bookings.append(removed)
                snap.bookings.sort { $0.time < $1.time }
                MiseSnapshotStore.write(snap)
                WidgetCenter.shared.reloadTimelines(ofKind: "MiseWidget")
            }
            throw error
        }
        return .result()
    }
}
