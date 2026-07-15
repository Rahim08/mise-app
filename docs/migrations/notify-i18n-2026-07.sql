-- Уведомления на языке ПОЛУЧАТЕЛЯ, а не отправителя.
--
-- Контекст: title/body раньше рендерились через tr()/t() в момент ОТПРАВКИ, на языке
-- того, кто нажал кнопку — получатель с другим языком видел пуш/запись в журнале не на
-- своём языке (см. AUDIT-2026-07-12.md #3). Теперь /api/notify умеет рендерить текст
-- сервером по ключу+параметрам (lib/notifyStrings.ts):
--  * push — на языке КОНКРЕТНОГО УСТРОЙСТВА (push_subscriptions.lang, синкается с iOS
--    при загрузке APNs-токена — единственная платформа с реальным push);
--  * запись в notifications (веб-колокольчик People → Уведомления) — хранит key+params,
--    клиент рендерит на языке ЗРИТЕЛЯ при показе.
-- title/body остаются NOT NULL как EN-фолбэк (старые клиенты, cron, дебаг).
--
-- Аддитивно и идемпотентно. Безопасно для продакшна.

ALTER TABLE notifications      ADD COLUMN IF NOT EXISTS title_key    text;
ALTER TABLE notifications      ADD COLUMN IF NOT EXISTS title_params jsonb;
ALTER TABLE notifications      ADD COLUMN IF NOT EXISTS body_key     text;
ALTER TABLE notifications      ADD COLUMN IF NOT EXISTS body_params  jsonb;

ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS lang text;

-- Побочная находка при работе с этой таблицей: type_check не включал 'booking', 'news',
-- 'low_stock' — Notify.send для брони/новостей/остатков молча падает на вставке в журнал
-- (проверено на проде: таких строк в notifications нет вообще). Push при этом мог уходить
-- (dispatchNotification не проверяет результат insert), в колокольчике же они не появлялись.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (type IN (
  'shift_reminder', 'swap_request', 'swap_result', 'attendance',
  'task', 'general', 'trial_ending', 'cash_open', 'cash_close', 'purchase',
  'booking', 'news', 'low_stock'
));
