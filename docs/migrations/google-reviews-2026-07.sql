-- =============================================================================
-- mise Google-отзывы — витрина отзывов/рейтинга с Google Maps (Places API).
-- Аддитивно, idempotent. Применять в Supabase → SQL Editor.
-- =============================================================================

ALTER TABLE restaurant_settings ADD COLUMN IF NOT EXISTS google_place_id text;
ALTER TABLE restaurant_settings ADD COLUMN IF NOT EXISTS google_places_api_key text;

CREATE TABLE IF NOT EXISTS google_reviews (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id     uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  google_review_id  text NOT NULL,          -- Places API review "name" (устойчивый id)
  author_name       text,
  author_photo_url  text,
  rating            smallint,
  review_text       text,
  relative_time     text,                   -- «2 недели назад» — как отдаёт Google, на языке отзыва
  review_time       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE google_reviews ENABLE ROW LEVEL SECURITY;
CREATE UNIQUE INDEX IF NOT EXISTS idx_google_reviews_uniq ON google_reviews (restaurant_id, google_review_id);
CREATE INDEX IF NOT EXISTS idx_google_reviews_rest_time ON google_reviews (restaurant_id, review_time DESC);

CREATE TABLE IF NOT EXISTS google_rating_snapshots (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  captured_at   timestamptz NOT NULL DEFAULT now(),
  rating        numeric(2,1),
  ratings_total integer
);

ALTER TABLE google_rating_snapshots ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_google_snapshots_rest_time ON google_rating_snapshots (restaurant_id, captured_at DESC);
