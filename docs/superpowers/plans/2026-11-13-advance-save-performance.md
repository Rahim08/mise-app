# Advance saving performance implementation plan

Spec: user asks to find/fix slow advance saving, verify in iOS simulator, publish nothing.
Native ManagerSalaryModel is the issuing path; People salary is personal read-only.
Preserve previous local changes and current financial accounting/CAS/rollback boundaries.

Evidence: addAdvance awaits balance, advance insert, shift lookup, ink lookup, ink write,
then load() recalculates current and previous payroll (14+ reads). AdvanceAddSheet dismisses
immediately through a void callback before any financial write finishes. Notifications do not
participate in this path. No region/schema/deployment change is needed for this bounded fix.

Design: fresh financial preflight; overlap independent shift/ink lookup with balance and
advance insertion while retaining all confirmed writes and existing compare-and-swap retry.
After success apply only the confirmed advance to the selected payroll row (advance list,
advance, cash, remaining); no full payroll reload on success. Freeze period/competing money
operations. Guard payroll loads against late overwrites and month changes. Async Bool form
callback keeps inputs and shows the actual error until success. No new mutation retries.
Previous-date/bank/card/debt formulas and current accounting meanings stay intact.

- [x] Compile real SalaryModel/DB with controlled transport; reproduce reload/request wait.
- [x] Regression gates: all financial writes required; duplicate tap; correct period/date,
  cents, salary/collection limits, rollback on ink failure; initial/late load behavior.
- [x] Implement bounded native change and async form; run tests GREEN.
- [x] Add explicit two-flag DEBUG offline fixture; successful advance, failure/retry and
  correct totals/history in simulator. No real cash, stock, notifications or credentials.
- [x] Native builds, existing tests, local Semgrep and focused independent review.

Measure synthetic delays as controlled evidence, not production latency. Live production
schema/API/financial transactions are not modified. Full People audit remains deferred.

## Verification evidence and review ledger — 2026-11-13

- RED: real ManagerSalaryModel + real DB with controlled transport reproduced seven
  assertions: complete payroll reload after money writes; period navigation mid-write;
  no immediate salary-row update; cached collection balance; zero/negative input writes.
  Common existing-shift/collection case at 80 ms/request: 606 ms / 18 requests.
- GREEN: same model/DB harness ~252–259 ms / 5 requests (about 58% less). Balance and shift/ink
  reads overlap with insertion; all money writes/CAS/rollback still finish before success.
  No full current/previous payroll read on successful advance; no new write retry.
- Tests pass: held cash confirmation; duplicate tap; month lock; separate payroll period
  and deduction date; finite positive/cents validation; cash and salary limits; stale pool
  rejection; bounded CAS contention; financial rollback, rollback-failure warning; late
  payroll responses; missing shift/collection creation; initial load gate; Bool form result.
- Independent scoped review found fractional-cent residue and prior-form error reuse.
  Fractional advances 50.07 + 100.10 followed by the displayed 499.83 remainder reproduced RED,
  then passed GREEN after cents normalization. Opening a new form now clears old errors;
  failure within the same form remains visible and editable. Reviewer's own Swift test
  execution hit sandbox Observation macro restrictions; primary execution succeeded with
  local build permissions. No independent review findings remain deferred for this task.
- Actual DEBUG fixture tested: requires BOTH MISE_DEMO_UI and MISE_DEMO_ADVANCE_SAVE;
  unsupported operations/foreign scope rejected; successful write/CAS responses; insert
  failure and cash failure with rollback/retry. No fixture request falls through to network.
- iPhone 18 Pro / iOS 27 simulator: initial salary 1000, card 200, prior cash-paid 100, open debt 50,
  remaining 650. Advance 100 closes the sheet after cash confirmation, appears once in
  history, advance 100 / cash 700 / remaining 550. Injected two cash-write failures preserve
  the 100/date form and visible error, roll back the advance, then retry produces one 100
  advance with the same correct totals. Console confirms rollback delete and final write.
- npm test: 18 files / 164 tests passed. Existing native Manager shift-close and Stash-save
  regressions passed. Debug and Release simulator builds succeeded. Existing unrelated
  PeopleWalk Swift-concurrency warnings remain in Release. git diff --check passed.
- Semgrep OSS with metrics off, four changed Swift files: security-audit/secrets/Trail
  of Bits completed with zero findings, no failed/skipped/partial/oversized scans. Report:
  /tmp/mise-advance-scan/scan/results/results.sarif. Pro not installed/authenticated;
  cross-file Pro analysis not performed. No dependencies changed.
- No publication, deployment, SQL migration, production financial writes or real push.
  Synthetic timing is not a production-network benchmark. Existing multi-step financial
  writes/CAS/global concurrency limits are preserved, not replaced with a new transaction
  API. Web and full People audit remain outside this native task; region release deferred.
