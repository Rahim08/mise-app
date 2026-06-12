# Опс: Stripe-прогон, мониторинг, бэкапы

## Stripe end-to-end чек-лист (test mode, ~10 мин)

Код проверен и починен в этой сессии: авторизация владельца на checkout/cancel,
`customer.subscription.updated`, fallback для `invoice.subscription` (новый API).
Осталось прогнать руками в test mode:

1. Stripe Dashboard → Test mode. Проверь, что `STRIPE_SECRET_KEY` (test) и
   `STRIPE_WEBHOOK_SECRET` в Vercel указывают на test-режим, а вебхук
   `https://mise-app-omega.vercel.app/api/stripe/webhook` подписан на события:
   `checkout.session.completed`, `invoice.payment_succeeded`, `invoice.payment_failed`,
   `customer.subscription.updated`, `customer.subscription.deleted`.
2. **Checkout:** дашборд → Подписка → выбрать план → карта `4242 4242 4242 4242`
   → после редиректа статус = trialing/active, план обновился.
3. **Смена плана:** в Stripe → Subscriptions → Update → другой price
   (metadata.plan надо поменять руками или через новый checkout) → статус остался active.
4. **past_due:** Subscriptions → выбрать подписку → карта `4000 0000 0000 0341`
   (fail) → создать invoice → статус в дашборде = past_due, AI и Stash залочены.
5. **Отмена:** дашборд → Отменить подписку → статус canceling; в Stripe — Cancel now
   → статус canceled, приложения залочены по плану.
6. **Удаление аккаунта:** /api/account/delete отменяет подписку — проверить на тестовом аккаунте.

## Мониторинг ошибок (без Sentry)

- Клиентские ошибки (`window.onerror`, unhandled promise) шлются в `POST /api/log`
  → таблица `app_errors` (RLS, только service role).
- Смотреть: Supabase → Table Editor → `app_errors` (новые сверху).
  Чистка: `delete from app_errors where created_at < now() - interval '30 days'`.
- Когда появится бюджет — заменить на Sentry (`npx @sentry/wizard@latest -i nextjs`),
  endpoint и таблицу можно будет убрать.

## Бэкапы БД (Supabase)

- **Платный план Supabase (Pro $25)**: ежедневные автобэкапы 7 дней — включаются сами.
- **Free план**: автобэкапов НЕТ. Минимум раз в неделю руками:
  Dashboard → Database → Backups → или `pg_dump` по connection string
  (Settings → Database → Connection string):
  `pg_dump "<CONNECTION_STRING>" > mise-backup-$(date +%F).sql`
- Перед применением любых миграций — бэкап обязателен (правило из CLAUDE CONTEXT §6).
