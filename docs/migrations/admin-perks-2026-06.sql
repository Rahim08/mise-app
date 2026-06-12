-- =============================================================================
-- Админ-привилегии клиента (Super Admin → карточка клиента). Аддитивно, idempotent.
--   • comp_apps — приложения, выданные вручную ПОВЕРХ тарифа: 'stash','people','menu'
--   • discount_pct — скидка клиенту в % (пока информативно; в Stripe применяется
--     вручную купоном, автопривязка — на этапе интеграций)
-- =============================================================================
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS comp_apps text[] NOT NULL DEFAULT '{}';
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS discount_pct int NOT NULL DEFAULT 0;
