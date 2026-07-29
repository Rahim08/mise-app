-- =============================================================================
-- «Восьмёрка» (обход-восьмёрка, HoReCa floor-walk) — kind='walk' поверх
-- shift_checklists/shift_checklist_completions. Переиспользует role/target_scope/
-- assigned_staff_id/RLS/гейт через /api/db — отдельных таблиц не заводим.
--
-- items хранит ВЛОЖЕННОЕ дерево (блок → категория → пункт) вместо плоского списка
-- у kind='audit'/'shift' — парсится клиентом по kind, миграции данных не требуется:
--   [{ "id","label", "categories":[{ "id","label", "items":[{"id","label"}] }] }]
--
-- target_scope переиспользуется как есть: 'staff' (assigned_staff_id=self) — личный
-- шаблон сотрудника; 'role' (role=должность) — назначил владелец/менеджер под цех,
-- сам сотрудник этой должности только запускает, не редактирует (гейтится в UI).
--
-- Идемпотентно. Применять в Supabase → SQL Editor.
-- =============================================================================

DO $$
DECLARE
  cname text;
BEGIN
  SELECT conname INTO cname FROM pg_constraint
  WHERE conrelid = 'shift_checklists'::regclass AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%kind%';
  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE shift_checklists DROP CONSTRAINT %I', cname);
  END IF;
END $$;

ALTER TABLE shift_checklists ADD CONSTRAINT shift_checklists_kind_check
  CHECK (kind IN ('shift', 'audit', 'walk'));

-- 'pause' — таймер стоит между блоками (общее время = сумма активных блоков, по умолчанию);
-- 'continuous' — идёт без остановки с общего старта. Задаётся при создании шаблона, актуально
-- только для kind='walk'.
ALTER TABLE shift_checklists
  ADD COLUMN IF NOT EXISTS walk_pause_mode TEXT NOT NULL DEFAULT 'pause'
    CHECK (walk_pause_mode IN ('pause', 'continuous'));

-- Итоги прогона восьмёрки (kind='walk' у связанного checklist_id) — суммарное активное
-- время (без пауз) и шаги за весь обход (CMPedometer). NULL у обычных kind='audit'/'shift'.
ALTER TABLE shift_checklist_completions
  ADD COLUMN IF NOT EXISTS duration_seconds INT,
  ADD COLUMN IF NOT EXISTS steps INT;

CREATE INDEX IF NOT EXISTS idx_checklists_walk ON shift_checklists (restaurant_id, kind) WHERE kind = 'walk';
