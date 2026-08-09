# Полный аудит Mise — 2026-08-05

Сквозной аудит всего продукта: web (Next.js 16 / Vercel), iOS (SwiftUI, App Store), общий слой
данных (`/api/db` + Supabase), биллинг (Stripe), публичный сайт, безопасность.

Модули, проаудированные ранее в отдельных документах, здесь не дублируются:
- Stash — `docs/STASH-AUDIT-2026-08-02.md`
- News — `docs/NEWS-AUDIT-2026-08-05.md`
- Analytics / Bookings / People / Manager — починены и запушены (`81ba20a`, `3acda93`, `66a5f85`, `b34d583`)

Обозначения: **ВЫСОКО** — потеря данных, деньги, безопасность; **СРЕДНЕ** — неверные данные у
пользователя или обходимый гейт; **НИЗКО** — UX/долг.

**Статус на 2026-08-05: документ НЕЗАВЕРШЁН.** Готов раздел News (вынесен в отдельный файл).
Разделы 1–6 ниже — сканы запущены параллельно, результаты не успели вернуться до конца сессии.
Чтобы дозаполнить: перезапустить проверки по поверхностям из заголовков разделов и вклеить находки
в формате `СЕВЕРИТИ | file:line | суть | сценарий отказа`.

## 1. Безопасность и аутентификация

Два независимых прохода (безопасность и слой данных) сошлись на одних и тех же дырах — ниже
объединено, дубли помечены.

**ВЫСОКО | `lib/apiAuth.ts:17` + `lib/staffToken.ts:87`** — смешение типов токенов.
`verifyAdminViewToken` проверяет только подпись, `rid` и `exp`; staff-токен подписан тем же ключом и
содержит те же поля, значит валиден как admin-view. `resolveCaller` проверяет admin-view ПЕРВЫМ и
выдаёт `owner:true` + все 4 модуля. Официант копирует значение `mise_staff_token` в куку
`mise_admin_view` → все запросы к `/api/db` идут от имени владельца: касса, зарплаты, настройки,
сотрудники. **Самая тяжёлая находка аудита.**

**ВЫСОКО | `app/api/db/route.ts:169`** — `columns` уходит в `.select()` без валидации, PostgREST
поддерживает embedding по FK, service-role игнорирует RLS → таблица POLICY обходится целиком:
`{table:"shifts",columns:"id,restaurants(owner_pin,stripe_customer_id)"}` или
`{table:"attendance_records",columns:"id,staff(pin_hash,apps,device_id)"}` (FK есть,
`people-features.sql:48`). Bcrypt от 4-значного PIN перебирается офлайн за минуты.

**ВЫСОКО | `app/api/db/route.ts:21-22`** — `restaurants` и `restaurant_settings` открыты на чтение
всем модулям без белого списка колонок: при `columns:'*'` уезжают `owner_pin`, Stripe-id,
`google_places_api_key`, `gemini_api_key`, координаты геочекина (можно подделать «Я здесь»).

**ВЫСОКО | `lib/staffToken.ts:15`** — TTL staff-токена 10 лет, `resolveCaller` (`apiAuth.ts:25`) не
перечитывает строку `staff`: не проверяет `is_active`, актуальные `apps`, `device_id`. Эндпоинта
разлогина нет (`app/join/page.tsx:135` чистит только localStorage). Уволенный сотрудник сохраняет
доступ 10 лет; отозвать можно только ротацией `MISE_TOKEN_SECRET` — то есть выкинув всех.

**ВЫСОКО | `docs/security/rls.sql:73`** — `alter table public.staff_directory enable row level security`,
но это VIEW (`people-features.sql:95`) — Postgres падает на этой команде, а скрипт выполняется одним
батчем в SQL Editor, значит строки 74-86 (а при откате транзакции — весь lockdown) не применились.
Гарантий, что RLS включена в проде, нет. Если упало — anon-ключ из бандла (`lib/supabase.ts:3`) даёт
прямой доступ к PostgREST по всем ресторанам.

**ВЫСОКО | `docs/migrations/salary-payroll-2026-07.sql:15`** (дубль п.2) — `salary_payments` без RLS
и вне `rls.sql`, при этом уже в POLICY (`route.ts:34`). Кросс-тенантное чтение и запись зарплат по
всей платформе с anon-ключа.

**СРЕДНЕ | `app/api/auth/pin/check/route.ts:34`** — ключ рейт-лимита `ip:restaurantId`,
5 попыток / 15 мин, IP из подделываемого `x-forwarded-for`; лимита на ресторан целиком нет. PIN —
4 цифры, сверяется со ВСЕМИ сотрудниками (совпал любой — вход). `restaurantId` открыто лежит в
ссылке `/join?restaurant=…`. Перебор с пула прокси; успех = токен на 10 лет.

**СРЕДНЕ | `app/api/db/route.ts:24,31,32`** — `employees`, `monthly_card_amounts`,
`salary_advances` открыты на чтение модулю people целиком, привязки к `sid` вызывающего нет
(«свой расчёт зарплаты» реализован только в UI). Посудомойка выгружает оклады, ставки, телефоны и
авансы всей команды.

**СРЕДНЕ | `app/api/db/route.ts:57,66,68,39`** — write на `attendance_records`, `bookings`,
`news_posts`, `hookah_goals` выдан всем модулям, разграничение «автор/должностное лицо» только в UI.
Прямым POST: проставить себе явку задним числом и стереть опоздания, удалить все брони заведения,
опубликовать новость от имени руководства, переписать KPI.

**СРЕДНЕ | `app/people/audits.tsx:90`, `settings/page.tsx:473`** — загрузка файлов в бакет
`restaurant-assets` идёт браузерным anon-клиентом, значит политика бакета обязана разрешать запись
роли anon; политик Storage в репозитории нет вообще. Путь детерминирован
(`logos/<restaurant_id>.png`), заливка с `upsert:true` → любой с anon-ключом подменяет логотип
любого заведения (он же в гостевом QR-меню) или заливает произвольные файлы.

**СРЕДНЕ | `app/api/auth/welcome/route.ts:7`** — роут без аутентификации шлёт брендированное письмо
на произвольный адрес; защита только 5/час на подделываемый IP. Фишинг от имени misesuite.com и
порча репутации домена в Resend.

**НИЗКО | `app/api/health/route.ts:11`, `lib/rateLimit.ts:16`** — если `HEALTH_CHECK_SECRET` не
задан, сравнение превращается в `Bearer undefined` и проходит; рейт-лимитер при сбое БД fail-open
(`return true`) — нагрузкой на БД снимаются лимиты с `/api/auth/pin/check` и `/api/ai`.

## 2. Слой данных, миграции, общие библиотеки

**ВЫСОКО | `lib/staffToken.ts:87`** — `verifyAdminViewToken` и `verifyStaffToken` подписывают и
проверяют одним секретом и одним форматом, без поля типа токена: admin-view проверяет только
`rid`+`exp`, которые есть и в staff-токене. Сотрудник копирует куку `mise_staff_token` в
`mise_admin_view` → `resolveCaller` (`lib/apiAuth.ts:17`) отдаёт `owner:true` со всеми модулями →
полный доступ владельца к деньгам, ЗП и биллингу. **Привилегия эскалируется одной кукой.**

**ВЫСОКО | `app/api/db/route.ts:169`** — `columns` из тела запроса уходит в `.select()` без
валидации, а PostgREST разрешает embedded-выборку по FK; POLICY проверяется только для корневой
таблицы. Сотрудник с доступом к People шлёт
`{table:'staff_schedules',op:'select',columns:'*,staff(id,pin_hash,apps)'}` — таблица `staff`
owner-only (`:23`), но приходит bcrypt-хэш 4-значного PIN всей команды (офлайн-брут за секунды).

**ВЫСОКО | `docs/migrations/salary-payroll-2026-07.sql:15`** — `salary_payments` создана без
`ENABLE ROW LEVEL SECURITY` и отсутствует в `docs/security/rls.sql` (единственная такая таблица).
`NEXT_PUBLIC_SUPABASE_ANON_KEY` лежит в браузерном бандле → любой с этим ключом читает суммы и даты
выплат зарплат по ВСЕМ ресторанам платформы и может писать в таблицу.

**ВЫСОКО | `app/api/db/route.ts:22`** — `restaurant_settings` открыта на чтение всем модулям, клиент
читает `select('*')` (`app/people/tabs-shifts.tsx:293`), а в строке лежат `gemini_api_key` и
`google_places_api_key`. Аналогично `restaurants` (`:21`) с `owner_pin` (bcrypt) и Stripe-id. Любой
сотрудник выкачивает платные API-ключи владельца.

**ВЫСОКО | `app/api/cron/reminders/route.ts:238`** — insert в `shift_checklist_completions` без
`restaurant_id`, а колонка `NOT NULL REFERENCES restaurants(id)` (`people-v3.sql:125`); ошибка
гасится `if (compErr) continue`. Расписание аудитов (daily/weekly/monthly) никогда не срабатывает:
`recurrence_last_run` не обновляется, пуш не уходит, роут отвечает `{ok:true, scheduledAudits:0}` —
фича мертва молча.

**ВЫСОКО | `docs/migrations/guestkey-normalize-2026-08.sql`** — миграция НЕ применена, а код с новым
ключом гостя уже в проде с `3acda93` (`bookings/page.tsx:40`). Старые `guest_notes` не матчатся:
заметки и история гостя не показываются. При последующем применении блок
`delete from guest_notes where rn > 1` необратимо удалит накопившиеся дубли.

**СРЕДНЕ | `app/api/db/route.ts:190`** — для `update`/`delete` не требуется ни одного фильтра: при
пустом `filters` единственное условие — `.eq(scope, rid)`. `{table:'shifts',op:'delete'}` от
менеджера стирает всю историю смен ресторана одним запросом. То же для `shift_expenses`,
`inkassations`, `transactions`. Восстановления нет.

**СРЕДНЕ | `app/api/db/route.ts:60`** — `notification_prefs` открыта на write всем модулям без
проверки принадлежности строки вызывающему. Сотрудник обновляет строку владельца (`to_owner=true`),
выключая ему пуши о закрытии кассы, либо ставит себе `show_cash_amount:true` и начинает получать
суммы выручки в пуше (`lib/notify.ts:97`).

**СРЕДНЕ | `app/api/db/route.ts:45`** — `menu_items` открыта на write модулю people целиком, без
allowlist колонок (комментарий обещает только `is_available`; колоночный carve-out сделан лишь для
`late_grace_min`, `:139`). `{table:'menu_items',op:'update',values:{price:0}}` без фильтров
обнуляет цены во всём публичном QR-меню.

**СРЕДНЕ | `app/api/cron/reminders/route.ts:376`** — серверный порт формулы долга по ЗП суммирует 6
предыдущих месяцев без отсечки `DEBT_TRACKING_START` (2026-08-01), которая есть в вебе
(`app/people/tabs-salary.tsx:114`). Пуш «долг €N» с легаси-месяцами против нуля в интерфейсе.

**СРЕДНЕ | `app/api/cron/reminders/route.ts:427`** — на `notifications` только
`idx_notif_staff_unread (staff_id, read_at)`; cron за прогон делает 4 запроса
`.eq('type',…).gte('created_at',…)` БЕЗ `restaurant_id` — seq scan всей таблицы по всем
ресторанам. Растёт линейно, упирается в таймаут функции, дедуп ломается → повторные пуши.

**НИЗКО | `app/people/tabs-ops.tsx:362`** — `tr('role.owner')` единственный ключ, отсутствующий в
`STRINGS` (остальные ~1350 полны по 8 локалям): в `created_by_name` и в пуше пишется сырой ключ.

## 3. Дашборд владельца, настройки, биллинг

Формат: `СЕВЕРИТИ | file:line | суть | сценарий отказа`.

**ВЫСОКО | `app/api/db/route.ts:21` + `:183-193`** — таблица `restaurants` открыта владельцу на запись
без whitelist колонок (update лишь вырезает scope-колонку). Владелец из консоли браузера:
`db.from('restaurants').update({subscription_plan:'pro', staff_limit:999, addon_modules:[...]})` —
`entitlements()` читает ровно эти поля → бессрочный Pro и любые места бесплатно, Stripe не в курсе.

**ВЫСОКО | `app/dashboard/(shell)/layout.tsx:85-89`** — гейт тарифа только на кнопках сайдбара;
страницы модулей (stash/people/analytics/bookings/news/shifts) не проверяют entitlements, в отличие
от `menu/page.tsx:241`. Клиент на Starter или с `subscription_status='canceled'` открывает
`/dashboard/stash` по прямому URL → полный модуль без оплаты.

**ВЫСОКО | `app/api/stripe/webhook/route.ts:48-52`** — дедуп-строка `stripe_events` вставляется ДО
обработки события. Если `update restaurants` падает → 500 → Stripe ретраит тот же `event.id` →
insert даёт 23505 → возврат `received:true` без обработки. Клиент оплатил,
`checkout.session.completed` потерян навсегда, подписка не активируется.

**ВЫСОКО | `app/dashboard/(shell)/shifts/page.tsx:212-230`** — delete-перед-insert для
`shift_expenses` и `inkassations`, ошибки insert не проверяются. В `app/manager/page.tsx:268-296`
это уже починено (`b34d583`), owner-view остался старым: сбой после delete стирает все расходы
смены и инкассацию, экран показывает прежние суммы из state.

**ВЫСОКО | `app/api/auth/pin/check/route.ts:87-120` + `app/api/db/route.ts:120-123`** — ни PIN-логин,
ни шлюз данных не сверяются с `subscription_status`. После canceled/past_due сотрудники работают
бессрочно; при даунгрейде Pro→Starter лишние места и модули не отзываются (`checkStaffPlanLimit`
срабатывает только в момент выдачи доступа).

**ВЫСОКО | `app/api/stripe/update/route.ts:56-67,91-104`** — diff позиций строится по
`lookup_key+quantity`, поэтому замена одного аддон-модуля на другой даёт `items=[]` и
`subscriptions.update` не вызывается. Владелец меняет Menu на Bookings: preview возвращает
`changed:false`, `billing/page.tsx:102` показывает «Изменений нет»; ближайший
`customer.subscription.updated` применит старую metadata (`webhook:147`) и вернёт Menu.

**СРЕДНЕ | `app/dashboard/(shell)/settings/page.tsx:218-227,256-272,299-346,398-411`** — четыре
карточки независимо читают `restaurant_settings ... limit(1)` и каждая делает свой INSERT, если
строки нет; уникальности по `restaurant_id` в схеме нет. Новый ресторан получает две строки
настроек, дальше чтения `limit(1)` без order берут произвольную → гео/день ЗП/Google-ключи «слетают».

**СРЕДНЕ | `settings/page.tsx:111-115`** — `saveCats` делает update без фильтра и без ветки insert.
Нет строки настроек → PostgREST обновляет 0 строк с `error=null` → категории бесплатных кальянов
видны в UI, но не сохранены.

**СРЕДНЕ | `settings/page.tsx:224-228, 469-481`** — тумблер «безнал в аналитике» и загрузка логотипа
игнорируют ошибки. Сбой записи → UI показывает применённое состояние, после F5 откат.

**СРЕДНЕ | `app/dashboard/(shell)/team/page.tsx:53-61`** — `saveOwnerPin` не проверяет ни ответ
`/api/auth/pin/hash`, ни ошибку update. При сбое в JSON уходит пустой `values {}` → PIN не записан,
UI рисует «Сохранено», владелец не может войти новым PIN.

**СРЕДНЕ | `team/page.tsx:79-93`** — ошибки записи в `employees` не проверяются, `staff` вставляется
даже при `empId=null`: доступ и PIN выданы «призраку», в HR-списке сотрудника нет, привязка идёт по
совпадению имени (`staffFor, :69-70`) и рассыпается при переименовании.

**НИЗКО | `app/api/stripe/cancel/route.ts:29-34`, `portal/route.ts:36-38`** — результат update не
проверяется, catch возвращает `Internal error` без записи в `app_errors` (в checkout/update запись
есть). UI показывает «отменено», в БД `active` до ближайшего вебхука.

## 4. Mise Menu (QR)

**ВЫСОКО | `app/menu/[slug]/page.tsx:318-326`** — `sendOrder` fire-and-forget: счёт сохраняется,
корзина чистится, показывается «Заказ отправлен» до и независимо от ответа `/api/menu/order`.
Подписка истекла или `allow_orders` выключили → 403, гость видит успех, на кухню ничего не пришло.
При обрыве сети корзина уже очищена — восстановить нечем.

**ВЫСОКО | `app/api/menu/order/route.ts:54-64`** — `items` и `total` принимаются от анонимного
клиента как есть: сервер не пересчитывает сумму по `menu_items` и не проверяет принадлежность
позиций меню. `POST {items:[{name:"Dom Pérignon",price:0,qty:10}], total:0, tip:-500}` → валидный
заказ в инбоксе персонала, выручка меню в дашборде (`menu/page.tsx:1014`) уезжает в любую сторону.

**ВЫСОКО | `app/dashboard/(shell)/menu/page.tsx:556-563`** — `saveItem` не проверяет `error` ни у
update, ни у insert: тост «Позиция обновлена» при любом исходе. Тот же паттерн в `deleteItem:566`,
`toggleItemVisibility:570`, `addCategory:378`, `toggleCatVisibility:433`, `deleteCategory:438-441`,
`deleteMenu:352-355`, `onCatDragEnd/onItemDragEnd:455/463`. В `deleteCategory` хуже всего: позиции
удалились, категория — нет.

**ВЫСОКО | `app/menu/[slug]/page.tsx:249-272`** — общая корзина стола: гость не запрашивает текущее
состояние канала, а первый же локальный чих шлёт свою полную корзину как last-write-wins. Канал
`mise-table:<slug>:<table>` — публичный broadcast на анонимном ключе, без `private:true`. Гость B
схлопывает корзину гостя A; любой, кто знает slug, читает и подменяет заказы чужих столов.

**СРЕДНЕ | `app/people/tabs-ops.tsx:158`** — инбокс распознаёт только `items[0].call === 'waiter'`;
вызовы `coal`/`water` (`/api/menu/order:17`) падают в ветку обычного заказа → карточка
«undefined × undefined», итог «0.00 €». iOS это обрабатывает
(`PeopleZalPurchase.swift:251-258`) — расхождение платформ.

**СРЕДНЕ | `app/api/menu/order/route.ts:59` vs `app/menu/[slug]/page.tsx:907`** — чаевые пишутся в
колонку `tip`, а персонал видит только `total` (веб `tabs-ops.tsx:189`, в iOS-модели поля `tip` нет
вовсе, `Models.swift:175-184`). Гость платит с чаевыми, официант видит сумму без них.

**СРЕДНЕ | `menu/page.tsx:103,288-297`** — `blankMenu()` отдаёт `slug: ''`, `saveSettings` пишет
пустую строку, тогда как `addMenu:305` шлёт `null`. Колонка `menus.slug` глобально UNIQUE → первый
ресторан занимает `''` на всю систему, у следующих сохранение настроек меню падает целиком.

**СРЕДНЕ | `menu/page.tsx:334-347`** — `duplicateMenu` ремапит только `category_id`, но копирует
`recommended_ids`, `combo_items`, `settings.upsell_category_id` со старыми id → в копии апселл и
состав комбо молча исчезают, после удаления оригинала остаются висячие ссылки.

**СРЕДНЕ | `app/api/menu/order/route.ts:54-64`** — заказ не уменьшает `menu_items.stock_left`
(декремента нет нигде). «Осталось 3» висит вечно, стоп-лист по остатку не срабатывает.

**СРЕДНЕ | `menu/page.tsx:533,535`** — `parseFloat(...) || null`: цена 0 falsy → в БД `null`.
Позиция «Вода — комплимент» с ценой 0 теряет цену; на гостевой странице цена не выводится
(`page.tsx:575`).

**СРЕДНЕ | `menu/page.tsx:587-588,1011-1018`** — аналитика меню не фильтруется по `menu_id`:
события и заказы берутся по `restaurant_id` целиком, имена топ-позиций резолвятся из текущего меню.
При двух меню цифры смешиваются, чужие позиции выводятся как «—». Жёсткие `limit(5000)/limit(2000)`
без пагинации — выручка обрезается молча.

**НИЗКО | `app/api/menu/order/route.ts:62`, `event/route.ts:31,37`, `app/menu/[slug]/page.tsx:110-112,809`** —
`table_number` без нормализации и лимита длины (в event-роуте `slice(0,10)` есть); insert в
`menu_events` без проверки ошибки; локали захардкожены: `toLocaleTimeString('ru-RU')` в счёте гостя
и в инбоксе, формат цены всегда `de-DE` с символом валюты перед числом против суффикса в дашборде.

## 5. iOS-оболочка, пуш, сессия

**ВЫСОКО | `AppModel.swift:350-370`** — `logout()` не отвязывает пуш-подписку: не удаляет строку
`push_subscriptions` на сервере, не стирает `mise_apns_token` (`Push.swift:19`), оставляет
`mise_notif_prefs` прошлого пользователя. Уволенный сотрудник продолжает получать пуши с суммами
кассы; при подключении к другому заведению устройство получает пуши обоих сразу.

**ВЫСОКО | `AppModel.swift:350-370`** — `logout()` не сбрасывает `notifs/notifsLoaded/notifsUnread`,
а AppModel живёт весь процесс (`RootView.swift:4`). Владелец вышел, официант вошёл на том же
телефоне → `MainView.swift:48` не перезагружает журнал → официант видит уведомления владельца,
включая «Смена закрыта, остаток €…».

**ВЫСОКО | `DB.swift:214-225`** — `single()` (единственный путь для INSERT/UPDATE с возвратом строки)
не вызывает `DB.invalidateCache`; инвалидация только в `run():230`. `ManagerView.swift:250` открывает
смену через `insert().single()` → кеш SELECT `shifts` держится до 5 минут → повторный заход читает
пустой список → второй INSERT → нарушение `unique(restaurant_id,date)`. То же в `MainView.swift:551`
и `AnalyticsView.swift:516`. **Внимание: это ровно тот путь, который я использовал в фиксе News —
проверить.**

**ВЫСОКО | `WidgetShared.swift:27-33`** — `config.sharedContainerIdentifier` НЕ шарит cookie-хранилище
между приложением и расширением (нужен `HTTPCookieStorage.sharedCookieStorage(forGroupContainerIdentifier:)`),
хотя комментарий утверждает обратное и на этом построена авторизация виджета
(`MiseWidget/WidgetAPI.swift:25`). Тап «Пришёл» в виджете: запрос без PIN-cookie → 401 → `try?`
глотает → в виджете гость «пришёл», в БД нет.

**ВЫСОКО | `RootView.swift:38-45`** — тап по пушу теряется на холодном старте: `guard model.phase == .authed`,
а `.authed` наступает после async `start()` + Face ID; отложенная маршрутизация (`pendingLink`)
сделана только для deep-link виджета. Приложение выгружено → тап по пушу → открывается обычный хаб.
То же для quick action (`RootView.swift:27-35`).

**СРЕДНЕ | `DB.swift:170-173`** — stale-кеш старше TTL возвращается как обычный успешный ответ,
флага «данные из кеша» нет ни в API, ни в UI (комментарий про stale-индикатор ложный). Плохая сеть:
менеджер закрывает смену, опираясь на устаревший остаток.

**СРЕДНЕ | `MainView.swift:531-533`** — `save()` при активном сохранении молча выбрасывает изменение:
ни очереди, ни повтора, ни зеркала в UserDefaults (строка 544 после guard). Два быстрых тумблера —
второй не сохранён нигде.

**СРЕДНЕ | `AppModel.swift:262-271`** — журнал уведомлений грузится один раз за сессию
(`MainView.swift:48,251`) через кеширующий SELECT с TTL 5 мин; на `scenePhase == .active` обновляются
снимок виджета и токен, но не уведомления. Пуш пришёл → в приложении бейдж 0 до перезапуска.

**СРЕДНЕ | `Theme.swift:22-26`** — в `parseISO` формат `yyyy-MM-dd` (date-only: `shifts.date`,
`bookings.booking_date`) парсится с принудительным UTC, а форматируется в локальной зоне. Западнее
UTC дата уезжает на сутки назад; в Цюрихе не воспроизводится.

**СРЕДНЕ | `Push.swift:177-198`** — `Notify.send` глотает любой исход
(`_ = try? await URLSession.shared.data(for: req)`): ни кода ответа, ни ретрая, ни сигнала
вызывающему; вдобавок `URLSession.shared` вместо `MiseSharedSession.session`, которым авторизованы
все прочие запросы (`API.swift:54/80/95`).

**СРЕДНЕ | `MiseShortcuts.swift:12-107`** — все фразы и диалоги Siri захардкожены по-русски мимо
`t()`/L10n (для виджета язык в App Group зеркалится специально, `WidgetShared.swift:20`).

**НИЗКО | `AppModel.swift:189-215`** — `checkPin` не различает неверный PIN и сетевой сбой: любой
catch кроме 403 → `false`, `PinView` (`OnboardingView.swift:210-224`) показывает «неверный PIN».
Нет сети — сотрудник идёт менять PIN вместо включения интернета.

## 6. Публичный сайт и юридическое

**ВЫСОКО | `public/landing.html:729,744,757,773`** — все CTA («Начать бесплатно», «Создать аккаунт»,
«Выбрать») делают `window.location.href='/auth/register'` изнутри iframe; `target="_top"` стоит
только на «Войти» (`:390`). Регистрация открывается ВНУТРИ iframe: адрес остаётся «/», Next-layout
грузится второй раз (два cookie-баннера, две аналитики), «назад» и шаринг ссылки сломаны. Это вся
воронка конверсии.

**ВЫСОКО | `app/page.tsx:45`, `app/apps/[app]/page.tsx:13`** — весь маркетинг это
`<iframe src="/landing.html">`, обёртка отдаёт краулеру пустой div. Googlebot видит на
misesuite.com ноль текста, при этом `/landing.html` индексируется сам как дубликат без canonical.
У `/apps/*` вдобавок `'use client'` → `generateMetadata` невозможен, все пять URL отдают
одинаковый title без OG.

**ВЫСОКО | `public/landing.html:7,703` (и все 8 языков: 924,955,1122) vs `lib/plans.ts:31`** — сайт
обещает «7 дней бесплатно» во всех локалях, в коде `TRIAL_DAYS=14` и
`billing-v2.sql:18` ставит `now()+14 days`. Публичная оферта расходится с биллингом.

**ВЫСОКО | `public/landing.html:725,740,754` vs `lib/plans.ts:20-22`** — тарифная таблица обещает
«До 2 / 5 / 10 пользователей», в `PLANS` seats = 3 / 7 / 15. Ключевой лимит неверен во всех трёх
тарифах. Там же «Все пять приложений» при `ALL_MODULES` из 7 (bookings и news не упомянуты), а
AI показан только в Pro, хотя есть аддон `addon_ai` за €5.

**ВЫСОКО | `public/mise-landing-v2.html:458`** — заброшенный лендинг от 8 июня со старой ценой €9
лежит в `public/` и отдаётся по прямому URL, `robots.ts:8` его не закрывает. Индексируемая страница
прода с неактуальной ценой (сейчас €14) и мёртвыми кнопками. Рядом живут `manager.html`,
`analytics.html`, `tobacco.html` — старые дубли разделов.

**СРЕДНЕ | `public/privacy.html:80` + `proxy.ts:29`** — политика утверждает «только необходимые
cookies», но `proxy.ts` ставит `mise_geo` (язык из гео-IP) на первом же запросе, до согласия и без
упоминания в политике. В разделе 1 нет push-токенов устройств (`push_subscriptions`, APNs) и не
назван ни один обработчик: PostHog, Supabase, Vercel, Resend. GDPR ст.13 требует перечислить
категории получателей; Италия заявлена целевым рынком.

**СРЕДНЕ | `next.config.ts:50`** — редирект есть только для `/privacy → /privacy.html`;
`misesuite.com/terms` отдаёт 404 (а также `/about`, `/support`, `/contact`).

**СРЕДНЕ | `app/layout.tsx:45`** — `maximum-scale=1, user-scalable=no` на всём сайте, включая
юридические страницы: pinch-zoom заблокирован, провал WCAG 1.4.4.

**СРЕДНЕ | `public/landing.html:366,795-802,809-810`** — ни логотип `href="/"`, ни футерные ссылки
не имеют `target="_top"`. Клик по логотипу грузит «/» внутрь iframe — то есть страницу, которая
рендерит ещё один iframe (рекурсия). Юридические страницы открываются без адресной строки.

**СРЕДНЕ | `app/layout.tsx:43`, `public/landing.html:2`** — `<html lang="ru">` зашит, хотя
`setLang()` (`:1154`) переключает 8 языков клиентским JS; нет ни одного `canonical` и ни одного
`hreflang`. Google индексирует только русскую версию.

**СРЕДНЕ | `public/landing.html:335`** — `@media(max-width:960px)` прячет `.nav-links` целиком,
замены (гамбургер) нет: на телефоне исчезают все ссылки, включая «Тарифы».

**НИЗКО | `app/layout.tsx:27,33,49`, `app/sitemap.ts:5-9`** — OG-картинка квадратная 512×512,
`twitter:card="summary"` → в мессенджерах крошечный логотип вместо превью 1200×630. Sitemap из
3 URL (нет `/apps/*`, юридических, `/brand`). `theme-color` (#f2f2f7) противоречит `manifest.json`
(#0a0a0a), оба iframe без `title` (WCAG 4.1.2). В `public/privacy.html:60,77,83,86` плейсхолдер
`{DOMAIN}` подставляется только JS — краулер и режим без JS видят «privacy@{DOMAIN}».

**Проверено и в порядке:** аналитика реально загейчена согласием (`lib/analytics.ts:23` — posthog
грузится динамическим импортом только при `mise_cookie_consent === 'all'`, EU-хост, autocapture
off); эмодзи в продуктовых HTML нет (найденные ✓ и ▲ — текстовые символы); подстановка `?account=`
идёт через `textContent` (XSS нет); тестовых ключей и dev-URL в публичной поверхности нет.

## Сводный приоритет

Чинить в этом порядке:

1. **`mise_admin_view` = staff-токен** (`lib/staffToken.ts:87`) — эскалация до владельца одной кукой.
2. **`columns` без валидации** (`app/api/db/route.ts:169`) — выгрузка `pin_hash`/`owner_pin` через FK-embedding.
3. **`salary_payments` без RLS** + проверить, что `rls.sql` вообще применился (падение на VIEW, строка 73).
4. **Колонки-секреты в `restaurants`/`restaurant_settings`** — белый список колонок на чтение.
5. **Stripe webhook: дедуп до обработки** — потерянные оплаты.
6. **Гейт тарифа только на кнопках сайдбара** + `restaurants` открыт владельцу на запись (бесплатный Pro).
7. **Заказы QR-меню: сумма и позиции с клиента** без пересчёта на сервере.
8. **update/delete без обязательного фильтра** — одним запросом стирается история смен.
9. **iOS: logout не отвязывает пуш и не чистит журнал** — чужие уведомления и суммы кассы.
10. **`DB.single()` не инвалидирует кеш** — дубли смен; проверить фикс News, он использует этот путь.
11. Сайт: CTA внутри iframe, «7 дней» против 14, лимиты мест 2/5/10 против 3/7/15, старый лендинг с ценой €9.
12. Остальное по разделам.

**Не проверялось:** POS (отдельный проект), AI-роуты (`/api/ai`), Telegram-интеграция, виджет iOS
подробно, экспорт/PDF-отчёты.
