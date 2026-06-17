-- =============================================================================
-- Fix duplicate shifts (one row per restaurant per day) + prevent recurrence.
-- ⚠️ Make a backup first. Review step 1 output before running steps 2–4.
-- The app already tolerates duplicates (loads one), but analytics sums them, so
-- duplicates must be cleaned and a unique constraint added.
-- =============================================================================

-- 1. INSPECT — see which days have duplicates and how much data each row holds.
SELECT restaurant_id, date, count(*) AS rows,
       array_agg(id ORDER BY opened_at) AS shift_ids,
       array_agg(income ORDER BY opened_at) AS incomes
FROM shifts
GROUP BY restaurant_id, date
HAVING count(*) > 1
ORDER BY date DESC;

-- 2. Pick the row to KEEP per (restaurant_id, date): the one with the most financial
--    data (income + expense + inkassation), tie-break by earliest created.
--    Children (shift_expenses / shift_absences / inkassations) of the REMOVED rows are
--    deleted with them. Verify in step 1 that the kept rows hold the correct numbers.
WITH ranked AS (
  SELECT id, restaurant_id, date,
         row_number() OVER (
           PARTITION BY restaurant_id, date
           ORDER BY (coalesce(income,0) + coalesce(total_expense,0) + coalesce(inkassation,0)) DESC,
                    opened_at ASC
         ) AS rn
  FROM shifts
),
dupes AS (SELECT id FROM ranked WHERE rn > 1)
-- 3. Remove children of duplicate shifts, then the duplicates themselves.
, del_exp AS (DELETE FROM shift_expenses WHERE shift_id IN (SELECT id FROM dupes) RETURNING 1)
, del_abs AS (DELETE FROM shift_absences WHERE shift_id IN (SELECT id FROM dupes) RETURNING 1)
, del_ink AS (DELETE FROM inkassations  WHERE shift_id IN (SELECT id FROM dupes) RETURNING 1)
DELETE FROM shifts WHERE id IN (SELECT id FROM dupes);

-- 4. Prevent recurrence.
ALTER TABLE shifts DROP CONSTRAINT IF EXISTS shifts_restaurant_date_unique;
ALTER TABLE shifts ADD  CONSTRAINT shifts_restaurant_date_unique UNIQUE (restaurant_id, date);
