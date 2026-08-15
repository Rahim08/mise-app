# Block B — Bank Integration (Enable Banking) Security Audit — 2026-08-15

Read-only. No code changed.

## Scope
- `app/api/bank/connect/route.ts`, `app/api/bank/callback/route.ts`, `app/api/bank/sync/route.ts`
- `app/api/cron/bank-sync/route.ts`
- `lib/enableBanking.ts`
- `native/Mise/Mise/BankAuth.swift`
- Cross-checked: `app/api/db/route.ts` (generic gateway `POLICY` for `bank_connections`/`bank_transactions`)

## Flow as implemented
```
1. Client (web logged-in owner/manager, or iOS via ASWebAuthenticationSession)
   → POST /api/bank/connect  { country, query|institutionName, platform? }
   → resolveCaller() checks owner || apps.includes('manager') || apps.includes('analytics')
   → insert bank_connections{status:'pending'} scoped to caller.rid
   → state = connection.id (or "connection.id:ios")
   → Enable Banking createAuth(institution, redirectUrl=APP_URL/api/bank/callback, state)
   → returns { link } → client opens it (browser / ASWebAuthenticationSession)

2. User consents at bank (ASPSP) → redirected to
   GET /api/bank/callback?code=...&state=<connection.id>[:ios]
   → no cookie/session check — trusts `state` as an unguessable, single-use, previously-authorized token
   → select bank_connections where id=state AND status='pending'  (fails closed if already consumed)
   → createSession(code) → session_id + account_ids  [server-side JWT-authenticated call, code never reaches the client]
   → update bank_connections{status:'linked', account_id, requisition_id=session_id, consent_expires_at}
   → syncConnection() pulls balance + transactions immediately
   → web: 302 to /analytics?tab=bank
   → iOS: 200 HTML that does `location.replace("mise://bank-callback?ok=1")` (WebKit workaround for ASWebAuthenticationSession, see commit c966014)

3. Ongoing: POST /api/bank/sync (manual, throttled 1h, scoped to caller.rid)
           GET  /api/cron/bank-sync (daily, Bearer CRON_SECRET, iterates all status='linked')
```

## Findings

### MEDIUM — `/api/bank/connect` authorization broader than intended
`app/api/bank/connect/route.ts:22`
```ts
if (!caller || (!caller.owner && !caller.apps.includes('manager') && !caller.apps.includes('analytics'))) {
```
This endpoint **creates a new bank consent flow** (a higher-privilege, state-changing action — it's what puts a real bank-linking URL in front of the user and creates a live `bank_connections` row). The code comment above it says only:
> owner+manager (юзер-фидбок 2026-08-16: тест сейчас идёт под менеджерской сессией; сузить обратно до owner-only после теста, если понадобится)

It never mentions `analytics`. Any staff member granted only the `analytics` app (e.g. a reports-only viewer, which per `app/api/db/route.ts` POLICY is a normal, lower-trust role used for read access to money data) can independently kick off a real bank OAuth consent flow for the restaurant. This looks like scope creep copy-pasted from the read/sync permission pattern (`sync` legitimately includes `analytics` since it's just refreshing already-linked data — `connect` is not the same class of action).

**Fix:** restrict `/api/bank/connect` to `caller.owner || caller.apps.includes('manager')`, matching the stated intent. Leave `sync` as-is.

### MEDIUM — Custom URL scheme `mise://` is not namespaced (RFC 8252 scheme-squatting)
`native/Mise/Mise/BankAuth.swift:23` registers callback scheme `"mise"`. RFC 8252 §7.1 and Apple's own OAuth guidance recommend a reverse-DNS-style private-use scheme (e.g. `com.misesuite.app://`) specifically because bare-word custom schemes can be registered by more than one installed app, and iOS's resolution in that case is not something the app can control — a malicious app claiming the same scheme could intercept the callback.

**Mitigating factor (worth noting explicitly):** in this specific flow the impact is capped. The authorization `code` is exchanged for a session **server-side** inside `/api/bank/callback` (confidential-client pattern) — it never transits the `mise://` redirect. Only a bare `ok=1` or `error=<msg>` crosses the scheme boundary (`app/api/bank/callback/route.ts:66-68`). So scheme-squatting here could at worst let a malicious app spoof/observe "bank linked" success/failure, not intercept a token or account data. Still recommend namespacing the scheme as defense-in-depth and to avoid the class of bug entirely if this callback ever carries more data later.

### LOW — Non-atomic check-then-act on `bank_connections.status`
`app/api/bank/callback/route.ts:48-63`: `select ... eq('status','pending')` then later `update(...).eq('id', connection.id)` with no `eq('status','pending')` re-asserted on the update, and no unique/advisory lock. Two near-simultaneous callback deliveries for the same `state` (e.g. WebKit retrying the JS-redirect navigation, or the user double-tapping the consent screen back button) could both pass the initial `select` before either finishes, resulting in two `createSession(code)` calls. Self-limiting in practice because the `code` is single-use at Enable Banking (second exchange will error), but the two `syncConnection` calls could still race on the final `update`. Not exploitable, just a correctness nit.

**Fix (if it ever causes support tickets):** make the claim atomic — `update bank_connections set status='processing' where id=$1 and status='pending' returning *`, only proceed if a row came back.

### LOW — Callback web redirect uses request-derived origin, not canonical domain
`app/api/bank/callback/route.ts:37,43,68`: `origin = req.nextUrl.origin`, then redirects to `${origin}/analytics?...`. Commit `b526479` fixed exactly this class of bug on the *outbound* side (`redirect_url` sent to Enable Banking must be the canonical domain, not whatever `req.nextUrl.origin` resolves to for a `www.` vs apex request) — but the fix wasn't mirrored here on the *return* redirect. Low risk on Vercel (host is routed, not freely attacker-supplied), but for consistency with the earlier fix's own reasoning, consider building this redirect from `NEXT_PUBLIC_APP_URL` too rather than the inbound request's origin.

### INFO — No findings on: token/secret exposure, cross-tenant data leak, replay of consent
- `ENABLEBANKING_APP_ID`/`ENABLEBANKING_PRIVATE_KEY` are only read server-side (`lib/enableBanking.ts:35-36`), never returned in any response.
- Auth is a self-signed RS256 JWT per outbound request (`signJwt`) — no long-lived bearer token stored anywhere that could leak.
- `bank_connections`/`bank_transactions` are `write: []` in the generic `/api/db` gateway policy — only the server (service-role, bypassing the gateway) can write; all client reads are forced through `.eq('restaurant_id', caller.rid)` (`app/api/db/route.ts:232`) — no cross-tenant read path found.
- `POST /api/bank/sync` correctly scopes its connection lookup to `caller.rid` (`app/api/bank/sync/route.ts:22`).
- `GET /api/cron/bank-sync` is gated by `Bearer CRON_SECRET` (`app/api/cron/bank-sync/route.ts:12-14`) — standard Vercel Cron pattern, correct.
- iOS side uses `ASWebAuthenticationSession` with `prefersEphemeralWebBrowserSession = true` (`BankAuth.swift:44`) — correct, prevents cookie/session bleed between this flow and any other web session on device.
- State (`connection.id`) is a DB-generated UUID (unguessable) and single-use by construction (`status='pending'` gate) — functions as the CSRF/state binding a normal OAuth flow would use, appropriate substitute given the documented reason cookies aren't available on the iOS leg.

## Severity counts
CRITICAL: 0 · HIGH: 0 · MEDIUM: 2 · LOW: 2 · INFO: 5 (no action needed, documented for completeness)
