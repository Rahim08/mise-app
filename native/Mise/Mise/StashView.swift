import SwiftUI

private let FREE_CATS = ["Сотрудники", "Владелец", "Менеджер", "Гость", "Дегустация"]

private func grams(_ g: Double) -> String {
    let f = NumberFormatter(); f.numberStyle = .decimal; f.groupingSeparator = " "; f.maximumFractionDigits = 0
    return (f.string(from: NSNumber(value: g)) ?? "0") + " г"
}
private func eur(_ v: Double) -> String { Money.s(v) }
private func i(_ s: String) -> Int { Int(s.filter(\.isNumber)) ?? 0 }

// MARK: - Модель Stash (логика — app/tobacco/page.tsx)

@MainActor
@Observable
final class StashModel {
    let rid: String
    let canSeeMoney: Bool
    var tab = "shift"
    var toast: String?

    // Смена кальянщика
    var currentDate = Date()
    var types: [HookahType] = []
    var paid: [String: String] = [:]
    var free: [String: [String: String]] = [:]
    var mode = "paid"
    var freeCat = FREE_CATS[0]
    var venueBase = 0.0
    var shiftLoading = true
    var saving = false

    // Склад
    var stock: [StockItem] = []
    var movements: [Movement] = []
    var inventories: [Inventory] = []
    var search = ""
    var showLowOnly = false
    var movMode = "in"

    init(rid: String, canSeeMoney: Bool) { self.rid = rid; self.canSeeMoney = canSeeMoney }

    private let df: DateFormatter = {
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.locale = Locale(identifier: "en_US_POSIX"); return f
    }()
    func key(_ d: Date) -> String { df.string(from: d) }
    var dateStr: String { key(currentDate) }
    var isToday: Bool { dateStr == key(Date()) }

    // MARK: смена

    func loadShift() async {
        #if DEBUG
        if ProcessInfo.processInfo.environment["MISE_DEMO_UI"] == "1" { seedDemo(); return }
        #endif
        shiftLoading = true; defer { shiftLoading = false }
        async let tps = (try? DB.from("hookah_types").select().eq("is_active", true).order("created_at").list(HookahType.self)) ?? []
        async let sales = (try? DB.from("hookah_sales")
            .select("hookah_type_id, quantity, portion_g, is_free, date, flavor").list(HookahSale.self)) ?? []
        async let outs = (try? DB.from("tobacco_movements").select("quantity_g").eq("type", "out").list(Movement.self)) ?? []
        types = await tps
        var p: [String: String] = [:], fr: [String: [String: String]] = [:]
        var pastGrams = 0.0
        for r in await sales {
            if r.date == dateStr, let id = r.hookah_type_id {
                let q = Int(r.quantity ?? 0)
                if r.is_free == true {
                    let cat = r.flavor ?? FREE_CATS[0]
                    fr[id, default: [:]][cat] = String((Int(fr[id]?[cat] ?? "") ?? 0) + q)
                } else {
                    p[id] = String((Int(p[id] ?? "") ?? 0) + q)
                }
            } else {
                pastGrams += (r.quantity ?? 0) * (r.portion_g ?? 0)
            }
        }
        paid = p; free = fr
        venueBase = (await outs).reduce(0) { $0 + $1.quantity_g } - pastGrams
    }

    func paidOf(_ id: String) -> Int { Int(paid[id] ?? "") ?? 0 }
    func freeOf(_ id: String, _ cat: String) -> Int { Int(free[id]?[cat] ?? "") ?? 0 }
    func freeTotalOf(_ id: String) -> Int { FREE_CATS.reduce(0) { $0 + freeOf(id, $1) } }
    func inputVal(_ id: String) -> String {
        mode == "paid" ? (paid[id] ?? "") : (free[id]?[freeCat] ?? "")
    }
    func setQty(_ id: String, _ val: String) {
        let clean = val.filter(\.isNumber)
        if mode == "paid" { paid[id] = clean }
        else { free[id, default: [:]][freeCat] = clean }
    }

    var paidTotal: Int { types.reduce(0) { $0 + paidOf($1.id) } }
    var freeTotal: Int { types.reduce(0) { $0 + freeTotalOf($1.id) } }
    var revenue: Double { types.reduce(0) { $0 + Double(paidOf($1.id)) * ($1.price ?? 0) } }
    var gramsUsed: Double { types.reduce(0) { $0 + Double(paidOf($1.id) + freeTotalOf($1.id)) * ($1.portion_g ?? 0) } }
    var venueLeft: Double { venueBase - gramsUsed }

    func saveShift() async {
        saving = true; defer { saving = false }
        do {
            try await DB.from("hookah_sales").delete().eq("date", dateStr).run()
            var rows: [[String: Any]] = []
            for tp in types {
                let p = paidOf(tp.id)
                if p > 0 {
                    rows.append(["hookah_type_id": tp.id, "quantity": p, "date": dateStr,
                                 "price": tp.price ?? 0, "portion_g": tp.portion_g ?? 0, "is_free": false])
                }
                for cat in FREE_CATS {
                    let f = freeOf(tp.id, cat)
                    if f > 0 {
                        rows.append(["hookah_type_id": tp.id, "quantity": f, "date": dateStr,
                                     "price": 0, "portion_g": tp.portion_g ?? 0, "is_free": true, "flavor": cat])
                    }
                }
            }
            if !rows.isEmpty { try await DB.from("hookah_sales").insert(rows).run() }
            flash(t("st.shiftSaved", ["p": "\(paidTotal)"]) + (freeTotal > 0 ? t("st.shiftSavedFree", ["f": "\(freeTotal)"]) : ""))
        } catch {
            flash(t("saveFailed", ["err": error.localizedDescription]))
        }
    }

    func shiftDay(_ d: Int) async {
        currentDate = Calendar.current.date(byAdding: .day, value: d, to: currentDate)!
        await loadShift()
    }

    // MARK: склад

    func loadWarehouse() async {
        #if DEBUG
        if ProcessInfo.processInfo.environment["MISE_DEMO_UI"] == "1" { return }
        #endif
        async let s = (try? DB.from("tobacco_stock").select().order("brand").order("flavor").list(StockItem.self)) ?? []
        async let mv = (try? DB.from("tobacco_movements").select().order("created_at", ascending: false).limit(200).list(Movement.self)) ?? []
        async let iv = (try? DB.from("tobacco_inventories").select().order("created_at", ascending: false).limit(50).list(Inventory.self)) ?? []
        stock = await s; movements = await mv; inventories = await iv
    }

    func isLow(_ s: StockItem) -> Bool { s.quantity_g > 0 && s.quantity_g <= (s.min_quantity_g ?? 200) }
    var inStock: [StockItem] { stock.filter { $0.quantity_g > 0 } }
    var lowCount: Int { inStock.filter(isLow).count }
    var filteredStock: [StockItem] {
        inStock
            .filter { search.isEmpty || "\($0.brand) \($0.flavor)".lowercased().contains(search.lowercased()) }
            .filter { !showLowOnly || isLow($0) }
    }
    /// Склад по брендам: бренд → список вкусов (для карточек бренда в «Наличии»).
    var stockByBrand: [(String, [StockItem])] {
        var g: [String: [StockItem]] = [:]
        for s in filteredStock { g[s.brand, default: []].append(s) }
        return g.map { ($0.key, $0.value.sorted { $0.flavor < $1.flavor }) }
            .sorted { $0.0.lowercased() < $1.0.lowercased() }
    }

    /// Группировка движений по batch для выбранного типа (in/out/writeoff).
    var movementBatches: [(String, [Movement])] {
        let filtered = movements.filter { $0.type == movMode }
        var batches: [String: [Movement]] = [:]
        for m in filtered { batches[m.batch_id ?? m.id, default: []].append(m) }
        return batches.sorted { ($0.value.first?.created_at ?? "") > ($1.value.first?.created_at ?? "") }
    }

    struct MovRow: Identifiable { let id = UUID(); var brand = ""; var flavor = ""; var grams = "" }

    func saveMovement(_ rows: [MovRow], reason: String) async -> Bool {
        let filled = rows.filter { !$0.brand.isEmpty && !$0.flavor.isEmpty && (Double($0.grams) ?? 0) > 0 }
        if filled.isEmpty { flash(t("st.fillRow")); return false }
        for r in filled where movMode != "in" {
            guard let item = stock.first(where: { $0.brand == r.brand && $0.flavor == r.flavor }) else {
                flash(t("st.notInStock", ["b": r.brand, "fl": r.flavor])); return false
            }
            if (Double(r.grams) ?? 0) > item.quantity_g { flash(t("st.onlyLeft", ["b": r.brand, "fl": r.flavor, "g": grams(item.quantity_g)])); return false }
        }
        if movMode == "writeoff" && reason.trimmingCharacters(in: .whitespaces).isEmpty { flash(t("st.writeoffReason")); return false }
        saving = true; defer { saving = false }
        let batchId = UUID().uuidString
        let fresh = (try? await DB.from("tobacco_stock").select().list(StockItem.self)) ?? stock
        let defReason = reason.isEmpty ? (movMode == "in" ? "Поставка" : movMode == "out" ? "Выдача в зал" : "Списание") : reason
        for r in filled {
            let qty = Double(r.grams) ?? 0
            let existing = fresh.first { $0.brand == r.brand && $0.flavor == r.flavor }
            try? await DB.from("tobacco_movements").insert([
                "restaurant_id": rid, "brand": r.brand, "flavor": r.flavor, "quantity_g": qty,
                "type": movMode, "batch_id": batchId, "reason": defReason,
            ]).run()
            if let ex = existing {
                let delta = movMode == "in" ? qty : -qty
                try? await DB.from("tobacco_stock").update(["quantity_g": ex.quantity_g + delta]).eq("id", ex.id).run()
            } else if movMode == "in" {
                try? await DB.from("tobacco_stock").insert([
                    "restaurant_id": rid, "brand": r.brand, "flavor": r.flavor, "quantity_g": qty, "flavor_name": r.flavor,
                ]).run()
            }
        }
        await loadWarehouse()
        flash(t("st.saved", ["n": "\(filled.count)"]))
        return true
    }

    func flash(_ m: String) {
        toast = m
        Task { try? await Task.sleep(nanoseconds: 2_400_000_000); if toast == m { toast = nil } }
    }

    #if DEBUG
    private func seedDemo() {
        types = [
            .init(id: "h1", name: "Классический", price: 15, portion_g: 20),
            .init(id: "h2", name: "Премиум", price: 22, portion_g: 25),
            .init(id: "h3", name: "Авторский", price: 28, portion_g: 25),
        ]
        paid = ["h1": "8", "h2": "5", "h3": "2"]
        free = ["h1": ["Дегустация": "1"], "h2": ["Сотрудники": "1"]]
        venueBase = 1400
        stock = [
            .init(id: "s1", brand: "Darkside", flavor: "Bananapapa", quantity_g: 850, min_quantity_g: 200),
            .init(id: "s2", brand: "Darkside", flavor: "Supernova", quantity_g: 140, min_quantity_g: 200),
            .init(id: "s3", brand: "MustHave", flavor: "Pinkman", quantity_g: 60, min_quantity_g: 150),
            .init(id: "s4", brand: "Element", flavor: "Грейпфрут", quantity_g: 500, min_quantity_g: 200),
        ]
        movements = [
            .init(id: "m1", brand: "Darkside", flavor: "Bananapapa", quantity_g: 250, type: "in", batch_id: "b1", reason: "Поставка", created_at: "2026-06-14T10:00:00Z"),
            .init(id: "m2", brand: "Element", flavor: "Грейпфрут", quantity_g: 100, type: "out", batch_id: "b2", reason: "Выдача в зал", created_at: "2026-06-15T12:00:00Z"),
        ]
        inventories = [
            .init(id: "i1", created_at: "2026-06-10T18:00:00Z",
                  items: [.init(brand: "Darkside", flavor: "Supernova", expected_g: 200, actual_g: 140, diff_g: -60)]),
        ]
        shiftLoading = false
    }
    #endif
}

// MARK: - Экран Stash

struct StashView: View {
    @Environment(AppModel.self) private var app
    @State private var m: StashModel?

    var body: some View {
        Group {
            if let m { StashBody(m: m) }
            else { ProgressView().tint(.white).frame(maxWidth: .infinity, maxHeight: .infinity) }
        }
        .task {
            if m == nil {
                let model = StashModel(rid: app.restaurant?.id ?? "", canSeeMoney: app.canSeeMoney)
                m = model
                #if DEBUG
                if let t = ProcessInfo.processInfo.environment["MISE_DEMO_TAB"] { model.tab = t }
                #endif
                await model.loadShift()
                await model.loadWarehouse()
            }
        }
    }
}

private struct StashBody: View {
    @Bindable var m: StashModel
    @State private var showAddMov = false

    var body: some View {
        ZStack(alignment: .bottom) {
            TabView(selection: $m.tab) {
                AppTabPage(refresh: { await m.loadShift() }) { ShiftTab(m: m) }
                    .tabItem { Label(t("tab.stashShift"), systemImage: "flame.fill") }.tag("shift")
                AppTabPage(refresh: { await m.loadWarehouse() }) { StockTab(m: m) }
                    .tabItem { Label(t("tab.stock"), systemImage: "tray.full.fill") }.tag("stock")
                AppTabPage(refresh: { await m.loadWarehouse() }) { MovementsTab(m: m, showAdd: $showAddMov) }
                    .tabItem { Label(t("tab.movements"), systemImage: "arrow.left.arrow.right") }.tag("movements")
                AppTabPage(refresh: { await m.loadWarehouse() }) { InventoryTab(m: m) }
                    .tabItem { Label(t("tab.inventory"), systemImage: "checklist") }.tag("inventory")
            }
            .tint(BrandKit.stash)

            if let toast = m.toast {
                Text(toast).font(.system(size: 14, weight: .semibold)).foregroundStyle(.white)
                    .padding(.horizontal, 18).padding(.vertical, 12)
                    .background(.ultraThinMaterial, in: Capsule())
                    .padding(.bottom, 60)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .animation(.easeInOut(duration: 0.2), value: m.toast)
        .sheet(isPresented: $showAddMov) { AddMovementSheet(m: m) }
    }
}

// MARK: Смена

private struct ShiftTab: View {
    @Bindable var m: StashModel

    var body: some View {
        if m.shiftLoading {
            ProgressView().tint(.white).padding(.top, 40)
        } else if m.types.isEmpty {
            VStack(spacing: 6) {
                Text(t("st.noTypes")).font(.system(size: 16, weight: .semibold)).foregroundStyle(.white)
                Text(t("st.noTypesHint"))
                    .font(.system(size: 13)).foregroundStyle(.white.opacity(0.5)).multilineTextAlignment(.center)
            }
            .padding(.top, 50)
        } else {
            dayNav
            stats
            modeSeg
            typesList
            saveBtn
        }
    }

    private var dayNav: some View {
        HStack {
            navBtn("chevron.left") { Task { await m.shiftDay(-1) } }
            Spacer()
            VStack(spacing: 2) {
                Text(longDate(m.currentDate)).font(.system(size: 15, weight: .bold)).foregroundStyle(.white)
                if !m.isToday {
                    Button { Task { m.currentDate = Date(); await m.loadShift() } } label: {
                        Text(t("st.toToday")).font(.system(size: 11, weight: .semibold)).foregroundStyle(BrandKit.manager)
                    }
                }
            }
            Spacer()
            navBtn("chevron.right", disabled: m.isToday) { Task { await m.shiftDay(1) } }
        }
    }

    private var stats: some View {
        let items: [(String, String, Color)] = {
            var a: [(String, String, Color)] = [(t("st.sold"), "\(m.paidTotal)", BrandKit.stash),
                                                (t("st.free"), "\(m.freeTotal)", BrandKit.people)]
            if m.canSeeMoney { a.append((t("st.revenue"), eur(m.revenue), BrandKit.analytics)) }
            a.append((t("st.tobacco"), grams(m.gramsUsed), BrandKit.manager))
            return a
        }()
        return LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: m.canSeeMoney ? 2 : 3), spacing: 8) {
            ForEach(items, id: \.0) { it in
                VStack(spacing: 3) {
                    Text(it.1).font(.system(size: 17, weight: .heavy)).foregroundStyle(it.2)
                    Text(it.0).font(.system(size: 11)).foregroundStyle(.white.opacity(0.45))
                }
                .frame(maxWidth: .infinity).padding(.vertical, 12)
                .background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 14))
            }
        }
    }

    private var modeSeg: some View {
        Picker("", selection: $m.mode) {
            Text(t("st.sale")).tag("paid"); Text(t("st.free")).tag("free")
        }
        .pickerStyle(.segmented)
    }

    @ViewBuilder private var typesList: some View {
        if m.mode == "free" {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(FREE_CATS, id: \.self) { cat in
                        Button { m.freeCat = cat } label: {
                            Text(cat).font(.system(size: 13, weight: .medium))
                                .foregroundStyle(m.freeCat == cat ? .black : .white)
                                .padding(.horizontal, 14).padding(.vertical, 8)
                                .background(m.freeCat == cat ? BrandKit.people : Color.white.opacity(0.08), in: Capsule())
                        }
                    }
                }
            }
        }
        VStack(spacing: 0) {
            ForEach(Array(m.types.enumerated()), id: \.element.id) { idx, tp in
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(tp.name ?? "—").font(.system(size: 15, weight: .medium)).foregroundStyle(.white)
                        Text("\(eur(tp.price ?? 0)) · \(grams(tp.portion_g ?? 0))")
                            .font(.system(size: 12)).foregroundStyle(.white.opacity(0.4))
                    }
                    Spacer()
                    TextField("0", text: Binding(get: { m.inputVal(tp.id) }, set: { m.setQty(tp.id, $0) }))
                        .keyboardType(.numberPad).multilineTextAlignment(.center)
                        .font(.system(size: 17, weight: .bold)).foregroundStyle(.white)
                        .frame(width: 64).padding(.vertical, 8)
                        .background(Color.white.opacity(0.07), in: RoundedRectangle(cornerRadius: 10))
                }
                .padding(.vertical, 11).padding(.horizontal, 14)
                if idx < m.types.count - 1 { Divider().overlay(Color.white.opacity(0.08)).padding(.leading, 14) }
            }
        }
        .background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 16))
    }

    private var saveBtn: some View {
        Button { Task { await m.saveShift() } } label: {
            Text(m.saving ? t("saving") : t("mg.saveShift"))
                .font(.system(size: 16, weight: .bold)).foregroundStyle(.white)
                .frame(maxWidth: .infinity).padding(.vertical, 16)
                .background(BrandKit.stash, in: RoundedRectangle(cornerRadius: 16))
        }
        .disabled(m.saving)
    }

    private func navBtn(_ s: String, disabled: Bool = false, _ a: @escaping () -> Void) -> some View {
        Button(action: a) {
            Image(systemName: s).font(.system(size: 14, weight: .bold)).foregroundStyle(.white)
                .frame(width: 36, height: 36).background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 10))
        }.disabled(disabled).opacity(disabled ? 0.4 : 1)
    }
}

// MARK: Наличие

private struct StockTab: View {
    @Bindable var m: StashModel
    var body: some View {
        HStack(spacing: 8) {
            HStack(spacing: 6) {
                Image(systemName: "magnifyingglass").font(.system(size: 13)).foregroundStyle(.white.opacity(0.4))
                TextField(t("st.search"), text: $m.search).font(.system(size: 15)).foregroundStyle(.white)
            }
            .padding(.horizontal, 12).padding(.vertical, 9)
            .background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 10))
            if m.lowCount > 0 {
                Button { m.showLowOnly.toggle() } label: {
                    Text(t("st.low", ["n": "\(m.lowCount)"])).font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(m.showLowOnly ? .black : BrandKit.stash)
                        .padding(.horizontal, 12).padding(.vertical, 9)
                        .background(m.showLowOnly ? BrandKit.stash : BrandKit.stash.opacity(0.16), in: RoundedRectangle(cornerRadius: 10))
                }
            }
        }
        if m.filteredStock.isEmpty {
            Text(t("empty")).font(.system(size: 14)).foregroundStyle(.white.opacity(0.4)).padding(.top, 40)
        } else {
            ForEach(m.stockByBrand, id: \.0) { brand, items in
                VStack(alignment: .leading, spacing: 0) {
                    HStack {
                        Text(brand).font(.system(size: 13, weight: .bold)).foregroundStyle(.white.opacity(0.55))
                            .textCase(.uppercase)
                        Spacer()
                        Text(grams(items.reduce(0) { $0 + $1.quantity_g }))
                            .font(.system(size: 12, weight: .semibold)).foregroundStyle(.white.opacity(0.4))
                    }
                    .padding(.horizontal, 14).padding(.top, 12).padding(.bottom, 8)
                    ForEach(Array(items.enumerated()), id: \.element.id) { idx, s in
                        HStack {
                            Text(s.flavor).font(.system(size: 15)).foregroundStyle(.white)
                            Spacer()
                            Text(grams(s.quantity_g))
                                .font(.system(size: 15, weight: .semibold))
                                .foregroundStyle(m.isLow(s) ? BrandKit.stash : .white)
                        }
                        .padding(.vertical, 10).padding(.horizontal, 14)
                        if idx < items.count - 1 { Divider().overlay(Color.white.opacity(0.06)).padding(.leading, 14) }
                    }
                }
                .padding(.bottom, 6)
                .background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 16))
            }
        }
    }
}

// MARK: Движения

private struct MovementsTab: View {
    @Bindable var m: StashModel
    @Binding var showAdd: Bool

    var body: some View {
        Picker("", selection: $m.movMode) {
            Text(t("st.in")).tag("in"); Text(t("st.out")).tag("out"); Text(t("st.writeoff")).tag("writeoff")
        }.pickerStyle(.segmented)

        Button { showAdd = true } label: {
            Label(t("st.addMovement"), systemImage: "plus")
                .font(.system(size: 15, weight: .semibold)).foregroundStyle(BrandKit.stash)
                .frame(maxWidth: .infinity).padding(.vertical, 13)
                .background(BrandKit.stash.opacity(0.14), in: RoundedRectangle(cornerRadius: 12))
        }

        if m.movementBatches.isEmpty {
            Text(t("st.noMovements")).font(.system(size: 14)).foregroundStyle(.white.opacity(0.4)).padding(.top, 30)
        } else {
            ForEach(m.movementBatches, id: \.0) { batchId, items in
                MovementBatchRow(items: items)
            }
        }
    }
}

private struct MovementBatchRow: View {
    let items: [Movement]
    @State private var open = false
    private var total: Double { items.reduce(0) { $0 + $1.quantity_g } }
    private var isIn: Bool { items.first?.type == "in" }

    var body: some View {
        VStack(spacing: 0) {
            Button { withAnimation(.easeInOut(duration: 0.18)) { open.toggle() } } label: {
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(movDate(items.first?.created_at)).font(.system(size: 14, weight: .semibold)).foregroundStyle(.white)
                        Text(t("st.positions", ["n": "\(items.count)"])).font(.system(size: 11)).foregroundStyle(.white.opacity(0.4))
                    }
                    Spacer()
                    Text((isIn ? "+" : "−") + grams(total))
                        .font(.system(size: 15, weight: .bold))
                        .foregroundStyle(isIn ? BrandKit.analytics : BrandKit.stash)
                    Image(systemName: open ? "chevron.up" : "chevron.down").font(.system(size: 11)).foregroundStyle(.white.opacity(0.4))
                }
                .padding(14)
            }
            .buttonStyle(.plain)
            if open {
                VStack(spacing: 0) {
                    ForEach(Array(items.enumerated()), id: \.element.id) { idx, mv in
                        HStack {
                            Text("\(mv.brand) · \(mv.flavor)").font(.system(size: 13)).foregroundStyle(.white.opacity(0.85))
                            Spacer()
                            Text((isIn ? "+" : "−") + grams(mv.quantity_g)).font(.system(size: 13, weight: .semibold))
                                .foregroundStyle(isIn ? BrandKit.analytics : BrandKit.stash)
                        }
                        .padding(.vertical, 8).padding(.horizontal, 14)
                        if idx < items.count - 1 { Divider().overlay(Color.white.opacity(0.06)).padding(.leading, 14) }
                    }
                }
                .padding(.bottom, 6)
            }
        }
        .background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 14))
    }
}

private func movDate(_ iso: String?) -> String {
    guard let d = parseISO(iso) else { return "—" }
    let f = DateFormatter(); f.locale = appLocale(); f.dateFormat = "d MMM, HH:mm"
    return f.string(from: d)
}

private struct AddMovementSheet: View {
    @Bindable var m: StashModel
    @Environment(\.dismiss) private var dismiss
    @State private var rows = [StashModel.MovRow()]
    @State private var reason = ""

    var body: some View {
        NavigationStack {
            ZStack {
                Color.black.ignoresSafeArea()
                ScrollView {
                    VStack(spacing: 12) {
                        Picker("", selection: $m.movMode) {
                            Text(t("st.in")).tag("in"); Text(t("st.out")).tag("out"); Text(t("st.writeoff")).tag("writeoff")
                        }.pickerStyle(.segmented)

                        ForEach($rows) { $row in
                            VStack(spacing: 8) {
                                TextField(t("st.brand"), text: $row.brand).textFieldStyle(.plain)
                                    .padding(10).background(Color.white.opacity(0.07), in: RoundedRectangle(cornerRadius: 10)).foregroundStyle(.white)
                                TextField(t("st.flavor"), text: $row.flavor).textFieldStyle(.plain)
                                    .padding(10).background(Color.white.opacity(0.07), in: RoundedRectangle(cornerRadius: 10)).foregroundStyle(.white)
                                TextField(t("st.grams"), text: $row.grams).keyboardType(.numberPad)
                                    .padding(10).background(Color.white.opacity(0.07), in: RoundedRectangle(cornerRadius: 10)).foregroundStyle(.white)
                            }
                            .padding(12).background(Color.white.opacity(0.04), in: RoundedRectangle(cornerRadius: 14))
                        }
                        Button { rows.append(.init()) } label: {
                            Label(t("st.moreRow"), systemImage: "plus").font(.system(size: 14, weight: .medium)).foregroundStyle(BrandKit.stash)
                        }
                        if m.movMode == "writeoff" {
                            TextField(t("st.writeoffReasonField"), text: $reason).textFieldStyle(.plain)
                                .padding(10).background(Color.white.opacity(0.07), in: RoundedRectangle(cornerRadius: 10)).foregroundStyle(.white)
                        }
                    }
                    .padding(16)
                }
            }
            .navigationTitle(t("st.movement")).navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(t("cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(t("save")) {
                        Task { if await m.saveMovement(rows, reason: reason) { dismiss() } }
                    }.disabled(m.saving)
                }
            }
            .toolbarBackground(.black, for: .navigationBar)
            .preferredColorScheme(.dark)
        }
    }
}

// MARK: Инвентарь

private struct InventoryTab: View {
    @Bindable var m: StashModel
    var body: some View {
        if m.inventories.isEmpty {
            Text(t("st.noInventories")).font(.system(size: 14)).foregroundStyle(.white.opacity(0.4)).padding(.top, 40)
        } else {
            ForEach(m.inventories) { inv in InventoryRow(inv: inv) }
        }
    }
}

private struct InventoryRow: View {
    let inv: Inventory
    @State private var open = false
    private var net: Double { (inv.items ?? []).reduce(0) { $0 + ($1.diff_g ?? 0) } }

    var body: some View {
        VStack(spacing: 0) {
            Button { withAnimation(.easeInOut(duration: 0.18)) { open.toggle() } } label: {
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(shortDateTime(inv.created_at)).font(.system(size: 14, weight: .semibold)).foregroundStyle(.white)
                        Text(t("st.discrepancies", ["n": "\((inv.items ?? []).count)"])).font(.system(size: 11)).foregroundStyle(.white.opacity(0.4))
                    }
                    Spacer()
                    Text((net > 0 ? "+" : "") + grams(net))
                        .font(.system(size: 15, weight: .bold))
                        .foregroundStyle(net < 0 ? BrandKit.menu : BrandKit.analytics)
                    Image(systemName: open ? "chevron.up" : "chevron.down").font(.system(size: 11)).foregroundStyle(.white.opacity(0.4))
                }
                .padding(14)
            }
            .buttonStyle(.plain)
            if open {
                VStack(spacing: 0) {
                    ForEach(Array((inv.items ?? []).enumerated()), id: \.offset) { idx, it in
                        let d = it.diff_g ?? 0
                        HStack {
                            Text("\(it.brand ?? "") · \(it.flavor ?? "")").font(.system(size: 13)).foregroundStyle(.white.opacity(0.85))
                            Spacer()
                            Text((d > 0 ? "+" : "") + grams(d)).font(.system(size: 13, weight: .semibold))
                                .foregroundStyle(d < 0 ? BrandKit.menu : BrandKit.analytics)
                        }
                        .padding(.vertical, 8).padding(.horizontal, 14)
                        if idx < (inv.items ?? []).count - 1 { Divider().overlay(Color.white.opacity(0.06)).padding(.leading, 14) }
                    }
                }
                .padding(.bottom, 6)
            }
        }
        .background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 14))
    }
}

// MARK: даты

private func longDate(_ d: Date) -> String {
    let f = DateFormatter(); f.locale = appLocale(); f.dateFormat = "EEE, d MMMM"
    return f.string(from: d).capitalized
}
private func shortDateTime(_ iso: String?) -> String {
    guard let date = parseISO(iso) else { return "—" }
    let f = DateFormatter(); f.locale = appLocale(); f.dateFormat = "d MMM, HH:mm"
    return f.string(from: date)
}
