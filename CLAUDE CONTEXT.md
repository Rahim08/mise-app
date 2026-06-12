# Mise — Project Context & Roadmap for Claude

> **Это главный документ проекта.** Здесь: что за продукт, текущая архитектура,
> **что сделано / что нет / что дальше**, как делать и как выходить на рынок.
> **Обновляй раздел «СТАТУС» и «ROADMAP» после каждой рабочей сессии.**
>
> Легенда: ✅ готово · 🚧 в работе · ⬜ не начато
> Дата последнего обновления: 2026-06-12 (сессии 2–12). GitHub→Vercel AUTO-DEPLOY АКТИВЕН: push в main = прод!
> ⚠️ Сессии 11–12 НЕ закоммичены (виды кальянов, упрощённая смена, фиксы Stripe-вебхука, /brand) — запушить после «пуш» от владельца.

---

## 1. Обзор

SaaS для управления рестораном. Первый клиент — **Smoke One** (владелец = разработчик Rahim).
Цель: довести до состояния, когда можно подключать **второй ресторан** (план ~3 месяца) и продавать.

- **Прод:** https://mise-app-omega.vercel.app
- **Домен (кандидат):** getmise.app
- **Деплой:** GitHub → Vercel auto-deploy АКТИВЕН: **push в main = прод**. Preview: `npx vercel`.
- **Репо:** Rahim08/mise-app.
- **Super Admin:** `/app/admin/page.tsx`, доступ только `raxim98@gmail.com`.

## 2. Стек

- Frontend: **Next.js 16 (App Router), TypeScript**, инлайн-стили, кастомные SVG-графики.
- Backend/DB: **Supabase (Postgres)**. RLS **подготовлен, но ещё НЕ включён** (см. §6).
- Payments: **Stripe** (Checkout + Webhooks).
- AI: **Google Gemini** (server-side `/api/ai`, только план Pro).
- PDF/Excel: **jsPDF** (встроен кириллический шрифт `lib/ptSansFont.ts`) + CSV.
- Native: **Capacitor 8** (гибрид, см. §8 п.5 и `docs/IOS_BUILD.md`).
- QR: jsQR (камера), qrcode.react (генерация).

---

## 3. АРХИТЕКТУРА ДАННЫХ (важно — изменилась!)

> ⚠️ **Старое правило «читать данные через supabaseAnon напрямую» БОЛЬШЕ НЕ ДЕЙСТВУЕТ.**
> Браузер больше не ходит в БД anon-ключом. Всё бизнес-чтение/запись — через сервер.

**Как теперь:**
- **Клиент → шлюз:** в экранах используем `db.from('table')...` из `@/lib/db` (mirrors supabase-API). Это уходит на сервер `app/api/db/route.ts`.
- **Шлюз `/api/db`:** проверяет вызывающего (токен сотрудника ИЛИ owner-сессия), форсит `restaurant_id`, проверяет права по приложениям (`POLICY`), выполняет запрос **service-role** ключом.
- **`supabase` из `@/lib/supabase`:** только для **auth** (`supabase.auth.*`) и **storage** (логотип). Бизнес-таблицы — НЕ напрямую.
- **Серверные роуты** (`/api/*`) используют `createClient(URL, SERVICE_ROLE)` — им можно `from()` напрямую (service role в обход RLS).

**Аутентификация:**
- Сотрудник: PIN → `/api/auth/pin/check` → подписанный **httpOnly токен** (`lib/staffToken.ts`) + читаемая кука `mise_token_until` (срок). Привязка устройства — на сервере там же.
- Владелец: Supabase-сессия (email/Google), резолвится на сервере по `owner_id`.
- Face ID / возврат в приложение: пускает без PIN только если токен жив; если у заведения задан `owner_pin` — PIN спрашивается даже у владельца.
- Брендинг до PIN (имя/лого): `/api/auth/restaurant-info` (без секретов).

**Карта серверных эндпоинтов:**
| Endpoint | Назначение |
|---|---|
| `/api/db` | Шлюз бизнес-данных (токен/owner, scoping, права) |
| `/api/auth/pin/check` | Проверка PIN, выдача токена, привязка устройства |
| `/api/auth/pin/hash` | Хэш PIN (bcrypt) для сохранения |
| `/api/auth/restaurant-info` | Публичный брендинг (имя/лого/has_owner_pin) |
| `/api/menu/[slug]` (GET) | Публичное гостевое меню (service role) |
| `/api/menu/order` (POST) | Создание гостевого заказа |
| `/api/admin` | Супер-админ (cross-restaurant, gated по email) |
| `/api/cron/reminders` | Vercel Cron (раз в час): напоминания о сменах → notifications. Нужен env `CRON_SECRET` |
| `/api/ai` | Gemini, только Pro |
| `/api/stripe/checkout|cancel|webhook` | Биллинг |
| `/api/account/delete` | Удаление аккаунта (+ отмена Stripe) |

**Ключевые файлы:** `lib/db.ts` (клиент-шлюз), `lib/staffToken.ts` (токен), `components/AuthGate.tsx` (вход в приложения), `hooks/useTheme.ts` (тема light/dark).

---

## 4. Приложения платформы

| Приложение | Путь | Цвет | Статус |
|---|---|---|---|
| mise Manager | `/app/manager/page.tsx` | `#007aff` синий | ✅ |
| mise Analytics | `/app/analytics/page.tsx` | `#34c759` зелёный | ✅ (+ экспорт, AI Pro) |
| mise Stash | `/app/tobacco/page.tsx` | `#ff9500` оранжевый | ✅ |
| mise Menu (гость) | `/app/menu/[slug]/page.tsx` | `#ff2d55` розовый | ✅ |
| Редактор меню | `/app/dashboard/menu/page.tsx` | `#ff2d55` | ✅ (нет загрузки фото) |
| mise People | `/app/people/page.tsx` | `#5856d6` индиго | ✅ (Расписание/Смены/Задачи/Обмены/Явка+часы/Зал: стоп-лист·заказы·чек-листы·техкарты; уведомления — колокольчик в хедере) |
| Дашборд (владелец) | `/app/dashboard/page.tsx` | — | ✅ |
| Super Admin | `/app/admin/page.tsx` | — | ✅ |

Вход в приложения сотрудников: QR из дашборда (`/join?restaurant=ID`) → PIN. Владелец — через Supabase-сессию.

---

## 5. Схема БД (Supabase, schema public)

### Боевые (RLS пока выкл)
- **restaurants**: id, name, owner_id, is_active, subscription_status, subscription_plan, subscription_ends_at, subscription_id, stripe_customer_id, logo_url, owner_pin, created_at
- **staff**: id, restaurant_id, name, pin_hash, apps[], device_id, is_active, **role** (после people-v3), created_at
- **shifts**: id, restaurant_id, manager_id, date, status, opening_balance, income, total_expense, inkassation, closing_balance, opened_by, notes — ⚠️ нужен UNIQUE(restaurant_id, date), см. `shifts-dedup.sql`
- **shift_expenses, shift_absences, transactions, employees, salary_records, monthly_card_amounts, expense_categories, inkassations** (inkassation в основном в `shifts.inkassation`)
- **tobacco_stock / tobacco_movements / tobacco_flavors / tobacco_inventories**
- **menu_settings / menu_categories / menu_items / menu_orders**
- **subscriptions, restaurant_settings** (+ гео/напоминания после people-features), **profiles, admin_notes**

### People (создаются миграциями people-v3 + people-features)
- **staff_tasks** (задачи: title, assigned_to, status todo/in_progress/done, priority, due_date, completed_at)
- **staff_reports** (поломки/заметки/предложения)
- **staff_schedules** (график: staff_id, date, shift_start/end, note, published)
- **tech_cards / tech_card_sessions** (технологички, стоп-листы)
- **shift_checklists / shift_checklist_completions** (открытие/закрытие зала)
- **shift_swap_requests** (обмен сменами)
- **attendance_records** (явка по гео: check_in/out, distance, late_minutes)
- **push_subscriptions** (токены пушей: web/ios/android)
- **notifications** (журнал уведомлений)
- **staff_directory** (VIEW: безопасный список сотрудников без pin_hash)

---

## 6. SQL-миграции — порядок применения (Supabase → SQL Editor)

| Файл | Что делает | Когда применять |
|---|---|---|
| `docs/migrations/people-v3.sql` | staff.role, базовые People-таблицы, триггеры, индексы | ✅ можно сейчас (аддитивно) |
| `docs/migrations/people-features.sql` | расписание/обмены/явка/пуши/уведомления + staff_directory | ✅ можно сейчас (аддитивно) |
| `docs/migrations/features-2026-06.sql` | shifts.income_card, inkassations.salary(+note), include_card_in_analytics, allow_pay_at_table, modifiers, pin_attempts, app_errors | ✅ применена |
| `docs/migrations/hookah-2026-06.sql` | hookah_sales (date/brand/flavor/is_free/portion_g) + hookah_types + настройки кальяна | ✅ применена |
| `docs/migrations/admin-perks-2026-06.sql` | comp_apps (подарочные приложения) + discount_pct в admin | ✅ применена |
| `docs/migrations/restaurants-currency-2026-06.sql` | restaurants.currency (код читал её из restaurants, колонка была только в restaurant_settings) | ✅ применена |
| `docs/migrations/stripe-columns-2026-06.sql` | restaurants.stripe_customer_id + subscription_id (их НЕ существовало → вебхук молча падал); дефолты status/plan → NULL (новые аккаунты без подписки) | ⚠️ **ПРИМЕНИТЬ** (не подтверждено владельцем) |
| `docs/migrations/shifts-dedup.sql` | чистка дублей смен + UNIQUE(restaurant_id,date) | ⚠️ с бэкапом, после инспекта |
| `docs/security/rls.sql` | включить RLS на всех таблицах (deny anon) | 🔴 **ПОСЛЕДНИМ**, после проверки шлюза в проде |

> RLS включаем только когда убедились, что все экраны работают через `/api/db` в проде.
> Service-role (серверные роуты) продолжит работать после RLS — у него BYPASSRLS.

---

## 7. СТАТУС — что уже сделано ✅

**Багфиксы:**
- ✅ menu `params` через `use()` (slug=undefined)
- ✅ Manager: экстра-выплаты подгружаются обратно
- ✅ Заказы из меню пишутся в `menu_orders`
- ✅ Удаление аккаунта отменяет подписку Stripe
- ✅ `/auth/forgot` + `/auth/reset`
- ✅ Stripe webhook: устойчивый `current_period_end`
- ✅ AI только для Pro (сервер + UI)
- ✅ Даты смен в локальной зоне (не UTC)
- ✅ Manager устойчив к дублям смен (+ dedup SQL)

**Безопасность (фундамент + миграция):**
- ✅ Токен сотрудника (`lib/staffToken.ts`), companion-кука
- ✅ Шлюз `/api/db` + клиент `lib/db.ts`
- ✅ Все экраны переведены на шлюз (manager/analytics/tobacco/dashboard/menu-editor/join/AuthGate/admin)
- ✅ Публичное меню через `/api/menu/*`, брендинг через `/api/auth/restaurant-info`
- ✅ `docs/security/rls.sql` готов (НЕ применён)
- ✅ Rate-limit PIN в БД (таблица `pin_attempts`, миграция features-2026-06)
- ✅ Stripe: авторизация владельца на checkout/cancel (`lib/stripeAuth.ts`), `customer.subscription.updated`, fallback `invoice.parent.subscription_details.subscription`. Ручной test-mode прогон: `docs/OPS.md`
- ✅ Мониторинг ошибок: window.onerror → `/api/log` → таблица `app_errors` (смотреть в Supabase). Бэкапы: `docs/OPS.md`
- ✅ Лендинг: секция People+Menu (#people), строка в тарифе Business, футер. Privacy: раздел «Геолокация сотрудников» (согласие, без фонового трекинга); Terms: 2.1 про данные сотрудников/гостей
- ✅ `middleware.ts` → `proxy.ts` (Next 16), удалён chart.js
- ⬜ Применить RLS · ⬜ настоящий Face ID (на нативном этапе) · ⬜ удалить `mise-app/mise-app` руками

**Фичи:**
- ✅ Экспорт Analytics в Excel + PDF (кириллица)
- ✅ Дашборд: SVG-иконки вкладок (без эмодзи), карточка Mise Menu, People как приложение
- ✅ PIN у владельца, если задан owner_pin
- ✅ Menu: загрузка фото блюд и обложки (Supabase Storage)
- ✅ Дашборд «Команда» — объединены «Сотрудники» + «Доступы» (человек = имя/роль/оклад/доступ/PIN)
- ✅ Дашборд → Категории: удаление чинится (отвязка `shift_expenses.category_id` перед delete)
- ✅ Manager: автосохранение при смене дня + перезапись строк без дублей (введённое не теряется)
- ✅ Admin: редизайн — тёмная тема, email владельца, реальный MRR, единые статусы подписки
- ✅ Stash: списание (write-off) с причиной; цвета остатка (≤200 жёлтый, 0 красный, иначе зелёный)

**Сессии 3–8 (2026-06-12):**
- ✅ Manager: нал/безнал раздельно (`income`=нал, касса от него; `income_card`), зарплата из инкассы, ошибки сохранения показываются, locked-режим «матовое стекло»+Редактировать
- ✅ Analytics: тумблер безнала, вкладка «Кальян» (выручка/табак/склад/«в заведении»/топ вкусов), полоска Нал·Карта в «Месяц»
- ✅ **Смена кальянщика**: Stash → таб «Смена» (счётчики по вкусам, сегмент Продажа|Бесплатно — is_free не в выручке, но табак списывается). Цена/порция: дашборд → Настройки → Кальян
- ✅ Menu: модификаторы (jsonb + шторка выбора), цифровой счёт (localStorage 6ч) + «Позвать официанта» (items[0].call='waiter'), валюта, ?table=N
- ✅ People: «Зал» (стоп-лист kitchen+manager / заказы+бейдж / чек-листы / техкарты), колокольчик уведомлений, часы+«Мой месяц»+Зарплата в Явке
- ✅ Дизайн-система `components/ui.tsx` (для нового кода); тёмная тема дашборда (CSS-vars в globals.css, html.mise-dark)
- ✅ Безопасность: серверные лимиты тарифа в /api/db (PLAN_LIMITS), rate-limit PIN в БД (pin_attempts), Stripe verifyOwner+subscription.updated+invoice-fallback
- ✅ Опс: /api/log→app_errors+ErrorReporter, docs/OPS.md, vercel.json cron (daily 18:00, Hobby-лимит), CRON_SECRET в Vercel
- ✅ Лендинг: секция People+Menu; privacy: «Геолокация сотрудников»; terms 2.1; middleware→proxy.ts; chart.js удалён
- ✅ Git запушен + auto-deploy; полный дамп схемы: `docs/migrations/...Introspection.csv` (мёртвые: employees.card_amount, menu_items.syrve_id, menu_orders.pos_*, rs.gemini_api_key/timezone/working_days, transactions, salary_records)
- Решения: Syrve в Италии мёртв — НЕ заменяем (ждём API банка); отдельные приложения, не единый shell; i18n en/ru/it/fr/az/tr/uk/kk — в самом конце, словари+ИИ-перевод; Live Activity и недельный дайджест — нет

**Сессии 9–12 (2026-06-12):**
- ✅ Тарифы перераспределены (Poster-style): Starter = Manager+Analytics+2 юзера · Business = все приложения+QR-меню+5 · Pro = +AI+10+интеграции. QR-меню гейтится по плану на сервере (/api/menu 404/403 для starter, /dashboard/menu → billing)
- ✅ Admin: «Привилегии» в карточке клиента — comp_apps (подарочные приложения, бейдж ПОДАРОК) + discount_pct (Stripe-купон вручную)
- ✅ AppsTab redesign (единая сетка, глиф 44px, замок/chevron); подсказка логотипа 512×512; кнопки: :active scale на iOS, per-plan pending, ошибки в alert
- ✅ **Корень «не сохраняется»**: staff-кука перехватывала /api/db у владельца (тихие 403) → resolveCaller: sb-кука владельца приоритетнее staff-токена. Сейвы алертят ошибки
- ✅ **Виды кальянов** (hookah_types: имя/цена/граммовка) — CRUD в дашборд → Настройки; hookah_sales хранит hookah_type_id+portion_g+price на момент продажи; Analytics «Кальян»: блок «По видам»
- ✅ **Смена кальянщика упрощена** (решение владельца): список видов + окошко-число у каждого (сегмент Продажа|Бесплатно), пикер вкусов/брендов УДАЛЁН (вкусы — потом); полоска «Табака в заведении» = Σ(выдано в зал) − Σ(qty×порция); склад не трогается
- ✅ **Корень «оплатил Starter — активен Business» + «No subscription» при отмене**: в restaurants НЕ существовало колонок stripe_customer_id/subscription_id — вебхук молча падал (200 для Stripe), оставались дефолты active/business → у новых аккаунтов всё открыто даром. Фикс: stripe-columns-2026-06.sql + вебхук теперь 500 при ошибке записи (Stripe ретраит) + лог в app_errors; checkout проверяет запись customer_id (дубли customers)
- ✅ restaurants.currency: колонки не было (только в restaurant_settings) → «Could not find currency column» при сохранении настроек. Фикс: restaurants-currency-2026-06.sql
- ✅ Брендинг (первый заход): `components/brand.tsx` (AppIcon/Wordmark/BRAND_COLORS) + превью `/brand`. **Владельцу НЕ понравилось** — см. §3.5 направление
- Stripe у владельца в LIVE mode; тестовый customer удалён из Stripe (подписка отменилась автоматом). План повторяемого теста триала без новых мейлов — в истории сессии 12 (один тестовый аккаунт: checkout → проверка → cancel immediately в Stripe + сброс строки SQL)
- Ресторан при регистрации создаёт DB-триггер в Supabase (НЕ в репо, по raw_user_meta_data.restaurant_name). Если после stripe-columns у свежего аккаунта всё равно всё открыто — триггер ставит status явно, запросить `pg_get_functiondef` и поправить

**Capacitor:** ✅ `ios/` создан (cap add ios, SPM без CocoaPods). ⬜ Xcode-этап на машине: подпись (Bundle `app.getmise.mise`), plist-разрешения, Face ID, APNs, виджет «Касса сегодня».

**People (Этап 1 — готов):**
- ✅ Приложение `/people`, индиго, role-aware таб-бар
- ✅ Расписание (менеджер: назначение + публикация недели)
- ✅ Смены (сотрудник: опубликованные смены)
- ✅ Задачи (создание/назначение/статусы)
- ✅ Обмены сменами (коллега → менеджер → переназначение + уведомления)
- ✅ Явка по гео (авто-чек-ин в радиусе, опоздания, история) + настройки гео/радиус/напоминания в дашборде
- ✅ Уведомления (журнал; теперь колокольчик в хедере с бейджем непрочитанных)
- ✅ Vercel Cron (напоминания о сменах) — см. §8.5 · ⬜ нативный пуш (APNs) + фоновый геофенсинг (iOS-этап)

**People (Этап 2 — «Зал», готов):**
- ✅ Вкладка «Зал»: Стоп-лист (правят кухня+менеджер) · Заказы (инбокс гостевых заказов) · Чек-листы (открытие/закрытие, отметки за день) · Техкарты
- ✅ Явка: отработанные часы, «Мой месяц» у сотрудника, месячная сводка по каждому у менеджера

---

## 8. ROADMAP к рынку (по приоритету, с «как делать»)

### 1) Завершить безопасность 🔴 (блокер для 2-го ресторана)
- Проверить в проде, что все экраны работают через шлюз (owner + реальный сотрудник по PIN).
- Применить `docs/security/rls.sql`. После — проверить ещё раз, при регрессе — rollback-блок в файле.
- Перенести rate-limit PIN из `Map` в БД/Upstash (на Vercel инстансы не общие).

### 2) Достроить People 🚧
- **Обмены:** запрос → коллега принимает → менеджер одобряет → `staff_schedules` переназначается. Таблица `shift_swap_requests` готова.
- **Явка по гео:** кнопка «Отметиться» активна в радиусе (`restaurant_settings.latitude/longitude/geo_radius_m`), пишем `attendance_records` (distance, late_minutes); история. Авто-замер на открытом приложении (фоновый — на нативном этапе).
- **Настройки в дашборде:** координаты заведения, радиус, режим напоминаний (`reminder_mode`: hours_before|fixed_time).
- **Уведомления:** журнал `notifications` (in-app) → затем Vercel Cron создаёт напоминания о сменах за день.

### 3) Дизайн / ребрендинг (единый Apple-язык) 🚧 — ТЕКУЩИЙ ЭТАП
Сделано ранее: ✅ «Команда», ✅ тёмная тема дашборда, ✅ примитивы `components/ui.tsx`, ✅ редизайн админки.

**3.5 Брендинг / логотипы — направление от владельца (сессия 12):**
- Первый заход (`/brand`: цветные градиентные squircle + белый глиф) — **НЕ понравился**.
- Хочет как иконки, которые делались ему «в приложении на телефоне» — **пришлёт референс**, ЖДАТЬ его.
- Утверждённое направление: **тёмный фон у всех иконок, акцентный цвет приложения = сам глиф** (не фон). Стиль Apple pro-приложений (Final Cut/Logic: чёрный + цветной глиф).
- Бренд mise — нейтральный цвет; глиф-ДНК: три «строки» mise en place (из LogoMark).
- Идея владельца для Menu: **3 квадрата + четвёртый — буква m**.
- Дальше (после утверждения): раскатка по приложениям/хедерам/AuthGate/дашборду/лендингу, иконка iOS, OG-картинки. Потом — professional pass лендинга + about/support/contact (отдельная сессия).
- Перевод старых экранов на `ui.tsx` — можно через Sonnet.

### 4) Меню — до продакшн-уровня ✅
- ✅ Фото блюд/обложка (Storage), ✅ модификаторы, ✅ `?table=N`, ✅ инбокс заказов (People «Зал»), ✅ цифровой счёт + «Позвать официанта», ✅ валюта.

### 5) Нативная iOS (App Store) — финал
- `sudo gem install cocoapods` → `npx cap add ios` → подпись (Team, Bundle `app.getmise.mise`).
- NSCameraUsageDescription (QR), NSLocationWhenInUseUsageDescription (явка).
- Нативные плагины: push (APNs), Face ID, фоновый геофенсинг. Гайд: `docs/IOS_BUILD.md`.

### 6) Интеграции (Pro) — ОТЛОЖЕНО
- Syrve в Италии мёртв (решение: НЕ заменяем). Ждём **API банка** → тогда расходы по карте и реальные цифры. Кандидаты на будущее: Cassa in Cloud / Tilby API. CSV-импорт — решено НЕ делать.

### 7) Биллинг и лимиты 🚧
- ✅ Серверные лимиты плана в `/api/db` (PLAN_LIMITS), ✅ QR-меню гейт по плану, ✅ verifyOwner, ✅ вебхук с ретраями и логом в app_errors.
- ⬜ **Прогнать триал end-to-end в проде** (после деплоя сессии 12 + stripe-columns.sql): checkout Starter → «Пробный период»/план/замки → отмена. Сверить Stripe Webhooks endpoint + STRIPE_WEBHOOK_SECRET в Vercel.
- ⬜ Кандидат: гейтить экспорт Excel/PDF по плану.

### 8) Юр./опс (перед публичным запуском)
- Privacy policy (⚠️ **согласие на геолокацию** обязательно), Terms, GDPR, удаление данных.
- Бэкапы БД, мониторинг ошибок (Sentry), алерты.

### 9) Маркетинг / лендинг
- ✅ Секции People+Menu. ⬜ Professional pass лендинга + about/support/contact (после брендинга); убрать «PWA · Без App Store» после нативного релиза.

### 10) i18n — В САМОМ КОНЦЕ (решение владельца)
- 8 языков: en/ru/it/fr/az/tr/uk/kk. JSON-словари + ИИ-перевод один раз. В приложениях — язык системы iPhone, на сайте — глобус-переключатель. Делать после дизайн-системы/брендинга.

### 11) Инфраструктура
- ✅ GitHub auto-deploy, ✅ chart.js удалён, ✅ middleware→proxy.ts. ⬜ удалить вложенную `mise-app/mise-app/` руками.

---

## 8.6. ОЧЕРЕДЬ ЗАДАЧ (обновлено сессия 14, 2026-06-13, по приоритету)

**Сделано в сессиях 13–14:**
- ✅ Stripe-флоу работает в проде: оплата/отображение/отмена; дубли подписок гасятся вебхуком; `canceling` = доступ до конца периода (блокирует только `subscription.deleted`).
- ✅ Дашборд: сайдбар-архитектура (Обзор/Приложения/Команда — Уведомления/Настройки/Подписка — Аккаунт внизу), экран «Обзор» (сегодня + ≤2 аномалии), лента уведомлений с бейджем, crossfade-переходы, скелетоны.
- ✅ **Брендинг v2 финал**: glow-иконки (тёмный фон, белый глиф, цветное свечение) + wordmark `mise` с серой «e» `#8e8e93`. Компоненты: `components/brand.tsx` (AppIcon/Wordmark/APP_META). Раскатано: дашборд, auth-страницы, /join, AuthGate (иконка конкретного приложения), лендинг (нав/герой/футер), favicon + apple-icon + PWA manifest (`public/manifest.json` создан — раньше 404). Превью: `/brand` и `docs/mise-brand-v2.html`. Старый `LogoMark` больше нигде не используется (файл остался).

**Очередь:**
1. ⬜ **Админка v2** — концепт согласован: сайдбар (Обзор: MRR/триалы/ошибки · Клиенты · Платежи · Ошибки), entitlements-модель прав (`plan | addon | granted`): аддоны = Stripe subscription items (докупка приложений к любому тарифу), granted = подарки владельцем из админки (расширение comp_apps), скидки = реальные Stripe-купоны кнопкой. Ждём «делай».
2. ⬜ **Домен**: всё вокруг «mise» занято; свободны misesuite.com/.app/.io, miseapp.io. getmise.app занят (26.12.2025) — выяснить, не покупал ли владелец; если нет — сменить bundle id `app.getmise.mise` до App Store. Потом: почта на домене (Zoho/Workspace), перевод аккаунтов, Apple ID + Developer Program.
3. ⬜ Лендинг professional pass → about/support/contact (логотип уже обновлён).
4. ⬜ **RLS** (`docs/security/rls.sql`) — после проверки прода; блокер второго ресторана.
5. ⬜ iOS Xcode-этап (подпись, plist-разрешения, Face ID, APNs, виджет «Касса сегодня») — на машине владельца; bundle id зависит от п.2.
6. ⬜ i18n 8 языков — финал.
7. ⬜ Перевод старых экранов на `components/ui.tsx`.

---

## 8.5. Функционал — решения владельца (приоритет на ближайшее)

Согласовано в обсуждении. ⬜ = делаем, отмечать ✅ по мере выполнения.

**Делаем (по порядку):**
- ✅ Stash: списание с причиной + цвета остатка.
- ✅ **People — задачи и отчёты:** staff создаёт задачи себе/коллеге, отчёты о поломках (`staff_reports`) с типами и статусами.
- ✅ **People — UI чек-листов открытия/закрытия** (`shift_checklists` + completions за день) и **технологичек** (`tech_cards`, менеджер создаёт/правит). Всё во вкладке «Зал».
- ✅ **Стоп-лист:** вкладка «Зал» в People; тогглят кухня и менеджер, остальные видят; гостевое меню отражает `is_available` автоматически.
- ✅ **Menu — инбокс заказов:** «Зал → Заказы» в People (new→в работе→выдан, отмена; автообновление 30с; показывается только при включённом «заказ за столом»). Тумблеры «заказ за столом» + «оплата за столом» (`allow_pay_at_table`). `?table=N` → `menu_orders.table_number` + бейдж в корзине. Валюта заведения (`restaurants.currency`) в гостевом меню и редакторе.
- ✅ **Manager — доход нал/безнал:** `shifts.income` = наличные (касса от них), `shifts.income_card` = безнал; общая сумма показывается отдельно. Тумблер «учитывать безнал в аналитике» — дашборд → Настройки (`restaurant_settings.include_card_in_analytics`, по умолч. выкл); Analytics добавляет income_card ко всем показателям только при вкл.
- ✅ **Зарплата из инкассы:** поле «Выплата зарплаты» (+кому) в секции Инкассация (`inkassations.salary/salary_note`); итог инкассации = сумма − расход − зарплата.
- ✅ **People — личная статистика:** «Мой месяц» (смены/часы/опоздания) у сотрудника; у менеджера — статистика за месяц по каждому. Часы = check_in→check_out.
- ✅ **Vercel Cron** — `/api/cron/reminders` раз в час (vercel.json), режимы hours_before/fixed_time, дедуп по schedule_id. ⚠️ задать env `CRON_SECRET` в Vercel.
- ✅ **Серверная проверка лимитов тарифа** в `/api/db`: при выдаче доступов (`staff.apps`) проверяется maxStaff и whitelist приложений плана (PLAN_LIMITS должен совпадать с PLANS в дашборде).

**Отложено (запомнить на будущее, НЕ делать сейчас):**
- Фото чека к расходу (Manager).
- Несколько смен в день (день/ночь) — как настройка по графику.
- Динамика по категориям расходов (Analytics).
- Вкладки Продажи/Кальян — наполнить только если не выйдет Syrve.
- Модификаторы меню (размер/добавки) — после базового заказа за столом.
- Тёмная тема дашборда — отложена (дашборд ещё не финальный).

## 9. UI-правила (строго)
- iOS/Apple: блюр-хедеры, скруглённые карточки, **SVG-иконки, без эмодзи**, шрифт `-apple-system`.
- Цвета: `#007aff` Manager · `#34c759` Analytics · `#ff9500` Stash · `#ff2d55` Menu · `#5856d6` People · `#af52de` purple · `#1c1c1e` black · `#ff3b30` red.
- Хедер приложений: строчное `mise` цветом приложения + обычное название (без иконки).
- Тёмная/светлая тема через `useTheme` (где есть).

## 10. Правила работы с кодом
- Сначала точная причина — потом решение.
- **Данные — через `db.from()` (шлюз), НЕ через supabase напрямую.** `supabase` только auth/storage. Серверные роуты — service role.
- Хелпер-компоненты объявлять ВНЕ основного компонента (иначе hydration error #310).
- Gemini key — только server-side. Stripe SDK — без `apiVersion`.
- Не подавлять TypeScript-ошибки (`next.config.ts` сейчас чистый). Перед деплоем: `npx tsc --noEmit && npx next build`.
- Файлы без подчёркиваний в имени.
- Менять прод только через preview-проверку; помнить про `vercel rollback` при регрессе.

## 11. Как тестировать / деплоить / откатывать
- **Локально:** `npx tsc --noEmit` (типы) + `npx next build` (сборка/бандлинг).
- **Preview:** `npx vercel` (закрыт Vercel-логином — реальные сотрудники не зайдут; owner-флоу проверяем тут).
- **Прод:** `npx vercel --prod` → alias `mise-app-omega.vercel.app`.
- **Откат:** `npx vercel rollback` (вернуть предыдущий прод-деплой).
- **People тест:** применить people-v3 + people-features → дашборд «Доступы» дать сотруднику People+PIN → сотрудник входит по QR/PIN.

## 12. Известные долги/риски
- **Сессии 11–12 не закоммичены** (push в main = прод — пушить по команде владельца).
- `stripe-columns-2026-06.sql` не подтверждена владельцем — без неё биллинг не пишется в БД.
- RLS ещё не включён (данные защищены шлюзом, но прямой anon к таблицам пока открыт — закрыть через rls.sql).
- DB-триггер создания ресторана не в репо — может ставить status='active' явно (проверить регистрацией после stripe-columns).
- Возможные дубли `shifts` у Smoke One → применить `shifts-dedup.sql` (с бэкапом).
- Биометрия в вебе — заглушка (настоящий Face ID на нативном этапе).
- Связь `staff`↔`employees` по имени (хрупко) — чинится экраном «Команда».
- Мёртвые поля БД (вычистить при случае): employees.card_amount, menu_items.syrve_id, menu_orders.pos_*, restaurant_settings.gemini_api_key/timezone/working_days, transactions, salary_records.
