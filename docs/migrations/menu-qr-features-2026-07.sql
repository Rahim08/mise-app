-- =============================================
-- mise QR Menu — new item fields (Phase 1: features on top of current design)
-- =============================================
-- Run manually against production (Supabase project Mise-production) before
-- deploying the app/menu/[slug] + dashboard changes that read/write these columns.
-- Safe to run multiple times (IF NOT EXISTS everywhere).

-- Strength/intensity, 1-5. NULL = not shown (e.g. drinks/food have no intensity).
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS intensity SMALLINT CHECK (intensity IS NULL OR (intensity BETWEEN 1 AND 5));

-- Manual "limited today" counter. NULL = unlimited/not tracked, no badge shown.
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS stock_left SMALLINT CHECK (stock_left IS NULL OR stock_left >= 0);

-- Per-menu toggle for the quick-actions sheet (waiter/coal/water/receipt) replacing
-- the old single "call waiter" button. Defaults on for existing menus (Business+ only,
-- gated the same way allow_orders already is in app code, not here).
ALTER TABLE menus ADD COLUMN IF NOT EXISTS quick_actions BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE menu_settings ADD COLUMN IF NOT EXISTS quick_actions BOOLEAN NOT NULL DEFAULT true;

-- =============================================
-- Phase 2: structural design + card style
-- =============================================
-- 'design' picks the whole page composition (classic/apple/elite/market/lounge/ledger),
-- separate from accent/theme/fonts which already existed. 'card_style' is only meaningful
-- for designs with card-shaped items (classic/apple/market/lounge) — shadow/outline/glass.
-- No CHECK constraint (existing text columns like theme_preset/accent_color follow the
-- same convention — validated app-side, not DB-side).
ALTER TABLE menus ADD COLUMN IF NOT EXISTS design TEXT NOT NULL DEFAULT 'classic';
ALTER TABLE menu_settings ADD COLUMN IF NOT EXISTS design TEXT NOT NULL DEFAULT 'classic';
ALTER TABLE menus ADD COLUMN IF NOT EXISTS card_style TEXT NOT NULL DEFAULT 'shadow';
ALTER TABLE menu_settings ADD COLUMN IF NOT EXISTS card_style TEXT NOT NULL DEFAULT 'shadow';
