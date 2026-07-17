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
    let monthly_revenue_goal: Double?
    let hookah_price: Double?
    let hookah_portion_g: Double?
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
/// и из нового `{id,label,photo_required}` — обратная совместимость на чтение,
/// миграция данных не требуется (см. docs/migrations/audits-v1-2026-07.sql).
nonisolated struct ChecklistItem: Codable, Identifiable, Sendable, Hashable {
    var id: String
    var label: String
    var photo_required: Bool

    init(id: String = UUID().uuidString, label: String, photo_required: Bool = false) {
        self.id = id; self.label = label; self.photo_required = photo_required
    }

    private enum CodingKeys: String, CodingKey { case id, label, photo_required }

    init(from decoder: Decoder) throws {
        if let sv = try? decoder.singleValueContainer(), let str = try? sv.decode(String.self) {
            id = str; label = str; photo_required = false
            return
        }
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeIfPresent(String.self, forKey: .id) ?? UUID().uuidString
        label = try c.decode(String.self, forKey: .label)
        photo_required = try c.decodeIfPresent(Bool.self, forKey: .photo_required) ?? false
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(label, forKey: .label)
        try c.encode(photo_required, forKey: .photo_required)
    }

    /// Плоский словарь для записи через DB.update([String: Any]) — JSONSerialization
    /// не умеет сериализовать Swift-структуры напрямую.
    var asDict: [String: Any] { ["id": id, "label": label, "photo_required": photo_required] }
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

    init(done: Bool, photo_url: String? = nil) { self.done = done; self.photo_url = photo_url }

    private enum CodingKeys: String, CodingKey { case done, photo_url }

    init(from decoder: Decoder) throws {
        if let sv = try? decoder.singleValueContainer(), let b = try? sv.decode(Bool.self) {
            done = b; photo_url = nil
            return
        }
        let c = try decoder.container(keyedBy: CodingKeys.self)
        done = try c.decodeIfPresent(Bool.self, forKey: .done) ?? false
        photo_url = try c.decodeIfPresent(String.self, forKey: .photo_url)
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(done, forKey: .done)
        try c.encodeIfPresent(photo_url, forKey: .photo_url)
    }

    var asDict: [String: Any] { ["done": done, "photo_url": photo_url ?? NSNull()] }
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
}

nonisolated struct GeoSettings: Codable, Sendable {
    let attendance_enabled: Bool?
    let latitude: Double?
    let longitude: Double?
    let geo_radius_m: Double?
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
