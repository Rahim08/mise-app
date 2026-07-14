# Биллинг v2 + Дашборд v2 — план и статус

Обновлено: 2026-07-12. Полный утверждённый план также в `~/.claude/plans/woolly-cooking-volcano.md`.

## Утверждённые решения (20 вопросов с владельцем)

**Тарифы (месяц; год -20%):**
| | Starter €14 | Business €24 | Pro €39 |
|---|---|---|---|
| Модули | Manager, Analytics | все 7 (+Stash, People, Menu, Bookings, News) | все 7 + AI |
| Места | 3 | 7 | 15 |

- Аддоны к любому тарифу: модуль +€3/мес, место +€1/мес, AI +€5/мес (цена AI предложена ассистентом, НЕ подтверждена).
- «Место» = сотрудник с доступом + 1 устройство. device_limit deprecated (колонка жива для старой iOS).
- Триал: 14 дней Pro без карты при регистрации (дефолты БД), карта только при выборе плана.
- Клиентов мигрировать не надо (один тестовый).
- Self-serve аддоны в дашборде через /api/stripe/update (прорейт + превью).
- Мульти-заведения: заложено схемой (подписка на restaurant), UI позже.
- Дашборд: единый shell; Manager => owner-раздел «Смены» (live+история), /manager остаётся для персонала; Bookings/News — полноценные веб-модули; AI-чат в Analytics; desktop-first.
- Дизайн: Apple-стиль, свой UI-kit на CSS-переменных; от ui-ux-pro-max взяли motion/spacing/contrast-правила, отвергли «золото+внешние шрифты». Темы light/dark через class mise-dark.
- iOS в этом спринте не трогаем (совместимые поля subscription_plan/comp_apps/ai_enabled).
- 3 фазы, каждая отдельно в прод. git push main = прод!

## Статус

### Ф1 Биллинг-фундамент — КОД ГОТОВ (build OK, НЕ закоммичено)
- `lib/plans.ts` — единый источник: PLANS/ADDON_PRICES/YEARLY_DISCOUNT/TRIAL_DAYS, `entitlements()`, `monthlyRevenue()`, `stripeLookupKey()` (`mise_<item>_<month|year>`).
- `lib/stripePrices.ts` — резолв price id по lookup_key с кэшем.
- `docs/migrations/billing-v2.sql` — **ПРИМЕНЕНА в Supabase (подтвердил владелец)**: addon_modules/extra_seats/addon_ai/billing_interval/trial_ends_at + дефолты trialing/pro/+14d + триггер subscription_ends_at.
- `scripts/stripe-setup.mjs` — **ЕЩЁ НЕ ПРОГНАН** (ни test, ни live). Ключей в .env.local нет, только в Vercel. **БЕЗ live-прогона деплоить нельзя** — новый checkout ищет цены по lookup_key.
- `app/api/stripe/checkout` — multi-item (план+модули+места+AI, month/year), без trial.
- `app/api/stripe/webhook` — `entitlementFields()` из metadata → колонки restaurants.
- `app/api/stripe/update` — NEW: self-serve с prorate, `preview:true` → amountDue+monthly.
- `app/api/db` — checkStaffPlanLimit через entitlements(); select('*') чтобы жить до миграции. Починен баг: menu нельзя было выдать сотруднику.
- `app/api/cron/reminders` — + expireTrials() (trialing, без subscription_id, просрочен → inactive). Письма за 3 дня уже были.
- `app/api/admin` — + setAddons, extendTrial; perks whitelist = ALL_MODULES.
- `app/admin/page.tsx` — блок Аддоны (модули/места/AI/интервал), Триал +7, Stripe-индикатор+ссылка, MRR через monthlyRevenue(); блок «Лимит устройств» удалён.
- `app/dashboard/page.tsx` — PLANS из lib/plans, maxStaff через entitlements().
- `lib/i18n.tsx` — 3/7/15 мест, 14 дней (dash.feat2users/featUpTo5/featUpTo10/trialActive/days7free/stripeNote).

### Ф2 Дашборд-shell — КОД ГОТОВ (build OK, НЕ закоммичено)
- `app/globals.css` — токены v2 (--accent/--ok/…, радиусы, тени, motion) + блок «интерактивные состояния UI-kit» (.ui-press/.ui-btn/.ui-input/.ui-card-tap, focus-visible, @keyframes ui-spin/ui-pulse).
- `components/ui/index.tsx` — UI-kit на токенах: Card, Btn, Field, Toggle, Segmented, Badge, StatTile, EmptyState, Spinner, SectionTitle, Stepper, Skeleton, inputStyle (export). i18n-агностичен — подписи переводит вызывающий код. Старый неиспользуемый `components/ui.tsx` УДАЛЁН (конфликтовал с резолвом `@/components/ui`).
- `components/dash/context.tsx` — DashboardProvider{user,restaurant,authChecked,isAdminView,reload,theme}, useDash(). Admin-view и auth перенесены из старого page.tsx.
- `components/dash/shared.tsx` — APPS/PLANS(view)/ROLE_OPTS/roleLabel/timeAgo/TabIcon (+иконки analytics/stash/people/menu/lock)/SplashScreen.
- `app/dashboard/(shell)/layout.tsx` — shell: сайдбар «Модули» (Обзор/Analytics/Stash/People/Menu; замок по entitlements → клик в billing) + «Сервис» (Команда/Уведомления/Настройки/Оплата), аккаунт внизу; mobile top-bar + пилюли; бейдж unseen; splash. storage читается в useEffect (иначе hydration mismatch — уже словили и починили).
- Страницы: `(shell)/page.tsx` (Обзор + редирект ?tab=, categories→settings, apps→обзор, success=1 проносится), `team/`, `notifications/`, `settings/`, `billing/`, `account/`. Старый `app/dashboard/page.tsx` УДАЛЁН. `/dashboard/menu` не тронут (вне route group).
- Ф2.3 billing self-serve ГОТОВ: тумблер месяц/год, карточки тарифов (radio-выбор), аддон-тумблеры (Stash/People/Menu/Bookings/News), степпер мест, AI-тоггл; «Применить» → /api/stripe/update preview → «Доплата сейчас €X / Новая цена €Y» → подтвердить; нет subscription_id → checkout с составом; no_subscription от update → fallback в checkout; native — read-only; success=1 поллинг перенесён в billing.
- i18n: +dash.secModules/secService + 18 ключей биллинга (int/addons/seats/ai/dueNow/newMonthly/…), 8 языков.
- Ф2.4: npm run build OK, tsc OK, hydration чистая (dev-прогон). ОСТАЛОСЬ: смоук под логином владельца (light/dark, mobile, self-serve оплата test-mode) — агент не логинится (пароли не вводит), нужен владелец.

### Ф2.5 Визуальный редизайн shell (2026-07-13) — КОД ГОТОВ, build/tsc чистые
По запросу владельца: полный редизайн дашборд-шелла скиллом `ui-ux-pro-max` (design-system + Bento-grid-стиль поиск), с явным условием — не терять Apple-стиль (SF Pro, iOS-акценты, не менять на Inter/навy-палитру, которые предложил скилл по умолчанию). Взято из поиска: карточки-«bento» с hairline+мягкая тень, --radius 16-24px, --ease iOS-кривая (уже была). НЕ взято: шрифт Inter/Fira, тёмно-навy палитру — конфликтует с Apple-стилем и существующим брендом.
- `app/globals.css` — новый спейсинг-скейл `--space-1..8` (4pt-ритм), унифицированная «волосяная линия» `--hairline`/`--hairline-strong`/`--sep-c` (вместо разрозненных `rgba(var(--seprgb),.06/.08/.1/.12)` по файлам), 3-уровневая elevation `--sh-1/--sh-card/--sh-pop`, `--radius-lg`, liquid-glass токены `--glass-bg/--glass-blur` (для поверхностей с реальным скроллом контента под ними).
- `components/ui/index.tsx` — `Card` теперь всегда с `border: var(--hairline)` (было только тенью — карточки сливались друг с другом на светлом фоне); `SectionTitle` — `letter-spacing: -.015em` на заголовке (Apple-style tight tracking на крупном тексте).
- `app/dashboard/(shell)/layout.tsx` — сайдбар переведён с `--surface` (белый, как у карточек) на `--bg` (тон канвы) + `--hairline` справа: раньше сайдбар визуально не отличался от карточек контента, теперь классическая Apple-рама (Finder/Mail: серый чром, белые карточки поверх). Мобильная шапка — на glass-токенах (у неё контент реально скроллит под ней, blur осмыслен). Десктопный сайдбар БЕЗ blur (контент не скроллит под ним — blur был бы бесполезной нагрузкой без визуального эффекта).
- Точечная зачистка `team/`, `shifts/`, `billing/`, `settings/` — разрозненные hairline-опасности заменены на токены.
- Осталось при желании: аналогичный визуальный пass для embedded-контента Analytics/Stash/People/Menu (свой `useTheme()`/`t.*`, отдельная система — вне текущего скоупа «dashboard shell», не трогали).

### Ф3 — п.5 DONE (2026-07-13), build прогнан ЧИСТО
1. «Смены» owner-view — КОД ГОТОВ, роут `/dashboard/shifts`. **Осознанно пропущено «кто открыл»**: `shifts.opened_by`/`manager_id` пишут auth uid ВЛАДЕЛЬЦА (у персонала нет своего auth-аккаунта), поле не отличает сотрудников — нужна отдельная доработка `openShift()` в Manager (не в этой сессии).
2. Bookings + Guests веб — DONE, смок-тест в браузере под владельцем пройден живьём (создал/отредактировал/удалил тестовую бронь, агрегация гостей проверена). `app/dashboard/(shell)/bookings/page.tsx`.
3. News веб — DONE, смок-тест пройден (опубликовал/удалил тестовый пост, priority-колонка подтверждена живой в проде). `app/dashboard/(shell)/news/page.tsx`.
4. AI-чат в Analytics-модуле — НЕ начато (уже есть в embedded `app/analytics/page.tsx`, отдельная страница не создавалась — не было запроса).

### Второй виток редизайна (2026-07-13, вечер) — владелец: «не весь функционал перенесён, обзор пустой, дизайн — как телефон растянутый»
Полный план в `~/.claude/plans/deep-prancing-pike.md` (одобрен, 20 уточняющих вопросов до старта). Ключевое: `max-width:880` в `(shell)/layout.tsx` убран — теперь `Container` (components/ui) с size normal/wide/full решает сам каждая страница. Новые примитивы: `Table` (client-side сортировка/поиск), `SplitView` (master-detail, схлопывается <900px), `Sparkline` (карточка-виджет тренда, из dataviz-скилла — «stat tile + 12-point sparkline», де-эмфазис серым + акцент на последнем отрезке). Обзор теперь тянет 14-дневную историю кассы/кальянов и показывает тренд под каждой цифрой, не просто голые числа. Team/Смены переведены с карточек-в-столбик на настоящие таблицы.
Bookings/Guests/News — полностью новые страницы (0 кода на вебе раньше, только iOS): порт `BookingsView.swift`/`GuestsView.swift`/`NewsView.swift`. Найден и починен реальный баг при живом тесте: `bookings.status` — `NOT NULL DEFAULT 'new'` в БД, страница отправляла `null` при пустом статусе → 400 на каждой новой брони; исправлено на явный `'new'`.
Ф4 DONE (Смены → полноценный desktop-редактор кассы): порт `calc()`/`persistShift()`/`openShift()`/`toggleAbsence()` из `app/manager/page.tsx` почти дословно (конвенция репо — дублировать, не шарить между iOS/веб/manager, см. [[money-model-manager-analytics]]), двухколоночный layout (сотрудники+расходы слева, инкассация+касса справа), навигация по дням как в Manager, matte-lock после сохранения с кнопкой «Редактировать». **ВАЖНО: save-путь НЕ протестирован живьём** — открытие смены/сохранение цифр создало бы настоящую запись в БД без возможности удалить (в отличие от Bookings/News, тут нет UI для удаления смены) — намеренно не стал портить прод-данные тестом. Проверено безопасно: пустое состояние (нет смены на 13.07) рендерится верно, история (read-only) не сломалась — те же цифры, что до правок. Логика — точная копия уже рабочего Manager, визуально только обёрнута в новый дизайн.
Ф5+ DONE — desktop-режим для ВСЕХ четырёх embedded-модулей (не только Analytics, как планировалось «первым», успел все): `app/analytics/page.tsx`, `app/tobacco/page.tsx`, `app/people/page.tsx`, `app/dashboard/(shell)/menu/page.tsx`. Техника везде одна и та же, минимальный риск: у каждого файла контент был жёстко зажат в `maxWidth: 640` (Analytics/People) или `860` (Stash) и в embedded-, и в standalone-ветке одинаково; завёл `contentMaxWidth = embedded ? 1100 : <старое значение>` и заменил 3 хардкода (шапка-контролы/контент/nav-сегменты) на переменную. Staff-мобильные маршруты (`/analytics`, `/tobacco`, `/people`) физически не меняют своё значение — проверено live: `/analytics` без сессии показывает PIN-экран на прежней узкой ширине, `/dashboard/people` (embedded) — 7-дневное расписание на всю ширину. `app/dashboard/(shell)/menu/page.tsx` — свой случай, эта страница ВСЕГДА embedded (нет отдельного staff-варианта, `git mv` из старого `app/dashboard/menu`), поэтому там правка безусловная (640→1100 везде, включая скрытый non-embedded branch, которого по факту не бывает).
Живой смок-тест в браузере на 1920×1080: Analytics/Stash/People/Menu — все шире, ничего не сломано, никаких визуальных обрывов сеток (все внутренние grid — `repeat(N,1fr)`, просто получили больше воздуха).

**Этот виток редизайна закрыт полностью** (Ф0–Ф5+ из `~/.claude/plans/deep-prancing-pike.md`, все build/tsc чистые). НЕ закоммичено — рабочее дерево по-прежнему грязное (свои + чужие правки вперемешку, см. «Грабли» выше). AI-чат отдельной страницей в Analytics — по-прежнему не делали (не запрашивали явно, уже есть встроенным в Analytics).
5. ~~Вынос контента /analytics, /tobacco, /people, /dashboard/menu в components/modules/* и монтирование в shell~~ ✅ DONE (embedded-режим тех же page-компонентов, см. память Ф3.5).

## Чек-лист перед деплоем Ф1
1. ~~billing-v2.sql в Supabase~~ ✅ применена.
2. `STRIPE_SECRET_KEY=sk_test_... node scripts/stripe-setup.mjs` → тест чекаута (test mode, карта 4242…).
3. То же с sk_live_ (owner подтверждает).
4. npm run build → git push (прод). Смоук: логин, дашборд, checkout.

## Задачи (Task-лист сессии)
Ф2.1 UI-kit — DONE
Ф2.2 shell+routes — DONE
Ф2.3 Оплата self-serve — DONE (код; live-проверка после stripe-setup)
Ф2.4 build+смоук — build/tsc/hydration DONE; смоук под логином — за владельцем

## Грабли
- git stash в этом репо не использовать (Xcode трогает xcuserstate, pop конфликтует).
- npx tsc --noEmit: 2 ошибки в lib/staffToken.test.ts — были до нас, игнорировать.
- Рабочее дерево содержит НЕ наши правки (iOS-файлы, notify-*, AUDIT) — не коммитить чохом, только свои файлы.
