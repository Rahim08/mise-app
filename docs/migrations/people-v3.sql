-- =============================================================================
-- mise People v3 — production-safe migration
-- Replaces "people migration v2.sql". Differences:
--   • role: TEXT + CHECK instead of enum (extensible, no ALTER TYPE), non-destructive
--   • added updated_at / completed_at / resolved_at timestamps + trigger
--   • added indexes for restaurant/status/date lookups
--   • checklist completions can link to a real Manager shift
--   • RLS enabled WITHOUT open policies — access goes through /api/db (service_role bypasses)
-- Idempotent: safe to re-run.
-- =============================================================================

-- updated_at helper
CREATE OR REPLACE FUNCTION mise_set_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

-- 1. staff.role — flexible TEXT, preserve any existing data (no destructive DROP)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'staff' AND column_name = 'role') THEN
    ALTER TABLE staff ALTER COLUMN role DROP DEFAULT;
    ALTER TABLE staff ALTER COLUMN role TYPE TEXT USING role::text;
    UPDATE staff SET role = 'waiter' WHERE role IS NULL;
    ALTER TABLE staff ALTER COLUMN role SET DEFAULT 'waiter';
    ALTER TABLE staff ALTER COLUMN role SET NOT NULL;
  ELSE
    ALTER TABLE staff ADD COLUMN role TEXT NOT NULL DEFAULT 'waiter';
  END IF;
END $$;

ALTER TABLE staff DROP CONSTRAINT IF EXISTS staff_role_check;
ALTER TABLE staff ADD CONSTRAINT staff_role_check
  CHECK (role IN ('kitchen', 'bar', 'hookah', 'waiter', 'manager', 'host', 'cleaner', 'admin'));

-- 2. Tasks
CREATE TABLE IF NOT EXISTS staff_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  assigned_to UUID REFERENCES staff(id) ON DELETE SET NULL,
  created_by UUID REFERENCES staff(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'in_progress', 'done')),
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
  due_date DATE,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tasks_rest_status ON staff_tasks (restaurant_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_assigned ON staff_tasks (assigned_to);
CREATE INDEX IF NOT EXISTS idx_tasks_due ON staff_tasks (restaurant_id, due_date);
DROP TRIGGER IF EXISTS trg_tasks_updated ON staff_tasks;
CREATE TRIGGER trg_tasks_updated BEFORE UPDATE ON staff_tasks
  FOR EACH ROW EXECUTE FUNCTION mise_set_updated_at();

-- 3. Reports (breakdowns, notices, suggestions)
CREATE TABLE IF NOT EXISTS staff_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  author_id UUID REFERENCES staff(id) ON DELETE SET NULL,
  type TEXT NOT NULL DEFAULT 'other' CHECK (type IN ('breakdown', 'notice', 'suggestion', 'other')),
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'reviewed', 'resolved')),
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_reports_rest_status ON staff_reports (restaurant_id, status);
DROP TRIGGER IF EXISTS trg_reports_updated ON staff_reports;
CREATE TRIGGER trg_reports_updated BEFORE UPDATE ON staff_reports
  FOR EACH ROW EXECUTE FUNCTION mise_set_updated_at();

-- 4. Schedules
CREATE TABLE IF NOT EXISTS staff_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  staff_id UUID NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  shift_start TIME,
  shift_end TIME,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (restaurant_id, staff_id, date)
);
CREATE INDEX IF NOT EXISTS idx_schedules_rest_date ON staff_schedules (restaurant_id, date);

-- 5. Tech cards (технологички / чек-листы кухни и бара)
CREATE TABLE IF NOT EXISTS tech_cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'dish' CHECK (category IN ('dish', 'prep', 'stoplist')),
  target_roles TEXT[] NOT NULL DEFAULT '{kitchen}',
  items JSONB NOT NULL DEFAULT '[]',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_techcards_rest_active ON tech_cards (restaurant_id, is_active);

CREATE TABLE IF NOT EXISTS tech_card_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  card_id UUID NOT NULL REFERENCES tech_cards(id) ON DELETE CASCADE,
  staff_id UUID REFERENCES staff(id) ON DELETE SET NULL,
  items_state JSONB NOT NULL DEFAULT '[]',
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_techsessions_rest_card ON tech_card_sessions (restaurant_id, card_id);

-- 6. Shift checklists (открытие/закрытие зала)
CREATE TABLE IF NOT EXISTS shift_checklists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('open', 'close')),
  items JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_checklists_rest_type ON shift_checklists (restaurant_id, type);

CREATE TABLE IF NOT EXISTS shift_checklist_completions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  checklist_id UUID NOT NULL REFERENCES shift_checklists(id) ON DELETE CASCADE,
  shift_id UUID REFERENCES shifts(id) ON DELETE SET NULL,  -- ties checklist to a real Manager shift
  staff_id UUID REFERENCES staff(id) ON DELETE SET NULL,
  date DATE NOT NULL,
  items_state JSONB NOT NULL DEFAULT '[]',
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_checklist_compl_rest_date ON shift_checklist_completions (restaurant_id, date);

-- 7. RLS — enable, NO open policies. Access is via the service-role /api/db gateway.
--    (Matches docs/security/rls.sql. service_role has BYPASSRLS.)
ALTER TABLE staff_tasks                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_reports               ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_schedules             ENABLE ROW LEVEL SECURITY;
ALTER TABLE tech_cards                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE tech_card_sessions          ENABLE ROW LEVEL SECURITY;
ALTER TABLE shift_checklists            ENABLE ROW LEVEL SECURITY;
ALTER TABLE shift_checklist_completions ENABLE ROW LEVEL SECURITY;

-- Drop the permissive dev policies if v2 created them.
DROP POLICY IF EXISTS open_dev_tasks ON staff_tasks;
DROP POLICY IF EXISTS open_dev_reports ON staff_reports;
DROP POLICY IF EXISTS open_dev_schedules ON staff_schedules;
DROP POLICY IF EXISTS open_dev_techcards ON tech_cards;
DROP POLICY IF EXISTS open_dev_techsessions ON tech_card_sessions;
DROP POLICY IF EXISTS open_dev_checklists ON shift_checklists;
DROP POLICY IF EXISTS open_dev_checklist_completions ON shift_checklist_completions;
