# Block A audit — Manager + Debts (Долги) + Payroll (Зарплата), web + iOS

Read-only audit. 2026-08-15.

## Scope

- Web: `app/manager/page.tsx`, `tabs-salary.tsx`, `tabs-discipline.tsx`, `tabs-reports.tsx`, `tabs-checklists.tsx`
- iOS: `ManagerView.swift`, `ManagerSalary.swift`, `ManagerSchedule.swift`, `ManagerSettings.swift`, `ManagerDiscipline.swift`, `ManagerChecklists.swift`, `ManagerReports.swift`
- Traced: shift open → expenses/inkassation entry → shift close → debt settlement → salary advance/payment → what Analytics reads back
- Verified against CLAUDE.md rules: `shifts` sort by `opened_at` (OK, no violations found), `inkassations.total` column name (OK), `shift_expenses.employee_id` (OK)
- Verified `app/api/db/route.ts` forces `.eq(scope, caller.rid)` server-side on every op regardless of client filters — client-side queries in `ManagerView.swift`/`ManagerSalary.swift` that omit an explicit `restaurant_id` filter (e.g. `prevClosing`, `loadOpenDebts`, `ensureShift`, `openShift`'s dedup check) are **not** a cross-tenant risk; the gateway scopes every query. Not reported as a finding.

## Findings

### HIGH

**1. Register balance display goes wrong immediately after saving a shift that settles debts — both platforms.**
`app/manager/page.tsx:295-311` (`debtSettleTotal`/`calc`) + `app/manager/page.tsx:408-412` (end of `persistShift`); same pattern `native/Mise/Mise/ManagerView.swift:43-48` (`debtSettleTotal`/`settledTodayTotal`) + `native/Mise/Mise/ManagerView.swift:516-519`.

`calc().debtTotal = debtSettleTotal() + settledTodayTotal`. `settledTodayTotal` is only ever populated by `loadDay()` reading `shift_expenses` back from the DB (`paid_shift_id === shift.id`). When `persistShift()`/`persist()` succeeds, it clears `selectedDebtIds` (so `debtSettleTotal()` drops to 0 on the next render) but **never bumps `settledTodayTotal`** to include the amount just settled. The DB write itself is correct (uses the pre-clear `calc()` value), but the very next render recomputes `calc()` from live state — `debtTotal` is now short by exactly the amount just settled, so displayed `totalExp` drops and `balance` (shown in the locked "Касса"/"Остаток" cells and the summary sheet) jumps **higher than what was actually saved**, until the user switches date or reloads the day (which re-triggers `loadDay` and repopulates `settledTodayTotal` correctly from the DB).

Failure scenario: manager has 2 open debts, selects and settles €100 of them while closing today's shift with €50 cash income. Saved `closing_balance` in DB is correct (accounts for the €100 outflow). Immediately after the save toast, the on-screen register balance re-renders €100 higher than the persisted value — manager could believe there's €100 more cash in the drawer than there is, right after closing out. Self-corrects only on next reload of that day.

Fix: after clearing `selectedDebtIds` post-save, add the just-settled amount into `settledTodayTotal` (`settledTodayTotal += debtSettleTotal()` before clearing) on both platforms, so the locally-computed `calc()` matches what was persisted without waiting for a reload.

**2. Salary "card" payments double-subtract against the same bucket — both platforms.**
`app/manager/tabs-salary.tsx:73-76` (`cash = max(0, total - advance - card)`, `remaining = max(0, cash - paid)`) and `savePayment` (`tabs-salary.tsx:201-252`, method `'card'` path at line 209 `if (method === 'cash')` — i.e. card payments skip the register/inkassation write but still insert into `salary_payments`); same formula in `native/Mise/Mise/ManagerSalary.swift:82-87` and the payment-save flow around line 249+.

`card` here (`monthly_card_amounts`) is a separately-edited *budgeted* bank-transfer portion of the month's salary, already subtracted out of `cash` (the amount that must come from the register). `paid` sums **all** `salary_payments` rows regardless of `method`. If a manager also records a payment via the "Оплатить" sheet with `method: 'card'` (e.g. to formally log that the budgeted card portion was actually transferred), that amount is added to `paid`, which is subtracted from `cash` a second time — `cash` already excluded `card`. Net effect: recording a card-method payment silently shrinks "remaining owed in cash" by an amount that never touched the register, potentially marking an employee as fully paid (`payStatus` → green "Paid") while real cash is still owed. The two "card" concepts (`monthly_card_amounts.card_amount` vs `salary_payments.method === 'card'`) are never reconciled or validated against each other.

Fix: either (a) stop allowing `method: 'card'` salary_payments to count toward `remaining` (only `method: 'cash'` should reduce the register-cash bucket, since `card` is already excluded from `cash`), or (b) drop the separate `monthly_card_amounts` budgeted field and derive "card total" purely from `salary_payments.method === 'card'`. Currently the two overlap.

### MEDIUM

**3. Advance/card/payment writes to `inkassations` are raw read-modify-write, unlike the shift-save flow that was deliberately hardened against exactly this.**
`app/manager/tabs-salary.tsx`: `addAdvance` (152-179), `deleteAdvance` (181-195), `savePayment` (201-252) all do `select` → compute new `expense`/`salary`/`total` → `update`, with no snapshot/delta-merge. Compare to `persistShift`'s inkassation write (`app/manager/page.tsx:378-396`), which was specifically redesigned (comment cites "A2, аудит 2026-08-09") to delta-merge because a plain overwrite was clobbering concurrent writes from this exact salary-tab code path. The salary-tab writes themselves still have no such protection against each other: two advances added in quick succession (or an advance landing while a manager's shift-edit delta-merge is in flight) can race and lose one of the updates to `expense`/`total`. Same shape in `ManagerSalary.swift:110-181`. Lower likelihood (single manager, sequential UI) but it's the same bug class the team already paid down once elsewhere.

**4. `deleteAdvance` reason-string cleanup collapses same-day duplicate advances for one employee.**
`app/manager/tabs-salary.tsx:189` — `.filter((s: string) => !s.startsWith(`${empName} аванс`))`; same in `native/Mise/Mise/ManagerSalary.swift:154`. `addAdvance` joins reason fragments as plain `"${empName} аванс"` with no per-advance identifier (line 167-168 web / 128 iOS). If the same employee gets two advances on the same date (two separate `salary_advances` rows, same shift's `inkassations.reason`), both produce the identical fragment string. Deleting *either* advance strips *all* matching fragments from `reason`, not just the one being removed. Money math (`expense`/`total`) is unaffected — only the human-readable `reason` note loses information. Cosmetic, but worth a stable per-advance marker (e.g. include date or advance id) instead of a bare name-prefix match.

### LOW

**5. Partial insert failure in "convert report → task (by role)" is swallowed.**
`app/manager/tabs-reports.tsx:55-74` (`doConvertTask`). When `assignee` is a role (`role:xxx`), it fans out `staff_tasks` inserts to every staff member with that role via `Promise.all`, then only bails if `results.every(x => x.error)` (i.e. *all* failed). If some inserts fail and others succeed, the code still sends the push notification to every target (including the ones whose insert failed) and unconditionally marks the source report `resolved`, with no toast about the partial failure. A manager sees "task created" while some staff never got a row created for them.

## Not a finding (verified, ruled out)

- Client-side queries in `ManagerView.swift`/`ManagerSalary.swift` missing explicit `restaurant_id`/`.eq(scope,...)` filters (`prevClosing`, `loadOpenDebts`, `ensureShift`, `openShift` dedup-check, `findShift(forDate:)`) — `app/api/db/route.ts:237` forces `.eq(scope, caller.rid)` server-side on every request regardless of what the client sends, so this cannot leak cross-restaurant data. Web equivalents (`tabs-salary.tsx`) do pass an explicit `restaurant_id` filter anyway (redundant but harmless); iOS should arguably match for defensive-coding consistency but it is not a bug.
- `mg.tabSalary` / checklist item weights: checklist templates edited in `tabs-checklists.tsx`/`ManagerChecklists.swift` are `kind='shift'` (plain string items) — per CLAUDE.md, per-item weight only applies to one-off `kind='audit'` checklists, which live outside this module. No weight-loss bug in scope here.
