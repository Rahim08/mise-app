-- =============================================================================
-- Задолженность по ЗП + день выдачи (сессия 2026-07-28).
--   • restaurant_settings.salary_payout_day — день месяца, когда выдаётся зарплата
--     за ПРОШЛЫЙ месяц (обычно 10-15 число следующего месяца). Используется только
--     для напоминания cron'ом и группировки "срочно"/"накопление" — период начисления
--     ЗП остаётся календарным месяцем (1-1), это не меняется.
--   • salary_payments — факт выдачи ЗП конкретному сотруднику (кто, сколько, когда,
--     каким методом). Отдельно от monthly_card_amounts (это план на карту, вводится
--     вручную помесячно и не трогается) и salary_advances (авансы В ТЕЧЕНИЕ месяца).
--     "Оплачено за период" = salary_advances(период) + salary_payments(период).
-- =============================================================================

ALTER TABLE restaurant_settings ADD COLUMN IF NOT EXISTS salary_payout_day smallint;

CREATE TABLE IF NOT EXISTS salary_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES restaurants(id),
  employee_id uuid NOT NULL REFERENCES employees(id),
  period date NOT NULL,              -- первое число месяца, за который платим (YYYY-MM-01)
  amount numeric NOT NULL,
  method text NOT NULL DEFAULT 'cash', -- 'cash' | 'card'
  paid_at timestamptz NOT NULL DEFAULT now(),
  note text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS salary_payments_lookup ON salary_payments (restaurant_id, employee_id, period);
