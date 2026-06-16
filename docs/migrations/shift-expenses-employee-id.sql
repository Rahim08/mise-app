-- Экстра-выплаты сотрудникам в смене (Manager) хранятся строкой в shift_expenses
-- с employee_id. В части баз колонки нет → вставка экстры падала
-- ("Could not find the 'employee_id' column of 'shift_expenses'").
-- Безопасно (IF NOT EXISTS). После применения экстры по сотрудникам сохраняются.

ALTER TABLE shift_expenses
  ADD COLUMN IF NOT EXISTS employee_id uuid REFERENCES employees(id) ON DELETE SET NULL;
