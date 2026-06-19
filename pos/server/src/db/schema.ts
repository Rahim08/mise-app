import { Database } from "bun:sqlite";

export function initDb(path: string): Database {
  const db = new Database(path, { create: true });
  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA foreign_keys = ON");
  db.run("PRAGMA synchronous = NORMAL");
  applySchema(db);
  return db;
}

function applySchema(db: Database) {
  db.run(`
    CREATE TABLE IF NOT EXISTS pos_floors (
      id TEXT PRIMARY KEY,
      restaurant_id TEXT NOT NULL,
      name TEXT NOT NULL,
      sort INTEGER DEFAULT 0,
      background_image_url TEXT,
      is_synced INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS pos_tables (
      id TEXT PRIMARY KEY,
      floor_id TEXT NOT NULL REFERENCES pos_floors(id),
      restaurant_id TEXT NOT NULL,
      number TEXT NOT NULL,
      label TEXT,
      shape TEXT DEFAULT 'rect',
      capacity INTEGER DEFAULT 4,
      pos_x REAL DEFAULT 0,
      pos_y REAL DEFAULT 0,
      width REAL DEFAULT 100,
      height REAL DEFAULT 80,
      status TEXT DEFAULT 'free',
      is_synced INTEGER DEFAULT 0,
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS pos_devices (
      id TEXT PRIMARY KEY,
      restaurant_id TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      pin_hash TEXT NOT NULL,
      last_seen_at TEXT,
      is_active INTEGER DEFAULT 1
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS pos_sessions (
      id TEXT PRIMARY KEY,
      restaurant_id TEXT NOT NULL,
      staff_id TEXT,
      device_id TEXT,
      opened_at TEXT NOT NULL,
      closed_at TEXT,
      opening_cash REAL DEFAULT 0,
      closing_cash_expected REAL,
      closing_cash_actual REAL,
      total_sales REAL DEFAULT 0,
      total_cash REAL DEFAULT 0,
      total_card REAL DEFAULT 0,
      total_discount REAL DEFAULT 0,
      total_comps REAL DEFAULT 0,
      status TEXT DEFAULT 'open',
      is_synced INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS pos_session_payins (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES pos_sessions(id),
      amount REAL NOT NULL,
      note TEXT,
      is_synced INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS pos_session_payouts (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES pos_sessions(id),
      amount REAL NOT NULL,
      note TEXT,
      is_synced INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS pos_seatings (
      id TEXT PRIMARY KEY,
      table_id TEXT NOT NULL REFERENCES pos_tables(id),
      restaurant_id TEXT NOT NULL,
      opened_at TEXT NOT NULL,
      closed_at TEXT,
      guests_count INTEGER DEFAULT 1,
      waiter_id TEXT,
      status TEXT DEFAULT 'open',
      is_synced INTEGER DEFAULT 0
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS pos_orders (
      id TEXT PRIMARY KEY,
      seating_id TEXT NOT NULL REFERENCES pos_seatings(id),
      restaurant_id TEXT NOT NULL,
      status TEXT DEFAULT 'open',
      subtotal REAL DEFAULT 0,
      discount_amount REAL DEFAULT 0,
      tax_amount REAL DEFAULT 0,
      total REAL DEFAULT 0,
      note TEXT,
      is_synced INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS pos_order_items (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL REFERENCES pos_orders(id),
      menu_item_id TEXT NOT NULL,
      menu_item_name TEXT NOT NULL,
      qty INTEGER DEFAULT 1,
      unit_price REAL NOT NULL,
      discount REAL DEFAULT 0,
      modifiers TEXT DEFAULT '[]',
      course INTEGER DEFAULT 1,
      status TEXT DEFAULT 'pending',
      sent_at TEXT,
      ready_at TEXT,
      served_at TEXT,
      note TEXT,
      is_synced INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS pos_payments (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL REFERENCES pos_orders(id),
      restaurant_id TEXT NOT NULL,
      method TEXT NOT NULL,
      amount REAL NOT NULL,
      tip_amount REAL DEFAULT 0,
      change_amount REAL DEFAULT 0,
      stripe_payment_intent_id TEXT,
      terminal_receipt_url TEXT,
      status TEXT DEFAULT 'pending',
      is_synced INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS pos_receipts (
      id TEXT PRIMARY KEY,
      payment_id TEXT NOT NULL REFERENCES pos_payments(id),
      restaurant_id TEXT NOT NULL,
      fiscal_number TEXT,
      fiscal_date TEXT,
      fiscal_data TEXT DEFAULT '{}',
      receipt_url TEXT,
      qr_code TEXT,
      is_synced_to_tax_authority INTEGER DEFAULT 0,
      is_synced INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS pos_menu_categories (
      id TEXT PRIMARY KEY,
      restaurant_id TEXT NOT NULL,
      name TEXT NOT NULL,
      sort INTEGER DEFAULT 0,
      color TEXT,
      icon TEXT,
      parent_id TEXT,
      is_active INTEGER DEFAULT 1,
      is_synced INTEGER DEFAULT 0
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS pos_menu_items (
      id TEXT PRIMARY KEY,
      restaurant_id TEXT NOT NULL,
      category_id TEXT NOT NULL REFERENCES pos_menu_categories(id),
      name TEXT NOT NULL,
      description TEXT,
      photo_url TEXT,
      base_price REAL NOT NULL,
      yield_g REAL,
      calories REAL,
      allergens TEXT DEFAULT '[]',
      station TEXT DEFAULT 'hot',
      flags TEXT DEFAULT '[]',
      is_available INTEGER DEFAULT 1,
      is_active INTEGER DEFAULT 1,
      sort INTEGER DEFAULT 0,
      is_synced INTEGER DEFAULT 0,
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS pos_modifier_groups (
      id TEXT PRIMARY KEY,
      menu_item_id TEXT NOT NULL REFERENCES pos_menu_items(id),
      name TEXT NOT NULL,
      required INTEGER DEFAULT 0,
      min_select INTEGER DEFAULT 0,
      max_select INTEGER DEFAULT 1,
      sort INTEGER DEFAULT 0,
      is_synced INTEGER DEFAULT 0
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS pos_modifiers (
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL REFERENCES pos_modifier_groups(id),
      name TEXT NOT NULL,
      price_delta REAL DEFAULT 0,
      sort INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      is_synced INTEGER DEFAULT 0
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS pos_ingredients (
      id TEXT PRIMARY KEY,
      restaurant_id TEXT NOT NULL,
      name TEXT NOT NULL,
      unit TEXT NOT NULL DEFAULT 'g',
      category TEXT,
      current_stock REAL DEFAULT 0,
      min_stock REAL DEFAULT 0,
      last_purchase_price REAL DEFAULT 0,
      supplier_id TEXT,
      is_synced INTEGER DEFAULT 0,
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS pos_recipes (
      id TEXT PRIMARY KEY,
      menu_item_id TEXT NOT NULL REFERENCES pos_menu_items(id),
      is_prep_item INTEGER DEFAULT 0,
      yield_g REAL,
      prep_time_min INTEGER,
      instructions TEXT,
      is_synced INTEGER DEFAULT 0
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS pos_recipe_ingredients (
      id TEXT PRIMARY KEY,
      recipe_id TEXT NOT NULL REFERENCES pos_recipes(id),
      ingredient_id TEXT NOT NULL REFERENCES pos_ingredients(id),
      amount REAL NOT NULL,
      loss_pct REAL DEFAULT 0,
      is_synced INTEGER DEFAULT 0
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS pos_stock_movements (
      id TEXT PRIMARY KEY,
      restaurant_id TEXT NOT NULL,
      ingredient_id TEXT NOT NULL REFERENCES pos_ingredients(id),
      type TEXT NOT NULL,
      qty REAL NOT NULL,
      unit_price REAL DEFAULT 0,
      batch_id TEXT,
      note TEXT,
      order_id TEXT,
      created_by TEXT,
      is_virtual_minus INTEGER DEFAULT 0,
      is_synced INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS pos_sync_queue (
      id TEXT PRIMARY KEY,
      table_name TEXT NOT NULL,
      record_id TEXT NOT NULL,
      operation TEXT NOT NULL,
      payload TEXT NOT NULL,
      attempts INTEGER DEFAULT 0,
      last_error TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_orders_seating ON pos_orders(seating_id);
    CREATE INDEX IF NOT EXISTS idx_order_items_order ON pos_order_items(order_id);
    CREATE INDEX IF NOT EXISTS idx_order_items_status ON pos_order_items(status);
    CREATE INDEX IF NOT EXISTS idx_tables_status ON pos_tables(status);
    CREATE INDEX IF NOT EXISTS idx_sync_queue_table ON pos_sync_queue(table_name);
    CREATE INDEX IF NOT EXISTS idx_payments_order ON pos_payments(order_id);
    CREATE INDEX IF NOT EXISTS idx_stock_movements_ingredient ON pos_stock_movements(ingredient_id);
  `);

  console.log("  SQLite schema applied");
}
