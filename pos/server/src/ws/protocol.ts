// ── Client → Server ────────────────────────────────────────────────────────

export type ClientMessage =
  | { type: "auth"; device_id: string; pin: string; role: string }
  | { type: "ping" }
  | { type: "table.open"; request_id: string; table_id: string; guests: number }
  | { type: "table.close"; request_id: string; table_id: string }
  | { type: "order.item.add"; request_id: string; order_id: string; item: OrderItemInput }
  | { type: "order.item.remove"; request_id: string; order_id: string; item_id: string }
  | { type: "order.send_to_kitchen"; request_id: string; order_id: string; course?: number }
  | { type: "order.apply_discount"; request_id: string; order_id: string; amount: number }
  | { type: "order.pay"; request_id: string; order_id: string; payment: PaymentInput }
  | { type: "kitchen.item.ready"; request_id: string; item_id: string }
  | { type: "kitchen.ticket.done"; request_id: string; order_id: string }
  | { type: "menu.toggle_item"; request_id: string; item_id: string; available: boolean }
  | { type: "sync.request" }

export interface OrderItemInput {
  id: string
  menu_item_id: string
  menu_item_name: string
  qty: number
  unit_price: number
  modifiers: ModifierSelection[]
  course: number
  note?: string
}

export interface ModifierSelection {
  group_id: string
  group_name: string
  option_id: string
  option_name: string
  price_delta: number
}

export interface PaymentInput {
  id: string
  method: "cash" | "card" | "mixed" | "voucher"
  amount: number
  tip_amount: number
  change_amount: number
  cash_tendered?: number
  stripe_payment_intent_id?: string
}

// ── Server → Client ────────────────────────────────────────────────────────

export type ServerMessage =
  | { type: "auth.ok"; device_id: string; role: string; snapshot: Snapshot }
  | { type: "auth.error"; message: string }
  | { type: "pong" }
  | { type: "ack"; request_id: string; ok: true }
  | { type: "error"; request_id?: string; message: string }
  | { type: "state.tables"; tables: TableState[] }
  | { type: "state.order"; order: OrderState }
  | { type: "state.menu_item"; item_id: string; is_available: boolean }
  | { type: "state.kds_item"; item_id: string; status: string; order_id: string }
  | { type: "notify.item_ready"; order_id: string; item_name: string; table_number: string }
  | { type: "notify.ticket_done"; order_id: string; table_number: string }
  | { type: "payment.ok"; order_id: string; payment_id: string; change: number }
  | { type: "state.session"; session: ActiveSession }

// ── Shared state types ─────────────────────────────────────────────────────

export interface Snapshot {
  restaurant_id: string
  tables: TableState[]
  menu: MenuSnapshot
  active_session: ActiveSession | null
}

export interface TableState {
  id: string
  number: string
  label: string | null
  status: "free" | "occupied" | "bill-requested" | "reserved" | "blocked"
  floor_id: string
  capacity: number
  pos_x: number
  pos_y: number
  width: number
  height: number
  seating?: ActiveSeating
}

export interface ActiveSeating {
  id: string
  guests_count: number
  opened_at: string
  waiter_id: string | null
  order?: OrderState
}

export interface OrderState {
  id: string
  seating_id: string
  status: string
  subtotal: number
  discount_amount: number
  tax_amount: number
  total: number
  note: string | null
  items: OrderItemState[]
}

export interface OrderItemState {
  id: string
  menu_item_id: string
  menu_item_name: string
  qty: number
  unit_price: number
  discount: number
  modifiers: ModifierSelection[]
  course: number
  status: string
  note: string | null
  sent_at: string | null
  ready_at: string | null
}

export interface MenuSnapshot {
  categories: MenuCategory[]
  items: MenuItem[]
  groups: ModifierGroup[]
  modifiers: Modifier[]
}

export interface MenuCategory {
  id: string; name: string; sort: number; color: string | null; icon: string | null
}

export interface MenuItem {
  id: string; category_id: string; name: string; description: string | null
  photo_url: string | null; base_price: number; yield_g: number | null
  allergens: string[]; station: string; flags: string[]
  is_available: boolean; sort: number
}

export interface ModifierGroup {
  id: string; menu_item_id: string; name: string
  required: boolean; min_select: number; max_select: number; sort: number
}

export interface Modifier {
  id: string; group_id: string; name: string; price_delta: number; sort: number
}

export interface ActiveSession {
  id: string
  opened_at: string
  closed_at: string | null
  opening_cash: number
  total_sales: number
  total_cash: number
  total_card: number
  total_discount: number
  total_comps: number
  status: string
  pos_session_payins: { id: string; amount: number; note: string | null; created_at: string }[]
  pos_session_payouts: { id: string; amount: number; note: string | null; created_at: string }[]
}

// ── Helpers ────────────────────────────────────────────────────────────────

export function encode(msg: ServerMessage): string {
  return JSON.stringify(msg);
}

export function decode(raw: string): ClientMessage | null {
  try {
    return JSON.parse(raw) as ClientMessage;
  } catch {
    return null;
  }
}
