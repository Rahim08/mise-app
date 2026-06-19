import SwiftUI

// MARK: - Session View (cash shift manager)

struct SessionView: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        NavigationStack {
            ZStack {
                Color.black.ignoresSafeArea()
                if let session = app.activeSession {
                    OpenSessionView(session: session)
                } else {
                    OpenShiftView()
                }
            }
            .navigationTitle("Смена")
            .navigationBarTitleDisplayMode(.large)
            .toolbarColorScheme(.dark, for: .navigationBar)
        }
    }
}

// MARK: - No active session

struct OpenShiftView: View {
    @Environment(AppModel.self) private var app
    @State private var openingCash = ""
    @State private var loading = false

    var body: some View {
        VStack(spacing: 40) {
            Spacer()

            VStack(spacing: 8) {
                Image(systemName: "key.fill")
                    .font(.system(size: 48))
                    .foregroundStyle(Color(white: 0.2))
                Text("Смена закрыта")
                    .font(.system(size: 24, weight: .bold))
                    .foregroundStyle(.white)
                Text("Введите сумму наличных\nв кассе на начало смены")
                    .font(.subheadline)
                    .foregroundStyle(.gray)
                    .multilineTextAlignment(.center)
            }

            VStack(spacing: 12) {
                HStack {
                    Text("€")
                        .font(.system(size: 32, weight: .light))
                        .foregroundStyle(Color(white: 0.4))
                    TextField("0.00", text: $openingCash)
                        .font(.system(size: 40, weight: .bold, design: .monospaced))
                        .foregroundStyle(.white)
                        .keyboardType(.decimalPad)
                        .multilineTextAlignment(.center)
                }
                .padding(.horizontal, 32)

                let quick: [Double] = [0, 50, 100, 200, 500]
                HStack(spacing: 8) {
                    ForEach(quick, id: \.self) { amt in
                        Button("€\(Int(amt))") {
                            openingCash = amt == 0 ? "0" : String(format: "%.2f", amt)
                        }
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 7)
                        .background(Color(white: 0.1))
                        .clipShape(Capsule())
                    }
                }
            }

            Button {
                loading = true
                let cash = Double(openingCash.replacingOccurrences(of: ",", with: ".")) ?? 0
                app.openShift(openingCash: cash)
            } label: {
                HStack {
                    if loading {
                        ProgressView().tint(.black)
                    } else {
                        Image(systemName: "play.fill")
                        Text("Открыть смену")
                    }
                }
                .font(.system(size: 16, weight: .bold))
                .foregroundStyle(.black)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 16)
                .background(.white)
                .clipShape(RoundedRectangle(cornerRadius: 16))
                .padding(.horizontal, 24)
            }
            .buttonStyle(.plain)
            .disabled(loading)

            Spacer()
        }
    }
}

// MARK: - Active session

struct OpenSessionView: View {
    @Environment(AppModel.self) private var app
    let session: POSSession

    @State private var showPayin = false
    @State private var showPayout = false
    @State private var showClose = false
    @State private var showXReport = false

    private var elapsed: String {
        let mins = Int(-session.openedAt.timeIntervalSinceNow / 60)
        if mins < 60 { return "\(mins) мин" }
        return "\(mins / 60)ч \(mins % 60)м"
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 20) {
                // Session header card
                VStack(spacing: 0) {
                    HStack {
                        VStack(alignment: .leading, spacing: 4) {
                            HStack(spacing: 6) {
                                Circle().fill(.green).frame(width: 8, height: 8)
                                Text("Смена открыта")
                                    .font(.caption.weight(.semibold))
                                    .foregroundStyle(.green)
                            }
                            Text(session.openedAt, style: .time)
                                .font(.system(size: 28, weight: .black))
                                .foregroundStyle(.white)
                            Text("Уже \(elapsed)")
                                .font(.caption)
                                .foregroundStyle(.gray)
                        }
                        Spacer()
                        VStack(alignment: .trailing, spacing: 4) {
                            Text("Касса")
                                .font(.caption)
                                .foregroundStyle(.gray)
                            Text("€\(session.openingCash, specifier: "%.2f")")
                                .font(.system(size: 20, weight: .bold))
                                .foregroundStyle(.white)
                        }
                    }
                    .padding(20)

                    Divider().background(Color.white.opacity(0.08))

                    // Sales grid
                    LazyVGrid(columns: Array(repeating: GridItem(.flexible()), count: 2), spacing: 1) {
                        StatCell(label: "Продажи", value: "€\(session.totalSales, specifier: "%.2f")", accent: .green)
                        StatCell(label: "Наличные", value: "€\(session.totalCash, specifier: "%.2f")")
                        StatCell(label: "Карта", value: "€\(session.totalCard, specifier: "%.2f")")
                        StatCell(label: "Скидки", value: "€\(session.totalDiscount, specifier: "%.2f")", accent: .orange)
                    }
                }
                .background(Color(white: 0.08))
                .clipShape(RoundedRectangle(cornerRadius: 18))
                .padding(.horizontal, 16)
                .padding(.top, 16)

                // Actions
                VStack(spacing: 10) {
                    HStack(spacing: 10) {
                        SessionActionButton(icon: "arrow.down.circle.fill", label: "Внесение", color: .green) {
                            showPayin = true
                        }
                        SessionActionButton(icon: "arrow.up.circle.fill", label: "Изъятие", color: .orange) {
                            showPayout = true
                        }
                    }
                    HStack(spacing: 10) {
                        SessionActionButton(icon: "doc.text", label: "X-отчёт", color: Color(white: 0.5)) {
                            showXReport = true
                        }
                        SessionActionButton(icon: "stop.circle.fill", label: "Закрыть смену", color: .red) {
                            showClose = true
                        }
                    }
                }
                .padding(.horizontal, 16)

                // Payin/payout history
                if !session.payins.isEmpty || !session.payouts.isEmpty {
                    CashMovementsList(session: session)
                        .padding(.horizontal, 16)
                }
            }
            .padding(.bottom, 32)
        }
        .sheet(isPresented: $showPayin) {
            CashMovementSheet(type: .payin) { amount, note in
                app.recordPayin(amount: amount, note: note)
            }
        }
        .sheet(isPresented: $showPayout) {
            CashMovementSheet(type: .payout) { amount, note in
                app.recordPayout(amount: amount, note: note)
            }
        }
        .sheet(isPresented: $showXReport) {
            XReportSheet(session: session)
        }
        .confirmationDialog("Закрыть смену?", isPresented: $showClose, titleVisibility: .visible) {
            Button("Закрыть и сформировать Z-отчёт", role: .destructive) {
                app.closeShift()
            }
            Button("Отмена", role: .cancel) {}
        } message: {
            Text("Продажи: €\(session.totalSales, specifier: "%.2f")")
        }
    }
}

// MARK: - Stat Cell

struct StatCell: View {
    let label: String
    let value: String
    var accent: Color = .white

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label)
                .font(.caption)
                .foregroundStyle(Color(white: 0.4))
            Text(value)
                .font(.system(size: 20, weight: .bold))
                .foregroundStyle(accent)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(Color(white: 0.06))
    }
}

// MARK: - Action Button

struct SessionActionButton: View {
    let icon: String
    let label: String
    let color: Color
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 10) {
                Image(systemName: icon)
                    .font(.system(size: 20))
                    .foregroundStyle(color)
                Text(label)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(.white)
                Spacer()
            }
            .padding(16)
            .background(Color(white: 0.1))
            .clipShape(RoundedRectangle(cornerRadius: 14))
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Cash Movement Sheet

struct CashMovementSheet: View {
    enum MovementType { case payin, payout }
    @Environment(\.dismiss) private var dismiss
    let type: MovementType
    let onConfirm: (Double, String) -> Void

    @State private var amount = ""
    @State private var note = ""

    var body: some View {
        NavigationStack {
            ZStack {
                Color.black.ignoresSafeArea()
                VStack(spacing: 32) {
                    Spacer()

                    VStack(spacing: 8) {
                        Image(systemName: type == .payin ? "arrow.down.circle.fill" : "arrow.up.circle.fill")
                            .font(.system(size: 44))
                            .foregroundStyle(type == .payin ? .green : .orange)
                        Text(type == .payin ? "Внесение в кассу" : "Изъятие из кассы")
                            .font(.system(size: 22, weight: .bold))
                            .foregroundStyle(.white)
                    }

                    HStack {
                        Text("€")
                            .font(.system(size: 32, weight: .light))
                            .foregroundStyle(Color(white: 0.4))
                        TextField("0.00", text: $amount)
                            .font(.system(size: 44, weight: .black, design: .monospaced))
                            .foregroundStyle(.white)
                            .keyboardType(.decimalPad)
                            .multilineTextAlignment(.center)
                    }
                    .padding(.horizontal, 24)

                    TextField("Причина (необязательно)", text: $note)
                        .font(.system(size: 15))
                        .foregroundStyle(.white)
                        .padding(14)
                        .background(Color(white: 0.1))
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                        .padding(.horizontal, 20)

                    Button {
                        guard let amt = Double(amount.replacingOccurrences(of: ",", with: ".")), amt > 0 else { return }
                        onConfirm(amt, note)
                        dismiss()
                    } label: {
                        Text("Подтвердить")
                            .font(.system(size: 16, weight: .bold))
                            .foregroundStyle(.black)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 16)
                            .background(amount.isEmpty ? Color(white: 0.2) : .white)
                            .clipShape(RoundedRectangle(cornerRadius: 16))
                            .padding(.horizontal, 20)
                    }
                    .buttonStyle(.plain)
                    .disabled(amount.isEmpty)

                    Spacer()
                }
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbarColorScheme(.dark, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Отмена") { dismiss() }.foregroundStyle(.gray)
                }
            }
        }
        .presentationBackground(Color.black)
        .presentationDetents([.medium])
    }
}

// MARK: - X-Report Sheet

struct XReportSheet: View {
    @Environment(\.dismiss) private var dismiss
    let session: POSSession

    var body: some View {
        NavigationStack {
            ZStack {
                Color.black.ignoresSafeArea()
                ScrollView {
                    VStack(alignment: .leading, spacing: 0) {
                        // Header
                        VStack(alignment: .center, spacing: 4) {
                            Text("X-ОТЧЁТ")
                                .font(.system(size: 14, weight: .black, design: .monospaced))
                                .tracking(4)
                                .foregroundStyle(.white)
                            Text(Date(), style: .date)
                                .font(.system(size: 12, design: .monospaced))
                                .foregroundStyle(.gray)
                            Text(Date(), style: .time)
                                .font(.system(size: 12, design: .monospaced))
                                .foregroundStyle(.gray)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 20)

                        Divider().background(Color.white.opacity(0.15))

                        Group {
                            ReportRow(label: "Открытие смены", value: session.openedAt.formatted(date: .omitted, time: .shortened))
                            ReportRow(label: "Нач. остаток кассы", value: "€\(session.openingCash, specifier: "%.2f")")

                            Divider().background(Color.white.opacity(0.08)).padding(.vertical, 8)

                            ReportRow(label: "ПРОДАЖИ ИТОГО", value: "€\(session.totalSales, specifier: "%.2f")", bold: true)
                            ReportRow(label: "  Наличные", value: "€\(session.totalCash, specifier: "%.2f")")
                            ReportRow(label: "  Карта", value: "€\(session.totalCard, specifier: "%.2f")")
                            ReportRow(label: "Скидки", value: "€\(session.totalDiscount, specifier: "%.2f")")
                            ReportRow(label: "Компы", value: "€\(session.totalComps, specifier: "%.2f")")

                            if !session.payins.isEmpty {
                                Divider().background(Color.white.opacity(0.08)).padding(.vertical, 8)
                                Text("ВНЕСЕНИЯ")
                                    .font(.system(size: 11, design: .monospaced))
                                    .foregroundStyle(.gray)
                                    .padding(.horizontal, 20)
                                ForEach(session.payins) { p in
                                    ReportRow(label: p.note ?? "Внесение", value: "€\(p.amount, specifier: "%.2f")", accent: .green)
                                }
                            }

                            if !session.payouts.isEmpty {
                                Divider().background(Color.white.opacity(0.08)).padding(.vertical, 8)
                                Text("ИЗЪЯТИЯ")
                                    .font(.system(size: 11, design: .monospaced))
                                    .foregroundStyle(.gray)
                                    .padding(.horizontal, 20)
                                ForEach(session.payouts) { p in
                                    ReportRow(label: p.note ?? "Изъятие", value: "€\(p.amount, specifier: "%.2f")", accent: .orange)
                                }
                            }

                            Divider().background(Color.white.opacity(0.15)).padding(.vertical, 8)

                            let expectedCash = session.openingCash + session.totalCash
                                + session.payins.reduce(0) { $0 + $1.amount }
                                - session.payouts.reduce(0) { $0 + $1.amount }
                            ReportRow(label: "ОЖИД. В КАССЕ", value: "€\(expectedCash, specifier: "%.2f")", bold: true)
                        }
                        .padding(.horizontal, 20)
                    }
                    .padding(.bottom, 40)
                }
            }
            .navigationTitle("X-Отчёт")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarColorScheme(.dark, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Закрыть") { dismiss() }.foregroundStyle(.gray)
                }
                ToolbarItem(placement: .topBarTrailing) {
                    ShareLink(item: buildReportText())
                }
            }
        }
        .presentationBackground(Color.black)
    }

    private func buildReportText() -> String {
        """
        X-ОТЧЁТ \(Date().formatted())
        Открытие: \(session.openedAt.formatted())
        Нач. остаток: €\(String(format: "%.2f", session.openingCash))
        Продажи: €\(String(format: "%.2f", session.totalSales))
          Наличные: €\(String(format: "%.2f", session.totalCash))
          Карта: €\(String(format: "%.2f", session.totalCard))
        Скидки: €\(String(format: "%.2f", session.totalDiscount))
        """
    }
}

private struct ReportRow: View {
    let label: String
    let value: String
    var bold = false
    var accent: Color = Color(white: 0.6)

    var body: some View {
        HStack {
            Text(label)
                .font(.system(size: 13, weight: bold ? .bold : .regular, design: .monospaced))
                .foregroundStyle(bold ? .white : Color(white: 0.5))
            Spacer()
            Text(value)
                .font(.system(size: 13, weight: bold ? .black : .regular, design: .monospaced))
                .foregroundStyle(bold ? .white : accent)
        }
        .padding(.vertical, 5)
    }
}

// MARK: - Cash movements list

struct CashMovementsList: View {
    let session: POSSession

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Движение наличных")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color(white: 0.4))
                .textCase(.uppercase)
                .tracking(0.5)

            VStack(spacing: 0) {
                ForEach(session.payins) { p in
                    MovementRow(amount: p.amount, note: p.note ?? "Внесение", date: p.createdAt, isPayin: true)
                    Divider().background(Color.white.opacity(0.06))
                }
                ForEach(session.payouts) { p in
                    MovementRow(amount: p.amount, note: p.note ?? "Изъятие", date: p.createdAt, isPayin: false)
                    Divider().background(Color.white.opacity(0.06))
                }
            }
            .background(Color(white: 0.08))
            .clipShape(RoundedRectangle(cornerRadius: 14))
        }
    }
}

private struct MovementRow: View {
    let amount: Double
    let note: String
    let date: Date
    let isPayin: Bool

    var body: some View {
        HStack {
            Image(systemName: isPayin ? "arrow.down" : "arrow.up")
                .font(.caption.weight(.bold))
                .foregroundStyle(isPayin ? .green : .orange)
                .frame(width: 28)
            VStack(alignment: .leading, spacing: 2) {
                Text(note)
                    .font(.system(size: 14))
                    .foregroundStyle(.white)
                Text(date, style: .time)
                    .font(.caption)
                    .foregroundStyle(.gray)
            }
            Spacer()
            Text("€\(amount, specifier: "%.2f")")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(isPayin ? .green : .orange)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
    }
}
