-- =============================================================================
-- mise News — лента объявлений ресторана. Аддитивно, idempotent.
-- Публикуют должностные лица (owner/manager) — форсится в UI. Видят все сотрудники.
-- Типы: info (информация), stop (стоп-лист), promo (акция), update (нововведение).
-- Применять в Supabase → SQL Editor.
-- =============================================================================

CREATE TABLE IF NOT EXISTS news_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  kind          text NOT NULL DEFAULT 'info',   -- info | stop | promo | update
  title         text,
  body          text NOT NULL,
  created_by    text,
  created_by_name text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE news_posts ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_news_rest_created ON news_posts (restaurant_id, created_at DESC);
