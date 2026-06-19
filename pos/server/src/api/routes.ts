import { Database } from "bun:sqlite";
import { Queries } from "../db/queries";

export function createApiRouter(db: Database) {
  const q = new Queries(db);

  return async function router(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;

    const json = (data: unknown, status = 200) =>
      new Response(JSON.stringify(data), {
        status,
        headers: { "Content-Type": "application/json" },
      });

    // ── Health ───────────────────────────────────────────────────────────────
    if (path === "/health") {
      return json({ ok: true, ts: new Date().toISOString() });
    }

    // ── Menu ─────────────────────────────────────────────────────────────────
    if (path === "/api/menu" && method === "GET") {
      const restaurantId = url.searchParams.get("restaurant_id") ?? "default";
      return json(q.getMenu(restaurantId));
    }

    // ── Tables ────────────────────────────────────────────────────────────────
    if (path === "/api/tables" && method === "GET") {
      const restaurantId = url.searchParams.get("restaurant_id") ?? "default";
      return json(q.getTables(restaurantId));
    }

    // ── KDS ───────────────────────────────────────────────────────────────────
    if (path === "/api/kds" && method === "GET") {
      const restaurantId = url.searchParams.get("restaurant_id") ?? "default";
      const station = url.searchParams.get("station") ?? undefined;
      return json(q.getKdsTickers(restaurantId, station));
    }

    // ── Orders ────────────────────────────────────────────────────────────────
    if (path.startsWith("/api/orders/") && method === "GET") {
      const orderId = path.split("/").pop()!;
      const order = q.getOrder(orderId);
      if (!order) return json({ error: "Not found" }, 404);
      const items = q.getOrderItems(orderId);
      return json({ ...order, items });
    }

    // ── Sync status ────────────────────────────────────────────────────────────
    if (path === "/api/sync/status" && method === "GET") {
      const pending = db.query("SELECT COUNT(*) as count FROM pos_sync_queue WHERE attempts < 5")
        .get() as any;
      const failed = db.query("SELECT COUNT(*) as count FROM pos_sync_queue WHERE attempts >= 5")
        .get() as any;
      return json({ pending: pending.count, failed: failed.count });
    }

    // ── Session ────────────────────────────────────────────────────────────────
    if (path === "/api/session/open" && method === "POST") {
      const body = await req.json() as any;
      const restaurantId = body.restaurant_id ?? "default";
      const existing = db.query("SELECT id FROM pos_sessions WHERE restaurant_id = ? AND status = 'open'")
        .get(restaurantId);
      if (existing) return json({ error: "Смена уже открыта" }, 409);
      const id = crypto.randomUUID();
      db.query(`INSERT INTO pos_sessions (id, restaurant_id, opening_cash, opened_at, status)
                VALUES (?, ?, ?, ?, 'open')`)
        .run(id, restaurantId, body.opening_cash ?? 0, new Date().toISOString());
      const session = db.query("SELECT * FROM pos_sessions WHERE id = ?").get(id);
      return json({ ...session as any, pos_session_payins: [], pos_session_payouts: [] });
    }

    if (path === "/api/session/close" && method === "POST") {
      const body = await req.json() as any;
      db.query(`UPDATE pos_sessions SET status = 'closed', closed_at = ?, closing_cash_actual = ?
                WHERE id = ?`)
        .run(new Date().toISOString(), body.closing_cash_actual ?? 0, body.session_id);
      return json({ ok: true });
    }

    if (path === "/api/session/payin" && method === "POST") {
      const body = await req.json() as any;
      const id = crypto.randomUUID();
      db.query("INSERT INTO pos_session_payins (id, session_id, amount, note) VALUES (?, ?, ?, ?)")
        .run(id, body.session_id, body.amount, body.note ?? null);
      db.query("UPDATE pos_sessions SET total_cash = total_cash + ? WHERE id = ?")
        .run(body.amount, body.session_id);
      return json({ ok: true });
    }

    if (path === "/api/session/payout" && method === "POST") {
      const body = await req.json() as any;
      const id = crypto.randomUUID();
      db.query("INSERT INTO pos_session_payouts (id, session_id, amount, note) VALUES (?, ?, ?, ?)")
        .run(id, body.session_id, body.amount, body.note ?? null);
      return json({ ok: true });
    }

    return json({ error: "Not found" }, 404);
  };
}
