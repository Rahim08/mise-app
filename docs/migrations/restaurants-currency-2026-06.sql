-- =============================================================================
-- restaurants.currency — дашборд, меню, аналитика и People читают валюту из
-- restaurants, но колонка существовала только в restaurant_settings.
-- Симптом: «Could not find the 'currency' column of 'restaurants' in the
-- schema cache» при сохранении настроек. Аддитивно, idempotent.
-- Применять в Supabase → SQL Editor.
-- =============================================================================

ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT '€';

-- Перенос значения из restaurant_settings, если валюту там уже меняли
UPDATE restaurants r
SET currency = rs.currency
FROM restaurant_settings rs
WHERE rs.restaurant_id = r.id
  AND rs.currency IS NOT NULL
  AND rs.currency <> '€';
