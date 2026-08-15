# Block E Audit — Menu (QR platform), Dashboard shell, Admin

Read-only audit, 2026-08-15. Web-only scope (no iOS equivalent for these modules).

Scope read in full: `app/menu/[slug]/page.tsx`, `app/menu/[slug]/altLayouts.tsx`, `app/dashboard/(shell)/menu/page.tsx`, `app/dashboard/(shell)/layout.tsx`, `app/admin/page.tsx`, `app/api/menu/[slug]/route.ts`, `app/api/menu/event/route.ts`, `app/api/menu/order/route.ts`, `app/api/menu/import/route.ts`, `app/api/menu/translate/route.ts`, `app/api/admin/route.ts`, `lib/menu.ts`, `lib/apiAuth.ts`, `lib/staffToken.ts`.

## HIGH

### 1. Dayparting (schedule) is enforced client-side only — trivially bypassed via direct API call
- `lib/menu.ts:109` defines `itemAvailableNow(schedule, now)`, used in `app/menu/[slug]/page.tsx:423,488,503` to hide/filter items outside their scheduled window.
- `app/api/menu/order/route.ts` (guest order creation, public unauthenticated endpoint) never imports or calls `itemAvailableNow`, and never reads `menu_items.schedule` at all. It only validates `is_visible`, `is_available`, and `stock_left` (lines 108–153).
- **Failure scenario:** a breakfast-only item (schedule 07:00–11:00) is hidden from the guest UI at 23:00, but a guest who has the item's `id` (visible earlier, cached in browser history, or obtained by hitting `/api/menu/[slug]` directly) can `POST /api/menu/order` with that id at any hour and the order is accepted and priced normally. For venues that use dayparting for compliance reasons (e.g. alcohol/hookah service hours), this is a real operational/legal exposure, not just a UX quirk.
- Fix: re-check `itemAvailableNow(dbItem.schedule)` server-side in the same loop that already validates `is_visible`/`is_available` (order/route.ts:123).

### 2. `/api/menu/translate` comment says "Owner-only" but code accepts any staff PIN token
- `app/api/menu/translate/route.ts:1` — comment: "Owner-only menu auto-translation."
- `getRestaurantId` (lines 12–25) calls `verifyStaffToken` and returns `staff.rid` for **any** valid staff token, regardless of `staff.owner` or `staff.apps`. No role/app check.
- Contrast with the sibling endpoint `app/api/menu/import/route.ts:17-21`, which explicitly does `staff.owner ? staff.rid : null` and comments "PIN-сессии сотрудников отклоняем (аудит-находка 8)" — i.e. this exact class of bug was already found and fixed in `import`, but the fix was never applied to `translate`.
- **Failure scenario:** any staff member with a PIN — even one whose `apps` don't include `menu` — can call `/api/menu/translate` directly (not through the UI) and burn the restaurant's `GROQ_API_KEY` quota an unlimited number of times (no rate limit either, see MEDIUM #3).
- Fix: mirror import's `staff.owner ? staff.rid : null` check.

### 3. Admin impersonation grants full owner write access with zero audit trail
- `app/api/admin/route.ts:127-141` (`impersonate` action) issues an `ADMIN_VIEW` cookie for any `restaurantId` on request, no note/log written.
- `lib/apiAuth.ts:14-18`: the admin-view token resolves to `{ owner: true, apps: ['manager','analytics','stash','people'] }` — i.e. full owner-equivalent read/write on `/api/db` for up to 1 hour, for *any* restaurant, with no server-side record of which admin impersonated whom, when, or what they did while impersonating.
- `admin_notes` table exists and is used for manual notes (`addNote` action) but is never auto-populated on impersonate/stop.
- **Failure scenario:** if the single `ADMIN_EMAIL` account is ever compromised (phished, leaked session), the attacker can silently read and modify any client's cash/salary/inventory data for up to an hour per impersonation, and there is no log to detect or investigate this after the fact.
- Fix: insert an `admin_notes` (or dedicated `admin_audit_log`) row on `impersonate`, minimum `{restaurant_id, admin_email, action:'impersonate', at}`.

## MEDIUM

### 4. No idempotency protection on guest order submission
- `app/api/menu/order/route.ts` — every POST creates a new `menu_orders` row; no client-supplied idempotency key, no de-dupe window.
- **Failure scenario:** guest double-taps "Order" on a slow connection, or the client retries after a timeout; two identical orders are created and stock is decremented twice (via `decStock`, lines 25–36) even though the guest only intended one. Kitchen receives a duplicate ticket.
- Fix: accept a client-generated `client_order_id` (UUID generated once per cart submission) and unique-constrain / upsert on it.

### 5. Public menu GET (`/api/menu/[slug]`) has no rate limiting
- Every other public/anonymous route in this block (`event`, `order`, `import`) calls `checkRateLimit` (`lib/rateLimit.ts`). `app/api/menu/[slug]/route.ts` does not, despite running 4–5 Supabase queries per request (including a `menu_events` scan of up to 3000 rows for trending calculation) using the service-role key.
- Impact: scraping and low-effort cost/DoS amplification against Supabase are both easier here than on the neighboring routes that were clearly hardened against exactly this.
- Fix: add the same `checkRateLimit(rateLimitKey(req,'menu-get'), N, window)` pattern used elsewhere in this file's sibling routes.

### 6. `/api/menu/translate` has no rate limit or input length cap
- Unlike `import` (`MAX_TEXT_CHARS = 14000`, 5 requests / 10 min), `translate/route.ts` neither caps `text.length` nor calls `checkRateLimit`. Combined with finding #2 (any staff PIN accepted), an arbitrary-length string can be sent to Groq repeatedly with no throttle, at the restaurant's expense.
- Fix: add a length cap (e.g. 500 chars — this is a dish name/description field) and a rate limit consistent with `import`.

### 7. Admin `freeze` action has no confirmation step
- `app/admin/page.tsx:163-167` (`freeze`) fires immediately on click of the "Заморозить" danger button (line 474) — no `confirm()`/modal, unlike how most other irreversible actions in this codebase are gated per CLAUDE.md's stated caution around destructive ops.
- **Failure scenario:** a misclick on the danger-styled freeze button in the admin panel instantly suspends a paying client's subscription with no undo prompt (an `updateSub` call to `active` fixes it, but only after the admin notices).
- Fix: add a confirm step (native `confirm()` is fine for an internal admin tool) before the `freeze()` call.

### 8. Admin `list` action does 4 sequential-per-restaurant queries with no pagination
- `app/api/admin/route.ts:32-48` — for every restaurant in the table, fires 4 parallel Supabase queries (`Promise.all` across restaurants is *not* used — the `for` loop `await`s each restaurant's `Promise.all` in series). With N restaurants this is O(4N) round-trips, all serialized.
- Not a correctness bug today (restaurant count is presumably small), but it's a scalability trap that will silently degrade the admin panel's load time as the client base grows, with no pagination/limit anywhere in the `list` handler.
- Fix: either parallelize across restaurants (`Promise.all` over the restaurant list too) or move the stats into a single aggregated query/RPC.

## LOW

### 9. `menu_events` "order" event type duplicates real order creation semantics
- `app/api/menu/event/route.ts:8` allows `type: 'order'` as an anonymous analytics event, separate from the actual order created by `app/api/menu/order/route.ts`. Nothing ties these together (no shared id), so a guest client could send an `event type:'order'` without ever calling `/api/menu/order`, inflating order-count analytics without a real order existing. Low impact (analytics-only), but worth naming consistently (e.g. `checkout_click` vs the real order) to avoid confusing "orders" metrics with actual `menu_orders` rows.

### 10. Tip cannot exceed subtotal
- `app/api/menu/order/route.ts:161`: `safeTip = ... money(Math.min(tipNum, subtotal))`. A guest who wants to tip more than the bill (common for small bills, e.g. ₽200 order + ₽500 tip) is silently capped to the order subtotal. Likely unintended — most POS/QR tipping UX allows tips independent of (and often exceeding) the subtotal.

## Notes / out of scope
- `app/api/menu/import/route.ts` is the best-built endpoint in this block: file-size cap, text-char cap, plan gate, rate limit, and the owner-only staff check that `translate` is missing. Use it as the template when fixing #2/#5/#6.
- Dashboard shell's module-lock gate (`app/dashboard/(shell)/layout.tsx:82-98`) correctly re-checks by URL/pathname, not just nav clicks, and guards against flashing a locked module's data before the redirect — no issue found there.
- No `dangerouslySetInnerHTML`/`innerHTML`/`eval` found anywhere in this block's scope.
