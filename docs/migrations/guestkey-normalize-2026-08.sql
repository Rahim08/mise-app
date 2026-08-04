-- guestKey() (app/dashboard/(shell)/bookings/page.tsx, BookingsView.swift) changed from
-- "all digits of phone" to "last 9 digits of phone" — one guest entered once as "079…"
-- (local format) and once as "+4179…" (international) produced two different keys and
-- their history/notes split across two profiles (audit 2026-08-04).
--
-- guest_notes.guest_key persists the OLD (full-digit) format for restaurants that already
-- saved a note before this change. Run this BEFORE deploying the app change so existing
-- notes keep matching; otherwise they silently stop matching (guest_notes row becomes
-- orphaned — not deleted, just invisible until re-saved under the new key).
--
-- Collision handling: normalizing can collapse two different old keys onto the same new
-- key (e.g. "0791234567" and "41791234567" both -> "791234567"). guest_notes has a
-- UNIQUE(restaurant_id, guest_key) constraint, so duplicates must be resolved — keeps the
-- most recently updated row per (restaurant_id, new_key), drops the rest.

begin;

with normalized as (
  select id, restaurant_id, updated_at,
         case when guest_key ~ '^[0-9]+$' and length(guest_key) > 9
              then right(guest_key, 9)
              else guest_key
         end as new_key
  from guest_notes
),
ranked as (
  select id, new_key,
         row_number() over (partition by restaurant_id, new_key order by updated_at desc nulls last) as rn
  from normalized
)
delete from guest_notes where id in (select id from ranked where rn > 1);

update guest_notes
set guest_key = case when guest_key ~ '^[0-9]+$' and length(guest_key) > 9
                     then right(guest_key, 9)
                     else guest_key
                end
where guest_key ~ '^[0-9]+$' and length(guest_key) > 9;

commit;
