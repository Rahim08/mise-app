-- =============================================================================
-- mise Stash — смена кальянщика (hookah shift). Аддитивно, idempotent.
-- Переиспользуем существующую таблицу hookah_sales: одна строка = вкус × количество
-- кальянов за день. Аналитика: выручка = qty × цена, расход табака = qty × порция.
-- Применять в Supabase → SQL Editor.
-- =============================================================================

-- 1. hookah_sales: дата смены + денормализованные бренд/вкус (flavor_id хрупок)
ALTER TABLE hookah_sales ADD COLUMN IF NOT EXISTS date date NOT NULL DEFAULT CURRENT_DATE;
ALTER TABLE hookah_sales ADD COLUMN IF NOT EXISTS brand text;
ALTER TABLE hookah_sales ADD COLUMN IF NOT EXISTS flavor text;
CREATE INDEX IF NOT EXISTS idx_hookah_sales_rest_date ON hookah_sales (restaurant_id, date);

-- 1.1. Бесплатные кальяны (владелец/сотрудники/комплименты): не входят в выручку,
--      но расход табака учитывается.
ALTER TABLE hookah_sales ADD COLUMN IF NOT EXISTS is_free boolean NOT NULL DEFAULT false;

-- 2. Настройки кальяна (дашборд → Настройки): цена кальяна и граммовка порции
ALTER TABLE restaurant_settings ADD COLUMN IF NOT EXISTS hookah_price numeric NOT NULL DEFAULT 0;
ALTER TABLE restaurant_settings ADD COLUMN IF NOT EXISTS hookah_portion_g numeric NOT NULL DEFAULT 20;

-- 3. RLS (доступ только через /api/db, service role в обход)
ALTER TABLE hookah_sales ENABLE ROW LEVEL SECURITY;
