-- Дедупликация Stripe-вебхуков (аудит 2026-07-17, находка 9).
-- Вебхук вставляет event.id перед обработкой; конфликт PK = ретрай, отвечаем received без повторной обработки.
-- Применять в Supabase SQL Editor. Код терпит отсутствие таблицы (работает без дедупа до миграции).

create table if not exists public.stripe_events (
  event_id text primary key,
  created_at timestamptz not null default now()
);

-- Пишет только service-role (вебхук); клиентам доступа нет.
alter table public.stripe_events enable row level security;
