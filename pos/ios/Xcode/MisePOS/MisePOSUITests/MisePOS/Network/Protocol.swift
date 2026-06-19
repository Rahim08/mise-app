import Foundation

// MARK: - Client → Server

enum ClientMessage: Encodable {
    case auth(deviceId: String, pin: String, role: String)
    case ping
    case tableOpen(requestId: String, tableId: String, guests: Int)
    case tableClose(requestId: String, tableId: String)
    case orderItemAdd(requestId: String, orderId: String, item: OrderItemInput)
    case orderItemRemove(requestId: String, orderId: String, itemId: String)
    case orderSendToKitchen(requestId: String, orderId: String, course: Int?)
    case orderApplyDiscount(requestId: String, orderId: String, amount: Double)
    case orderPay(requestId: String, orderId: String, payment: PaymentInput)
    case kitchenItemReady(requestId: String, itemId: String)
    case kitchenTicketDone(requestId: String, orderId: String)
    case menuToggleItem(requestId: String, itemId: String, available: Bool)
    case syncRequest

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: AnyCodingKey.self)
        switch self {
        case .auth(let did, let pin, let role):
            try c.encode("auth", forKey: .key("type"))
            try c.encode(did, forKey: .key("device_id"))
            try c.encode(pin, forKey: .key("pin"))
            try c.encode(role, forKey: .key("role"))
        case .ping:
            try c.encode("ping", forKey: .key("type"))
        case .tableOpen(let rid, let tid, let guests):
            try c.encode("table.open", forKey: .key("type"))
            try c.encode(rid, forKey: .key("request_id"))
            try c.encode(tid, forKey: .key("table_id"))
            try c.encode(guests, forKey: .key("guests"))
        case .tableClose(let rid, let tid):
            try c.encode("table.close", forKey: .key("type"))
            try c.encode(rid, forKey: .key("request_id"))
            try c.encode(tid, forKey: .key("table_id"))
        case .orderItemAdd(let rid, let oid, let item):
            try c.encode("order.item.add", forKey: .key("type"))
            try c.encode(rid, forKey: .key("request_id"))
            try c.encode(oid, forKey: .key("order_id"))
            try c.encode(item, forKey: .key("item"))
        case .orderItemRemove(let rid, let oid, let iid):
            try c.encode("order.item.remove", forKey: .key("type"))
            try c.encode(rid, forKey: .key("request_id"))
            try c.encode(oid, forKey: .key("order_id"))
            try c.encode(iid, forKey: .key("item_id"))
        case .orderSendToKitchen(let rid, let oid, let course):
            try c.encode("order.send_to_kitchen", forKey: .key("type"))
            try c.encode(rid, forKey: .key("request_id"))
            try c.encode(oid, forKey: .key("order_id"))
            if let course { try c.encode(course, forKey: .key("course")) }
        case .orderApplyDiscount(let rid, let oid, let amount):
            try c.encode("order.apply_discount", forKey: .key("type"))
            try c.encode(rid, forKey: .key("request_id"))
            try c.encode(oid, forKey: .key("order_id"))
            try c.encode(amount, forKey: .key("amount"))
        case .orderPay(let rid, let oid, let payment):
            try c.encode("order.pay", forKey: .key("type"))
            try c.encode(rid, forKey: .key("request_id"))
            try c.encode(oid, forKey: .key("order_id"))
            try c.encode(payment, forKey: .key("payment"))
        case .kitchenItemReady(let rid, let iid):
            try c.encode("kitchen.item.ready", forKey: .key("type"))
            try c.encode(rid, forKey: .key("request_id"))
            try c.encode(iid, forKey: .key("item_id"))
        case .kitchenTicketDone(let rid, let oid):
            try c.encode("kitchen.ticket.done", forKey: .key("type"))
            try c.encode(rid, forKey: .key("request_id"))
            try c.encode(oid, forKey: .key("order_id"))
        case .menuToggleItem(let rid, let iid, let avail):
            try c.encode("menu.toggle_item", forKey: .key("type"))
            try c.encode(rid, forKey: .key("request_id"))
            try c.encode(iid, forKey: .key("item_id"))
            try c.encode(avail, forKey: .key("available"))
        case .syncRequest:
            try c.encode("sync.request", forKey: .key("type"))
        }
    }
}

// MARK: - Server → Client

enum ServerMessage: Decodable {
    case authOk(deviceId: String, role: String, snapshot: Snapshot)
    case authError(message: String)
    case pong
    case ack(requestId: String)
    case error(requestId: String?, message: String)
    case stateTables([TableState])
    case stateOrder(OrderState)
    case stateMenuItem(itemId: String, isAvailable: Bool)
    case stateKdsItem(itemId: String, status: String, orderId: String)
    case notifyItemReady(orderId: String, itemName: String, tableNumber: String)
    case notifyTicketDone(orderId: String, tableNumber: String)
    case paymentOk(orderId: String, paymentId: String, change: Double)
    case stateSession(POSSession)
    case unknown

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: AnyCodingKey.self)
        let type = try c.decode(String.self, forKey: .key("type"))
        switch type {
        case "auth.ok":
            self = .authOk(
                deviceId: try c.decode(String.self, forKey: .key("device_id")),
                role: try c.decode(String.self, forKey: .key("role")),
                snapshot: try c.decode(Snapshot.self, forKey: .key("snapshot"))
            )
        case "auth.error":
            self = .authError(message: try c.decode(String.self, forKey: .key("message")))
        case "pong":
            self = .pong
        case "ack":
            self = .ack(requestId: try c.decode(String.self, forKey: .key("request_id")))
        case "error":
            self = .error(
                requestId: try? c.decode(String.self, forKey: .key("request_id")),
                message: try c.decode(String.self, forKey: .key("message"))
            )
        case "state.tables":
            self = .stateTables(try c.decode([TableState].self, forKey: .key("tables")))
        case "state.order":
            self = .stateOrder(try c.decode(OrderState.self, forKey: .key("order")))
        case "state.menu_item":
            self = .stateMenuItem(
                itemId: try c.decode(String.self, forKey: .key("item_id")),
                isAvailable: try c.decode(Bool.self, forKey: .key("is_available"))
            )
        case "state.kds_item":
            self = .stateKdsItem(
                itemId: try c.decode(String.self, forKey: .key("item_id")),
                status: try c.decode(String.self, forKey: .key("status")),
                orderId: try c.decode(String.self, forKey: .key("order_id"))
            )
        case "notify.item_ready":
            self = .notifyItemReady(
                orderId: try c.decode(String.self, forKey: .key("order_id")),
                itemName: try c.decode(String.self, forKey: .key("item_name")),
                tableNumber: try c.decode(String.self, forKey: .key("table_number"))
            )
        case "notify.ticket_done":
            self = .notifyTicketDone(
                orderId: try c.decode(String.self, forKey: .key("order_id")),
                tableNumber: try c.decode(String.self, forKey: .key("table_number"))
            )
        case "payment.ok":
            self = .paymentOk(
                orderId: try c.decode(String.self, forKey: .key("order_id")),
                paymentId: try c.decode(String.self, forKey: .key("payment_id")),
                change: try c.decode(Double.self, forKey: .key("change"))
            )
        case "state.session":
            self = .stateSession(try c.decode(POSSession.self, forKey: .key("session")))
        default:
            self = .unknown
        }
    }
}

// MARK: - Input types

struct OrderItemInput: Encodable {
    let id: String
    let menuItemId: String
    let menuItemName: String
    let qty: Int
    let unitPrice: Double
    let modifiers: [ModifierSelection]
    let course: Int
    let note: String?

    enum CodingKeys: String, CodingKey {
        case id, qty, modifiers, course, note
        case menuItemId = "menu_item_id"
        case menuItemName = "menu_item_name"
        case unitPrice = "unit_price"
    }
}

struct ModifierSelection: Codable {
    let groupId: String
    let groupName: String
    let optionId: String
    let optionName: String
    let priceDelta: Double

    enum CodingKeys: String, CodingKey {
        case groupId = "group_id"
        case groupName = "group_name"
        case optionId = "option_id"
        case optionName = "option_name"
        case priceDelta = "price_delta"
    }
}

struct PaymentInput: Encodable {
    let id: String
    let method: String
    let amount: Double
    let tipAmount: Double
    let changeAmount: Double
    let cashTendered: Double?
    let stripePaymentIntentId: String?

    enum CodingKeys: String, CodingKey {
        case id, method, amount
        case tipAmount = "tip_amount"
        case changeAmount = "change_amount"
        case cashTendered = "cash_tendered"
        case stripePaymentIntentId = "stripe_payment_intent_id"
    }
}

// MARK: - Coding key helper

struct AnyCodingKey: CodingKey {
    var stringValue: String
    var intValue: Int?
    init(stringValue: String) { self.stringValue = stringValue }
    init?(intValue: Int) { self.intValue = intValue; self.stringValue = "\(intValue)" }
    static func key(_ s: String) -> AnyCodingKey { .init(stringValue: s) }
}
