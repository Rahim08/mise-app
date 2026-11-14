# Booking hardening plan

Goal: fix confirmed Booking/Guests/Reviews audit defects with parallel agents and re-verification.
Spec: docs/superpowers/specs/2026-11-13-booking-hardening-design.md
Constraints: reuse current dirty checkout, preserve earlier work, no commits/deploy/live SQL/messages.

- [x] Backend agent: auth, author/tenant enforcement, validation, entitlement, create idempotency,
  booking notifications and review write-error handling. Durable route/auth regression tests.
- [x] Web agent: date/profile loading/save races, error/draft states, stable guest identity/RPC,
  metrics/reviews/keyboard. Durable behavioral tests and integration with shared helper contract.
- [x] Native agent: corresponding iOS model/editor/guest identity/cache/status fixes, tests/build/UI.
- [x] Root: shared guest identity/metrics helper, additive migration+atomic guest RPCs, local SQL tests,
  integration/browser verification, scanners, independent review and final regression rerun.

Review focus: same-venue unauthorized mutations; removed staff access; broad-filter mutations;
ambiguous legacy notes never deleted/copied across guests; stable IDs survive contact changes;
create retry vs double notification; partial saves preserve fields; late async responses never
move reservations; cross-platform key/visit semantics agree; no live-source release implied.

Final verification: docs/BOOKING-FIXES-VERIFICATION-2026-11-13.md.
164 web/server tests, TypeScript and production build passed; seven actual-native-model groups
and iOS simulator build passed; offline simulator retained failed draft/Tomorrow scenarios passed.
Local PostgreSQL migration/replay/concurrency/lease checks passed. Independent review findings
resolved. Semgrep OSS six scans, zero findings/failures. Full repository lint remains failing
(898 errors/280 warnings); targeted new policy/test/helper lint passed. No deployment/live SQL.
