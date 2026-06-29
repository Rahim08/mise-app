-- =============================================================================
-- mise Guest notes — постоянная заметка о госте (CRM-бронирование).
-- Гость не имеет своей таблицы — агрегируется из bookings по нормализованному
-- ключу (телефон-цифры, иначе lowercase-имя). Заметка хранится по этому ключу.
-- Аддитивно, idempotent. Применять в Supabase → SQL Editor.
-- =============================================================================

CREATE TABLE IF NOT EXISTS guest_notes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  guest_key     text NOT NULL,              -- телефон-цифры или lowercase-имя
  note          text NOT NULL DEFAULT '',
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (restaurant_id, guest_key)
);

ALTER TABLE guest_notes ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_guest_notes_rest ON guest_notes (restaurant_id, guest_key);
