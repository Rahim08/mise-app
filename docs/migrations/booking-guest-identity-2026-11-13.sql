-- Additive Booking hardening. Apply before new clients; no legacy booking/note is deleted.
BEGIN;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS guest_key text;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS notification_claimed_at timestamptz;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS notification_claim_token uuid;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS notification_dispatched_at timestamptz;
ALTER TABLE public.guest_notes ADD COLUMN IF NOT EXISTS canonical_guest_key text;
ALTER TABLE public.guest_notes ADD COLUMN IF NOT EXISTS identity_migration_checked boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.booking_phone_digits(p_phone text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = '' AS $$
  SELECT regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
$$;

-- Full international numbers stay distinct. Phoneless reservations are not merged by name.
WITH identities AS MATERIALIZED (
  SELECT restaurant_id, phone, 'g:' || gen_random_uuid()::text AS guest_key FROM (
    SELECT DISTINCT restaurant_id, public.booking_phone_digits(phone) AS phone
    FROM public.bookings WHERE guest_key IS NULL AND public.booking_phone_digits(phone) <> ''
  ) phones
)
UPDATE public.bookings b SET guest_key = i.guest_key FROM identities i
WHERE b.guest_key IS NULL AND b.restaurant_id = i.restaurant_id AND public.booking_phone_digits(b.phone) = i.phone;
UPDATE public.bookings SET guest_key = 'g:' || gen_random_uuid()::text WHERE guest_key IS NULL;
ALTER TABLE public.bookings ALTER COLUMN guest_key SET NOT NULL;
CREATE INDEX IF NOT EXISTS bookings_rest_guest_key ON public.bookings (restaurant_id, guest_key);
CREATE INDEX IF NOT EXISTS bookings_rest_history_page ON public.bookings (restaurant_id, booking_date DESC, id DESC);
CREATE INDEX IF NOT EXISTS bookings_rest_full_phone ON public.bookings (restaurant_id, public.booking_phone_digits(phone));

-- Copy only unambiguous legacy aliases; retain ALL originals for safe review/recovery.
WITH aliases AS (
  SELECT DISTINCT restaurant_id, guest_key, public.booking_phone_digits(phone) AS alias
  FROM public.bookings WHERE public.booking_phone_digits(phone) <> ''
  UNION
  SELECT DISTINCT restaurant_id, guest_key, right(public.booking_phone_digits(phone), 9)
  FROM public.bookings WHERE length(public.booking_phone_digits(phone)) >= 9
  UNION
  SELECT DISTINCT restaurant_id, guest_key, lower(btrim(regexp_replace(guest_name, '\s+', ' ', 'g')))
  FROM public.bookings WHERE nullif(btrim(guest_name), '') IS NOT NULL
), unambiguous AS (
  SELECT restaurant_id, alias, min(guest_key) AS guest_key FROM aliases
  GROUP BY restaurant_id, alias HAVING count(DISTINCT guest_key) = 1
)
UPDATE public.guest_notes n SET canonical_guest_key = a.guest_key
FROM unambiguous a WHERE a.restaurant_id = n.restaurant_id AND a.alias = n.guest_key
  AND NOT n.identity_migration_checked AND n.guest_key NOT LIKE 'g:%';
WITH sources AS (
  SELECT DISTINCT ON (n.restaurant_id, n.canonical_guest_key) n.restaurant_id, n.canonical_guest_key AS guest_key,
    n.note, n.last_name, n.email, n.birthday, n.updated_at
  FROM public.guest_notes n WHERE n.canonical_guest_key IS NOT NULL
  ORDER BY n.restaurant_id, n.canonical_guest_key, n.updated_at DESC, n.id
)
INSERT INTO public.guest_notes (restaurant_id, guest_key, note, last_name, email, birthday, updated_at)
SELECT restaurant_id, guest_key, note, last_name, email, birthday, updated_at FROM sources
ON CONFLICT (restaurant_id, guest_key) DO NOTHING;
-- Ambiguous aliases remain untouched and must not be reinterpreted after later deletions.
UPDATE public.guest_notes SET identity_migration_checked = true
WHERE NOT identity_migration_checked AND guest_key NOT LIKE 'g:%';

CREATE OR REPLACE FUNCTION public.assign_booking_guest_key() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE digits text; candidate text; candidate_count integer;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.guest_key IS DISTINCT FROM NEW.guest_key OR OLD.restaurant_id IS DISTINCT FROM NEW.restaurant_id THEN
      RAISE EXCEPTION 'Booking identity is immutable' USING ERRCODE = '23514';
    END IF;
    IF NEW.phone IS DISTINCT FROM OLD.phone AND public.booking_phone_digits(NEW.phone) <> '' AND EXISTS (
      SELECT 1 FROM public.bookings b WHERE b.restaurant_id = NEW.restaurant_id AND b.guest_key <> NEW.guest_key
      AND public.booking_phone_digits(b.phone) = public.booking_phone_digits(NEW.phone)
    ) THEN RAISE EXCEPTION 'Phone belongs to another guest' USING ERRCODE = '23505'; END IF;
    RETURN NEW;
  END IF;
  digits := public.booking_phone_digits(NEW.phone);
  IF digits <> '' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(NEW.restaurant_id::text || ':phone:' || digits, 0));
  END IF;
  IF NEW.guest_key IS NOT NULL THEN
    NEW.guest_key := lower(btrim(NEW.guest_key));
    PERFORM pg_advisory_xact_lock(hashtextextended(NEW.restaurant_id::text || ':' || NEW.guest_key, 0));
    IF NOT EXISTS (SELECT 1 FROM public.bookings b WHERE b.restaurant_id = NEW.restaurant_id AND b.guest_key = NEW.guest_key) THEN
      RAISE EXCEPTION 'Unknown guest in this restaurant' USING ERRCODE = '23503';
    END IF;
    IF digits <> '' AND EXISTS (SELECT 1 FROM public.bookings b WHERE b.restaurant_id = NEW.restaurant_id
      AND b.guest_key <> NEW.guest_key AND public.booking_phone_digits(b.phone) = digits) THEN
      RAISE EXCEPTION 'Phone belongs to another guest' USING ERRCODE = '23505';
    END IF;
  ELSE
    IF digits <> '' THEN
      -- Serialise first creation of the same full phone, avoiding duplicate identities.
      SELECT count(DISTINCT b.guest_key), min(b.guest_key) INTO candidate_count, candidate
      FROM public.bookings b WHERE b.restaurant_id = NEW.restaurant_id AND public.booking_phone_digits(b.phone) = digits;
      IF candidate_count > 1 THEN RAISE EXCEPTION 'Ambiguous guest phone' USING ERRCODE = '23505'; END IF;
    END IF;
    IF candidate IS NOT NULL THEN
      PERFORM pg_advisory_xact_lock(hashtextextended(NEW.restaurant_id::text || ':' || candidate, 0));
      IF NOT EXISTS (SELECT 1 FROM public.bookings b WHERE b.restaurant_id = NEW.restaurant_id AND b.guest_key = candidate
        AND public.booking_phone_digits(b.phone) = digits) THEN candidate := NULL; END IF;
    END IF;
    NEW.guest_key := coalesce(candidate, 'g:' || gen_random_uuid()::text);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS assign_booking_guest_key ON public.bookings;
CREATE TRIGGER assign_booking_guest_key BEFORE INSERT OR UPDATE ON public.bookings
FOR EACH ROW EXECUTE FUNCTION public.assign_booking_guest_key();
REVOKE ALL ON FUNCTION public.assign_booking_guest_key() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.booking_guest_update(
  p_restaurant_id uuid, p_guest_key text, p_name text DEFAULT NULL, p_phone text DEFAULT NULL,
  p_profile jsonb DEFAULT '{}'::jsonb, p_actor_id text DEFAULT NULL, p_official boolean DEFAULT false
) RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE digits text;
BEGIN
  -- Match INSERT's phone-before-guest lock order, including concurrent contact edits.
  digits := public.booking_phone_digits(p_phone);
  IF p_phone IS NOT NULL AND digits <> '' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(p_restaurant_id::text || ':phone:' || digits, 0));
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_restaurant_id::text || ':' || p_guest_key, 0));
  PERFORM 1 FROM public.bookings b WHERE b.restaurant_id = p_restaurant_id AND b.guest_key = p_guest_key ORDER BY b.id FOR UPDATE;
  IF NOT EXISTS (SELECT 1 FROM public.bookings b WHERE b.restaurant_id = p_restaurant_id AND b.guest_key = p_guest_key) THEN
    RAISE EXCEPTION 'Guest not found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT p_official AND (p_actor_id IS NULL OR EXISTS (
    SELECT 1 FROM public.bookings b WHERE b.restaurant_id = p_restaurant_id AND b.guest_key = p_guest_key AND b.created_by IS DISTINCT FROM p_actor_id
  )) THEN RAISE EXCEPTION 'Guest permission denied' USING ERRCODE = '42501'; END IF;
  IF jsonb_typeof(p_profile) IS DISTINCT FROM 'object' OR EXISTS (
    SELECT 1 FROM jsonb_object_keys(p_profile) k WHERE k NOT IN ('note','last_name','email','birthday')
  ) OR length(coalesce(p_name,'')) > 200 OR length(coalesce(p_phone,'')) > 80
    OR length(coalesce(p_profile->>'note','')) > 4000 OR length(coalesce(p_profile->>'last_name','')) > 200
    OR length(coalesce(p_profile->>'email','')) > 320 THEN
    RAISE EXCEPTION 'Invalid guest fields' USING ERRCODE = '22023';
  END IF;
  IF p_phone IS NOT NULL THEN
    digits := public.booking_phone_digits(p_phone);
    IF digits <> '' AND EXISTS (SELECT 1 FROM public.bookings b WHERE b.restaurant_id = p_restaurant_id
      AND b.guest_key <> p_guest_key AND public.booking_phone_digits(b.phone) = digits) THEN
      RAISE EXCEPTION 'Phone belongs to another guest' USING ERRCODE = '23505';
    END IF;
  END IF;
  UPDATE public.bookings b SET guest_name = CASE WHEN p_name IS NULL THEN b.guest_name ELSE nullif(btrim(p_name),'') END,
    phone = CASE WHEN p_phone IS NULL THEN b.phone ELSE nullif(btrim(p_phone),'') END, updated_at = now()
  WHERE b.restaurant_id = p_restaurant_id AND b.guest_key = p_guest_key;
  INSERT INTO public.guest_notes (restaurant_id, guest_key, note, last_name, email, birthday, updated_at)
  VALUES (p_restaurant_id, p_guest_key, coalesce(p_profile->>'note',''), nullif(p_profile->>'last_name',''),
    nullif(p_profile->>'email',''), nullif(p_profile->>'birthday','')::date, now())
  ON CONFLICT (restaurant_id, guest_key) DO UPDATE SET
    note = CASE WHEN p_profile ? 'note' THEN coalesce(p_profile->>'note','') ELSE guest_notes.note END,
    last_name = CASE WHEN p_profile ? 'last_name' THEN nullif(p_profile->>'last_name','') ELSE guest_notes.last_name END,
    email = CASE WHEN p_profile ? 'email' THEN nullif(p_profile->>'email','') ELSE guest_notes.email END,
    birthday = CASE WHEN p_profile ? 'birthday' THEN nullif(p_profile->>'birthday','')::date ELSE guest_notes.birthday END,
    updated_at = now();
END $$;
REVOKE ALL ON FUNCTION public.booking_guest_update(uuid,text,text,text,jsonb,text,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.booking_guest_update(uuid,text,text,text,jsonb,text,boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.booking_guest_delete(
  p_restaurant_id uuid, p_guest_key text, p_actor_id text DEFAULT NULL, p_official boolean DEFAULT false
) RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_restaurant_id::text || ':' || p_guest_key, 0));
  PERFORM 1 FROM public.bookings b WHERE b.restaurant_id = p_restaurant_id AND b.guest_key = p_guest_key ORDER BY b.id FOR UPDATE;
  IF NOT EXISTS (SELECT 1 FROM public.bookings b WHERE b.restaurant_id = p_restaurant_id AND b.guest_key = p_guest_key) THEN
    RAISE EXCEPTION 'Guest not found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT p_official AND (p_actor_id IS NULL OR EXISTS (
    SELECT 1 FROM public.bookings b WHERE b.restaurant_id = p_restaurant_id AND b.guest_key = p_guest_key AND b.created_by IS DISTINCT FROM p_actor_id
  )) THEN RAISE EXCEPTION 'Guest permission denied' USING ERRCODE = '42501'; END IF;
  DELETE FROM public.bookings WHERE restaurant_id = p_restaurant_id AND guest_key = p_guest_key;
  DELETE FROM public.guest_notes WHERE restaurant_id = p_restaurant_id AND (guest_key = p_guest_key OR canonical_guest_key = p_guest_key);
END $$;
REVOKE ALL ON FUNCTION public.booking_guest_delete(uuid,text,text,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.booking_guest_delete(uuid,text,text,boolean) TO service_role;

-- Internal gateway operation: validated, pinned IDs with transactional identity/author rechecks.
CREATE OR REPLACE FUNCTION public.booking_rows_update(
  p_restaurant_id uuid, p_ids uuid[], p_values jsonb, p_actor_id text DEFAULT NULL, p_official boolean DEFAULT false
) RETURNS SETOF public.bookings LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE digits text; k text; amount integer;
BEGIN
  IF coalesce(cardinality(p_ids),0) NOT BETWEEN 1 AND 100 OR jsonb_typeof(p_values) IS DISTINCT FROM 'object'
    OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_values) key WHERE key NOT IN
      ('booking_date','booking_time','guest_name','guests_count','phone','table_label','note','status','updated_at')) THEN
    RAISE EXCEPTION 'Invalid booking update' USING ERRCODE = '22023';
  END IF;
  digits := public.booking_phone_digits(p_values->>'phone');
  IF p_values ? 'phone' AND digits <> '' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(p_restaurant_id::text || ':phone:' || digits, 0));
  END IF;
  FOR k IN SELECT DISTINCT b.guest_key FROM public.bookings b WHERE b.restaurant_id = p_restaurant_id AND b.id = ANY(p_ids) ORDER BY b.guest_key LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(p_restaurant_id::text || ':' || k, 0));
  END LOOP;
  PERFORM 1 FROM public.bookings b WHERE b.restaurant_id = p_restaurant_id AND b.id = ANY(p_ids) ORDER BY b.id FOR UPDATE;
  SELECT count(*) INTO amount FROM public.bookings b WHERE b.restaurant_id = p_restaurant_id AND b.id = ANY(p_ids);
  IF amount <> cardinality(p_ids) THEN RAISE EXCEPTION 'Booking changed; reload and retry' USING ERRCODE = 'P0002'; END IF;
  IF NOT p_official AND (p_actor_id IS NULL OR EXISTS (SELECT 1 FROM public.bookings b
    WHERE b.restaurant_id = p_restaurant_id AND b.id = ANY(p_ids) AND b.created_by IS DISTINCT FROM p_actor_id)) THEN
    RAISE EXCEPTION 'Booking permission denied' USING ERRCODE = '42501';
  END IF;
  IF p_values ? 'phone' AND digits <> '' AND EXISTS (
    SELECT 1 FROM public.bookings source JOIN public.bookings other ON other.restaurant_id = source.restaurant_id
      AND other.guest_key <> source.guest_key AND public.booking_phone_digits(other.phone) = digits
    WHERE source.restaurant_id = p_restaurant_id AND source.id = ANY(p_ids)
  ) THEN RAISE EXCEPTION 'Phone belongs to another guest' USING ERRCODE = '23505'; END IF;
  IF p_values ? 'phone' AND digits <> '' AND (SELECT count(DISTINCT b.guest_key) FROM public.bookings b
    WHERE b.restaurant_id = p_restaurant_id AND b.id = ANY(p_ids)) > 1 THEN
    RAISE EXCEPTION 'Phone cannot be assigned to multiple guests' USING ERRCODE = '23505';
  END IF;
  RETURN QUERY UPDATE public.bookings b SET
    booking_date = CASE WHEN p_values ? 'booking_date' THEN (p_values->>'booking_date')::date ELSE b.booking_date END,
    booking_time = CASE WHEN p_values ? 'booking_time' THEN p_values->>'booking_time' ELSE b.booking_time END,
    guest_name = CASE WHEN p_values ? 'guest_name' THEN p_values->>'guest_name' ELSE b.guest_name END,
    guests_count = CASE WHEN p_values ? 'guests_count' THEN (p_values->>'guests_count')::integer ELSE b.guests_count END,
    phone = CASE WHEN p_values ? 'phone' THEN p_values->>'phone' ELSE b.phone END,
    table_label = CASE WHEN p_values ? 'table_label' THEN p_values->>'table_label' ELSE b.table_label END,
    note = CASE WHEN p_values ? 'note' THEN p_values->>'note' ELSE b.note END,
    status = CASE WHEN p_values ? 'status' THEN p_values->>'status' ELSE b.status END,
    updated_at = now()
  WHERE b.restaurant_id = p_restaurant_id AND b.id = ANY(p_ids) RETURNING b.*;
END $$;
REVOKE ALL ON FUNCTION public.booking_rows_update(uuid,uuid[],jsonb,text,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.booking_rows_update(uuid,uuid[],jsonb,text,boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.booking_history_page(
  p_restaurant_id uuid, p_after_date date DEFAULT NULL, p_after_id uuid DEFAULT NULL, p_limit integer DEFAULT 500
) RETURNS SETOF public.bookings LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT b.* FROM public.bookings b WHERE b.restaurant_id = p_restaurant_id
    AND (p_after_date IS NULL OR (b.booking_date, b.id) < (p_after_date, p_after_id))
  ORDER BY b.booking_date DESC, b.id DESC LIMIT greatest(1, least(coalesce(p_limit,500),500));
$$;
REVOKE ALL ON FUNCTION public.booking_history_page(uuid,date,uuid,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.booking_history_page(uuid,date,uuid,integer) TO service_role;

DROP FUNCTION IF EXISTS public.booking_notification_claim(uuid,uuid);
CREATE OR REPLACE FUNCTION public.booking_notification_claim(p_restaurant_id uuid, p_booking_id uuid, p_claim_token uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE claimed uuid;
BEGIN
  IF p_claim_token IS NULL THEN RETURN false; END IF;
  UPDATE public.bookings SET notification_claimed_at = now(), notification_claim_token = p_claim_token
  WHERE restaurant_id = p_restaurant_id AND id = p_booking_id AND notification_dispatched_at IS NULL
    AND (notification_claimed_at IS NULL OR notification_claimed_at < now() - interval '2 minutes') RETURNING id INTO claimed;
  RETURN claimed IS NOT NULL;
END $$;
REVOKE ALL ON FUNCTION public.booking_notification_claim(uuid,uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.booking_notification_claim(uuid,uuid,uuid) TO service_role;
CREATE OR REPLACE FUNCTION public.booking_notification_finish(p_restaurant_id uuid, p_booking_id uuid, p_claim_token uuid, p_success boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE finished uuid;
BEGIN
  UPDATE public.bookings SET notification_dispatched_at = CASE WHEN p_success THEN now() ELSE NULL END,
    notification_claimed_at = NULL, notification_claim_token = NULL
  WHERE restaurant_id = p_restaurant_id AND id = p_booking_id AND notification_claim_token = p_claim_token RETURNING id INTO finished;
  RETURN finished IS NOT NULL;
END $$;
REVOKE ALL ON FUNCTION public.booking_notification_finish(uuid,uuid,uuid,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.booking_notification_finish(uuid,uuid,uuid,boolean) TO service_role;
COMMIT;
