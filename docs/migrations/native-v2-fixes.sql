-- native-v2: исправления для нативного приложения (Manager/Analytics/People).
-- Все операции идемпотентны (IF NOT EXISTS) — безопасно прогонять повторно.

-- Item 8: инкассация привязывается к смене по shift_id. В части баз колонки нет →
-- ManagerView.persist() падал с "column inkassations.shift_id does not exist", из-за
-- чего смена «не сохранялась» (хотя shifts.update уже прошёл и данные были в Analytics).
ALTER TABLE inkassations
  ADD COLUMN IF NOT EXISTS shift_id uuid REFERENCES shifts(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_inkassations_shift ON inkassations (shift_id);

-- Item 6: экстра-выплаты сотрудникам в смене хранятся строкой shift_expenses с employee_id
-- (дублирует docs/migrations/shift-expenses-employee-id.sql — на случай, если ещё не прогнан).
ALTER TABLE shift_expenses
  ADD COLUMN IF NOT EXISTS employee_id uuid REFERENCES employees(id) ON DELETE SET NULL;

-- Item 3: прохождение чек-листа привязывается к смене модуля Manager. Новая смена
-- (новый shift_id) → чистые галочки; история чек-листов строится по сменам.
ALTER TABLE shift_checklist_completions
  ADD COLUMN IF NOT EXISTS shift_id uuid REFERENCES shifts(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_checklist_completions_shift ON shift_checklist_completions (shift_id);

-- Item 2: заявки сотрудников (staff_reports) — добавляем тип 'order' («что заказать»)
-- к существующим breakdown/notice/suggestion/other.
ALTER TABLE staff_reports DROP CONSTRAINT IF EXISTS staff_reports_type_check;
ALTER TABLE staff_reports ADD CONSTRAINT staff_reports_type_check
  CHECK (type IN ('breakdown', 'notice', 'suggestion', 'order', 'other'));

-- Item 5: сумма «на карту» — строго помесячная. Уникальность на (restaurant_id, employee_id, month)
-- защищает от дублей и делает upsert корректным.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_monthly_card_amounts
  ON monthly_card_amounts (restaurant_id, employee_id, month);
