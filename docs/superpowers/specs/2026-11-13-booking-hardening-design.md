# Booking audit fixes

User explicitly requested parallel implementers followed by re-verification. Fix confirmed audit
findings in Booking/Guests/Reviews only. Keep prior custom-expense/performance work intact.
No publication, live database mutation, real notifications or account connections. No commits.

Server: enforce same-tenant author-or-official mutations; stamp author server-side and freeze it
on update. Resolve staff permissions from current active row, not old token apps. Validate booking
date, HH:mm, positive integer guest counts, statuses and bounded text. Enforce Booking entitlement.
Create retry uses a stable client UUID, same-payload retries cannot create another booking.
Notifications must reference an owned persisted booking and be rate-limited/deduplicated.
Review sync reports write failures; latest snapshot queries use latest90 then chronological UI.

Guest identity contract: add `bookings.guest_key` stable opaque `g:<uuid>` metadata,
backfill by full phone digits within a restaurant; phoneless rows get separate keys. Never use
last9 digits to establish identity. Explicit guest selection passes its key into a new booking.
Phone/name editing retains the key. Existing guest_notes legacy rows are retained; only aliases
mapping unambiguously to ONE stable guest group are copied to canonical key, without overwriting
canonical data. No speculative merge of local vs international phone formats or identical names.
Clients use booking.guest_key; fallback full phone key or per-booking ID for pre-migration fixtures.

Guest edits/deletes use tenant-scoped atomic RPCs booking_guest_update and booking_guest_delete.
Update arguments: p_guest_key, optional p_name/p_phone (null=unchanged, empty=clear), optional
p_profile JSON patch (note,last_name,email,birthday only); preserve omitted fields. Conflicting
phone assignment to another guest is rejected. Delete removes this guest's bookings+notes in one
transaction. Gateway authorizes official or ALL source bookings authored by the caller.

Web/iOS: request generation guards for dates/ranges/month/profile; preserve drafts and stay in
editor on failed save; do not overwrite edits to another guest. Stale/empty/error states honest,
retry explicit and forced refresh bypasses native cache. Stable create ID retained after failure.
Atomic guest editor loads correct full prefill, distinguishes failed read from empty profile.
Status updates cannot roll back a newer successful action. Tomorrow creates for tomorrow.
Future bookings never count as visits. For historical compatibility, past non-cancelled bookings
remain visits; today counts arrivals only. Latest visit ignores cancellations and future bookings.
Keyboard users can select guest rows in web. Optional search/rescheduling/capacity warning
features are separate product proposals, not required in this bug-fix pass.

Independent review refinements: ordinary booking updates use internal `booking_rows_update`
with pinned tenant-scoped IDs, transactional author rechecks, and phone-before-guest locks.
An existing guest key cannot be assigned a phone belonging to a different guest; bulk edits
cannot give one phone to distinct guests. Booking notification claims are expiring token leases.
Recipient journal IDs are deterministic per tenant/event/recipient; retry cannot duplicate the
journal or resend push for an existing journal row. APNs remains best effort after durable journal
persistence. No promise of exactly-once external push delivery or automatic background retries.

Verification: reproduce audit regressions in durable tests first; auth/tenant/input/idempotency,
read/save failures, concurrency ordering, stable identity, migration data retention/ambiguity,
atomic guest operations. Then browser desktop/mobile, native actual-model tests/build/simulator,
local SQL tests and offline security checks; independent review of complete changes.
