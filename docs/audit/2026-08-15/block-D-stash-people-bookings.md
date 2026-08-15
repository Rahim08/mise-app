# Block D Audit — Stash / People / Bookings (web + iOS)

Date: 2026-08-15
Scope: `app/tobacco/page.tsx`, `app/people/**`, `native/Mise/Mise/StashView.swift`,
`native/Mise/Mise/People*.swift`, `BookingsView.swift`, `GuestsView.swift`.
Read-only audit, no code changed.

## Summary

Stash (склад) has the most churn and the most findings — mostly **web/iOS parity gaps**
around venue-mass calculations and a customizable-categories setting that iOS respects
and web silently ignores. People's "pure personal view" restructure (86f1673) and the
Б6 weighted-audit scoring (`runScore` in `app/people/audits.tsx`) were traced end-to-end
and are currently **correct** — no regression found. Bookings status/swipe flow (iOS)
was re-checked and is also currently sound (optimistic update + rollback on failure).

No CRITICAL findings. 2 HIGH, 2 MEDIUM, 2 LOW.

---

## HIGH

### H1 — Web Stash ignores the customizable free-hookah-category setting; iOS respects it
**File:** `app/tobacco/page.tsx:144-145` vs `native/Mise/Mise/StashView.swift:88-93`

The dashboard has a settings screen (`app/dashboard/(shell)/settings/page.tsx`) where the
owner edits `restaurant_settings.free_hookah_categories` — a customizable list of "for
whom" categories for free hookahs. iOS reads this setting on every `loadShift()` and uses
it for the picker (`freeCats`, `StashView.swift:88-93`). Web hardcodes a fixed constant
instead and never reads the setting at all:

```ts
const FREE_CATS = ['Сотрудники', 'Владелец', 'Менеджер', 'Гость', 'Дегустация'] as const
```

**Failure scenario:** owner renames/adds/removes a free category in dashboard settings.
iOS staff now log free hookahs under the new category names (stored in
`hookah_sales.flavor`). Web staff on the same restaurant still see the old fixed 5
categories — they can't select the new ones, and any iOS-logged sale under a
custom category renders in web's free-category picker only via the generic label
fallback (`FREE_CAT_KEYS[cat] ? tr(...) : cat`), so the setting is functionally
web-inaccessible. Two staff members on two platforms see two different pickers for the
same restaurant.

**Suggested fix:** web should fetch `restaurant_settings.free_hookah_categories` in
`loadShift`/`loadAll` the same way iOS does, falling back to the current fixed list only
when the setting is empty.

---

### H2 — Web venueBase/venueLeft ignores the iOS-only "venue writeoff" movement type
**File:** `app/tobacco/page.tsx:166-171` (web `loadShift`) vs
`native/Mise/Mise/StashView.swift:78-126` (`saveVenueWriteoff` at line 505-526)

iOS has a feature — "Списание «с заведения»" — that writes a `tobacco_movements` row
with `type: 'writeoff'` and **empty brand/flavor** (the marker used to distinguish it
from a normal stock writeoff, which always has brand/flavor). This movement reduces
`venueBase` (total tobacco physically at the venue) without touching warehouse stock.
iOS's `venueBase` calc explicitly subtracts these:

```swift
let venueWriteoff = venueWo.filter { $0.brand.isEmpty && $0.flavor.isEmpty }.reduce(0) { $0 + $1.quantity_g }
venueBase = max(0, outs.reduce(0) { $0 + $1.quantity_g } - pastGrams - venueWriteoff)
```

Web's equivalent `loadShift` (`app/tobacco/page.tsx:166-171`) only queries
`type='out'` movements — it never fetches `type='writeoff'` rows, so it cannot
subtract venue writeoffs, and **web has no UI at all to create this movement type**
(web's own "writeoff" mode in the Movements tab always requires brand+flavor and
targets warehouse stock, a different operation that happens to share the same
`type` string).

**Failure scenario:** a manager on iOS writes off 500g as spoiled/wasted directly from
the venue floor (no brand/flavor, just weight+reason). iOS immediately shows the reduced
`venueLeft`. The web Stash dashboard, viewed a minute later, still shows the old
(higher) `venueLeft` — the two platforms permanently disagree on how much tobacco is at
the venue for the rest of that shift, since web's number is now structurally wrong until
someone accounts for the gap another way.

**Suggested fix:** either build venue-writeoff into the web Movements UI too, or at
minimum have web's `venueBase` subtract `type='writeoff'` rows with empty brand/flavor,
same as iOS.

---

## MEDIUM

### M1 — iOS clamps `venueLeft` to 0, hiding the over-issue signal web shows in red
**File:** `native/Mise/Mise/StashView.swift:208` vs `app/tobacco/page.tsx:228-229,317-320`

```swift
var venueLeft: Double { max(0, venueBase - gramsUsed) }
```
Web:
```ts
const venueLeft = venueBase - grams   // NOT clamped
...
<span style={{ color: venueLeft < 0 ? t.red : t.blue }}>{fg(Math.round(venueLeft))}</span>
```

Web treats a negative `venueLeft` as a real signal worth flagging in red (more tobacco
was recorded sold than was ever issued to the venue — a data-entry or accounting
problem). iOS silently floors the same condition to `0`, displaying it exactly like a
normal "all used up, none left" state. The underlying discrepancy still exists in the
data; iOS just doesn't surface it, so a manager using only the iOS app never sees the
warning web would show for the identical data.

**Suggested fix:** iOS should not clamp `venueLeft` at the display layer, or should at
least flag the negative case the same way web does (color/warning), so both platforms
agree on when something looks wrong.

### M2 — Inventory count corrections write no `tobacco_movements` audit-trail row (both platforms)
**File:** `app/tobacco/page.tsx:565-585` (`saveInv`) and
`native/Mise/Mise/StashView.swift:645-665` (`saveInventory`)

Both web and iOS, when a warehouse inventory count finds a discrepancy, `update()` the
`tobacco_stock.quantity_g` directly and record the diff only inside
`tobacco_inventories.items` (JSON). Every other stock change (in/out/writeoff, via
`saveMov`/equivalent) creates a row in `tobacco_movements`, which is the table the
"Движения" tab reads from. Inventory-driven corrections are invisible there.

**Failure scenario:** a discrepancy correction silently changes a position's quantity by
-300g with no entry in Movements. Anyone auditing "why did this item's stock change"
via the Movements tab (the tool built for exactly that question) will not find the
inventory-correction change and will conclude the numbers just don't add up.

**Suggested fix:** insert a `tobacco_movements` row (e.g. `type: 'inventory'` or reuse
`writeoff`/`in` with a distinguishing `reason`) alongside the `tobacco_stock` update, so
the movements ledger stays complete.

---

## LOW

### L1 — Web `timeStr()` hardcodes `ru-RU` locale, ignoring the active app locale
**File:** `app/tobacco/page.tsx:29-31`

```ts
function timeStr(iso: string) {
  return toUtcDate(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(',', ' ')
}
```
Used for every movement/inventory timestamp in the Movements and Inventory tabs. Nearby
code in the same file correctly branches on the live `locale` (e.g. `dDisp` at line 282
via `currentDate.toLocaleDateString(locale, ...)`, and the Russian-specific
pluralization check at line 843 — `locale === 'ru' ? ... : tr('st.itemsCount', ...)`).
`timeStr` is the one date formatter in the file that never looks at `locale` — a non-RU
user gets `дд.мм чч:мм`-style timestamps regardless of their selected language.

**Suggested fix:** pass `locale` into `timeStr` and use it in `toLocaleString`, matching
the rest of the file's i18n pattern.

### L2 — Batch writeoff/out validation doesn't cross-check duplicate rows within the same save
**File:** `app/tobacco/page.tsx:477-541` (`saveMov`)

Validation (lines 491-497) checks each row in the batch against the same pre-batch
`freshStock` snapshot independently. If a user adds two rows in one batch that both
target the same brand/flavor for an `out`/`writeoff` (e.g. 300g + 300g against a
400g-in-stock item), each row individually passes (`300 <= 400`), but the combined
effect (-600g) is silently clamped to 0 by the final update
(`Math.max(0, base.quantity_g + deltas[id])`, line 540) with no error shown — the user
believes both 300g deductions were applied as entered.

**Suggested fix:** validate the *cumulative* per-item delta across all rows in the
batch against `freshStock`, not each row in isolation.

---

## Verified — no regression found

- **Б6 weighted audit scoring** (`app/people/audits.tsx`): `normItem` defaults weight to
  1 and preserves it through save (line 519, 527-528); `runScore` (line 684-694) excludes
  N/A from the denominator and weights pass/total correctly. Matches the documented
  formula; the earlier `saveChecklistTemplate` weight-loss bug is not present here.
- **People "pure personal view" restructure** (`app/people/page.tsx`,
  `tabs-salary.tsx`): `SalaryTab` is read-only (no `insert`/`update` calls found), no
  manager-only write actions were found gated behind `isManager` in
  `tabs-shifts.tsx`/`tabs-ops.tsx`/`tabs-tasks.tsx` that would duplicate Manager's now
  owning write path — consistent with the restructure's intent.
- **Bookings status/swipe** (`BookingsView.swift:255-266` `setStatus`): optimistic local
  update with revert-on-failure, no regression from the earlier swipe/tap fix.
- **iOS `min_quantity_g`-based low-stock threshold** and **iOS inventory correction
  clamp-at-0** are consistent with web equivalents (aside from M2 above, which affects
  both).

## Not independently verifiable in this pass

- Memory referenced an iOS "confirmed" status added to the Stash grammage picker
  (2026-07-20, commit 8068b82). No `confirmed` identifier exists anywhere in the current
  `StashView.swift` (1838 lines) — either it was renamed during a later refactor or the
  feature was removed. Flagging for the user to confirm intent; not reported as a bug
  since there's no evidence of a regression, only an absent name.
