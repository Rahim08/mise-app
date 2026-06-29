-- Закрепление категорий расходов: закреплённые показываются первыми в Аналитике
-- (в дне, неделе и месяце). Безопасно/идемпотентно.

ALTER TABLE expense_categories
  ADD COLUMN IF NOT EXISTS is_pinned boolean NOT NULL DEFAULT false;

-- Закрепить «Конверт оф.» в ресторане SO (art@smet.ch) — по запросу владельца.
UPDATE expense_categories
   SET is_pinned = true
 WHERE restaurant_id = '11f40093-1314-4cae-9105-295a83903ff2'
   AND name = 'Конверт оф.';
