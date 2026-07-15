import Foundation

// MARK: - Shared widget snapshot
//
// This file is compiled into BOTH the main app target ("Mise") and the widget
// extension target ("MiseWidget"). The main app computes a `MiseSnapshot` from
// lightweight DB queries and writes it to the shared App Group UserDefaults;
// the widget reads it back. The widget itself NEVER touches the network.

/// App Group identifier shared between the app and the widget extension.
/// Must be added as an App Group capability to BOTH targets.
public let kMiseAppGroup = "group.com.rahim.mise"

/// UserDefaults key for the encoded snapshot inside the App Group suite.
public let kMiseSnapshotKey = "mise.widget.snapshot.v1"

/// UserDefaults key for the app's current language (Lang.rawValue), mirrored into the
/// App Group suite so the widget extension (separate process/sandbox — can't read
/// UserDefaults.standard of the main app) renders text in the same language as the app.
public let kMiseWidgetLangKey = "mise.widget.lang"

/// A small, self-contained snapshot of the three widget metrics.
/// Money values are stored as raw Double + a currency symbol so the widget can
/// format them identically to the app without depending on app-only code.
public struct MiseSnapshot: Codable, Sendable {
    public var generatedAt: Date
    public var currencySymbol: String

    // Касса дня / Cash of the day
    public var cashIncome: Double        // общая выручка (нал + карта)
    public var cashCash: Double          // из неё — наличными
    public var cashCard: Double          // из неё — картой
    public var cashInkassation: Double   // инкассация смены
    public var cashExpense: Double
    public var cashClosing: Double
    /// false when the user is not allowed to see money (waiter / hookah master),
    /// or when there is no open shift for today.
    public var cashAvailable: Bool

    // Кальяны смены / Hookahs of the shift
    public var hookahPaid: Int
    public var hookahFree: Int
    public var hookahRevenue: Double

    // Ближайшие брони / Upcoming bookings
    public var bookings: [SnapBooking]

    public init(generatedAt: Date = Date(),
                currencySymbol: String = "€",
                cashIncome: Double = 0,
                cashCash: Double = 0,
                cashCard: Double = 0,
                cashInkassation: Double = 0,
                cashExpense: Double = 0,
                cashClosing: Double = 0,
                cashAvailable: Bool = false,
                hookahPaid: Int = 0,
                hookahFree: Int = 0,
                hookahRevenue: Double = 0,
                bookings: [SnapBooking] = []) {
        self.generatedAt = generatedAt
        self.currencySymbol = currencySymbol
        self.cashIncome = cashIncome
        self.cashCash = cashCash
        self.cashCard = cashCard
        self.cashInkassation = cashInkassation
        self.cashExpense = cashExpense
        self.cashClosing = cashClosing
        self.cashAvailable = cashAvailable
        self.hookahPaid = hookahPaid
        self.hookahFree = hookahFree
        self.hookahRevenue = hookahRevenue
        self.bookings = bookings
    }

    public static let placeholder = MiseSnapshot(
        currencySymbol: "€",
        cashIncome: 4599.70, cashCash: 3210, cashCard: 1389.70, cashInkassation: 800,
        cashExpense: 1548, cashClosing: 613.30, cashAvailable: true,
        hookahPaid: 14, hookahFree: 2, hookahRevenue: 1260,
        bookings: [
            SnapBooking(time: "19:00", guest: "Anna", table: "T4", party: 4),
            SnapBooking(time: "20:30", guest: "Marco", table: "T1", party: 2),
        ])
}

public struct SnapBooking: Codable, Sendable, Identifiable {
    public var id: String
    public var time: String      // "HH:mm" or "" if none
    public var guest: String
    public var table: String     // "" if none
    public var party: Int        // 0 if unknown

    public init(id: String = UUID().uuidString, time: String, guest: String, table: String, party: Int) {
        self.id = id
        self.time = time
        self.guest = guest
        self.table = table
        self.party = party
    }
}

// MARK: - Shared storage helpers

public enum MiseSnapshotStore {
    private static var suite: UserDefaults? { UserDefaults(suiteName: kMiseAppGroup) }

    /// Read the latest snapshot, or nil if none has been written yet.
    public static func read() -> MiseSnapshot? {
        guard let data = suite?.data(forKey: kMiseSnapshotKey) else { return nil }
        return try? JSONDecoder.mise.decode(MiseSnapshot.self, from: data)
    }

    /// Persist a snapshot to the shared App Group suite.
    @discardableResult
    public static func write(_ snapshot: MiseSnapshot) -> Bool {
        guard let suite, let data = try? JSONEncoder.mise.encode(snapshot) else { return false }
        suite.set(data, forKey: kMiseSnapshotKey)
        return true
    }
}

// MARK: - Shared money formatting (mirrors app's Money.s)

public enum SnapMoney {
    /// "<symbol>1 850,00"; negatives as "−<symbol>…". Mirrors the app's Money.s.
    public static func s(_ v: Double, symbol: String) -> String {
        let f = NumberFormatter()
        f.numberStyle = .decimal
        f.groupingSeparator = "\u{00A0}"
        f.decimalSeparator = ","
        f.minimumFractionDigits = 2
        f.maximumFractionDigits = 2
        let body = f.string(from: NSNumber(value: abs(v))) ?? "0"
        return (v < 0 ? "−" + symbol : symbol) + body
    }
}

extension JSONDecoder {
    static let mise: JSONDecoder = {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .iso8601
        return d
    }()
}
extension JSONEncoder {
    static let mise: JSONEncoder = {
        let e = JSONEncoder()
        e.dateEncodingStrategy = .iso8601
        return e
    }()
}
