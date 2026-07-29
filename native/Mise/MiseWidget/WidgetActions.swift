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
        if var snap = MiseSnapshotStore.read() {
            snap.bookings.removeAll { $0.id == bookingID }
            MiseSnapshotStore.write(snap)
        }
        WidgetCenter.shared.reloadTimelines(ofKind: "MiseWidget")
        try? await WidgetAPI.setBookingArrived(id: bookingID)
        return .result()
    }
}
