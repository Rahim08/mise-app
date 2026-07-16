-- Аудиты v1: эволюция чек-листов People (см. /Users/rahim/.claude/plans/immutable-zooming-hollerith.md).
-- Добавляет: разовые аудиты (kind='audit') поверх текущих open/close чек-листов смены,
-- назначение по роли/сотруднику/всей смене, статус прогона, гео-пруф через явку,
-- и связь нарушения с задачей (staff_tasks).
-- Формат items / items_state расширяется с плоских [String]/[Bool] на объекты
-- [{id,label,photo_required}] / [{done,photo_url}] — это делает клиент (обратная
-- совместимость на чтение), миграция данных здесь не нужна.
-- Идемпотентно. RLS у всех трёх таблиц уже включён в people-v3.sql — новых
-- политик не требуется, доступ по-прежнему только через /api/db (service_role).

ALTER TABLE shift_checklists
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'shift' CHECK (kind IN ('shift', 'audit')),
  ADD COLUMN IF NOT EXISTS assigned_staff_id UUID REFERENCES staff(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS target_scope TEXT NOT NULL DEFAULT 'role' CHECK (target_scope IN ('role', 'staff', 'venue')),
  ADD COLUMN IF NOT EXISTS title TEXT; -- отображаемое имя разового аудита (kind='audit'); у kind='shift' не используется (заголовок — type)

-- kind='shift' по-прежнему требует type IN ('open','close'); kind='audit' — разовый прогон,
-- у него нет open/close семантики, type остаётся NULL. Ослабляем NOT NULL/CHECK под это.
ALTER TABLE shift_checklists ALTER COLUMN type DROP NOT NULL;
ALTER TABLE shift_checklists DROP CONSTRAINT IF EXISTS shift_checklists_type_check;
ALTER TABLE shift_checklists ADD CONSTRAINT shift_checklists_type_check
  CHECK (type IS NULL OR type IN ('open', 'close'));

ALTER TABLE shift_checklist_completions
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'done')),
  ADD COLUMN IF NOT EXISTS requested_by UUID REFERENCES staff(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS attendance_id UUID REFERENCES attendance_records(id) ON DELETE SET NULL;

ALTER TABLE staff_tasks
  ADD COLUMN IF NOT EXISTS source_completion_id UUID REFERENCES shift_checklist_completions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_item_label TEXT,
  ADD COLUMN IF NOT EXISTS photo_url TEXT;

CREATE INDEX IF NOT EXISTS idx_checklists_kind ON shift_checklists (restaurant_id, kind);
CREATE INDEX IF NOT EXISTS idx_completions_status ON shift_checklist_completions (restaurant_id, status);
