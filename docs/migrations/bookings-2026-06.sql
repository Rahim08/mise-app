-- =============================================================================
-- mise Bookings — CRM-бронирование столов. Аддитивно, idempotent.
-- Любой сотрудник создаёт бронь, все видят брони ресторана. Редактирование —
-- автор + должностные лица (owner/manager), это форсится в UI и шлюзе /api/db.
-- Применять в Supabase → SQL Editor.
-- =============================================================================

CREATE TABLE IF NOT EXISTS bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  booking_date  date NOT NULL DEFAULT CURRENT_DATE,   -- день брони (навигация по дням)
  booking_time  text,                                 -- «19:30», опционально
  guest_name    text,                                 -- все поля гостя опциональны
  guests_count  integer,
  phone         text,
  table_label   text,
  note          text,
  status        text NOT NULL DEFAULT 'new',          -- new | confirmed | cancelled
  created_by    text,                                 -- staff.id или 'owner'
  created_by_name text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_bookings_rest_date ON bookings (restaurant_id, booking_date);
