-- КОРЕНЬ бага «смена пропадает / суммы складываются (50+40)»:
-- shifts.date — тип timestamp/timestamptz, поэтому точное сравнение по дню
-- (date = '2026-06-16') не находит строку → и веб, и приложение создают дубли смен
-- на одну дату, а аналитика их суммирует.
--
-- Фикс (чинит обе платформы без правки кода):
--   1) схлопнуть существующие дубли на (restaurant_id, день), оставив смену с макс. данными;
--   2) привести date к типу date;
--   3) UNIQUE (restaurant_id, date) — дубли больше не появятся.
--
-- ⚠️ Сделайте бэкап перед запуском. Запускать целиком (транзакция).

BEGIN;

WITH ranked AS (
  SELECT id, restaurant_id, (date::date) AS d,
         row_number() OVER (
           PARTITION BY restaurant_id, (date::date)
           ORDER BY (COALESCE(income,0) + COALESCE(total_expense,0) + COALESCE(inkassation,0)) DESC,
                    created_at ASC
         ) AS rn
  FROM shifts
),
keep AS (SELECT id, restaurant_id, d FROM ranked WHERE rn = 1),
dupes AS (
  SELECT r.id AS dup_id, k.id AS keep_id
  FROM ranked r
  JOIN keep k ON k.restaurant_id = r.restaurant_id AND k.d = r.d
  WHERE r.rn > 1
),
up_exp AS (UPDATE shift_expenses se SET shift_id = d.keep_id FROM dupes d WHERE se.shift_id = d.dup_id RETURNING 1),
up_ink AS (UPDATE inkassations i SET shift_id = d.keep_id FROM dupes d WHERE i.shift_id = d.dup_id RETURNING 1),
up_abs AS (UPDATE shift_absences a SET shift_id = d.keep_id FROM dupes d WHERE a.shift_id = d.dup_id RETURNING 1),
up_chk AS (UPDATE shift_checklist_completions c SET shift_id = d.keep_id FROM dupes d WHERE c.shift_id = d.dup_id RETURNING 1)
DELETE FROM shifts WHERE id IN (SELECT dup_id FROM dupes);

-- привести к чистой дате (если уже date — USING безвреден)
ALTER TABLE shifts ALTER COLUMN date TYPE date USING date::date;

-- запретить будущие дубли смен на одну дату
CREATE UNIQUE INDEX IF NOT EXISTS uniq_shifts_rest_date ON shifts (restaurant_id, date);

COMMIT;
