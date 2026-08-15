# Block C — Analytics Audit (2026-08-15)

Scope: `app/analytics/page.tsx` (1736 lines), `native/Mise/Mise/AnalyticsView.swift` (2249 lines), `lib/analytics.ts`. Read-only audit, no code changed.

## CRITICAL

### C1 — Web Analytics has no "Долги" (debts) UI at all; iOS has a full card + detail sheet
- **Web:** `app/analytics/page.tsx` — no debts card, no `an.debts` usage, nothing. The only debts-related code is `countsInRollup` (line 655), which *excludes* open (`is_paid=false`) shift-expense debts from every expense rollup (category breakdown, totals) — silently. There is zero UI surface telling the manager that money is being excluded, how much, or why.
- **iOS:** `native/Mise/Mise/AnalyticsView.swift:1206-1239` — a tappable "Долги" card (count badge + total amount) that opens a full `DebtsTab` sheet listing every open debt: when it appeared, amount, when settled. Backed by `m.periodDebts`, period-aware (day/week/month).
- **Commit `92f6076`** ("feat(debts): move settlement into Manager close-shift flow, read-only Долги tab in Analytics") explicitly claims this was shipped to Analytics. It landed on iOS only — the web half of that commit's stated scope was never done.
- **Failure scenario:** An owner opens the web dashboard (`/analytics`), sees "Расходы: €1,200" for the month. In reality €1,450 of shift expenses exist but €250 is an open unpaid debt, invisibly dropped from the total by `countsInRollup`. The owner has no way to discover the missing €250 exists, who it's owed to, or that it will land in a *future* period's numbers once settled (which itself will then look like an expense spike with no visible cause). This is a live financial product — this is not a cosmetic gap.
- **Fix:** Port the iOS Долги card + a `DebtsTab`-equivalent to `app/analytics/page.tsx`, reusing `periodDebts`-style filtering (open `shift_expenses` where `!is_paid` and not yet rolled into `countsInRollup`).

### C2 — Salary payment write is two sequential, non-transactional DB calls (till debit, then payment record) — both platforms
- **Web:** `app/manager/tabs-salary.tsx:236-251` (`savePayment`) — for `method === 'cash'`: first `inkassations.update/insert` (debits the till, `salary` field += amount), *then* a separate `salary_payments.insert` (the "fact of payment" record used everywhere as `paidOf`/`remaining`). Two independent awaited calls, no transaction, no compensating rollback.
- **iOS:** `native/Mise/Mise/ManagerSalary.swift:236-294` (`markSalaryPaid`) — identical two-step shape: `inkassations` update/insert in a `do/catch` (lines 273-279), then a second, separate `do/catch` for `salary_payments.insert` (lines 285-290).
- **Failure scenario:** Network drops or the second call fails (RLS hiccup, timeout, app backgrounded) *after* the `inkassations` write already committed. Result: the till has been debited (money "left" the till in every balance/kassa/inkassation number) but no `salary_payments` row exists, so `paidOf(emp)` / `remaining` in Analytics and People still show the full amount as unpaid. The manager, seeing "still owed," is naturally led to pay again — a second, real till debit for a debt that (per the ledger) was already paid once. This directly corrupts `cumulativeInkass` (Analytics C-block headline number) and the salary "remaining" figure at the same time.
- **Fix:** Either wrap both writes in a single RPC/transaction (Postgres function), or reorder + make idempotent: write `salary_payments` first (source of truth for "paid"), then derive/reconcile the `inkassations.salary` delta from it (or via a background reconciliation job), so a failure after step 1 doesn't silently move money.

## HIGH

### C3 — Two different "accrued so far" formulas for the same concept, consistent within each module but incoherent across them
- **Manager** (`app/manager/tabs-salary.tsx:261-265`, iOS mirror `native/Mise/Mise/ManagerSalary.swift:36-41`, label `pe.accruedToday`):
  ```
  denom = payoutDay ? daysInMonth + payoutDay : daysInMonth
  accrued = total * min(today.getDate(), denom) / denom
  ```
- **Analytics** (`app/analytics/page.tsx:1113-1127`, iOS mirror `AnalyticsView.swift:558-568`, label `an.salToday` / `an.salaryToday`):
  ```
  cycleStart = payoutDay || 1
  if today >= cycleStart: accrued = totalCash / daysInMonth * (today - cycleStart + 1)
  else:                   accrued = prevTotalCash / prevDaysInMonth * (prevDaysInMonth - cycleStart + today + 1)
  ```
  These are genuinely different models (Manager: linear ramp over an extended `daysInMonth + payoutDay` window, never resetting at the payout boundary; Analytics: a payout-day-anchored cycle that resets and switches between "still collecting for last month" / "collecting for this month"). They are each internally consistent and each duplicated verbatim between web and iOS — the mismatch is *cross-module*, not cross-platform.
- **Concrete divergence:** `daysInMonth=31`, `payoutDay=10`, today = Aug 15, same underlying `total`/`totalCash`. Manager: `total × 15/41 ≈ 36.6%` accrued. Analytics: `totalCash × 6/31 ≈ 19.4%` accrued. Same manager, same day, same money — two screens disagree by ~17 points of percentage on "how much salary has accrued so far."
- **Fix:** Pick one accrual model (Analytics' payout-day-cycle model looks like the more recently-reasoned one, given its comments) and make Manager's `accruedToday` call the same formula/shared helper instead of re-deriving it.

## MEDIUM

### C4 — Web's inkassation daily history is informationally poorer than iOS's for identical underlying data
- **Web:** `app/analytics/page.tsx:1144-1165` (`renderPeriod`'s "Инкассация" history list) — each row shows only date + gross `s.inkassation` + a free-text concatenation of `reason`/`salary_note`. No numeric expense or running-net column.
- **iOS:** `AnalyticsView.swift` ~1795-1835 — structured 4-column table: Date / Инкассация / Расход (`expense + salary`, fixed under 2fc0215) / Итого (net `inkNet`).
- Both sides read the exact same `inkByShift`/`inkDetails` rows (`expense`, `salary`, `total`), so the data is available on web — it's simply not surfaced. A web-only user cannot see, per day, how much was deducted or the resulting net balance without parsing an ad-hoc string.
- **Fix:** Mirror iOS's column layout in `renderPeriod`'s history block.

## Notes / non-findings
- `fmtDate` (`lib/format.ts:5-7`) builds date strings from local `getFullYear/getMonth/getDate` — no UTC/local timezone drift risk for month-boundary bucketing; the `f072a5b` class of bug (cumulative drift on month nav) does not appear to have a live twin elsewhere in the file.
- Div-by-zero / empty-array guards in the chart primitives (`LineChartSVG`, `BarChartSVG`, `DonutChartSVG`) are all present (`range || 1`, `total || 1`, `Math.max(..., 1)`).
- `totalExpense`/`prevExpense`/CSV/PDF exports on web (`sh.total_expense` only, no `+salary`) match iOS's own top-level `totalExpense` (`AnalyticsView.swift:366`, same `total_expense`-only sum) — the 2fc0215 iOS fix was correctly scoped to the daily-history "Расход" column only (C4 above), not the headline stat; no parity gap on the headline number itself.
- A handful of code comments reference a future date ("юзер-фидбок 2026-08-16") one day ahead of the current date (2026-08-15) — almost certainly a stray authoring-date typo, not a functional bug; not worth fixing on its own.
