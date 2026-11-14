# Аудит дублей / двойных нажатий / гонок — 2026-10-26

Повод: SO, смена 25.10 — баланс инкассации 3505 вместо 4355. Две одинаковые строки
`inkassations` на одну смену (расход 850 списан дважды). Дубль удалён 26.10, баланс 4355.

## Корень (подтверждён по financial_audit_log)

26.10 20:03:17–19 (Эмилия, роль waiter с правами manager) одно сохранение смены 25.10
выполнилось дважды: две пачки `shift_expenses`, две пачки экстр, две вставки `inkassations`.

Кнопка «Сохранить смену» блокируется (`saving = true`) только ПОСЛЕ сетевой проверки
чек-листа закрытия (`closeChecklistIncomplete`). Пока идёт эта проверка, второе нажатие
проходит, и `persist` выполняется дважды.

- iOS `native/Mise/Mise/ManagerView.swift` `save()` — `saving = true` после `await closeChecklistIncomplete()`
- веб `app/manager/page.tsx:469-473` `saveShift` — то же

Дальше срабатывают паттерны, которые при двух параллельных persist дают дубли:

- `shift_expenses`: читаем старые id → вставляем новый набор → удаляем старые id. Два прогона
  читают один и тот же набор старых id, оба вставляют, оба удаляют одно и то же → набор x2.
- `inkassations`: select по shift_id → если нет, insert. Уникального индекса на shift_id нет.

## Дубли в проде (на 26.10)

| Заведение | День | Таблица | Лишних строк | Сумма |
|---|---|---|---|---|
| SO | 25.10 | shift_expenses | 8 | 410 |
| SO | 09.10 (сохранено 16.10) | shift_expenses | 11 | 786 |
| SO | 07.10 (сохранено 08.10, второй набор через 3 мин) | shift_expenses | 6 | 290 |
| SO | 20.08 (сохранено 14.09) | shift_expenses | 5 | 236 |
| SO | 31.08 | долг ЗП Алимы август 2×100 — по словам владельца НЕ дубль, не трогали | — | — |
| Vitalcengo | 19.06 | shift_expenses | 3 | 150 |
| Vitalcengo | 19.06 | inkassations (расход 50 «Вова») | 1 | 50 |
| — | июнь | shift_checklist_completions | 5 | — |

`shifts.closing_balance` у этих дней правильный (считается по форме, не по строкам), но
Аналитика (расходы по категориям, по дням) показывает расходы x2. Если открыть такой день
в Manager и пересохранить — форма подтянет удвоенные суммы и касса дня поедет.

## Находки в коде (по убыванию риска)

### Деньги

1. **Повторный вход в сохранение смены** — веб `app/manager/page.tsx` saveShift/persistShift,
   `app/dashboard/(shell)/shifts/page.tsx` persistShift; iOS `ManagerView.swift` save/persist,
   `changeDate`/`setDate` (автосохранение при смене даты без проверки `saving`). Плюс кнопки
   «Всё равно сохранить» (force) в диалогах не блокируются.
2. **`settle_debts` (RPC) не идемпотентен** — не проверяет `is_paid`. Два параллельных
   persist с отмеченными долгами = двойная `salary_payments` + двойная строка погашения.
3. **`inkassations` без unique(shift_id)** — гонятся persist смены, выплата ЗП
   (`tabs-salary.tsx` savePayment, iOS `ManagerSalary.swift` markSalaryPaid ~603), аванс
   (addAdvance), ensureShift. Любые два с разных устройств → две строки.
4. **iOS `ManagerSalary.swift` deleteAdvance (~269)** — нет busy-флага. Двойной тап = аванс
   вычитается из `inkassations.expense` дважды.
5. **Долг ЗП (SALPERIOD)** — select→insert, `uniq_salperiod_debt` в проде НЕ применён
   (миграция `salperiod-debt-unique-2026-09-02.sql` есть).
6. **salary_payments** — защита от дубля только 2-минутным select (между устройствами гонка).
7. **salary_advances** (веб addAdvance) — кнопка не блокируется во время запроса (moneyBusy есть).
8. **inkassation_topups** веб `topups.tsx` — `if (saving)` по state в замыкании, два быстрых
   клика до перерисовки проходят. iOS — защищено.

### Склад / кальяны

9. веб `StashApp.tsx` save hookah_sales — delete-by-date → insert, между устройствами дубли.
10. веб `StashApp.tsx` newStockRows — дубль строки `tobacco_stock` для одного бренда/вкуса.
11. iOS `StashView.swift` saveGoal (hookah_goals) — без защиты.

### Прочее

12. Брони: iOS `BookingsView.swift` commit — кнопка не блокируется; веб bookings save — нет
    проверки на входе. Дубль брони при двойном тапе.
13. Новости веб `news/page.tsx` publish — двойной клик = два поста + два пуша.
14. Команда веб `team/page.tsx` save — двойной клик = два сотрудника.
15. Чек-листы: веб `tabs-checklists.tsx` addPresets (без защиты), `people/audits.tsx`
    startAudit/launch/setItem; cron `reminders` runScheduledAudits — нет unique на completions.
16. QR-меню `api/menu/order` — нет ключа идемпотентности (ответ потерялся → гость шлёт ещё раз).
17. cron sendPurchaseDigest — повторный прогон = дубль дайджеста.

### Проверено, защищено

openShift (unique restaurant_id+date, 23505 обработан), Stripe webhook (claim по event_id),
shift_absences (unique), bank/guest_notes/attendance (upsert по unique), iOS InkTopups,
iOS addAdvance (moneyBusy до первого await), виджет «Пришёл» (идемпотентный update).

Не просмотрено: PeopleModel.swift checkIn/attendance/чек-листы iOS, people/tabs-ops,
tabs-shifts swap, stripe checkout/portal routes.

## План фикса

**БД (одна миграция):**
- чистка дублей (см. таблицу) — с подтверждения
- `unique (shift_id)` на `inkassations` (where shift_id is not null)
- `uniq_salperiod_debt` НЕ применяем без согласования (две строки долга Алимы легитимны)
- `settle_debts`: брать только `is_paid = false` (`for update`), уже оплаченные пропускать
- unique на `shift_checklist_completions (checklist_id, date, staff_id)` — после проверки данных

**Код (веб + iOS):**
- защита от повторного входа на входе в save/persist (ref/флаг ставится синхронно,
  до первого await), autosave при смене даты ждёт/пропускает идущее сохранение
- insert в `inkassations` → при 23505 перечитать и сделать update
- deleteAdvance (iOS) — moneyBusy
- брони, новости, команда, пресеты чек-листов, hookah_goals, topups (веб) — флаг на входе

## Статус 2026-10-26

- Дубли вычищены (39 строк), суммы сверены с кассой смен.
- Код веб + iOS исправлен, tsc / vitest / xcodebuild чисто. Не закоммичено.
- Миграция `docs/migrations/dedupe-guards-2026-10-26.sql` (unique inkassations.shift_id + идемпотентный settle_debts) не применена.
- Не сделано из списка: hookah_sales/tobacco_stock между устройствами (веб Stash), salary_payments/advances между устройствами, cron дайджест, QR-меню идемпотентность, people/audits.tsx.
