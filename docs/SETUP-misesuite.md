# Запуск на misesuite.com — что нужно сделать (владелец)

Код уже переведён на `misesuite.com` и задеплоен. Ниже — внешние настройки в дашбордах. Иди по порядку; блоки 1–2 уже сделаны.

Логин для всех аккаунтов далее → заведи и используй **admin@misesuite.com** (через Cloudflare Email Routing, см. блок 2).

---

## ✅ 1. Домен в Vercel (СДЕЛАНО)
- `misesuite.com` + `www` добавлены, DNS через интеграцию Cloudflare → статус **Valid**.
- Проверка: открой https://misesuite.com — должен отдать сайт.

## ✅ 2. Cloudflare Email Routing — приём почты (СДЕЛАНО)
- `hello@`, `privacy@`, `partners@`, `admin@misesuite.com` → форвард на твой Gmail. Catch-all = Drop.

---

## ☐ 3. Resend — отправка писем приложения (письма-подтверждения, уведомления)
1. Зайти на **resend.com**, зарегистрироваться (логин `admin@misesuite.com`).
2. **Add Domain** → `misesuite.com`.
3. Resend покажет 3 DNS-записи: **SPF** (TXT), **DKIM** (TXT/CNAME), **DMARC** (TXT).
   → Добавить их вручную в **Cloudflare → DNS → Records**, у всех **Proxy = DNS only (серое облако)**.
4. Дождаться статуса **Verified** в Resend (обычно 5–30 мин).
5. **API Keys → Create** → скопировать ключ (`re_...`).
6. Vercel → проект → **Settings → Environment Variables** → добавить:
   - `RESEND_API_KEY` = `re_...` (Environment: Production, можно и Preview)

> Пока `RESEND_API_KEY` не задан — письма не шлются (код это переживает, no-op). После задания — `noreply@misesuite.com` будет реальным отправителем.

## ☐ 4. Vercel — переменные окружения
В том же разделе Environment Variables добавить:
- `NEXT_PUBLIC_APP_URL` = `https://misesuite.com` (ссылки в письмах ведут на дашборд)

После добавления переменных → Vercel → Deployments → у последнего деплоя **Redeploy** (чтобы env подхватились). Либо просто дождаться следующего push.

## ☐ 5. Supabase — Auth (важно для регистрации и писем подтверждения)
Supabase → проект → **Authentication → URL Configuration**:
- **Site URL** = `https://misesuite.com`
- **Redirect URLs** → добавить `https://misesuite.com/**`

(Опционально) Authentication → **Email Templates** — подключить свой SMTP через Resend, чтобы письма Supabase (подтверждение почты, сброс пароля) уходили с `@misesuite.com`, а не с дефолтного адреса Supabase.

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
