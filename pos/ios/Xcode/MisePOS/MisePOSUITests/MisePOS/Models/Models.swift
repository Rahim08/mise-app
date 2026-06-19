import Foundation

// MARK: - Snapshot

struct Snapshot: Decodable {
    let restaurantId: String
    let tables: [TableState]
    let menu: MenuSnapshot
    let activeSession: POSSession?

    enum CodingKeys: String, CodingKey {
        case restaurantId = "restaurant_id"
        case tables, menu
        case activeSession = "active_session"
    }
}

// MARK: - Tables

struct TableState: Decodable, Identifiable {
    let id: String
    let number: String
    let label: String?
    var status: TableStatus
    let floorId: String
    let capacity: Int
    let posX: Double
    let posY: Double
    let width: Double
    let height: Double
    var seating: ActiveSeating?

    enum CodingKeys: String, CodingKey {
        case id, number, label, status, capacity, width, height, seating
        case floorId = "floor_id"
        case posX = "pos_x"
        case posY = "pos_y"
    }

    var displayName: String { label ?? number }
    var isOccupied: Bool { status != .free }
    var currentOrder: OrderState? { seating?.order }
    var openDuration: String? {
        guard let t = seating?.openedAt else { return nil }
        let mins = Int(-t.timeIntervalSinceNow / 60)
        return mins < 60 ? "\(mins)м" : "\(mins/60)ч \(mins%60)м"
    }
}

enum TableStatus: String, Decodable {
    case free = "free"
    case occupied = "occupied"
    case billRequested = "bill-requested"
    case reserved = "reserved"
    case blocked = "blocked"
}

struct ActiveSeating: Decodable {
    let id: String
    let guestsCount: Int
    let openedAt: Date
    let waiterId: String?
    var order: OrderState?

    enum CodingKeys: String, CodingKey {
        case id, order
        case guestsCount = "guests_count"
        case openedAt = "opened_at"
        case waiterId = "waiter_id"
    }
}

// MARK: - Orders

struct OrderState: Decodable, Identifiable {
    let id: String
    let seatingId: String
    var status: String
    var subtotal: Double
    var discountAmount: Double
    var taxAmount: Double
    var total: Double
    var note: String?
    var items: [OrderItemState]

    enum CodingKeys: String, CodingKey {
        case id, status, subtotal, total, note, items
        case seatingId = "seating_id"
        case discountAmount = "discount_amount"
        case taxAmount = "tax_amount"
    }

    var pendingItems: [OrderItemState] { items.filter { $0.status == "pending" } }
    var sentItems: [OrderItemState] { items.filter { $0.status == "sent" || $0.status == "cooking" } }
    var readyItems: [OrderItemState] { items.filter { $0.status == "ready" } }
    var discount_pct: Double { subtotal > 0 ? (discountAmount / subtotal) * 100 : 0 }
}

struct OrderItemState: Decodable, Identifiable {
    let id: String
    let menuItemId: String
    let menuItemName: String
    var qty: Int
    let unitPrice: Double
    var discount: Double
    var modifiers: [ModifierSelection]
    var course: Int
    var status: String
    var note: String?
    var sentAt: Date?
    var readyAt: Date?

    enum CodingKeys: String, CodingKey {
        case id, qty, discount, modifiers, course, status, note
        case menuItemId = "menu_item_id"
        case menuItemName = "menu_item_name"
        case unitPrice = "unit_price"
        case sentAt = "sent_at"
        case readyAt = "ready_at"
    }

    // Aliases used by views
    var name: String { menuItemName }
    var lineTotalValue: Double { unitPrice * Double(qty) - discount }
    var lineTotal: String { String(format: "€%.2f", lineTotalValue) }
    var modifierSummary: String { modifiers.map(\.optionName).joined(separator: ", ") }
    var waitMinutes: Int? {
        guard let t = sentAt else { return nil }
        return Int(-t.timeIntervalSinceNow / 60)
    }
}

// MARK: - Menu

struct MenuSnapshot: Decodable {
    let categories: [MenuCategory]
    var items: [MenuItem]
    let groups: [ModifierGroup]
    let modifiers: [Modifier]
}

struct MenuCategory: Decodable, Identifiable {
    let id: String
    let name: String
    let sort: Int
    let color: String?
    let icon: String?
}

struct MenuItem: Decodable, Identifiable {
    let id: String
    let categoryId: String
    let name: String
    let description: String?
    let photoUrl: String?
    let basePrice: Double
    let yieldG: Double?
    let allergens: [String]
    let station: String
    let flags: [String]
    var isAvailable: Bool
    let sort: Int
    // Populated by AppModel after snapshot — not in JSON
    var modifier_groups: [ModifierGroup]?

    enum CodingKeys: String, CodingKey {
        case id, name, description, allergens, station, flags, sort
        case categoryId = "category_id"
        case photoUrl = "photo_url"
        case basePrice = "base_price"
        case yieldG = "yield_g"
        case isAvailable = "is_available"
    }

    // Aliases for views
    var price: Double { basePrice }
    var photo_url: String? { photoUrl }
    var isVegetarian: Bool { flags.contains("vegetarian") }
    var isVegan: Bool { flags.contains("vegan") }
    var isSpicy: Bool { flags.contains("spicy") }
    var isFeatured: Bool { flags.contains("featured") }
    var formattedPrice: String { String(format: "€%.2f", basePrice) }
}

struct ModifierGroup: Decodable, Identifiable {
    let id: String
    let menuItemId: String
    let name: String
    let required: Bool
    let minSelect: Int
    let maxSelect: Int
    let sort: Int
    // Populated by AppModel after snapshot
    var modifiers: [Modifier]?

    enum CodingKeys: String, CodingKey {
        case id, name, required, sort
        case menuItemId = "menu_item_id"
        case minSelect = "min_select"
        case maxSelect = "max_select"
    }

    var max_select: Int { maxSelect }
    var isRequired: Bool { required }
}

struct Modifier: Decodable, Identifiable {
    let id: String
    let groupId: String
    let name: String
    let priceDelta: Double
    let sort: Int

    enum CodingKeys: String, CodingKey {
        case id, name, sort
        case groupId = "group_id"
        case priceDelta = "price_delta"
    }

    var price_delta: Double { priceDelta }
}

// MARK: - Cash Session

struct POSSession: Decodable, Identifiable {
    let id: String
    let openedAt: Date
    var closedAt: Date?
    var openingCash: Double
    var closingCashExpected: Double?
    var closingCashActual: Double?
    var totalSales: Double
    var totalCash: Double
    var totalCard: Double
    var totalDiscount: Double
    var totalComps: Double
    var status: String
    var payins: [SessionMovement]
    var payouts: [SessionMovement]

    enum CodingKeys: String, CodingKey {
        case id, status
        case openedAt = "opened_at"
        case closedAt = "closed_at"
        case openingCash = "opening_cash"
        case closingCashExpected = "closing_cash_expected"
        case closingCashActual = "closing_cash_actual"
        case totalSales = "total_sales"
        case totalCash = "total_cash"
        case totalCard = "total_card"
        case totalDiscount = "total_discount"
        case totalComps = "total_comps"
        case payins = "pos_session_payins"
        case payouts = "pos_session_payouts"
    }
}

struct SessionMovement: Decodable, Identifiable {
    let id: String
    let amount: Double
    let note: String?
    let createdAt: Date

    enum CodingKeys: String, CodingKey {
        case id, amount, note
        case createdAt = "created_at"
    }
}

// MARK: - Date decoding

extension JSONDecoder {
    static var posDecoder: JSONDecoder {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .custom { decoder in
            let s = try decoder.singleValueContainer().decode(String.self)
            let formats = [
                "yyyy-MM-dd'T'HH:mm:ss.SSSSSSZ",
                "yyyy-MM-dd'T'HH:mm:ssZ",
                "yyyy-MM-dd'T'HH:mm:ss",
            ]
            let f = DateFormatter()
            f.locale = Locale(identifier: "en_US_POSIX")
            for fmt in formats {
                f.dateFormat = fmt
                if let date = f.date(from: s) { return date }
            }
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Bad date: \(s)"))
        }
        return d
    }
}
