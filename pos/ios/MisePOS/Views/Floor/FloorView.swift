import SwiftUI

struct FloorView: View {
    @Environment(AppModel.self) private var app
    @State private var selectedTable: TableState?
    @State private var showOpenTable = false
    @State private var showOrder = false

    var body: some View {
        NavigationStack {
            ZStack {
                Color(white: 0.05).ignoresSafeArea()

                if app.tables.isEmpty {
                    emptyState
                } else {
                    tableGrid
                }
            }
            .navigationTitle("Зал")
            .navigationBarTitleDisplayMode(.large)
            .toolbarColorScheme(.dark, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    statsChip
                }
            }
            .sheet(item: $selectedTable) { table in
                if table.isOccupied {
                    TableDetailSheet(table: table)
                } else {
                    OpenTableSheet(table: table)
                }
            }
        }
    }

    // MARK: - Grid

    private var tableGrid: some View {
        ScrollView {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 160), spacing: 12)], spacing: 12) {
                ForEach(app.tables) { table in
                    TableCard(table: table)
                        .onTapGesture { selectedTable = table }
                        .contextMenu {
                            tableContextMenu(table)
                        }
                }
            }
            .padding()
        }
    }

    @ViewBuilder
    private func tableContextMenu(_ table: TableState) -> some View {
        if table.isOccupied {
            Button("Разделить счёт", systemImage: "arrow.triangle.branch") {}
            Button("Перенести стол", systemImage: "arrow.right") {}
            Button("Позвать менеджера", systemImage: "person.badge.shield.checkmark") {}
            Divider()
            Button("Закрыть стол", systemImage: "xmark.circle", role: .destructive) {
                app.closeTable(table.id)
            }
        } else {
            Button("Открыть стол", systemImage: "person.badge.plus") {
                selectedTable = table
            }
        }
    }

    // MARK: - Stats chip

    private var statsChip: some View {
        let occupied = app.tables.filter(\.isOccupied).count
        let total = app.tables.count
        return Text("\(occupied)/\(total)")
            .font(.caption.weight(.semibold))
            .foregroundStyle(.white)
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(occupied > 0 ? Color.white.opacity(0.15) : Color.white.opacity(0.06))
            .clipShape(Capsule())
    }

    // MARK: - Empty state

    private var emptyState: some View {
        VStack(spacing: 16) {
            Image(systemName: "table.furniture")
                .font(.system(size: 48))
                .foregroundStyle(.white.opacity(0.2))
            Text("Нет столов")
                .font(.headline)
                .foregroundStyle(.white.opacity(0.4))
            Text("Добавьте столы в бэк-офисе")
                .font(.subheadline)
                .foregroundStyle(.white.opacity(0.25))
        }
    }
}

// MARK: - Table Card

struct TableCard: View {
    let table: TableState

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text(table.displayName)
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(.white)
                Spacer()
                statusBadge
            }

            if table.isOccupied, let seating = table.seating {
                Divider().background(.white.opacity(0.1))

                HStack(spacing: 4) {
                    Image(systemName: "person.2")
                        .font(.caption)
                        .foregroundStyle(.white.opacity(0.4))
                    Text("\(seating.guestsCount)")
                        .font(.caption)
                        .foregroundStyle(.white.opacity(0.6))
                    Spacer()
                    if let dur = table.openDuration {
                        Text(dur)
                            .font(.caption.monospacedDigit())
                            .foregroundStyle(durationColor)
                    }
                }

                if let order = seating.order {
                    Text("€\(String(format: "%.2f", order.total))")
                        .font(.system(size: 22, weight: .bold))
                        .foregroundStyle(.white)

                    if !order.readyItems.isEmpty {
                        Label("\(order.readyItems.count) готово", systemImage: "checkmark.circle.fill")
                            .font(.caption.weight(.medium))
                            .foregroundStyle(.green)
                    }
                }
            } else {
                Text("Свободен · \(table.capacity) мест")
                    .font(.caption)
                    .foregroundStyle(.white.opacity(0.3))
            }
        }
        .padding(16)
        .background(cardBackground)
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .overlay(
            RoundedRectangle(cornerRadius: 16)
                .stroke(statusBorderColor, lineWidth: 1)
        )
    }

    private var statusBadge: some View {
        Circle()
            .fill(statusColor)
            .frame(width: 10, height: 10)
    }

    private var statusColor: Color {
        switch table.status {
        case .free:          return .green.opacity(0.8)
        case .occupied:      return .orange
        case .billRequested: return .red
        case .reserved:      return .blue
        case .blocked:       return .gray
        }
    }

    private var statusBorderColor: Color {
        switch table.status {
        case .billRequested: return .red.opacity(0.5)
        default:             return .white.opacity(0.07)
        }
    }

    private var cardBackground: some ShapeStyle {
        switch table.status {
        case .free:    return Color(white: 0.1).opacity(0.8)
        case .occupied: return Color(white: 0.13)
        default:       return Color(white: 0.11)
        }
    }

    private var durationColor: Color {
        guard let seating = table.seating,
              let mins = table.openDuration else { return .gray }
        let elapsed = Int(-seating.openedAt.timeIntervalSinceNow / 60)
        if elapsed > 90 { return .red }
        if elapsed > 45 { return .yellow }
        return .white.opacity(0.5)
    }
}

// MARK: - Open table sheet

struct OpenTableSheet: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    let table: TableState

    @State private var guests = 2

    var body: some View {
        NavigationStack {
            VStack(spacing: 32) {
                VStack(spacing: 8) {
                    Text(table.displayName)
                        .font(.title2.weight(.bold))
                        .foregroundStyle(.white)
                    Text("Свободен · \(table.capacity) мест")
                        .font(.subheadline)
                        .foregroundStyle(.gray)
                }

                VStack(spacing: 12) {
                    Text("Количество гостей")
                        .font(.subheadline)
                        .foregroundStyle(.gray)

                    HStack(spacing: 24) {
                        Button {
                            if guests > 1 { guests -= 1 }
                        } label: {
                            Image(systemName: "minus.circle.fill")
                                .font(.system(size: 36))
                                .foregroundStyle(guests > 1 ? .white : .white.opacity(0.2))
                        }
                        .disabled(guests <= 1)

                        Text("\(guests)")
                            .font(.system(size: 56, weight: .bold, design: .rounded))
                            .foregroundStyle(.white)
                            .frame(minWidth: 80)

                        Button {
                            if guests < table.capacity { guests += 1 }
                        } label: {
                            Image(systemName: "plus.circle.fill")
                                .font(.system(size: 36))
                                .foregroundStyle(guests < table.capacity ? .white : .white.opacity(0.2))
                        }
                        .disabled(guests >= table.capacity)
                    }
                }

                Spacer()

                Button {
                    app.openTable(table.id, guests: guests)
                    dismiss()
                } label: {
                    Text("Открыть стол")
                        .font(.headline)
                        .foregroundStyle(.black)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 18)
                        .background(.white)
                        .clipShape(RoundedRectangle(cornerRadius: 16))
                }
            }
            .padding(24)
            .background(Color(white: 0.08))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Отмена") { dismiss() }
                        .foregroundStyle(.gray)
                }
            }
        }
        .presentationDetents([.medium])
        .presentationBackground(Color(white: 0.08))
    }
}

// MARK: - Table detail sheet

struct TableDetailSheet: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var showAddItem = false
    let table: TableState

    var order: OrderState? { table.seating?.order }

    var body: some View {
        NavigationStack {
            ZStack(alignment: .bottom) {
                Color(white: 0.06).ignoresSafeArea()

                VStack(spacing: 0) {
                    // Order items
                    if let order {
                        List {
                            ForEach(order.items) { item in
                                FloorOrderItemRow(item: item)
                                    .listRowBackground(Color.clear)
                                    .listRowSeparatorTint(.white.opacity(0.08))
                                    .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                                        if item.status == "pending" {
                                            Button(role: .destructive) {
                                                app.removeItem(item.id, from: table.id)
                                            } label: {
                                                Label("Удалить", systemImage: "trash")
                                            }
                                        }
                                    }
                            }

                            // Total row
                            HStack {
                                Text("Итого")
                                    .font(.headline)
                                    .foregroundStyle(.white)
                                Spacer()
                                Text("€\(String(format: "%.2f", order.total))")
                                    .font(.system(size: 20, weight: .bold))
                                    .foregroundStyle(.white)
                            }
                            .listRowBackground(Color.clear)
                        }
                        .listStyle(.plain)
                        .scrollContentBackground(.hidden)
                    } else {
                        Spacer()
                        Text("Заказ пустой")
                            .foregroundStyle(.gray)
                        Spacer()
                    }
                }
                .padding(.bottom, 100)

                // Action bar
                VStack(spacing: 0) {
                    Divider().background(.white.opacity(0.1))
                    HStack(spacing: 12) {
                        Button {
                            showAddItem = true
                        } label: {
                            Label("Добавить", systemImage: "plus")
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(.white)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 14)
                                .background(.white.opacity(0.1))
                                .clipShape(RoundedRectangle(cornerRadius: 12))
                        }

                        if let order, !order.pendingItems.isEmpty {
                            Button {
                                app.sendToKitchen(tableId: table.id)
                                dismiss()
                            } label: {
                                Label("На кухню", systemImage: "arrow.up.circle.fill")
                                    .font(.subheadline.weight(.semibold))
                                    .foregroundStyle(.black)
                                    .frame(maxWidth: .infinity)
                                    .padding(.vertical, 14)
                                    .background(.white)
                                    .clipShape(RoundedRectangle(cornerRadius: 12))
                            }
                        }

                        if let order, order.total > 0 {
                            Button {
                                // TODO: open payment sheet
                            } label: {
                                Label("Счёт", systemImage: "creditcard")
                                    .font(.subheadline.weight(.semibold))
                                    .foregroundStyle(.black)
                                    .frame(maxWidth: .infinity)
                                    .padding(.vertical, 14)
                                    .background(.green)
                                    .clipShape(RoundedRectangle(cornerRadius: 12))
                            }
                        }
                    }
                    .padding(16)
                    .background(Color(white: 0.06))
                }
            }
            .navigationTitle(table.displayName)
            .navigationBarTitleDisplayMode(.inline)
            .toolbarColorScheme(.dark, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Закрыть") { dismiss() }
                        .foregroundStyle(.gray)
                }
            }
            .sheet(isPresented: $showAddItem) {
                MenuPickerSheet(tableId: table.id)
                    .environment(app)
            }
        }
        .presentationBackground(Color(white: 0.06))
    }
}

// MARK: - Order item row (floor/detail variant)

struct FloorOrderItemRow: View {
    let item: OrderItemState

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            statusDot
            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text("\(item.qty)×")
                        .font(.subheadline.weight(.bold))
                        .foregroundStyle(.white.opacity(0.5))
                    Text(item.name)
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(.white)
                }
                if !item.modifierSummary.isEmpty {
                    Text(item.modifierSummary)
                        .font(.caption)
                        .foregroundStyle(.white.opacity(0.4))
                }
                if let note = item.note {
                    Text("» \(note)")
                        .font(.caption)
                        .foregroundStyle(.yellow.opacity(0.7))
                }
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 4) {
                Text(item.lineTotal)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.white)
                if let mins = item.waitMinutes {
                    Text("\(mins)м")
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(mins > 10 ? .red : .gray)
                }
            }
        }
        .padding(.vertical, 4)
    }

    private var statusDot: some View {
        Circle()
            .fill(dotColor)
            .frame(width: 8, height: 8)
            .padding(.top, 5)
    }

    private var dotColor: Color {
        switch item.status {
        case "pending":         return .white.opacity(0.2)
        case "sent", "cooking": return .yellow
        case "ready":           return .green
        case "served":          return .white.opacity(0.15)
        default:                return .red.opacity(0.4)
        }
    }
}

// MARK: - Menu picker sheet

struct MenuPickerSheet: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    // When tableId is provided, adds item directly via AppModel
    // When onSelect is provided, the caller handles adding (e.g. OrderView with full modifier flow)
    var tableId: String? = nil
    var onSelect: ((MenuItem, Int, [ModifierSelection], String) -> Void)? = nil

    @State private var selectedCategory: String?
    @State private var searchText = ""
    @State private var pendingItem: MenuItem? = nil

    private var categories: [MenuCategory] { app.menu?.categories ?? [] }
    private var filteredItems: [MenuItem] {
        guard let menu = app.menu else { return [] }
        var items = menu.items.filter(\.isAvailable)
        if let cat = selectedCategory { items = items.filter { $0.categoryId == cat } }
        if !searchText.isEmpty { items = items.filter { $0.name.localizedCaseInsensitiveContains(searchText) } }
        return items.sorted { $0.sort < $1.sort }
    }

    var body: some View {
        NavigationStack {
            ZStack {
                Color(white: 0.06).ignoresSafeArea()

                VStack(spacing: 0) {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) {
                            CategoryChip(name: "Все", selected: selectedCategory == nil) {
                                selectedCategory = nil
                            }
                            ForEach(categories) { cat in
                                CategoryChip(name: cat.name, selected: selectedCategory == cat.id) {
                                    selectedCategory = cat.id
                                }
                            }
                        }
                        .padding(.horizontal, 16)
                        .padding(.vertical, 12)
                    }

                    Divider().background(.white.opacity(0.08))

                    List {
                        ForEach(filteredItems) { item in
                            Button {
                                handleSelect(item)
                            } label: {
                                MenuItemRow(item: item)
                            }
                            .listRowBackground(Color.clear)
                            .listRowSeparatorTint(.white.opacity(0.08))
                        }
                    }
                    .listStyle(.plain)
                    .scrollContentBackground(.hidden)
                }
            }
            .searchable(text: $searchText, prompt: "Поиск блюда")
            .navigationTitle("Добавить блюдо")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarColorScheme(.dark, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Отмена") { dismiss() }
                        .foregroundStyle(.gray)
                }
            }
            .sheet(item: $pendingItem) { item in
                ModifierSheet(item: item) { qty, mods, note in
                    if let onSelect {
                        onSelect(item, qty, mods, note)
                    } else if let tid = tableId {
                        app.addItem(to: tid, item: item, qty: qty, modifiers: mods, note: note.isEmpty ? nil : note)
                    }
                    dismiss()
                }
                .environment(app)
            }
        }
        .presentationBackground(Color(white: 0.06))
    }

    private func handleSelect(_ item: MenuItem) {
        let hasModifiers = !(item.modifier_groups ?? []).isEmpty
        if hasModifiers {
            pendingItem = item
        } else {
            if let onSelect {
                onSelect(item, 1, [], "")
            } else if let tid = tableId {
                app.addItem(to: tid, item: item)
            }
            dismiss()
        }
    }
}

struct CategoryChip: View {
    let name: String
    let selected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(name)
                .font(.subheadline.weight(selected ? .semibold : .regular))
                .foregroundStyle(selected ? .black : .white)
                .padding(.horizontal, 14)
                .padding(.vertical, 8)
                .background(selected ? Color.white : Color.white.opacity(0.1))
                .clipShape(Capsule())
        }
        .buttonStyle(.plain)
    }
}

struct MenuItemRow: View {
    let item: MenuItem

    var body: some View {
        HStack(spacing: 14) {
            if let url = item.photoUrl {
                AsyncImage(url: URL(string: url)) { img in
                    img.resizable().scaledToFill()
                } placeholder: {
                    Color.white.opacity(0.06)
                }
                .frame(width: 56, height: 56)
                .clipShape(RoundedRectangle(cornerRadius: 10))
            } else {
                RoundedRectangle(cornerRadius: 10)
                    .fill(.white.opacity(0.06))
                    .frame(width: 56, height: 56)
                    .overlay {
                        Image(systemName: "fork.knife")
                            .foregroundStyle(.white.opacity(0.2))
                    }
            }

            VStack(alignment: .leading, spacing: 4) {
                Text(item.name)
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(.white)
                if let desc = item.description {
                    Text(desc)
                        .font(.caption)
                        .foregroundStyle(.gray)
                        .lineLimit(1)
                }
                if let g = item.yieldG {
                    Text("\(Int(g))г")
                        .font(.caption)
                        .foregroundStyle(.white.opacity(0.35))
                }
            }

            Spacer()

            Text(item.formattedPrice)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.white)
        }
        .padding(.vertical, 4)
    }
}

// MARK: - KDS (Kitchen Display System)

struct KDSView: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        NavigationStack {
            ZStack {
                Color.black.ignoresSafeArea()

                let tickets = buildTickets()

                if tickets.isEmpty {
                    VStack(spacing: 12) {
                        Image(systemName: "checkmark.circle")
                            .font(.system(size: 48))
                            .foregroundStyle(.green.opacity(0.5))
                        Text("Нет активных тикетов")
                            .foregroundStyle(.gray)
                    }
                } else {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(alignment: .top, spacing: 12) {
                            ForEach(tickets) { ticket in
                                KDSTicketCard(ticket: ticket)
                            }
                        }
                        .padding(16)
                    }
                }
            }
            .navigationTitle("Кухня")
            .navigationBarTitleDisplayMode(.large)
            .toolbarColorScheme(.dark, for: .navigationBar)
        }
    }

    private func buildTickets() -> [KDSTicket] {
        app.tables.compactMap { table -> KDSTicket? in
            guard let order = table.seating?.order else { return nil }
            let items = order.items.filter { $0.status == "sent" || $0.status == "cooking" }
            guard !items.isEmpty else { return nil }
            return KDSTicket(
                id: order.id,
                tableNumber: table.number,
                tableLabel: table.label,
                openedAt: table.seating?.openedAt ?? Date(),
                items: items
            )
        }
    }
}

struct KDSTicket: Identifiable {
    let id: String
    let tableNumber: String
    let tableLabel: String?
    let openedAt: Date
    let items: [OrderItemState]

    var waitMinutes: Int { Int(-openedAt.timeIntervalSinceNow / 60) }
}

struct KDSTicketCard: View {
    @Environment(AppModel.self) private var app
    let ticket: KDSTicket

    private var urgencyColor: Color {
        if ticket.waitMinutes > 10 { return .red }
        if ticket.waitMinutes > 5  { return .yellow }
        return .white.opacity(0.6)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Header
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(ticket.tableLabel ?? "Стол \(ticket.tableNumber)")
                        .font(.system(size: 20, weight: .bold))
                        .foregroundStyle(.white)
                }
                Spacer()
                Text("\(ticket.waitMinutes)м")
                    .font(.system(size: 24, weight: .black, design: .monospaced))
                    .foregroundStyle(urgencyColor)
            }
            .padding(16)
            .background(urgencyColor.opacity(0.1))

            Divider().background(.white.opacity(0.1))

            // Items
            VStack(alignment: .leading, spacing: 0) {
                ForEach(ticket.items) { item in
                    KDSItemRow(item: item) {
                        app.markItemReady(item.id)
                    }
                    if item.id != ticket.items.last?.id {
                        Divider().background(.white.opacity(0.06)).padding(.horizontal, 16)
                    }
                }
            }
        }
        .frame(width: 280)
        .background(Color(white: 0.1))
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .overlay(
            RoundedRectangle(cornerRadius: 16)
                .stroke(urgencyColor.opacity(0.3), lineWidth: 1.5)
        )
    }
}

struct KDSItemRow: View {
    let item: OrderItemState
    let onReady: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            Button(action: onReady) {
                Image(systemName: item.status == "ready" ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: 24))
                    .foregroundStyle(item.status == "ready" ? .green : .white.opacity(0.4))
            }
            .buttonStyle(.plain)

            VStack(alignment: .leading, spacing: 3) {
                HStack {
                    Text("\(item.qty)×")
                        .font(.headline.bold())
                        .foregroundStyle(.white.opacity(0.5))
                    Text(item.name)
                        .font(.headline.weight(.semibold))
                        .foregroundStyle(item.status == "ready" ? .white.opacity(0.4) : .white)
                        .strikethrough(item.status == "ready")
                }
                if !item.modifierSummary.isEmpty {
                    Text(item.modifierSummary)
                        .font(.subheadline)
                        .foregroundStyle(.yellow.opacity(0.8))
                }
                if let note = item.note {
                    Text(note)
                        .font(.subheadline)
                        .foregroundStyle(.orange.opacity(0.9))
                }
            }

            Spacer()
        }
        .padding(16)
    }
}
