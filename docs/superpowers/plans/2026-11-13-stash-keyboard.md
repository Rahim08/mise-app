# Stash keyboard implementation plan

Goal: keep the active movement field above the keyboard and advance with Next in
inbound, issue and write-off forms. Preserve all existing stock/save rules. No publication.

Approach: one stable ID-based FocusState for the existing movement sheet, explicit visible
field order, shared focus binding in autocomplete inputs, ScrollViewReader reveal on focus
and keyboard appearance. A safe-area navigation bar above the keyboard provides Next/Done;
Return advances text fields. The system keyboard toolbar was replaced after simulator QA
showed empty controls when switching manual/stock fields.
Keep SwiftUI keyboard safe-area handling; avoid fixed keyboard heights or extra dependencies.
Do not use a global UIKit responder walker: autocomplete fields and dynamically removed
rows need explicit identities. Inventory/shift forms and save-speed work remain separate.

Acceptance: six or more positions, multiple brands, manual/stock modes, reason last on
write-off; adding focuses the new field, removing/switching modes leaves no stale focus;
suggestion selection advances without losing input; last field can dismiss the keyboard.
Scrolling manually must remain possible. All testing stays offline.

- [x] Reproduce six-line keyboard obstruction/absent Next in simulator before edits.
- [x] Add failing behavioral Swift harness for actual visible-field order and traversal:
  six lines, multiple brands, stock order, disabled flavor, venue write-off, last/missing IDs.
- [x] Implement shared focus, field scrolling, Next/Done, dynamic add/remove/mode repair.
- [x] Run harness, native build, existing relevant tests and local security checks.
- [x] Verify keyboard/Next with six lines and stock/manual/write-off in iPhone simulator;
  review changes, record results, leave production data and publication untouched.

## Results

- Native Debug simulator build: BUILD SUCCEEDED. No dependencies, API or save rules changed.
- Actual focus/binding harness: four groups pass; watched missing behavior fail before fixes.
  Covers six lines/multiple brands, visible/disabled fields, stock order, reason/venue,
  removed-field repair, and late keyboard callbacks after row/group deletion.
- Independent focused review suggested testing brand selection enabling a disabled flavor.
  Simulator confirmed the race; focus requests now resolve after the updated view is mounted.
- Simulator found an active-row deletion crash (Array/Binding subscript in didEndEditing).
  Manual rows now bind by stable IDs; late callbacks for removed rows are ignored. Unit
  regression and actual active row/group removal both pass without changing other rows.
- iPhone 18 Pro, iOS 27.0, Russian UI, offline fixtures: six manual lines; numeric Next
  from fifth weight to sixth flavor; text Next to weight; final Next disabled; Done hides
  keyboard; new flavor/brand focus; suggestions advance; active deletion; manual scrolling.
  Issue-from-stock advances through all four fixture stock positions in rendered order.
  Warehouse write-off advances last stock weight → reason; venue write-off weight → reason.
  Switching manual/stock/type does not retain stale focus. Final bar checked in light/dark.
- Evidence: /tmp/mise-stash-six-lines-next.png (final six-line dark-theme screen).
- Existing Vitest suite: 164/164; Booking actual-model regression: seven groups pass.
- Semgrep OSS: security-audit, secrets, Trail of Bits, metrics off, three scans succeeded,
  zero findings/failures/skips/partial scans. Source stayed local; Swift semantic coverage
  is limited without Pro. Downloaded rules cleaned up; results in /tmp/mise-stash-keyboard-scan/final.
- Whitespace clean. Full web lint/build not rerun for this native-only change; repository
  lint's earlier failures remain documented in the Booking verification report.
- No production reads/writes, account connections, commits, release or deployment. Simulator
  used MISE_DEMO_UI; API.swift blocks network transport in that mode. No real stock was moved.
  Tablet/small-phone/hardware-keyboard and live persistence were not tested in this task.
