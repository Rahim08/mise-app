-- Раздел «Дисциплина»: настраиваемый порог опоздания.
--
-- Пунктуальность считается из attendance_records.late_minutes (реальная задержка от
-- начала смены). Сравниваем с порогом late_grace_min: <= порога — вовремя, > — опоздание.
-- Хранение минут сырое → смена порога пересчитывает статистику ретроактивно.
--
-- v1 учитывает только опоздания. Невыходы (shift_absences) и уважительные причины —
-- отдельная задача (см. память discipline-attendance-feature).

ALTER TABLE restaurant_settings ADD COLUMN IF NOT EXISTS late_grace_min int NOT NULL DEFAULT 5;
