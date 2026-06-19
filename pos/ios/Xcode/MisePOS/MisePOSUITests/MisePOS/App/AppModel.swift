import Foundation
import SwiftUI

// MARK: - App state

enum AppPhase {
    case loading
    case connecting
    case pinEntry
    case active
}

// MARK: - AppModel

@MainActor
@Observable
final class AppModel {
    // Connection
    let network = NetworkManager()
    private(set) var phase: AppPhase = .loading

    // Session
    private(set) var deviceId: String = ""
    private(set) var role: String = "waiter"
    private(set) var restaurantId: String = ""

    // Restaurant data
    private(set) var tables: [TableState] = []
    private(set) var menu: MenuSnapshot?
    private(set) var notifications: [POSNotification] = []
    private(set) var activeSession: POSSession?

    // Active order being edited
    private(set) var activeOrderId: String?

    init() {
        network.onMessage = { [weak self] msg in
            Task { @MainActor in self?.handle(msg) }
        }
    }

    // MARK: - Start

    func start() {
        deviceId = storedDeviceId()
        phase = .connecting
        network.startDiscovery()

        // Once network connects, move to PIN entry
        withObservationTracking {
            _ = network.state
        } onChange: {
            Task { @MainActor in self.onNetworkStateChange() }
        }
    }

    private func onNetworkStateChange() {
        switch network.state {
        case .authenticating:
            phase = .pinEntry
        case .connected:
            phase = .active
        case .disconnected:
            phase = .connecting
            Task {
                try? await Task.sleep(for: .seconds(1))
                network.startDiscovery()
            }
        default:
            break
        }

        // Re-observe
        withObservationTracking {
            _ = network.state
        } onChange: {
            Task { @MainActor in self.onNetworkStateChange() }
        }
    }

    // MARK: - Authentication

    func submitPin(_ pin: String) {
        network.authenticate(deviceId: deviceId, pin: pin, role: role)
    }

    // MARK: - Server message handler

    func handle(_ msg: ServerMessage) {
        switch msg {
        case .authOk(_, let r, let snapshot):
            role = r
            restaurantId = snapshot.restaurantId
            tables = snapshot.tables
            menu = denormalize(snapshot.menu)
            activeSession = snapshot.activeSession
            phase = .active

        case .stateTables(let updated):
            tables = updated

        case .stateOrder(let order):
            updateOrder(order)

        case .stateMenuItem(let itemId, let available):
            if let idx = menu?.items.firstIndex(where: { $0.id == itemId }) {
                menu?.items[idx].isAvailable = available
            }

        case .notifyItemReady(_, let name, let tableNum):
            addNotification(.itemReady(itemName: name, tableNumber: tableNum))

        case .notifyTicketDone(_, let tableNum):
            addNotification(.ticketDone(tableNumber: tableNum))

        case .paymentOk(let orderId, _, let change):
            addNotification(.paymentDone(orderId: orderId, change: change))

        case .stateSession(let session):
            activeSession = session

        default:
            break
        }
    }

    // MARK: - Table actions

    func openTable(_ tableId: String, guests: Int) {
        let reqId = UUID().uuidString
        network.send(.tableOpen(requestId: reqId, tableId: tableId, guests: guests))
    }

    func closeTable(_ tableId: String) {
        let reqId = UUID().uuidString
        network.send(.tableClose(requestId: reqId, tableId: tableId))
    }

    func table(id: String) -> TableState? {
        tables.first { $0.id == id }
    }

    // MARK: - Order actions (table-based — resolve orderId internally)

    func addItem(to tableId: String, item: MenuItem, qty: Int = 1, modifiers: [ModifierSelection] = [], note: String? = nil) {
        guard let orderId = table(id: tableId)?.currentOrder?.id else { return }
        let input = OrderItemInput(
            id: UUID().uuidString,
            menuItemId: item.id,
            menuItemName: item.name,
            qty: qty,
            unitPrice: item.basePrice + modifiers.reduce(0) { $0 + $1.priceDelta },
            modifiers: modifiers,
            course: 1,
            note: note.flatMap { $0.isEmpty ? nil : $0 }
        )
        network.send(.orderItemAdd(requestId: UUID().uuidString, orderId: orderId, item: input))
    }

    func removeItem(_ itemId: String, from tableId: String) {
        guard let orderId = table(id: tableId)?.currentOrder?.id else { return }
        network.send(.orderItemRemove(requestId: UUID().uuidString, orderId: orderId, itemId: itemId))
    }

    func sendToKitchen(tableId: String, course: Int? = nil) {
        guard let orderId = table(id: tableId)?.currentOrder?.id else { return }
        network.send(.orderSendToKitchen(requestId: UUID().uuidString, orderId: orderId, course: course))
    }

    func applyDiscount(tableId: String, amount: Double) {
        guard let orderId = table(id: tableId)?.currentOrder?.id else { return }
        network.send(.orderApplyDiscount(requestId: UUID().uuidString, orderId: orderId, amount: amount))
    }

    func pay(tableId: String, input: PaymentInput) {
        guard let orderId = table(id: tableId)?.currentOrder?.id else { return }
        network.send(.orderPay(requestId: UUID().uuidString, orderId: orderId, payment: input))
    }

    // MARK: - Kitchen

    func markItemReady(_ itemId: String) {
        network.send(.kitchenItemReady(requestId: UUID().uuidString, itemId: itemId))
    }

    // MARK: - Cash session

    func openShift(openingCash: Double) {
        Task {
            guard let url = serverURL else { return }
            var req = URLRequest(url: url.appendingPathComponent("/api/session/open"))
            req.httpMethod = "POST"
            req.httpBody = try? JSONSerialization.data(withJSONObject: ["opening_cash": openingCash])
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            guard let (data, _) = try? await URLSession.shared.data(for: req),
                  let session = try? JSONDecoder.posDecoder.decode(POSSession.self, from: data) else { return }
            await MainActor.run { activeSession = session }
        }
    }

    func closeShift() {
        guard let session = activeSession else { return }
        Task {
            guard let url = serverURL else { return }
            var req = URLRequest(url: url.appendingPathComponent("/api/session/close"))
            req.httpMethod = "POST"
            req.httpBody = try? JSONSerialization.data(withJSONObject: ["session_id": session.id])
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            _ = try? await URLSession.shared.data(for: req)
            await MainActor.run { activeSession = nil }
        }
    }

    func recordPayin(amount: Double, note: String) {
        guard let session = activeSession else { return }
        let movement = SessionMovement(id: UUID().uuidString, amount: amount, note: note.isEmpty ? nil : note, createdAt: Date())
        activeSession?.payins.append(movement)
        activeSession?.totalCash += amount
        // Fire-and-forget to server
        Task {
            guard let url = serverURL else { return }
            var req = URLRequest(url: url.appendingPathComponent("/api/session/payin"))
            req.httpMethod = "POST"
            req.httpBody = try? JSONSerialization.data(withJSONObject: ["session_id": session.id, "amount": amount, "note": note])
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            _ = try? await URLSession.shared.data(for: req)
        }
    }

    func recordPayout(amount: Double, note: String) {
        guard let session = activeSession else { return }
        let movement = SessionMovement(id: UUID().uuidString, amount: amount, note: note.isEmpty ? nil : note, createdAt: Date())
        activeSession?.payouts.append(movement)
        Task {
            guard let url = serverURL else { return }
            var req = URLRequest(url: url.appendingPathComponent("/api/session/payout"))
            req.httpMethod = "POST"
            req.httpBody = try? JSONSerialization.data(withJSONObject: ["session_id": session.id, "amount": amount, "note": note])
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            _ = try? await URLSession.shared.data(for: req)
        }
    }

    private var serverURL: URL? {
        guard let host = network.resolvedHost else { return nil }
        return URL(string: "http://\(host)")
    }

    // MARK: - Private helpers

    private func denormalize(_ snap: MenuSnapshot) -> MenuSnapshot {
        let modsByGroup = Dictionary(grouping: snap.modifiers) { $0.groupId }
        var groupsByItem = [String: [ModifierGroup]]()
        for group in snap.groups {
            var g = group
            g.modifiers = (modsByGroup[group.id] ?? []).sorted { $0.sort < $1.sort }
            groupsByItem[group.menuItemId, default: []].append(g)
        }
        var snap = snap
        snap.items = snap.items.map { item in
            var i = item
            i.modifier_groups = (groupsByItem[item.id] ?? []).sorted { $0.sort < $1.sort }
            return i
        }
        return snap
    }

    private func updateOrder(_ order: OrderState) {
        for i in tables.indices {
            if tables[i].seating?.order?.id == order.id {
                tables[i].seating?.order = order
                return
            }
        }
    }

    private func addNotification(_ n: POSNotification) {
        notifications.insert(n, at: 0)
        if notifications.count > 50 { notifications.removeLast() }
    }

    private func storedDeviceId() -> String {
        if let id = UserDefaults.standard.string(forKey: "mise_pos_device_id") { return id }
        let id = UUID().uuidString
        UserDefaults.standard.set(id, forKey: "mise_pos_device_id")
        return id
    }
}

// MARK: - Notifications

enum POSNotification: Identifiable {
    var id: String { UUID().uuidString }
    case itemReady(itemName: String, tableNumber: String)
    case ticketDone(tableNumber: String)
    case paymentDone(orderId: String, change: Double)

    var message: String {
        switch self {
        case .itemReady(let name, let table): return "\(name) готово · Стол \(table)"
        case .ticketDone(let table):           return "Весь тикет готов · Стол \(table)"
        case .paymentDone(_, let change):      return change > 0 ? "Оплата принята · Сдача €\(String(format: "%.2f", change))" : "Оплата принята"
        }
    }
}
