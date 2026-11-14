-- Защита от дублей на уровне БД (аудит дублей 2026-10-26, docs/AUDIT-DUPLICATES-2026-10-26.md).
-- Перед применением дубли уже вычищены (26.10): двойных строк inkassations на смену нет.

-- 1) Одна строка инкассации на смену. Раньше select→insert из persist смены / выплаты ЗП /
--    аванса при параллельном вызове создавал вторую строку — расход списывался дважды
--    (SO, 25.10: баланс 3505 вместо 4355). Клиенты при ошибке insert перечитывают строку и
--    делают update (app/manager/page.tsx, dashboard shifts, ManagerView.swift).
create unique index if not exists uniq_inkassations_shift
  on inkassations (shift_id) where shift_id is not null;

-- 2) settle_debts идемпотентен: гасит только долги, которые ещё не оплачены (строки
--    блокируются for update). Повторный вызов с теми же id (двойное сохранение смены,
--    второе устройство) раньше писал вторую salary_payments и вторую строку погашения.
create or replace function public.settle_debts(p_restaurant_id uuid, p_shift_id uuid, p_date_str date, p_debts jsonb)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_debt jsonb;
  v_open jsonb;
  debt_ids uuid[];
begin
  if p_debts is null or jsonb_array_length(p_debts) = 0 then
    return;
  end if;

  select array_agg((d->>'id')::uuid) into debt_ids from jsonb_array_elements(p_debts) as d;

  perform 1 from shift_expenses
  where id = any(debt_ids) and restaurant_id = p_restaurant_id
  for update;

  select coalesce(jsonb_agg(d), '[]'::jsonb) into v_open
  from jsonb_array_elements(p_debts) as d
  join shift_expenses e on e.id = (d->>'id')::uuid
  where e.restaurant_id = p_restaurant_id
    and coalesce(e.is_paid, false) = false
    and e.paid_shift_id is null;

  if jsonb_array_length(v_open) = 0 then
    return;
  end if;

  for v_debt in select value from jsonb_array_elements(v_open)
  loop
    if coalesce((v_debt->>'is_salary')::boolean, false) then
      insert into salary_payments (restaurant_id, employee_id, period, amount, method, paid_at, note, created_by)
      values (
        p_restaurant_id,
        (v_debt->>'employee_id')::uuid,
        (v_debt->>'salary_period')::date,
        (v_debt->>'amount')::numeric,
        'cash',
        p_date_str::timestamptz,
        v_debt->>'salary_note',
        null
      );
    end if;
  end loop;

  insert into shift_expenses (shift_id, restaurant_id, amount, category_id, category_name, employee_id, is_paid, paid_shift_id, note)
  select
    p_shift_id,
    p_restaurant_id,
    (d->>'amount')::numeric,
    nullif(d->>'category_id', '')::uuid,
    d->>'category_name',
    nullif(d->>'employee_id', '')::uuid,
    true,
    p_shift_id,
    d->>'expense_note'
  from jsonb_array_elements(v_open) as d;

  update shift_expenses
  set is_paid = true, paid_at = p_date_str, paid_shift_id = p_shift_id
  where id in (select (d->>'id')::uuid from jsonb_array_elements(v_open) as d)
    and restaurant_id = p_restaurant_id;
end;
$function$;
