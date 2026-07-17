-- Таймзона ресторана (аудит 2026-07-17, находка 7).
-- Cron считает «сегодня/сейчас HH:MM» в таймзоне точки (IANA, напр. 'Europe/Zurich').
-- Код терпит отсутствие колонки (до миграции всё считается в UTC, как раньше).
-- Применять в Supabase SQL Editor.

alter table public.restaurant_settings
  add column if not exists timezone text not null default 'UTC';
