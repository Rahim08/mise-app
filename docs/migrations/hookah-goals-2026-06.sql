-- =============================================================================
-- mise KPI — цели по кальянам (геймификация). Аддитивно, idempotent.
-- Цель = суммарное количество кальянов выбранных видов (hookah_types) за календарный
-- месяц. Прогресс = сумма ПЛАТНЫХ продаж (is_free=false) этих видов за месяц.
-- Ставит руководство (owner/manager) — write гейтится UI + POLICY. Видят все (stash).
-- Применять в Supabase → SQL Editor.
-- =============================================================================

CREATE TABLE IF NOT EXISTS hookah_goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  title       text,
  type_ids    uuid[] NOT NULL DEFAULT '{}',   -- выбранные виды кальянов
  target_qty  integer NOT NULL DEFAULT 0,
  month       text NOT NULL,                  -- 'YYYY-MM'
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE hookah_goals ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_hookah_goals_rest_month ON hookah_goals (restaurant_id, month);
