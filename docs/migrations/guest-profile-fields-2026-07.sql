-- =============================================================================
-- mise Guest profile fields — фамилия/email/дата рождения гостя (CRM-бронирование).
-- Гость виртуален (агрегируется из bookings по guest_key, см. guest-notes-2026-06.sql) —
-- эти поля живут в той же guest_notes-строке, на уровне профиля, не брони.
-- Аддитивно, idempotent. Применять в Supabase → SQL Editor.
-- =============================================================================

ALTER TABLE guest_notes ADD COLUMN IF NOT EXISTS last_name text;
ALTER TABLE guest_notes ADD COLUMN IF NOT EXISTS email     text;
ALTER TABLE guest_notes ADD COLUMN IF NOT EXISTS birthday  date;
