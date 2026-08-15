import Foundation

// Доменные модели поверх таблиц Supabase (через /api/db).
// Числовые колонки приходят JSON-числами; держим опциональными и читаем через ?? 0.

nonisolated struct Employee: Codable, Identifiable, Sendable {
    let id: String
    let name: String
    let deduct_per_absence: Double?
    var salary: Double?
    var card_amount: Double?
}

nonisolated struct Category: Codable, Identifiable, Sendable {
    let id: String
    let name: String
}

nonisolated struct Shift: Codable, Identifiable, Sendable {
    let id: String
    let date: String
    let status: String?
    var income: Double?
    var income_card: Double?
    var total_expense: Double?
    var inkassation: Double?
    var closing_balance: Double?
    var opening_balance: Double?
}

nonisolated struct ShiftExpense: Codable, Identifiable, Sendable {
    let id: String
    let employee_id: String?
    let category_id: String?
    let category_name: String?
    let amount: Double?
    let note: String?
    let shift_id: String?
    var is_paid: Bool? = true
    var paid_at: String? = nil
    var paid_shift_id: String? = nil
}

nonisolated struct CardAmount: Codable, Sendable {
    let id: String?
    let employee_id: String?
    let card_amount: Double?
}

nonisolated struct Absence: Codable, Sendable {
    let employee_id: String?
    let source: String?
    let date: String?
}

nonisolated struct AnalyticsSettings: Codable, Sendable {
    let include_card_in_analytics: Bool?
    let hookah_price: Double?
    let hookah_portion_g: Double?
    let salary_payout_day: Int?
}

nonisolated struct Inkassation: Codable, Sendable {
    let shift_id: String?
    let amount: Double?
    let expense: Double?
    let reason: String?
    let total: Double?
    let salary: Double?
    let salary_note: String?
}

nonisolated struct ClosingOnly: Codable, Sendable { let closing_balance: Double? }
nonisolated struct InkOnly: Codable, Sendable { let inkassation: Double? }
nonisolated struct InkTotalOnly: Codable, Sendable { let total: Double? }

// Банк (Open Banking, Enable Banking) — вкладка «Банк» в Analytics.
nonisolated struct BankConnection: Codable, Identifiable, Sendable {
    let id: String
    let institution_name: String?
    let institution_id: String?   // страна ASPSP (не сам институт — см. lib/enableBanking.ts)
    let account_id: String?
    let status: String?
    let balance: Double?
    let balance_currency: String?
    let balance_synced_at: String?
    let consent_expires_at: String?
}
nonisolated struct BankTransaction: Codable, Identifiable, Sendable {
    let id: String
    let booking_date: String?
    let amount: Double?
    let currency: String?
    let description: String?
    let counterparty: String?
}

// MARK: - Stash (склад табака + кальянная смена)

nonisolated struct HookahType: Codable, Identifiable, Sendable {
    let id: String
    let name: String?
    let price: Double?
    let portion_g: Double?
}

nonisolated struct HookahSale: Codable, Sendable {
    let hookah_type_id: String?
    let quantity: Double?
    let portion_g: Double?
    let price: Double?
    let is_free: Bool?
    let date: String?
    let brand: String?
    let flavor: String?
}

nonisolated struct StockItem: Codable, Identifiable, Sendable {
    let id: String
    let brand: String
    let flavor: String
    let quantity_g: Double
    let min_quantity_g: Double?
}

nonisolated struct Movement: Codable, Identifiable, Sendable {
    let id: String
    let brand: String
    let flavor: String
    let quantity_g: Double
    let type: String
    let batch_id: String?
    let reason: String?
    let created_at: String?
}

nonisolated struct InvItem: Codable, Sendable {
    let brand: String?
    let flavor: String?
    let expected_g: Double?
    let actual_g: Double?
    let diff_g: Double?
}

nonisolated struct Inventory: Codable, Identifiable, Sendable {
    let id: String
    let created_at: String?
    let items: [InvItem]?
}

// MARK: - People (команда)

nonisolated struct StaffTask: Codable, Identifiable, Sendable {
    let id: String
    let title: String
    let description: String?
    let assigned_to: String?
    let created_by: String?
    let priority: String?
    let due_date: String?
    var status: String?
    let source_completion_id: String?
    let source_item_label: String?
    let photo_url: String?
}

nonisolated struct StaffDir: Codable, Identifiable, Sendable {
    let id: String
    let name: String
    let role: String?
}

nonisolated struct Schedule: Codable, Identifiable, Sendable {
    let id: String
    let staff_id: String?
    let date: String
    let shift_start: String?
    let shift_end: String?
    let note: String?
}

nonisolated struct MenuItem: Codable, Identifiable, Sendable {
    let id: String
    let name: String
    let price: Double?
    var is_available: Bool?
    let category_id: String?
}

nonisolated struct OrderItem: Codable, Sendable {
    let name: String?
    let qty: Double?
    let price: Double?
    let opts: [String]?
    let call: String?
}

nonisolated struct MenuOrder: Codable, Identifiable, Sendable {
    let id: String
    // В БД menu_orders.table_number — text (веб шлёт строку из ?table=).
    // Int? не коэрсит "5" → Lossy-декодер обнулял ВСЮ строку заказа → заказ пропадал из iOS.
    let table_number: String?
    var status: String?
    let total: Double?
    let created_at: String?
    let items: [OrderItem]?
}

/// Пункт чек-листа/аудита. Декодируется и из старого формата (голая строка = label),
/// и из нового `{id,label,photo_required,weight}` — обратная совместимость на чтение,
/// миграция данных не требуется (см. docs/migrations/audits-v1-2026-07.sql).
/// weight — вес пункта в скоринге разовых аудитов (Б6, kind="audit"), по умолчанию 1;
/// чек-листы смены весов не задают — считаются как раньше, поштучно.
nonisolated struct ChecklistItem: Codable, Identifiable, Sendable, Hashable {
    var id: String
    var label: String
    var photo_required: Bool
    var weight: Int

    init(id: String = UUID().uuidString, label: String, photo_required: Bool = false, weight: Int = 1) {
        self.id = id; self.label = label; self.photo_required = photo_required; self.weight = weight
    }

    private enum CodingKeys: String, CodingKey { case id, label, photo_required, weight }

    init(from decoder: Decoder) throws {
        if let sv = try? decoder.singleValueContainer(), let str = try? sv.decode(String.self) {
            id = str; label = str; photo_required = false; weight = 1
            return
        }
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeIfPresent(String.self, forKey: .id) ?? UUID().uuidString
        label = try c.decode(String.self, forKey: .label)
        photo_required = try c.decodeIfPresent(Bool.self, forKey: .photo_required) ?? false
        let w = try c.decodeIfPresent(Int.self, forKey: .weight) ?? 1
        weight = w > 0 ? w : 1
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(label, forKey: .label)
        try c.encode(photo_required, forKey: .photo_required)
        try c.encode(weight, forKey: .weight)
    }

    /// Плоский словарь для записи через DB.update([String: Any]) — JSONSerialization
    /// не умеет сериализовать Swift-структуры напрямую.
    var asDict: [String: Any] { ["id": id, "label": label, "photo_required": photo_required, "weight": weight] }
}

nonisolated struct ShiftChecklist: Codable, Identifiable, Sendable {
    let id: String
    let type: String?             // open|close для kind="shift"; NULL для kind="audit"
    let role: String?
    let kind: String?             // "shift" (open/close, по умолчанию) | "audit" (разовая проверка)
    let target_scope: String?     // "role" | "staff" | "venue" — для kind="audit"
    let assigned_staff_id: String?
    let title: String?            // отображаемое имя — только для kind="audit"
    let itemDetails: [ChecklistItem]?
    // Расписание (Ф2, только для kind="audit"): "none"|"daily"|"weekly"|"monthly".
    // recurrenceWeekdays — для weekly, 0=вс..6=сб. recurrenceDayOfMonth — для monthly, 1..31.
    // recurrenceLastRun — дедуп-маркер cron'а (когда последний раз завёл прогон), клиенту не нужен для записи.
    let recurrence: String?
    let recurrenceWeekdays: [Int]?
    let recurrenceDayOfMonth: Int?
    let recurrenceLastRun: String?

    /// Плоские подписи — старый вид API для мест кода, которым не нужен photo_required.
    var items: [String]? { itemDetails?.map(\.label) }

    private enum CodingKeys: String, CodingKey {
        case id, type, role, kind, target_scope, assigned_staff_id, title
        case itemDetails = "items"
        case recurrence
        case recurrenceWeekdays = "recurrence_weekdays"
        case recurrenceDayOfMonth = "recurrence_day_of_month"
        case recurrenceLastRun = "recurrence_last_run"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        type = try c.decodeIfPresent(String.self, forKey: .type)
        role = try c.decodeIfPresent(String.self, forKey: .role)
        kind = try c.decodeIfPresent(String.self, forKey: .kind)
        target_scope = try c.decodeIfPresent(String.self, forKey: .target_scope)
        assigned_staff_id = try c.decodeIfPresent(String.self, forKey: .assigned_staff_id)
        title = try c.decodeIfPresent(String.self, forKey: .title)
        itemDetails = try c.decodeIfPresent([ChecklistItem].self, forKey: .itemDetails)
        recurrence = try c.decodeIfPresent(String.self, forKey: .recurrence)
        recurrenceWeekdays = try c.decodeIfPresent([Int].self, forKey: .recurrenceWeekdays)
        recurrenceDayOfMonth = try c.decodeIfPresent(Int.self, forKey: .recurrenceDayOfMonth)
        recurrenceLastRun = try c.decodeIfPresent(String.self, forKey: .recurrenceLastRun)
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encodeIfPresent(type, forKey: .type)
        try c.encodeIfPresent(role, forKey: .role)
        try c.encodeIfPresent(kind, forKey: .kind)
        try c.encodeIfPresent(target_scope, forKey: .target_scope)
        try c.encodeIfPresent(assigned_staff_id, forKey: .assigned_staff_id)
        try c.encodeIfPresent(title, forKey: .title)
        try c.encodeIfPresent(itemDetails, forKey: .itemDetails)
        try c.encodeIfPresent(recurrence, forKey: .recurrence)
        try c.encodeIfPresent(recurrenceWeekdays, forKey: .recurrenceWeekdays)
        try c.encodeIfPresent(recurrenceDayOfMonth, forKey: .recurrenceDayOfMonth)
        try c.encodeIfPresent(recurrenceLastRun, forKey: .recurrenceLastRun)
    }

    /// Удобный конструктор для сидов/превью — принимает голые подписи пунктов.
    init(id: String, type: String? = nil, role: String? = nil, kind: String? = nil,
         target_scope: String? = nil, assigned_staff_id: String? = nil, title: String? = nil, items: [String],
         recurrence: String? = nil, recurrenceWeekdays: [Int]? = nil, recurrenceDayOfMonth: Int? = nil) {
        self.id = id; self.type = type; self.role = role
        self.kind = kind; self.target_scope = target_scope; self.assigned_staff_id = assigned_staff_id
        self.title = title
        self.itemDetails = items.map { ChecklistItem(label: $0) }
        self.recurrence = recurrence
        self.recurrenceWeekdays = recurrenceWeekdays
        self.recurrenceDayOfMonth = recurrenceDayOfMonth
        self.recurrenceLastRun = nil
    }
}

/// Состояние одного пункта в прогоне. Декодируется и из старого `Bool`,
/// и из нового `{done,photo_url}` — та же логика обратной совместимости, что у ChecklistItem.
nonisolated struct ChecklistItemState: Codable, Sendable {
    var done: Bool
    var photo_url: String?
    // Оценка пункта аудита (ревью Б1, пишет веб): "pass" | "fail" | "na". Поля ОБЯЗАНЫ
    // переживать iOS-тоггл (мы перезаписываем items_state целиком) — иначе оценки стираются.
    var result: String?
    var note: String?

    init(done: Bool, photo_url: String? = nil, result: String? = nil, note: String? = nil) {
        self.done = done; self.photo_url = photo_url; self.result = result; self.note = note
    }

    private enum CodingKeys: String, CodingKey { case done, photo_url, result, note }

    init(from decoder: Decoder) throws {
        if let sv = try? decoder.singleValueContainer(), let b = try? sv.decode(Bool.self) {
            done = b; photo_url = nil; result = nil; note = nil
            return
        }
        let c = try decoder.container(keyedBy: CodingKeys.self)
        done = try c.decodeIfPresent(Bool.self, forKey: .done) ?? false
        photo_url = try c.decodeIfPresent(String.self, forKey: .photo_url)
        result = try c.decodeIfPresent(String.self, forKey: .result)
        note = try c.decodeIfPresent(String.self, forKey: .note)
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(done, forKey: .done)
        try c.encodeIfPresent(photo_url, forKey: .photo_url)
        try c.encodeIfPresent(result, forKey: .result)
        try c.encodeIfPresent(note, forKey: .note)
    }

    var asDict: [String: Any] {
        var d: [String: Any] = ["done": done, "photo_url": photo_url ?? NSNull()]
        if let result { d["result"] = result }
        if let note { d["note"] = note }
        return d
    }
}

nonisolated struct ChecklistCompletion: Codable, Identifiable, Sendable {
    let id: String
    let checklist_id: String?
    let date: String?
    var shift_id: String? = nil
    var staff_id: String? = nil
    var items_state: [ChecklistItemState]?
    var status: String? = nil     // "pending" | "in_progress" | "done"
    var requested_by: String? = nil
    var attendance_id: String? = nil
    // Только для kind="walk" (см. WalkTemplate ниже): суммарное активное время (без пауз, сек)
    // и шаги за весь обход (CMPedometer). NULL у kind="audit"/"shift".
    var duration_seconds: Int? = nil
    var steps: Int? = nil
}

// MARK: - «Восьмёрка» (обход-восьмёрка, HoReCa floor-walk) — kind="walk" в shift_checklists
//
// Свободное дерево блок → категория → пункт (юзер сам называет всё), в отличие от плоских
// items у kind="audit"/"shift". Хранится в ТОЙ ЖЕ колонке items (JSONB) — просто другая форма,
// клиент решает как парсить по kind. См. docs/migrations/walk-eight-2026-07.sql.

nonisolated struct WalkItem: Codable, Identifiable, Sendable, Hashable {
    var id: String
    var label: String

    init(id: String = UUID().uuidString, label: String) { self.id = id; self.label = label }
    var asDict: [String: Any] { ["id": id, "label": label] }
}

nonisolated struct WalkCategory: Codable, Identifiable, Sendable, Hashable {
    var id: String
    var label: String
    var items: [WalkItem]

    init(id: String = UUID().uuidString, label: String, items: [WalkItem] = []) {
        self.id = id; self.label = label; self.items = items
    }
    var asDict: [String: Any] { ["id": id, "label": label, "items": items.map(\.asDict)] }
}

nonisolated struct WalkBlock: Codable, Identifiable, Sendable, Hashable {
    var id: String
    var label: String
    var categories: [WalkCategory]

    init(id: String = UUID().uuidString, label: String, categories: [WalkCategory] = []) {
        self.id = id; self.label = label; self.categories = categories
    }
    var asDict: [String: Any] { ["id": id, "label": label, "categories": categories.map(\.asDict)] }
}

/// Шаблон восьмёрки. target_scope переиспользует тот же словарь, что у kind="audit":
/// "staff" — личный шаблон сотрудника (assigned_staff_id = он сам); "role" — назначил
/// владелец/менеджер под должность (role) — сотрудник этой должности только запускает.
nonisolated struct WalkTemplate: Codable, Identifiable, Sendable {
    var id: String
    var title: String?
    var role: String?
    var target_scope: String?        // "staff" | "role"
    var assigned_staff_id: String?   // владелец личного шаблона (target_scope="staff"); nil у "role"
    var walk_pause_mode: String      // "pause" (по умолчанию) | "continuous"
    var blocks: [WalkBlock]

    init(id: String = UUID().uuidString, title: String? = nil, role: String? = nil,
         target_scope: String? = nil, assigned_staff_id: String? = nil,
         walk_pause_mode: String = "pause", blocks: [WalkBlock] = []) {
        self.id = id; self.title = title; self.role = role
        self.target_scope = target_scope; self.assigned_staff_id = assigned_staff_id
        self.walk_pause_mode = walk_pause_mode; self.blocks = blocks
    }

    private enum CodingKeys: String, CodingKey {
        case id, title, role, target_scope, assigned_staff_id, walk_pause_mode
        case blocks = "items"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        title = try c.decodeIfPresent(String.self, forKey: .title)
        role = try c.decodeIfPresent(String.self, forKey: .role)
        target_scope = try c.decodeIfPresent(String.self, forKey: .target_scope)
        assigned_staff_id = try c.decodeIfPresent(String.self, forKey: .assigned_staff_id)
        walk_pause_mode = try c.decodeIfPresent(String.self, forKey: .walk_pause_mode) ?? "pause"
        blocks = try c.decodeIfPresent([WalkBlock].self, forKey: .blocks) ?? []
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encodeIfPresent(title, forKey: .title)
        try c.encodeIfPresent(role, forKey: .role)
        try c.encodeIfPresent(target_scope, forKey: .target_scope)
        try c.encodeIfPresent(assigned_staff_id, forKey: .assigned_staff_id)
        try c.encode(walk_pause_mode, forKey: .walk_pause_mode)
        try c.encode(blocks, forKey: .blocks)
    }

    /// DFS-развёртка дерева в плоский список пунктов — items_state прогона позиционно
    /// совпадает с этим порядком (тот же приём, что у плоских kind="audit"/"shift").
    var flatItems: [WalkItem] { blocks.flatMap { $0.categories.flatMap(\.items) } }

    // Восьмёрка — общий пул для менеджеров (Д3, 2026-07-30): target_scope/assigned_staff_id
    // больше не задаются целенаправленно (личный/цеховой таргетинг убран), но колонки в БД
    // не трогаем — просто не пишем в них ничего осмысленного, старые значения не читаются.
    var asUpdateDict: [String: Any] {
        [
            "kind": "walk", "title": title ?? NSNull(), "role": role ?? NSNull(),
            "target_scope": target_scope ?? NSNull(), "assigned_staff_id": assigned_staff_id ?? NSNull(),
            "walk_pause_mode": walk_pause_mode, "items": blocks.map(\.asDict),
        ]
    }
}

/// Один прогон восьмёрки — итог по завершению обхода.
nonisolated struct WalkRun: Codable, Identifiable, Sendable {
    let id: String
    let checklist_id: String?
    let date: String?
    var staff_id: String? = nil
    var items_state: [ChecklistItemState]?   // позиционно совпадает с WalkTemplate.flatItems
    var duration_seconds: Int? = nil
    var steps: Int? = nil
    var completed_at: String? = nil
}

/// Лёгкая ссылка на смену (для привязки чек-листа к открытой смене Manager).
nonisolated struct ShiftRef: Codable, Identifiable, Sendable {
    let id: String
    let status: String?
    let date: String?
}

/// Заявка/сообщение сотрудника менеджеру (staff_reports):
/// предложение / что заказать / поломка.
nonisolated struct StaffReport: Codable, Identifiable, Sendable {
    let id: String
    let author_id: String?
    let type: String?        // breakdown | notice | suggestion | other
    let title: String
    let description: String?
    var status: String?      // new | reviewed | resolved
    let created_at: String?
}

nonisolated struct AttendanceRecord: Codable, Identifiable, Sendable {
    let id: String
    let staff_id: String?
    let date: String?
    let check_in_at: String?
    let check_out_at: String?
    let status: String?
    let late_minutes: Int?
}

nonisolated struct GraceRow: Codable, Sendable { let late_grace_min: Int? }
nonisolated struct PayoutDayRow: Codable, Sendable { let salary_payout_day: Int? }

nonisolated struct PurchaseItem: Codable, Identifiable, Sendable {
    let id: String
    let category: String
    let name: String
    let qty: Double?
    let unit: String?
    var status: String          // todo | bought | unavailable
    let created_by: String?
    let created_by_name: String?
    let created_at: String?
}

nonisolated struct SwapRequest: Codable, Identifiable, Sendable {
    let id: String
    let schedule_id: String?
    let target_schedule_id: String?
    let requester_id: String?
    let target_id: String?
    var status: String?
    let note: String?
}

nonisolated struct SalaryAdvance: Codable, Identifiable, Sendable {
    let id: String
    let employee_id: String?
    let amount: Double?
    let date: String?
    let note: String?
    // Месяц ЗП, к которому относится аванс (юзер-фидбок 2026-08-15) — YYYY-MM-01, как
    // salary_payments.period. Независим от `date` (день списания из кассы). См.
    // docs/migrations/salary-advances-period-2026-08-15.sql.
    let period: String?
}

// Факт выдачи ЗП сотруднику (People→Зарплата, ЗП-долг 2026-07-28) — отдельно от salary_advances
// (авансы В ТЕЧЕНИЕ месяца) и monthly_card_amounts (план на карту, вводится вручную).
nonisolated struct SalaryPayment: Codable, Identifiable, Sendable {
    let id: String
    let employee_id: String?
    let period: String?   // YYYY-MM-01
    let amount: Double?
    let method: String?
    let paid_at: String?
    let note: String?
}

nonisolated struct GeoSettings: Codable, Sendable {
    let attendance_enabled: Bool?
    let latitude: Double?
    let longitude: Double?
    let geo_radius_m: Double?
    let late_grace_min: Int?
}

nonisolated struct TechCard: Codable, Identifiable, Sendable {
    let id: String
    let name: String
    let category: String?
    let items: [String]?
}

nonisolated struct Booking: Codable, Identifiable, Sendable {
    let id: String
    var booking_date: String?
    var booking_time: String?
    var guest_name: String?
    var guests_count: Int?
    var phone: String?
    var table_label: String?
    var note: String?
    var status: String?
    let created_by: String?
    let created_by_name: String?
}

// Google-отзывы (Places API sync) — read-only во всех клиентах, пишет только сервер.
nonisolated struct GoogleReview: Codable, Identifiable, Sendable {
    let id: String
    var author_name: String?
    var rating: Int?
    var review_text: String?
    var relative_time: String?
    var review_time: String?
}

nonisolated struct GoogleRatingSnapshot: Codable, Sendable {
    var captured_at: String?
    var rating: Double?
    var ratings_total: Int?
}

nonisolated struct HookahGoal: Codable, Identifiable, Sendable {
    let id: String
    var title: String?
    var type_ids: [String]?
    var target_qty: Int?
    var month: String?
}

nonisolated struct NewsPost: Codable, Identifiable, Sendable {
    let id: String
    var kind: String?
    var priority: String?
    var title: String?
    var body: String?
    let created_by: String?
    let created_by_name: String?
    let created_at: String?
}
