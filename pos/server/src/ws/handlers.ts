import { Database } from "bun:sqlite";
import { ServerWebSocket } from "bun";
import { v7 as uuidv7 } from "uuid";
import { Queries } from "../db/queries";
import type { ClientMessage, ServerMessage, Snapshot, TableState } from "./protocol";
import { encode } from "./protocol";
import { config } from "../config";

export interface WsData {
  connectedAt: number;
  deviceId: string | null;
  role: string | null;
  restaurantId: string | null;
}

type Ws = ServerWebSocket<WsData>;

// All connected authenticated clients
const clients = new Set<Ws>();

export function broadcast(msg: ServerMessage, exclude?: Ws) {
  const payload = encode(msg);
  for (const ws of clients) {
    if (ws !== exclude) ws.send(payload);
  }
}

export function broadcastToRole(msg: ServerMessage, role: string) {
  const payload = encode(msg);
  for (const ws of clients) {
    if (ws.data.role === role) ws.send(payload);
  }
}

export function createHandlers(db: Database) {
  const q = new Queries(db);

  function buildSnapshot(restaurantId: string): Snapshot {
    const tables = q.getTables(restaurantId) as any[];
    const menu = q.getMenu(restaurantId);

    const tableStates: TableState[] = tables.map((t) => {
      const seating = q.getActiveSeating(t.id) as any;
      let seatState: TableState["seating"] = undefined;
      if (seating) {
        const order = q.getOrderBySeating(seating.id) as any;
        const items = order ? q.getOrderItems(order.id) : [];
        seatState = {
          id: seating.id,
          guests_count: seating.guests_count,
          opened_at: seating.opened_at,
          waiter_id: seating.waiter_id,
          order: order ? { ...order, items: items.map(parseItem) } : undefined,
        };
      }
      return {
        id: t.id,
        number: t.number,
        label: t.label,
        status: t.status,
        floor_id: t.floor_id,
        capacity: t.capacity,
        pos_x: t.pos_x,
        pos_y: t.pos_y,
        width: t.width,
        height: t.height,
        seating: seatState,
      };
    });

    return {
      restaurant_id: restaurantId,
      tables: tableStates,
      menu: {
        categories: (menu.categories as any[]).map((c) => ({
          id: c.id, name: c.name, sort: c.sort, color: c.color, icon: c.icon,
        })),
        items: (menu.items as any[]).map((i) => ({
          id: i.id, category_id: i.category_id, name: i.name, description: i.description,
          photo_url: i.photo_url, base_price: i.base_price, yield_g: i.yield_g,
          allergens: JSON.parse(i.allergens ?? "[]"),
          station: i.station, flags: JSON.parse(i.flags ?? "[]"),
          is_available: Boolean(i.is_available), sort: i.sort,
        })),
        groups: (menu.groups as any[]).map((g) => ({
          id: g.id, menu_item_id: g.menu_item_id, name: g.name,
          required: Boolean(g.required), min_select: g.min_select,
          max_select: g.max_select, sort: g.sort,
        })),
        modifiers: (menu.modifiers as any[]).map((m) => ({
          id: m.id, group_id: m.group_id, name: m.name,
          price_delta: m.price_delta, sort: m.sort,
        })),
      },
      active_session: (() => {
        const s = db.query(
          "SELECT *, (SELECT json_group_array(json_object('id',id,'amount',amount,'note',note,'created_at',created_at)) FROM pos_session_payins WHERE session_id = ps.id) as payins, (SELECT json_group_array(json_object('id',id,'amount',amount,'note',note,'created_at',created_at)) FROM pos_session_payouts WHERE session_id = ps.id) as payouts FROM pos_sessions ps WHERE restaurant_id = ? AND status = 'open' LIMIT 1"
        ).get(restaurantId) as any;
        if (!s) return null;
        return {
          id: s.id, opened_at: s.opened_at, closed_at: s.closed_at ?? null,
          opening_cash: s.opening_cash, total_sales: s.total_sales,
          total_cash: s.total_cash, total_card: s.total_card,
          total_discount: s.total_discount, total_comps: s.total_comps, status: s.status,
          pos_session_payins: JSON.parse(s.payins ?? "[]"),
          pos_session_payouts: JSON.parse(s.payouts ?? "[]"),
        };
      })(),
    };
  }

  function parseItem(i: any) {
    return {
      ...i,
      modifiers: JSON.parse(i.modifiers ?? "[]"),
    };
  }

  function send(ws: Ws, msg: ServerMessage) {
    ws.send(encode(msg));
  }

  return {
    open(ws: Ws) {
      // Not yet authenticated — don't add to clients
    },

    close(ws: Ws) {
      clients.delete(ws);
    },

    async message(ws: Ws, raw: string) {
      const msg = JSON.parse(raw) as ClientMessage;

      // ── Auth ──────────────────────────────────────────────────────────────
      if (msg.type === "auth") {
        // Простая PIN-аутентификация (в production — bcrypt)
        const device = db.query("SELECT * FROM pos_devices WHERE id = ? AND is_active = 1")
          .get(msg.device_id) as any;

        let restaurantId: string;

        if (!device) {
          // Первый запуск: мастер-пин создаёт дефолтное устройство
          if (msg.pin !== config.masterPin) {
            send(ws, { type: "auth.error", message: "Unknown device. Use master PIN to register." });
            return;
          }
          restaurantId = "default"; // TODO: resolve from Supabase
        } else {
          if (device.pin_hash !== msg.pin) {
            send(ws, { type: "auth.error", message: "Incorrect PIN" });
            return;
          }
          restaurantId = device.restaurant_id ?? "default";
          db.query("UPDATE pos_devices SET last_seen_at = datetime('now') WHERE id = ?").run(msg.device_id);
        }

        ws.data.deviceId = msg.device_id;
        ws.data.role = msg.role;
        ws.data.restaurantId = restaurantId;
        clients.add(ws);

        const snapshot = buildSnapshot(restaurantId);
        send(ws, { type: "auth.ok", device_id: msg.device_id, role: msg.role, snapshot });
        return;
      }

      // All other messages require auth
      if (!ws.data.restaurantId) {
        send(ws, { type: "error", message: "Not authenticated" });
        return;
      }

      const rid = ws.data.restaurantId;

      if (msg.type === "ping") {
        send(ws, { type: "pong" });
        return;
      }

      // ── Table ─────────────────────────────────────────────────────────────
      if (msg.type === "table.open") {
        const seatId = uuidv7();
        const orderId = uuidv7();
        q.openSeating(seatId, msg.table_id, rid, msg.guests);
        q.createOrder(orderId, seatId, rid);

        const table = db.query("SELECT * FROM pos_tables WHERE id = ?").get(msg.table_id) as any;
        const order = q.getOrder(orderId);

        broadcast({
          type: "state.tables",
          tables: buildSnapshot(rid).tables,
        });

        send(ws, { type: "ack", request_id: msg.request_id, ok: true });
        return;
      }

      if (msg.type === "table.close") {
        const seating = q.getActiveSeating(msg.table_id);
        if (seating) q.closeSeating(seating.id, msg.table_id);
        broadcast({ type: "state.tables", tables: buildSnapshot(rid).tables });
        send(ws, { type: "ack", request_id: msg.request_id, ok: true });
        return;
      }

      // ── Order items ────────────────────────────────────────────────────────
      if (msg.type === "order.item.add") {
        q.addOrderItem({
          id: msg.item.id,
          orderId: msg.order_id,
          menuItemId: msg.item.menu_item_id,
          menuItemName: msg.item.menu_item_name,
          qty: msg.item.qty,
          unitPrice: msg.item.unit_price,
          modifiers: JSON.stringify(msg.item.modifiers),
          course: msg.item.course,
          note: msg.item.note,
        });

        const order = q.getOrder(msg.order_id);
        const items = q.getOrderItems(msg.order_id);
        broadcast({ type: "state.order", order: { ...order, items: items.map(parseItem) } });
        send(ws, { type: "ack", request_id: msg.request_id, ok: true });
        return;
      }

      if (msg.type === "order.item.remove") {
        q.removeOrderItem(msg.item_id, msg.order_id);
        const order = q.getOrder(msg.order_id);
        const items = q.getOrderItems(msg.order_id);
        broadcast({ type: "state.order", order: { ...order, items: items.map(parseItem) } });
        send(ws, { type: "ack", request_id: msg.request_id, ok: true });
        return;
      }

      // ── Kitchen ────────────────────────────────────────────────────────────
      if (msg.type === "order.send_to_kitchen") {
        q.sendToKitchen(msg.order_id, msg.course);
        const order = q.getOrder(msg.order_id);
        const items = q.getOrderItems(msg.order_id);
        broadcast({ type: "state.order", order: { ...order, items: items.map(parseItem) } });
        send(ws, { type: "ack", request_id: msg.request_id, ok: true });
        return;
      }

      if (msg.type === "kitchen.item.ready") {
        q.markItemReady(msg.item_id);
        const item = db.query("SELECT * FROM pos_order_items WHERE id = ?").get(msg.item_id) as any;
        const order = q.getOrder(item.order_id);
        const seating = db.query("SELECT * FROM pos_seatings WHERE id = ?").get(order.seating_id) as any;
        const table = db.query("SELECT * FROM pos_tables WHERE id = ?").get(seating.table_id) as any;

        broadcast({ type: "state.kds_item", item_id: msg.item_id, status: "ready", order_id: item.order_id });
        broadcast({ type: "notify.item_ready", order_id: item.order_id, item_name: item.menu_item_name, table_number: table.number });
        send(ws, { type: "ack", request_id: msg.request_id, ok: true });
        return;
      }

      if (msg.type === "kitchen.ticket.done") {
        q.sendToKitchen(msg.order_id); // marks all remaining sent → ready is handled per item
        const order = q.getOrder(msg.order_id);
        const seating = db.query("SELECT * FROM pos_seatings WHERE id = ?").get(order.seating_id) as any;
        const table = db.query("SELECT * FROM pos_tables WHERE id = ?").get(seating.table_id) as any;
        broadcast({ type: "notify.ticket_done", order_id: msg.order_id, table_number: table.number });
        send(ws, { type: "ack", request_id: msg.request_id, ok: true });
        return;
      }

      // ── Payment ────────────────────────────────────────────────────────────
      if (msg.type === "order.pay") {
        q.createPayment({
          id: msg.payment.id,
          orderId: msg.order_id,
          restaurantId: rid,
          method: msg.payment.method,
          amount: msg.payment.amount,
          tipAmount: msg.payment.tip_amount,
          changeAmount: msg.payment.change_amount,
        });

        // Update open session totals
        const amt = msg.payment.amount;
        const method = msg.payment.method;
        db.query(`
          UPDATE pos_sessions SET
            total_sales = total_sales + ?,
            total_cash  = total_cash  + ?,
            total_card  = total_card  + ?,
            updated_at  = datetime('now')
          WHERE restaurant_id = ? AND status = 'open'
        `).run(amt, method === "cash" ? amt : 0, method === "card" ? amt : 0, rid);

        const order = q.getOrder(msg.order_id);
        const seating = db.query("SELECT * FROM pos_seatings WHERE id = ?").get(order.seating_id) as any;
        if (seating) q.closeSeating(seating.id, seating.table_id);

        // Broadcast full snapshot so session view updates everywhere
        const snap = buildSnapshot(rid);
        broadcast({ type: "state.tables", tables: snap.tables });
        if (snap.active_session) {
          broadcast({ type: "state.session", session: snap.active_session });
        }
        broadcast({ type: "payment.ok", order_id: msg.order_id, payment_id: msg.payment.id, change: msg.payment.change_amount });
        send(ws, { type: "ack", request_id: msg.request_id, ok: true });
        return;
      }

      // ── Discount ───────────────────────────────────────────────────────────
      if (msg.type === "order.apply_discount") {
        q.applyDiscount(msg.order_id, msg.amount);
        const order = q.getOrder(msg.order_id);
        const items = q.getOrderItems(msg.order_id);
        broadcast({ type: "state.order", order: { ...order, items: items.map(parseItem) } });
        send(ws, { type: "ack", request_id: msg.request_id, ok: true });
        return;
      }

      // ── Menu ──────────────────────────────────────────────────────────────
      if (msg.type === "menu.toggle_item") {
        q.toggleItemAvailability(msg.item_id, msg.available);
        broadcast({ type: "state.menu_item", item_id: msg.item_id, is_available: msg.available });
        send(ws, { type: "ack", request_id: msg.request_id, ok: true });
        return;
      }

      // ── Full sync ──────────────────────────────────────────────────────────
      if (msg.type === "sync.request") {
        const snapshot = buildSnapshot(rid);
        send(ws, { type: "auth.ok", device_id: ws.data.deviceId!, role: ws.data.role!, snapshot });
        return;
      }

      send(ws, { type: "error", message: `Unknown message type: ${(msg as any).type}` });
    },
  };
}
