# Block F Audit — Billing (Stripe) / Auth / Account — 2026-08-15

Read-only audit. Scope: `app/api/stripe/**`, `app/api/auth/**`, `app/api/account/delete`, `app/auth/**`, `lib/stripeAuth.ts`, `lib/stripePrices.ts`, `lib/staffToken.ts`, `lib/plans.ts`, `lib/apiAuth.ts`, `lib/rateLimit.ts`, iOS `Biometrics.swift`/`Permissions.swift`/`OnboardingView.swift`.

Overall: this block is in noticeably better shape than a typical first-pass billing integration — webhook dedup, owner-authorization checks, PIN rate-limiting, and open-redirect protection are all already implemented deliberately (comments reference prior incidents/fixes, e.g. `stripe-events-2026-07.sql`, `rate-limit-atomic-2026-07.sql`, `account-delete-atomic-2026-07.sql`). Findings below are real gaps found on top of that baseline, not a rewrite recommendation.

## HIGH

### 1. Deactivating/re-binding a staff member does not revoke their already-issued session token
`lib/staffToken.ts:15` sets a 10-year TTL for the staff cookie by design (documented, not itself a bug). The problem is what happens *after* issuance: `lib/apiAuth.ts:13-38` (`resolveCaller`) derives the caller's identity and **`apps` permissions entirely from the signed token payload** — it never re-queries `staff.is_active` or `staff.device_id`. `app/api/db/route.ts:170-178` and `:212` then authorize every request purely off that `caller` object.

Concretely: `staff.is_active` is only checked at PIN-entry time (`app/api/auth/pin/check/route.ts:92`, filters `is_active=true`) and in UI staff-picker lists (`app/people/*`, `app/manager/*`, all `.eq('is_active', true)`) — never on the data path. So:
- An owner fires an employee and sets `is_active=false` (or blanks `device_id` to "unbind" a lost phone) — the employee's phone still has a valid `mise_staff_token` cookie and keeps full API access to every module in `caller.apps` (frozen at issuance) indefinitely, or until the 10-year token naturally expires.
- There is no "kick device" / "revoke session" action anywhere in the reviewed code that invalidates an already-issued token server-side.

Given the token also carries cash-handling module scopes (`manager`, `stash`), a disgruntled ex-employee retains real operational access to another business's live data with only a client-side "deactivated" flag standing in the way of the UI, not the API. Combined with the 10-year TTL, this is a materially larger exposure than a normal short-lived-session app.

**Fix direction**: add a `token_version` (or `revoked_at`) column on `staff`/`restaurants`, embed it in the token payload, and check it against the current DB value in `resolveCaller` (one extra indexed lookup, cacheable). Bump it on deactivation/device unbind/PIN reset to invalidate all outstanding tokens for that identity immediately.

### 2. PIN brute-force rate limit is keyed by `ip:restaurantId`, not per-device — a few mistyped PINs can lock out an entire restaurant's floor staff
`app/api/auth/pin/check/route.ts:34-37` (`rateLimitKey`) builds the lock key from `ip + restaurantId` only. The request already carries a `deviceId` (used two lines later for device-binding, line 101) but it is **not** part of the rate-limit key.

In practice, an entire restaurant is typically one NAT'd public IP (shared WiFi). `MAX_ATTEMPTS = 5` (line 29) is shared across *every device and every staff member* trying *any* PIN at that restaurant. Two or three staff mistyping their PIN during a busy open (very plausible — 4-digit PINs, gloved/wet hands, POS rush) exhausts the shared budget and locks out `BLOCK_MS = 15 * 60 * 1000` (15 minutes) for **the whole restaurant**, including the owner and every other employee, not just the person who mistyped. This is a self-inflicted denial-of-service baked into the rate limiter's granularity, and it's more likely to actually happen (staff fumbling PINs) than the attack it's meant to prevent (targeted brute force from one IP).

**Fix direction**: key on `deviceId:restaurantId` (or `ip:deviceId:restaurantId`) instead of `ip:restaurantId`, since `deviceId` is already collected and already used to scope device binding two lines down.

## MEDIUM

### 3. `resolvePriceIds` price-ID cache has no invalidation — a Stripe Dashboard price edit can silently break checkout/upgrade for the life of a warm instance
`lib/stripePrices.ts:6` caches `lookup_key -> price.id` in a module-level `Map` with no TTL, explicitly relying on Fluid Compute instance reuse (comment, line 2). If prices are ever recreated under the same `lookup_key` (re-running `scripts/stripe-setup.mjs`, or manually archiving+recreating a price in the Stripe Dashboard for a price correction), warm instances keep serving the **stale, now-archived** price ID until they cold-start. `stripe.checkout.sessions.create`/`subscriptions.update` with an archived price ID fails, so checkout/upgrade would break for an unpredictable window after any price change, without an obvious cause (works on some Vercel instances, fails on others, only recovers when Vercel eventually cycles instances). Low probability event, but hard to diagnose when it happens because the symptom won't correlate with a deploy.

**Fix direction**: either add a short TTL (e.g. 5–10 min) to the cache entries, or accept staleness but log the cached-vs-looked-up price id mismatch so a future price edit is diagnosable.

### 4. Stripe webhook processes everything synchronously inline before returning 200 — deviates from documented best practice and has an un-parallelized loop
Current Stripe guidance (see Sources) is: verify signature → enqueue → return 200 immediately, because Stripe times out and retries if you don't respond promptly. `app/api/stripe/webhook/route.ts:94-133` (checkout.session.completed) instead does everything inline and sequentially before responding: retrieves the subscription, writes to `restaurants`, looks up the owner, calls `supabase.auth.admin.getUserById`, sends a receipt email (`sendPaymentReceiptEmail`), then lists **all** sibling subscriptions and cancels stale ones **in a sequential `for` loop** (`await stripe.subscriptions.cancel(o.id)` one at a time, line 128-132) — every extra sibling subscription adds one more full network round-trip before the handler can return. None of this is currently a proven incident, but it's a real deviation from the platform-recommended pattern and the sequential-cancel loop is the part most likely to blow past a timeout under any load spike or Stripe API slowness, which would trigger Stripe's own retry (usually harmless given the dedup logic, but adds latency/log noise and, if `releaseClaim` fires mid-way through a partially-applied change, some side effects like the receipt email could double-fire since email sending isn't part of the dedup-guarded transaction and isn't itself idempotent).

**Fix direction**: not urgent at current volume; if it becomes an issue, move the receipt-email send and multi-subscription cleanup off the synchronous request path (e.g. a Supabase queue/cron sweep), keeping only the `restaurants` write inline before the 200.

### 5. Account deletion can silently leave a live, still-billing Stripe subscription with no DB record to associate it with
`app/api/account/delete/route.ts:36-45`: if `stripe.subscriptions.cancel()` throws (network blip, already-canceled-elsewhere race, Stripe outage), the error is caught, `console.error`'d, and **deletion proceeds anyway** — the `restaurants` row and the `auth` user are deleted regardless (lines 47-64). There is no compensating job, alert, or record kept of the orphaned `subscription_id`/`stripe_customer_id` for follow-up. Result: a customer who deletes their account keeps being billed by Stripe with no application-side record left to notice, refund, or even identify the correct restaurant/customer for support.

**Fix direction**: on cancel failure, either block deletion until cancellation succeeds, or persist the orphaned `stripe_customer_id`/`subscription_id` (e.g. to `app_errors` with a distinguishable tag, or a dedicated table) so it surfaces for manual reconciliation instead of only living in Vercel logs.

## LOW

### 6. `impersonate` (admin "view as client") has no audit trail
`app/api/admin/route.ts:127-141`: issuing an `admin_view` token that grants full owner-level access to any restaurant is not logged anywhere (no insert into `admin_notes` or any audit table). Access is correctly gated to the single `ADMIN_EMAIL` account and the token is short-lived (1h, `lib/staffToken.ts:80`), so this is a low-severity gap given the single-admin design, but for a product handling other businesses' financial data, an unauthenticated-after-the-fact "who looked at restaurant X and when" trail is standard due-diligence and currently absent. Every other admin mutation (`updateSub`, `perks`, `setAddons`, etc.) also lacks an actor/timestamp audit row, only `addNote` is explicit.

### 7. PIN hash endpoint accepts any 4-character string, not just digits
`app/api/auth/pin/hash/route.ts:9`: `if (!pin || pin.length !== 4)` checks length only. Functionally harmless (bcrypt hashes/compares any string consistently) since the PIN entry UI presumably restricts input to digits, but the server contract doesn't actually enforce "PIN" semantics — worth a `/^\d{4}$/` check so a future non-numeric client input path doesn't quietly issue a valid but out-of-spec PIN.

### 8. `cancel/route.ts` doesn't guard against calling `cancel_at_period_end` on an already-canceled subscription
`app/api/stripe/cancel/route.ts:29`: no check of `sub.status` before calling `stripe.subscriptions.update(..., { cancel_at_period_end: true })`. If the subscription was already fully canceled (e.g. via `customer.subscription.deleted` webhook racing a duplicate "Cancel" click), Stripe returns an error, which is caught and surfaced as a generic 500/"Internal error" to the user rather than a clean "already canceled" message. Minor UX rough edge, not a correctness bug.

## Things checked and found correct (no action needed)
- Webhook signature verification uses the raw body (`req.text()`, not parsed JSON) and `stripe.webhooks.constructEvent` — matches current Stripe guidance.
- Webhook idempotency uses a claim/release pattern on a unique `event_id` (superior to naive "insert once" — a mid-processing failure releases the claim so Stripe's retry actually reprocesses, rather than being silently swallowed).
- `verifyOwner` (`lib/stripeAuth.ts`) correctly derives `userId`/`email` from the server-side Supabase session, never trusts a client-supplied user id — checkout/portal/cancel/update all call it and check `restaurants.owner_id === user.id`, so one owner cannot act on another's subscription by guessing a `restaurantId`.
- `stripe/update` price/plan/addon values are resolved server-side against `lib/plans.ts` (`PLANS`, `ALL_MODULES`), never trusts a client-sent price ID directly.
- `staffToken`/`admin_view` token verification uses `crypto.timingSafeEqual` (constant-time compare) and a `typ` discriminator that explicitly rejects an admin-view token being replayed as a staff token and vice versa — good defense against cookie-cross-use.
- `auth/callback/route.ts` validates the `next` redirect target against protocol-relative/absolute URLs before using it — no open redirect.
- `pin/check` route enforces device binding against `entitlements(rest).seats` (billing-v2 seat limit) atomically enough for practical purposes, and uses a DB-backed atomic RPC (`pin_record_failure`) rather than read-then-write, closing a real prior TOCTOU race (per code comment).
- Rate limiting fails open on DB error (documented, reasonable tradeoff for this product).

## Severity summary
CRITICAL: 0 · HIGH: 2 · MEDIUM: 3 · LOW: 3

Sources consulted:
- [Stripe Webhooks — official docs](https://docs.stripe.com/webhooks)
- [Stripe Webhook Security: Signature Verification, Idempotency, and Local Testing](https://dev.to/whoffagents/stripe-webhook-security-signature-verification-idempotency-and-local-testing-1lk3)
- [Stripe Webhooks 2026: Setup and Best Practices](https://apiscout.dev/guides/stripe-webhooks-complete-guide-2026)
