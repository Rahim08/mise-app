-- =============================================
-- mise People v2 — SQL Migration
-- =============================================

-- 1. Create role enum
DO $$ BEGIN
  CREATE TYPE staff_role AS ENUM ('kitchen', 'bar', 'hookah', 'waiter', 'manager');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 2. Add role column to staff (replace old TEXT role if exists)
ALTER TABLE staff DROP COLUMN IF EXISTS role;
ALTER TABLE staff ADD COLUMN role staff_role NOT NULL DEFAULT 'waiter';

-- 3. Staff tasks
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
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. Staff reports
CREATE TABLE IF NOT EXISTS staff_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  author_id UUID REFERENCES staff(id) ON DELETE SET NULL,
  type TEXT NOT NULL DEFAULT 'other' CHECK (type IN ('breakdown', 'notice', 'suggestion', 'other')),
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'reviewed', 'resolved')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 5. Staff schedules
CREATE TABLE IF NOT EXISTS staff_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  shift_start TIME,
  shift_end TIME,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(restaurant_id, employee_id, date)
);

-- 6. Технологички (чек-листы для кухни и бара)
CREATE TABLE IF NOT EXISTS tech_cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'dish',  -- dish | prep | stoplist
  target_roles TEXT[] NOT NULL DEFAULT '{"kitchen"}',
  items JSONB NOT NULL DEFAULT '[]',       -- [{id, label, checked, note}]
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 7. Tech card sessions (кто когда отметил)
CREATE TABLE IF NOT EXISTS tech_card_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  card_id UUID NOT NULL REFERENCES tech_cards(id) ON DELETE CASCADE,
  staff_id UUID REFERENCES staff(id) ON DELETE SET NULL,
  items_state JSONB NOT NULL DEFAULT '[]',
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 8. Checklist templates (открытие/закрытие зала — официанты)
CREATE TABLE IF NOT EXISTS shift_checklists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('open', 'close')),
  items JSONB NOT NULL DEFAULT '[]',       -- [{id, label}]
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 9. Checklist completions
CREATE TABLE IF NOT EXISTS shift_checklist_completions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  checklist_id UUID NOT NULL REFERENCES shift_checklists(id) ON DELETE CASCADE,
  staff_id UUID REFERENCES staff(id) ON DELETE SET NULL,
  date DATE NOT NULL,
  items_state JSONB NOT NULL DEFAULT '[]',
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS open for dev
ALTER TABLE staff_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE tech_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE tech_card_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE shift_checklists ENABLE ROW LEVEL SECURITY;
ALTER TABLE shift_checklist_completions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY open_dev_tasks ON staff_tasks FOR ALL USING (true) WITH CHECK (true);
  CREATE POLICY open_dev_reports ON staff_reports FOR ALL USING (true) WITH CHECK (true);
  CREATE POLICY open_dev_schedules ON staff_schedules FOR ALL USING (true) WITH CHECK (true);
  CREATE POLICY open_dev_techcards ON tech_cards FOR ALL USING (true) WITH CHECK (true);
  CREATE POLICY open_dev_techsessions ON tech_card_sessions FOR ALL USING (true) WITH CHECK (true);
  CREATE POLICY open_dev_checklists ON shift_checklists FOR ALL USING (true) WITH CHECK (true);
  CREATE POLICY open_dev_checklist_completions ON shift_checklist_completions FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
