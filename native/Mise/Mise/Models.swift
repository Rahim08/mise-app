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
    let table_number: Int?
    var status: String?
    let total: Double?
    let created_at: String?
    let items: [OrderItem]?
}

nonisolated struct ShiftChecklist: Codable, Identifiable, Sendable {
    let id: String
    let type: String?
    let role: String?
    let items: [String]?
}

nonisolated struct ChecklistCompletion: Codable, Identifiable, Sendable {
    let id: String
    let checklist_id: String?
    let date: String?
    var shift_id: String? = nil
    var items_state: [Bool]?
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
