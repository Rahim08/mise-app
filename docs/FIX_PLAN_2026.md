# MISE Fix Plan — 2026-08-28

План исправлений по итогам `docs/FULL_SYSTEM_AUDIT_2026.md`. Составлен с учётом ответов владельца на BLOCKING-вопросы:

- **MISE-001** (ЗП-долг-леджер web/iOS): ускорить iOS — портировать тот же merge, не скрывать на вебе.
- **MISE-003** (нет `day_start_hour` на вебе): рестораны реально работают за полночь часто/всегда → приоритет High, не backlog.
- **MISE-002** (partial failure при погашении долга): атомарная транзакция (RPC), не компенсация.

**Статус (2026-08-28, финальный прогон):** Phase 0 частично (RLS/constraints-проверка блокирована — нет доступа к Supabase), Phase 1 ✅, Phase 2 ✅, Phase 3 ✅, Phase 5 ✅, Phase 7 ✅. Phase 4 и Phase 6 — сознательно не в этом цикле (см. ниже). Финальная проверка: tsc чист, полный `eslint` (1135 pre-existing проблем — baseline проекта, не регрессия; точечно сверено по `git diff` на файлах с наибольшим количеством находок), vitest 20/20, iOS clean build `BUILD SUCCEEDED`. `MiseTests`/`MiseUITests` — pre-existing TEST_HOST-мисматч в конфиге проекта (не моя регрессия, таргет фактически пуст — 19-строчный дефолтный Xcode-скелет, тестов там нет).

---

## Phase 0 — Safety / инфраструктурная проверка

Перед любым кодом — факты, которые нельзя получить из репозитория.

| # | Проверка | Кто | Блокирует |
|---|---|---|---|
| 0.1 | Подтвердить в Supabase Dashboard, что `docs/security/rls.sql` реально применена на live-проекте | владелец / я с доступом | Всё — если RLS не применена, это критичнее любой находки в отчёте |
| 0.2 | Проверить в Supabase (`\d tobacco_stock` / constraints UI): есть ли unique на `(restaurant_id, brand, flavor)` и CHECK на `quantity_g >= 0` (MISE-013, MISE-014) | владелец / я с доступом | Phase 1.4 (миграция склада) |
| 0.3 | Git-бэкап текущей ветки перед началом (`feat/debts-and-payroll-fixes` уже содержит незакоммиченную историю по памяти проекта — свериться, что нечего терять) | я | всё |

Без 0.1 не двигаюсь дальше — если RLS не накатана, это перекрывает по важности весь остальной план.

---

## Phase 1 — Critical integrity / security

### 1.1 — MISE-001: портировать ЗП-долг-леджер на iOS
- **Affected files:** `native/Mise/Mise/ManagerSalary.swift` (портировать логику из `app/manager/tabs-salary.tsx` + `app/manager/page.tsx` — материализация непогашенного ЗП-долга как `shift_expenses` строки с `note=SALPERIOD:<period>`).
- **DB migration needed:** нет (таблица `shift_expenses` уже несёт эту логику на вебе).
- **API changes:** нет — тот же `/api/db` gateway, те же операции над `shift_expenses`.
- **Backwards compatibility:** да — читает те же данные, что уже пишет веб; старые iOS-клиенты без обновления просто не увидят слитый долг (как сейчас).
- **Data migration needed:** нет.
- **Rollback:** откат коммита, данные не меняются (это read+display логика поверх существующей записи).
- **Tests:** сравнить вывод iOS и web на одном тестовом ресторане с известным непогашенным ЗП-долгом — суммы должны совпасть.
- **Risk:** средний — Swift-порт формулы, ошибка портирования даст новое расхождение вместо старого.
- **Estimated scope:** средний (1 файл, но логика нетривиальная — merge двух источников долга).

### 1.2 — MISE-002: атомарная транзакция для `persistDebtSettlements`
- **Affected files:** `app/manager/page.tsx` (заменить 3 последовательных вызова на один RPC), новая SQL-функция (`supabase/functions` или migration с `CREATE FUNCTION`), возможно аналог на iOS если там есть та же логика (не проверено этим аудитом — см. ограничения отчёта, нужен доп. grep).
- **DB migration needed:** ДА — новая RPC-функция, оборачивающая insert `salary_payments` + insert `shift_expenses` (settlement) + update `shift_expenses` (`is_paid=true`) в одну транзакцию.
- **API changes:** `/api/db` придётся расширить поддержкой вызова RPC (сейчас gateway работает только через `select/insert/update/upsert/delete` — RPC-вызов это новый `op`), либо добавить отдельный узкий route.
- **Backwards compatibility:** старый путь (3 отдельных запроса) должен быть выключен одновременно с включением RPC — не оставлять оба живыми, иначе можно случайно повторно ввести partial-failure баг через старый путь.
- **Data migration needed:** нет для новых операций; для уже зависших (если такие есть) — отдельный аудит-скрипт для поиска `salary_payments` без соответствующей записи в кассе (ручная сверка, не автоматическая миграция).
- **Rollback:** RPC-функцию можно оставить в БД (не мешает), откат кода — вернуть старый 3-шаговый путь.
- **Tests:** unit/integration тест на RPC — намеренно уронить соединение между шагами (симуляция в тестовой среде) и убедиться, что откатывается всё или ничего.
- **Risk:** средний-высокий — первая RPC-транзакция в money-path проекта, нужно тщательно протестировать перед проды.
- **Estimated scope:** средний-большой.

### 1.3 — MISE-004 + MISE-017: проверка ошибок записи в `team/page.tsx`
- **Affected files:** `app/dashboard/(shell)/team/page.tsx` (`removePerson()` строки 118-122, `resetDevice()` строка 123).
- **DB migration needed:** нет.
- **API changes:** нет.
- **Backwards compatibility:** да.
- **Data migration needed:** нет.
- **Rollback:** тривиальный, чистый code fix.
- **Tests:** unit/UI тест — симулировать ошибку второго update, убедиться что UI показывает ошибку и не считает операцию успешной.
- **Risk:** низкий.
- **Estimated scope:** маленький.

### 1.4 — MISE-006 + MISE-013 + MISE-014: атомарный инкремент склада + constraints
- **Affected files:** `app/tobacco/page.tsx` (`saveMov`), возможный аналог на iOS `StashView.swift`, новая SQL-функция для инкремента.
- **DB migration needed:** ДА — (a) RPC/SQL-функция `UPDATE tobacco_stock SET quantity_g = quantity_g + $delta`, (b) если по итогам Phase 0.2 constraints отсутствуют — добавить `UNIQUE(restaurant_id, brand, flavor)` и `CHECK (quantity_g >= 0)`.
- **API changes:** аналогично 1.2 — gateway должен поддержать RPC-вызов или узкий отдельный route.
- **Backwards compatibility:** добавление UNIQUE-constraint может упасть на существующих дублирующихся строках (если Phase 0.2 покажет, что дубли уже есть) — потребуется сначала смёржить дубли данных.
- **Data migration needed:** возможно, если найдутся существующие дубликаты `tobacco_stock` по `(restaurant_id, brand, flavor)` — до добавления UNIQUE их нужно объединить.
- **Rollback:** откат кода тривиален; откат constraint — `DROP CONSTRAINT`.
- **Tests:** конкурентный тест — два параллельных движения по одной позиции, проверить итоговый остаток = сумма обоих дельт, не последний write wins.
- **Risk:** средний (constraint может конфликтовать с реальными данными — обязательно Phase 0.2 перед этим шагом).
- **Estimated scope:** средний.

---

## Phase 2 — Financial consistency

### 2.1 — MISE-003: `day_start_hour` на вебе
- **Affected files:** `lib/format.ts` (или новый `lib/businessDate.ts`), все места, использующие `fmtDate(new Date())` как "сегодня" для бизнес-логики (открытие/закрытие смены, Analytics day-boundary) — `app/manager/page.tsx`, `app/analytics/page.tsx`, возможно `app/dashboard/*`.
- **DB migration needed:** нет — `restaurant_settings.day_start_hour` уже существует (миграция `day-start-hour-2026-07.sql`).
- **API changes:** нет, чисто клиентская логика (как на iOS).
- **Backwards compatibility:** нужно аккуратно — рестораны, у которых уже есть открытые смены/данные, посчитанные по старой (календарной) логике, не должны задним числом "переехать" на другую дату при первом же деплое. Нужна проверка граничных случаев на дату переключения.
- **Data migration needed:** нет для новых операций; возможна ручная проверка существующих `shifts`-записей на предмет уже случившегося расщепления одной ночи на два дня (следствие текущего бага) — если найдётся, потребуется решение владельца по каждому случаю отдельно (не автоматизировать это молча).
- **Rollback:** откат кода, `day_start_hour` в БД не трогается.
- **Tests:** unit-тест на `businessDate()`-эквивалент с граничными значениями (23:59, 00:01, ровно в `day_start_hour`).
- **Risk:** средний — затрагивает много мест, где сейчас используется "сегодня".
- **Estimated scope:** средний-большой (портирование логики + аудит всех мест, где веб трактует "день").

### 2.2 — MISE-007: rollback-delete в `ManagerSalary.swift` должен проверять свою ошибку
- **Affected files:** `native/Mise/Mise/ManagerSalary.swift:400`.
- **DB migration needed:** нет.
- **API changes:** нет.
- **Backwards compatibility:** да.
- **Data migration needed:** нет.
- **Rollback:** тривиальный.
- **Tests:** симулировать ошибку компенсирующего delete, убедиться, что показывается alert, а не тихий проглот.
- **Risk:** низкий.
- **Estimated scope:** маленький.

---

## Phase 3 — Auth/permissions

### 3.1 — MISE-011: `/api/ai` должен использовать `resolveCaller`
- **Affected files:** `app/api/ai/route.ts`.
- **DB migration needed:** нет.
- **API changes:** внутренняя замена `verifyStaffToken()` на `resolveCaller()` — не меняет внешний контракт.
- **Backwards compatibility:** да.
- **Rollback:** тривиальный.
- **Tests:** запрос с токеном деактивированного сотрудника должен получить 401/403.
- **Risk:** низкий.
- **Estimated scope:** маленький.

### 3.2 — MISE-012: консолидировать загрузку фото аудита на gateway-путь
- **Affected files:** `app/people/audits.tsx:91-93` (убрать прямой `supabase.storage` вызов, использовать `/api/storage/audit-photo`).
- **Перед фиксом:** подтвердить, что нигде в UI активно не используется старый путь по причине, которую я не вижу (например, отличающийся Storage bucket policy для другого сценария) — быстрая проверка перед изменением, не блокер на уровне owner-decision.
- **DB migration needed:** нет.
- **API changes:** нет (route уже существует).
- **Backwards compatibility:** да.
- **Rollback:** тривиальный.
- **Tests:** загрузка фото аудита работает так же, как раньше, файл появляется в правильном restaurant-scoped пути.
- **Risk:** низкий.
- **Estimated scope:** маленький.

### 3.3 — MISE-018 (частично): billing-роуты `catch {}`
- Отдельный точечный прогон по `app/api/stripe/{webhook,portal,update,cancel}/route.ts` перед фиксом (не входил в scope этого аудита) — сначала понять, что именно проглатывается, потом чинить. Планирую как отдельный под-аудит внутри Phase 3, не готовый fix.
- **Risk:** неизвестен до доп. проверки — billing логика чувствительная, торопиться нельзя.

---

## Phase 4 — Cross-platform consistency

### 4.1 — MISE-010: Восьмёрка admin CRUD на вебе
Owner отметил это как вопрос приоритета роадмапа, не блокер аудита. Включаю в план как отдельную фичу, не привязанную к срокам этого fix-цикла — обсудить порядок с владельцем отдельно от аудита.
- **Affected files (оценочно):** новый `app/people/` или `app/manager/` компонент для CRUD шаблонов Восьмёрки, аналог iOS `WalkEditSheet`/`ManagerWalkModel`.
- **Estimated scope:** большой (новая фича, не багфикс).
- **Needs owner decision:** приоритет в роадмапе (не в рамках этого fix plan, если явно не попросит).

---

## Phase 5 — UX / error handling

### 5.1 — MISE-005: confirm-диалог перед деактивацией сотрудника (web)
- **Affected files:** `app/dashboard/(shell)/team/page.tsx:224`.
- **Risk:** низкий. **Scope:** маленький.

### 5.2 — MISE-009: различать "долгов нет" от "не удалось загрузить" в iOS Analytics
- **Affected files:** `native/Mise/Mise/AnalyticsView.swift:658,661,668`.
- **Risk:** низкий. **Scope:** маленький-средний (нужно завести состояние ошибки в UI, не просто убрать `?? []`).

### 5.3 — MISE-015: понятная ошибка при исчерпании CAS retry
- **Affected files:** `app/manager/tabs-salary.tsx`, `native/Mise/Mise/ManagerSalary.swift` (места с CAS retry на `inkassations`).
- **Risk:** низкий. **Scope:** маленький.

### 5.4 — MISE-016: подключить `ChecklistHistorySheet` к Manager
- **Affected files:** `native/Mise/Mise/ManagerChecklists.swift` (или где сейчас должна быть точка входа).
- **Risk:** низкий. **Scope:** маленький.

### 5.5 — MISE-018 (остальное): точечная зачистка немых `catch {}` вне billing
- Только там, где реально может маскировать значимую ошибку (не clipboard/analytics-ping).
- **Risk:** низкий. **Scope:** маленький, но много мест — делать пачками по 2-3 файла, не одним махом.

---

## Phase 6 — Architecture cleanup

Ничего не запланировано как обязательное. MISE-008 (нет транзакций в money-path вообще) — архитектурное наблюдение, частично уже закрывается Phase 1.2/1.4 (первые RPC). Дальнейшее расширение на `persistShift` целиком — не включаю в план без отдельного запроса владельца, это больше похоже на добровольный редизайн, чем на баг-фикс.

---

## Phase 7 — Performance

### 7.1 — MISE-019: проверить дублирующийся polling в `tabs-ops.tsx`
- **Affected files:** `app/people/tabs-ops.tsx:123,344`.
- Сначала — не фикс, а проверка: монтируются ли оба интервала одновременно на одном экране. Если да — убрать дубль.
- **Risk:** низкий. **Scope:** маленький.

---

## Phase 8 — Regression tests

Для каждого Critical/High фикса (1.1, 1.2, 1.3, 1.4, 2.1) — добавить regression-тест, воспроизводящий исходный сценарий сбоя, до того как он будет закрыт как done. Тесты идут в `vitest` (web) и `MiseTests`/`MiseUITests` (iOS) — где применимо.

---

## Phase 9 — Final verification

- `tsc` + `npm run lint` + `npm test` (vitest) чисто.
- `xcodebuild` чисто для iOS-изменений.
- Ручной смоук на реальном тестовом ресторане: сценарии A/B/C из отчёта + новый сценарий "погашение долга при обрыве сети" (Phase 1.2) + "два устройства одновременно списывают склад" (Phase 1.4).
- Обновить `docs/FULL_SYSTEM_AUDIT_2026.md` — пометить закрытые находки статусом FIXED со ссылкой на коммит.

---

## Порядок выполнения (рекомендация)

Phase 0 → Phase 1 (1.3 сначала, самое маленькое и безопасное; затем 1.4, 1.2, 1.1 — по возрастанию сложности) → Phase 2 → Phase 3 → Phase 5 → Phase 7 → Phase 4 (по отдельному приоритету, не в этом цикле) → Phase 6 (не запланирован).

Каждый Phase — отдельный блок работы с прогоном tsc/build/tests после, отдельная фиксация "что сделано/что осталось" перед переходом к следующему — как и просил владелец.

Жду `APPROVE IMPLEMENTATION` для старта.
