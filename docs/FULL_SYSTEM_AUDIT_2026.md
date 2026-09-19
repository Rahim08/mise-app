# MISE Full System Audit — 2026-08-28

Независимый аудит: архитектура, финансовая целостность, безопасность, data consistency, web/native parity, UX-критичные сбои. Проведён по прямому чтению текущего кода (git HEAD ветки `feat/debts-and-payroll-fixes`), миграций и схемы БД — без доверия к прошлым audit-докам (`docs/FULL-AUDIT-2026-08-05.md`, `docs/STASH-AUDIT-2026-08-02.md`, `docs/audit/2026-08-15/*`, `docs/NEWS-AUDIT-2026-08-05.md`). Каждая гипотеза из ТЗ проверена самостоятельно; часть подтвердилась, часть — нет (уже исправлено в текущем коде), часть — частично.

**Обновление 2026-08-28 (та же сессия, после APPROVE IMPLEMENTATION):** Phase 1, 2, 3, 5, 7 из `docs/FIX_PLAN_2026.md` реализованы и провалидированы (tsc/vitest/eslint на изменённых файлах чисто, iOS `BUILD SUCCEEDED` clean build). Phase 4 (Восьмёрка на веб) и Phase 6 (полная транзакционная переработка `persistShift`) — сознательно не в этом цикле. Статус по каждой находке — см. таблицу ниже и пометки FIXED/NOT CONFIRMED/DEFERRED в соответствующих разделах.

### Fix status (2026-08-28)

| ID | Severity | Status | Note |
|---|---|---|---|
| MISE-001 | Critical | **FIXED** | ЗП-долг-леджер портирован на iOS (`ManagerSalaryModel.syncLedger`/`markAsDebt`) |
| MISE-002 | High | **FIXED** | `settle_debts` RPC — атомарная транзакция (миграция `atomic-debt-settlement-2026-08.sql`, ждёт накатки) |
| MISE-003 | High | **FIXED** | `businessDate()` портирован на веб (Manager + Analytics) |
| MISE-004 | High | **FIXED** | error-check на обоих update в `removePerson`/`resetDevice` |
| MISE-005 | High | **FIXED** | confirm-диалог перед увольнением (web) |
| MISE-006 | High | **FIXED** | `increment_tobacco_stock` RPC — атомарный инкремент (миграция `atomic-stock-increment-2026-08.sql`, ждёт накатки), web+iOS |
| MISE-007 | Medium | **FIXED** | rollback-delete в `ManagerSalary.swift` теперь проверяет свою ошибку |
| MISE-008 | Medium | **DEFERRED** (Phase 6, вне цикла) | архитектурное наблюдение, не активный баг |
| MISE-009 | Medium | **FIXED** | `debtsLoadFailed`-баннер вместо тихого нуля (iOS Analytics) |
| MISE-010 | Medium | **DEFERRED** (Phase 4, вопрос приоритета роадмапа) | Восьмёрка admin CRUD только iOS |
| MISE-011 | Medium | **FIXED** | `/api/ai` теперь через `resolveCaller()` |
| MISE-012 | Medium | **FIXED** | единый серверный путь загрузки фото аудита (web+iOS) |
| MISE-013 | Medium | **OPEN** — нужен доступ к Supabase | unique constraint на `tobacco_stock` не подтверждён/не добавлен |
| MISE-014 | Medium | **OPEN** — нужен доступ к Supabase | CHECK constraint на `tobacco_stock.quantity_g` не подтверждён/не добавлен |
| MISE-015 | Low | **FIXED** | понятное сообщение вместо "race" (web+iOS) |
| MISE-016 | Low | **NOT CONFIRMED** (уже исправлено ранее) | `ManagerChecklistHistoryList` реально wired, перепроверено |
| MISE-017 | Low | **FIXED** | error-check в `resetDevice` (тот же коммит, что MISE-004) |
| MISE-018 | Low | **CHECKED, NO FIX NEEDED** | все проверенные `catch{}` (включая 4 в stripe-роутах) — безопасный паттерн |
| MISE-019 | Low | **NOT CONFIRMED** | взаимоисключающие вкладки, не могут поллить одновременно |
| RLS live-check | Info | **OPEN** — нужен доступ к Supabase | не подтверждено из репозитория |

**Не закрыто и требует твоего действия:**
1. Накатить 2 миграции в Supabase (`atomic-stock-increment-2026-08.sql`, `atomic-debt-settlement-2026-08.sql`) — без них соответствующие RPC вернут 404 в проде.
2. Подтвердить в Supabase Dashboard: `rls.sql` реально применена; наличие unique/CHECK constraints на `tobacco_stock`.
3. Живой смоук-тест (два устройства/сеть-обрыв сценарии ниже) — не выполним без доступа к живому тестовому ресторану.

---

## Executive Summary

| Severity | Count |
|---|---|
| Critical | 1 |
| High | 5 |
| Medium | 9 |
| Low | 6 |
| Informational / needs owner verification | 3 |

**Главный вывод:** проект прошёл через несколько предыдущих раундов аудита (комментарии в коде явно ссылаются на "аудит 2026-08-05", "аудит 2026-08-15", "C2/C3/A2/A3/M1/M2" находки) — и эти фиксы **реально в коде**, не только в докс. Большинство гипотез из ТЗ (F1, F2, F4, S2, S3, S4, M1, M2, D1) — **уже закрыты**. Это хорошая новость: система в целом честнее с деньгами, чем можно было ожидать.

Единственная находка уровня Critical — **не гипотетическая, а прямо признанная в последнем коммите ветки**: слияние ЗП-долга в леджер долгов (`38d952f`) сделано только на вебе, iOS не тронут — commit message сам это говорит. Это значит: owner, переключаясь между web и iOS, буквально видит разные суммы задолженности по зарплате.

Второй кластер серьёзных находок — **partial failure без компенсации** в нескольких денежных путях (долг-сеттлмент, salary rollback) и **race condition без атомарного инкремента** на складе. Ни один из них не похож на "теоретическую придирку" — это конкретные сценарии с конкретными предусловиями (сетевой сбой в узком окне, два устройства одновременно).

---

## Confirmed / Rejected Previous Hypotheses

### F1 — Manager/Analytics считают accrued salary разными формулами
**NOT CONFIRMED.** Обе платформы (web `lib/analytics.ts` `computeAccruedToday`, iOS `AnalyticsView.swift`/`ManagerSalary.swift`) вызывают один и тот же shared-хелпер с идентичными параметрами. Комментарии в коде подтверждают: раньше расхождение было (до 17 п.п.), унифицировано в аудите 2026-08-15. Fix — в коде, не только в доксе.
**Evidence:** `lib/analytics.ts:63`, `app/manager/tabs-salary.tsx:36-47`, `native/Mise/Mise/ManagerSalary.swift:40`, `native/Mise/Mise/AnalyticsView.swift:11,600-606`.

### F2 — unpaid debts по-разному исключаются web/native Analytics
**NOT CONFIRMED.** `countsInRollup`-логика побайтово идентична по смыслу: трёхстороннее правило (`is_paid !== false && (!paid_shift_id || paid_shift_id === shift_id)`) продублировано один в один на обеих платформах.
**Evidence:** `app/analytics/page.tsx:666`, `native/Mise/Mise/AnalyticsView.swift:643-647`.

### F3 — Salary payout как несколько независимых DB-операций → inconsistent state
**PARTIALLY CONFIRMED.** `salary_payments` пишется первым, `inkassations` вторым (CAS), при ошибке второго шага клиент **компенсирует** — удаляет только что вставленную `salary_payments` запись. Это работает и одинаково на web/iOS. НО сама компенсация — второй незащищённый сетевой вызов (`try?` в Swift, без проверки ошибки), не DB-транзакция. Если процесс/сеть падает ровно между неудачным `inkassations`-запросом и компенсирующим delete — остаётся "оплачено" в `salary_payments` без реального списания с кассы, и никто об этом не узнает. См. MISE-002, MISE-007.
**Evidence:** `app/manager/tabs-salary.tsx:421-458`, `native/Mise/Mise/ManagerSalary.swift:360-402`.

### F4 — monthly_card_amounts и salary_payments(card) дважды уменьшают один долг
**NOT CONFIRMED.** Явный целевой фикс (комментарий "A2, аудит 2026-08-15"): `remaining` считается только от `paidCash`, карточные платежи уже вычтены из cash-базы (`total - advance - card`), не из `remaining` повторно.
**Evidence:** `app/manager/tabs-salary.tsx:80-101`, `native/Mise/Mise/ManagerSalary.swift:90-98`.

### F5 — Manager пересчитывает баланс локально иначе, чем в БД, после debt repayment
**NOT CONFIRMED как отдельная формула-баг.** `persistShift` обновляет локальный state только после успеха всех await-записей (иначе функция бросает исключение раньше). В success-пути показанный баланс = реально записанному. Но нет re-fetch для подтверждения — если где-то в цепочке (см. MISE-002) случился partial failure, UI может молча показать баланс, не соответствующий истинному состоянию БД, без ошибки на экране.
**Evidence:** `app/manager/page.tsx:437`.

### D1 — web/native Stash по-разному считают отдельные типы движений/free hookah
**NOT CONFIRMED.** Формулы `venueBase`/`venueLeft`/`gramsUsed` идентичны построчно между `app/tobacco/page.tsx` и `StashView.swift`. Шесть находок предыдущего аудита (H1/H2/M1/M2/L1/L2 из `docs/audit/2026-08-15/block-D-stash-people-bookings.md`) — все реально исправлены в текущем коде, проверено напрямую (не по доксу): `free_hookah_categories` читается на вебе (`page.tsx:177-183`), venue-writeoff вычитается (`:175,209-210`), iOS больше не клэмпит `venueLeft` к 0 (`StashView.swift:211`), инвентаризация пишет `tobacco_movements` (`page.tsx:653-661`), батч-валидация кумулятивна (`:528-538`).
Вместо D1 обнаружена **другая, реальная** проблема — см. MISE-006 (race condition, не formula divergence).

### S1 — staff-токен остаётся действительным после `is_active=false`
**PARTIALLY CONFIRMED.** Основной путь (`lib/apiAuth.ts:22-26` `staffTokenRevoked()`, вызывается из `resolveCaller()`) закрывает это для `/api/db`, `/api/notify`, `/api/bank/*`, `/api/storage/audit-photo`, `/api/google-reviews/sync-now` — деактивация действует немедленно.
Исключение: `app/api/ai/route.ts` вызывает `verifyStaffToken()` напрямую, минуя revocation-проверку. Уволенный сотрудник с валидным 10-летним токеном может продолжать дёргать AI-эндпоинт (голос→текст) бесконечно. Impact ограничен — не читает/не пишет бизнес-данные, только расходует AI-квоту под rate-limit 20/мин. См. MISE-011.
**Evidence:** `lib/apiAuth.ts:22-26`, `app/api/ai/route.ts:7-22`.

### S2 — PIN rate-limit блокирует нескольких сотрудников за одним NAT / не защищает от distributed brute force
**NOT CONFIRMED.** Двухуровневая защита: per-device+IP ключ (5 попыток/15 мин, включает `deviceId` → не блокирует весь NAT разом) плюс отдельный per-restaurant глобальный потолок (50/15 мин, независим от IP → закрывает распределённый перебор). Атомарный SQL-инкремент через RPC (`rate-limit-atomic-2026-07.sql`) — TOCTOU-гонки нет. IP — из `x-vercel-forwarded-for` (платформенный, не подделываемый).
**Evidence:** `app/api/auth/pin/check/route.ts:29-53`.

### S3 — owner меняет billing-поля через общий DB update path
**NOT CONFIRMED.** `BILLING_ONLY_COLUMNS` блокирует запись этих полей через `/api/db` для любого вызывающего, включая owner. Единственные легитимные писатели (Stripe webhook, `/api/admin`) минуют шлюз и гейтятся отдельно.
**Evidence:** `app/api/db/route.ts:109-113,227-232`.

### S4 — платные модули защищены только UI-скрытием, без серверного entitlement-check
**NOT CONFIRMED** для всех проверенных путей. `/api/db` проверяет `subscription_status` на каждый non-owner запрос; `/api/ai` проверяет план/`ai_enabled`; `/api/menu/[slug]` и `/api/menu/order` проверяют план перед отдачей меню/приёмом заказа; выдача `staff.apps` на платный модуль дополнительно сверяется с реальным entitlement через `checkStaffPlanLimit`.
**Evidence:** `app/api/db/route.ts:148-183,202-208`, `app/api/menu/[slug]/route.ts:59-63`, `app/api/menu/order/route.ts:89-94`.

### M1 — guest order endpoint доверяет клиентской цене/total
**NOT CONFIRMED — явно опровергнуто.** Сервер полностью игнорирует клиентские `total`/цену, пересчитывает всё из `menu_items` по id из БД, проверяет quantity bounds, принадлежность меню, dayparting-доступность на сервере, цену модификатора из БД. Списание остатка — compare-and-swap. Дедупликация двойного тапа — sha1-хэш заказа в 8-секундном окне. Один из наиболее укреплённых путей в проекте.
**Evidence:** `app/api/menu/order/route.ts:27-38,100-181`.

### M2 — guest-order UI показывает success раньше подтверждения backend
**NOT CONFIRMED.** `sendOrder()` ждёт `await fetch`, показывает success только после `res.ok`, при ошибке корзина не трогается. Комментарий в коде подтверждает: раньше баг был (аудит 2026-08-05), сейчас исправлен.
**Evidence:** `app/menu/[slug]/page.tsx:385-409`.

---

## Newly Discovered Issues

### MISE-001 — Salary-debt ledger: web/iOS divergence в видимости денег
**Severity:** Critical
**Category:** Financial / Architecture
**Platforms:** Web (есть) / Native (нет)
**Affected module:** Manager → Смена → Долги, Payroll

**Evidence:** commit `38d952f` ("payroll: salary debt ledger merged into expense-debt list"), сам commit message: *"iOS untouched — web only"*. `app/manager/tabs-salary.tsx` + `app/manager/page.tsx` материализуют непогашенный ЗП-долг прошлых месяцев как `shift_expenses`-запись (`is_paid=false`, `note=SALPERIOD:<period>`), слитую в общий список "Долги". `native/Mise/Mise/ManagerSalary.swift` продолжает показывать ЗП-долг отдельным, не связанным с `shift_expenses` механизмом.

**Current behavior:** owner на вебе видит прошломесячный неоплаченный ЗП-долг в общем списке долгов ресторана (наравне с expense-долгами). Тот же owner на iOS этой строки не видит вообще (или видит в другом, не связанном месте, если вообще видит).

**Expected behavior:** одна и та же денежная картина независимо от клиента.

**Real-world consequence:** owner может принять решение (например, "долгов нет, можно выплатить премию") на основании iOS, не зная о реальном долге, который показывает web — или наоборот, дважды посчитать один и тот же долг, если оба представления не синхронизированы концептуально.

**Reproduction:** открыть Manager→Смена→Долги на вебе при наличии непогашенного ЗП-долга за прошлый месяц → долг виден в общем списке. Открыть тот же экран на iOS → долга там нет / показан иначе.

**Root cause:** намеренный staged rollout (web готов, iOS — нет), задокументированный в самом коммите, а не забытый край.

**Needs owner decision:** YES — см. Вопросы, блок BLOCKING.

---

### MISE-002 — `persistDebtSettlements`: нет компенсации при partial failure
**Severity:** High
**Category:** Financial
**Platforms:** Web (native — не проверялось этим фор, но по паттерну вероятно то же)
**Affected module:** Manager → погашение долга

**Evidence:** `app/manager/page.tsx:334-359`. Три последовательные записи: (1) insert `salary_payments` для ЗП-долгов, (2) insert `shift_expenses` (settlement-строка на сегодня), (3) update исходной `shift_expenses`-строки (`is_paid: true`). Каждый шаг бросает исключение при ошибке, но **ничего не компенсирует** уже успешный шаг 1 при падении шага 2 или 3 — в отличие от соседнего `savePayment`, который явно откатывает компенсирующим delete.

**Current behavior:** при сбое (сетевой блип) на шаге 2/3 после успешного шага 1: сотрудник помечен "paid" в Payroll (remaining=0, `salary_payments`-запись есть), а исходная долг-строка в Manager остаётся `is_paid: false` (открыта) навсегда, и касса того дня никогда не отражает погашение (нет expense-строки, нет cash-out записи).

**Expected behavior:** либо все три шага применяются, либо ни один (DB transaction/RPC), либо явная компенсация как у `savePayment`.

**Real-world consequence:** тихое расхождение "оплачено согласно ЗП" vs "долг всё ещё открыт в кассовой книге" — вскрывается только вручную при сверке.

**Reproduction:** уронить сеть/сервер точно между шагом 1 и шагом 2 или 3 при погашении ЗП-долга через долг-леджер.

**Root cause:** отсутствие атомарности; несогласованность с соседней (уже защищённой) веткой кода `savePayment` в том же файле.

**Recommended fix:** либо серверный RPC (одна транзакция на все три записи), либо та же компенсирующая логика, что у `savePayment`.

**Risk of fix:** низкий — паттерн компенсации уже есть в этом же файле, копировать безопасно; RPC требует миграции и тестирования отдельно.

**Needs owner decision:** NO (инженерное решение).

---

### MISE-003 — У веба нет концепции операционного дня (`day_start_hour`)
**Severity:** High
**Category:** Data / Architecture
**Platforms:** Web (отсутствует) / Native (реализовано)
**Affected module:** Manager, Analytics, Bookings, Hub, Shifts

**Evidence:** grep по `app/` и `lib/` на `day_start_hour`/`dayStartHour`/`businessDate` — ноль совпадений. iOS полностью реализует это (`AppModel.swift:35` `businessDate()`), используется в Hub/Manager/Analytics/Bookings/Widget. Веб использует сырую календарную дату (`lib/format.ts:5` `fmtDate(new Date())`).

**Current behavior:** ресторан с `restaurant_settings.day_start_hour` (например 6 утра) и активностью после полуночи — iOS относит эту активность к предыдущему business-дню до 6 утра, веб уже считает её новым календарным днём сразу в полночь.

**Expected behavior:** единая логика операционного дня на обеих платформах.

**Real-world consequence:** `shifts` уникальны по `(restaurant_id, date)` — расхождение может расколоть одну рабочую ночь на два ряда `shifts` в зависимости от того, каким клиентом менеджер открыл/закрыл смену, ломая непрерывность выручки/расходов/закрывающего баланса этой ночи и дневные тоталы Analytics.

**Reproduction:** установить `day_start_hour=6`, открыть смену на iOS после полуночи, затем открыть Manager на вебе до 6 утра той же ночи — веб посчитает это другим днём, чем iOS.

**Root cause:** фича `day_start_hour` (миграция `day-start-hour-2026-07.sql`) была реализована только на iOS, веб не портирован.

**Needs owner decision:** YES — см. Вопросы, блок BLOCKING (насколько часто рестораны реально работают за полночь — это определяет приоритет).

---

### MISE-004 — Увольнение сотрудника на вебе не проверяет ошибку записи
**Severity:** High
**Category:** Security / Data
**Platforms:** Web
**Affected module:** Dashboard → Team

**Evidence:** `app/dashboard/(shell)/team/page.tsx:118-122`, функция `removePerson()`. Два последовательных `.update()` (`employees` и `staff.is_active=false`), ни один не проверяет `{ error }`.

**Current behavior:** если первый update пройдёт, а второй (`staff.is_active=false`) упадёт — UI всё равно вызывает `load()`, сотрудник пропадает из HR-списка. Но `staff`-запись остаётся `is_active: true`.

**Expected behavior:** ошибка должна прерывать операцию и показывать её пользователю; UI не должен считать увольнение успешным, пока обе записи не подтверждены.

**Real-world consequence:** серверный revocation-gate (`lib/apiAuth.ts` `staffTokenRevoked`) работает корректно, но только если запись реально обновилась. При этом сбое уволенный сотрудник продолжает работать с активным PIN/устройством, хотя менеджер уверен, что уволил его.

**Reproduction:** уронить сеть/сервер между первым и вторым update внутри `removePerson()`.

**Root cause:** отсутствие проверки `error` на write-операциях.

**Needs owner decision:** NO.

---

### MISE-005 — Нет подтверждения перед деактивацией сотрудника на вебе
**Severity:** High
**Category:** UX / Security
**Platforms:** Web (iOS — есть паттерн `confirmationDialog` для похожих destructive-операций)
**Affected module:** Dashboard → Team

**Evidence:** `app/dashboard/(shell)/team/page.tsx:224` — кнопка `variant="danger"` вызывает `removePerson(emp)` напрямую, без `confirm()`/диалога. Для сравнения: iOS использует `confirmationDialog` для удаления брони, гостя, движения склада, KPI, новости, задачи (`BookingsView.swift:454,1152`, `GuestsView.swift:203,457`, `StashView.swift:796,1824`, `NewsView.swift:193`, `PeopleTasksSalary.swift:25`) — увольнение сотрудника на вебе в этот паттерн не попало.

**Current behavior:** один случайный клик мгновенно деактивирует доступ и PIN сотрудника.

**Expected behavior:** подтверждение перед необратимым/тяжело обратимым действием, как везде на iOS.

**Real-world consequence:** случайное увольнение действующего сотрудника (fat-finger на мобильном вебе, клик не туда в списке).

**Needs owner decision:** NO.

---

### MISE-006 — Lost-update race на `tobacco_stock.quantity_g`
**Severity:** High
**Category:** Data / Financial (склад = деньги)
**Platforms:** Web и Native (одинаковый паттерн)
**Affected module:** Stash

**Evidence:** `app/tobacco/page.tsx:522-582` (`saveMov`) и аналог на iOS. Читается снэпшот `tobacco_stock` (`freshStock`), дельта считается на клиенте, пишется **абсолютное** значение (`quantity_g: base.quantity_g + delta`) — не атомарный SQL-инкремент и не RPC, нет optimistic-lock колонки (`updated_at` пишется, но не используется в `WHERE`).

**Current behavior:** два сотрудника на разных устройствах, записывающих движение по одному бренду/вкусу почти одновременно, оба читают один и тот же `base.quantity_g`; второй write молча перезаписывает эффект первого. Сама запись в `tobacco_movements` (append-only) не теряется — теряется только её отражение в денормализованном остатке.

**Expected behavior:** атомарный инкремент (`quantity_g = quantity_g + $delta` на уровне SQL) или optimistic lock.

**Real-world consequence:** склад расходится с реальностью без единого сообщения об ошибке кому-либо; узнаётся только на следующей инвентаризации.

**Reproduction:** два клиента почти одновременно сохраняют разные движения по одной и той же строке `tobacco_stock`.

**Root cause:** денормализованный `quantity_g`, вычисляемый read-modify-write на клиенте вместо серверного инкремента.

**Recommended fix:** RPC/SQL-функция `UPDATE tobacco_stock SET quantity_g = quantity_g + $delta WHERE ...` вместо чтения+записи абсолютного значения.

**Needs owner decision:** NO.

---

### MISE-007 — Компенсирующий rollback зарплаты сам не проверяет свою ошибку
**Severity:** Medium
**Category:** Financial
**Platforms:** Native (iOS)
**Affected module:** Payroll

**Evidence:** `native/Mise/Mise/ManagerSalary.swift:400` — компенсирующий `try? await DB.from("salary_payments").delete()...` обёрнут в `try?`, ошибка не проверяется.

**Current behavior:** если именно rollback-delete упадёт — остаётся `salary_payments`-запись без соответствующего движения по кассе: "оплачено" зафиксировано, а реальное списание/выдача не произошли.

**Expected behavior:** ошибка компенсации должна как минимум логироваться и показываться пользователю как явный alert "проверьте вручную", а не проглатываться.

**Real-world consequence:** редкий, но реальный edge-case (сбой поверх сбоя) — на следующей проверке сотрудник числится оплаченным без факта оплаты.

**Needs owner decision:** NO.

---

### MISE-008 — Ни в одном денежном пути нет реальной DB-транзакции/RPC
**Severity:** Medium
**Category:** Architecture
**Affected module:** Manager (`persistShift`), Payroll, Stash

**Evidence:** `app/manager/page.tsx:361-438` — `persistShift` — это цепочка из 6+ последовательных нетранзакционных записей (update shifts → insert debt settlements → rebuild expenses → upsert inkassation → update absences). Каждый шаг индивидуально управляет своим partial-failure (delta-merge, insert-перед-delete), но само по себе это управление симптомами, а не устранение возможности partial state.

**Current behavior:** система работает благодаря тщательно продуманным компенсациям на каждом шаге по отдельности — не благодаря атомарности.

**Expected behavior:** для по-настоящему критичных цепочек (закрытие смены, выплата ЗП) — серверная транзакция/RPC.

**Real-world consequence:** архитектурный риск, не активный баг сейчас — но каждая новая фича в этой цепочке добавляет ещё одну точку, где partial failure нужно продумывать вручную.

**Needs owner decision:** NO (инженерное направление, не блокирует текущие фиксы).

---

### MISE-009 — `try? ?? []` маскирует сетевые сбои как "долгов нет" в Analytics (iOS)
**Severity:** Medium
**Category:** Financial / UX
**Platforms:** Native (iOS)
**Affected module:** Analytics

**Evidence:** `native/Mise/Mise/AnalyticsView.swift:658,661,668` — паттерн `(try? await DB.from(...).list(...)) ?? []` на критичных данных (unpaid/settled `shift_expenses`, даты смен).

**Current behavior:** сбой сети/сервера тихо превращается в пустой список — Analytics показывает "0 непогашенных долгов", хотя запрос просто не выполнился.

**Expected behavior:** различать "долгов реально нет" от "не удалось загрузить" — как минимум визуальный индикатор ошибки, а не молчаливый fallback на пустой массив.

**Real-world consequence:** owner получает ложное финансовое спокойствие вместо честного "не удалось проверить".

**Примечание:** паттерн `try? ... ?? []`/`try? ... ?? default` встречается ~236 раз по всему native-коду разной критичности — здесь указаны только денежные места; полная зачистка паттерна не входит в этот аудит.

**Needs owner decision:** NO.

---

### MISE-010 — Восьмёрка (walk-eight): admin CRUD только на iOS
**Severity:** Medium
**Category:** Architecture / Feature parity
**Platforms:** Web (нет) / Native (есть)
**Affected module:** People / Manager → Настройки

**Evidence:** `app/people/audits.tsx:1115` — прямой комментарий: *"read-only история, создание/прохождение только в iOS"*. На вебе нет ни одного пути создать/отредактировать/пройти шаблон Восьмёрки. iOS имеет полный `ManagerWalkModel`/`WalkEditSheet`.

**Current behavior:** owner, работающий только из браузера, не может ни настроить, ни запустить Восьмёрку.

**Real-world consequence:** функциональная асимметрия, не баг данных — но реальное ограничение продукта для web-only пользователей.

**Needs owner decision:** YES — приоритет, см. Вопросы NON-BLOCKING.

---

### MISE-011 — `/api/ai` не проверяет revocation сотрудника
**Severity:** Medium
**Category:** Security
**Platforms:** Web/Backend
**Affected module:** AI Advisor

**Evidence:** `app/api/ai/route.ts:7-22` (`getRestaurantId`) вызывает `verifyStaffToken()` напрямую, минуя `resolveCaller`/`staffTokenRevoked`.

**Current behavior:** уволенный сотрудник с валидной 10-летней подписанной кукой может продолжать дёргать `/api/ai` бесконечно после увольнения.

**Real-world consequence:** эндпоинт не читает/не пишет бизнес-данные, только конвертирует речь в JSON-подсказку под rate-limit 20/мин — реальный риск ограничен расходом AI-квоты, не утечкой данных.

**Recommended fix:** заменить прямой `verifyStaffToken()` на `resolveCaller()`, как везде.

**Needs owner decision:** NO.

---

### MISE-012 — Два параллельных пути загрузки фото аудита
**Severity:** Medium
**Category:** Architecture / Security (needs clarification)
**Platforms:** Web
**Affected module:** People → Аудиты

**Evidence:** `app/people/audits.tsx:91-93` грузит фото напрямую через `supabase.storage.from('restaurant-assets').upload()` с anon key с клиента, минуя `/api/storage/audit-photo`, который (судя по собственному комментарию в коде) существует именно для этой операции через `resolveCaller`.

**Current behavior:** неясно, какой путь реально активен в UI и совпадает ли Storage policy на bucket с ожидаемым restaurant-scoping для прямого пути.

**Real-world consequence:** если прямой anon-путь активен и Storage policy недостаточно узкая — потенциальная запись/чтение фото не по своему ресторану. Не подтверждено как эксплуатируемая уязвимость — только как архитектурная нестыковка, требующая проверки.

**Needs owner decision:** NO по сути (инженерное решение — консолидировать на gateway-путь), но перед фиксом нужно подтвердить, что на клиенте больше нигде реально не используется старый путь.

---

### MISE-013 — Нет подтверждённого unique constraint на `tobacco_stock(restaurant_id, brand, flavor)`
**Severity:** Medium (unconfirmed без доступа к live-схеме)
**Category:** Database
**Affected module:** Stash

**Evidence:** просмотрены все доступные миграции/схема-докс — constraint не найден. `saveMov` для нового бренда/вкуса, отсутствующего в `freshStock`, делает обычный `insert` (`app/tobacco/page.tsx:574-575`).

**Current behavior (гипотетическое):** два одновременных первых прихода одного нового вкуса на разных устройствах могут создать два ряда `tobacco_stock` для одной позиции, раскалывая остаток за разными lookup'ами.

**Needs owner decision:** NO, но требуется прямая проверка в Supabase Dashboard (`\d tobacco_stock` / информация о constraints) — из репозитория это не подтверждается и не опровергается окончательно.

---

### MISE-014 — Нет подтверждённого CHECK на неотрицательность `tobacco_stock.quantity_g`
**Severity:** Medium (unconfirmed)
**Category:** Database
**Affected module:** Stash

**Evidence:** защита от отрицательного остатка — только `Math.max(0, ...)` на клиенте (`saveMov`, `saveInv`). CSV-дамп колонок не показывает constraints (только колонки), поэтому это не окончательное доказательство отсутствия.

**Needs owner decision:** NO, требуется прямая проверка схемы в Supabase.

---

### MISE-015 — CAS retry exhaustion при выплате ЗП показывает опаковую ошибку
**Severity:** Low
**Category:** UX
**Affected module:** Payroll

**Evidence:** compare-and-swap retry на `inkassations` при легитимной параллельной записи (например, одновременный аванс) исчерпывает попытки и показывает generic "race"-ошибку без автоматического восстановления.

**Real-world consequence:** менеджер должен вручную повторить операцию; сама целостность данных не нарушена (CAS корректно предотвращает порчу строки).

**Needs owner decision:** NO.

---

### MISE-016 — История прохождений чек-листа недоступна из Manager
**Severity:** Low
**Category:** UX / dead code
**Platforms:** Web и Native
**Affected module:** People/Manager → Чек-листы

**Evidence:** согласно `docs/MANAGER-PEOPLE-RESTRUCTURE-2026-08-13.md` (собственное утверждение автора реструктуризации, не переверено построчно этим аудитом): `ChecklistHistorySheet` (iOS) — orphaned, не подключён ни к одному экрану Manager после реструктуризации.

**Real-world consequence:** менеджер не может посмотреть историю прошлых прохождений чек-листа — UX-пробел, не data-баг.

**Needs owner decision:** NO.

---

### MISE-017 — `resetDevice()` не проверяет ошибку записи
**Severity:** Low
**Category:** Data
**Platforms:** Web
**Affected module:** Dashboard → Team

**Evidence:** `app/dashboard/(shell)/team/page.tsx:123` — тот же паттерн, что MISE-004, но для сброса привязки устройства.

**Real-world consequence:** сброс устройства может тихо не примениться; сотрудник продолжит входить со старого устройства, менеджер уверен, что сбросил.

**Needs owner decision:** NO.

---

### MISE-018 — Разрозненные пустые catch-блоки
**Severity:** Low
**Category:** Data
**Affected module:** разное (web)

**Evidence:** 15+ мест `catch {}` без действия — `app/page.tsx:26,37`, `app/join/page.tsx:69`, `app/tobacco/page.tsx:443`, `app/dashboard/(shell)/team/page.tsx:62` и др. Большинство — некритичные best-effort операции (analytics ping, clipboard, localStorage).

**Отдельно отмечено:** `catch {}` в `app/api/stripe/{webhook,portal,update,cancel}/route.ts` — billing-путь, заслуживает отдельной прицельной проверки (вне зоны этого прохода, не входил в scope финансового фор — фиксирую как пробел покрытия аудита).

**Needs owner decision:** NO для основной массы; billing-роуты — да, требуют отдельного взгляда до фикса.

---

### MISE-019 — Дублирующийся 30-секундный polling в People
**Severity:** Low
**Category:** Performance
**Affected module:** People → Операции

**Evidence:** `app/people/tabs-ops.tsx:123` и `:344` — два независимых 30s-интервала внутри одного модуля; не проверено, монтируются ли оба одновременно на одном экране (если да — двойной polling впустую).

**Needs owner decision:** NO.

---

## Cross-platform parity matrix

| Feature | Web | iOS | Logic same? | Data same? | Bug risk |
|---|---|---|---|---|---|
| Manager tab structure (Смена/Зарплата/Настройки/Дисциплина) | ✓ | ✓ | Да | Да | Low |
| Salary payout (cash) формула + CAS retry | ✓ | ✓ | Да | Да | Low |
| Salary-debt-as-shift_expenses леджер | ✓ (реализовано) | ✗ (не реализовано) | **Нет** | **Нет** | **Critical (MISE-001)** |
| day_start_hour / операционный день | ✗ (отсутствует) | ✓ (полный) | **Нет** | **Нет** | **High (MISE-003)** |
| Восьмёрка admin CRUD | ✗ (read-only) | ✓ (полный) | Нет | N/A | Medium (MISE-010) |
| Дисциплина tab | ✓ | ✓ | Да (дословный перенос) | Да | Low |
| Чек-лист: редактирование шаблона (kind=shift) | ✓ | ✓ | Да | Да | Low |
| Чек-лист: grading/верификация | ✓ (переиспользует ChecklistCard) | ✓ (упрощён: нет фото/report-a-problem) | Частично | Да | Low-Medium |
| История прохождений чек-листа (из Manager) | не проверено отдельно | orphaned (MISE-016) | N/A | N/A | Low |
| Статусы брони (bucketing) | ✓ | ✓ | Да | Да | Low |
| Free-hookah category resolution | ✓ | ✓ | Да | Да | Low |
| Analytics: только read-only (без write-действий) | ✓ | ✓ | Да | Да | Low |
| Заявки (reports) inbox | ✓ | ✓ | Да (не переверено построчно) | Не переверено | Low |
| Расписание (schedule builder) | ✓ (переиспользует components/people/ScheduleTab) | ✓ | Да (не переверено построчно) | Не переверено | Low |
| Guest order pricing/idempotency | ✓ (server source of truth) | N/A (guest-only, веб) | — | — | Low |
| Auth/revocation coverage по эндпоинтам | почти везде via `resolveCaller` | — | Почти | — | Medium (MISE-011, один эндпоинт-исключение) |

Строки "не переверено построчно" отражают ограничение глубины конкретного прохода аудита, не подтверждённую проблему — при необходимости owner может запросить точечный re-check.

---

## Financial reconciliation findings

**Scenario A** (Revenue 1000 / Cash 600 / Card 400 / Expenses 200 / Debt 100): расхождений не найдено. Долг сознательно исключён из cash-влияющих тоталов (комментарий в коде: "«В долг» — не покидал кассу сегодня"), показан отдельно в леджере долгов. Manager/Analytics/Cash/Debts согласованы.

**Scenario B** (Salary 500 / 200 cash / 100 card / 50 advance / 150 outstanding): формула `totalCash = max(0, salary − absenceDeduct) − advance − card` подтверждена идентичной через shared-функцию `computeAccruedToday` на web Manager, web Analytics и iOS (People использует тот же источник `deduct_per_absence`). Полная параллель.

**Scenario C** (долг 300 создан вчера, погашен сегодня): прослежен полный жизненный цикл — вчерашняя `shift_expenses`-строка (`is_paid=false`) исключена из вчерашнего `total_expense`/кассы (правильно — деньги не покидали кассу вчера); при погашении вставляется новая settlement-строка на сегодня, исходная помечается `is_paid:true, paid_shift_id:today` (но `shift_id` остаётся "вчера"). Сегодняшний `total_expense` включает 300 через `debtSettleTotal()` — касса сегодня корректно уменьшена. История долгов (`periodDebtHistory`) атрибутирует запись к вчерашней дате, а rollup считает деньги в сегодняшней категории — двойного счёта или потери не найдено. Хорошо спроектированная двухрядная модель.

**Отдельно (не сценарий, а найденный по ходу разбора риск):** сама цепочка погашения долга (`persistDebtSettlements`) не защищена от partial failure — см. MISE-002. Сценарии A/B/C проверяют *happy path* формул; MISE-002 — про *что если сеть упадёт посередине*.

---

## Permission/security matrix

| Path | Auth mechanism | Revocation checked? | Entitlement checked? | Notes |
|---|---|---|---|---|
| `/api/db` (основной шлюз) | `resolveCaller` (staff token / owner session / admin-view) | Да | Да (`subscription_status`, `checkStaffPlanLimit`) | Billing-поля явно заблокированы (`BILLING_ONLY_COLUMNS`) |
| `/api/notify` | `resolveCaller` | Да | — | |
| `/api/bank/*` | `resolveCaller` | Да | — | Пишет только сервер, клиент read-only на связанные таблицы |
| `/api/storage/audit-photo` | `resolveCaller` | Да | — | См. MISE-012: параллельный anon-путь на клиенте, требует проверки |
| `/api/google-reviews/sync-now` | `resolveCaller` | Да | — | |
| `/api/ai` | `verifyStaffToken` напрямую | **Нет (MISE-011)** | Да (план/`ai_enabled`) | Impact ограничен (AI-квота, не данные) |
| `/api/menu/import`, `/api/menu/translate` | `verifyStaffToken` напрямую | N/A (owner-only токены, revocation не применим к owner) | — | Не находка — owner исключён из revocation по определению |
| `/api/menu/[slug]`, `/api/menu/order` | anon (осознанно, guest-facing) | N/A | Да (план ресторана перед отдачей меню/приёмом заказа) | Серверный пересчёт цены, CAS на остаток, idempotency-хэш |
| `/api/admin` | email-сверка с `ADMIN_EMAIL` | — | — | Impersonation логируется в `admin_notes` (прошлый фикс, подтверждён) |
| RLS на Postgres-уровне | deny-all по умолчанию (`docs/security/rls.sql`) | — | — | Архитектурно верно: вся реальная авторизация — в коде шлюза, не в RLS. **Не подтверждено из репозитория, что `rls.sql` реально применена на live Supabase** — требует проверки в Dashboard |

---

## Database integrity findings

- **RLS архитектура** (`docs/security/rls.sql`): deny-all по умолчанию на всех бизнес-таблицах, кроме двух узких self-read policy (`restaurants`, `profiles`). Вся реальная авторизация — в `/api/db`. Это осознанный и надёжный паттерн, не пробел — **при условии, что миграция реально накатана на живой базе** (см. выше, не проверяемо из кода).
- **`tobacco_stock`**: нет атомарного инкремента (MISE-006), не подтверждён unique constraint на `(restaurant_id, brand, flavor)` (MISE-013), не подтверждён CHECK на неотрицательность (MISE-014).
- **Orphan records / cascade**: не найдено конкретных проблем в проверенных Stash-миграциях за время этого прохода; полный обзор всех таблиц не проводился (см. ограничения ниже).
- **Мутируемость исторических финансовых записей**: не обнаружено отдельного механизма запрета редактирования прошлых `shift_expenses`/`salary_payments`/`inkassations` задним числом на уровне БД — контроль, судя по всему, только на уровне UI/потока приложения. Не подтверждено как активный баг (не найден путь, которым владелец реально редактирует прошлое), но стоит держать в уме.
- **`bank_connections`/`bank_transactions`**: RLS enable в собственной миграции (`bank-integration-2026-08.sql`), не в `rls.sql` — согласуется с тем, как обработаны `salary_payments`/`google_reviews` (задокументировано в `rls.sql:84-89`), не оплошность.

---

## Product architecture observations

Прочитан `docs/MANAGER-PEOPLE-RESTRUCTURE-2026-08-13.md` целиком и сверен с фактически закоммиченным кодом (не принят на веру) — модель подтверждена как реально реализованная:

- **People** = чисто личная зона, даже для менеджера. Своё расписание/статус ЗП/задачи/чек-листы/заявки. Без админ-контролей, без видимости чужих данных.
- **Manager** = операционное управление: 4 вкладки (Смена/Зарплата/Настройки/Дисциплина), доступно owner/manager/admin.
- **Analytics** = read-only отчётность, намеренно лишена write-действий (перенесены в Manager).

Это реальная, уже исполненная миграция архитектуры — не "как должно быть", а "как есть". Кажущееся дублирование (`ManagerSalaryModel` vs урезанный `PeopleModel`, аналогично для Восьмёрки) — **осознанное решение владельца** при реструктуризации, не техдолг для рефакторинга. Не предлагаю его трогать.

Единственное реальное архитектурное расхождение с этой моделью — MISE-001: слияние ЗП-долга в леджер долгов сделано только на вебе, что на практике временно нарушает принцип "одна денежная картина везде" до того, как iOS догонит.

---

## Questions for Owner

### BLOCKING — нужны до любого исправления

1. **MISE-001 (ЗП-долг-леджер).** Пока iOS не обновлён — что должен видеть owner на вебе: текущее поведение (долг уже виден в общем леджере) или временно скрыть эту часть, чтобы обе платформы хотя бы одинаково "не знали" о ней до готовности iOS? Или это допустимый временный gap на период разработки, и просто нужно ускорить iOS-часть?

2. **MISE-003 (операционный день на вебе).** Нужно ли вебу получить ту же логику `day_start_hour`, что у iOS? Насколько часто рестораны реально работают за полночь — это определяет, Critical это на практике или редкий edge-case, который можно отложить.

3. **MISE-002 (зависшее погашение долга при сбое сети).** Если такая ситуация всё же случится (paid в Payroll, но открыт в Manager-долгах, без кассовой записи) — система должна автоматически пытаться ресинхронизироваться при следующей загрузке, или достаточно явного alert владельцу/менеджеру для ручной сверки?

### NON-BLOCKING — можно принять безопасное инженерное решение самостоятельно

- MISE-004, MISE-005, MISE-006, MISE-011, MISE-017 — очевидные технические фиксы (проверка ошибок, confirm-диалог, атомарный инкремент, единый auth-путь), не требуют бизнес-решения.
- MISE-012 (два пути загрузки фото) — по умолчанию консолидирую на gateway-путь, если владелец не укажет причину, по которой прямой путь нужен отдельно.
- MISE-010 (Восьмёрка на вебе) — это вопрос приоритета роадмапа, не корректности; предлагаю обсудить в рамках обычного планирования, а не как блокер этого аудита.
- MISE-013, MISE-014 — требуют не решения, а факта: прошу владельца (или меня с доступом) свериться напрямую в Supabase Dashboard/SQL, есть ли эти constraints на live-базе.
- **Отдельно к сведению, не вопрос:** не могу подтвердить из репозитория, что `docs/security/rls.sql` реально применена на живом Supabase-проекте. Если ещё не применена — это выше severity Critical для всего проекта разом (это единственная строка обороны, если `/api/db`-шлюз когда-либо будет обойдён). Прошу подтвердить в Supabase Dashboard.

---

## Ограничения этого прохода

- Не проверялась Native-сторона MISE-002, MISE-004, MISE-005, MISE-017 (форк, покрывавший эти находки, работал в основном по web-коду) — вероятна аналогичная картина, но не подтверждена построчно.
- Не проверялась вся `staff_tasks`/`staff_reports`/`shift_swap_requests`/`push_subscriptions` цепочка на predicate-глубину, только по касательной через gateway POLICY.
- Полный `grep -rn "supabase\.from(" app components` по всему репозиторию не выполнен целиком — точечно проверены ключевые экраны (team, shifts, manager, analytics, people/audits); не исключено, что где-то ещё остался прямой anon-доступ вне шлюза.
- Billing-роуты (`app/api/stripe/*`) не проверялись отдельным глубоким проходом — только зафиксирован пустой catch как повод для отдельного взгляда (MISE-018).
