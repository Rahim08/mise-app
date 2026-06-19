-- Mise POS — Supabase migration
-- Run in Supabase SQL Editor
-- Prefix: pos_ (all tables isolated from existing Mise tables)

-- ── Floors & Tables ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS pos_floors (
  id TEXT PRIMARY KEY,
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort INTEGER DEFAULT 0,
  background_image_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pos_tables (
  id TEXT PRIMARY KEY,
  floor_id TEXT NOT NULL REFERENCES pos_floors(id) ON DELETE CASCADE,
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  number TEXT NOT NULL,
  label TEXT,
  shape TEXT DEFAULT 'rect' CHECK (shape IN ('rect', 'round', 'square')),
  capacity INTEGER DEFAULT 4,
  pos_x FLOAT DEFAULT 0,
  pos_y FLOAT DEFAULT 0,
  width FLOAT DEFAULT 100,
  height FLOAT DEFAULT 80,
  status TEXT DEFAULT 'free' CHECK (status IN ('free','occupied','bill-requested','reserved','blocked')),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Devices ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS pos_devices (
  id TEXT PRIMARY KEY,
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('cashier','waiter','kitchen','manager','owner')),
  pin_hash TEXT NOT NULL,
  last_seen_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Cash Sessions ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS pos_sessions (
  id TEXT PRIMARY KEY,
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  staff_id UUID REFERENCES auth.users(id),
  device_id TEXT REFERENCES pos_devices(id),
  opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ,
  opening_cash DECIMAL(10,2) DEFAULT 0,
  closing_cash_expected DECIMAL(10,2),
  closing_cash_actual DECIMAL(10,2),
  total_sales DECIMAL(10,2) DEFAULT 0,
  total_cash DECIMAL(10,2) DEFAULT 0,
  total_card DECIMAL(10,2) DEFAULT 0,
  total_discount DECIMAL(10,2) DEFAULT 0,
  total_comps DECIMAL(10,2) DEFAULT 0,
  status TEXT DEFAULT 'open' CHECK (status IN ('open','closed'))
);

CREATE TABLE IF NOT EXISTS pos_session_payins (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES pos_sessions(id),
  amount DECIMAL(10,2) NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pos_session_payouts (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES pos_sessions(id),
  amount DECIMAL(10,2) NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Seatings & Orders ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS pos_seatings (
  id TEXT PRIMARY KEY,
  table_id TEXT NOT NULL REFERENCES pos_tables(id),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ,
  guests_count INTEGER DEFAULT 1,
  waiter_id TEXT,
  status TEXT DEFAULT 'open' CHECK (status IN ('open','bill-requested','closed')),
  is_synced BOOLEAN DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS pos_orders (
  id TEXT PRIMARY KEY,
  seating_id TEXT NOT NULL REFERENCES pos_seatings(id),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  status TEXT DEFAULT 'open' CHECK (status IN ('open','kitchen','ready','paid','cancelled','voided')),
  subtotal DECIMAL(10,2) DEFAULT 0,
  discount_amount DECIMAL(10,2) DEFAULT 0,
  tax_amount DECIMAL(10,2) DEFAULT 0,
  total DECIMAL(10,2) DEFAULT 0,
  note TEXT,
  is_synced BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pos_order_items (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES pos_orders(id) ON DELETE CASCADE,
  menu_item_id TEXT NOT NULL,
  menu_item_name TEXT NOT NULL,
  qty INTEGER DEFAULT 1 CHECK (qty > 0),
  unit_price DECIMAL(10,2) NOT NULL,
  discount DECIMAL(10,2) DEFAULT 0,
  modifiers JSONB DEFAULT '[]',
  course INTEGER DEFAULT 1,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending','sent','cooking','ready','served','cancelled')),
  sent_at TIMESTAMPTZ,
  ready_at TIMESTAMPTZ,
  served_at TIMESTAMPTZ,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Payments & Receipts ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS pos_payments (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES pos_orders(id),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  method TEXT NOT NULL CHECK (method IN ('cash','card','mixed','voucher','transfer')),
  amount DECIMAL(10,2) NOT NULL,
  tip_amount DECIMAL(10,2) DEFAULT 0,
  change_amount DECIMAL(10,2) DEFAULT 0,
  stripe_payment_intent_id TEXT,
  terminal_receipt_url TEXT,
  status TEXT DEFAULT 'completed' CHECK (status IN ('pending','completed','refunded','failed')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pos_receipts (
  id TEXT PRIMARY KEY,
  payment_id TEXT NOT NULL REFERENCES pos_payments(id),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  fiscal_number TEXT,
  fiscal_date TIMESTAMPTZ,
  fiscal_data JSONB DEFAULT '{}',
  receipt_url TEXT,
  qr_code TEXT,
  is_synced_to_tax_authority BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Menu ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS pos_menu_categories (
  id TEXT PRIMARY KEY,
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  name JSONB NOT NULL DEFAULT '{"ru":"Категория"}',
  sort INTEGER DEFAULT 0,
  color TEXT,
  icon TEXT,
  parent_id TEXT REFERENCES pos_menu_categories(id),
  is_active BOOLEAN DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS pos_menu_items (
  id TEXT PRIMARY KEY,
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  category_id TEXT NOT NULL REFERENCES pos_menu_categories(id),
  name JSONB NOT NULL DEFAULT '{"ru":"Блюдо"}',
  description JSONB,
  photo_url TEXT,
  base_price DECIMAL(10,2) NOT NULL,
  yield_g DECIMAL(8,2),
  calories DECIMAL(8,2),
  allergens TEXT[] DEFAULT '{}',
  station TEXT DEFAULT 'hot' CHECK (station IN ('hot','cold','bar','dessert','all')),
  flags TEXT[] DEFAULT '{}',
  is_available BOOLEAN DEFAULT TRUE,
  is_active BOOLEAN DEFAULT TRUE,
  sort INTEGER DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pos_modifier_groups (
  id TEXT PRIMARY KEY,
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  menu_item_id TEXT NOT NULL REFERENCES pos_menu_items(id) ON DELETE CASCADE,
  name JSONB NOT NULL DEFAULT '{"ru":"Модификатор"}',
  required BOOLEAN DEFAULT FALSE,
  min_select INTEGER DEFAULT 0,
  max_select INTEGER DEFAULT 1,
  sort INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS pos_modifiers (
  id TEXT PRIMARY KEY,
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  group_id TEXT NOT NULL REFERENCES pos_modifier_groups(id) ON DELETE CASCADE,
  name JSONB NOT NULL DEFAULT '{"ru":"Опция"}',
  price_delta DECIMAL(8,2) DEFAULT 0,
  sort INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS pos_price_lists (
  id TEXT PRIMARY KEY,
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  schedule JSONB,
  is_default BOOLEAN DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS pos_price_list_items (
  id TEXT PRIMARY KEY,
  price_list_id TEXT NOT NULL REFERENCES pos_price_lists(id) ON DELETE CASCADE,
  menu_item_id TEXT NOT NULL REFERENCES pos_menu_items(id) ON DELETE CASCADE,
  price DECIMAL(10,2) NOT NULL,
  UNIQUE(price_list_id, menu_item_id)
);

-- ── Inventory & Recipes ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS pos_ingredients (
  id TEXT PRIMARY KEY,
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT 'g' CHECK (unit IN ('g','ml','pcs','kg','l','pack')),
  category TEXT,
  current_stock DECIMAL(10,3) DEFAULT 0,
  min_stock DECIMAL(10,3) DEFAULT 0,
  last_purchase_price DECIMAL(10,2) DEFAULT 0,
  supplier_id TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pos_recipes (
  id TEXT PRIMARY KEY,
  menu_item_id TEXT NOT NULL REFERENCES pos_menu_items(id) ON DELETE CASCADE,
  is_prep_item BOOLEAN DEFAULT FALSE,
  yield_g DECIMAL(8,2),
  prep_time_min INTEGER,
  instructions TEXT
);

CREATE TABLE IF NOT EXISTS pos_recipe_ingredients (
  id TEXT PRIMARY KEY,
  recipe_id TEXT NOT NULL REFERENCES pos_recipes(id) ON DELETE CASCADE,
  ingredient_id TEXT NOT NULL REFERENCES pos_ingredients(id),
  amount DECIMAL(10,3) NOT NULL,
  loss_pct DECIMAL(5,2) DEFAULT 0
);

CREATE TABLE IF NOT EXISTS pos_stock_movements (
  id TEXT PRIMARY KEY,
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  ingredient_id TEXT NOT NULL REFERENCES pos_ingredients(id),
  type TEXT NOT NULL CHECK (type IN ('purchase','issue','write-off','count','sale-deduction','transfer')),
  qty DECIMAL(10,3) NOT NULL,
  unit_price DECIMAL(10,2) DEFAULT 0,
  batch_id TEXT,
  note TEXT,
  order_id TEXT REFERENCES pos_orders(id),
  created_by UUID REFERENCES auth.users(id),
  is_virtual_minus BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pos_suppliers (
  id TEXT PRIMARY KEY,
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  contact TEXT,
  email TEXT,
  phone TEXT,
  notes TEXT
);

-- ── Indexes ───────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_pos_orders_seating ON pos_orders(seating_id);
CREATE INDEX IF NOT EXISTS idx_pos_order_items_order ON pos_order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_pos_order_items_status ON pos_order_items(status);
CREATE INDEX IF NOT EXISTS idx_pos_tables_restaurant ON pos_tables(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_pos_payments_order ON pos_payments(order_id);
CREATE INDEX IF NOT EXISTS idx_pos_stock_movements_ingredient ON pos_stock_movements(ingredient_id);
CREATE INDEX IF NOT EXISTS idx_pos_stock_movements_restaurant ON pos_stock_movements(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_pos_menu_items_category ON pos_menu_items(category_id);
CREATE INDEX IF NOT EXISTS idx_pos_seatings_table ON pos_seatings(table_id);

-- ── RLS (Row Level Security) ──────────────────────────────────────────────

ALTER TABLE pos_floors ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos_tables ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos_seatings ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos_menu_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos_menu_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos_ingredients ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos_stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos_sessions ENABLE ROW LEVEL SECURITY;

-- Service role bypasses RLS (used by master server)
-- Owner access policy (via existing auth)
CREATE POLICY "owner_all" ON pos_orders
  FOR ALL USING (
    restaurant_id IN (
      SELECT id FROM restaurants WHERE owner_id = auth.uid()
    )
  );

-- (Repeat similar policies for other tables as needed)
