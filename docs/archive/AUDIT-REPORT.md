# Mise — Comprehensive Audit Report

**Date**: 2026-07-01
**Auditors**: 12 parallel agents (6 explore + 6 general)
**Scope**: Security, Database, Code Quality, Dependencies, iOS, i18n, React Patterns

---

## Executive Summary

| Category | Critical | High | Medium | Low | Total |
|----------|----------|------|--------|-----|-------|
| Security | 3 | 5 | 5 | 5 | 18 |
| Database | 0 | 0 | 2 | 3 | 5 |
| Code Quality | 0 | 1 | 3 | 0 | 4 |
| Dependencies | 0 | 1 | 2 | 1 | 4 |
| iOS / i18n | 1 | 3 | 4 | 2 | 10 |
| React / Architecture | 1 | 3 | 2 | 1 | 7 |
| **TOTAL** | **5** | **13** | **18** | **12** | **48** |

**Overall grade: C+** — The app works and has a solid data layer, but has significant security gaps, no error handling, and massive code duplication that will slow future development.

---

## CRITICAL Issues (Must Fix Immediately)

### C1. Apple .p8 Key Committed to Git History
**File**: `AuthKey_W6HCZSDZ6W.p8` (repo root)
**Impact**: Anyone with repo access has the full Apple identity signing key for `com.rahim.mise`. Can forge Sign in with Apple and APNs push notifications.
**Fix**: Revoke this key in Apple Developer portal NOW. Generate new key. Store only in Vercel env vars. Git history is permanent — `.gitignore` is not enough.

### C2. Supabase Service Role Key Used as HMAC Secret
**File**: `lib/staffToken.ts:23`
```ts
const s = process.env.MISE_TOKEN_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY
```
**Impact**: If `MISE_TOKEN_SECRET` is unset, the DB service role key (full bypass) is used to sign staff tokens. An attacker who leaks the service role key can forge arbitrary staff tokens.
**Fix**: Set `MISE_TOKEN_SECRET` in Vercel env to a dedicated random value. Remove the `SUPABASE_SERVICE_ROLE_KEY` fallback.

### C3. No Content Security Policy (CSP)
**File**: `next.config.ts:10-11`
**Impact**: XSS attacks can exfiltrate session cookies, admin tokens, and user data. The app embeds itself in iframes (`SAMEORIGIN`), making clickjacking possible.
**Fix**: Implement strict CSP with nonces/hashes. Audit all inline scripts, Supabase CDN, Google Fonts, Stripe.js origins.

### C4. All Transactional Emails Hardcoded in Russian
**File**: `lib/email.ts` (lines 55-95)
**Impact**: Any non-Russian user receives welcome, trial reminder, and payment confirmation emails entirely in Russian.
**Fix**: Integrate with the i18n system. Emails should use the user's language preference.

### C5. No Error Boundaries — Any Crash = White Screen
**Files**: No `error.tsx` anywhere in `app/`
**Impact**: Any uncaught render error shows the default Next.js error page with no recovery UI. The `ErrorReporter.tsx` is a global logger, not an error boundary.
**Fix**: Add `error.tsx` to each route group. Add `global-error.tsx` to root.

---

## HIGH Issues (Fix Before Next Release)

### H1. `/api/debug-oauth` — Unauthenticated Info Disclosure
**File**: `app/api/debug-oauth/route.ts`
**Impact**: Any visitor can probe OAuth configuration and see error details. Should not exist in production.
**Fix**: Delete entirely, or gate behind admin auth + `NODE_ENV !== 'production'`.

### H2. `/api/log` — Unauthenticated Error Sink
**File**: `app/api/log/route.ts`
**Impact**: Any POST can write arbitrary data to `app_errors` table using service role key. No rate limiting.
**Fix**: Add rate limiting and authentication.

### H3. `/api/health` — Unauthenticated Endpoint
**File**: `app/api/health/route.ts`
**Impact**: Opens a Supabase connection on every request. DDoS amplification vector.
**Fix**: Add lightweight bearer token check.

### H4. PIN Brute-Force: `deviceId` Bypass
**File**: `app/api/auth/pin/check/route.ts:98-99`
**Impact**: Omitting `deviceId` entirely bypasses device binding check. Rate limit uses `x-forwarded-for` which is spoofable on Vercel.
**Fix**: Require `deviceId` on all PIN check calls. Add secondary rate limit independent of IP.

### H5. No Global Rate Limiting
**Finding**: Only `/api/auth/pin/check` has rate limiting. All other endpoints (AI, admin, telegram, menu, log) are unprotected.
**Impact**: AI endpoint can burn Groq credits. Admin can be spammed. Menu events can be flooded.
**Fix**: Add rate limiting to at least: `/api/ai`, `/api/admin`, `/api/telegram`, `/api/log`.

### H6. `resolveCaller` Duplicated with Different Permissions
**Files**: `lib/apiAuth.ts:13` vs `app/api/db/route.ts:111`
**Impact**: Owner gets `['manager', 'analytics', 'stash', 'people']` via apiAuth but only `['manager', 'analytics', 'stash']` via gateway. Privilege inconsistency.
**Fix**: Delete the duplicate in `route.ts`. Import from `lib/apiAuth.ts`.

### H7. Telegram Bot: No Secret Fallback Protection
**File**: `app/api/telegram/route.ts:42-44`
**Impact**: If `TELEGRAM_WEBHOOK_SECRET` is unset, the guard is bypassed. Anyone can POST fake updates and burn Groq credits.
**Fix**: Fail closed — reject all requests if secret not configured.

### H8. ~60 Hardcoded Russian Strings in Production
**Impact**: Non-Russian users see Russian in push notifications, chart labels, CSV/PDF exports, admin panel, and default categories.
**Files**: See Section 5 below.

### H9. People Page: 2,314 Lines / 89 useState
**File**: `app/people/page.tsx`
**Impact**: Unmaintainable. 89 useState hooks in one component. Extremely hard to debug, test, or modify.
**Fix**: Split into sub-components (attendance, schedules, payroll, absences, time-clock).

### H10. No Loading States (loading.tsx)
**Finding**: Zero `loading.tsx` files in `app/`. No streaming/Suspense loading UX at route level.
**Impact**: Users see blank screens during data fetches instead of skeleton loaders.

### H11. No Memoization Anywhere
**Finding**: Zero `React.memo`, zero `useMemo`/`useCallback` in all page code. React 19 concurrent features unused.
**Impact**: Every keystroke re-renders the full component tree. Performance degrades with data size.

### H12. 100% Inline Styles (10,725 lines)
**Finding**: All page code uses `style={{...}}` objects. Zero CSS modules, minimal Tailwind.
**Impact**: No design-system enforcement, no responsive utilities, hard to maintain visual consistency.

### H13. tsconfig `strict: false` Contradicts CLAUDE.md
**File**: `tsconfig.json`
**Finding**: CLAUDE.md says "TypeScript strict" but tsconfig has `strict: false` and `noImplicitAny: false`.
**Impact**: Type safety is weaker than documented. Bugs that could be caught at compile time slip through.

---

## MEDIUM Issues (Plan to Fix)

### M1. 10+ Tables Missing RLS
**File**: `docs/security/rls.sql`
**Tables**: `salary_advances`, `hookah_sales`, `bookings`, `news_posts`, `guest_notes`, `notification_prefs`, `purchase_items`, `push_subscriptions`, `notifications`
**Impact**: If anon key is compromised, these tables are directly accessible.

### M2. `fmtDate` Duplicated 4 Times
**Files**: `manager:19`, `people:16`, `analytics:16`, `cron/reminders:18`
**Impact**: Format changes must be applied 4 times. Risk of divergence.

### M3. `fv` (Format Value) Duplicated 3 Times with Different Signatures
**Files**: `manager:17`, `analytics:14`, `menu/[slug]:76`
**Impact**: Menu version adds currency formatting — inconsistent display.

### M4. `fmtDay` Duplicated 2 Times
**Files**: `tobacco:133`, `dashboard:77`

### M5. Dashboard Page: 1,835 Lines
**File**: `app/dashboard/page.tsx`
**Impact**: Same maintenance risk as people page, slightly smaller.

### M6. Analytics CSV/PDF Headers Hardcoded Russian
**File**: `app/analytics/page.tsx:581-631`
**Impact**: Downloaded files have Russian column names regardless of user language.

### M7. Push Notifications Hardcoded Russian
**Files**: `ManagerView.swift:204,287-294`, `PeopleView.swift:413`, `app/manager/page.tsx:192,282`
**Impact**: All push notification titles and bodies are in Russian.

### M8. Staff Token TTL 30 Days with No Revocation
**File**: `lib/staffToken.ts:11`
**Impact**: Compromised device tokens are valid for 30 days with no way to invalidate.

### M9. No Request Timeout in lib/db.ts
**File**: `lib/db.ts:78-83`
**Impact**: Hanging API calls block indefinitely in the browser.

### M10. Stripe Price IDs Hardcoded
**File**: `app/api/stripe/checkout/route.ts:5-9`
**Impact**: Reveals Stripe product structure. Should be env vars.

### M11. `select('*')` in PIN Check May Leak Future Columns
**File**: `app/api/auth/pin/check/route.ts:85-89`
**Impact**: If sensitive columns are added to `staff` table, they'd be returned.

### M12. Error Messages Leak Internal Details
**Files**: Stripe webhook, checkout, cancel, portal routes
**Impact**: Stripe/Supabase error messages returned directly to clients.

### M13. Admin Panel Hardcoded Russian
**File**: `app/admin/page.tsx:180,200,325,378`

### M14. Native StashView Default Categories Russian
**File**: `native/Mise/Views/StashView.swift:4`
**Impact**: `DEFAULT_FREE_CATS = ["Сотрудники", "Владелец", "Менеджер", "Гость", "Дегустация"]`

---

## LOW Issues (Backlog)

| # | Finding | File |
|---|---------|------|
| L1 | `mise_token_until` cookie not `httpOnly` | `pin/check/route.ts:13` |
| L2 | `X-Frame-Options: SAMEORIGIN` instead of `DENY` | `next.config.ts:18` |
| L3 | Cron endpoint: CRON_SECRET leak = abuse | `cron/reminders/route.ts:173` |
| L4 | No input validation in gateway | `route.ts:144-147` |
| L5 | No `useReducer` or state management library | Architecture-wide |
| L6 | No `React.lazy()` or code splitting | Architecture-wide |
| L7 | No SWR/React Query for data caching | Architecture-wide |
| L8 | `@types/bcryptjs` in dependencies (should be devDeps) | `package.json` |
| L9 | APNs key in `dependencies` (should be devDeps) | `package.json` |
| L10 | Chart axis labels hardcoded Russian | `AnalyticsView.swift:834,1243` |
| L11 | AppModel owner name "Владелец" hardcoded | `AppModel.swift:67,150` |
| L12 | Missing env vars in `.env.example` (Stripe, PostHog, APNs) | `.env.example` |

---

## Recommended Priority Order

### Phase 1: Security (Do This Week)
1. **Revoke Apple .p8 key** and regenerate
2. **Set `MISE_TOKEN_SECRET`** in Vercel env
3. **Delete `/api/debug-oauth`**
4. **Add rate limiting** to AI, admin, telegram, log endpoints
5. **Require `deviceId`** on PIN checks
6. **Add CSP headers**

### Phase 2: Stability (Next Sprint)
1. **Add `error.tsx`** to all routes
2. **Add `loading.tsx`** to all routes
3. **Deduplicate `resolveCaller`**
4. **Add RLS** to 10+ missing tables
5. **Create `lib/format.ts`** for fmtDate/fv/fmtDay

### Phase 3: i18n (Next 2 Sprints)
1. **Localize `lib/email.ts`** (3 transactional emails)
2. **Localize push notifications** (iOS + web)
3. **Localize CSV/PDF exports** in analytics
4. **Localize admin panel**
5. **Localize default categories** in StashView

### Phase 4: Architecture (Ongoing)
1. **Split `people/page.tsx`** into sub-components
2. **Split `dashboard/page.tsx`** into sub-components
3. **Add `React.memo`/`useMemo`/`useCallback`** to hot paths
4. **Consider React 19 concurrent features** (`useTransition`)
5. **Enable `strict: true`** in tsconfig

---

## What's Working Well

- **Data layer architecture**: `/api/db` proxy with per-table authorization is solid
- **`shifts` queries**: All use `opened_at` correctly (no `created_at` bugs)
- **`inkassations`**: Correctly uses `total` column
- **`lib/` layer**: Clean, modular, well-scoped (897 lines across 15 files)
- **i18n architecture**: Both web and native have comprehensive translation systems (600+ keys each)
- **Staff token auth**: PIN-based auth with device binding is well-designed
- **Retry logic in `lib/db.ts`**: Idempotent ops retry, non-idempotent don't — correct
- **RLS is enabled**: Base protection is in place, just needs expansion
- **Capacitor hybrid model**: Clean approach for iOS deployment
- **PostHog analytics**: Properly lazy-loaded

---

*Generated by 12 parallel audit agents. Full findings in respective sections above.*
