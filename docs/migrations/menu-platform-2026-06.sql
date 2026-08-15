-- =============================================================================
-- Mise Menu — платформа нового поколения (Phase 0). Аддитивно, idempotent,
-- безопасно для прода. Применять в Supabase → SQL Editor. Повторный запуск ок.
--
-- Что делает:
--   • Несколько меню на заведение  → таблица menus (slug, тема, шрифты, настройки)
--     + backfill из существующего menu_settings (одна строка = default-меню).
--   • Мультиязычный контент         → menu_categories/menu_items.i18n (jsonb)
--   • Диет-бейджи / dayparting/комбо→ menu_items.tags / schedule / type / combo_items / recommended_ids
--   • Связка с меню                 → menu_categories.menu_id, menu_items.menu_id (+ backfill)
--   • POS-готовность                → menu_orders.tip / order_type / source / synced_at / pos_order_id / menu_id
--   • Аналитика                     → таблица menu_events
--
-- menu_settings НЕ удаляем: код переходит на menus постепенно, строка остаётся
-- как источник для backfill и совместимости. Дроп — отдельной миграцией позже.
-- =============================================================================

-- 1. ── Таблица menus ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS menus (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  name          text NOT NULL DEFAULT 'Menu',          -- название меню (Еда / Бар / Винная карта)
  slug          text UNIQUE,                            -- публичный адрес /menu/<slug> (глобально уникален)
  is_published  boolean NOT NULL DEFAULT false,
  is_default    boolean NOT NULL DEFAULT false,         -- одно меню — дефолтное для заведения
  position      integer NOT NULL DEFAULT 0,
  -- внешний вид
  theme         text NOT NULL DEFAULT 'light',          -- light | dark | auto
  layout        text NOT NULL DEFAULT 'list',           -- list | grid
  accent_color  text NOT NULL DEFAULT '#007aff',
  font_heading  text,                                   -- курируемый шрифт заголовков
  font_body     text,                                   -- курируемый шрифт текста
  theme_preset  text,                                   -- minimal | bistro | darklux | street | cafe | custom
  radius        integer,                                -- скругление карточек, px
  cover_url     text,
  -- отображение
  show_photos        boolean NOT NULL DEFAULT true,
  show_calories      boolean NOT NULL DEFAULT false,
  show_allergens     boolean NOT NULL DEFAULT false,
  allow_orders       boolean NOT NULL DEFAULT false,
  allow_pay_at_table boolean NOT NULL DEFAULT false,
  allow_tips         boolean NOT NULL DEFAULT false,
  upsell_category_id uuid,                              -- категория для апселла в корзине
  language      text NOT NULL DEFAULT 'ru',             -- язык контента по умолчанию
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE menus ENABLE ROW LEVEL SECURITY;            -- доступ только service role (gateway/публичный endpoint)
CREATE INDEX IF NOT EXISTS idx_menus_restaurant ON menus (restaurant_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_menus_default ON menus (restaurant_id) WHERE is_default;

-- 1.2 Backfill: одно menus-меню на каждый существующий menu_settings.
--     ON CONFLICT по slug — повторный запуск не плодит дубли.
INSERT INTO menus (
  restaurant_id, name, slug, is_published, is_default, position,
  theme, layout, accent_color, cover_url,
  show_photos, show_calories, show_allergens, allow_orders, allow_pay_at_table, language
)
SELECT
  ms.restaurant_id, 'Menu', ms.slug, COALESCE(ms.is_published, false), true, 0,
  COALESCE(ms.theme, 'light'), COALESCE(ms.layout, 'list'), COALESCE(ms.accent_color, '#007aff'), ms.cover_url,
  COALESCE(ms.show_photos, true), COALESCE(ms.show_calories, false), COALESCE(ms.show_allergens, false),
  COALESCE(ms.allow_orders, false), COALESCE(ms.allow_pay_at_table, false), COALESCE(ms.language, 'ru')
FROM menu_settings ms
WHERE ms.slug IS NOT NULL
ON CONFLICT (slug) DO NOTHING;

-- 2. ── menu_categories: связка с меню, мультиязык, подкатегории ──────────────
ALTER TABLE menu_categories ADD COLUMN IF NOT EXISTS menu_id   uuid;
ALTER TABLE menu_categories ADD COLUMN IF NOT EXISTS i18n      jsonb;  -- { name: {ru,en,..}, description: {..} }
ALTER TABLE menu_categories ADD COLUMN IF NOT EXISTS parent_id uuid;   -- подкатегории (опционально)
CREATE INDEX IF NOT EXISTS idx_menu_categories_menu ON menu_categories (menu_id);

-- 3. ── menu_items: связка с меню, мультиязык, бейджи, dayparting, комбо ──────
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS menu_id         uuid;
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS i18n            jsonb;  -- { name: {..}, description: {..} }
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS tags            jsonb;  -- ["vegan","spicy","new",...]
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS schedule        jsonb;  -- { days:[1..7], from:"08:00", to:"12:00" }
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS type            text NOT NULL DEFAULT 'dish'; -- dish | combo
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS combo_items     jsonb;  -- [{item_id, qty}]
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS recommended_ids jsonb;  -- ["item_id", ...] апселл
CREATE INDEX IF NOT EXISTS idx_menu_items_menu ON menu_items (menu_id);

-- 4. ── Backfill menu_id из default-меню заведения ───────────────────────────
UPDATE menu_categories c
SET menu_id = m.id
FROM menus m
WHERE m.restaurant_id = c.restaurant_id AND m.is_default AND c.menu_id IS NULL;

UPDATE menu_items i
SET menu_id = m.id
FROM menus m
WHERE m.restaurant_id = i.restaurant_id AND m.is_default AND i.menu_id IS NULL;

-- 5. ── menu_orders: POS-готовность ──────────────────────────────────────────
ALTER TABLE menu_orders ADD COLUMN IF NOT EXISTS tip         numeric NOT NULL DEFAULT 0;
ALTER TABLE menu_orders ADD COLUMN IF NOT EXISTS order_type  text NOT NULL DEFAULT 'dine_in'; -- dine_in | pickup
ALTER TABLE menu_orders ADD COLUMN IF NOT EXISTS source      text NOT NULL DEFAULT 'qr';      -- qr | ...
ALTER TABLE menu_orders ADD COLUMN IF NOT EXISTS synced_at   timestamptz;                     -- когда ушёл в Mise POS
ALTER TABLE menu_orders ADD COLUMN IF NOT EXISTS pos_order_id text;                           -- id заказа в POS
ALTER TABLE menu_orders ADD COLUMN IF NOT EXISTS menu_id     uuid;                            -- из какого меню заказ

-- 6. ── Таблица menu_events (аналитика) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS menu_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  menu_id       uuid,
  type          text NOT NULL,        -- view | item_view | add_to_cart | checkout_click (было 'order' — переименовано, аудит 2026-08-15 block-E #9)
  item_id       uuid,
  session_id    text,                 -- анонимный id сессии гостя
  table_number  text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE menu_events ENABLE ROW LEVEL SECURITY;       -- запись через service-role /api/menu/event, чтение — owner gateway
CREATE INDEX IF NOT EXISTS idx_menu_events_rest_created ON menu_events (restaurant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_menu_events_item ON menu_events (item_id);
