# Mise — модель безопасности данных

## Проблема (было)
RLS отключён, браузер читает/пишет бизнес-данные напрямую anon-ключом по `restaurant_id`.
Зная `restaurant_id` (он в QR/URL/cookie), любой мог прочитать и изменить данные **любого**
ресторана. PIN защищал только UI.

## Решение (модель «server endpoints + token»)
1. **Токен сотрудника** (`lib/staffToken.ts`). При верном PIN сервер выдаёт подписанный
   httpOnly-cookie `mise_staff_token` (HMAC-SHA256), привязанный к `restaurant_id`,
   сотруднику и его приложениям. Самоназначить нельзя.
2. **Шлюз данных** (`app/api/db/route.ts`). Все запросы приложения идут сюда. Сервер
   проверяет токен (или owner-сессию Supabase), форсит `restaurant_id` и проверяет права
   по приложениям (`POLICY`), затем выполняет запрос service-role ключом.
3. **Клиент-хелпер** (`lib/db.ts`). `db.from('shifts').select()...` — повторяет API supabase,
   миграция экранов механическая.
4. **Публичное меню** (`/api/menu`, *в работе*). Гостевое меню и заказы — через серверный
   endpoint, чтобы anon не читал `restaurants`/`menu_*` напрямую.
5. **RLS** (`docs/security/rls.sql`). Включается **последним**: deny anon, service_role
   (BYPASSRLS) продолжает работать.

## Порядок выката (строго)
1. ✅ Токен + шлюз + клиент-хелпер + RLS SQL (готово, аддитивно, прод не сломан).
2. ⏳ Мигрировать экраны на `db.from(...)`: manager → analytics → tobacco → dashboard →
   menu-editor → join/AuthGate. Тестировать каждый.
3. ⏳ Публичное меню на `/api/menu`.
4. ⏳ Проверить, что прямых `supabase.from(<бизнес-таблица>)` в `app/` не осталось
   (кроме auth и storage).
5. ⏳ Применить `rls.sql` в Supabase SQL Editor. Проверить приложения. При регрессе — rollback-блок.

## Ещё доделать в рамках безопасности
- **Rate-limit PIN** сейчас in-memory (`Map`) — на Vercel не общий между инстансами.
  Перенести в БД/Upstash (таблица попыток или Redis).
- **Биометрия** (`AuthGate.tryBiometric`) — веб-заглушка без реальной привязки ключа.
  Заменить на нативный Face ID (плагин Capacitor) при нативной сборке.
- Переменная окружения `MISE_TOKEN_SECRET` (иначе используется `SUPABASE_SERVICE_ROLE_KEY`).
