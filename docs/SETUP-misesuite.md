# Запуск на misesuite.com — что нужно сделать (владелец)

Код уже переведён на `misesuite.com` и задеплоен.

**СТАТУС 2026-06-14:** ✅ домен в Vercel · ✅ Email Routing · ✅ Resend DNS verified · ✅ Supabase Auth.
**ОСТАЛОСЬ ДВА ШАГА:**
1. **Vercel env** (блок 4) — добавить `RESEND_API_KEY` + `NEXT_PUBLIC_APP_URL`, затем Redeploy. ← для писем приложения
2. **Apple** (блок 6) — App ID + подпись, перед публикацией в App Store.

(Регистрация/вход и письмо-подтверждение уже работают — это Supabase.)

Логин для всех аккаунтов далее → заведи и используй **admin@misesuite.com** (через Cloudflare Email Routing, см. блок 2).

---

## ✅ 1. Домен в Vercel (СДЕЛАНО)
- `misesuite.com` + `www` добавлены, DNS через интеграцию Cloudflare → статус **Valid**.
- Проверка: открой https://misesuite.com — должен отдать сайт.

## ✅ 2. Cloudflare Email Routing — приём почты (СДЕЛАНО)
- `hello@`, `privacy@`, `partners@`, `admin@misesuite.com` → форвард на твой Gmail. Catch-all = Drop.

---

## ✅ 3. Resend — DNS домена VERIFIED (СДЕЛАНО 2026-06-14)
- Домен `misesuite.com` в Resend, записи DKIM/SPF/MX добавлены в Cloudflare и **verified** (проверено через API).
- Отправитель `noreply@misesuite.com` готов на уровне DNS.

## ☐ 4. Vercel — переменные окружения ← ЕДИНСТВЕННЫЙ ОСТАВШИЙСЯ ШАГ ДЛЯ ПОЧТЫ
Vercel → проект → **Settings → Environment Variables** → добавить (Production):
- `RESEND_API_KEY` = `re_...` (Resend → API Keys → Create, если ещё нет)
- `NEXT_PUBLIC_APP_URL` = `https://misesuite.com`

Затем Vercel → Deployments → у последнего **Redeploy** (чтобы env подхватились).

> Пока `RESEND_API_KEY` не задан — доп-письма (приветствие/триал/чек) не шлются (no-op). Письмо-подтверждение при регистрации шлёт Supabase и работает уже сейчас.

## ✅ 5. Supabase — Auth (СДЕЛАНО)
Site URL + Redirect URLs выставлены на `https://misesuite.com`.
(Опционально позже) Email Templates → подключить SMTP Resend, чтобы письма Supabase уходили с `@misesuite.com`.

## ☐ 6. Apple Developer (до публикации в App Store)
- Решить тип аккаунта: **Individual** ($99/год, продавец = твоё имя, оформляется за день) или **Organization** ($99/год, продавец = компания, нужен D-U-N-S, ~1–2 недели).
- Создать **App ID** = `com.misesuite.app` (bundle id уже выставлен в коде).
- В Xcode → Signing & Capabilities → выбрать команду/профиль, пересобрать.
- (Открытый вопрос) bundle id можно сделать домен-нейтральным `com.mise.app` — решаем перед созданием App ID.

---

## Аккаунты: «переезд на рабочий аккаунт» — рекомендация
- **Vercel / Supabase:** НЕ переносить проекты сейчас (живой Stripe + прод-БД, риск). Достаточно сменить email аккаунтов на `admin@misesuite.com` (Settings → email). Перенос в Vercel Team / Supabase Organization — позже, без спешки (оба поддерживают перенос с минимальным даунтаймом).
- **Apple:** см. блок 6 — это единственное, что важно решить до публикации.

## Заметки
- **SMS в проекте нет** — подтверждения регистрации идут по email (Supabase Auth + Resend). SMS = отдельная интеграция (Twilio / Supabase Phone Auth), если понадобится.
- Telegram `@miseapp` на странице контактов — **заглушка**, заменить на реальный хэндл (или убрать).
- Демо-логин для Apple Review `demo@getmise.app` — оставлен (уже в проде, домен для входа не важен). Можно пересоздать как `demo@misesuite.com` позже (перезапуск demo-seed.sql).
