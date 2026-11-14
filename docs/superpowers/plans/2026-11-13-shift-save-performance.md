# Shift closing performance plan

Goal: reduce native Manager closing latency while waiting for every existing financial
write to succeed before confirming closure. No production changes, deployments or new retries.

Evidence: save() holds saving=true while reading hookah_sales and awaiting Notify.send after
persist() has already succeeded. persistExpenses inserts category and employee expenses into
the same table in separate sequential requests. Common no-custom/no-debt persistence reads
shift_expenses twice without any intervening ledger write. Web already batches these inserts
and does not await the notification; leave its behavior unchanged.

Approach: snapshot saved date/totals; run the optional notification digest after confirmation.
Batch category/employee inserts, retaining insert-before-delete failure behavior. Reuse the
fresh ordered preflight expense snapshot ONLY if there are no custom rows/removals and no
selected debts; all mutation/settlement paths keep their later fresh read. Keep author/tenant
checks, audit, money rounding and financial confirmation rules intact. Block date/input changes
during critical writes. Do not replace the entire ledger with a new RPC in this bounded fix.

- [x] Execute current ManagerModel against controlled transport; record critical/full save
  latency and prove optional sales/push wait, redundant reads and split inserts.
- [x] Add regression gates: all financial writes required; failure retains draft/unlocked
  state; double tap; frozen notification date/totals; debt/custom paths retain fresh reread.
- [x] Apply bounded native changes; rerun current model tests and existing regressions.
- [x] Add a strictly DEBUG/offline transport fixture for simulator success/failure with slow
  optional work. Keep all unhandled requests blocked. Never send a real notification in demo.
- [x] Native build, simulator success/failure/retry, local security scan, focused review.

Measure with synthetic per-request delays and report those as controlled evidence, not a
production benchmark. Production geography remains deferred to the agreed release.


## Verification evidence — 2026-11-13

- Executed actual ManagerModel against controlled transport: original model exposed
  awaited optional read/push and two expense reads/inserts. With 80 ms/request,
  baseline 425 ms → current ~259 ms (about 39% less); this is a synthetic comparison,
  not a production measurement. Mandatory financial requests still finish first.
- `python3 native/Mise/tools/test-shift-save.py`: passed financial/push gates,
  duplicate-save guard, date navigation guard during writes, captured date/totals,
  financial failure, custom/debt fresh-read ordering, checklist/negative-cash gates.
- `python3 native/Mise/tools/test-shift-save-fixture.py`: passed two-flag activation,
  unsupported operation/tenant rejection, batch persistence and zero-network push.
- Existing custom-expense native regressions passed; `npm test`: 18 files, 164 tests passed.
- Debug and Release native simulator builds succeeded. Release retains existing unrelated
  PeopleWalk Swift concurrency and extension/parent build-number warnings. iPhone 18 Pro, iOS 27 simulator: successful close;
  injected expense-write error left values editable and unchanged; retry closed the
  shift with the same €1,850 cash revenue, €450 expenses, €1,500 collection and
  €100 closing balance. Optional sales read was delayed 8 seconds and notification
  another 8 seconds, outside the UI saving wait. Tests used DEBUG offline transport;
  no production financial writes or real notifications.
- Independent focused review found no actionable introduced issue. Reviewer fixture
  tests passed; their model rerun hit a sandbox Swift Observation macro restriction;
  the primary agent ran those model tests successfully with local build permissions.
- Semgrep OSS, metrics off, changed four Swift files only: security-audit, secrets and
  Trail of Bits rules completed, zero findings, no failed/skipped rulesets. Pro engine
  unavailable (not installed/authenticated); no cross-file Pro analysis. Results:
  `/tmp/mise-shift-save-scan/scan/results/results.sarif`.
- Production region/network latency was not remeasured with live shift writes.
  Existing region migration and all publication remain deferred. No schema changes.
