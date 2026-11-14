-- Аудит People 2026-11-14, пакет D: связать staff (PIN-доступ) с employees (HR/ЗП) по имени
-- там, где staff.employee_id пуст. Без связи команда матчит по имени (тёзки путаются),
-- а ЗП/история окладов не видят доступ сотрудника.
-- Связываем только однозначные пары: один активный employee с таким именем в том же ресторане,
-- и этот employee ещё ни к кому не привязан. Неактивные дубли имени игнорируются.
-- Проверено на проде 14.11: 8 строк (SO — 4, Vitalcengo — 3, ME — 1).

with cand as (
  select s.id as staff_id, e.id as employee_id
  from staff s
  join employees e on e.restaurant_id = s.restaurant_id and e.name = s.name and e.is_active
  where s.employee_id is null and s.is_active
    and not exists (select 1 from staff s2 where s2.employee_id = e.id)
),
uniq as (
  select staff_id, min(employee_id::text)::uuid as employee_id
  from cand group by staff_id having count(*) = 1
)
update staff s set employee_id = u.employee_id
from uniq u where s.id = u.staff_id
returning s.id, s.name, s.employee_id;
