import SwiftUI

// Дефолт категорий бесплатных кальянов (если владелец не задал свои в дашборде).
private let DEFAULT_FREE_CATS = ["Сотрудники", "Владелец", "Менеджер", "Гость", "Дегустация"]

private func grams(_ g: Double) -> String {
    let f = NumberFormatter(); f.numberStyle = .decimal; f.groupingSeparator = " "; f.maximumFractionDigits = 0
    return (f.string(from: NSNumber(value: g)) ?? "0") + " г"
}
// .numberPad клавиатура не даёт своей кнопки «Готово» (в отличие от обычной), и тап мимо
// поля её не закрывал вообще — юзер-репорт 2026-08-05 (Движение/Инвентаризация, поле граммов).
private func hideKeyboard() {
    UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
}
// eur() — общий модульный хелпер в PeopleView.swift (после распила Д2 стал internal).
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
    var freeCats: [String] = DEFAULT_FREE_CATS   // категории бесплатных — настраиваются владельцем в дашборде
    var freeCat = DEFAULT_FREE_CATS[0]
    var venueBase = 0.0
    var shiftLoading = true
    var saving = false
    // Снэпшот уже сохранённых сегодня продаж — грамовка ЗАФИКСИРОВАНА на момент loadShift()
    // (реальный portion_g из hookah_sales), а не живая настройка типа. Иначе смена грамовки
    // в Настройках задним числом двигает venueLeft для уже пробитых сегодня чеков.
    var savedGrams = 0.0
    var savedQtyByType: [String: Int] = [:]

    // KPI-цели по кальянам (текущий календарный месяц)
    var goals: [HookahGoal] = []
    var monthQty: [String: Int] = [:]   // type_id → платных кальянов за месяц
    var goalsLoading = true

    // Склад
    var stock: [StockItem] = []
    var movements: [Movement] = []
    var inventories: [Inventory] = []
    var search = ""
    var showLowOnly = false
    var showOutOfStock = false
    var movMode = "in"
    var warehouseLoading = true

    init(rid: String, canSeeMoney: Bool) { self.rid = rid; self.canSeeMoney = canSeeMoney }

    private let df: DateFormatter = {
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.locale = Locale(identifier: "en_US_POSIX"); return f
    }()
    func key(_ d: Date) -> String { df.string(from: d) }
    var dateStr: String { key(currentDate) }
    var isToday: Bool { dateStr == key(Date()) }

    // MARK: смена

    @discardableResult
    func loadShift() async -> Bool {
        #if DEBUG
        if ProcessInfo.processInfo.environment["MISE_DEMO_UI"] == "1" { seedDemo(); return true }
        #endif
        shiftLoading = true; defer { shiftLoading = false }
        async let tpsR = try? DB.from("hookah_types").select().eq("is_active", true).order("created_at").list(HookahType.self)
        // venueBase = вся история «выдано в зал» минус «использовано» минус «списано с зала» —
        // нет running-агрегата на сервере, поэтому тянем всё целиком. Без явного .limit()
        // PostgREST молча режет на 1000 строк — на старом заведении venueBase тихо занижался
        // бы за этим потолком. .limit() тут — не полный фикс (потолок всё ещё есть), а страховка
        // от тихого урезания на разумный срок; настоящий фикс — серверный агрегат.
        async let salesR = try? DB.from("hookah_sales")
            .select("hookah_type_id, quantity, portion_g, is_free, date, flavor").limit(20000).list(HookahSale.self)
        // Полный select — Movement требует brand/flavor (иначе строки отбрасываются Lossy-декодом).
        async let outsR = try? DB.from("tobacco_movements").select().eq("type", "out").limit(20000).list(Movement.self)
        async let venueWoR = try? DB.from("tobacco_movements").select().eq("type", "writeoff").limit(20000).list(Movement.self)
        // Категории бесплатных кальянов из настроек заведения (дашборд → Настройки → Кальян).
        nonisolated struct FreeCatsSettings: Codable { let free_hookah_categories: [String]? }
        if let cats = try? await DB.from("restaurant_settings").select("free_hookah_categories").limit(1).list(FreeCatsSettings.self).first?.free_hookah_categories, !cats.isEmpty {
            freeCats = cats
            if !freeCats.contains(freeCat) { freeCat = freeCats.first ?? freeCat }
        }
        // Только при успехе перезаписываем — сбой на refresh не должен стирать смену.
        guard let tps = await tpsR, let sales = await salesR, let outs = await outsR, let venueWo = await venueWoR else {
            if !types.isEmpty { flash(t("refreshFailed")) }
            return false
        }
        types = tps
        var p: [String: String] = [:], fr: [String: [String: String]] = [:]
        var pastGrams = 0.0
        var todaySavedGrams = 0.0
        var todaySavedQty: [String: Int] = [:]
        for r in sales {
            if r.date == dateStr, let id = r.hookah_type_id {
                let q = Int(r.quantity ?? 0)
                todaySavedQty[id, default: 0] += q
                todaySavedGrams += (r.quantity ?? 0) * (r.portion_g ?? 0)
                if r.is_free == true {
                    let cat = r.flavor ?? (freeCats.first ?? "")
                    fr[id, default: [:]][cat] = String((Int(fr[id]?[cat] ?? "") ?? 0) + q)
                } else {
                    p[id] = String((Int(p[id] ?? "") ?? 0) + q)
                }
            } else if let d = r.date, d < dateStr {
                // Только СТРОГО прошлые даты — иначе продажи ПОСЛЕ выбранного дня (навигация
                // назад по смене) тоже считались «прошлым» и venueBase на старых днях врал.
                pastGrams += (r.quantity ?? 0) * (r.portion_g ?? 0)
            }
        }
        paid = p; free = fr
        savedGrams = todaySavedGrams
        savedQtyByType = todaySavedQty
        // Списание «с заведения» = движение writeoff без бренда/вкуса (общий вес зала).
        let venueWriteoff = venueWo.filter { $0.brand.isEmpty && $0.flavor.isEmpty }.reduce(0) { $0 + $1.quantity_g }
        venueBase = max(0, outs.reduce(0) { $0 + $1.quantity_g } - pastGrams - venueWriteoff)
        return true
    }

    // MARK: KPI-цели

    /// Ключ текущего календарного месяца «YYYY-MM» (по реальной дате, не по навигации смены).
    var monthKey: String {
        let f = DateFormatter(); f.dateFormat = "yyyy-MM"; f.locale = Locale(identifier: "en_US_POSIX")
        return f.string(from: Date())
    }
    private func monthBounds() -> (String, String) {
        let cal = Calendar.current
        let first = cal.date(from: cal.dateComponents([.year, .month], from: Date())) ?? Date()
        let next = cal.date(byAdding: .month, value: 1, to: first) ?? first
        let last = cal.date(byAdding: .day, value: -1, to: next) ?? next
        return (key(first), key(last))
    }

    func loadGoals() async {
        goalsLoading = true; defer { goalsLoading = false }
        let (from, to) = monthBounds()
        async let gsR = try? DB.from("hookah_goals").select().eq("month", monthKey)
            .order("created_at").list(HookahGoal.self)
        async let salesR = try? DB.from("hookah_sales").select("hookah_type_id, quantity, is_free, date")
            .gte("date", from).lte("date", to).eq("is_free", false).list(HookahSale.self)
        guard let gs = await gsR, let sales = await salesR else {
            if !goals.isEmpty { flash(t("refreshFailed")) }
            return
        }
        goals = gs
        var q: [String: Int] = [:]
        for r in sales {
            guard let id = r.hookah_type_id else { continue }
            q[id, default: 0] += Int(r.quantity ?? 0)
        }
        monthQty = q
    }

    func goalProgress(_ g: HookahGoal) -> Int {
        (g.type_ids ?? []).reduce(0) { $0 + (monthQty[$1] ?? 0) }
    }

    func saveGoal(title: String?, typeIds: [String], target: Int) async {
        let values: [String: Any] = [
            "title": title ?? NSNull(), "type_ids": typeIds,
            "target_qty": target, "month": monthKey,
        ]
        try? await DB.from("hookah_goals").insert(values).run()
        await loadGoals()
    }

    func deleteGoal(_ g: HookahGoal) async {
        try? await DB.from("hookah_goals").delete().eq("id", g.id).run()
        await loadGoals()
    }

    func paidOf(_ id: String) -> Int { Int(paid[id] ?? "") ?? 0 }
    func freeOf(_ id: String, _ cat: String) -> Int { Int(free[id]?[cat] ?? "") ?? 0 }
    func freeTotalOf(_ id: String) -> Int { freeCats.reduce(0) { $0 + freeOf(id, $1) } }
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
    // Сохранённая часть — по реальной portion_g из БД (savedGrams). Несохранённая
    // дельта (то, что ввели, но ещё не нажали «Сохранить смену») — по живой настройке,
    // это единственно верное значение для нового ввода, ведь в БД его ещё нет.
    var gramsUsed: Double {
        savedGrams + types.reduce(0) { acc, tp in
            let currentQty = paidOf(tp.id) + freeTotalOf(tp.id)
            let delta = max(0, currentQty - (savedQtyByType[tp.id] ?? 0))
            return acc + Double(delta) * (tp.portion_g ?? 0)
        }
    }
    // НЕ клампим в 0 — отрицательное значение сигналит расхождение (продано больше, чем
    // выдано в зал); web показывает это же значение красным (app/tobacco/page.tsx), раньше
    // iOS тихо прятал сигнал за max(0, ...) (аудит M1, 2026-08-15).
    var venueLeft: Double { venueBase - gramsUsed }

    func saveShift() async {
        // Гвард от двойного тапа: без него быстрый второй тап запускал второй
        // delete+insert параллельно первому — удвоенные продажи за день.
        guard !saving else { return }
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
                // Категории из настроек + категории, реально присутствующие в введённых данных —
                // если владелец убрал категорию в дашборде уже после того, как по ней были продажи
                // сегодня, freeCats её больше не содержит и цифры просто терялись при пересохранении.
                let cats = Set(freeCats).union((free[tp.id] ?? [:]).keys)
                for cat in cats {
                    let f = freeOf(tp.id, cat)
                    if f > 0 {
                        rows.append(["hookah_type_id": tp.id, "quantity": f, "date": dateStr,
                                     "price": 0, "portion_g": tp.portion_g ?? 0, "is_free": true, "flavor": cat])
                    }
                }
            }
            if !rows.isEmpty { try await DB.from("hookah_sales").insert(rows).run() }
            // Перечитываем — иначе savedGrams/savedQtyByType остаются старыми, и плитка «Табак»/
            // остаток зала завышены (считают уже сохранённый ввод ещё раз как «несохранённую дельту»).
            await loadShift()
            flash(t("st.shiftSaved", ["p": "\(paidTotal)"]) + (freeTotal > 0 ? t("st.shiftSavedFree", ["f": "\(freeTotal)"]) : ""))
        } catch {
            flash(t("saveFailed", ["err": error.localizedDescription]))
        }
    }

    func shiftDay(_ d: Int) async {
        let prev = currentDate
        currentDate = Calendar.current.date(byAdding: .day, value: d, to: currentDate) ?? currentDate
        // Сбой загрузки нового дня раньше оставлял на экране данные ПРЕДЫДУЩЕГО дня под
        // датой НОВОГО — «Сохранить» дописал бы их не туда. Откатываем дату при неудаче.
        if !(await loadShift()) { currentDate = prev }
    }

    /// Переход к сегодняшнему дню — тот же откат на сбое, что и в shiftDay().
    func goToToday() async {
        let prev = currentDate
        currentDate = Date()
        if !(await loadShift()) { currentDate = prev }
    }

    // MARK: склад

    func loadWarehouse() async {
        #if DEBUG
        if ProcessInfo.processInfo.environment["MISE_DEMO_UI"] == "1" { warehouseLoading = false; return }
        #endif
        defer { warehouseLoading = false }
        async let sR = try? DB.from("tobacco_stock").select().order("brand").order("flavor").list(StockItem.self)
        // 200 обрубало ленту и правку/удаление старых батчей раньше, чем у venueBase
        // (loadShift читает всю историю без лимита) — расхождение между лентой и цифрами.
        async let mvR = try? DB.from("tobacco_movements").select().order("created_at", ascending: false).limit(1000).list(Movement.self)
        async let ivR = try? DB.from("tobacco_inventories").select().order("created_at", ascending: false).limit(50).list(Inventory.self)
        // Только при успехе перезаписываем — сбой на refresh не должен стирать склад.
        guard let s = await sR, let mv = await mvR, let iv = await ivR else {
            if !stock.isEmpty { flash(t("refreshFailed")) }
            return
        }
        stock = s; movements = mv; inventories = iv
    }

    func isLow(_ s: StockItem) -> Bool { s.quantity_g > 0 && s.quantity_g <= (s.min_quantity_g ?? 200) }
    func stockColor(_ s: StockItem) -> Color {
        s.quantity_g == 0 ? BrandKit.menu : isLow(s) ? BrandKit.stash : BrandKit.analytics
    }
    var inStock: [StockItem] { stock.filter { $0.quantity_g > 0 } }
    var lowCount: Int { inStock.filter(isLow).count }
    var outOfStockCount: Int { stock.filter { $0.quantity_g == 0 }.count }
    var filteredStock: [StockItem] {
        let base = showOutOfStock ? stock.filter { $0.quantity_g == 0 } : inStock
        return base
            .filter { search.isEmpty || "\($0.brand) \($0.flavor)".lowercased().contains(search.lowercased()) }
            .filter { !showLowOnly || (!showOutOfStock && isLow($0)) }
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

    // MARK: подсказки бренда/вкуса (память склада — логика app/tobacco/page.tsx)

    nonisolated private func norm(_ s: String) -> String { s.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }

    /// Все известные бренды (включая нулевой остаток — это «память»).
    var allBrands: [String] {
        Array(Set(stock.map(\.brand))).filter { !$0.isEmpty }.sorted { $0.lowercased() < $1.lowercased() }
    }
    /// Все известные вкусы.
    var allFlavors: [String] {
        Array(Set(stock.map(\.flavor))).filter { !$0.isEmpty }.sorted { $0.lowercased() < $1.lowercased() }
    }
    /// Бренды, что есть в наличии (для выдачи/списания — выдать можно только то, что на складе).
    var outBrands: [String] {
        Array(Set(stock.filter { $0.quantity_g > 0 }.map(\.brand))).filter { !$0.isEmpty }.sorted { $0.lowercased() < $1.lowercased() }
    }
    func brandSuggestions(_ outOnly: Bool) -> [String] { outOnly ? outBrands : allBrands }
    /// Вкусы для выбранного бренда (для выдачи — только с остатком > 0).
    func flavorsForBrand(_ brand: String, outOnly: Bool) -> [String] {
        let nb = norm(brand)
        let matched = stock.filter { norm($0.brand) == nb && (!outOnly || $0.quantity_g > 0) }.map(\.flavor)
        let list = matched.isEmpty && !outOnly && brand.isEmpty ? allFlavors : matched
        return Array(Set(list)).filter { !$0.isEmpty }.sorted { $0.lowercased() < $1.lowercased() }
    }
    /// Остаток по бренду+вкусу (для подсказки «Доступно»). Нечувствительно к регистру/пробелам.
    func stockOf(_ brand: String, _ flavor: String) -> StockItem? {
        let nb = norm(brand), nf = norm(flavor)
        return stock.first { norm($0.brand) == nb && norm($0.flavor) == nf }
    }

    struct MovRow: Identifiable { let id = UUID(); var brand = ""; var flavor = ""; var grams = "" }

    // AI prefill: set by handleAI(), consumed by AddMovementSheet.
    var aiMovRows: [MovRow]? = nil
    var shouldOpenMovSheet = false

    func handleAI(_ message: String) async -> String? {
        let ctx = allBrands.prefix(30).joined(separator: ", ")
        do {
            let result = try await API.aiChat(module: "stash", message: message, context: ctx)
            guard let type = result["type"] as? String, type == "prefill",
                  let raw = result["rows"] as? [[String: Any]] else {
                flash(t("ai.noData")); return nil
            }
            let rows = raw.compactMap { d -> MovRow? in
                guard let b = d["brand"] as? String, let fl = d["flavor"] as? String,
                      let g = d["grams"] as? String else { return nil }
                var r = MovRow(); r.brand = b; r.flavor = fl; r.grams = g; return r
            }
            if !rows.isEmpty {
                aiMovRows = rows
                shouldOpenMovSheet = true
                flash(t("ai.applied"))
            } else {
                flash(t("ai.noData"))
            }
        } catch {
            flash(aiErrorMessage(error))
        }
        return nil
    }

    /// Тримит/схлопывает строки и валидирует остаток по переданному снэпшоту склада.
    /// Ничего не пишет в БД. nil (с flash) → невалидно. Снэпшот параметром — вызывающий
    /// может передать как живой остаток, так и симулированный (после отката старого батча),
    /// чтобы провалившаяся валидация не оставляла БД в промежуточном состоянии.
    private func prepareRows(_ rows: [MovRow], mode: String, stock stockSnapshot: [StockItem]) -> [MovRow]? {
        var filled = rows
            .map { MovRow(brand: $0.brand.trimmingCharacters(in: .whitespaces), flavor: $0.flavor.trimmingCharacters(in: .whitespaces), grams: $0.grams) }
            .filter { !$0.brand.isEmpty && !$0.flavor.isEmpty && (Double($0.grams) ?? 0) > 0 }
        if filled.isEmpty { flash(t("st.fillRow")); return nil }
        // Схлопываем повторяющиеся бренд/вкус (сумма граммов) до параллельной записи —
        // иначе два запроса по одному и тому же товару читают один и тот же "fresh"
        // остаток и один апдейт затирает дельту другого.
        var merged: [String: MovRow] = [:]
        var order: [String] = []
        for r in filled {
            let key = norm(r.brand) + "\u{0}" + norm(r.flavor)
            if let ex = merged[key] {
                merged[key] = MovRow(brand: ex.brand, flavor: ex.flavor, grams: String((Double(ex.grams) ?? 0) + (Double(r.grams) ?? 0)))
            } else {
                merged[key] = r; order.append(key)
            }
        }
        filled = order.compactMap { merged[$0] }
        if mode != "in" {
            for r in filled {
                guard let item = stockSnapshot.first(where: { norm($0.brand) == norm(r.brand) && norm($0.flavor) == norm(r.flavor) }) else {
                    flash(t("st.notInStock", ["b": r.brand, "fl": r.flavor])); return nil
                }
                if (Double(r.grams) ?? 0) > item.quantity_g {
                    flash(t("st.onlyLeft", ["b": r.brand, "fl": r.flavor, "g": grams(item.quantity_g)])); return nil
                }
            }
        }
        return filled
    }

    /// Собственно запись строк движения + апдейт остатка по переданному снэпшоту склада.
    /// Не гвардит `saving` — вызывающий уже держит флаг.
    private func writeMovementRows(_ filled: [MovRow], reason: String, mode: String, batchId: String, stock fresh: [StockItem], createdAt: String? = nil) async -> Bool {
        let rid = rid
        let defReason = reason.isEmpty ? (mode == "in" ? "Поставка" : mode == "out" ? "Выдача в зал" : "Списание") : reason
        // Каждая строка — свой товар (после схлопывания дублей), запросы независимы →
        // шлём параллельно вместо последовательной цепочки (было ~2×N round-trip'ов подряд).
        // Значения из MainActor (mode/rid) сняты в локальные let ДО addTask — дочерние
        // задачи не изолированы на MainActor и не могут читать его свойства напрямую.
        return await withTaskGroup(of: Bool.self) { group in
            for r in filled {
                group.addTask { [norm] in
                    let qty = Double(r.grams) ?? 0
                    // Нечувствительный к регистру/пробелам поиск + канонические бренд/вкус из склада — не плодим дубли.
                    let existing = fresh.first { norm($0.brand) == norm(r.brand) && norm($0.flavor) == norm(r.flavor) }
                    let brand = existing?.brand ?? r.brand
                    let flavor = existing?.flavor ?? r.flavor
                    do {
                        var values: [String: Any] = [
                            "restaurant_id": rid, "brand": brand, "flavor": flavor, "quantity_g": qty,
                            "type": mode, "batch_id": batchId, "reason": defReason,
                            "flavor_id": existing?.id ?? NSNull(),
                        ]
                        // Правка батча передаёт исходный created_at — иначе дата/время движения
                        // «прыгали» на момент правки вместо исходного момента поставки/выдачи.
                        if let createdAt { values["created_at"] = createdAt }
                        try await DB.from("tobacco_movements").insert(values).run()
                        if let ex = existing {
                            let delta = mode == "in" ? qty : -qty
                            // Клампим в 0 — иначе гонка параллельных списаний могла увести остаток
                            // в минус, а такая позиция выпадала из всех фильтров UI (ни «в наличии», ни «нет»).
                            try await DB.from("tobacco_stock").update(["quantity_g": max(0, ex.quantity_g + delta)]).eq("id", ex.id).run()
                        } else if mode == "in" {
                            try await DB.from("tobacco_stock").insert([
                                "restaurant_id": rid, "brand": brand, "flavor": flavor, "quantity_g": qty, "flavor_name": flavor,
                            ]).run()
                        }
                        return true
                    } catch {
                        return false
                    }
                }
            }
            var allOk = true
            for await r in group where !r { allOk = false }
            return allOk
        }
    }

    func saveMovement(_ rows: [MovRow], reason: String, mode: String? = nil) async -> Bool {
        // Гвард от двойного тапа Save: .disabled(m.saving) обновляется на следующий кадр,
        // быстрый двойной тап успевает создать два Task ещё до перерисовки — тогда без
        // этой проверки уходят два одинаковых батча движений.
        guard !saving else { return false }
        saving = true; defer { saving = false }
        let mvMode = mode ?? movMode
        // .fresh() — читаем мимо 5-минутного кеша DB.swift: без этого валидация и апдейт
        // остатка шли по устаревшим данным (read-modify-write по кешу теряло чужие правки).
        guard let freshStock = try? await DB.from("tobacco_stock").select().fresh().list(StockItem.self) else {
            flash(t("refreshFailed")); return false
        }
        guard let filled = prepareRows(rows, mode: mvMode, stock: freshStock) else { return false }
        if mvMode == "writeoff" && reason.trimmingCharacters(in: .whitespaces).isEmpty { flash(t("st.writeoffReason")); return false }
        let batchId = UUID().uuidString
        let ok = await writeMovementRows(filled, reason: reason, mode: mvMode, batchId: batchId, stock: freshStock)
        guard ok else { flash(t("ai.errGeneric")); await loadWarehouse(); return false }
        await loadWarehouse()
        // Выдача в зал (out) меняет venueBase — нужно сразу пересчитать смену.
        if mvMode == "out" { await loadShift() }
        // Уведомление о движении — вместо растущего списка «товар1, товар2 +N ещё» на
        // каждое сохранение (юзер-фидбек 2026-08-09): просто факт что склад тронули.
        notifyMovement(mode: mvMode, count: filled.count)
        flash(t("st.saved", ["n": "\(filled.count)"]))
        return true
    }

    /// Уведомление о движении склада — приход/выдача/списание, если включено в настройках.
    private func notifyMovement(mode: String, count: Int) {
        let prefs = UserDefaults.standard.dictionary(forKey: "mise_notif_prefs") as? [String: Bool]
        guard prefs?["low_stock"] ?? true else { return } // по умолчанию включено
        let titleKey: String, fallbackTitle: String
        switch mode {
        case "in": titleKey = "notify.stashInTitle"; fallbackTitle = t("st.in")
        case "out": titleKey = "notify.stashOutTitle"; fallbackTitle = t("st.out")
        default: titleKey = "notify.stashWriteoffTitle"; fallbackTitle = t("st.writeoff")
        }
        Task {
            await Notify.send(
                type: "stash_" + mode,
                title: fallbackTitle, body: "\(count)",
                audience: ["managers": true],
                titleKey: titleKey,
                bodyKey: "notify.stashMovementBody", bodyParams: ["n": "\(count)"]
            )
        }
    }

    /// Списание «с заведения»: только вес, без бренда/вкуса. Уменьшает общий объём зала (venueBase),
    /// склад не трогает. Маркер — пустые brand/flavor у движения writeoff.
    func saveVenueWriteoff(grams gramsStr: String, reason: String, batchId: String? = nil) async -> Bool {
        guard !saving else { return false }
        let qty = Double(gramsStr.filter { $0.isNumber || $0 == "." }) ?? 0
        if qty <= 0 { flash(t("st.fillRow")); return false }
        if reason.trimmingCharacters(in: .whitespaces).isEmpty { flash(t("st.writeoffReason")); return false }
        if qty > venueBase { flash(t("st.onlyLeftVenue", ["g": grams(max(0, venueBase))])); return false }
        saving = true; defer { saving = false }
        do {
            try await DB.from("tobacco_movements").insert([
                "restaurant_id": rid, "brand": "", "flavor": "", "quantity_g": qty,
                "type": "writeoff", "batch_id": batchId ?? UUID().uuidString, "reason": reason,
            ]).run()
        } catch {
            flash(t("saveFailed", ["err": error.localizedDescription])); return false
        }
        await loadWarehouse()
        await loadShift()
        flash(t("st.saved", ["n": "1"]))
        return true
    }

    /// Откатывает дельты остатка и удаляет все строки батча. Возвращает успех — на неудаче
    /// (сеть/БД) вызывающий не должен показывать «удалено»/«сохранено» поверх провала.
    @discardableResult
    private func revertAndDelete(_ items: [Movement]) async -> Bool {
        guard let fresh = try? await DB.from("tobacco_stock").select().fresh().list(StockItem.self) else {
            flash(t("refreshFailed")); return false
        }
        // Складские движения (с брендом/вкусом) откатываем; «с заведения» (пустые) — только удаляем,
        // venueBase пересчитается из оставшихся движений в loadShift().
        var adjust: [String: Double] = [:]
        var exById: [String: StockItem] = [:]
        var missing: [String] = []
        for mv in items where !mv.brand.isEmpty && !mv.flavor.isEmpty {
            guard let ex = fresh.first(where: { norm($0.brand) == norm(mv.brand) && norm($0.flavor) == norm(mv.flavor) }) else {
                missing.append("\(mv.brand) · \(mv.flavor)"); continue
            }
            adjust[ex.id, default: 0] += (mv.type == "in" ? -mv.quantity_g : mv.quantity_g)
            exById[ex.id] = ex
        }
        var ok = true
        for (id, delta) in adjust {
            guard let ex = exById[id] else { continue }
            do { try await DB.from("tobacco_stock").update(["quantity_g": max(0, ex.quantity_g + delta)]).eq("id", id).run() }
            catch { ok = false }
        }
        for mv in items {
            do { try await DB.from("tobacco_movements").delete().eq("id", mv.id).run() }
            catch { ok = false }
        }
        if !missing.isEmpty { flash(t("saveFailed", ["err": missing.joined(separator: ", ")])) }
        else if !ok { flash(t("ai.errGeneric")) }
        return ok
    }

    /// Удаление перемещения (батча) с откатом остатка.
    func deleteMovementBatch(_ items: [Movement]) async {
        guard !items.isEmpty, !saving else { return }
        saving = true; defer { saving = false }
        let ok = await revertAndDelete(items)
        await loadWarehouse()
        await loadShift()
        if ok { flash(t("st.movDeleted")) }
    }

    /// Редактирование складского батча: валидируем новые строки ПРОТИВ СИМУЛИРОВАННОГО
    /// остатка (живой склад + откат старого батча в памяти) — и только если валидация
    /// проходит, реально откатываем старый батч и пишем новый. Раньше откат шёл первым,
    /// и любой сбой валидации после него (например «уже нет столько на складе», посчитанное
    /// по нередактированному остатку) стирал старую поставку/выдачу без замены.
    /// batch_id сохраняем — иначе правка «переезжает» в ленте как новая запись.
    func replaceMovementBatch(_ old: [Movement], rows: [MovRow], reason: String, mode: String? = nil) async -> Bool {
        guard !saving else { return false }
        saving = true; defer { saving = false }
        let mvMode = mode ?? old.first?.type ?? movMode
        guard let liveStock = try? await DB.from("tobacco_stock").select().fresh().list(StockItem.self) else {
            flash(t("refreshFailed")); return false
        }
        var simulated: [String: Double] = Dictionary(uniqueKeysWithValues: liveStock.map { ($0.id, $0.quantity_g) })
        var idByKey: [String: String] = [:]
        for s in liveStock { idByKey[norm(s.brand) + "\u{0}" + norm(s.flavor)] = s.id }
        for mv in old where !mv.brand.isEmpty && !mv.flavor.isEmpty {
            guard let id = idByKey[norm(mv.brand) + "\u{0}" + norm(mv.flavor)] else { continue }
            let revert = mv.type == "in" ? -mv.quantity_g : mv.quantity_g
            simulated[id] = max(0, (simulated[id] ?? 0) + revert)
        }
        let simulatedStock = liveStock.map { s in
            StockItem(id: s.id, brand: s.brand, flavor: s.flavor, quantity_g: simulated[s.id] ?? s.quantity_g, min_quantity_g: s.min_quantity_g)
        }
        guard prepareRows(rows, mode: mvMode, stock: simulatedStock) != nil else { return false }
        if mvMode == "writeoff" && reason.trimmingCharacters(in: .whitespaces).isEmpty { flash(t("st.writeoffReason")); return false }
        // Валидация прошла — теперь безопасно откатывать старый батч.
        guard await revertAndDelete(old) else { return false }
        guard let postRevertStock = try? await DB.from("tobacco_stock").select().fresh().list(StockItem.self) else {
            flash(t("refreshFailed")); await loadWarehouse(); return false
        }
        guard let filled = prepareRows(rows, mode: mvMode, stock: postRevertStock) else { return false }
        let batchId = old.first?.batch_id ?? UUID().uuidString
        let ok = await writeMovementRows(filled, reason: reason, mode: mvMode, batchId: batchId, stock: postRevertStock, createdAt: old.first?.created_at)
        guard ok else { flash(t("ai.errGeneric")); await loadWarehouse(); return false }
        await loadWarehouse()
        if mvMode == "out" || old.contains(where: { $0.type == "out" }) { await loadShift() }
        notifyMovement(mode: mvMode, count: filled.count)
        flash(t("st.saved", ["n": "\(filled.count)"]))
        return true
    }

    /// Редактирование списания «с заведения»: валидируем против симулированного venueBase
    /// (текущий + возврат старого списания) ДО удаления — та же логика, что в replaceMovementBatch.
    func replaceVenueWriteoff(_ old: [Movement], grams gramsStr: String, reason: String) async -> Bool {
        guard !saving else { return false }
        let qty = Double(gramsStr.filter { $0.isNumber || $0 == "." }) ?? 0
        if qty <= 0 { flash(t("st.fillRow")); return false }
        if reason.trimmingCharacters(in: .whitespaces).isEmpty { flash(t("st.writeoffReason")); return false }
        let oldTotal = old.reduce(0) { $0 + $1.quantity_g }
        let simulatedVenueBase = venueBase + oldTotal
        if qty > simulatedVenueBase { flash(t("st.onlyLeftVenue", ["g": grams(max(0, simulatedVenueBase))])); return false }
        saving = true; defer { saving = false }
        guard await revertAndDelete(old) else { return false }
        let batchId = old.first?.batch_id ?? UUID().uuidString
        do {
            var values: [String: Any] = [
                "restaurant_id": rid, "brand": "", "flavor": "", "quantity_g": qty,
                "type": "writeoff", "batch_id": batchId, "reason": reason,
            ]
            if let createdAt = old.first?.created_at { values["created_at"] = createdAt }
            try await DB.from("tobacco_movements").insert(values).run()
        } catch {
            flash(t("saveFailed", ["err": error.localizedDescription])); await loadWarehouse(); await loadShift(); return false
        }
        await loadWarehouse()
        await loadShift()
        flash(t("st.saved", ["n": "1"]))
        return true
    }

    struct InvRow { let id: String; let brand: String; let flavor: String; let expected: Double; let actual: Double }

    func saveInventory(_ rows: [InvRow]) async -> Bool {
        guard !saving else { return false }
        let disc = rows.filter { abs($0.actual - $0.expected) > 0.001 }
        if disc.isEmpty { flash(t("st.invEmpty")); return false }
        saving = true; defer { saving = false }
        let items: [[String: Any]] = disc.map { r in
            ["brand": r.brand, "flavor": r.flavor, "expected_g": r.expected, "actual_g": r.actual, "diff_g": r.actual - r.expected]
        }
        do {
            try await DB.from("tobacco_inventories").insert(["restaurant_id": rid, "type": "warehouse", "items": items]).run()
            // Раньше расхождение только фиксировалось записью, но остаток на складе не менялся —
            // инвентаризация переставала иметь смысл: посчитал факт, сохранил, а склад как был.
            for r in disc {
                try await DB.from("tobacco_stock").update(["quantity_g": max(0, r.actual)]).eq("id", r.id).run()
            }
        } catch {
            flash(t("saveFailed", ["err": error.localizedDescription]))
            await loadWarehouse()
            return false
        }
        await loadWarehouse()
        flash(t("st.saved", ["n": "\(disc.count)"]))
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
            if let m {
                StashBody(m: m, aiEnabled: app.aiEnabled)
                    .transition(.opacity)
            } else {
                ZStack {
                    Color.miseBg.ignoresSafeArea()
                    ScrollView {
                        ShiftTabSkeleton().padding(16).padding(.bottom, 24)
                    }
                }
                .transition(.opacity)
            }
        }
        .animation(.easeOut(duration: 0.3), value: m == nil)
        .task {
            if m == nil {
                let model = StashModel(rid: app.restaurant?.id ?? "", canSeeMoney: app.canSeeMoney)
                m = model
                #if DEBUG
                if let t = ProcessInfo.processInfo.environment["MISE_DEMO_TAB"] { model.tab = t }
                #endif
                await model.loadShift()
                await model.loadWarehouse()
                await model.loadGoals()
            }
        }
    }
}

private struct StashBody: View {
    @Environment(AppModel.self) private var app
    @Bindable var m: StashModel
    let aiEnabled: Bool
    @State private var showAddMov = false
    @State private var showAddInv = false
    @State private var editBatch: MovBatchRef?
    @State private var pendingDeleteBatch: MovBatchRef?

    var body: some View {
        ZStack(alignment: .bottom) {
            TabView(selection: $m.tab) {
                AppTabPage(refresh: { await m.loadShift(); await m.loadGoals() }) { ShiftTab(m: m) }
                    .tabItem { Label(t("tab.stashShift"), systemImage: "flame.fill") }.tag("shift")
                AppTabPage(refresh: { await m.loadWarehouse() }) { StockTab(m: m) }
                    .tabItem { Label(t("tab.stock"), systemImage: "tray.full.fill") }.tag("stock")
                AppTabPage(refresh: { await m.loadWarehouse() }) {
                    MovementsTab(m: m, showAdd: $showAddMov,
                                 onEdit: { items in editBatch = MovBatchRef(items: items) },
                                 onDelete: { items in pendingDeleteBatch = MovBatchRef(items: items) })
                }
                    .tabItem { Label(t("tab.movements"), systemImage: "arrow.left.arrow.right") }.tag("movements")
                AppTabPage(refresh: { await m.loadWarehouse() }) { InventoryTab(m: m, showAdd: $showAddInv) }
                    .tabItem { Label(t("tab.inventory"), systemImage: "checklist") }.tag("inventory")
            }
            .tint(BrandKit.stash)
            .sensoryFeedback(.selection, trigger: m.tab)
            .tabEdgeSwipe(tabs: ["shift", "stock", "movements", "inventory"],
                          selection: $m.tab,
                          onFirstBack: app.availableApps.count > 1 ? { app.backToLauncher() } : nil)
            .blur(radius: AIChat.shared.open ? 2 : 0)
            .animation(.easeInOut(duration: 0.25), value: AIChat.shared.open)

            if let toast = m.toast {
                Text(toast).font(.system(size: 14, weight: .semibold)).foregroundStyle(.primary)
                    .padding(.horizontal, 18).padding(.vertical, 12)
                    .background(.ultraThinMaterial, in: Capsule())
                    .padding(.bottom, 60)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }

            if aiEnabled {
                AIButton(module: "stash") { msg in await m.handleAI(msg) }
            }
        }
        .animation(.easeInOut(duration: 0.2), value: m.toast)
        .onChange(of: m.shouldOpenMovSheet) { _, open in
            if open { showAddMov = true; m.shouldOpenMovSheet = false }
        }
        .sheet(isPresented: $showAddMov) { AddMovementSheet(m: m) }
        .sheet(item: $editBatch) { ref in AddMovementSheet(m: m, editBatch: ref.items) }
        .sheet(isPresented: $showAddInv) { AddInventorySheet(m: m) }
        .confirmationDialog(t("st.movDeleteConfirm"),
                            isPresented: Binding(get: { pendingDeleteBatch != nil }, set: { if !$0 { pendingDeleteBatch = nil } }),
                            titleVisibility: .visible) {
            Button(t("delete"), role: .destructive) {
                if let r = pendingDeleteBatch { Task { await m.deleteMovementBatch(r.items) } }
                pendingDeleteBatch = nil
            }
            Button(t("cancel"), role: .cancel) { pendingDeleteBatch = nil }
        }
    }
}

/// Обёртка батча движений для presentation через .sheet(item:)/confirmationDialog.
struct MovBatchRef: Identifiable {
    let items: [Movement]
    var id: String { items.first?.batch_id ?? items.first?.id ?? UUID().uuidString }
}

// MARK: Смена

private struct ShiftTab: View {
    @Bindable var m: StashModel
    @Environment(AppModel.self) private var app
    @State private var editingGoal: HookahGoal?
    @State private var showGoalEditor = false

    var body: some View {
        Group {
            if m.shiftLoading {
                ShiftTabSkeleton()
                    .transition(.opacity)
            } else if m.types.isEmpty {
                VStack(spacing: 6) {
                    Text(t("st.noTypes")).font(.system(size: 16, weight: .semibold)).foregroundStyle(.primary)
                    Text(t("st.noTypesHint"))
                        .font(.system(size: 13)).foregroundStyle(.primary.opacity(0.5)).multilineTextAlignment(.center)
                }
                .padding(.top, 50)
                .transition(.opacity)
            } else {
                VStack(spacing: 12) {
                    goalSection
                    dayNav
                    stats
                    venueLeftBanner
                    modeSeg
                    typesList
                    saveBtn
                }
                .transition(.opacity.combined(with: .move(edge: .bottom)))
            }
        }
        .animation(.spring(duration: 0.45, bounce: 0.08), value: m.shiftLoading)
        .sheet(isPresented: $showGoalEditor) {
            GoalEditor(goal: editingGoal, types: m.types,
                       onSave: { title, ids, target in Task { await m.saveGoal(title: title, typeIds: ids, target: target) } },
                       onDelete: { g in Task { await m.deleteGoal(g) } })
        }
    }

    // KPI-цель месяца — сверху смены: кальянщик видит прогресс там, где вбивает кальяны.
    @ViewBuilder private var goalSection: some View {
        if !m.goals.isEmpty {
            ForEach(m.goals) { g in
                GoalCard(g: g, current: m.goalProgress(g), typeNames: goalNames(g), editable: app.isOfficial)
                    .onTapGesture { if app.isOfficial { editingGoal = g; showGoalEditor = true } }
            }
        } else if app.isOfficial {
            Button { editingGoal = nil; showGoalEditor = true } label: {
                HStack(spacing: 8) {
                    Image(systemName: "target").font(.system(size: 15, weight: .bold))
                    Text(t("kpi.setGoal")).font(.system(size: 14, weight: .semibold))
                    Spacer()
                    Image(systemName: "plus").font(.system(size: 14, weight: .bold))
                }
                .foregroundStyle(BrandKit.stash)
                .padding(14)
                .background(BrandKit.stash.opacity(0.12), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            }
        }
    }

    private func goalNames(_ g: HookahGoal) -> String {
        let ids = Set(g.type_ids ?? [])
        let ns = m.types.filter { ids.contains($0.id) }.compactMap { $0.name }
        return ns.isEmpty ? t("kpi.allTypes") : ns.joined(separator: ", ")
    }

    private var dayNav: some View {
        HStack {
            navBtn("chevron.left") { Task { await m.shiftDay(-1) } }
            Spacer()
            VStack(spacing: 2) {
                Text(longDate(m.currentDate)).font(.system(size: 15, weight: .bold)).foregroundStyle(.primary)
                if !m.isToday {
                    Button { Task { await m.goToToday() } } label: {
                        Text(t("st.toToday")).font(.system(size: 11, weight: .semibold)).foregroundStyle(BrandKit.manager)
                    }
                }
            }
            Spacer()
            navBtn("chevron.right", disabled: m.isToday) { Task { await m.shiftDay(1) } }
        }
    }

    // Не LazyVGrid: ленивые сетки не участвуют в transition/offset родителя (карточки
    // "всплывают" на месте, пока остальной контент едет снизу вверх) — плиток тут всего
    // 3-4, лень не нужна, а обычный Grid корректно наследует анимацию входа.
    private var stats: some View {
        let items: [(String, String, Color)] = {
            var a: [(String, String, Color)] = [(t("st.sold"), "\(m.paidTotal)", BrandKit.stash),
                                                (t("st.free"), "\(m.freeTotal)", BrandKit.people)]
            if m.canSeeMoney { a.append((t("st.revenue"), eur(m.revenue), BrandKit.analytics)) }
            a.append((t("st.tobacco"), grams(m.gramsUsed), BrandKit.manager))
            return a
        }()
        let columns = m.canSeeMoney ? 2 : 3
        let rows = stride(from: 0, to: items.count, by: columns).map {
            Array(items[$0..<min($0 + columns, items.count)])
        }
        func tile(_ it: (String, String, Color)) -> some View {
            VStack(spacing: 3) {
                Text(it.1).font(.system(size: 17, weight: .heavy)).foregroundStyle(it.2)
                Text(it.0).font(.system(size: 11)).foregroundStyle(.primary.opacity(0.45))
            }
            .frame(maxWidth: .infinity).padding(.vertical, 12)
            .background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 14))
        }
        return Grid(horizontalSpacing: 8, verticalSpacing: 8) {
            ForEach(Array(rows.enumerated()), id: \.offset) { _, rowItems in
                GridRow {
                    ForEach(rowItems, id: \.0) { it in tile(it) }
                }
            }
        }
    }

    // Масса табака в заведении — паритет с web (app/tobacco/page.tsx): отрицательное
    // значение (продано больше, чем выдано в зал) красным, иначе синим (аудит M1, 2026-08-15).
    private var venueLeftBanner: some View {
        let negative = m.venueLeft < 0
        let color = negative ? BrandKit.menu : BrandKit.manager
        return HStack {
            Text(t("st.venueLeft")).font(.system(size: 12.5, weight: .semibold)).foregroundStyle(color)
            Spacer()
            Text(grams(m.venueLeft)).font(.system(size: 13, weight: .heavy)).foregroundStyle(color)
        }
        .padding(.horizontal, 14).padding(.vertical, 9)
        .background(color.opacity(0.07), in: RoundedRectangle(cornerRadius: 12))
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
                    ForEach(m.freeCats, id: \.self) { cat in
                        Button { m.freeCat = cat } label: {
                            Text(cat).font(.system(size: 13, weight: .medium))
                                .foregroundStyle(m.freeCat == cat ? .black : .white)
                                .padding(.horizontal, 14).padding(.vertical, 8)
                                .background(m.freeCat == cat ? BrandKit.people : Color.primary.opacity(0.08), in: Capsule())
                        }
                    }
                }
            }
        }
        VStack(spacing: 0) {
            ForEach(Array(m.types.enumerated()), id: \.element.id) { idx, tp in
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(tp.name ?? "—").font(.system(size: 15, weight: .medium)).foregroundStyle(.primary)
                        Text("\(eur(tp.price ?? 0)) · \(grams(tp.portion_g ?? 0))")
                            .font(.system(size: 12)).foregroundStyle(.primary.opacity(0.4))
                    }
                    Spacer()
                    TextField("0", text: Binding(get: { m.inputVal(tp.id) }, set: { m.setQty(tp.id, $0) }))
                        .keyboardType(.numberPad).multilineTextAlignment(.center)
                        .font(.system(size: 17, weight: .bold)).foregroundStyle(.primary)
                        .frame(width: 64).padding(.vertical, 8)
                        .background(Color.primary.opacity(0.07), in: RoundedRectangle(cornerRadius: 10))
                }
                .padding(.vertical, 11).padding(.horizontal, 14)
                if idx < m.types.count - 1 { Divider().overlay(Color.primary.opacity(0.08)).padding(.leading, 14) }
            }
        }
        .background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 16))
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
            Image(systemName: s).font(.system(size: 14, weight: .bold)).foregroundStyle(.primary)
                .frame(width: 36, height: 36)
        }.disabled(disabled).opacity(disabled ? 0.4 : 1)
    }
}

// MARK: Наличие

private struct StockTab: View {
    @Bindable var m: StashModel
    var body: some View {
        if m.warehouseLoading {
            RowListSkeleton(rows: 5)
        } else {
        HStack(spacing: 8) {
            HStack(spacing: 6) {
                Image(systemName: "magnifyingglass").font(.system(size: 13)).foregroundStyle(.primary.opacity(0.4))
                TextField(t("st.search"), text: $m.search).font(.system(size: 15)).foregroundStyle(.primary)
            }
            .padding(.horizontal, 12).padding(.vertical, 9)
            .background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 10))
            if m.lowCount > 0 {
                Button { m.showOutOfStock = false; m.showLowOnly.toggle() } label: {
                    Text(t("st.low", ["n": "\(m.lowCount)"])).font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(m.showLowOnly && !m.showOutOfStock ? .black : BrandKit.stash)
                        .padding(.horizontal, 12).padding(.vertical, 9)
                        .background(m.showLowOnly && !m.showOutOfStock ? BrandKit.stash : BrandKit.stash.opacity(0.16), in: RoundedRectangle(cornerRadius: 10))
                }
            }
            if m.outOfStockCount > 0 {
                Button { m.showLowOnly = false; m.showOutOfStock.toggle() } label: {
                    Text(t("st.outOfStock", ["n": "\(m.outOfStockCount)"])).font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(m.showOutOfStock ? .white : BrandKit.menu)
                        .padding(.horizontal, 12).padding(.vertical, 9)
                        .background(m.showOutOfStock ? BrandKit.menu : BrandKit.menu.opacity(0.16), in: RoundedRectangle(cornerRadius: 10))
                }
            }
        }
        if !m.inStock.isEmpty {
            HStack {
                Text(t("st.totalStock")).font(.system(size: 13)).foregroundStyle(.primary.opacity(0.55))
                Spacer()
                Text(grams(m.inStock.reduce(0) { $0 + $1.quantity_g })).font(.system(size: 16, weight: .heavy)).foregroundStyle(BrandKit.stash)
            }
            .padding(.horizontal, 14).padding(.vertical, 12)
            .background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 12))
        }
        if m.filteredStock.isEmpty {
            Text(t("empty")).font(.system(size: 14)).foregroundStyle(.primary.opacity(0.4)).padding(.top, 40)
                .transition(.opacity)
        } else {
            ForEach(m.stockByBrand, id: \.0) { brand, items in
                VStack(alignment: .leading, spacing: 0) {
                    HStack {
                        Text(brand).font(.system(size: 13, weight: .bold)).foregroundStyle(.primary.opacity(0.55))
                            .textCase(.uppercase)
                        Spacer()
                        Text(grams(items.reduce(0) { $0 + $1.quantity_g }))
                            .font(.system(size: 12, weight: .semibold)).foregroundStyle(.primary.opacity(0.4))
                    }
                    .padding(.horizontal, 14).padding(.top, 12).padding(.bottom, 8)
                    ForEach(Array(items.enumerated()), id: \.element.id) { idx, s in
                        HStack {
                            Text(s.flavor).font(.system(size: 15)).foregroundStyle(.primary)
                            Spacer()
                            Text(grams(s.quantity_g))
                                .font(.system(size: 15, weight: .semibold))
                                .foregroundStyle(m.stockColor(s))
                        }
                        .padding(.vertical, 10).padding(.horizontal, 14)
                        if idx < items.count - 1 { Divider().overlay(Color.primary.opacity(0.06)).padding(.leading, 14) }
                    }
                }
                .padding(.bottom, 6)
                .background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 16))
                .transition(.opacity.combined(with: .scale(scale: 0.97, anchor: .top)))
            }
        }
        }
    }
}

// MARK: Движения

private struct MovementsTab: View {
    @Bindable var m: StashModel
    @Binding var showAdd: Bool
    var onEdit: ([Movement]) -> Void = { _ in }
    var onDelete: ([Movement]) -> Void = { _ in }

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

        if m.warehouseLoading {
            RowListSkeleton(rows: 5)
        } else if m.movementBatches.isEmpty {
            Text(t("st.noMovements")).font(.system(size: 14)).foregroundStyle(.primary.opacity(0.4)).padding(.top, 30)
        } else {
            ForEach(m.movementBatches, id: \.0) { batchId, items in
                MovementBatchRow(items: items,
                                 onEdit: { onEdit(items) },
                                 onDelete: { onDelete(items) })
            }
        }
    }
}

private struct MovementBatchRow: View {
    let items: [Movement]
    var onEdit: () -> Void = {}
    var onDelete: () -> Void = {}
    @State private var open = false
    private var total: Double { items.reduce(0) { $0 + $1.quantity_g } }
    private var isIn: Bool { items.first?.type == "in" }

    private func posLabel(_ mv: Movement) -> String {
        // Списание «с заведения» — без бренда/вкуса.
        (mv.brand.isEmpty && mv.flavor.isEmpty) ? t("st.venueWriteoffLabel") : "\(mv.brand) · \(mv.flavor)"
    }

    var body: some View {
        VStack(spacing: 0) {
            Button { withAnimation(.easeInOut(duration: 0.18)) { open.toggle() } } label: {
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(movDate(items.first?.created_at)).font(.system(size: 14, weight: .semibold)).foregroundStyle(.primary)
                        Text(t("st.positions", ["n": "\(items.count)"])).font(.system(size: 11)).foregroundStyle(.primary.opacity(0.4))
                    }
                    Spacer()
                    Text((isIn ? "+" : "−") + grams(total))
                        .font(.system(size: 15, weight: .bold))
                        .foregroundStyle(isIn ? BrandKit.analytics : BrandKit.stash)
                    Image(systemName: open ? "chevron.up" : "chevron.down").font(.system(size: 11)).foregroundStyle(.primary.opacity(0.4))
                }
                .padding(14)
            }
            .buttonStyle(.plain)
            if open {
                VStack(spacing: 0) {
                    ForEach(Array(items.enumerated()), id: \.element.id) { idx, mv in
                        HStack {
                            Text(posLabel(mv)).font(.system(size: 13)).foregroundStyle(.primary.opacity(0.85))
                            Spacer()
                            Text((isIn ? "+" : "−") + grams(mv.quantity_g)).font(.system(size: 13, weight: .semibold))
                                .foregroundStyle(isIn ? BrandKit.analytics : BrandKit.stash)
                        }
                        .padding(.vertical, 8).padding(.horizontal, 14)
                        if idx < items.count - 1 { Divider().overlay(Color.primary.opacity(0.06)).padding(.leading, 14) }
                    }
                }
                .padding(.bottom, 6)
            }
        }
        .background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 14))
        .contextMenu {
            Button { onEdit() } label: { Label(t("edit"), systemImage: "pencil") }
            Button(role: .destructive) { onDelete() } label: { Label(t("delete"), systemImage: "trash") }
        }
    }
}

private func movDate(_ iso: String?) -> String {
    guard let d = parseISO(iso) else { return "—" }
    let f = DateFormatter(); f.locale = appLocale(); f.dateFormat = "d MMM, HH:mm"
    return f.string(from: d)
}

/// Поле ввода с подсказками (бренд/вкус). Аналог AutoInput из app/tobacco/page.tsx.
private struct AutoField: View {
    let placeholder: String
    @Binding var text: String
    var suggestions: [String]
    var disabled = false
    var onPick: (() -> Void)? = nil
    @FocusState private var focused: Bool

    private var filtered: [String] {
        let q = text.trimmingCharacters(in: .whitespaces).lowercased()
        return Array(Set(suggestions))
            .filter { q.isEmpty || $0.lowercased().contains(q) }
            .filter { $0.lowercased() != q }
            .sorted { $0.lowercased() < $1.lowercased() }
            .prefix(6)
            .map { $0 }
    }

    var body: some View {
        VStack(spacing: 0) {
            TextField(placeholder, text: $text)
                .textFieldStyle(.plain).focused($focused).disabled(disabled)
                .padding(10).background(Color.primary.opacity(0.07), in: RoundedRectangle(cornerRadius: 10))
                .foregroundStyle(disabled ? .white.opacity(0.3) : .white)
            if focused && !filtered.isEmpty {
                VStack(spacing: 0) {
                    ForEach(Array(filtered.enumerated()), id: \.element) { idx, s in
                        Button { text = s; onPick?(); focused = false } label: {
                            HStack {
                                Text(s).font(.system(size: 15)).foregroundStyle(.primary)
                                Spacer()
                            }
                            .padding(.vertical, 10).padding(.horizontal, 12)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        if idx < filtered.count - 1 { Divider().overlay(Color.primary.opacity(0.08)) }
                    }
                }
                .background(Color.primary.opacity(0.1), in: RoundedRectangle(cornerRadius: 10))
                .padding(.top, 4)
            }
        }
    }
}

/// Одна строка вкус+граммы внутри карточки бренда (см. MovGroup).
private struct MovLine: Identifiable {
    let id = UUID()
    var flavor = ""
    var grams = ""
}

/// Карточка ручного ввода: один бренд + несколько строк вкус/граммы под ним. Раньше
/// каждая строка была независимой (бренд+вкус+граммы), и при поставке из 6 вкусов одного
/// бренда бренд приходилось перепечатывать 6 раз. Группировка убирает повтор: бренд
/// выбирается один раз на карточку, кнопка «+вкус» добавляет строку под тем же брендом,
/// «+бренд» ниже списка открывает новую карточку под другой бренд.
private struct MovGroup: Identifiable {
    let id = UUID()
    var brand = ""
    var lines: [MovLine] = [MovLine()]
}

private struct AddMovementSheet: View {
    @Bindable var m: StashModel
    var editBatch: [Movement]? = nil               // непусто → режим редактирования батча
    @Environment(\.dismiss) private var dismiss
    @State private var groups: [MovGroup] = [MovGroup()]
    @State private var reason = ""
    @State private var fromStock = false
    @State private var picks: [String: String] = [:]   // stock.id → граммы для выбора со склада
    @State private var writeoffVenue = false           // списание: false=со склада, true=с заведения
    @State private var venueGrams = ""                 // вес списания с заведения
    @State private var primed = false
    @State private var confirmDiscard = false
    // Тип операции ВНУТРИ листа — отдельно от m.movMode (это фильтр вкладки «Движения»).
    // Раньше лист писал прямо в m.movMode: открыл правку выдачи, будучи на вкладке «Приход» —
    // после закрытия лента молча переключалась на «Выдачу», а смена сегмента посреди правки
    // меняла то, куда уйдёт сохраняемый батч.
    @State private var formMode: String

    init(m: StashModel, editBatch: [Movement]? = nil) {
        self.m = m
        self.editBatch = editBatch
        _formMode = State(initialValue: editBatch?.first?.type ?? m.movMode)
    }

    private var isEditing: Bool { editBatch != nil }
    // Есть введённые данные → свайп вниз не должен молча их стирать (см. случай, когда
    // заполнили много строк, пролистнули вверх перепроверить — и свайп закрыл лист).
    private var isDirty: Bool {
        !reason.trimmingCharacters(in: .whitespaces).isEmpty
            || !venueGrams.isEmpty
            // Было `!picks.values.contains{...}` — инвертировано: считало «грязным» пустой
            // пикер и «чистым» после реального выбора со склада. Свайп вниз на нетронутом
            // листе спрашивал «отменить изменения?» без единой введённой цифры.
            || picks.values.contains { !$0.isEmpty }
            || groups.contains { g in !g.brand.isEmpty || g.lines.contains { !$0.flavor.isEmpty || !$0.grams.isEmpty } }
    }
    private func requestClose() {
        if isDirty { confirmDiscard = true } else { dismiss() }
    }
    private var totalLabel: String {
        switch formMode {
        case "in":  return t("st.totalIn")
        case "out": return t("st.totalOut")
        default:    return t("st.totalWriteoff")
        }
    }

    // Источник для «Из склада», сгруппирован по брендам: для прихода — все известные,
    // для выдачи/списания — только то, что есть в наличии (брать можно лишь имеющееся).
    private var pickGroups: [(String, [StockItem])] {
        let base = formMode == "in" ? m.stock : m.inStock
        var g: [String: [StockItem]] = [:]
        for s in base where !s.brand.isEmpty { g[s.brand, default: []].append(s) }
        return g.map { ($0.key, $0.value.sorted { $0.flavor < $1.flavor }) }
                .sorted { $0.0.lowercased() < $1.0.lowercased() }
    }
    private var takeTotal: Double {
        picks.values.reduce(0) { $0 + (Double($1.filter(\.isNumber)) ?? 0) }
    }
    private func pickedRows() -> [StashModel.MovRow] {
        m.stock.compactMap { s in
            let v = (picks[s.id] ?? "").filter(\.isNumber)
            guard (Double(v) ?? 0) > 0 else { return nil }
            return StashModel.MovRow(brand: s.brand, flavor: s.flavor, grams: v)
        }
    }
    private func pickBinding(_ id: String) -> Binding<String> {
        Binding(get: { picks[id] ?? "" }, set: { picks[id] = $0.filter(\.isNumber) })
    }

    // Списание с заведения: только вес (общий объём зала), без бренда/вкуса.
    @ViewBuilder private var venueWriteoffField: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(t("st.venueWriteoffHint")).font(.system(size: 12)).foregroundStyle(.primary.opacity(0.5))
            TextField(t("st.grams"), text: $venueGrams).keyboardType(.numberPad)
                .padding(10).background(Color.primary.opacity(0.07), in: RoundedRectangle(cornerRadius: 10)).foregroundStyle(.primary)
            HStack {
                Text(t("st.venueAvailable")).font(.system(size: 12)).foregroundStyle(.primary.opacity(0.5))
                Spacer()
                Text(grams(max(0, m.venueBase))).font(.system(size: 13, weight: .semibold)).foregroundStyle(.primary.opacity(0.7))
            }
        }
        .padding(12).background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 14))
    }

    // Строки одной карточки в flat [MovRow] — так их понимает saveMovement/prepareRows
    // (пустые вкус/граммы там же и отфильтруются).
    private func flattenGroups() -> [StashModel.MovRow] {
        groups.flatMap { g in g.lines.map { StashModel.MovRow(brand: g.brand, flavor: $0.flavor, grams: $0.grams) } }
    }
    /// Группирует плоский список строк по бренду (первое появление задаёт порядок карточек).
    /// Используется при входе в правку существующего батча и при AI-префилле.
    private func groupByBrand(_ rows: [StashModel.MovRow]) -> [MovGroup] {
        var order: [String] = []
        var byBrand: [String: [MovLine]] = [:]
        for r in rows {
            if byBrand[r.brand] == nil { order.append(r.brand) }
            byBrand[r.brand, default: []].append(MovLine(flavor: r.flavor, grams: r.grams))
        }
        let result = order.map { MovGroup(brand: $0, lines: byBrand[$0] ?? [MovLine()]) }
        return result.isEmpty ? [MovGroup()] : result
    }

    private func commit() async {
        if formMode == "writeoff" && writeoffVenue {
            let ok = isEditing
                ? await m.replaceVenueWriteoff(editBatch!, grams: venueGrams, reason: reason)
                : await m.saveVenueWriteoff(grams: venueGrams, reason: reason)
            if ok { dismiss() }
        } else {
            let toSave = fromStock ? pickedRows() : flattenGroups()
            let ok = isEditing
                ? await m.replaceMovementBatch(editBatch!, rows: toSave, reason: reason, mode: formMode)
                : await m.saveMovement(toSave, reason: reason, mode: formMode)
            if ok { dismiss() }
        }
    }

    private func primeForEdit(_ batch: [Movement]) {
        reason = batch.first?.reason ?? ""
        if batch.allSatisfy({ $0.brand.isEmpty && $0.flavor.isEmpty }) {
            writeoffVenue = true
            venueGrams = String(Int(batch.reduce(0) { $0 + $1.quantity_g }))
        } else {
            fromStock = false
            groups = groupByBrand(batch.map { StashModel.MovRow(brand: $0.brand, flavor: $0.flavor, grams: String(Int($0.quantity_g))) })
        }
    }

    // Тост модели рисуется в StashBody, под этим листом — ошибки saveMovement/
    // saveVenueWriteoff (нет на складе, не хватает причины и т.д.) были не видны
    // пользователю. Дублируем его здесь поверх контента листа.
    @ViewBuilder private var toastOverlay: some View {
        if let toast = m.toast {
            Text(toast).font(.system(size: 14, weight: .semibold)).foregroundStyle(.primary)
                .padding(.horizontal, 18).padding(.vertical, 12)
                .background(.ultraThinMaterial, in: Capsule())
                .padding(.bottom, 24)
                .transition(.move(edge: .bottom).combined(with: .opacity))
        }
    }

    var body: some View {
        NavigationStack {
            ZStack(alignment: .bottom) {
                Color.miseBg.ignoresSafeArea()
                ScrollView {
                    VStack(spacing: 12) {
                        Picker("", selection: $formMode) {
                            Text(t("st.in")).tag("in"); Text(t("st.out")).tag("out"); Text(t("st.writeoff")).tag("writeoff")
                        }.pickerStyle(.segmented)

                        // Списание: со склада (бренд/вкус) или с заведения (только вес общего объёма зала).
                        if formMode == "writeoff" {
                            Picker("", selection: $writeoffVenue) {
                                Text(t("st.fromWarehouse")).tag(false); Text(t("st.fromVenue")).tag(true)
                            }.pickerStyle(.segmented)
                        }

                        if writeoffVenue && formMode == "writeoff" {
                            venueWriteoffField
                        } else {
                            Picker("", selection: $fromStock) {
                                Text(t("st.manual")).tag(false); Text(t("st.fromStock")).tag(true)
                            }.pickerStyle(.segmented)

                            if fromStock { stockPicker } else { manualRows }
                        }

                        if formMode == "writeoff" {
                            TextField(t("st.writeoffReasonField"), text: $reason).textFieldStyle(.plain)
                                .padding(10).background(Color.primary.opacity(0.07), in: RoundedRectangle(cornerRadius: 10)).foregroundStyle(.primary)
                        }
                    }
                    .padding(16)
                    .contentShape(Rectangle())
                    .onTapGesture { hideKeyboard() }
                }
                .scrollDismissesKeyboard(.immediately)
                toastOverlay
            }
            .animation(.easeInOut(duration: 0.2), value: m.toast)
            .navigationTitle(isEditing ? t("st.editMovement") : t("st.movement")).navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(t("cancel")) { requestClose() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(t("save")) { Task { await commit() } }.disabled(m.saving)
                }
                ToolbarItemGroup(placement: .keyboard) { Spacer(); Button(t("done")) { hideKeyboard() } }
            }
            .toolbarBackground(Color.miseBg, for: .navigationBar)
            .interactiveDismissDisabled(isDirty)
            .confirmationDialog(t("discard.title"), isPresented: $confirmDiscard, titleVisibility: .visible) {
                Button(t("discard.confirm"), role: .destructive) { dismiss() }
                Button(t("cancel"), role: .cancel) {}
            } message: { Text(t("discard.msg")) }
            .onChange(of: formMode) { _, mode in if mode != "writeoff" { writeoffVenue = false } }
            .onAppear {
                guard !primed else { return }
                primed = true
                if let batch = editBatch {
                    primeForEdit(batch)
                } else if let pre = m.aiMovRows, !pre.isEmpty {
                    groups = groupByBrand(pre); fromStock = false; m.aiMovRows = nil
                } else {
                    fromStock = formMode != "in"   // выдача/списание — со склада по умолчанию
                }
            }
        }
    }

    // Ручной ввод: карточка на бренд, внутри — строки вкус+граммы. Бренд печатается один
    // раз на карточку, а не на каждую строку — при поставке из N вкусов одного бренда
    // не нужно перепечатывать название N раз.
    @ViewBuilder private var manualRows: some View {
        let outOnly = formMode != "in"
        ForEach($groups) { $group in
            VStack(spacing: 8) {
                HStack {
                    AutoField(placeholder: t("st.brand"), text: $group.brand,
                              suggestions: m.brandSuggestions(outOnly),
                              // Смена бренда — сбрасываем вкусы строк: подсказки вкуса зависят
                              // от бренда, старый вкус мог не существовать у нового.
                              onPick: { for i in group.lines.indices { group.lines[i].flavor = "" } })
                    if groups.count > 1 {
                        Button { groups.removeAll { $0.id == group.id } } label: {
                            Image(systemName: "xmark.circle.fill").font(.system(size: 16)).foregroundStyle(.primary.opacity(0.3))
                        }.buttonStyle(.plain)
                    }
                }
                ForEach($group.lines) { $line in
                    let avail = m.stockOf(group.brand, line.flavor)
                    VStack(spacing: 6) {
                        HStack(spacing: 8) {
                            AutoField(placeholder: t("st.flavor"), text: $line.flavor,
                                      suggestions: m.flavorsForBrand(group.brand, outOnly: outOnly),
                                      disabled: outOnly && group.brand.trimmingCharacters(in: .whitespaces).isEmpty)
                            TextField(t("st.grams"), text: $line.grams).keyboardType(.numberPad)
                                .multilineTextAlignment(.trailing)
                                .padding(10).background(Color.primary.opacity(0.07), in: RoundedRectangle(cornerRadius: 10))
                                .foregroundStyle(.primary)
                                .frame(width: 88)
                            if group.lines.count > 1 {
                                Button { group.lines.removeAll { $0.id == line.id } } label: {
                                    Image(systemName: "xmark.circle.fill").font(.system(size: 15)).foregroundStyle(.primary.opacity(0.3))
                                }.buttonStyle(.plain)
                            }
                        }
                        if let a = avail, !line.flavor.isEmpty {
                            HStack {
                                Text("\(t("st.available")): \(grams(a.quantity_g))")
                                    .font(.system(size: 12)).foregroundStyle(.primary.opacity(0.5))
                                Spacer()
                            }
                        }
                    }
                }
                Button { group.lines.append(MovLine()) } label: {
                    Label(t("st.addFlavor"), systemImage: "plus").font(.system(size: 13, weight: .medium)).foregroundStyle(BrandKit.stash)
                }
            }
            .padding(12).background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 14))
        }
        Button { groups.append(MovGroup()) } label: {
            Label(t("st.addBrand"), systemImage: "plus").font(.system(size: 14, weight: .medium)).foregroundStyle(BrandKit.stash)
        }
    }

    // Выбор со склада: список наличия по брендам + поле «сколько берёшь» + бегущий итог.
    @ViewBuilder private var stockPicker: some View {
        if pickGroups.isEmpty {
            Text(t("st.noStockPick")).font(.system(size: 14)).foregroundStyle(.primary.opacity(0.45))
                .frame(maxWidth: .infinity).padding(.vertical, 24)
        } else {
            ForEach(pickGroups, id: \.0) { brand, items in
                VStack(alignment: .leading, spacing: 8) {
                    Text(brand).font(.system(size: 13, weight: .bold)).foregroundStyle(.primary.opacity(0.6))
                    ForEach(items) { s in
                        HStack(spacing: 10) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(s.flavor).font(.system(size: 14)).foregroundStyle(.primary)
                                Text("\(t("st.available")): \(grams(s.quantity_g))")
                                    .font(.system(size: 11)).foregroundStyle(.primary.opacity(0.4))
                            }
                            Spacer()
                            TextField("0", text: pickBinding(s.id))
                                .keyboardType(.numberPad).multilineTextAlignment(.trailing)
                                .font(.system(size: 15, weight: .semibold)).foregroundStyle(.primary)
                                .frame(width: 72)
                                .padding(.horizontal, 8).padding(.vertical, 6)
                                .background(Color.primary.opacity(0.07), in: RoundedRectangle(cornerRadius: 8))
                        }
                    }
                }
                .padding(12).background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 14))
            }
            HStack {
                Text(totalLabel).font(.system(size: 13, weight: .semibold)).foregroundStyle(.primary.opacity(0.6))
                Spacer()
                Text(grams(takeTotal)).font(.system(size: 15, weight: .bold)).foregroundStyle(BrandKit.stash)
            }
            .padding(.horizontal, 4).padding(.top, 2)
            Button { fromStock = false } label: {
                Label(t("st.addManual"), systemImage: "plus").font(.system(size: 14, weight: .medium)).foregroundStyle(BrandKit.stash)
            }
        }
    }
}

// MARK: Создание инвентаризации

private struct AddInventorySheet: View {
    @Bindable var m: StashModel
    @Environment(\.dismiss) private var dismiss
    @State private var actuals: [String: String] = [:]
    @State private var confirmDiscard = false

    private var items: [StockItem] {
        // Только позиции с остатком — нулевые нечего пересчитывать (так и на вебе).
        m.stock.filter { $0.quantity_g > 0 }.sorted { "\($0.brand)\($0.flavor)" < "\($1.brand)\($1.flavor)" }
    }
    private var isDirty: Bool { actuals.values.contains { !$0.isEmpty } }
    private func requestClose() {
        if isDirty { confirmDiscard = true } else { dismiss() }
    }

    @ViewBuilder private var toastOverlay: some View {
        if let toast = m.toast {
            Text(toast).font(.system(size: 14, weight: .semibold)).foregroundStyle(.primary)
                .padding(.horizontal, 18).padding(.vertical, 12)
                .background(.ultraThinMaterial, in: Capsule())
                .padding(.bottom, 24)
                .transition(.move(edge: .bottom).combined(with: .opacity))
        }
    }

    var body: some View {
        NavigationStack {
            ZStack(alignment: .bottom) {
                Color.miseBg.ignoresSafeArea()
                ScrollView {
                    VStack(spacing: 10) {
                        ForEach(items) { s in
                            HStack(spacing: 12) {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text("\(s.brand) · \(s.flavor)").font(.system(size: 14)).foregroundStyle(.primary)
                                    Text(t("st.invExpected") + ": " + grams(s.quantity_g))
                                        .font(.system(size: 11)).foregroundStyle(.primary.opacity(0.4))
                                }
                                Spacer()
                                TextField(grams(s.quantity_g), text: Binding(
                                    get: { actuals[s.id] ?? "" },
                                    set: { actuals[s.id] = $0 }
                                ))
                                .keyboardType(.numberPad)
                                .multilineTextAlignment(.trailing)
                                .font(.system(size: 15, weight: .semibold)).foregroundStyle(.primary)
                                .frame(width: 76)
                                .padding(.horizontal, 8).padding(.vertical, 6)
                                .background(Color.primary.opacity(0.07), in: RoundedRectangle(cornerRadius: 8))
                            }
                            .padding(.horizontal, 14).padding(.vertical, 10)
                            .background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 12))
                        }
                    }
                    .padding(16)
                    .contentShape(Rectangle())
                    .onTapGesture { hideKeyboard() }
                }
                .scrollDismissesKeyboard(.immediately)
                toastOverlay
            }
            .animation(.easeInOut(duration: 0.2), value: m.toast)
            .navigationTitle(t("st.doInventory")).navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(t("cancel")) { requestClose() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(t("save")) {
                        Task {
                            let rows = items.map { s in
                                StashModel.InvRow(
                                    id: s.id, brand: s.brand, flavor: s.flavor,
                                    expected: s.quantity_g,
                                    actual: Double(actuals[s.id] ?? "") ?? s.quantity_g
                                )
                            }
                            if await m.saveInventory(rows) { dismiss() }
                        }
                    }.disabled(m.saving)
                }
                ToolbarItemGroup(placement: .keyboard) { Spacer(); Button(t("done")) { hideKeyboard() } }
            }
            .toolbarBackground(Color.miseBg, for: .navigationBar)
            .interactiveDismissDisabled(isDirty)
            .confirmationDialog(t("discard.title"), isPresented: $confirmDiscard, titleVisibility: .visible) {
                Button(t("discard.confirm"), role: .destructive) { dismiss() }
                Button(t("cancel"), role: .cancel) {}
            } message: { Text(t("discard.msg")) }
        }
    }
}

// MARK: Инвентарь

private struct InventoryTab: View {
    @Bindable var m: StashModel
    @Binding var showAdd: Bool
    var body: some View {
        Button { showAdd = true } label: {
            Label(t("st.doInventory"), systemImage: "checklist")
                .font(.system(size: 15, weight: .semibold)).foregroundStyle(BrandKit.stash)
                .frame(maxWidth: .infinity).padding(.vertical, 13)
                .background(BrandKit.stash.opacity(0.14), in: RoundedRectangle(cornerRadius: 12))
        }
        if m.warehouseLoading {
            RowListSkeleton(rows: 5)
        } else if m.inventories.isEmpty {
            Text(t("st.noInventories")).font(.system(size: 14)).foregroundStyle(.primary.opacity(0.4)).padding(.top, 30)
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
                        Text(shortDateTime(inv.created_at)).font(.system(size: 14, weight: .semibold)).foregroundStyle(.primary)
                        Text(t("st.discrepancies", ["n": "\((inv.items ?? []).count)"])).font(.system(size: 11)).foregroundStyle(.primary.opacity(0.4))
                    }
                    Spacer()
                    Text((net > 0 ? "+" : "") + grams(net))
                        .font(.system(size: 15, weight: .bold))
                        .foregroundStyle(net < 0 ? BrandKit.menu : BrandKit.analytics)
                    Image(systemName: open ? "chevron.up" : "chevron.down").font(.system(size: 11)).foregroundStyle(.primary.opacity(0.4))
                }
                .padding(14)
            }
            .buttonStyle(.plain)
            if open {
                VStack(spacing: 0) {
                    ForEach(Array((inv.items ?? []).enumerated()), id: \.offset) { idx, it in
                        let d = it.diff_g ?? 0
                        HStack {
                            Text("\(it.brand ?? "") · \(it.flavor ?? "")").font(.system(size: 13)).foregroundStyle(.primary.opacity(0.85))
                            Spacer()
                            Text((d > 0 ? "+" : "") + grams(d)).font(.system(size: 13, weight: .semibold))
                                .foregroundStyle(d < 0 ? BrandKit.menu : BrandKit.analytics)
                        }
                        .padding(.vertical, 8).padding(.horizontal, 14)
                        if idx < (inv.items ?? []).count - 1 { Divider().overlay(Color.primary.opacity(0.06)).padding(.leading, 14) }
                    }
                }
                .padding(.bottom, 6)
            }
        }
        .background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 14))
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

// MARK: - KPI: цели по кальянам (геймификация). Показывается сверху вкладки «Смена».

private struct GoalCard: View {
    let g: HookahGoal
    let current: Int
    let typeNames: String
    let editable: Bool

    private var target: Int { max(g.target_qty ?? 0, 0) }
    private var ratio: Double { target == 0 ? 0 : min(Double(current) / Double(target), 1) }
    private var reached: Bool { target > 0 && current >= target }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                VStack(alignment: .leading, spacing: 3) {
                    if let tt = g.title, !tt.isEmpty {
                        Text(tt).font(.system(size: 16, weight: .bold)).foregroundStyle(.primary)
                    }
                    Text(typeNames).font(.system(size: 13)).foregroundStyle(.primary.opacity(0.55)).lineLimit(2)
                }
                Spacer()
                if editable {
                    Image(systemName: "chevron.right").font(.system(size: 12, weight: .bold)).foregroundStyle(.primary.opacity(0.25))
                }
            }

            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Text("\(current)").font(.system(size: 28, weight: .heavy)).foregroundStyle(reached ? BrandKit.analytics : .primary)
                Text("/ \(target)").font(.system(size: 16, weight: .semibold)).foregroundStyle(.primary.opacity(0.4))
                Spacer()
                Text("\(Int(ratio * 100))%").font(.system(size: 15, weight: .bold)).foregroundStyle(reached ? BrandKit.analytics : BrandKit.stash)
            }

            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(Color.primary.opacity(0.1))
                    Capsule().fill(reached ? BrandKit.analytics : BrandKit.stash)
                        .frame(width: max(geo.size.width * ratio, ratio > 0 ? 8 : 0))
                }
            }
            .frame(height: 10)

            Text(reached ? t("kpi.reached") : t("kpi.left", ["n": String(max(target - current, 0))]))
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(reached ? BrandKit.analytics : .primary.opacity(0.6))
        }
        .padding(16)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    }
}

private struct GoalEditor: View {
    let goal: HookahGoal?
    let types: [HookahType]
    let onSave: (String?, [String], Int) -> Void
    let onDelete: (HookahGoal) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var target = ""
    @State private var selected: Set<String> = []
    @State private var confirmDelete = false

    private var isNew: Bool { goal == nil }
    private var valid: Bool { !selected.isEmpty && (Int(target) ?? 0) > 0 }

    var body: some View {
        NavigationStack {
            ZStack {
                Color.miseBg.ignoresSafeArea()
                Form {
                    Section(t("kpi.fTitle")) {
                        TextField(t("kpi.titlePh"), text: $title)
                    }
                    Section(t("kpi.types")) {
                        if types.isEmpty {
                            Text(t("kpi.noTypes")).foregroundStyle(.primary.opacity(0.5))
                        }
                        ForEach(types) { tp in
                            Button {
                                if selected.contains(tp.id) { selected.remove(tp.id) } else { selected.insert(tp.id) }
                            } label: {
                                HStack {
                                    Text(tp.name ?? "—").foregroundStyle(.primary)
                                    Spacer()
                                    if selected.contains(tp.id) {
                                        Image(systemName: "checkmark").foregroundStyle(BrandKit.stash)
                                    }
                                }
                            }
                        }
                    }
                    Section(t("kpi.target")) {
                        TextField("0", text: $target).keyboardType(.numberPad)
                    }
                    if !isNew, let g = goal {
                        Section {
                            Button(role: .destructive) { confirmDelete = true } label: {
                                Label(t("kpi.delete"), systemImage: "trash")
                            }
                            .confirmationDialog(t("kpi.delete"), isPresented: $confirmDelete, titleVisibility: .visible) {
                                Button(t("kpi.delete"), role: .destructive) { onDelete(g); dismiss() }
                                Button(t("cancel"), role: .cancel) {}
                            }
                        }
                    }
                }
                .scrollContentBackground(.hidden)
                .tint(BrandKit.stash)
            }
            .navigationTitle(isNew ? t("kpi.new") : t("kpi.edit")).navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(Color.miseBg, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(t("cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(t("kpi.save")) {
                        let tt = title.trimmingCharacters(in: .whitespacesAndNewlines)
                        onSave(tt.isEmpty ? nil : tt, Array(selected), Int(target) ?? 0)
                        dismiss()
                    }.bold().disabled(!valid)
                }
            }
            .onAppear(perform: prime)
        }
    }

    private func prime() {
        guard let g = goal else { return }
        title = g.title ?? ""
        target = g.target_qty.map(String.init) ?? ""
        selected = Set(g.type_ids ?? [])
    }
}
