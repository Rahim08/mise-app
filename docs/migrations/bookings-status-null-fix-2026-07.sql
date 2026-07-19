-- =============================================================================
-- Фикс: bookings.status NOT NULL DEFAULT 'new', но клиент (все версии до фикса
-- в BookingsView.swift, 2026-07-19) явно шлёт status = NULL на новой брони —
-- DEFAULT игнорируется, insert падает на NOT NULL constraint, ошибка глотается
-- клиентским `try?`, а пуш «Новая бронь» уходит независимо от результата.
-- Итог: брони «создаются» визуально (юзер видит пуш), но не попадают в БД.
--
-- Триггер подставляет 'new' вместо NULL до записи — чинит уже установленные
-- версии приложения немедленно, без нового билда/App Store. Не отменяет
-- клиентский фикс (тот просто перестаёт слать NULL явно) — оба варианта
-- сходятся к одному результату.
-- Применять в Supabase → SQL Editor.
-- =============================================================================

CREATE OR REPLACE FUNCTION bookings_default_status() RETURNS trigger AS $$
BEGIN
  IF NEW.status IS NULL THEN
    NEW.status := 'new';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_bookings_default_status ON bookings;
CREATE TRIGGER trg_bookings_default_status
  BEFORE INSERT OR UPDATE ON bookings
  FOR EACH ROW EXECUTE FUNCTION bookings_default_status();
