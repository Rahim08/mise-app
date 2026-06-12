-- =============================================================================
-- mise People — features: schedule publishing, shift swaps, attendance (geo),
-- push subscriptions + notifications journal.
-- Builds on people-v3.sql. Idempotent. RLS enabled WITHOUT open policies
-- (access via the service-role /api/db gateway, app = 'people').
-- =============================================================================

-- 0. Venue location + reminder settings on restaurant_settings
ALTER TABLE restaurant_settings ADD COLUMN IF NOT EXISTS latitude numeric;
ALTER TABLE restaurant_settings ADD COLUMN IF NOT EXISTS longitude numeric;
ALTER TABLE restaurant_settings ADD COLUMN IF NOT EXISTS geo_radius_m int NOT NULL DEFAULT 150;
ALTER TABLE restaurant_settings ADD COLUMN IF NOT EXISTS attendance_enabled boolean NOT NULL DEFAULT false;
-- reminder: either a fixed local time the day before, or N hours before shift start
ALTER TABLE restaurant_settings ADD COLUMN IF NOT EXISTS reminder_mode text NOT NULL DEFAULT 'hours_before'
  CHECK (reminder_mode IN ('hours_before', 'fixed_time'));
ALTER TABLE restaurant_settings ADD COLUMN IF NOT EXISTS reminder_hours int NOT NULL DEFAULT 12;
ALTER TABLE restaurant_settings ADD COLUMN IF NOT EXISTS reminder_time time NOT NULL DEFAULT '18:00';

-- 1. staff_schedules: published flag (manager drafts, then publishes to staff)
ALTER TABLE staff_schedules ADD COLUMN IF NOT EXISTS published boolean NOT NULL DEFAULT false;

-- 2. Shift swaps (peer accepts → manager approves → schedule reassigned)
CREATE TABLE IF NOT EXISTS shift_swap_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  schedule_id uuid NOT NULL REFERENCES staff_schedules(id) ON DELETE CASCADE,
  requester_id uuid NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  target_id uuid REFERENCES staff(id) ON DELETE SET NULL,         -- null = open swap
  status text NOT NULL DEFAULT 'pending_peer'
    CHECK (status IN ('pending_peer', 'peer_accepted', 'peer_declined', 'approved', 'rejected', 'cancelled')),
  peer_responded_at timestamptz,
  manager_id uuid REFERENCES staff(id) ON DELETE SET NULL,
  manager_responded_at timestamptz,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_swaps_rest_status ON shift_swap_requests (restaurant_id, status);
CREATE INDEX IF NOT EXISTS idx_swaps_target ON shift_swap_requests (target_id);
DROP TRIGGER IF EXISTS trg_swaps_updated ON shift_swap_requests;
CREATE TRIGGER trg_swaps_updated BEFORE UPDATE ON shift_swap_requests
  FOR EACH ROW EXECUTE FUNCTION mise_set_updated_at();

-- 3. Attendance (auto check-in/out by geolocation, with manual fallback)
CREATE TABLE IF NOT EXISTS attendance_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  staff_id uuid NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  schedule_id uuid REFERENCES staff_schedules(id) ON DELETE SET NULL,
  date date NOT NULL,
  check_in_at timestamptz, check_in_lat numeric, check_in_lng numeric, check_in_distance_m int,
  check_out_at timestamptz, check_out_lat numeric, check_out_lng numeric,
  late_minutes int,                                              -- vs scheduled start
  status text NOT NULL DEFAULT 'present'
    CHECK (status IN ('present', 'late', 'left_early', 'absent')),
  source text NOT NULL DEFAULT 'geo' CHECK (source IN ('geo', 'manual')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (restaurant_id, staff_id, date)
);
CREATE INDEX IF NOT EXISTS idx_attendance_rest_date ON attendance_records (restaurant_id, date);
CREATE INDEX IF NOT EXISTS idx_attendance_staff ON attendance_records (staff_id, date);

-- 4. Push subscriptions (native APNs token later; web push fields kept for flexibility)
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  staff_id uuid NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  platform text NOT NULL CHECK (platform IN ('web', 'ios', 'android')),
  endpoint text,                 -- web push
  keys jsonb,                    -- {p256dh, auth} for web push
  device_token text,             -- native push token
  last_seen timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_push_web ON push_subscriptions (staff_id, endpoint) WHERE endpoint IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_push_native ON push_subscriptions (staff_id, device_token) WHERE device_token IS NOT NULL;

-- 5. Notifications journal (powers the in-app "Уведомления" list; delivery added later)
CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  staff_id uuid NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('shift_reminder', 'swap_request', 'swap_result', 'attendance', 'task', 'general')),
  title text NOT NULL,
  body text,
  data jsonb,
  sent_at timestamptz,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notif_staff_unread ON notifications (staff_id, read_at);

-- 6. Safe staff directory (no pin_hash). security_invoker = respects RLS of the caller,
--    so anon can't read it directly; the service-role gateway can.
CREATE OR REPLACE VIEW staff_directory WITH (security_invoker = true) AS
  SELECT id, restaurant_id, name, role, apps, (device_id IS NOT NULL) AS device_bound, is_active
  FROM staff;

-- 7. RLS on (no open policies — gateway only)
ALTER TABLE shift_swap_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_records  ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_subscriptions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications       ENABLE ROW LEVEL SECURITY;
