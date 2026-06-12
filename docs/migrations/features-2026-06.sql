-- =============================================================================
-- mise — features 2026-06 (аддитивно, idempotent, безопасно для прода)
--   • Manager: раздельный доход нал/безнал (income_card), касса считается от наличных
--   • Manager: выплата зарплаты из инкассации (inkassations.salary / salary_note)
--   • Analytics: тумблер «учитывать безнал» (restaurant_settings.include_card_in_analytics)
--   • Menu: тумблер «оплата за столом» (menu_settings.allow_pay_at_table)
-- Применять в Supabase → SQL Editor. Повторный запуск безопасен.
-- =============================================================================

-- 1. Безналичный доход смены. shifts.income остаётся НАЛИЧНЫМИ —
--    closing_balance и вся история продолжают считаться от наличных.
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS income_card numeric NOT NULL DEFAULT 0;

-- 2. Выплата зарплаты из инкассации: отметка «выплачено» + сумма,
--    итог инкассации = amount - expense - salary.
ALTER TABLE inkassations ADD COLUMN IF NOT EXISTS salary numeric NOT NULL DEFAULT 0;
ALTER TABLE inkassations ADD COLUMN IF NOT EXISTS salary_note text;

-- 3. Учитывать безнал в аналитике (по умолчанию ВЫКЛ: менеджер не видит расходов
--    по карте, поэтому безнал раздувает итог — владельцу нужны реальные показатели).
ALTER TABLE restaurant_settings ADD COLUMN IF NOT EXISTS include_card_in_analytics boolean NOT NULL DEFAULT false;

-- 4. Оплата за столом — отдельный тумблер поверх allow_orders.
ALTER TABLE menu_settings ADD COLUMN IF NOT EXISTS allow_pay_at_table boolean NOT NULL DEFAULT false;

-- 4.2. Модификаторы позиций меню: [{name, options: [{name, price}]}]
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS modifiers jsonb;

-- 5. Rate-limit PIN: счётчик неудачных попыток в БД (in-memory Map не работает на
--    Vercel — инстансы функций не делят память). key = ip:restaurant_id.
CREATE TABLE IF NOT EXISTS pin_attempts (
  key text PRIMARY KEY,
  count int NOT NULL DEFAULT 0,
  blocked_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE pin_attempts ENABLE ROW LEVEL SECURITY; -- доступ только service role

-- 6. Журнал ошибок приложения (лёгкий мониторинг без внешнего сервиса).
CREATE TABLE IF NOT EXISTS app_errors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL DEFAULT 'client',      -- client | server
  message text NOT NULL,
  stack text,
  url text,
  user_agent text,
  restaurant_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_app_errors_created ON app_errors (created_at DESC);
ALTER TABLE app_errors ENABLE ROW LEVEL SECURITY; -- доступ только service role
