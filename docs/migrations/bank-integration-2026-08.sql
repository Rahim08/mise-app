-- =============================================================================
-- Банк-интеграция (Open Banking, Enable Banking — GoCardless Bank Account Data закрыл
-- новые регистрации 2026-08-16) — владелец подключает бизнес-счёт (сперва тестовый
-- Revolut юзера, дальше разные банки под заведение, напр. Banco Popolare di Sondrio для
-- итальянских клиентов), в Analytics появляется вкладка «Банк»: баланс + лента операций
-- за 90 дней, синк раз в сутки cron'ом + ручная кнопка «Обновить».
-- MVP: один активный счёт на ресторан, read-only (без payment initiation).
--
-- Пишет только сервер (app/api/bank/*, app/api/cron/bank-sync) через service-role —
-- клиент читает через общий шлюз /api/db (POLICY: write: []), как google_reviews.
--
-- Идемпотентно. Применять в Supabase → SQL Editor.
-- =============================================================================

CREATE TABLE IF NOT EXISTS bank_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'gocardless',
  institution_id text,
  institution_name text,
  requisition_id text,
  account_id text,
  status text NOT NULL DEFAULT 'pending', -- pending | linked | expired | error
  error_message text,
  balance numeric,
  balance_currency text,
  balance_synced_at timestamptz,
  consent_created_at timestamptz,
  consent_expires_at timestamptz,
  last_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bank_connections_restaurant ON bank_connections (restaurant_id);
ALTER TABLE bank_connections ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS bank_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  connection_id uuid NOT NULL REFERENCES bank_connections(id) ON DELETE CASCADE,
  external_id text NOT NULL,
  booking_date date,
  amount numeric NOT NULL,
  currency text,
  description text,
  counterparty text,
  raw jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (connection_id, external_id)
);
CREATE INDEX IF NOT EXISTS idx_bank_transactions_restaurant_date
  ON bank_transactions (restaurant_id, booking_date DESC);
ALTER TABLE bank_transactions ENABLE ROW LEVEL SECURITY;
