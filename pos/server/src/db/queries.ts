import { Database } from "bun:sqlite";

export class Queries {
  constructor(private db: Database) {}

  // ── Tables ──────────────────────────────────────────────────────────────

  getFloor(restaurantId: string) {
    return this.db
      .query("SELECT * FROM pos_floors WHERE restaurant_id = ? ORDER BY sort")
      .all(restaurantId);
  }

  getTables(restaurantId: string) {
    return this.db
      .query("SELECT * FROM pos_tables WHERE restaurant_id = ? ORDER BY number")
      .all(restaurantId);
  }

  updateTableStatus(tableId: string, status: string) {
    this.db
      .query("UPDATE pos_tables SET status = ?, updated_at = datetime('now') WHERE id = ?")
      .run(status, tableId);
  }

  // ── Seatings ─────────────────────────────────────────────────────────────

  openSeating(id: string, tableId: string, restaurantId: string, guests: number, waiterId?: string) {
    this.db.query(`
      INSERT INTO pos_seatings (id, table_id, restaurant_id, opened_at, guests_count, waiter_id)
      VALUES (?, ?, ?, datetime('now'), ?, ?)
    `).run(id, tableId, restaurantId, guests, waiterId ?? null);

    this.updateTableStatus(tableId, "occupied");
  }

  closeSeating(seatId: string, tableId: string) {
    this.db.query("UPDATE pos_seatings SET closed_at = datetime('now'), status = 'closed' WHERE id = ?")
      .run(seatId);
    this.updateTableStatus(tableId, "free");
  }

  getActiveSeating(tableId: string) {
    return this.db
      .query("SELECT * FROM pos_seatings WHERE table_id = ? AND status = 'open' LIMIT 1")
      .get(tableId) as any;
  }

  // ── Orders ────────────────────────────────────────────────────────────────

  createOrder(id: string, seatingId: string, restaurantId: string) {
    this.db.query(`
      INSERT INTO pos_orders (id, seating_id, restaurant_id)
      VALUES (?, ?, ?)
    `).run(id, seatingId, restaurantId);
    return this.getOrder(id);
  }

  getOrder(orderId: string) {
    return this.db.query("SELECT * FROM pos_orders WHERE id = ?").get(orderId) as any;
  }

  getOrderBySeating(seatingId: string) {
    return this.db
      .query("SELECT * FROM pos_orders WHERE seating_id = ? AND status != 'paid' LIMIT 1")
      .get(seatingId) as any;
  }

  getOrderItems(orderId: string) {
    return this.db
      .query("SELECT * FROM pos_order_items WHERE order_id = ? ORDER BY created_at")
      .all(orderId) as any[];
  }

  addOrderItem(item: {
    id: string; orderId: string; menuItemId: string; menuItemName: string;
    qty: number; unitPrice: number; modifiers: string; course: number; note?: string;
  }) {
    this.db.query(`
      INSERT INTO pos_order_items
        (id, order_id, menu_item_id, menu_item_name, qty, unit_price, modifiers, course, note)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      item.id, item.orderId, item.menuItemId, item.menuItemName,
      item.qty, item.unitPrice, item.modifiers, item.course, item.note ?? null
    );
    this.recalcOrderTotal(item.orderId);
  }

  removeOrderItem(itemId: string, orderId: string) {
    this.db.query("DELETE FROM pos_order_items WHERE id = ? AND status = 'pending'")
      .run(itemId);
    this.recalcOrderTotal(orderId);
  }

  sendToKitchen(orderId: string, course?: number) {
    const where = course != null ? "order_id = ? AND course = ? AND status = 'pending'" : "order_id = ? AND status = 'pending'";
    const args = course != null ? [orderId, course] : [orderId];
    this.db.query(`
      UPDATE pos_order_items SET status = 'sent', sent_at = datetime('now') WHERE ${where}
    `).run(...args as [any]);
  }

  markItemReady(itemId: string) {
    this.db.query("UPDATE pos_order_items SET status = 'ready', ready_at = datetime('now') WHERE id = ?")
      .run(itemId);
  }

  markItemServed(itemId: string) {
    this.db.query("UPDATE pos_order_items SET status = 'served', served_at = datetime('now') WHERE id = ?")
      .run(itemId);
  }

  recalcOrderTotal(orderId: string) {
    this.db.query(`
      UPDATE pos_orders SET
        subtotal = (SELECT COALESCE(SUM((qty * unit_price) - discount), 0) FROM pos_order_items WHERE order_id = ? AND status != 'cancelled'),
        updated_at = datetime('now')
      WHERE id = ?
    `).run(orderId, orderId);

    // total = subtotal - discount_amount + tax_amount
    this.db.query(`
      UPDATE pos_orders SET total = subtotal - discount_amount + tax_amount WHERE id = ?
    `).run(orderId);
  }

  applyDiscount(orderId: string, amount: number) {
    this.db.query("UPDATE pos_orders SET discount_amount = ?, updated_at = datetime('now') WHERE id = ?")
      .run(amount, orderId);
    this.recalcOrderTotal(orderId);
  }

  // ── KDS ──────────────────────────────────────────────────────────────────

  getKdsTickers(restaurantId: string, station?: string) {
    const stationJoin = station
      ? `JOIN pos_menu_items mi ON oi.menu_item_id = mi.id AND mi.station = '${station}'`
      : "";

    return this.db.query(`
      SELECT
        o.id as order_id, o.seating_id, o.note as order_note,
        t.number as table_number, t.label as table_label,
        oi.id as item_id, oi.menu_item_name, oi.qty, oi.modifiers,
        oi.course, oi.note as item_note, oi.status, oi.sent_at
      FROM pos_order_items oi
      JOIN pos_orders o ON oi.order_id = o.id
      JOIN pos_seatings s ON o.seating_id = s.id
      JOIN pos_tables t ON s.table_id = t.id
      ${stationJoin}
      WHERE o.restaurant_id = ? AND oi.status IN ('sent', 'cooking')
      ORDER BY oi.sent_at ASC
    `).all(restaurantId) as any[];
  }

  // ── Payments ──────────────────────────────────────────────────────────────

  createPayment(payment: {
    id: string; orderId: string; restaurantId: string; method: string;
    amount: number; tipAmount: number; changeAmount: number;
  }) {
    this.db.query(`
      INSERT INTO pos_payments (id, order_id, restaurant_id, method, amount, tip_amount, change_amount, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'completed')
    `).run(
      payment.id, payment.orderId, payment.restaurantId, payment.method,
      payment.amount, payment.tipAmount, payment.changeAmount
    );

    this.db.query("UPDATE pos_orders SET status = 'paid', updated_at = datetime('now') WHERE id = ?")
      .run(payment.orderId);
  }

  // ── Menu ─────────────────────────────────────────────────────────────────

  getMenu(restaurantId: string) {
    const categories = this.db
      .query("SELECT * FROM pos_menu_categories WHERE restaurant_id = ? AND is_active = 1 ORDER BY sort")
      .all(restaurantId) as any[];

    const items = this.db
      .query("SELECT * FROM pos_menu_items WHERE restaurant_id = ? AND is_active = 1 ORDER BY sort")
      .all(restaurantId) as any[];

    const groups = this.db
      .query(`
        SELECT mg.* FROM pos_modifier_groups mg
        JOIN pos_menu_items mi ON mg.menu_item_id = mi.id
        WHERE mi.restaurant_id = ?
      `)
      .all(restaurantId) as any[];

    const modifiers = this.db
      .query(`
        SELECT m.* FROM pos_modifiers m
        JOIN pos_modifier_groups mg ON m.group_id = mg.id
        JOIN pos_menu_items mi ON mg.menu_item_id = mi.id
        WHERE mi.restaurant_id = ?
      `)
      .all(restaurantId) as any[];

    return { categories, items, groups, modifiers };
  }

  toggleItemAvailability(itemId: string, available: boolean) {
    this.db.query("UPDATE pos_menu_items SET is_available = ?, updated_at = datetime('now') WHERE id = ?")
      .run(available ? 1 : 0, itemId);
  }

  // ── Sync queue ────────────────────────────────────────────────────────────

  enqueuSync(tableName: string, recordId: string, operation: string, payload: unknown) {
    const id = crypto.randomUUID();
    this.db.query(`
      INSERT OR IGNORE INTO pos_sync_queue (id, table_name, record_id, operation, payload)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, tableName, recordId, operation, JSON.stringify(payload));
  }

  getPendingSyncItems(limit = 50) {
    return this.db.query(`
      SELECT * FROM pos_sync_queue WHERE attempts < 5 ORDER BY created_at LIMIT ?
    `).all(limit) as any[];
  }

  markSyncSuccess(id: string) {
    this.db.query("DELETE FROM pos_sync_queue WHERE id = ?").run(id);
  }

  markSyncFailed(id: string, error: string) {
    this.db.query("UPDATE pos_sync_queue SET attempts = attempts + 1, last_error = ? WHERE id = ?")
      .run(error, id);
  }

  // ── Data purge ────────────────────────────────────────────────────────────

  purgeOldSyncedData(hoursOld: number) {
    const cutoff = new Date(Date.now() - hoursOld * 60 * 60 * 1000).toISOString();
    this.db.query(`
      DELETE FROM pos_order_items WHERE order_id IN (
        SELECT o.id FROM pos_orders o
        WHERE o.created_at < ?
          AND o.status = 'paid'
          AND o.is_synced = 1
      )
    `).run(cutoff);

    this.db.query(`
      DELETE FROM pos_orders WHERE created_at < ? AND status = 'paid' AND is_synced = 1
    `).run(cutoff);

    this.db.query(`
      DELETE FROM pos_seatings WHERE closed_at < ? AND status = 'closed' AND is_synced = 1
    `).run(cutoff);
  }
}
