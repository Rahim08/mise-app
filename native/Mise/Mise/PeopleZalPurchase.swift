import SwiftUI
import CoreLocation
import UIKit
// Зал (стоп-лист, заказы) и Закуп
// Распил PeopleView.swift (Д2, 2026-07-18): секция вынесена без изменений логики.

// MARK: Зал (стоп-лист + заказы)

struct ZalTab: View {
    @Bindable var m: PeopleModel
    var body: some View {
        Picker("", selection: $m.opsView) {
            Text(t("pe.stop")).tag("stop")
            Text(m.activeOrders.isEmpty ? t("pe.orders") : t("pe.ordersN", ["n": "\(m.activeOrders.count)"])).tag("orders")
            Text(t("pe.checklists")).tag("check")
            if m.canTech { Text(t("pe.techcards")).tag("tech") }
        }.pickerStyle(.segmented)
        switch m.opsView {
        case "orders": OrdersInbox(m: m)
        case "check":  ChecklistsTab(m: m)
        case "tech":   TechCardsTab(m: m)
        default:       StopTab(m: m)
        }
    }
}

// MARK: Закуп

let PURCHASE_CATS_IOS: [(id: String, label: String)] = [
    ("kitchen", "pe.catKitchen"), ("bar", "pe.catBar"), ("hookah", "pe.catHookah"),
    ("household", "pe.catHousehold"), ("general", "pe.catGeneral"),
]

@MainActor func purchaseCatLabel(_ id: String) -> String {
    PURCHASE_CATS_IOS.first { $0.id == id }.map { t($0.label) } ?? id
}

struct PurchaseTab: View {
    @Bindable var m: PeopleModel
    @State private var showForm = false
    @State private var pendingDelete: PurchaseItem?

    var body: some View {
        Group {
            Button { showForm = true } label: {
                Label(t("pe.pAddItems"), systemImage: "plus")
                    .font(.system(size: 15, weight: .bold)).foregroundStyle(.white)
                    .frame(maxWidth: .infinity).padding(.vertical, 13)
                    .background(RoundedRectangle(cornerRadius: 14).fill(PEOPLE_ACCENT))
            }

            Picker("", selection: $m.purchaseSeg) {
                Text(m.purchaseTodo.isEmpty ? t("pe.pToBuy") : "\(t("pe.pToBuy")) · \(m.purchaseTodo.count)").tag("todo")
                Text(t("pe.pDone")).tag("done")
            }.pickerStyle(.segmented)

            if m.purchaseSeg == "todo" && m.isManager && !m.purchaseTodo.isEmpty {
                HStack(spacing: 8) {
                    Button { copyList() } label: {
                        Label(t("pe.pCopy"), systemImage: "doc.on.doc")
                            .font(.system(size: 14, weight: .semibold)).frame(maxWidth: .infinity).padding(.vertical, 10)
                            .background(RoundedRectangle(cornerRadius: 12).fill(.primary.opacity(0.06)))
                    }.tint(.primary)
                    Button { waList() } label: {
                        Label("WhatsApp", systemImage: "paperplane.fill")
                            .font(.system(size: 14, weight: .semibold)).foregroundStyle(Color(red: 0.12, green: 0.67, blue: 0.32))
                            .frame(maxWidth: .infinity).padding(.vertical, 10)
                            .background(RoundedRectangle(cornerRadius: 12).fill(Color(red: 0.12, green: 0.67, blue: 0.32).opacity(0.12)))
                    }
                }
            }

            let list = m.purchaseSeg == "todo" ? m.purchaseTodo : m.purchaseDone
            if !m.purchaseLoaded {
                RowListSkeleton(rows: 3)
            } else if list.isEmpty {
                VStack(spacing: 4) {
                    Text(m.purchaseSeg == "todo" ? t("pe.pEmpty") : t("pe.pDone")).font(.system(size: 16, weight: .semibold)).foregroundStyle(.primary.opacity(0.7))
                    if m.purchaseSeg == "todo" { Text(t("pe.pEmptyHint")).font(.system(size: 13)).foregroundStyle(.primary.opacity(0.4)) }
                }.frame(maxWidth: .infinity).padding(.top, 50)
            } else {
                let cats = list.map { $0.category }.reduce(into: [String]()) { if !$0.contains($1) { $0.append($1) } }
                ForEach(cats, id: \.self) { cid in
                    VStack(alignment: .leading, spacing: 8) {
                        Text(purchaseCatLabel(cid).uppercased()).font(.system(size: 12, weight: .bold)).foregroundStyle(.primary.opacity(0.45))
                            .frame(maxWidth: .infinity, alignment: .leading)
                        ForEach(list.filter { $0.category == cid }) { it in row(it) }
                    }
                }
            }
        }
        .task { if !m.purchaseLoaded { await m.loadPurchase() } }
        .sheet(isPresented: $showForm) { PurchaseFormSheet(m: m) }
        .confirmationDialog(t("pe.deletePurchase"),
                            isPresented: Binding(get: { pendingDelete != nil }, set: { if !$0 { pendingDelete = nil } }),
                            titleVisibility: .visible) {
            Button(t("delete"), role: .destructive) {
                if let it = pendingDelete { Task { await m.removePurchase(it) } }; pendingDelete = nil
            }
            Button(t("cancel"), role: .cancel) { pendingDelete = nil }
        }
    }

    private func row(_ it: PurchaseItem) -> some View {
        SwipeActionRow(
            leading: (m.purchaseSeg == "todo" && m.isManager) ? SwipeAction(label: t("pe.pDone"), systemImage: "checkmark.circle.fill", tint: BrandKit.analytics) {
                Task { await m.setPurchaseStatus(it, "bought") }
            } : nil,
            trailing: (m.isManager || it.created_by == m.myId) ? [
                SwipeAction(label: t("delete"), systemImage: "trash.fill", tint: BrandKit.menu) { pendingDelete = it }
            ] : []
        ) {
        HStack(spacing: 12) {
            if m.purchaseSeg == "todo" && m.isManager {
                Button { Task { await m.setPurchaseStatus(it, "bought") } } label: {
                    Image(systemName: "circle").font(.system(size: 22)).foregroundStyle(.primary.opacity(0.3))
                }
            }
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(it.name).font(.system(size: 15, weight: .semibold)).foregroundStyle(.primary)
                        .strikethrough(it.status == "bought")
                    if let q = it.qty { Text("· \(q.clean)\(it.unit.map { " \($0)" } ?? "")").font(.system(size: 14)).foregroundStyle(.primary.opacity(0.45)) }
                    else if let u = it.unit { Text("· \(u)").font(.system(size: 14)).foregroundStyle(.primary.opacity(0.45)) }
                }
                if let by = it.created_by_name, !by.isEmpty {
                    Text(by + (it.status == "unavailable" ? " · \(t("pe.pUnavail"))" : "")).font(.system(size: 11.5)).foregroundStyle(.primary.opacity(0.4))
                }
            }
            Spacer()
            if m.purchaseSeg == "todo" && m.isManager {
                Button { Task { await m.setPurchaseStatus(it, "unavailable") } } label: {
                    Text(t("pe.pUnavail")).font(.system(size: 12, weight: .semibold)).foregroundStyle(.primary.opacity(0.6))
                }
            }
            if m.isManager || it.created_by == m.myId {
                Button { Task { await m.removePurchase(it) } } label: {
                    Image(systemName: "xmark").font(.system(size: 13, weight: .semibold)).foregroundStyle(.primary.opacity(0.4))
                }
            }
        }
        .padding(.vertical, 12).padding(.horizontal, 14)
        .background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 14))
        .opacity(it.status == "todo" ? 1 : 0.6)
        }
    }

    private func copyList() {
        UIPasteboard.general.string = m.purchaseText(catLabel: purchaseCatLabel)
        m.flash(t("pe.pCopied"))
    }
    private func waList() {
        let text = m.purchaseText(catLabel: purchaseCatLabel)
        if let url = URL(string: "https://wa.me/?text=\(text.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? "")") {
            UIApplication.shared.open(url)
        }
    }
}

struct PurchaseFormSheet: View {
    @Bindable var m: PeopleModel
    @Environment(\.dismiss) private var dismiss
    @State private var cat = "kitchen"
    @State private var rows: [Row] = [Row()]
    @State private var saving = false

    struct Row: Identifiable { let id = UUID(); var name = ""; var qty = ""; var unit = "" }

    var body: some View {
        NavigationStack {
            ZStack {
                Color.miseBg.ignoresSafeArea()
                ScrollView {
                    VStack(spacing: 14) {
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 8) {
                                ForEach(PURCHASE_CATS_IOS, id: \.id) { c in
                                    Button { cat = c.id } label: {
                                        Text(t(c.label)).font(.system(size: 13, weight: cat == c.id ? .bold : .medium))
                                            .foregroundStyle(cat == c.id ? .white : .primary)
                                            .padding(.horizontal, 14).padding(.vertical, 8)
                                            .background(Capsule().fill(cat == c.id ? PEOPLE_ACCENT : Color.primary.opacity(0.08)))
                                    }
                                }
                            }
                        }
                        ForEach($rows) { $r in
                            HStack(spacing: 8) {
                                TextField(t("pe.pNamePh"), text: $r.name).textFieldStyle(.roundedBorder)
                                TextField(t("pe.pQtyEx"), text: $r.qty).textFieldStyle(.roundedBorder).frame(width: 56).keyboardType(.decimalPad)
                                TextField(t("pe.pUnitEx"), text: $r.unit).textFieldStyle(.roundedBorder).frame(width: 56)
                                if rows.count > 1 {
                                    Button { rows.removeAll { $0.id == r.id } } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(.primary.opacity(0.3)) }
                                }
                            }
                        }
                        Button { rows.append(Row()) } label: {
                            Label(t("pe.pAddRow"), systemImage: "plus").font(.system(size: 14, weight: .semibold)).foregroundStyle(PEOPLE_ACCENT)
                                .frame(maxWidth: .infinity).padding(.vertical, 11)
                                .background(RoundedRectangle(cornerRadius: 12).strokeBorder(style: StrokeStyle(lineWidth: 1.5, dash: [5])).foregroundStyle(.primary.opacity(0.2)))
                        }
                    }.padding(16)
                }
            }
            .navigationTitle(t("pe.pNew")).navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(Color.miseBg, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(t("cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(t("pe.pSubmit")) { submit() }.disabled(saving || !rows.contains { !$0.name.trimmingCharacters(in: .whitespaces).isEmpty })
                }
            }
        }
    }

    private func submit() {
        saving = true
        let payload = rows.map { (name: $0.name, qty: $0.qty, unit: $0.unit) }
        Task {
            await m.addPurchase(category: cat, rows: payload, catLabel: purchaseCatLabel(cat))
            dismiss()
        }
    }
}

struct OrdersInbox: View {
    @Bindable var m: PeopleModel
    var body: some View {
        Picker("", selection: $m.ordersSeg) {
            Text(m.activeOrders.isEmpty ? t("pe.active") : t("pe.activeN", ["n": "\(m.activeOrders.count)"])).tag("active")
            Text(t("pe.finished")).tag("done")
        }.pickerStyle(.segmented)

        let list = m.ordersSeg == "active" ? m.activeOrders : m.finishedOrders
        if !m.ordersLoaded {
            RowListSkeleton(rows: 3)
        } else if list.isEmpty {
            Text(m.ordersSeg == "active" ? t("pe.noActive") : t("empty"))
                .font(.system(size: 15)).foregroundStyle(.primary.opacity(0.4)).padding(.top, 50)
        } else {
            ForEach(list) { o in OrderCard(m: m, o: o) }
        }
    }
}

struct OrderCard: View {
    @Bindable var m: PeopleModel
    let o: MenuOrder
    // Быстрые вызовы гостя: waiter | coal | water (маркер в items[0].call, см. /api/menu/order).
    private var callKind: String? { o.items?.first?.call }
    private var isCall: Bool { callKind != nil }
    private var callTitle: String {
        switch callKind {
        case "coal": t("pe.callCoal")
        case "water": t("pe.callWater")
        default: t("pe.callWaiter")
        }
    }
    private var active: Bool { o.status == "new" || o.status == "in_progress" }
    @State private var showCancelConfirm = false

    var body: some View {
        SwipeActionRow(
            leading: active ? SwipeAction(label: t("pe.order.done"), systemImage: "checkmark", tint: BrandKit.analytics, handler: {
                Task { await m.setOrderStatus(o, "done") }
            }) : nil,
            trailing: active ? [SwipeAction(label: t("cancel"), systemImage: "xmark", tint: BrandKit.menu, handler: {
                showCancelConfirm = true
            })] : []
        ) {
            VStack(alignment: .leading, spacing: 8) {
                header
                if !isCall {
                    itemsSection
                    Divider().overlay(Color.primary.opacity(0.08))
                    HStack {
                        Text(eur(o.total ?? 0)).font(.system(size: 15, weight: .heavy)).foregroundStyle(.primary)
                        Spacer()
                        buttons
                    }
                } else if active {
                    HStack { Spacer(); Button(t("pe.coming")) { Task { await m.setOrderStatus(o, "done") } }
                        .buttonStyle(.borderedProminent).tint(PEOPLE_ACCENT) }
                }
            }
            .padding(14)
            .background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 16))
            .overlay(alignment: .leading) { if isCall { Rectangle().fill(BrandKit.stash).frame(width: 3) } }
        }
        .confirmationDialog(t("pe.cancelOrder"), isPresented: $showCancelConfirm, titleVisibility: .visible) {
            Button(t("cancel"), role: .destructive) { Task { await m.setOrderStatus(o, "cancelled") } }
            Button(t("pe.keep"), role: .cancel) {}
        }
    }

    private var header: some View {
        HStack(spacing: 8) {
            if isCall { Text(callTitle).font(.system(size: 15, weight: .bold)).foregroundStyle(.primary) }
            if let tn = o.table_number {
                Text(t("pe.tableN", ["n": "\(tn)"])).font(.system(size: 12, weight: .heavy)).foregroundStyle(.primary)
                    .padding(.horizontal, 8).padding(.vertical, 3)
                    .background(isCall ? BrandKit.stash : PEOPLE_ACCENT, in: RoundedRectangle(cornerRadius: 7))
            }
            Text(orderTime(o.created_at)).font(.system(size: 12)).foregroundStyle(.primary.opacity(0.4))
            Spacer()
            Text(statusLabel(o.status)).font(.system(size: 11, weight: .bold)).foregroundStyle(statusColor(o.status))
                .padding(.horizontal, 8).padding(.vertical, 3)
                .background(statusColor(o.status).opacity(0.16), in: Capsule())
        }
    }

    private var itemsSection: some View {
        ForEach(Array((o.items ?? []).enumerated()), id: \.offset) { _, it in
            HStack {
                Text(itemLine(it)).font(.system(size: 14)).foregroundStyle(.primary)
                Spacer()
                if let p = it.price {
                    Text(eur(p * (it.qty ?? 1))).font(.system(size: 13)).foregroundStyle(.primary.opacity(0.4))
                }
            }
        }
    }

    private func itemLine(_ it: OrderItem) -> String {
        var s = it.name ?? "—"
        if let opts = it.opts, !opts.isEmpty { s += " · " + opts.joined(separator: ", ") }
        s += " × \(Int(it.qty ?? 1))"
        return s
    }

    @ViewBuilder private var buttons: some View {
        HStack(spacing: 8) {
            if o.status == "new" {
                Button(t("cancel")) { Task { await m.setOrderStatus(o, "cancelled") } }
                    .font(.system(size: 13, weight: .semibold)).foregroundStyle(.primary.opacity(0.6))
            }
            if o.status == "new" {
                Button(t("pe.cooking")) { Task { await m.setOrderStatus(o, "in_progress") } }
                    .buttonStyle(.borderedProminent).tint(PEOPLE_ACCENT).controlSize(.small)
            } else if o.status == "in_progress" {
                Button(t("pe.readyBtn")) { Task { await m.setOrderStatus(o, "done") } }
                    .buttonStyle(.borderedProminent).tint(PEOPLE_ACCENT).controlSize(.small)
            }
        }
    }

    private func statusLabel(_ s: String?) -> String {
        ["new": t("pe.order.new"), "in_progress": t("pe.order.inProgress"), "done": t("pe.order.done"), "cancelled": t("pe.order.cancelled")][s ?? "new"] ?? t("pe.order.new")
    }
    private func statusColor(_ s: String?) -> Color {
        ["new": BrandKit.stash, "in_progress": BrandKit.manager, "done": BrandKit.analytics, "cancelled": Color.primary.opacity(0.4)][s ?? "new"] ?? BrandKit.stash
    }
    private func orderTime(_ iso: String?) -> String {
        guard let d = parseISO(iso) else { return "" }
        let f = DateFormatter(); f.dateFormat = "HH:mm"; return f.string(from: d)
    }
}

struct StopTab: View {
    @Bindable var m: PeopleModel
    var body: some View {
        if !m.menuLoaded {
            RowListSkeleton(rows: 3)
        } else if m.menu.isEmpty {
            VStack(spacing: 4) {
                Text(t("pe.menuEmpty")).font(.system(size: 15)).foregroundStyle(.primary.opacity(0.4))
                Text(t("pe.itemsAddedInDash")).font(.system(size: 13)).foregroundStyle(.primary.opacity(0.3)).multilineTextAlignment(.center)
            }
            .frame(maxWidth: .infinity).padding(.top, 50)
        } else {
            HStack {
                Text(t("pe.stopList")).font(.system(size: 12, weight: .semibold)).foregroundStyle(.primary.opacity(0.45)).kerning(0.5)
                Spacer()
                if m.stopCount > 0 {
                    Text(t("pe.inStopN", ["n": "\(m.stopCount)"])).font(.system(size: 11, weight: .bold)).foregroundStyle(BrandKit.menu)
                        .padding(.horizontal, 8).padding(.vertical, 3)
                        .background(BrandKit.menu.opacity(0.16), in: Capsule())
                }
            }
            VStack(spacing: 0) {
                ForEach(Array(m.menu.enumerated()), id: \.element.id) { idx, item in
                    let avail = item.is_available ?? true
                    SwipeActionRow(
                        leading: (m.canStop && !avail) ? SwipeAction(label: t("pe.inMenu"), systemImage: "checkmark.circle", tint: BrandKit.analytics, handler: { Task { await m.toggleItem(item) } }) : nil,
                        trailing: (m.canStop && avail) ? [SwipeAction(label: t("pe.inStop"), systemImage: "minus.circle", tint: BrandKit.menu, handler: { Task { await m.toggleItem(item) } })] : []
                    ) {
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(item.name).font(.system(size: 15)).foregroundStyle(.primary.opacity(avail ? 1 : 0.4)).strikethrough(!avail)
                                if let p = item.price { Text(eur(p)).font(.system(size: 12)).foregroundStyle(.primary.opacity(0.4)) }
                            }
                            Spacer()
                            if m.canStop {
                                Toggle("", isOn: Binding(get: { avail }, set: { _ in Task { await m.toggleItem(item) } }))
                                    .labelsHidden().tint(BrandKit.analytics)
                            } else {
                                Text(avail ? t("pe.inMenu") : t("pe.inStop")).font(.system(size: 12, weight: .semibold))
                                    .foregroundStyle(avail ? BrandKit.analytics : BrandKit.menu)
                            }
                        }
                        .padding(.vertical, 10).padding(.horizontal, 14)
                        .background(Color.primary.opacity(0.06))
                    }
                    if idx < m.menu.count - 1 { Divider().overlay(Color.primary.opacity(0.08)).padding(.leading, 14) }
                }
            }
            .background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 16))
        }
    }
}

