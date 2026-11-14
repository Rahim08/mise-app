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

    private var loadGeneration = 0

    func load(canSeeMoney: Bool, dayStartHour: Int) async {
        #if DEBUG
        if ProcessInfo.processInfo.environment["MISE_DEMO_UI"] == "1" { return }
        #endif
        loadGeneration += 1
        let generation = loadGeneration
        let today = Self.dfKey.string(from: AppModel.businessDate(dayStartHour: dayStartHour))
        if !canSeeMoney { managerCash = nil; analyticsIncome = nil }

        // Each tile publishes when its own query completes. A slow stock or bookings
        // request must not keep an already available cash balance off the hub.
        await withTaskGroup(of: Void.self) { group in
            group.addTask { @MainActor in
                let shift = await Self.loadTodayShift(today: today)
                guard generation == self.loadGeneration, !Task.isCancelled else { return }
                self.managerOpen = shift?.status == "open"
                self.managerCash = canSeeMoney ? shift.map { $0.closing_balance ?? (($0.income ?? 0) + ($0.income_card ?? 0)) } : nil
            }
            group.addTask { @MainActor in
                let shift = canSeeMoney ? await Self.loadLatestShift(upTo: today) : nil
                guard generation == self.loadGeneration, !Task.isCancelled else { return }
                self.analyticsIncome = canSeeMoney ? shift.map { ($0.income ?? 0) + ($0.income_card ?? 0) } : nil
            }
            group.addTask { @MainActor in
                let low = await Self.loadStashLow()
                guard generation == self.loadGeneration, !Task.isCancelled else { return }
                self.stashLowCount = low
            }
            group.addTask { @MainActor in
                let count = await Self.loadOnShift(today: today)
                guard generation == self.loadGeneration, !Task.isCancelled else { return }
                self.peopleOnShift = count
            }
            group.addTask { @MainActor in
                let booking = await Self.loadNextBookingTime(today: today)
                guard generation == self.loadGeneration, !Task.isCancelled else { return }
                self.nextBookingTime = booking
            }
        }
    }

    private static func loadTodayShift(today: String) async -> Shift? {
        (try? await DB.from("shifts").fresh().select()
            .eq("date", today).order("opened_at", ascending: false)
            .limit(1).list(Shift.self))?.first
    }

    private static func loadLatestShift(upTo today: String) async -> Shift? {
        (try? await DB.from("shifts").fresh().select()
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
