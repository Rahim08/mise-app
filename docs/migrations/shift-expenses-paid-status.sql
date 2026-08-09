-- Долги по расходам (2026-08-09): когда в кассе не хватает наличных на расход/экстру
-- сотруднику, менеджер отмечает запись "в долг" вместо того чтобы просто не вписывать её.
-- Расход остаётся в shift_expenses с реальной датой (Analytics уже считает месячный итог
-- по категориям суммированием shift_expenses.amount по датам — accrual-отчёт бесплатно,
-- без изменений в коде отчёта), но НЕ уменьшает кассу того дня, пока не оплачен.
--
-- is_paid=false — долг висит непогашенным. paid_at/paid_shift_id заполняются при погашении
-- (settleDebts) — на какую дату и в какую смену фактически ушли наличные.
-- default true — вся история остаётся «оплачено», без миграции данных.

ALTER TABLE shift_expenses
  ADD COLUMN IF NOT EXISTS is_paid boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS paid_at date,
  ADD COLUMN IF NOT EXISTS paid_shift_id uuid REFERENCES shifts(id) ON DELETE SET NULL;
