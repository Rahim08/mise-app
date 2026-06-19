import { Database } from "bun:sqlite";
import { createClient } from "@supabase/supabase-js";
import { Queries } from "../db/queries";
import { config } from "../config";

const TABLES_TO_SYNC = [
  "pos_floors",
  "pos_tables",
  "pos_seatings",
  "pos_orders",
  "pos_order_items",
  "pos_payments",
  "pos_receipts",
  "pos_stock_movements",
  "pos_session_payins",
  "pos_session_payouts",
] as const;

export function startSyncQueue(db: Database) {
  const supabase = createClient(config.supabaseUrl, config.supabaseServiceKey);
  const q = new Queries(db);

  let isRunning = false;

  async function flush() {
    if (isRunning) return;
    isRunning = true;

    try {
      const items = q.getPendingSyncItems(50);
      if (items.length === 0) return;

      for (const item of items) {
        try {
          const payload = JSON.parse(item.payload);

          if (item.operation === "upsert") {
            const { error } = await supabase
              .from(item.table_name)
              .upsert(payload, { onConflict: "id" });

            if (error) throw new Error(error.message);
          } else if (item.operation === "delete") {
            const { error } = await supabase
              .from(item.table_name)
              .delete()
              .eq("id", item.record_id);

            if (error) throw new Error(error.message);
          }

          q.markSyncSuccess(item.id);

          // Mark record as synced in local DB
          try {
            db.query(`UPDATE ${item.table_name} SET is_synced = 1 WHERE id = ?`)
              .run(item.record_id);
          } catch {
            // Table might not have is_synced (e.g. pos_sync_queue itself)
          }
        } catch (err) {
          q.markSyncFailed(item.id, String(err));
        }
      }
    } finally {
      isRunning = false;
    }
  }

  // Auto-purge old synced data at start of new day
  function schedulePurge() {
    const now = new Date();
    const nextMidnight = new Date(now);
    nextMidnight.setHours(24, 0, 5, 0);
    const msUntilMidnight = nextMidnight.getTime() - now.getTime();

    setTimeout(() => {
      q.purgeOldSyncedData(config.localRetentionHours);
      console.log(`[sync] Purged local data older than ${config.localRetentionHours}h`);
      schedulePurge(); // reschedule for next day
    }, msUntilMidnight);
  }

  // Run sync on interval
  setInterval(flush, config.syncIntervalMs);

  // Run immediately on startup
  flush().catch(console.error);

  // Schedule daily purge
  schedulePurge();

  return { flush };
}

// Call this whenever you write a record that needs to sync
export function enqueueRecord(db: Database, tableName: string, record: Record<string, unknown>) {
  const q = new Queries(db);
  q.enqueuSync(tableName, record.id as string, "upsert", record);
}
