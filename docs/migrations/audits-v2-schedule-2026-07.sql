-- Аудиты Ф2: расписание для разовых проверок (kind='audit') + напоминание о непройденном
-- чек-листе закрытия. См. /Users/rahim/.claude/plans/immutable-zooming-hollerith.md, фаза Ф2.
-- Идемпотентно.

ALTER TABLE shift_checklists
  ADD COLUMN IF NOT EXISTS recurrence TEXT NOT NULL DEFAULT 'none' CHECK (recurrence IN ('none', 'daily', 'weekly', 'monthly')),
  ADD COLUMN IF NOT EXISTS recurrence_weekdays INT[],       -- для recurrence='weekly': 0=вс..6=сб
  ADD COLUMN IF NOT EXISTS recurrence_day_of_month INT,     -- для recurrence='monthly': 1..31
  ADD COLUMN IF NOT EXISTS recurrence_last_run DATE;        -- дедуп: когда cron последний раз завёл прогон

CREATE INDEX IF NOT EXISTS idx_checklists_recurrence ON shift_checklists (restaurant_id, recurrence) WHERE recurrence != 'none';
