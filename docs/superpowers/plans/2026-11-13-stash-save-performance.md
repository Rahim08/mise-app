# Stash saving performance implementation plan

Goal/spec: user requested faster receipt, issue and write-off saves with simulator verification,
no publication or live stock mutations. Preserve existing keyboard/focus work and other dirty changes.

Evidence: native writeMovementRows sends one movement insert per item, followed by a stock RPC
or stock insert. saveMovement then waits for three warehouse reads; issue additionally calls
loadShift (settings/types/all sales/all issues/all venue write-offs), overwriting editable sales.
Venue write-off waits for both loaders after its single mandatory insert. Notifications already
run in the background. Web already batches movements; this bounded fix targets native Stash.

Approach: batch movement rows and new stock rows, retain per-item atomic server increments,
and use their confirmed returned records to update the UI. Add a typed, non-retrying RPC row
reader accepting object/single-row array responses. No optimistic success, absolute stock writes,
new schema or new mutation retries. Do not reload unchanged inventories or all sales history on
success. Update venue totals only by the confirmed movement delta; preserve shift draft inputs.
Keep failure reconciliation. Prevent older warehouse/shift loads from overwriting confirmed
state. Freeze movement form while saving. Existing edit success paths may reuse this result.

Acceptance/failure boundaries: all stock writes must succeed before dismissal; double taps
create no duplicate batch; bad stock/reason writes nothing; RPC failure keeps form open;
returned server stock includes concurrent device changes; fresh preflight remains required;
merged duplicate rows preserve grams; canonical brands/flavors and edit timestamps survive;
venue and warehouse write-offs affect their own stock scope only. Server roles/tenant policy
unchanged. All simulator requests and push must remain offline.

- [x] Compile actual model and DB with controlled transport, reproduce split inserts and
  history waits; regression tests for receipt/issue/warehouse and venue write-offs.
- [x] Implement confirmed-record updates, batching and strict RPC result handling; run GREEN.
- [x] Verify failures, duplicate taps, canonical stock, drafts and stale-load protection.
- [x] Add a two-flag DEBUG offline fixture; build and test all three modes in simulator.
- [x] Run existing native regressions, npm tests, local Semgrep and focused independent review.

Use synthetic request delays only as controlled evidence, not a production network benchmark.

## Verification and review ledger

- RED: real StashModel + real DB reproduced 12 assertions: split movement/new-stock
  inserts, success waiting on unrelated history, erased sales draft and venue recompute.
  Controlled six-item issue at 80 ms/request: 428 ms / 21 requests.
- GREEN: same model/DB harness passes with ~251–264 ms / 8 requests. Six existing
  products now require fresh stock, one movement batch and six atomic stock RPCs.
  Returned RPC quantities include a simulated concurrent +7g change; neither an absolute
  client write nor an optimistic success is used. New products use one stock insert batch.
- Independent focused review found three P2 issues. All reproduced RED then fixed GREEN:
  initial load invalidation → wait for already-running shift reads, block a new external
  refresh during save, preserve navigation ownership; venue-to-warehouse scope conversion
  → reverse the old venue contribution; historical deficit → retain unclamped raw balance.
- Reverse warehouse-to-venue conversion additionally reproduced RED and fixed GREEN by
  retaining canonical stock returned from reversal RPCs. Edit timestamps/batch identity,
  merged duplicate grams, invalid amounts/reasons, late warehouse reads, failed/malformed
  RPC responses, no mutation retries and duplicate-tap gates are covered.
- Failure UI observed an unrelated “Ошибка AI” fallback; the movement writer now retains
  the actual save error. This is error feedback for the affected flow, no new AI behavior.
- Native keyboard regression, Manager close regression and two-flag DEBUG fixture tests
  pass. npm test: 18 files / 164 tests passed. Debug and Release simulator builds passed;
  Release reports existing unrelated PeopleWalk Swift-concurrency warnings.
- Semgrep OSS, metrics disabled: security-audit/secrets/Trail of Bits on four changed Swift
  files, zero findings, no partial/failed/skipped scans. Pro unavailable (not installed or
  authenticated); no cross-file Pro guarantee. Final report under
  /tmp/mise-stash-save-scan/final/results/results.sarif.
- Simulator iPhone 18 Pro / iOS 27: receipt six ×25g → stock1025g each; issue six ×25g
  →1000g each; warehouse writeoff six ×10g →990g each / total5940g; every operation appears
  immediately as one batch in history. Venue writeoff50g appears separately and does not
  change warehouse stock. All data is offline fixture data, not production.
- No source publication, deployment, schema migration, production stock mutation or real
  notification. The connected Supabase account lists other projects, not the repository's
  project: live RPC return schema was not inspected. Existing SQL reference returns a
  tobacco_stock row; both object and one-element-array response shapes are tested. Live
  latency and geographic migration remain for the agreed release; synthetic figures above
  are not a production benchmark. Existing multi-step writes are not a global transaction;
  partial-failure reconciliation remains, no automatic write retry was introduced.

- Final simulator failure/retry: injected movement insert503 left all six×25g entries
  editable, available stock1000g unchanged, clear “Не сохранилось” error. Retry dismissed
  the form and produced exactly one six-position +150g batch. No stock mutation was
  attempted after the injected insert failure. Final Debug/Release builds succeeded.
