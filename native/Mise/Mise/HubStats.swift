import Foundation

/// Лёгкие данные для medium/large-плиток хаба (HubLayout.swift). Каждый запрос — одна
/// небольшая таблица, без тяжёлых джойнов уровня Manager/People/Stash. News не нуждается
/// в своём запросе — непрочитанные считаются из app.notifs (уже грузится в MainView.task).
@MainActor
@Observable
final class HubStatsModel {
    var managerCash: Double?
    var managerOpen: Bool?
    var analyticsIncome: Double?
    var stashLowCount: Int?
    var peopleOnShift: Int?
    var nextBookingTime: String?

    private static let dfKey: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        f.locale = Locale(identifier: "en_US_POSIX")
        return f
    }()

    func load(canSeeMoney: Bool, dayStartHour: Int) async {
        let today = Self.dfKey.string(from: AppModel.businessDate(dayStartHour: dayStartHour))

        async let shiftR: Shift? = canSeeMoney ? Self.loadLatestShift(today: today) : nil
        async let lowR = Self.loadStashLow()
        async let onShiftR = Self.loadOnShift(today: today)
        async let bookingR = Self.loadNextBookingTime(today: today)

        let (sh, low, onShift, booking) = await (shiftR, lowR, onShiftR, bookingR)

        if let sh {
            // Как в ManagerView/SnapshotWriter: касса на руках — closing_balance, если ещё
            // не посчитан (смена только открыта) — падать на доход наличными+картой.
            managerCash = sh.closing_balance ?? ((sh.income ?? 0) + (sh.income_card ?? 0))
            managerOpen = sh.status == "open"
            analyticsIncome = (sh.income ?? 0) + (sh.income_card ?? 0)
        }
        stashLowCount = low
        peopleOnShift = onShift
        nextBookingTime = booking
    }

    private static func loadLatestShift(today: String) async -> Shift? {
        (try? await DB.from("shifts").select()
            .lte("date", today).order("date", ascending: false).order("opened_at", ascending: false)
            .limit(1).list(Shift.self))?.first
    }

    private static func loadStashLow() async -> Int? {
        guard let items = try? await DB.from("tobacco_stock").select().list(StockItem.self) else { return nil }
        return items.filter { $0.quantity_g > 0 && $0.quantity_g <= ($0.min_quantity_g ?? 200) }.count
    }

    private static func loadOnShift(today: String) async -> Int? {
        guard let rows = try? await DB.from("attendance_records").select().eq("date", today).list(AttendanceRecord.self) else { return nil }
        return rows.filter { $0.check_in_at != nil && $0.check_out_at == nil }.count
    }

    private static func loadNextBookingTime(today: String) async -> String? {
        guard let rows = try? await DB.from("bookings").select()
            .eq("booking_date", today).order("booking_time").list(Booking.self) else { return nil }
        let nowHM = nowHHmm()
        let active = rows.filter { let s = $0.status ?? "new"; return s != "cancelled" && s != "no_show" && s != "arrived" }
        let upcoming = active.filter { b in
            guard let tm = b.booking_time, !tm.isEmpty else { return true }
            return tm >= nowHM
        }
        guard let b = upcoming.first ?? active.first, let tm = b.booking_time, !tm.isEmpty else { return nil }
        return String(tm.prefix(5))
    }

    private static func nowHHmm() -> String {
        let f = DateFormatter()
        f.dateFormat = "HH:mm"
        f.locale = Locale(identifier: "en_US_POSIX")
        return f.string(from: Date())
    }
}
