-- People #5: чек-листы по цехам.
-- Добавляет измерение «роль/цех» к шаблонам чек-листов открытия/закрытия.
-- role = NULL → общий чек-лист (виден всем). role = 'kitchen'|'bar'|... → виден
-- только сотрудникам этого цеха (и менеджеру/владельцу).
-- Идемпотентно. Существующие чек-листы остаются общими (role IS NULL).

ALTER TABLE shift_checklists
  ADD COLUMN IF NOT EXISTS role text;

-- Раньше предполагался один чек-лист на тип (open/close). Теперь их может быть
-- несколько на тип (по цехам), поэтому уникальность по одному type больше не нужна.
-- На случай если когда-то был такой constraint — снимаем (без ошибки, если его нет).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'shift_checklists_type_key'
  ) THEN
    ALTER TABLE shift_checklists DROP CONSTRAINT shift_checklists_type_key;
  END IF;
END $$;
