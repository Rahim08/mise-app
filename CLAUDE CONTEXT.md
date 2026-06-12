# Mise — Project Context & Roadmap for Claude

> **Это главный документ проекта.** Здесь: что за продукт, текущая архитектура,
> **что сделано / что нет / что дальше**, как делать и как выходить на рынок.
> **Обновляй раздел «СТАТУС» и «ROADMAP» после каждой рабочей сессии.**
>
> Легенда: ✅ готово · 🚧 в работе · ⬜ не начато
> Дата последнего обновления: 2026-06-12 (вторая сессия: People «Зал», нал/безнал, зарплата из инкассы, cron, лимиты)

---

## 1. Обзор

SaaS для управления рестораном. Первый клиент — **Smoke One** (владелец = разработчик Rahim).
Цель: довести до состояния, когда можно подключать **второй ресторан** (план ~3 месяца) и продавать.

- **Прод:** https://mise-app-omega.vercel.app
- **Домен (кандидат):** getmise.app
- **Деплой:** `npx vercel --prod` (preview: `npx vercel`). GitHub auto-deploy НЕ подключён.
- **Репо:** Rahim08/mise-app — **отстаёт**, актуальный код в `~/mise-app` (его надо закоммитить, см. roadmap).
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
| `docs/migrations/features-2026-06.sql` | shifts.income_card, inkassations.salary(+note), include_card_in_analytics, allow_pay_at_table | ⚠️ **ОБЯЗАТЕЛЬНА перед деплоем этой версии** (аддитивно) |
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

**Capacitor:** ✅ гибрид-конфиг + `docs/IOS_BUILD.md`. ⬜ `cap add ios` + подпись (на машине, нативный этап).

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

### 3) Дизайн / ребрендинг (единый Apple-язык)
- Объединить «Сотрудники» + «Доступы» в один экран **«Команда»** (HR + PIN + приложения + роль на одной карточке; чинит хрупкую связь по имени).
- **Тёмная тема** на дашборде/админке/входе (приложения уже умеют).
- Единые примитивы (Card/Btn/Field/Sheet/Toast) — сейчас дублируются.
- Админка: показать email владельца, единый словарь статусов подписки, реальный MRR.

### 4) Меню — до продакшн-уровня
- ✅ Загрузка **фото** блюд и обложки в Supabase Storage (bucket `restaurant-assets`, папка `menu/`).
- ⬜ Модификаторы (размер/добавки), номер стола (QR на стол `?table=N`), экран входящих заказов (ляжет в People/Manager).

### 5) Нативная iOS (App Store) — финал
- `sudo gem install cocoapods` → `npx cap add ios` → подпись (Team, Bundle `app.getmise.mise`).
- NSCameraUsageDescription (QR), NSLocationWhenInUseUsageDescription (явка).
- Нативные плагины: push (APNs), Face ID, фоновый геофенсинг. Гайд: `docs/IOS_BUILD.md`.

### 6) Интеграция Syrve/iiko (Pro)
- org: Smoke One, ID `4484d211-87e3-4def-a1b5-30bd6c59c55a`, base `api-eu.syrve.live`.
- Источник продаж/стоп-листов/финансов. Отдельный трек, не блокирует People.

### 7) Биллинг и лимиты
- Прогнать Stripe end-to-end (checkout, webhook, отмена, past_due).
- Серверная проверка лимитов плана (сотрудники, приложения) — не только в UI.

### 8) Юр./опс (перед публичным запуском)
- Privacy policy (⚠️ **согласие на геолокацию** обязательно), Terms, GDPR, удаление данных.
- Бэкапы БД, мониторинг ошибок (Sentry), алерты.

### 9) Маркетинг / лендинг
- Добавить на лендинг секции **People** и **Menu**; убрать «PWA · Без App Store» после нативного релиза.

### 10) Инфраструктура
- Закоммитить актуальный код в GitHub (репо отстаёт). Подключить GitHub → Vercel auto-deploy.
- Убрать мусор: `chart.js` из deps (не используется), вложенная `mise-app/mise-app/`.
- Заменить `middleware.ts` на `proxy.ts` (Next 16 deprecation warning).

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
- RLS ещё не включён (данные защищены шлюзом, но прямой anon к таблицам пока открыт — закрыть через rls.sql).
- Возможные дубли `shifts` у Smoke One → применить `shifts-dedup.sql` (с бэкапом).
- Биометрия в вебе — заглушка (настоящий Face ID на нативном этапе).
- Связь `staff`↔`employees` по имени (хрупко) — чинится экраном «Команда».
- Репо отстаёт от `~/mise-app` — закоммитить.
