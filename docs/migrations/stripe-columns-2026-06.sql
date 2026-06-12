-- =============================================================================
-- Stripe-колонки в restaurants + честные дефолты подписки.
--
-- Корень бага «после оплаты Starter показывает Business активным»:
--   1) checkout/webhook пишут stripe_customer_id и subscription_id, но этих
--      колонок не существовало — запись молча падала, в БД оставались дефолты;
--   2) дефолты subscription_status='active' / subscription_plan='business'
--      давали каждому новому аккаунту полный доступ без оплаты.
-- «No subscription» при отмене — следствие: subscription_id некуда было писать.
--
-- Аддитивно, idempotent. Существующие рестораны не трогает (дефолт влияет
-- только на новые строки). Применять в Supabase → SQL Editor.
-- =============================================================================

ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS stripe_customer_id text;
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS subscription_id text;

-- Новые рестораны — без подписки, пока не оформят (раньше: business/active даром)
ALTER TABLE restaurants ALTER COLUMN subscription_status SET DEFAULT NULL;
ALTER TABLE restaurants ALTER COLUMN subscription_plan SET DEFAULT NULL;

-- ── Опционально: сбросить тестовый аккаунт, чтобы прогнать триал заново ──────
-- Подставь название тестового заведения и раскомментируй:
-- UPDATE restaurants
-- SET subscription_status = NULL, subscription_plan = NULL,
--     subscription_id = NULL, stripe_customer_id = NULL
-- WHERE name = 'НАЗВАНИЕ ТЕСТОВОГО ЗАВЕДЕНИЯ';
