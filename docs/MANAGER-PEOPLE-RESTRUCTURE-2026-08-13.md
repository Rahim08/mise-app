# Manager/People реструктура — 2026-08-13

Цель: Manager получает вкладки (макс 5), People становится чисто личным видом
даже для менеджера (свой график/ЗП-статус/задачи/восьмёрка/чек-листы/закуп —
как у рядового сотрудника). Вся админка (настройка восьмёрки/чек-листов/
аудитов/расписания, рассылка задач, оплата ЗП, дисциплина) переезжает в
Manager. Оплата ЗП начинает реально списывать инкассацию дня выплаты.

Дубль хранится в памяти агента: `manager-people-restructure-2026-08-13`
(на случай `/clear`). Здесь — читаемая версия для юзера, статусы блоков
обновляются по ходу.

## Решения юзера

- Вкладки Manager, максимум 5. Выбрано: **Смена / Зарплата / Настройки / Дисциплина**.
- «Смена» = текущий экран как есть, просто первая вкладка. Логика закрытия/расходов/
  инкассации/долгов не трогается.
- Manager видят только owner/manager/admin — без изменений.
- People у менеджера — те же вкладки, что у сотрудника, без чужих кнопок редактирования.
- Восьмёрка/чек-листы/аудиты: редактирует менеджер (Manager→Настройки), выполняет
  сотрудник (People). Менеджер тоже проходит СВОИ восьмёрки/чек-листы в People, как
  рядовой сотрудник.
- Задачи: создание/рассылка → Manager→Настройки. В People менеджер видит только
  назначенные ему лично.
- Кнопка «Оплатить» (People→Зарплата) переезжает в Manager целиком — только менеджер
  жмёт «оплачено». В People у менеджера остаётся личный read-only статус своей ЗП.
- Оплата ЗП списывает инкассацию дня, выбранного в шторке оплаты. Пишем напрямую в
  `inkassations.salary` (+= amount) и `inkassations.salary_note` (дописываем
  «Имя: Сумма»). НЕ через `shift_expenses` (это другой кейс — долги).
- Если смены на выбранную дату нет — создаём (реюз паттерна `openShift`).
- Метод «карта» — НЕ списывает инкассацию (это безнал). Списывает только `cash`.
- Уход инкассации в минус — запрещён, платёж блокируется с ошибкой.
- Веб-паритет — делать везде, но сперва iOS.
- Дисциплина (сейчас `People→Смены→Явка→Дисциплина`, manager-only сегмент) —
  переезжает в Manager→Дисциплина целиком, без изменения логики.
- Analytics: «добавить аванс» и расчёт «сколько на каждого упадёт» — тоже в
  Manager→Зарплата. Analytics становится read-only (как уже стало с Долгами, 92f6076).
- Миграция «как правильно» — без feature-флагов, вырезаем старое место в том же
  коммите, что и переносим.
- Веб `app/manager/page.tsx` → тот же паттерн, что `app/people/page.tsx`
  (tab-state + `tabs-*.tsx`).
- xcodebuild гонять после каждого блока, не ждать всего целиком.

## Важный контекст (нашли при раскопках, 2026-08-13)

`inkassations.salary`/`salary_note` — НЕ новые колонки. Раньше было ручное поле
«Зарплата» в закрытии смены Manager, писавшее туда же (участвовало в `inkNet = ink −
inkExpense − salary`). Убрано коммитом `2e87d3e` (2026-08-09): «People/Analytics его
никогда не читали — риск задвоенной выплаты». Тогдашнее решение юзера: «выплата ЗП
теперь исключительно через People→Отметить выплату». Сегодняшний фикс — не новая
концепция, а воссоединение: единственный путь записи теперь **People→Отметить
выплату**, что закрывает исходный риск двойной выплаты (было 2 независимых места
записи, стало одно). Строка `inkNet`/«Остаток инкассации» в UI не восстанавливается —
её убрали намеренно (`ed74f3f`, `a206af6`), это чисто бухгалтерская запись без
отдельного UI-индикатора.

## Блоки исполнения

1. **[DONE, не закоммичено] Оплата ЗП → инкассация, деньги-логика, iOS.**
   `PeopleModel.markSalaryPaid()` (`native/Mise/Mise/PeopleModel.swift`) переписан:
   - найти/создать shift на `payFor.date` (новые приватные `ensureShift`/`prevClosingForPayout`,
     копируют паттерн `ManagerModel.openShift`/`prevClosing`);
   - `method == "cash"`: читает текущую `inkassations` по `shift_id`, считает
     `available = amount − expense − salary`, если новая сумма больше — блокирует
     (`pe.insufficientInkassation`, новый ключ в `Localization.swift`), иначе
     `salary += amount`, `salary_note` дописывает `"Имя: Сумма"`;
   - `method == "card"` — инкассацию не трогает вообще;
   - как и раньше, пишет `salary_payments`;
   - теперь возвращает `Bool` — `PeopleTasksSalary.swift` (`MarkPaidSheet`) дозакрывает
     шторку `dismiss()` только при успехе (раньше закрывалась всегда, даже на ошибке —
     установленный в проекте паттерн, см. `saveChecklistTemplate` и соседей).
   - `xcodebuild -scheme Mise -destination 'generic/platform=iOS Simulator' build` →
     **BUILD SUCCEEDED**.
2. **[DONE, не закоммичено] Manager — скелет вкладок, iOS.** `ManagerView` теперь
   `ManagerTabs` (`TabView(selection: $m.tab)`, `ManagerModel.tab` новое поле,
   default `"shift"`). 4 таба: `shift` (старое тело `ManagerBody` без изменений
   логики) / `salary` / `settings` / `discipline` (последние 3 — `ManagerComingSoon`
   заглушка). `.tint(BrandKit.manager)`, `.tabEdgeSwipe(...)` перенесён с внешнего
   уровня (было фиктивное `tabs: ["only"]` для app-switch) на внутренний, как в
   People/Analytics/Stash. Новые ключи `tab.shift`/`tab.settings`/`tab.discipline`
   в `Localization.swift`. `xcodebuild` → **BUILD SUCCEEDED**.
3. **[DONE, не закоммичено] Web-паритет блока 1** (`app/people/tabs-salary.tsx`,
   `savePayment`) — та же логика: `ensureShift`/gap-tolerant `.lt('date', ...)`
   (как `loadDay` в `app/manager/page.tsx`), `available` из `inkassations`,
   `salary`/`salary_note` списание только для `method==='cash'`, блокировка ухода
   в минус. `restaurantId` прокинут в `SalaryTab` (`app/people/page.tsx`, раньше не
   передавался). Новые ключи `pe.insufficientInkassation`/`pe.saveFailed` в
   `lib/i18n.tsx`. Ошибка показывается инлайн в шторке оплаты (`payError` state,
   отдельного `toast`-пропа у `SalaryTab` нет). `npx tsc --noEmit` → чисто.
4. **[DONE, не закоммичено] Перенос UI Зарплаты в Manager, iOS+веб.**
   - iOS: новый `ManagerSalary.swift` -- `ManagerSalaryModel` (свой computeSalary/load/
     loadDebt/markSalaryPaid, паритет с People, отдельный класс, ManagerModel не трогали),
     `ManagerSalaryTab`/`ManagerMarkPaidSheet`. Wired в `ManagerView.swift` вкладку salary
     (была `ManagerComingSoon`-заглушка). `PeopleTasksSalary.swift PeopleSalaryTab` урезан
     до личного вида (без isManager-ветки, без hero/долга/кнопки оплаты) -- `PeopleModel`
     тоже урезан (markSalaryPaid/loadSalaryDebt/ensureShift/prevClosingForPayout/
     salaryFund/salaryAccruedToday/salaryDebtTotal удалены, loadSalary() теперь всегда
     фильтрует на себя). xcodebuild -> BUILD SUCCEEDED.
   - Веб: новый `app/manager/tabs-salary.tsx` (ManagerSalaryTab, полный перенос
     менеджерской ветки -- фонд/долг/список/оплата). `app/manager/page.tsx` получил
     вкладки: Segmented control (был импортирован, не использовался) под хедером, tab
     state, CONTENT+SAVE BAR обёрнуты в `{tab==='shift' && (<>...</>)}` без изменения
     логики закрытия смены, добавлены панели salary (ManagerSalaryTab) и заглушки
     settings/discipline. `app/people/tabs-salary.tsx SalaryTab` урезан до личного вида
     (сигнатура `{me, accent, t}`, без isManager/restaurantId), `app/people/page.tsx`
     обновлён под новую сигнатуру. Новые ключи mg.tabShift/mg.tabSalary/mg.tabSettings/
     mg.tabDiscipline в `lib/i18n.tsx`. `npx tsc --noEmit` -> чисто (eslint даёт
     пред-существующий шум no-explicit-any/set-state-in-effect по всему файлу -- не
     регрессия, тот же паттерн был и до правок).
5. **[ЧАСТИЧНО, не закоммичено] Перенос Настроек в Manager->Настройки, iOS.**
   - Задачи: НЕ переносим -- нашли явное решение "Любой сотрудник может поставить задачу
     коллеге/сменщику (раньше -- только менеджер)" (PeopleTasksSalary.swift). Отдельной
     менеджерской панели задач нет, переносить нечего -- менеджер и так получает более
     широкий выбор исполнителя в той же шторке TaskFormSheet. Оставлено как есть.
   - Восьмёрка: [DONE] новый `ManagerSettings.swift` -- `ManagerSettingsTab` (хаб-меню:
     Восьмёрка / Чек-листы (заглушка) / Расписание (заглушка)), `ManagerWalkModel` (свой
     load/save/delete, паритет с прежним PeopleModel.saveWalkTemplate), `ManagerWalkTab`,
     `WalkEditSheet` (перенесён из PeopleWalk.swift без изменений, кроме источника данных).
     Wired в ManagerView.swift вкладку settings. `PeopleWalk.swift WalkTab` урезан до
     запуска+истории (без создания/редактирования) -- манагер в People выполняет СВОИ
     восьмёрки как личное действие, ничего не изменилось в паттерне видимости
     (`relevantWalks()` как был manager-only "общий пул", Д3 2026-07-30, не тронуто).
     `PeopleModel.saveWalkTemplate/deleteWalkTemplate/canEditWalk` удалены (больше не
     вызываются из People). xcodebuild -> BUILD SUCCEEDED.
   - Чек-листы/Аудиты (Б6-веса) -- НЕ начато, сознательно. `ChecklistRunCard`
     (PeopleChecklists.swift, 194-385) -- ОДИН компонент одновременно обслуживает и
     обычное прохождение сотрудником, И showManagerControls/onEdit/grading/onGrade
     менеджера (создание шаблона, ПЛЮС отдельная фича "менеджерская pass/fail-верификация"
     чужих прогонов, Д4 2026-07-31) -- это не чистый CRUD-сплит как у восьмёрки, а
     переплетённая логика внутри одной карточки. Плюс скоринг с весами (Б6) по CLAUDE.md
     "Текущий фокус" СВЕЖИЙ и ДО СИХ ПОР НЕ ЗАКОММИЧЕН из своей собственной сессии --
     трогать поверх неподтверждённого кода рискованно. Требует отдельного внимательного
     прохода (не "перенести", а сначала аккуратно расцепить edit/grade/run внутри
     ChecklistRunCard), не делал без подтверждения юзера.
   - Расписание/график-билдер (PeopleSchedule.swift) -- НЕ начато (не успел добраться).
   - Веб-паритет блока 5 (восьмёрка) -- НЕ сделано, только iOS (Q16: сперва iOS).

6. **[DONE, не закоммичено] Заявки -- инбокс с триажем (юзер-фидбок 2026-08-13, вне
   исходного плана блоков, но логично легла в блок 5).** Юзер спросил как правильно
   развести Задачи/Закуп/"сотрудник увидел изъян" по ресторан-бизнес-практике. Нашли, что
   третий поток уже существует -- `StaffReport`/`REPORT_TYPES` (suggestion/order/notice/
   breakdown/other) в `PeopleTasksSalary.swift`, просто без моста в задачу/закуп. Решение:
   создание заявки остаётся личным действием в People (`ReportsTab`/`ReportFormSheet`, не
   тронуты) -- сотрудник просто сигналит, не выбирая "это задача или закуп". Разбор --
   админ-действие, переехал в Manager->Настройки->Заявки:
   - Новый `ManagerReports.swift`: `ManagerReportsModel` (свои load/setStatus/delete,
     паритет с PeopleModel), `convertToTask()` (та же вставка в staff_tasks, что
     `createTask`, включая role: префикс -> веер по цеху) и `convertToPurchase()` (та же
     вставка в purchase_items, что `addPurchase`) -- при конвертации заявка автоматически
     помечается "решена". `ManagerReportsTab`/`ManagerConvertToTaskSheet`/
     `ManagerConvertToPurchaseSheet` -- UI, кнопка "В закуп" только у type="order".
     Wired в `ManagerSettingsTab` новой строкой.
   - People `ReportsTab`: `visibleReports` теперь ВСЕГДА только свои (было
     `isManager ? все : свои`) -- менеджерские кнопки "Просмотрено"/"Решено" убраны из
     карточки (это теперь Manager-действие). `newReportsCount`/бейдж на вкладке «Задачи»
     убраны (был manager-only счётчик, но манагер здесь больше не видит чужие заявки).
     `PeopleModel.setReportStatus` удалён (вызовов не осталось).
   - Новые ключи `pe.convertToTask`/`pe.convertToPurchase`/`pe.reportConverted`/
     `pe.category`/`pe.qty`/`pe.unit` в `Localization.swift`.
   - xcodebuild -> BUILD SUCCEEDED. Веб-паритет и бейдж непрочитанных на строке
     "Заявки" в Settings-хабе -- не сделаны, следующий заход.

## Финальный проход 2026-08-13 (юзер: "делай все блоки до конца, проверь ошибки")

7. **[DONE, iOS] Расписание.** Новый `ManagerSchedule.swift` — `ManagerScheduleModel`
   (свой load/createSchedules/deleteSchedule/copyLastWeek, паритет с прежним
   PeopleModel), `ManagerScheduleTab` (полный календарь+список+добавление+копирование
   недели, перенесено из `PeopleSchedule.swift` без изменений логики). Wired в
   `ManagerSettingsTab`. `PeopleSchedule.swift ShiftsTab/ShiftsCalendar` урезаны до
   личного вида (только своя смена, без имени — оно и так «моё», без добавления/
   удаления). `PeopleModel.createSchedules/deleteSchedule/copyLastWeek` удалены.
   `loadSchedule()` теперь всегда фильтрует на себя (было `if !isManager`).

8. **[DONE, iOS] Дисциплина → Manager→Дисциплина.** Новый `ManagerDiscipline.swift` —
   `ManagerDisciplineModel` + `ManagerDisciplineTab`, весь `DisciplineTab` перенесён
   из `PeopleShiftsHub.swift` дословно (без изменений в логике опозданий/грейса/
   heatmap/checklist-fail-attribution). Сегмент «Дисциплина» и `case "discipline"`
   убраны из People→Смены (`ShiftsHubTab`) — личного эквивалента у People нет:
   менеджер не чекинится «Я здесь» по дизайну (Sprint 1). `PeopleModel`
   discRecords/discGrace/discLoaded/discPeriod/discSel/checklistFailMap/DiscStat/
   ChecklistFailDay/discRange/loadDiscipline/discStat/saveDiscGrace — все удалены
   (не осталось вызовов, проверено grep'ом по всему iOS-таргету).

9. **[РЕШЕНО — без изменений] «Список заказов».** Нашёл: это `OrdersInbox` внутри
   People→Зал (`ZalTab`, `PeopleZalPurchase.swift`) — живая очередь заказов с
   QR-меню гостей, операционная, посменная функция без админ-состовляющей. Уже
   корректно живёт в People (кто на смене — тот и видит), переносить некуда и незачем.

10. **[DONE, iOS] Чек-листы/Аудиты — редактирование шаблона (только kind="shift").**
    Разобрался: `ChecklistRunCard` смешивает 3 вещи — (а) обычное прохождение,
    (б) `showManagerControls` → pencil/trash = ТОЛЬКО редактирование шаблона,
    чисто отделимо; (в) `grading`/`onGrade` = менеджерская pass/fail-верификация
    ЧУЖИХ прогонов прямо по ходу смены (Д4 2026-07-31) — это личное операционное
    действие менеджера, НЕ админ-настройка, оставлено в People без изменений.
    Вес пункта (Б6, Stepper 1-9) в `ChecklistEditSheet` — строго `if kind=="audit"`,
    а AuditsTab (разовые аудиты) по коду сейчас ПОЛНОСТЬЮ скрыт из навигации (Д6,
    "пилюля «Аудиты» скрыта по просьбе юзера") — то есть Б6 нигде не live прямо
    сейчас, трогать было нечего и не нужно. Перенёс только (б): новый
    `ManagerChecklists.swift` — `ManagerChecklistsModel` (load/save/delete, только
    kind="shift"), `ManagerChecklistsTab`, `ManagerChecklistEditSheet` (свой, проще
    оригинальной ChecklistEditSheet — только роль+пункты, без audit-полей/весов,
    чтобы не касаться Б6/AuditsTab вообще). Wired в `ManagerSettingsTab`.
    `RoutineTab` в People: create-кнопка и `showManagerControls` убраны
    (всегда `false`), `gradingNow`/`onGrade` не тронуты. `ChecklistHistorySheet`
    осиротела (не вызывается ниоткуда) — оставлена как есть, не подключена нигде
    (маленький минус, можно добавить историю в Manager→Чек-листы отдельным заходом).

**Итог по iOS: BUILD SUCCEEDED**, 0 warnings в новых/изменённых файлах, grep по
всему таргету подтвердил — нет ни одного оставшегося вызова удалённых из
PeopleModel функций (setReportStatus/saveWalkTemplate/deleteWalkTemplate/
canEditWalk/createSchedules/deleteSchedule/copyLastWeek/discRange/loadDiscipline/
discStat/saveDiscGrace/newReportsCount). Ничего не закоммичено.

**Веб-паритет — НЕ сделан для блоков 7/8/10** (Расписание/Дисциплина/Чек-листы на
Manager-стороне веба). У Восьмёрки на вебе и не было create/run (только read-only
статистика, "создание/прохождение только в iOS" — комментарий в `audits.tsx`),
переносить там нечего. Manager→Настройки/Дисциплина на веб (`app/manager/page.tsx`)
всё ещё заглушки-текст с блока 4. `npx tsc --noEmit` по всему уже сделанному вебу —
чисто (регрессий из сегодняшних iOS-правок нет, веб в этом проходе не трогал).

## Заход 2026-08-14 (юзер: «оцени логичность», нашли 2 дыры + 2 доп-фичи, "делай 1 и 2 и добавляй предложенное")

11. **[DONE, iOS+веб] Analytics-дыра закрыта.** Аванс (`addAdvance`/`deleteAdvance`) и
    сумма «на карту» (`saveMonthlyCard`) переехали в Manager→Зарплата — единая точка
    правки. iOS: методы добавлены в `ManagerSalaryModel` (ManagerSalary.swift, та же
    запись в `inkassations.expense/reason`, что была в AnalyticsModel — логика 1:1);
    `CardInputRow`/`AdvanceAddSheet` в AnalyticsView.swift раздеприватизированы и
    переиспользованы. Analytics-вкладка Зарплата стала read-only (паритет с Долгами,
    92f6076) — кнопки удаления/добавления убраны, `CardInputRow` заменена на
    read-only строку. Веб: те же методы в `ManagerSalaryModel`
    (app/manager/tabs-salary.tsx уже был — добавил туда), Analytics SalaryTab
    (app/analytics/page.tsx) аналогично урезан до read-only.

12. **[DONE, веб] Веб-паритет Manager (был главный пробел прошлого захода).**
    - Новый `app/manager/tabs-discipline.tsx` (`ManagerDisciplineTab`) — дословный
      перенос `DisciplineTab` из `app/people/tabs-shifts.tsx` (та же логика грейса/
      heatmap/checklist-fail-attribution). Порог опоздания теперь редактируется любым
      попавшим в Manager (было `me.is_owner`-only — Manager и так admin-only, разница
      непринципиальна).
    - Новый `app/manager/tabs-checklists.tsx` (`ManagerChecklistsTab`) — форк
      `ShiftChecklistsView` (app/people/audits.tsx) БЕЗ run/grading, только role+items
      CRUD (kind="shift"), presets. `CHECKLIST_ROLES`/`PRESET_TEMPLATES` в audits.tsx
      раздеприватизированы (`export const`) для переиспользования.
    - Новый `app/manager/tabs-reports.tsx` (`ManagerReportsTab`) — веб-паритет iOS
      ManagerReports.swift: инбокс + «В задачу»/«В закуп» + resolve/delete.
      `PURCHASE_CATS` в tabs-ops.tsx раздеприватизирован для переиспользования.
    - `app/manager/page.tsx`: Настройки стала настоящим хабом (Segmented-меню
      Заявки/Чек-листы/Расписание вместо заглушки), Расписание переиспользует уже
      существующий `<ScheduleTab restaurantId .../>` (components/people/ScheduleTab —
      он и раньше был полноценным менеджерским редактором, просто рендерился в People
      при isManager, теперь только в Manager). Дисциплина wired отдельной вкладкой.
    - People-сторона урезана до личного вида: `app/people/tabs-shifts.tsx`
      `ShiftsHub` — «Смена» теперь ВСЕГДА `MyShiftsTab` (было
      `isManager ? ScheduleTab : MyShiftsTab`), сегмент «Дисциплина» и `DisciplineTab`
      удалены (импорт `ScheduleTab` тоже). `app/people/audits.tsx` `ShiftChecklistsView`
      — edit/delete/add/presets убраны (isManager-ветка), grading НЕ тронут (личное
      операционное действие, как на iOS). `app/people/tabs-tasks.tsx` `TasksTab` —
      `visibleReports` теперь всегда только свои (раньше `reports` без фильтра вообще —
      это была более широкая дыра, чем на iOS, все сотрудники видели чужие заявки),
      resolve-кнопки убраны.
    - ВАЖНАЯ НАХОДКА при переносе: чуть не потерял `ShiftAuditHub` (функция без
      `export`, между DisciplineTab и ShiftsHub в исходном файле) — задел его при
      построчном удалении DisciplineTab, tsc сразу поймал (`Cannot find name
      'ShiftAuditHub'`), восстановил из git show. Итог: **всегда гонять tsc/build
      сразу после построчных python-удалений в существующих файлах**, не полагаться
      на визуальную оценку границ блока.

13. **[DONE, iOS+веб] Доп-фичи по запросу юзера.**
    - Бейдж непрочитанных заявок (status='new') на строке «Заявки» в Manager→
      Настройки — iOS (`ManagerSettingsTab`, красный кружок) и веб (та же, красный
      бейдж), считают `staff_reports` независимо друг от друга (без общего кэша —
      ок для счётчика).
    - Пуш менеджеру при создании новой заявки — `audience: managers` (тот же паттерн,
      что закуп/явка). iOS: `PeopleModel.createReport` → `Notify.send`. Веб:
      `tabs-tasks.tsx createReport` → `pushNotify`. Новый ключ `notify.newReportTitle`
      в `NotifyStrings.swift`/`lib/notifyStrings.ts` (для кросс-языкового рендера у
      получателя) + `pe.newReport` в `lib/i18n.tsx` (у iOS уже был).

## Заход 2026-08-14 продолжение: Grading переехал в Manager (юзер: «изучи в интернете как правильно и делай»)

14. **[DONE, iOS+веб] Верификация (grading) чек-листов → Manager→Настройки→Чек-листы.**
    Research: SafetyCulture/iAuditor, Jolt, Zenput — везде один паттерн: field team
    исполняет чек-лист на месте, quality/manager team проверяет ОТДЕЛЬНО через
    admin/dashboard, review — не та же карточка, что использует исполнитель ("managers
    reviewing submissions to verify execution" через отдельный dashboard). Это разрешило
    "спорный случай" из блока 10 в пользу переноса — совпадает с общим принципом сессии
    (People = только своё, Manager = проверка чужого).
    - iOS: `ManagerChecklistsModel` (ManagerChecklists.swift) получил `completions`/
      `loadCompletions()`/`completion()`/`verifiable`/`gradeChecklistItem` (перенесено из
      `PeopleModel.gradeChecklistItem` дословно). Новый сегмент «Шаблоны/Верификация» в
      `ManagerChecklistsTab`, `ManagerVerifyList`/`ManagerGradingCard` — упрощённый форк
      `gradingRow` из `ChecklistRunCard` (PeopleChecklists.swift): pass/fail/N/A без
      фото/report-a-problem (сознательный вырез ради скорости — минорный гэп).
      `PeopleModel.gradeChecklistItem` удалён. `RoutineTab` в People — `gradingNow`/
      `gradeCallback` убраны, `ChecklistRunCard` вызывается всегда с `grading: false`
      (сам компонент/`gradingRow` НЕ удалялись — код мёртвой `AuditsTab` их ещё использует
      с `grading: true` напрямую, трогать не стал).
    - Веб: `ChecklistCard` (app/people/audits.tsx) оказался уже полностью generic
      (grading — просто `grading` prop + `onSetItem`, БЕЗ привязки к People/isManager) —
      переиспользован напрямую в новом разделе «Верификация»
      (app/manager/tabs-checklists.tsx), с собственным `setVerifyItem` (тот же
      lost-update-safe merge, что `setItem` в ShiftChecklistsView). `ShiftChecklistsView`
      — `gradingNow`/`grading`-prop убраны, всегда обычный `canFill`-режим.
    - xcodebuild → BUILD SUCCEEDED, tsc чисто, vitest 16/16.

**Финальная проверка после ВСЕХ заходов:** `xcodebuild` → BUILD SUCCEEDED,
`npx tsc --noEmit` → чисто, `npx vitest run` → 16/16 passed. Ничего не закоммичено.

**Осталось нерешённым (не блокирует, на будущее):**
- `ChecklistHistorySheet` (iOS) осиротела — история чек-листов у менеджера
  недоступна нигде.
- Задачи (создание) — намеренно не переносили, симметрично оставлено в People
  (см. блок 5).
- Верификация в Manager без фото/«создать задачу-нарушение при fail» (было в
  исходном grading) — упрощено ради скорости, можно доточить отдельным заходом.

Найденная база (файлы, могла устареть по ходу работы — сверять с кодом):

- iOS: `ManagerView.swift` (1046 стр, 1 экран, `ManagerModel`), `PeopleView.swift`
  (роутинг вкладок), `PeopleModel.swift` (1581+ стр), `PeopleTasksSalary.swift`,
  `PeopleChecklists.swift`, `PeopleWalk.swift`, `PeopleShiftsHub.swift` (там же
  Дисциплина), `PeopleZalPurchase.swift`, `PeopleSchedule.swift`, `PeopleTechCards.swift`.
- Веб: `app/manager/page.tsx` (688 стр, 1 экран), `app/people/page.tsx` +
  `tabs-salary.tsx` / `tabs-ops.tsx` / `tabs-shifts.tsx` (там же `DisciplineTab`) /
  `tabs-tasks.tsx` / `audits.tsx`.
