import Foundation
import WidgetKit

// MARK: - Snapshot writer (main app only)
//
// Runs lightweight DB queries inside the app process (where the PIN-session
// cookie is available), builds a `MiseSnapshot`, writes it to the shared App
// Group UserDefaults, and asks WidgetKit to reload all timelines.
//
// The widget extension reads the snapshot back via `MiseSnapshotStore.read()`
// and never performs any network/DB calls of its own.

@MainActor
enum SnapshotWriter {
    /// Throttle: don't recompute more than once per ~90s on foreground refreshes.
    private static var lastRun: Date?

    private static let dfKey: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        f.locale = Locale(identifier: "en_US_POSIX")
        return f
    }()
    private static var todayKey: String { dfKey.string(from: Date()) }

    /// Compute and persist a fresh snapshot. `canSeeMoney` gates the cash metric.
    /// `force` bypasses the throttle (used on explicit refresh).
    static func refresh(canSeeMoney: Bool, force: Bool = false) async {
        if !force, let last = lastRun, Date().timeIntervalSince(last) < 90 { return }
        lastRun = Date()

        let symbol = Money.symbol
        let today = todayKey

        async let cash = loadCash(today: today, canSeeMoney: canSeeMoney)
        async let hookahs = loadHookahs(today: today)
        async let bookings = loadBookings(today: today)

        let (c, h, b) = await (cash, hookahs, bookings)

        let snap = MiseSnapshot(
            generatedAt: Date(),
            currencySymbol: symbol,
            cashIncome: c.income,
            cashCash: c.cash,
            cashCard: c.card,
            cashInkassation: c.inkassation,
            cashExpense: c.expense,
            cashClosing: c.closing,
            cashAvailable: c.available,
            hookahPaid: h.paid,
            hookahFree: h.free,
            hookahRevenue: h.revenue,
            bookings: b
        )
        MiseSnapshotStore.write(snap)
        WidgetCenter.shared.reloadAllTimelines()
    }

    /// Clear shared data on logout so the widget doesn't keep showing stale numbers.
    static func clear() {
        MiseSnapshotStore.write(MiseSnapshot())
        WidgetCenter.shared.reloadAllTimelines()
        lastRun = nil
    }

    // MARK: cash (Касса дня)

    private struct CashResult {
        var income = 0.0; var cash = 0.0; var card = 0.0; var inkassation = 0.0
        var expense = 0.0; var closing = 0.0; var available = false
    }

    private static func loadCash(today: String, canSeeMoney: Bool) async -> CashResult {
        guard canSeeMoney else { return CashResult() }
        // Касса — это текущий остаток, а не только "смена сегодня": если сегодняшнюю ещё
        // не открыли, показываем последнюю закрытую (тот же принцип, что prevClosing в
        // ManagerView для переноса остатка). shifts уникальны по (restaurant_id, date).
        guard let shifts = try? await DB.from("shifts").select()
            .lte("date", today).order("date", ascending: false).order("opened_at", ascending: false)
            .limit(1).list(Shift.self), let sh = shifts.first else {
            return CashResult()
        }
        return CashResult(
            // Выручка = наличные + карта, как везде в аналитике (см. AnalyticsModel.pTotal).
            income: (sh.income ?? 0) + (sh.income_card ?? 0),
            cash: sh.income ?? 0,
            card: sh.income_card ?? 0,
            inkassation: sh.inkassation ?? 0,
            expense: (sh.total_expense ?? 0) - (sh.inkassation ?? 0),
            closing: sh.closing_balance ?? 0,
            available: true
        )
    }

    // MARK: hookahs (Кальяны смены)

    private struct HookahResult { var paid = 0; var free = 0; var revenue = 0.0 }

    private static func loadHookahs(today: String) async -> HookahResult {
        async let typesR = try? DB.from("hookah_types").select("id, price").eq("is_active", true).list(HookahType.self)
        async let salesR = try? DB.from("hookah_sales")
            .select("hookah_type_id, quantity, is_free, date").eq("date", today).list(HookahSale.self)
        guard let types = await typesR, let sales = await salesR else { return HookahResult() }

        var priceById: [String: Double] = [:]
        for t in types { priceById[t.id] = t.price ?? 0 }

        var res = HookahResult()
        for s in sales {
            let q = Int(s.quantity ?? 0)
            if s.is_free == true {
                res.free += q
            } else {
                res.paid += q
                if let id = s.hookah_type_id {
                    let price = (s.price ?? 0) > 0 ? (s.price ?? 0) : (priceById[id] ?? 0)
                    res.revenue += Double(q) * price
                }
            }
        }
        return res
    }

    // MARK: bookings (Ближайшие брони)

    private static func loadBookings(today: String) async -> [SnapBooking] {
        guard let rows = try? await DB.from("bookings").select()
            .eq("booking_date", today).order("booking_time").list(Booking.self) else { return [] }

        // Only future/active bookings; drop cancelled. Keep the next few.
        let nowHM = nowHHmm()
        let active = rows.filter { ($0.status ?? "new") != "cancelled" }
        let upcoming = active.filter { b in
            guard let tm = b.booking_time, !tm.isEmpty else { return true } // no time -> keep
            return tm >= nowHM
        }
        let pick = (upcoming.isEmpty ? active : upcoming).prefix(4)
        return pick.map { b in
            SnapBooking(
                id: b.id,
                time: (b.booking_time ?? "").prefix(5).description,
                guest: b.guest_name ?? "",
                table: b.table_label ?? "",
                party: b.guests_count ?? 0
            )
        }
    }

    private static func nowHHmm() -> String {
        let f = DateFormatter()
        f.dateFormat = "HH:mm"
        f.locale = Locale(identifier: "en_US_POSIX")
        return f.string(from: Date())
    }
}
