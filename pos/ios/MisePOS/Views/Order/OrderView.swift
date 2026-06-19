import SwiftUI

// MARK: - Order View (full-screen from TableDetailSheet)

struct OrderView: View {
    @Environment(AppModel.self) private var app
    let tableId: String

    @State private var showMenuPicker = false
    @State private var showPayment = false
    @State private var itemToModify: (item: MenuItem, qty: Int)? = nil

    private var table: TableState? { app.table(id: tableId) }
    private var order: OrderState? { table?.currentOrder }

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            if let order {
                VStack(spacing: 0) {
                    // Header
                    HStack(spacing: 12) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Стол \(table?.displayName ?? "")")
                                .font(.system(size: 20, weight: .black))
                                .foregroundStyle(.white)
                            if let d = table?.openDuration {
                                Text(d)
                                    .font(.caption)
                                    .foregroundStyle(.gray)
                            }
                        }
                        Spacer()
                        OrderStatusBadge(order: order)
                    }
                    .padding(.horizontal, 20)
                    .padding(.top, 20)
                    .padding(.bottom, 16)

                    Divider().background(Color.white.opacity(0.08))

                    // Items list
                    ScrollView {
                        LazyVStack(spacing: 0) {
                            ForEach(order.items) { item in
                                OrderItemRow(item: item, onRemove: {
                                    app.removeItem(item.id, from: tableId)
                                })
                                Divider().background(Color.white.opacity(0.06)).padding(.leading, 20)
                            }

                            if order.items.isEmpty {
                                EmptyOrderHint()
                            }
                        }
                    }

                    // Bottom totals + actions
                    OrderBottomBar(
                        order: order,
                        onAddItem: { showMenuPicker = true },
                        onSendToKitchen: { app.sendToKitchen(tableId: tableId) },
                        onPay: { showPayment = true }
                    )
                }
            } else {
                VStack(spacing: 16) {
                    Text("Стол свободен")
                        .foregroundStyle(.gray)
                    Button("Открыть стол") {
                        app.openTable(tableId, guests: 2)
                    }
                    .buttonStyle(POSPrimaryButtonStyle())
                }
            }
        }
        .sheet(isPresented: $showMenuPicker) {
            MenuPickerSheet(tableId: tableId, onSelect: { item, qty, modifiers, note in
                app.addItem(to: tableId, item: item, qty: qty, modifiers: modifiers, note: note.isEmpty ? nil : note)
            })
            .environment(app)
        }
        .sheet(isPresented: $showPayment) {
            if let order {
                PaymentSheet(order: order, tableId: tableId)
                    .environment(app)
            }
        }
    }
}

// MARK: - Status Badge

struct OrderStatusBadge: View {
    let order: OrderState

    var body: some View {
        let pending = order.pendingItems.count
        let ready = order.readyItems.count
        let sent = order.sentItems.count

        HStack(spacing: 6) {
            if pending > 0 {
                Pill(text: "\(pending) черн.", color: .orange)
            }
            if sent > 0 {
                Pill(text: "\(sent) готов.", color: .blue)
            }
            if ready > 0 {
                Pill(text: "\(ready) готово", color: .green)
            }
        }
    }
}

struct Pill: View {
    let text: String
    let color: Color

    var body: some View {
        Text(text)
            .font(.caption2.weight(.semibold))
            .foregroundStyle(color)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(color.opacity(0.15))
            .clipShape(Capsule())
    }
}

// MARK: - Order Item Row

struct OrderItemRow: View {
    let item: OrderItemState
    let onRemove: () -> Void

    var body: some View {
        HStack(spacing: 14) {
            // Status dot
            Circle()
                .fill(statusColor)
                .frame(width: 8, height: 8)
                .padding(.leading, 20)

            VStack(alignment: .leading, spacing: 3) {
                HStack {
                    Text("×\(item.qty)")
                        .font(.caption.weight(.bold))
                        .foregroundStyle(.gray)
                    Text(item.name)
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(.white)
                    Spacer()
                    Text(item.lineTotal)
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(.white)
                        .padding(.trailing, 20)
                }
                if !item.modifierSummary.isEmpty {
                    Text(item.modifierSummary)
                        .font(.caption)
                        .foregroundStyle(Color(white: 0.4))
                }
                if let note = item.note, !note.isEmpty {
                    Text("» \(note)")
                        .font(.caption)
                        .foregroundStyle(.orange.opacity(0.8))
                }
                if let wait = item.waitMinutes, item.status == "sent" {
                    Text("\(wait) мин")
                        .font(.caption2)
                        .foregroundStyle(wait > 20 ? .red : .gray)
                }
            }
            .padding(.vertical, 14)
        }
        .swipeActions(edge: .trailing, allowsFullSwipe: true) {
            Button(role: .destructive, action: onRemove) {
                Label("Убрать", systemImage: "trash")
            }
        }
        .contentShape(Rectangle())
    }

    private var statusColor: Color {
        switch item.status {
        case "sent":    return .blue
        case "ready":   return .green
        case "served":  return Color(white: 0.25)
        default:        return .orange
        }
    }
}

// MARK: - Empty hint

struct EmptyOrderHint: View {
    var body: some View {
        VStack(spacing: 10) {
            Image(systemName: "fork.knife")
                .font(.system(size: 32))
                .foregroundStyle(Color(white: 0.2))
            Text("Нажми + чтобы добавить блюдо")
                .font(.subheadline)
                .foregroundStyle(Color(white: 0.3))
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 60)
    }
}

// MARK: - Bottom Bar

struct OrderBottomBar: View {
    let order: OrderState
    let onAddItem: () -> Void
    let onSendToKitchen: () -> Void
    let onPay: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            Divider().background(Color.white.opacity(0.08))

            // Totals
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    if order.discount_pct > 0 {
                        Text("Скидка \(Int(order.discount_pct))%")
                            .font(.caption)
                            .foregroundStyle(.orange)
                    }
                    Text("Итого")
                        .font(.caption)
                        .foregroundStyle(.gray)
                }
                Spacer()
                Text("€\(order.total, specifier: "%.2f")")
                    .font(.system(size: 24, weight: .black))
                    .foregroundStyle(.white)
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 14)

            // Action buttons
            HStack(spacing: 10) {
                Button(action: onAddItem) {
                    Image(systemName: "plus")
                        .font(.system(size: 18, weight: .bold))
                        .foregroundStyle(.white)
                        .frame(width: 50, height: 50)
                        .background(Color(white: 0.12))
                        .clipShape(Circle())
                }

                if order.pendingItems.count > 0 {
                    Button(action: onSendToKitchen) {
                        Label("На кухню", systemImage: "flame")
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(.white)
                            .frame(maxWidth: .infinity, minHeight: 50)
                            .background(Color(white: 0.14))
                            .clipShape(RoundedRectangle(cornerRadius: 14))
                    }
                }

                Button(action: onPay) {
                    Text("Оплатить")
                        .font(.system(size: 15, weight: .bold))
                        .foregroundStyle(.black)
                        .frame(maxWidth: .infinity, minHeight: 50)
                        .background(.white)
                        .clipShape(RoundedRectangle(cornerRadius: 14))
                }
                .disabled(order.items.isEmpty)
                .opacity(order.items.isEmpty ? 0.4 : 1)
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 24)
        }
        .background(Color(white: 0.05))
    }
}

// MARK: - Button style

struct POSPrimaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 15, weight: .bold))
            .foregroundStyle(.black)
            .padding(.horizontal, 28)
            .padding(.vertical, 13)
            .background(.white.opacity(configuration.isPressed ? 0.85 : 1))
            .clipShape(RoundedRectangle(cornerRadius: 12))
    }
}
