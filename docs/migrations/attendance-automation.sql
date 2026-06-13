-- ============================================================================
-- Mise — Attendance automation (авто-прогул по геоконтролю)
-- ============================================================================
--
-- Готовит БД к автоматизации «не пришёл → авто-X в Менеджере → вычет в Аналитике».
-- Аддитивно и безопасно, КРОМЕ уникального индекса (см. предупреждение ниже).
--
-- Run in: Supabase Dashboard → SQL Editor.
-- ============================================================================

-- 1) Настоящая связь staff ↔ employees (сейчас матчинг по имени — хрупко).
--    Гео знает staff_id, прогул хранится по employee_id; FK убирает двусмысленность.
alter table public.staff add column if not exists employee_id uuid references public.employees(id);
create index if not exists idx_staff_employee on public.staff(employee_id);

-- Разовый бэкофилл по совпадению имени в рамках одного ресторана.
-- ⚠️ Если в заведении два сотрудника с одинаковым именем — проверь результат вручную.
update public.staff s
   set employee_id = e.id
  from public.employees e
 where s.employee_id is null
   and e.restaurant_id = s.restaurant_id
   and e.name = s.name
   and e.is_active;

-- 2) Отличать авто-прогул (черновик «X») от подтверждённого менеджером.
alter table public.shift_absences add column if not exists source text not null default 'manager'; -- 'manager' | 'auto'
alter table public.shift_absences add column if not exists auto_reason text;                       -- напр. 'no_show'

-- 3) Параметры геоконтроля на уровне точки.
alter table public.restaurant_settings add column if not exists early_arrival_min   integer not null default 0; -- прийти за N мин до открытия
alter table public.restaurant_settings add column if not exists no_show_grace_hours integer not null default 3; -- через сколько часов ставить авто-прогул

-- 4) Уникальность прогула на (ресторан, сотрудник, дата) — нужна для upsert из cron.
-- ⚠️ ВЫПОЛНЯТЬ ПОСЛЕ проверки дублей. Если индекс не создаётся — сначала почисти дубли:
--   select restaurant_id, employee_id, date, count(*) from shift_absences
--   group by 1,2,3 having count(*) > 1;
create unique index if not exists uniq_absence_emp_date
  on public.shift_absences(restaurant_id, employee_id, date);
