import SwiftUI

// MARK: - Payment Sheet

struct PaymentSheet: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    let order: OrderState
    let tableId: String

    @State private var method: PaymentMethod = .cash
    @State private var cashReceived: String = ""
    @State private var discountPct: Double = 0
    @State private var stage: Stage = .summary
    @State private var processing = false

    enum Stage { case summary, cash, done }
    enum PaymentMethod: String, CaseIterable {
        case cash = "cash"
        case card = "card"
        case split = "split"

        var label: String {
            switch self { case .cash: "Наличные"; case .card: "Карта"; case .split: "Сплит" }
        }
        var icon: String {
            switch self { case .cash: "banknote"; case .card: "creditcard"; case .split: "rectangle.split.2x1" }
        }
    }

    private var finalTotal: Double {
        order.total * (1 - discountPct / 100)
    }

    private var change: Double {
        let recv = Double(cashReceived.replacingOccurrences(of: ",", with: ".")) ?? 0
        return max(0, recv - finalTotal)
    }

    var body: some View {
        NavigationStack {
            ZStack {
                Color.black.ignoresSafeArea()

                switch stage {
                case .summary:
                    summaryView
                case .cash:
                    cashView
                case .done:
                    doneView
                }
            }
            .navigationTitle("Оплата")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(Color.black, for: .navigationBar)
            .toolbarColorScheme(.dark, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    if stage == .summary {
                        Button("Отмена") { dismiss() }
                            .foregroundStyle(.gray)
                    }
                }
            }
        }
    }

    // MARK: Summary

    private var summaryView: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                // Items summary
                VStack(alignment: .leading, spacing: 0) {
                    SectionHeader("Позиции")
                    ForEach(order.items) { item in
                        HStack {
                            Text("×\(item.qty)")
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(.gray)
                                .frame(width: 28, alignment: .leading)
                            Text(item.name)
                                .font(.system(size: 14))
                                .foregroundStyle(Color(white: 0.75))
                            Spacer()
                            Text(item.lineTotal)
                                .font(.system(size: 14, weight: .medium))
                                .foregroundStyle(Color(white: 0.75))
                        }
                        .padding(.horizontal, 20)
                        .padding(.vertical, 9)
                        Divider().background(Color.white.opacity(0.05)).padding(.leading, 20)
                    }
                }

                Spacer(minLength: 20)

                // Discount
                VStack(alignment: .leading, spacing: 0) {
                    SectionHeader("Скидка")
                    VStack(spacing: 10) {
                        HStack {
                            Text("\(Int(discountPct))%")
                                .font(.system(size: 20, weight: .black))
                                .foregroundStyle(discountPct > 0 ? .orange : Color(white: 0.3))
                                .frame(width: 48)
                            Slider(value: $discountPct, in: 0...50, step: 5)
                                .tint(.orange)
                        }
                        let presets: [Double] = [0, 5, 10, 15, 20, 25, 50]
                        HStack(spacing: 6) {
                            ForEach(presets, id: \.self) { p in
                                Button("\(Int(p))%") { discountPct = p }
                                    .font(.system(size: 12, weight: .semibold))
                                    .foregroundStyle(discountPct == p ? .black : Color(white: 0.5))
                                    .padding(.horizontal, 10)
                                    .padding(.vertical, 6)
                                    .background(discountPct == p ? .white : Color(white: 0.1))
                                    .clipShape(Capsule())
                            }
                        }
                    }
                    .padding(.horizontal, 20)
                    .padding(.vertical, 16)
                }

                Divider().background(Color.white.opacity(0.08))

                // Payment method
                VStack(alignment: .leading, spacing: 0) {
                    SectionHeader("Способ оплаты")
                    HStack(spacing: 10) {
                        ForEach(PaymentMethod.allCases, id: \.self) { m in
                            Button {
                                withAnimation(.spring(response: 0.2)) { method = m }
                            } label: {
                                VStack(spacing: 6) {
                                    Image(systemName: m.icon)
                                        .font(.system(size: 22))
                                    Text(m.label)
                                        .font(.system(size: 12, weight: .medium))
                                }
                                .foregroundStyle(method == m ? .black : Color(white: 0.5))
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 16)
                                .background(method == m ? .white : Color(white: 0.08))
                                .clipShape(RoundedRectangle(cornerRadius: 14))
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(.horizontal, 20)
                    .padding(.vertical, 16)
                }

                Divider().background(Color.white.opacity(0.08))

                // Totals
                VStack(spacing: 8) {
                    TotalRow(label: "Сумма", value: "€\(order.total, specifier: "%.2f")")
                    if discountPct > 0 {
                        TotalRow(label: "Скидка \(Int(discountPct))%", value: "-€\(order.total * discountPct / 100, specifier: "%.2f")", accent: .orange)
                    }
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 16)

                // Pay button
                Button {
                    if method == .cash {
                        stage = .cash
                    } else {
                        processPayment()
                    }
                } label: {
                    HStack {
                        Text(method == .cash ? "К оплате наличными" : method == .card ? "Приложить карту" : "Сплит")
                            .font(.system(size: 16, weight: .bold))
                        Spacer()
                        Text("€\(finalTotal, specifier: "%.2f")")
                            .font(.system(size: 18, weight: .black))
                    }
                    .foregroundStyle(.black)
                    .padding(.horizontal, 20)
                    .padding(.vertical, 18)
                    .background(.white)
                    .clipShape(RoundedRectangle(cornerRadius: 16))
                    .padding(.horizontal, 16)
                }
                .buttonStyle(.plain)
                .padding(.bottom, 32)
            }
        }
    }

    // MARK: Cash Entry

    private var cashView: some View {
        VStack(spacing: 32) {
            Spacer()

            VStack(spacing: 4) {
                Text("К оплате")
                    .font(.subheadline)
                    .foregroundStyle(.gray)
                Text("€\(finalTotal, specifier: "%.2f")")
                    .font(.system(size: 42, weight: .black))
                    .foregroundStyle(.white)
            }

            // Cash received display
            VStack(spacing: 6) {
                Text("Получено")
                    .font(.caption)
                    .foregroundStyle(.gray)
                Text(cashReceived.isEmpty ? "0.00" : cashReceived)
                    .font(.system(size: 32, weight: .bold, design: .monospaced))
                    .foregroundStyle(cashReceived.isEmpty ? Color(white: 0.25) : .white)

                if let recv = Double(cashReceived.replacingOccurrences(of: ",", with: ".")), recv >= finalTotal {
                    HStack(spacing: 4) {
                        Text("Сдача:")
                            .foregroundStyle(.gray)
                        Text("€\(change, specifier: "%.2f")")
                            .foregroundStyle(.green)
                    }
                    .font(.system(size: 16, weight: .semibold))
                    .transition(.opacity.combined(with: .scale))
                }
            }
            .animation(.spring(response: 0.2), value: cashReceived)

            // Quick amounts
            let quick: [Double] = [finalTotal, ceil(finalTotal / 5) * 5, ceil(finalTotal / 10) * 10, ceil(finalTotal / 50) * 50]
            let unique = Array(Set(quick)).sorted()
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(unique, id: \.self) { amt in
                        Button("€\(amt, specifier: "%.0f")") {
                            cashReceived = String(format: "%.2f", amt)
                        }
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 9)
                        .background(Color(white: 0.12))
                        .clipShape(Capsule())
                    }
                }
                .padding(.horizontal, 20)
            }

            // Numpad
            CashNumpad(value: $cashReceived)

            // Confirm
            Button {
                guard Double(cashReceived.replacingOccurrences(of: ",", with: ".")) ?? 0 >= finalTotal else { return }
                processPayment()
            } label: {
                Text("Принято — закрыть стол")
                    .font(.system(size: 16, weight: .bold))
                    .foregroundStyle(.black)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 16)
                    .background(
                        (Double(cashReceived.replacingOccurrences(of: ",", with: ".")) ?? 0) >= finalTotal
                            ? Color.white : Color(white: 0.2)
                    )
                    .clipShape(RoundedRectangle(cornerRadius: 16))
                    .padding(.horizontal, 16)
            }
            .buttonStyle(.plain)
            .disabled((Double(cashReceived.replacingOccurrences(of: ",", with: ".")) ?? 0) < finalTotal)
            .padding(.bottom, 16)

            Spacer()
        }
    }

    // MARK: Done

    private var doneView: some View {
        VStack(spacing: 28) {
            Spacer()
            ZStack {
                Circle()
                    .fill(Color.green.opacity(0.15))
                    .frame(width: 100, height: 100)
                Image(systemName: "checkmark")
                    .font(.system(size: 42, weight: .black))
                    .foregroundStyle(.green)
            }
            VStack(spacing: 6) {
                Text("Оплачено")
                    .font(.system(size: 28, weight: .black))
                    .foregroundStyle(.white)
                Text("€\(finalTotal, specifier: "%.2f") • \(method.label)")
                    .font(.subheadline)
                    .foregroundStyle(.gray)
                if method == .cash && change > 0 {
                    Text("Сдача: €\(change, specifier: "%.2f")")
                        .font(.system(size: 18, weight: .semibold))
                        .foregroundStyle(.green)
                }
            }
            Button("Готово") {
                dismiss()
            }
            .buttonStyle(POSPrimaryButtonStyle())
            Spacer()
        }
    }

    // MARK: Logic

    private func processPayment() {
        processing = true
        let cashAmt = method == .cash ? (Double(cashReceived.replacingOccurrences(of: ",", with: ".")) ?? finalTotal) : nil
        let changeAmt = cashAmt.map { max(0, $0 - finalTotal) } ?? 0
        let input = PaymentInput(
            id: UUID().uuidString,
            method: method.rawValue,
            amount: finalTotal,
            tipAmount: 0,
            changeAmount: changeAmt,
            cashTendered: cashAmt,
            stripePaymentIntentId: nil
        )
        app.pay(tableId: tableId, input: input)
        withAnimation(.spring(response: 0.4)) { stage = .done }
        processing = false
    }
}

// MARK: - Cash Numpad

private struct CashNumpad: View {
    @Binding var value: String

    private let keys = [["7","8","9"],["4","5","6"],["1","2","3"],[".","0","⌫"]]

    var body: some View {
        VStack(spacing: 10) {
            ForEach(keys, id: \.self) { row in
                HStack(spacing: 10) {
                    ForEach(row, id: \.self) { key in
                        Button { tap(key) } label: {
                            Text(key == "⌫" ? "⌫" : key)
                                .font(.system(size: 22, weight: key == "⌫" ? .regular : .semibold))
                                .foregroundStyle(.white)
                                .frame(maxWidth: .infinity)
                                .frame(height: 58)
                                .background(key == "⌫" ? Color(white: 0.1) : Color(white: 0.12))
                                .clipShape(RoundedRectangle(cornerRadius: 12))
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
        .padding(.horizontal, 16)
    }

    private func tap(_ key: String) {
        switch key {
        case "⌫":
            if !value.isEmpty { value.removeLast() }
        case ".":
            if !value.contains(".") { value += value.isEmpty ? "0." : "." }
        default:
            // Max 2 decimal places
            if let dot = value.firstIndex(of: ".") {
                let decimals = value.distance(from: dot, to: value.endIndex) - 1
                if decimals >= 2 { return }
            }
            value += key
        }
    }
}

// MARK: - Helpers

private struct SectionHeader: View {
    let title: String
    init(_ title: String) { self.title = title }
    var body: some View {
        Text(title)
            .font(.system(size: 11, weight: .semibold))
            .foregroundStyle(Color(white: 0.4))
            .textCase(.uppercase)
            .tracking(0.5)
            .padding(.horizontal, 20)
            .padding(.top, 20)
            .padding(.bottom, 10)
    }
}

private struct TotalRow: View {
    let label: String
    let value: String
    var accent: Color = Color(white: 0.6)

    var body: some View {
        HStack {
            Text(label)
                .font(.system(size: 14))
                .foregroundStyle(Color(white: 0.5))
            Spacer()
            Text(value)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(accent)
        }
    }
}
