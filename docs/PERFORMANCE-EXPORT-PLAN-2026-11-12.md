# Faster loading and restricted exports

## Acceptance criteria
- Vercel functions target Dublin (`dub1`), alongside the existing Ireland database. Production routing must be checked after an explicitly authorized deployment.
- Manager, turnover and inkassation load independently of unrelated modules wherever dependencies permit; refreshes do not replace newer data with older responses.
- Shared web reads merge identical concurrent requests only. Results are not retained; writes and RPCs are never merged. A mutation separates reads before/after it.
- Export controls and actions are available only to the owner and manager/admin (existing official-role convention). Missing/unknown roles fail closed. Existing module/data permissions remain in force.
- No financial write retries/caching are introduced. No authorization checks are removed, no cross-user server caches added.

## Implementation
1. Inspect startup and report paths; add regression tests for concurrent reads, mutation boundaries and export permissions.
2. Fix independent native/web loading waterfalls and publish primary figures as soon as their prerequisites resolve.
3. Add in-flight read sharing in the common web DB client; retain network/error semantics.
4. Apply export guards at navigation, controls and action entry points; enforce any server export path.
5. Check tests, TypeScript, lint, production build, offline scanners, browser flows and native build/simulator where available.

## Release boundary
Existing working tree contains unrelated pending changes. Do not publish it wholesale without a concrete deployment review. Changes here do not claim any production migration has happened.

## Verification (2026-11-12)
- `npm test`: 58 tests in 9 files passed, including role matrix, current identity, read sharing/session/mutation boundaries, period ordering, empty month, stale period response, and Manager catalog navigation regression.
- `npx tsc --noEmit`: passed. Production `npm run build`: passed.
- New test/helper/config files: ESLint passed. Repository-wide lint remains failing on existing legacy rules/errors; it is not a release-green check.
- Browser: local production build, controlled API fixtures, 390×844 and 1440×960. Revenue 150 and collection 4567 visible while payroll held unresolved. Export unavailable during loading; manager downloads CSV afterward; waiter has no CSV/PDF controls. Owner controls verified. No page exceptions/overflow. No live financial writes.
- Native: Debug simulator build passed; `python3 native/Mise/tools/test-loading.py` passed both actual-loader harnesses (independent hub money/role hiding; turnover/collection not blocked by payroll/history).
- Semgrep OSS local scan: six rulesets (security-audit, secrets, javascript, typescript, react, Trail of Bits), 18 application files, zero findings, zero failed/skipped scans, metrics disabled. Pro unavailable (not installed/authenticated). CodeQL not run: private project, no verified GHAS license; default bundled license restricts private-source analysis.
- Production route measured before changes: `/api/db` x-vercel-id `fra1::iad1`, unauthenticated 401 responses in ~350–440 ms. No authorized production data benchmark was run. `vercel inspect` found no credentials; its automatic login was cancelled. No deployment, account connection, or App Store/TestFlight submission performed.
- Native role UI could not be verified: the DEBUG demo returned to PIN despite receiving role flags. Final simulator build/install succeeded, but no claim is made about rendered role controls. Screenshot: `/tmp/mise-native-pin-limitation.png`. Web role flows were verified with controlled fixtures.
