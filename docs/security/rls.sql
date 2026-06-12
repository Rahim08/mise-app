-- ============================================================================
-- Mise — Row Level Security
-- ============================================================================
--
-- ⚠️  APPLY THIS LAST.
--
-- Enabling RLS denies all anon / authenticated access. The app must FIRST be fully
-- migrated to server-side data access:
--   • app screens  → /api/db gateway          (task: migrate screens to gateway)
--   • guest menu    → /api/menu public endpoint (task: public menu via server endpoint)
--
-- The Supabase `service_role` key (used by all server routes) has BYPASSRLS, so the
-- gateway and public endpoint keep working after this is applied. Direct browser access
-- with the anon key stops working — which is the point.
--
-- Run in: Supabase Dashboard → SQL Editor.  Reversible via the rollback block at the bottom.
-- ============================================================================

-- Enable RLS on every business table. With no policies defined, anon/authenticated
-- get zero rows; only service_role (BYPASSRLS) can read/write.

alter table public.restaurants          enable row level security;
alter table public.staff                enable row level security;
alter table public.shifts               enable row level security;
alter table public.shift_expenses       enable row level security;
alter table public.shift_absences       enable row level security;
alter table public.transactions         enable row level security;
alter table public.employees            enable row level security;
alter table public.salary_records       enable row level security;
alter table public.monthly_card_amounts enable row level security;
alter table public.expense_categories   enable row level security;
alter table public.inkassations         enable row level security;
alter table public.tobacco_stock        enable row level security;
alter table public.tobacco_movements    enable row level security;
alter table public.tobacco_flavors      enable row level security;
alter table public.tobacco_inventories  enable row level security;
alter table public.menu_settings        enable row level security;
alter table public.menu_categories      enable row level security;
alter table public.menu_items           enable row level security;
alter table public.menu_orders          enable row level security;
alter table public.subscriptions        enable row level security;
alter table public.restaurant_settings  enable row level security;
alter table public.profiles             enable row level security;
alter table public.admin_notes          enable row level security;

-- mise People (see docs/migrations/people-v3.sql — that migration already enables RLS on these,
-- listed here so the full lockdown lives in one place; re-running is harmless).
alter table public.staff_tasks                 enable row level security;
alter table public.staff_reports               enable row level security;
alter table public.staff_schedules             enable row level security;
alter table public.tech_cards                  enable row level security;
alter table public.tech_card_sessions          enable row level security;
alter table public.shift_checklists            enable row level security;
alter table public.shift_checklist_completions enable row level security;

-- ----------------------------------------------------------------------------
-- Owner self-access (optional but recommended).
-- Lets a logged-in owner read their own restaurant row directly if ever needed,
-- without the service role. Safe because it is scoped to auth.uid().
-- ----------------------------------------------------------------------------
create policy "owner reads own restaurant"
  on public.restaurants for select
  using (owner_id = auth.uid());

create policy "owner reads own profile"
  on public.profiles for select
  using (id = auth.uid());

-- ----------------------------------------------------------------------------
-- NOTE: We intentionally do NOT add anon policies for the guest menu.
-- The guest menu reads through the service-role /api/menu endpoint, so anon never
-- touches menu_settings / menu_items / restaurants directly (avoids leaking
-- owner_pin, stripe ids, etc. via column-blind row access).
-- ----------------------------------------------------------------------------

-- ============================================================================
-- Verify: should list all tables above with rowsecurity = true
-- ============================================================================
-- select tablename, rowsecurity from pg_tables
-- where schemaname = 'public' order by tablename;

-- ============================================================================
-- ROLLBACK (re-open everything) — use only if a migration regression is found.
-- ============================================================================
-- alter table public.restaurants          disable row level security;
-- alter table public.staff                disable row level security;
-- alter table public.shifts               disable row level security;
-- alter table public.shift_expenses       disable row level security;
-- alter table public.shift_absences       disable row level security;
-- alter table public.transactions         disable row level security;
-- alter table public.employees            disable row level security;
-- alter table public.salary_records       disable row level security;
-- alter table public.monthly_card_amounts disable row level security;
-- alter table public.expense_categories   disable row level security;
-- alter table public.inkassations         disable row level security;
-- alter table public.tobacco_stock        disable row level security;
-- alter table public.tobacco_movements    disable row level security;
-- alter table public.tobacco_flavors      disable row level security;
-- alter table public.tobacco_inventories  disable row level security;
-- alter table public.menu_settings        disable row level security;
-- alter table public.menu_categories      disable row level security;
-- alter table public.menu_items           disable row level security;
-- alter table public.menu_orders          disable row level security;
-- alter table public.subscriptions        disable row level security;
-- alter table public.restaurant_settings  disable row level security;
-- alter table public.profiles             disable row level security;
-- alter table public.admin_notes          disable row level security;
