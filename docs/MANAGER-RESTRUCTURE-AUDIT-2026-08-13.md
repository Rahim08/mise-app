# Аудит: Manager/People реструктура + долги — 2026-08-13/14

Аудит свежих изменений на ветке `feat/debts-and-payroll-fixes` (см.
`docs/MANAGER-PEOPLE-RESTRUCTURE-2026-08-13.md` за контекстом реструктуры).
4 параллельных агента: iOS Manager, iOS People, веб Manager/People, долги+Analytics.

Миграцию `docs/migrations/shift-expenses-paid-status.sql` применяет юзер сам —
в этом докe только код-фиксы.

## Блок A — КРИТИЧНО (деньги/данные)

- [x] **A1 (iOS).** Урегулированный долг тихо терялся из остатка при повторном
  сохранении дня. Причина: settlement-строка пишется с `paid_shift_id ==
  shift_id` (сама на себя), `loadDay` исключала её из пересчёта наравне с
  чужими долгами. Фикс: новое поле `ManagerModel.settledTodayTotal` —
  считается в `loadDay` суммой строк `shift_id==shId && paid_shift_id==shId`,
  добавлено в `calc.debtTotal` (`ManagerView.swift`). BUILD SUCCEEDED.
  Веб (`app/manager/page.tsx`, `app/dashboard/(shell)/shifts/page.tsx`) —
  тот же баг актуален, не починен (см. A2, веб-паритет вообще не сделан).
- [x] **A2.** Веб-паритет долгов сделан (не существовал вообще — commit
  `92f6076` сам это признавал). Оба редактора смены —
  `app/manager/page.tsx` (мобильный) и `app/dashboard/(shell)/shifts/page.tsx`
  (десктоп owner-view, намеренно дублирует модель, не общий lib) — получили:
  `catUnpaid`/`empUnpaid` (тоггл «в долг» на строке категории/сотрудника),
  `openDebts`/`selectedDebtIds` (плашка «Долги» со списком+чекбоксами),
  `settledTodayTotal` (тот же A1-фикс, что и на iOS — сумма погашения не
  теряется при пересохранении дня), `persistDebtSettlements` (insert
  settlement-строки + update `is_paid`/`paid_shift_id` на оригиналах).
  Новые ключи `mg.debtToggle`/`an.debts`/`an.debtSettleNote` в
  `lib/i18n.tsx`, 8 языков. `npx tsc --noEmit` → чисто, `npx vitest run` →
  16/16.
- [x] **A3.** Analytics «Зарплата» на вебе была НЕ read-only, вопреки докам и
  commit-message `86f1673` (живой `saveCard()` писал прямо в
  `monthly_card_amounts` через `onBlur`, мимо Manager). Фикс: `saveCard`/
  `addAdvance`/`deleteAdvance` перенесены в `app/manager/tabs-salary.tsx`
  (паритет 1:1 с `ManagerSalary.swift`) — редактируемое поле «на карту» +
  список авансов с удалением + кнопка «Добавить аванс» (новый ключ
  `an.addAdvance`, `an.advanceInkassationMissing` в `lib/i18n.tsx`, 8 языков).
  `app/analytics/page.tsx` `renderSalary` — карта теперь просто текст, `saveCard`
  удалена целиком. `npx tsc --noEmit` → чисто.

## Блок B — HIGH

- [x] **B1.** `ManagerSalary.swift saveMonthlyCard` — восстановлена защита от
  тихой потери правки (guard на результат update/insert, `flash(t("bk.saveFailed"))`
  при ошибке constraint), regression из переноса от Analytics починен.
- [x] **B2.** Мёртвая кнопка «Подробнее» в Явке — удалена (`PeopleShiftsHub.swift`,
  указывала на несуществующий `m.shiftsView = "discipline"`). Осиротевшие
  ключи `pe.discipline`/`pe.disMore` удалены из `Localization.swift` (C7 заодно).
- [x] **B3.** Битые i18n-ключи на вебе чинены: `app/manager/tabs-reports.tsx`
  `tr('create')` → `tr('me.create')`; `app/manager/page.tsx:649`
  `tr('tab.shifts')` → `tr('pe.schedule')` (уже существующий ключ).
- [x] **B4.** `doConvertTask` (`app/manager/tabs-reports.tsx`) теперь шлёт
  `pushNotify({ type: 'task', ..., audience: { staff_ids: targets } })`
  исполнителю, паритет с прямым созданием задачи. `doConvertPurchase` — без
  пуша осознанно (закуп создаёт сам менеджер себе же, self-notify не нужен,
  в отличие от задачи с реальным исполнителем).
- [x] **B5.** `app/manager/tabs-checklists.tsx` — добавлен `myId =
  getMe(restaurantId).id || ''` (тот же паттерн, что People), передан в
  `ChecklistCard`. Авторство violation-задач и self-notify теперь корректны.

## Блок C — MEDIUM/LOW

- [x] **C1.** Стейл бейдж непрочитанных заявок — `.onDisappear` на
  `ManagerReportsTab` (реально размонтируется при возврате назад, в отличие
  от родительского List) теперь рефетчит счётчик.
- [ ] **C2.** Двойной fetch Дисциплины при первом открытии (iOS
  `ManagerDiscipline.swift:133-137,161`) — `.task` + `.task(id: discPeriod)`
  оба стреляют на маунте. Не критично, лишний запрос.
- [ ] **C3.** Race при одновременном создании+settle долга в одном save
  (iOS `ManagerView.swift:444-446`, параллельные `async let`). Теряется
  paid-маркер при пересечении rows, деньги не страдают.
- [x] **C4.** `ManagerScheduleEditSheet` — добавлен `saving`-гвард (паттерн,
  что у остальных Manager-шторок), кнопка `disabled` и дизейбл на время
  запроса, `dismiss()` только при успехе.
- [x] **C5.** `ManagerMarkPaidSheet` — `disabled` теперь сверяет сумму с той
  же заменой запятой на точку, что и сам save (было рассинхронизировано —
  на ru-раскладке кнопка навсегда оставалась disabled).
- [x] **C6.** Пустое состояние «Заявки» у менеджера — убрана стейл-ветка
  `m.isManager ? pe.noReports : pe.noReportsMine`, теперь всегда
  `pe.noReportsMine` (visibleReports всегда только свои после реструктуры).
- [x] **C7 (частично).** `pe.discipline`/`pe.disMore` — удалены (осиротели
  вместе с B2). `ChecklistHistorySheet` (`PeopleChecklists.swift:1128`) —
  оставлена как есть, отдельная задача на будущее (нужно решение: удалить
  или подключить историю в `ManagerChecklistsTab`).
- [ ] **C8.** Нет guard от ухода в минус при пакетном settlement долгов —
  UI сам подталкивает брать сразу «все открытые долги любых дат» одним
  сохранением, может увести кассу глубоко в минус без подтверждения.

## Блок D — доп. фича (юзер-фидбок 2026-08-14, вне исходного аудита)

- [x] **D1 (iOS).** Черновик несохранённой формы Manager→Смена: если менеджер
  открыл смену, вбил цифры, но не нажал «Сохранить» и приложение убито
  (фон/система)/перезапущено — данные раньше терялись (`loadDay` подтягивает
  только то, что реально в БД). Теперь `ManagerModel` кэширует форму
  (income/incomeCard/inkSum/inkExpense/inkReason/catAmounts/catNotes/
  empExtras/catUnpaid/empUnpaid) в `UserDefaults` при уходе экрана в фон
  (`.onChange(of: scenePhase)` в `ManagerBody`), восстанавливает в `loadDay`
  ТОЛЬКО поверх несохранённой формы (`locked == false`), стирает при
  локе (уже сохранено) и сразу после успешного `persist()`. Черновик — чисто
  локальное восстановление ввода, никогда не участвует в кассе/Analytics,
  пока не нажата «Сохранить». BUILD SUCCEEDED.
  Веб-паритет — не сделан (юзер попросил «если получится», не критично).

## Блок E — доп-фидбек 2026-08-14 (вне исходного аудита)

- [x] **E1 (iOS, Analytics).** Убрана подпись «Наличными» под суммой в
  свёрнутой шапке Зарплаты (`AnalyticsView.swift` ~1253) — теперь только
  имя + остаток к выплате, разбивка (аванс/карта/оплачено с датами) только
  в развёрнутом виде, как и было.
- [x] **E2 (iOS, Analytics).** «Долги» убраны из таб-бара — при 6 вкладках
  iOS автоматически прятал 5-ю/6-ю («Сессии»/«Долги») за системное «Ещё».
  Теперь ровно 5 вкладок (Период/Касса/Прогноз/Зарплата/Сессии) — «Ещё»
  больше нет, «Сессии» видна напрямую. Долги переехали в `PeriodTab` —
  карточка под «Расходами», появляется только если есть открытые долги в
  ВЫБРАННОМ периоде (день/неделя/месяц — `periodDebts`/`periodDateRange`
  уже существовали в модели, просто не были подключены нигде кроме старой
  вкладки). Тап — «See all»-паттерн (Revolut, по референсу юзера):
  погружение в отдельный полноэкранный лист (`.sheet` с `NavigationStack`),
  внутри — старый `DebtsTab` без изменений (список открытых + история
  погашённых с датами появления/оплаты). `xcodebuild` → BUILD SUCCEEDED.
  Веб-паритет — не сделан (аналогичной структуры вкладок на вебе нет,
  Analytics на вебе плоский список секций, не таб-бар с авто-«Ещё»).

## Прогресс

**Готово:** A1, A2, A3, D1 (блок A + доп-фича полностью), B1–B5 (блок B
полностью), C1, C4, C5, C6, C7 (частично). iOS `xcodebuild` → BUILD
SUCCEEDED (гонялся после каждого блока), веб `npx tsc --noEmit` → чисто,
`npx vitest run` → 16/16. Ничего не закоммичено.

**C2/C3/C7/C8 — добиты 2026-08-15 (юзер: «чини всё»):**
- [x] C2 — убран дублирующий `loadDiscipline()` в `ManagerDisciplineTab.task`
  (второй вызов был в `ManagerDisciplineBody.task(id: discPeriod)`, который
  и так грузит при первом появлении).
- [x] C3 — на самом деле хуже, чем «race»: на вебе это был ГАРАНТИРОВАННЫЙ
  порядок бага, не гонка (persistDebtSettlements вызывался ПОСЛЕ удаления
  старых расходов — апдейт исходной строки долга гарантированно бил по уже
  удалённой строке, если долг создан в тот же день). Починено на всех
  трёх местах (`ManagerView.swift`, `app/manager/page.tsx`,
  `app/dashboard/(shell)/shifts/page.tsx`) — `persistDebtSettlements`
  теперь всегда выполняется ПЕРВЫМ, до чтения/удаления расходов.
- [x] C7 — `ChecklistHistorySheet` портирована в `ManagerChecklistsModel`
  (новые `history`/`historyLoaded`/`loadHistory()`/`historyByDate`/
  `checklistTitle`) + третий сегмент «История» в `ManagerChecklistsTab`
  (`ManagerChecklistHistoryList`). Старая orphaned-версия в
  `PeopleChecklists.swift` удалена целиком.
- [x] C8 — добавлен мягкий гейт (паттерн `closeChecklistIncomplete`):
  если погашение отмеченных долгов уводит кассу в минус,
  `confirmationDialog`/модалка «Касса уйдёт в минус: {amount}. Продолжить?»
  перед сохранением, на всех трёх местах (iOS + оба веб-редактора).
  Новые ключи `mg.debtNegativeWarn*` — 8 языков, оба файла i18n.

**Плюс 2 находки из само-ревью диффа (2026-08-15):**
- [x] Веб `addAdvance` теперь fail-closed при отсутствии строки сотрудника
  (паритет с iOS), было fail-open (тихо пропускало лимит).
- [x] Убрана недостижимая ветка «оба поля пустые» в попапе заметки
  Кассы/Инкассации (iOS) — кнопка и так `disabled` в этом состоянии.

**Плюс отдельная находка 2026-08-15 (юзер-репорт «данные ЗП не видны в
Инкассации»):** `total`/`inkNet` в `inkassations` НЕ пересчитывался при
выплате ЗП (`markSalaryPaid`/`savePayment`) — писались только `salary`/
`salary_note`, `total` оставался от последнего обычного закрытия смены.
Остаток кассы молча расходился с реальностью после каждой выплаты.
Починено на iOS (`ManagerSalary.swift`) и вебе (`tabs-salary.tsx`). Плюс
UI: иконка заметки/попап (iOS) и дневная карточка+история (веб, была
хардкод-заглушкой `expense:0, reason:null`) теперь показывают `salary_note`.

**Осталось (по-настоящему, вне сегодняшнего скоупа):**
- A1/A2 (сам факт) — блокер миграция `shift-expenses-paid-status.sql`
  должна быть применена юзером в Supabase, иначе close-shift 400-ится
  целиком на обеих платформах.
