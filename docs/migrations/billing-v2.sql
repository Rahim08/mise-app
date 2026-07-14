-- ============================================================================
-- Биллинг v2: аддоны, места, годовая оплата, триал 14 дней без карты.
-- ПРИМЕНИТЬ В SUPABASE (SQL Editor) ДО деплоя биллинга v2 в прод.
-- Идемпотентно: можно запускать повторно.
-- ============================================================================

-- 1) Новые колонки entitlements
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS addon_modules    text[]      NOT NULL DEFAULT '{}';
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS extra_seats      int         NOT NULL DEFAULT 0;
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS addon_ai         boolean     NOT NULL DEFAULT false;
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS billing_interval text        NOT NULL DEFAULT 'month';
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS trial_ends_at    timestamptz;

-- 2) Триал без карты: каждый новый ресторан рождается с 14 днями полного Pro.
--    (Ряд создаёт DB-триггер регистрации, колонок он не указывает — работают дефолты.)
ALTER TABLE restaurants ALTER COLUMN subscription_status SET DEFAULT 'trialing';
ALTER TABLE restaurants ALTER COLUMN subscription_plan   SET DEFAULT 'pro';
ALTER TABLE restaurants ALTER COLUMN trial_ends_at       SET DEFAULT (now() + interval '14 days');
-- subscription_ends_at на время триала = trial_ends_at выставляет не дефолт,
-- а триггер ниже (дефолт-выражения не могут ссылаться на другую колонку).

CREATE OR REPLACE FUNCTION set_trial_period_end()
RETURNS trigger AS $$
BEGIN
  IF NEW.subscription_status = 'trialing' AND NEW.subscription_ends_at IS NULL THEN
    NEW.subscription_ends_at := COALESCE(NEW.trial_ends_at, now() + interval '14 days');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_set_trial_period_end ON restaurants;
CREATE TRIGGER trg_set_trial_period_end
  BEFORE INSERT ON restaurants
  FOR EACH ROW EXECUTE FUNCTION set_trial_period_end();

-- 3) device_limit больше не используется новой логикой (лимит один — «места»).
--    Колонку НЕ удаляем: её читает выпущенная iOS-сборка. Только комментарий.
COMMENT ON COLUMN restaurants.device_limit IS 'DEPRECATED (billing v2): лимит один — места (staff_limit / plan.seats + extra_seats)';

-- Проверка:
--   select column_name, column_default from information_schema.columns
--   where table_name='restaurants' and column_name in
--   ('addon_modules','extra_seats','addon_ai','billing_interval','trial_ends_at','subscription_status','subscription_plan');
