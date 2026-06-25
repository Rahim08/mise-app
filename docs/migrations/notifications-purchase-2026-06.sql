-- Notifications v2 (real push + owner-addressable + per-user prefs) and Purchase lists.
--
-- Контекст:
--  * notifications/push_subscriptions раньше требовали staff_id NOT NULL и FK на staff,
--    а владелец (id="owner") строки в staff не имеет → ему нельзя было адресовать
--    уведомления/push. Делаем staff_id nullable и добавляем to_owner.
--  * notification_prefs — персональные тумблеры по типам событий. Отсутствие строки =
--    всё включено (кроме показа суммы кассы). Владелец = (to_owner, staff_id NULL).
--  * purchase_items — заявки на закуп: один растущий список, сгруппированный по цеху;
--    сотрудник добавляет позиции, менеджер отмечает «куплено».
--
-- Аддитивно и идемпотентно (IF NOT EXISTS / guarded). Безопасно для продакшна.

-- ── 1. Owner-addressable notifications ──────────────────────────────────────────
ALTER TABLE notifications      ALTER COLUMN staff_id DROP NOT NULL;
ALTER TABLE notifications      ADD COLUMN IF NOT EXISTS to_owner boolean NOT NULL DEFAULT false;

ALTER TABLE push_subscriptions ALTER COLUMN staff_id DROP NOT NULL;
ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS to_owner boolean NOT NULL DEFAULT false;

-- device_token уникален сам по себе (в рамках точки) — покрывает и владельца, и сотрудника.
CREATE UNIQUE INDEX IF NOT EXISTS uq_push_device ON push_subscriptions (restaurant_id, device_token) WHERE device_token IS NOT NULL;

-- Расширяем перечень типов уведомлений (касса, закуп).
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (type IN (
  'shift_reminder', 'swap_request', 'swap_result', 'attendance',
  'task', 'general', 'trial_ending', 'cash_open', 'cash_close', 'purchase'
));

-- ── 2. Персональные настройки уведомлений ───────────────────────────────────────
-- prefs jsonb: { shift_reminder, swap, task, attendance, cash_open, cash_close,
--                purchase: boolean; show_cash_amount: boolean; purchase_digest: 'each'|'daily' }
-- Любой отсутствующий ключ трактуется как «включено» (show_cash_amount — как «выключено»).
CREATE TABLE IF NOT EXISTS notification_prefs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  staff_id uuid REFERENCES staff(id) ON DELETE CASCADE,  -- NULL = владелец
  to_owner boolean NOT NULL DEFAULT false,
  prefs jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_notifpref_staff ON notification_prefs (restaurant_id, staff_id) WHERE staff_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_notifpref_owner ON notification_prefs (restaurant_id) WHERE to_owner;

-- ── 3. Закуп (purchase lists) ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS purchase_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  category text NOT NULL DEFAULT 'general',  -- цех: kitchen|bar|hookah|household|general|<custom>
  name text NOT NULL,
  qty numeric,
  unit text,
  note text,
  status text NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'bought', 'unavailable')),
  created_by uuid REFERENCES staff(id) ON DELETE SET NULL,  -- NULL = владелец
  created_by_name text,                                     -- снимок имени для отображения
  bought_by uuid REFERENCES staff(id) ON DELETE SET NULL,
  bought_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_purchase_rest_status ON purchase_items (restaurant_id, status, created_at DESC);

-- ── 4. RLS (gateway-only, без открытых политик — как у остальных таблиц People) ──
ALTER TABLE notification_prefs ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_items     ENABLE ROW LEVEL SECURITY;
