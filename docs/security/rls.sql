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

-- Additional tables from POLICY map — enable RLS for defense-in-depth.
-- These tables were previously accessible via anon key without RLS.
alter table public.salary_advances       enable row level security;
alter table public.hookah_sales          enable row level security;
alter table public.bookings              enable row level security;
alter table public.news_posts            enable row level security;
alter table public.guest_notes           enable row level security;
alter table public.notification_prefs    enable row level security;
alter table public.purchase_items        enable row level security;
alter table public.push_subscriptions    enable row level security;
alter table public.notifications         enable row level security;
alter table public.shift_swap_requests   enable row level security;
alter table public.attendance_records    enable row level security;
alter table public.menu_events           enable row level security;
alter table public.menus                 enable row level security;
alter table public.hookah_types          enable row level security;
alter table public.hookah_goals          enable row level security;

-- ВНИМАНИЕ (аудит 2026-08-05): здесь раньше стояла строка
--   alter table public.staff_directory enable row level security;
-- `staff_directory` — это НЕ таблица, а VIEW (docs/migrations/people-features.sql:95).
-- Postgres на такой команде падает с ошибкой 42809 «is not a table», а SQL Editor
-- выполняет файл одним батчем в транзакции → откатывалось ВСЁ, что ниже (в т.ч. сами
-- политики). Проверьте фактическое состояние RLS диагностикой в конце файла.
-- RLS для вьюхи не нужна и не существует: она создана WITH (security_invoker = true),
-- то есть читается с правами вызывающего и наследует RLS базовой таблицы `staff`
-- (у неё RLS включена выше). anon через вьюху не получит ни строки.

-- Таблицы, добавленные более поздними миграциями (аудит 2026-08-05). Каждая уже включает
-- RLS в своей миграции, включая salary_payments (salary-payroll-2026-07.sql). Перечислены
-- здесь, чтобы полный lockdown по-прежнему жил в одном месте; повторный прогон безвреден.
alter table public.salary_payments          enable row level security; -- salary-payroll-2026-07.sql
alter table public.google_reviews           enable row level security; -- google-reviews-2026-07.sql
alter table public.google_rating_snapshots  enable row level security; -- google-reviews-2026-07.sql
alter table public.stripe_events            enable row level security; -- stripe-events-2026-07.sql
alter table public.rate_limits              enable row level security; -- rate-limit-atomic-2026-07.sql
alter table public.pin_attempts             enable row level security; -- features-2026-06.sql
alter table public.app_errors               enable row level security; -- features-2026-06.sql

-- ----------------------------------------------------------------------------
-- Owner self-access (optional but recommended).
-- Lets a logged-in owner read their own restaurant row directly if ever needed,
-- without the service role. Safe because it is scoped to auth.uid().
-- ----------------------------------------------------------------------------
-- drop перед create — иначе повторный прогон файла падает с «policy already exists»
-- и (в одном батче SQL Editor) откатывает всё, что было выше.
drop policy if exists "owner reads own restaurant" on public.restaurants;
create policy "owner reads own restaurant"
  on public.restaurants for select
  using (owner_id = auth.uid());

drop policy if exists "owner reads own profile" on public.profiles;
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
-- alter table public.salary_advances       disable row level security;
-- alter table public.hookah_sales          disable row level security;
-- alter table public.bookings              disable row level security;
-- alter table public.news_posts            disable row level security;
-- alter table public.guest_notes           disable row level security;
-- alter table public.notification_prefs    disable row level security;
-- alter table public.purchase_items        disable row level security;
-- alter table public.push_subscriptions    disable row level security;
-- alter table public.notifications         disable row level security;
-- alter table public.shift_swap_requests   disable row level security;
-- alter table public.attendance_records    disable row level security;
-- alter table public.menu_events           disable row level security;
-- alter table public.menus                 disable row level security;
-- alter table public.hookah_types          disable row level security;
-- alter table public.hookah_goals          disable row level security;
-- alter table public.staff_directory       disable row level security;
