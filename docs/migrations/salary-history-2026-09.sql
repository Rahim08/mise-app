-- =============================================================================
-- История окладов (2026-09-02).
--   Баг: employees.salary/deduct_per_absence — одно значение без версии. Любой пересчёт
--   зарплаты за ПРОШЛЫЙ месяц (People→Зарплата, Manager→Зарплата, Analytics, долг-леджер
--   syncLedger в manager/tabs-salary.tsx) читает ТЕКУЩЕЕ значение — правка оклада сегодня
--   задним числом меняла начисление за все прошлые месяцы и могла материализовать
--   фиктивный долг в shift_expenses (SALPERIOD-леджер, salary-debt-ledger 2026-08-20).
--
--   salary_history хранит снэпшоты оклада/вычета-за-прогул по месяцам. employees.salary
--   остаётся «текущим» значением (форма редактирования, текущий и будущие месяцы).
--   Расчёт за конкретный месяц берёт последнюю запись с effective_from <= начало месяца;
--   если истории ещё нет (сотрудник без единой правки оклада после введения фичи) —
--   fallback на employees.salary, как и было.
--
--   Пишет только dashboard/team/page.tsx (owner-only, employees.write в POLICY тоже []).
--   При первой правке оклада сотруднику сначала сохраняется СТАРОЕ значение с
--   effective_from='2000-01-01' (сентинель «действовало всегда до сих пор» — момента
--   начала старого оклада мы не знаем), потом новое — с effective_from = 1-е число
--   текущего месяца.
-- =============================================================================

CREATE TABLE IF NOT EXISTS salary_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES restaurants(id),
  employee_id uuid NOT NULL REFERENCES employees(id),
  salary numeric NOT NULL DEFAULT 0,
  deduct_per_absence numeric NOT NULL DEFAULT 0,
  effective_from date NOT NULL,     -- первое число месяца, с которого действует это значение
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS salary_history_lookup ON salary_history (restaurant_id, employee_id, effective_from DESC);
ALTER TABLE salary_history ENABLE ROW LEVEL SECURITY;
