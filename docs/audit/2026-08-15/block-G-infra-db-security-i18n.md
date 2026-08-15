# Block G Audit — Infra / DB / Security / Notifications / i18n

Scope: `lib/db.ts`, `app/api/db/route.ts`, `lib/apiAuth.ts`, `lib/rateLimit.ts`, `lib/notify.ts`,
`lib/apns.ts`, `lib/notifyStrings.ts`, `lib/staffToken.ts` (+tests), `lib/format.ts`,
`lib/googleReviews.ts`, `lib/i18n.tsx` (spot-check), `app/api/{cron,log,health,telegram,storage,auth}/**`,
iOS `DB.swift`, `API.swift`, `Push.swift`, `AppModel.swift`, `Localization.swift` (spot-check).

**Overall**: this layer is unusually mature — nearly every file carries inline comments citing a
specific prior audit finding it fixes (e.g. TOCTOU races, cache scoping, error-message leaks,
billing-column tampering). Baseline is solid. Findings below are the residue.

## HIGH

1. **`/api/auth/pin/check` brute-force window is per-(IP, restaurant), not per-PIN-hash — a
   botnet/proxy-rotating attacker can still grind a 4-digit owner PIN.**
   `app/api/auth/pin/check/route.ts:34-37` keys the rate limiter as `` `${ip}:${restaurantId}` ``.
   `MAX_ATTEMPTS = 5` / `BLOCK_MS = 15min` per key (line 29-30) is fine against a single source, but
   nothing throttles the *global* attempt rate against one `restaurantId` across many IPs. A 4-digit
   owner PIN (`app/api/auth/pin/hash/route.ts:9` enforces `pin.length !== 4`) has only 10,000
   combinations; distributed across ~50 source IPs, an attacker clears the whole keyspace in well
   under an hour without ever tripping a single key's 5-attempt cap.
   Fix direction: add a secondary `restaurantId`-only counter (looser threshold, e.g. 50/15min) in
   `pin_record_failure`, or lock the restaurant's PIN login for a cooldown after N total distinct-IP
   failures.

2. **Postgres/PostgREST error messages are relayed to the client verbatim from the trusted gateway.**
   `app/api/db/route.ts:282` (`error: error.message`) and `:285` (`err?.message`) return the raw
   Supabase/Postgres error string to any authenticated caller (including non-owner staff). These can
   contain table/column/constraint names and occasionally values (e.g. unique-violation detail),
   which is more implementation detail than a staff-scoped client should see. Not exploitable for
   auth bypass (caller is already authenticated + scoped), but it's an information-disclosure smell
   inconsistent with the file's own stated goal ("error responses don't leak internal details").
   Fix direction: map known Postgres error codes (23505, 23503, ...) to generic messages; log the
   raw error server-side only.

## MEDIUM

3. **`push_subscriptions` rows aren't pruned when a staff member's `is_active` is set to false
   (offboarding) — only on explicit device-token failure or explicit logout.** Grep confirms
   `unsubscribePush()` (`AppModel.swift:409`) only runs from `logout()`. If a manager deactivates a
   staff row from the web dashboard without that employee tapping "Log out" on their own phone
   first, their device keeps a live `push_subscriptions` row and keeps receiving cash-amount pushes
   (subject to `show_cash_amount` pref) until the token itself goes stale. This is the exact bug
   class the `unsubscribePush()` comment at `AppModel.swift:405-408` describes fixing for the
   *logout* path — the *deactivation-without-logout* path was left open. Cross-check with People/
   Manager block: does deactivating a staff row server-side ever purge `push_subscriptions`
   for that `staff_id`? Grep of `app/api/db` shows no cascade/trigger for it.

4. **`TYPE_PREF` in `lib/notify.ts:17-29` has no entry for `audit`, `audit_close_reminder`, or
   `violation`.** Every other notification type is gated by a `notification_prefs` toggle
   (`p[prefKey] !== false`); these three fall through the `prefKey ? ... : true` branch
   (`lib/notify.ts:90-94`) and are **always** sent regardless of what the recipient configured. If
   intentional (compliance-style pushes shouldn't be mutable), fine — but nothing in the code marks
   it as deliberate the way other exceptions are commented (e.g. the `purchase_digest` carve-out at
   `lib/notify.ts:141`). Worth a one-line comment either way so it doesn't get "fixed" by accident
   later, or worth adding pref keys (`audit`, `auditCloseReminder`) if the omission was accidental.

5. **`checkRateLimit` fails open, and several unauthenticated-adjacent endpoints have no rate limit
   at all.** `lib/rateLimit.ts:16` is a deliberate fail-open (documented, reasonable). But
   `app/api/auth/admin-view/route.ts` (super-admin impersonation lookup) and
   `app/api/storage/audit-photo/route.ts` (photo upload, up to 8MB per authenticated call) have no
   `checkRateLimit` call. `admin-view` is low-risk (just echoes a cookie-derived rid, GET-only). The
   photo upload endpoint, though authenticated, has no per-caller throttle — a compromised/malicious
   staff session could hammer Supabase Storage with 8MB uploads with no backoff. Low likelihood, but
   cheap to add given the pattern already exists (`rateLimitKey` + `checkRateLimit` one-liner).

6. **`storage/audit-photo` trusts the client-declared file type unconditionally.**
   `app/api/storage/audit-photo/route.ts:35` uploads with `contentType: 'image/jpeg'` hardcoded,
   with no magic-byte / MIME sniff on `bytes`. A malicious client can upload arbitrary bytes (HTML,
   SVG-with-script, etc.) that get served back from Supabase Storage's public URL labeled as
   `image/jpeg`. Modern browsers mostly honor `Content-Type` for `<img>` contexts, so exploitability
   is low, but there's no `X-Content-Type-Options: nosniff` guarantee from Supabase Storage's CDN
   layer to fall back on, and this is a well-known "unrestricted file upload" pattern reviewers flag.
   Fix direction: sniff the first few bytes for a JPEG magic number (`FF D8 FF`) and reject otherwise.

## LOW

7. **`/api/db` (the single highest-traffic authenticated endpoint in the app) has no rate limit at
   all**, unlike `/api/log`, `/api/auth/welcome`, etc. It's behind `resolveCaller` auth, so this
   isn't an open door — but there's also no per-caller ceiling protecting the service-role Postgres
   connection from a runaway client bug (e.g. a retry loop with no backoff) or a rogue authenticated
   staff session scripting requests. Given every other write-capable route in this codebase gets a
   `checkRateLimit` call, the gateway itself being the one exception looks more like an oversight
   than a decision — worth a one-line comment confirming it's deliberate (traffic pattern doesn't
   suit a shared IP-keyed limiter) or adding a generous per-caller-token limit.

8. **`rateLimitKey` trusts `x-forwarded-for` as-is.** `lib/rateLimit.ts:22-24` and the bespoke
   version in `pin/check/route.ts:34-37` both take `.split(',')[0]` of the header. On Vercel this
   header is set by the edge and the client-supplied value is appended after Vercel's own hop, so
   `[0]` should be Vercel-trusted in practice — but this is worth an explicit one-time confirmation
   against current Vercel docs (proxy header ordering has changed across providers before) rather
   than an assumption baked into two independent rate-limiters. If it ever turns out client-
   controlled, both the general rate limiter and the PIN brute-force guard (finding #1) degrade
   simultaneously since an attacker could self-assign a fresh key per request.

9. **`apns.ts` HTTP/2 requests have no explicit timeout.** `sendOne()` (`lib/apns.ts:44-79`) calls
   `http2.connect()` and waits on `req`/`client` events with no `setTimeout`/`AbortSignal`. If Apple's
   endpoint accepts the TCP connection but never responds, the promise never resolves and the caller
   (`dispatchNotification`, called synchronously in a loop over multiple recipients/langs) hangs
   until the platform's own function timeout kills it — degrading to "no push delivered to anyone
   after the stuck one" for that invocation rather than a clean per-token failure.

10. **Photo/content-type aside, `audit-photo` filenames are attacker-influenced only via
    `completion_id`/`item_id`, which are UUID-shaped in practice but not validated as such** —
    `app/api/storage/audit-photo/route.ts:34` builds the storage path by direct string interpolation:
    `` `audits/${caller.rid}/${completion_id}/${item_id}-${Date.now()}.jpg` ``. `caller.rid` is
    server-trusted (fine), but `completion_id`/`item_id` come straight from the request body with no
    format check. Supabase Storage path traversal via `../` in a key is not typically exploitable the
    way a filesystem path is, but there's no test/assertion preventing a client from writing to a
    sibling `completion_id` directory it doesn't own — worth a `restaurant-assets` bucket policy
    review if not already scoped by path prefix.

## Schema drift check (vs. `docs/migrations/Supabase Snippet Schema Column Introspection.csv`)

Spot-checked `app/api/db/route.ts` POLICY table names and the columns referenced in
`lib/db.ts`/cron files against the CSV — no drift found. `shifts.opened_at` (not `created_at`),
`inkassations.total` (not `balance`), and `shift_expenses.employee_id` are all used consistently
everywhere they're touched in this block's scope. `restaurant_settings.timezone`,
`restaurant_settings.salary_payout_day`, and `restaurants.subscription_status` /
`subscription_id` are all read defensively (`try/catch` or optional-chained) in `cron/reminders`,
consistent with the comments noting their migrations may not be applied on every environment yet.

## What's already solid (no action needed, noted so it isn't "rediscovered")

- `app/api/db/route.ts`: table-level `POLICY`, `OWNER_ONLY_COLUMNS` post-fetch stripping,
  `BILLING_ONLY_COLUMNS` write guard, `SAFE_COLUMNS_RE` blocking PostgREST embed syntax, mandatory
  filter on update/delete — all present and each has a comment tying it to a specific past incident.
  This is a genuinely hardened gateway.
- `lib/staffToken.ts` + `staffToken.test.ts`: constant-time signature comparison, `typ`-tagged tokens
  preventing admin-view/staff token confusion in either direction, expiry enforcement, and tests that
  actually exercise tamper/expiry/cross-secret/escalation cases (not just happy path).
- `app/api/cron/*`: every cron route fail-closed on a missing `CRON_SECRET` (`!secret || ...`
  rejects rather than defaulting to open) — the safe order that's easy to get backwards.
- `lib/rateLimit.ts`: atomic DB-side RPC avoids the in-memory-Map-doesn't-work-across-serverless-
  instances trap, with an explicit fail-open decision (documented).
- iOS `DB.swift`/`AppModel.swift`: cache-key hashing was fixed to avoid the truncated-hash-collision
  bug; `logout()` clears cache, cookies (including the App Group cookie jar the widget shares),
  notification state, and widget snapshot together — checked the only two reachable "identity
  switch without explicit logout" paths (`sessionExpired()` re-auth, `handleScan()` after QR
  re-scan) and both only reach `.pin`/`.welcome` in ways that don't leak cross-identity cached data.
- `an.bank*` i18n keys: full 12/12 parity between `app/analytics/page.tsx` and
  `Localization.swift`, all 8 locales populated (spot-checked, not a stub/EN-fallback situation).
