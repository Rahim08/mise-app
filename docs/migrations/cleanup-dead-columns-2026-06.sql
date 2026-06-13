-- ============================================================================
-- Mise — cleanup of confirmed-dead columns (OPTIONAL, DESTRUCTIVE)
-- ============================================================================
--
-- ⚠️  DROP COLUMN is irreversible. Take a backup first (Supabase → Database → Backups,
--     or pg_dump). Apply only after confirming you don't rely on these columns elsewhere
--     (BI exports, Zapier, manual queries).
--
-- These columns are NOT referenced anywhere in the app code (verified 2026-06-13 against
-- the codebase) and were leftovers from abandoned POS integrations / moved features:
--
--   • menu_items.syrve_id            — dead Syrve POS integration (Italy API is gone)
--   • menu_orders.pos_system         — dead POS integration
--   • menu_orders.pos_order_id       — dead POS integration
--   • restaurant_settings.gemini_api_key — AI key now lives in env (GEMINI_API_KEY), not DB
--   • restaurant_settings.working_days   — unused; payroll uses real shift/absence data
--
-- NOTE: employees.card_amount is STILL USED by the dashboard employee form — do NOT drop it.
--       restaurant_settings.timezone is kept (plausibly useful for future scheduling).
--
-- Run in: Supabase Dashboard → SQL Editor.
-- ============================================================================

alter table public.menu_items          drop column if exists syrve_id;
alter table public.menu_orders          drop column if exists pos_system;
alter table public.menu_orders          drop column if exists pos_order_id;
alter table public.restaurant_settings  drop column if exists gemini_api_key;
alter table public.restaurant_settings  drop column if exists working_days;
