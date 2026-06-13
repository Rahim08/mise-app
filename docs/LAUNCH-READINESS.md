# Mise — готовность к запуску

Статус на 2026-06-13. Часть пунктов закрыта кодом автономно (см. «Сделано»),
часть требует твоих действий — ключей, доступа к Supabase, домена (см. «Нужно от тебя»).

---

## ✅ Сделано (код, в рабочем дереве — НЕ запушено)

| # | Что | Файлы |
|---|-----|-------|
| 1 | **Security-заголовки** на все ответы: HSTS, X-Content-Type-Options, X-Frame-Options (SAMEORIGIN — лендинг в iframe), Referrer-Policy, Permissions-Policy (camera/geolocation только self), `poweredByHeader:false` | `next.config.ts` |
| 2 | **Cookie-consent баннер** (GDPR, ЕС/Италия): frosted-glass, i18n, persist в localStorage, не показывается в нативном Capacitor, событие `mise:analytics-consent` для будущего PostHog | `components/CookieConsent.tsx`, `app/layout.tsx`, `lib/i18n.tsx` |
| 3 | **Транзакционные письма** (Resend, zero-dep): welcome / окончание триала / чек об оплате. **No-op без `RESEND_API_KEY`** — безопасно лежит до активации | `lib/email.ts` |
| 4 | **Триал-напоминания** в дневном cron: письмо владельцу за ≤3 дня до конца триала, дедуп раз в день, полностью обёрнуто в try/catch (не ломает напоминания о сменах) | `app/api/cron/reminders/route.ts` |
| 5 | **AI: обновлена мёртвая модель** `gemini-1.5-flash` → `gemini-2.0-flash` + обработка ошибок API (502 вместо тихого «Нет ответа») | `app/api/ai/route.ts` |
| 6 | **Тесты** (vitest): 6 тестов на крипто-критичный `staffToken` — подпись/проверка/подмена payload/истечение/чужой секрет. `npm test` | `lib/staffToken.test.ts`, `package.json` |
| 7 | **Гигиена git**: `CLAUDE CONTEXT.md` (38 КБ внутренних заметок) и `*.bak` убраны из репо (`git rm --cached`) + в `.gitignore` | `.gitignore` |
| 8 | **Миграция чистки** мёртвых колонок (опциональная, деструктивная) — подготовлена, применяешь сам | `docs/migrations/cleanup-dead-columns-2026-06.sql` |
| 9 | **Product-аналитика (PostHog)** — privacy-first: стартует только при наличии ключа **И** согласия на cookie. EU-хост по умолчанию (GDPR). posthog-js через dynamic import (вне основного бандла). Pageview на смену маршрута, helper `track()` для событий. **No-op без `NEXT_PUBLIC_POSTHOG_KEY`** | `lib/analytics.ts`, `components/Analytics.tsx`, `app/layout.tsx` |
| 10 | **GDPR завершён**: отзыв согласия — `openCookieSettings()` переоткрывает баннер; отказ/отзыв немедленно останавливает аналитику (`stopAnalytics`) | `components/CookieConsent.tsx` |
| 11 | **`/api/health`** — лёгкий health-check (процесс + доступность БД) для аптайм-мониторинга. 200/503, без секретов | `app/api/health/route.ts` |
| 12 | **Воронка онбординга** — события `signup_completed` / `login` / `team_member_invited` / `checkout_started` через `track()` (no-op без PostHog) | `auth/register`, `auth/login`, `dashboard` |
| 13 | **«Настройки cookie» + ссылки** (Конфиденциальность/Условия) в Аккаунте дашборда — видимый отзыв согласия (GDPR) | `app/dashboard/page.tsx` (AccountTab) |
| 14 | **i18n forgot/reset** (8 языков) + переключатель языка на обоих экранах | `auth/forgot`, `auth/reset`, `lib/i18n.tsx` |
| 15 | **Брендовый спиннер загрузки** вместо текста «Загрузка...» в дашборде (3 места). Splash оставлен — уже Apple-grade | `app/dashboard/page.tsx` |

Проверено: `npm run build` ✅, `npm test` ✅ (6/6).

---

## ⏳ Нужно от тебя (я не могу — нет доступа/ключей)

### 🔴 Критично

1. **Включить RLS** — главный блокер изоляции данных и второго клиента.
   Все экраны уже на `/api/db`, гостевое меню на публичном `/api/menu`, `service_role` имеет BYPASSRLS.
   → Прогнать `docs/security/rls.sql` в Supabase SQL Editor. Внизу файла есть rollback.
   После — проверить, что приложения и меню работают (service_role продолжит работать; перестанет только прямой anon-доступ из браузера — это и есть цель).

2. **`RESEND_API_KEY`** в Vercel (+ опц. `MISE_EMAIL_FROM`, `NEXT_PUBLIC_APP_URL`) — активирует все письма из п.3–4 выше. Без него писем нет, но ничего не ломается.

3. **Кастомный домен** (`getmise.app` / иной) в Vercel + Supabase Auth redirect URLs. Сейчас прод на `*.vercel.app`.

### 🟡 Важно

4. **Product-аналитика (PostHog)** — фронт уже полностью подключён, нужен только ключ:
   `NEXT_PUBLIC_POSTHOG_KEY` (+ опц. `NEXT_PUBLIC_POSTHOG_HOST`, по умолчанию EU-облако `https://eu.i.posthog.com`). Создать проект на PostHog EU → вставить ключ в Vercel. Стартует только при согласии на cookie.
   Опционально: добавить в футер/настройки ссылку «Cookie settings» — вызывает `openCookieSettings()` из `components/CookieConsent.tsx` (даёт пользователю отозвать согласие).
   `track('event', {...})` из `lib/analytics.ts` — для воронок онбординга/подписки.

5. **Миграция чистки** `cleanup-dead-columns-2026-06.sql` — опционально, **сделай бэкап до DROP**. `employees.card_amount` НЕ трогаю — он ещё используется в дашборде.

### Деплой того, что сделано

Изменения в рабочем дереве, НЕ запушены (push в `main` = прод-деплой). Когда готов:

```bash
git add -A
git commit -m "feat: security headers, GDPR cookie consent, transactional email scaffolding, staffToken tests"
git push           # = прод-деплой
```

---

## Дальнейшие идеи (не начато)

- Декомпозиция мега-компонентов (dashboard 1679 / people 1552 / analytics 1292 строк) — упростит поддержку и i18n.
- Перевод старых экранов на дизайн-систему `components/ui.tsx`.
- Дописать i18n (8 языков) на дашборд/приложения/лендинг — сейчас RU/EN частично.
- Apple-style анимация загрузки дашборда.
- Реальный CSP (нужен аудит origins: Supabase, Stripe, Gemini, Google Fonts).
