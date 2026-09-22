-- =============================================================================
-- Поступления в инкассацию (2026-09-21).
--   Владелец вносит деньги в баланс инкассации (дата задним числом, сумма, причина).
--   Касса (наличные/карта смены) НЕ затрагивается: строки живут в отдельной таблице и
--   не участвуют ни в shifts.*, ни в inkassations.*, ни в выручке/прибыли.
--   Баланс инкассации = валовая инкассация по сменам − (расход + ЗП) + сумма поступлений.
--
--   Пишет только Manager (POLICY в app/api/db/route.ts), Analytics читает.
--   Удаление физическое: полный «до»-образ строки остаётся в financial_audit_log
--   (DB-триггер + api-слой), поэтому soft-delete не нужен и не надо помнить про
--   фильтр deleted_at во всех местах, где считается баланс.
--
--   Применить ДО деплоя кода.
-- =============================================================================

CREATE TABLE IF NOT EXISTS inkassation_topups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES restaurants(id),
  date date NOT NULL,
  amount numeric NOT NULL CHECK (amount > 0),
  reason text NOT NULL CHECK (length(btrim(reason)) > 0 AND length(reason) <= 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  -- защита от клиента в обход UI: не в будущем (+1 день на часовые пояса)
  CONSTRAINT inkassation_topups_date_not_future CHECK (date <= current_date + 1)
);
CREATE INDEX IF NOT EXISTS inkassation_topups_lookup ON inkassation_topups (restaurant_id, date);

-- RLS включён без политик: доступ только через /api/db (service-role), как у остальных денежных таблиц.
ALTER TABLE inkassation_topups ENABLE ROW LEVEL SECURITY;

-- Аудит-триггер (тот же, что на shifts/inkassations, см. financial-audit-v2-2026-09-19.sql).
DROP TRIGGER IF EXISTS trg_audit_inkassation_topups ON inkassation_topups;
CREATE TRIGGER trg_audit_inkassation_topups
  AFTER INSERT OR UPDATE OR DELETE ON inkassation_topups
  FOR EACH ROW EXECUTE FUNCTION log_financial_change();
