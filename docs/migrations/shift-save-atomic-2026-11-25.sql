-- Сохранение смены одной операцией (этап 1 устранения причин дублей, 2026-11-25).
-- Только добавляет: старые клиенты продолжают писать напрямую.
-- Требует shift-money-fixes-2026-11-25.sql (settle_debts, триггер цепочки кассы).
--
-- Раньше клиент сохранял смену 5-7 независимыми запросами и сам решал, какие строки удалить:
-- обрыв связи, устаревшее чтение или второе устройство оставляли дубли. Теперь всё в одной
-- транзакции под блокировкой смены; повтор с тем же op_id ничего не делает; форма, открытая
-- до чужого изменения, получает отказ MS001; итоги считает база по строкам.

-- Исправление settle_debts из shift-money-fixes: суммы сравниваются до центов. iOS пишет
-- 1.1 в JSON как 1.1000000000000001 — без округления погашение долга с копейками отклонялось.
create or replace function public.settle_debts(p_restaurant_id uuid, p_shift_id uuid, p_date_str date, p_debts jsonb)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_debt jsonb;
  v_row shift_expenses%rowtype;
begin
  if p_debts is null or jsonb_array_length(p_debts) = 0 then
    return;
  end if;

  for v_debt in select value from jsonb_array_elements(p_debts)
  loop
    select * into v_row from shift_expenses
    where id = (v_debt->>'id')::uuid and restaurant_id = p_restaurant_id
    for update;

    if found and v_row.paid_shift_id = p_shift_id then
      continue; -- уже погашен этой сменой (повтор после сбоя)
    end if;
    if not found or v_row.paid_shift_id is not null or coalesce(v_row.is_paid, false)
       or round(v_row.amount, 2) <> round((v_debt->>'amount')::numeric, 2) then
      raise exception 'debt_changed';
    end if;

    if coalesce((v_debt->>'is_salary')::boolean, false) then
      insert into salary_payments (restaurant_id, employee_id, period, amount, method, paid_at, note, created_by)
      values (p_restaurant_id, (v_debt->>'employee_id')::uuid, (v_debt->>'salary_period')::date,
              v_row.amount, 'cash', p_date_str::timestamptz, v_debt->>'salary_note', null);
    end if;

    if v_row.shift_id is distinct from p_shift_id then
      insert into shift_expenses (shift_id, restaurant_id, amount, category_id, category_name, employee_id, is_paid, paid_shift_id, note)
      values (p_shift_id, p_restaurant_id, v_row.amount,
              nullif(v_debt->>'category_id', '')::uuid, v_debt->>'category_name',
              nullif(v_debt->>'employee_id', '')::uuid, true, p_shift_id, v_debt->>'expense_note');
    end if;

    update shift_expenses
    set is_paid = true, paid_at = p_date_str, paid_shift_id = p_shift_id
    where id = v_row.id;
  end loop;
end;
$function$;

revoke all on function public.settle_debts(uuid, uuid, date, jsonb) from public, anon, authenticated;
grant execute on function public.settle_debts(uuid, uuid, date, jsonb) to service_role;

create table if not exists public.shift_save_ops (
  op_id uuid primary key,
  restaurant_id uuid not null,
  shift_id uuid not null,
  result jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.shift_save_ops enable row level security;
revoke all on public.shift_save_ops from public, anon, authenticated;
grant select, insert on public.shift_save_ops to service_role;

create or replace function public.save_shift(p_restaurant_id uuid, p_shift_id uuid, p jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_shift shifts%rowtype;
  v_op uuid := (p->>'op_id')::uuid;
  v_result jsonb;
  v_income numeric := round(coalesce((p->>'income')::numeric, 0), 2);
  v_card numeric := round(coalesce((p->>'income_card')::numeric, 0), 2);
  v_ink numeric := round(coalesce((p->>'inkassation')::numeric, 0), 2);
  v_replace uuid[];
  v_keep uuid[] := '{}';
  v_item jsonb;
  v_id uuid;
  v_cat uuid;
  v_emp uuid;
  v_name text;
  v_amount numeric;
  v_paid boolean;
  v_note text;
  v_count int;
  v_total numeric;
  v_opening numeric;
  v_inkrow inkassations%rowtype;
  v_delta numeric := round(coalesce((p->>'ink_expense_delta')::numeric, 0), 2);
  v_reason text := coalesce(p->>'ink_reason', '');
  v_loaded_reason text := coalesce(p->>'ink_loaded_reason', '');
  v_expense numeric;
  v_salary numeric;
  v_final_reason text;
begin
  if v_op is null then raise exception 'op_id required'; end if;
  if v_income < 0 or v_card < 0 or v_ink < 0 then raise exception 'negative amount'; end if;

  select * into v_shift from shifts
  where id = p_shift_id and restaurant_id = p_restaurant_id for update;
  if not found then raise exception using errcode = 'MS001', message = 'shift_changed'; end if;

  -- Повтор после потерянного ответа: уже применено.
  select result into v_result from shift_save_ops where op_id = v_op and shift_id = p_shift_id;
  if found then return v_result; end if;

  -- Форма устарела: суммы смены изменены не ею.
  if round(coalesce(v_shift.income, 0), 2) <> round(coalesce((p->'expected'->>'income')::numeric, 0), 2)
     or round(coalesce(v_shift.income_card, 0), 2) <> round(coalesce((p->'expected'->>'income_card')::numeric, 0), 2)
     or round(coalesce(v_shift.inkassation, 0), 2) <> round(coalesce((p->'expected'->>'inkassation')::numeric, 0), 2) then
    raise exception using errcode = 'MS001', message = 'shift_changed';
  end if;

  select coalesce(array_agg(x::uuid), '{}') into v_replace
  from jsonb_array_elements_text(coalesce(p->'replace_ids', '[]'::jsonb)) x;

  -- Форма устарела: на смене есть строка, которой она не видела (или видела другой).
  -- ЗП-долги и погашения живут вне формы и сохранению не мешают.
  if exists (
    select 1 from shift_expenses e
    where e.shift_id = p_shift_id and e.paid_shift_id is null
      and coalesce(e.note, '') not like 'SALPERIOD:%'
      and not exists (
        select 1 from jsonb_array_elements(coalesce(p->'seen', '[]'::jsonb)) s
        where (s->>'id')::uuid = e.id
          and round(coalesce((s->>'amount')::numeric, 0), 2) = round(coalesce(e.amount, 0), 2)
          and coalesce((s->>'is_paid')::boolean, true) = coalesce(e.is_paid, true)
          and coalesce(s->>'category_name', '') = coalesce(e.category_name, '')
          and coalesce(s->>'note', '') = coalesce(e.note, ''))
  ) then
    raise exception using errcode = 'MS001', message = 'shift_changed';
  end if;
  -- ...или строка, которую форма собирается заменить, удалена либо погашена.
  select count(*) into v_count from shift_expenses
  where id = any(v_replace) and shift_id = p_shift_id and paid_shift_id is null;
  if v_count <> cardinality(v_replace) then
    raise exception using errcode = 'MS001', message = 'shift_changed';
  end if;

  if jsonb_array_length(coalesce(p->'debts', '[]'::jsonb)) > 0 then
    if exists (select 1 from jsonb_array_elements(p->'debts') d
               join shift_expenses e on e.id = (d->>'id')::uuid
               where e.shift_id = p_shift_id and e.paid_shift_id is null) then
      raise exception using errcode = 'MS002', message = 'debt_changed';
    end if;
    begin
      perform settle_debts(p_restaurant_id, p_shift_id, v_shift.date, p->'debts');
    exception when raise_exception then
      raise exception using errcode = 'MS002', message = 'debt_changed';
    end;
  end if;

  -- Категории и экстры: неизменившаяся строка остаётся (id долга не меняется).
  for v_item in select value from jsonb_array_elements(coalesce(p->'rows', '[]'::jsonb))
  loop
    v_cat := nullif(v_item->>'category_id', '')::uuid;
    v_emp := nullif(v_item->>'employee_id', '')::uuid;
    v_amount := round((v_item->>'amount')::numeric, 2);
    v_paid := not coalesce((v_item->>'unpaid')::boolean, false);
    v_note := coalesce(v_item->>'note', '');
    if v_amount is null or v_amount <= 0 or (v_cat is null) = (v_emp is null) then
      raise exception 'invalid expense row';
    end if;
    if v_cat is not null then
      select name into v_name from expense_categories where id = v_cat and restaurant_id = p_restaurant_id;
    else
      select name || ' (экстра)' into v_name from employees where id = v_emp and restaurant_id = p_restaurant_id;
    end if;
    if v_name is null then raise exception 'unknown category or employee'; end if;

    select id into v_id from shift_expenses
    where id = any(v_replace) and not (id = any(v_keep)) and not coalesce(is_custom, false)
      and category_id is not distinct from v_cat and employee_id is not distinct from v_emp
      and round(amount, 2) = v_amount and coalesce(is_paid, true) = v_paid and coalesce(note, '') = v_note
    limit 1;
    if v_id is null then
      insert into shift_expenses (shift_id, restaurant_id, category_id, employee_id, category_name, amount, note, is_paid)
      values (p_shift_id, p_restaurant_id, v_cat, v_emp, v_name, v_amount, v_note, v_paid)
      returning id into v_id;
    end if;
    v_keep := v_keep || v_id;
  end loop;

  -- Свои расходы: стабильный id от клиента.
  for v_item in select value from jsonb_array_elements(coalesce(p->'custom', '[]'::jsonb))
  loop
    v_id := (v_item->>'id')::uuid;
    insert into shift_expenses as e (id, shift_id, restaurant_id, category_name, amount, note, is_paid, is_custom)
    values (v_id, p_shift_id, p_restaurant_id, v_item->>'name', round((v_item->>'amount')::numeric, 2),
            coalesce(v_item->>'note', ''), not coalesce((v_item->>'unpaid')::boolean, false), true)
    on conflict (restaurant_id, id) do update
      set category_name = excluded.category_name, amount = excluded.amount,
          note = excluded.note, is_paid = excluded.is_paid
      where e.shift_id = p_shift_id and e.is_custom and e.paid_shift_id is null and e.id = any(v_replace);
    get diagnostics v_count = row_count;
    if v_count <> 1 then raise exception using errcode = 'MS001', message = 'shift_changed'; end if;
    v_keep := v_keep || v_id;
  end loop;

  delete from shift_expenses where id = any(v_replace) and not (id = any(v_keep));

  -- Итоги по строкам: оплаченные расходы дня + погашенные этой сменой долги + инкассация.
  select coalesce(sum(amount), 0) + v_ink into v_total from shift_expenses
  where shift_id = p_shift_id
    and (paid_shift_id = p_shift_id or (paid_shift_id is null and coalesce(is_paid, true)));
  select closing_balance into v_opening from shifts
  where restaurant_id = p_restaurant_id and date < v_shift.date
  order by date desc, opened_at desc limit 1;
  v_opening := coalesce(v_opening, 0);

  update shifts set income = v_income, income_card = v_card, inkassation = v_ink,
    total_expense = v_total, opening_balance = v_opening,
    closing_balance = v_opening + v_income - v_total
  where id = p_shift_id;

  -- Инкассация: переносим правку менеджера (дельту) поверх актуального (авансы, ЗП).
  select * into v_inkrow from inkassations where shift_id = p_shift_id for update;
  v_expense := coalesce(v_inkrow.expense, 0) + v_delta;
  v_salary := coalesce(v_inkrow.salary, 0);
  v_final_reason := case
    when coalesce(v_inkrow.reason, '') = v_loaded_reason or v_reason <> v_loaded_reason then v_reason
    else coalesce(v_inkrow.reason, '') end;
  if v_ink > 0 or v_expense <> 0 or v_final_reason <> '' or v_salary <> 0 then
    insert into inkassations as i (shift_id, restaurant_id, date, amount, expense, reason, total)
    values (p_shift_id, p_restaurant_id, v_shift.date, v_ink, v_expense, v_final_reason, v_ink - v_expense - v_salary)
    on conflict (shift_id) where shift_id is not null do update
      set date = excluded.date, amount = excluded.amount,
          expense = coalesce(i.expense, 0) + v_delta, reason = excluded.reason,
          total = excluded.amount - (coalesce(i.expense, 0) + v_delta) - coalesce(i.salary, 0);
  else
    delete from inkassations where shift_id = p_shift_id;
  end if;

  update shift_absences set shift_id = p_shift_id, source = 'manager'
  where restaurant_id = p_restaurant_id and date = v_shift.date;

  -- Новый снимок для формы — без повторного чтения.
  v_result := jsonb_build_object(
    'opening_balance', v_opening, 'total_expense', v_total,
    'closing_balance', v_opening + v_income - v_total,
    'rows', coalesce((select jsonb_agg(to_jsonb(e) order by e.created_at, e.id) from shift_expenses e where e.shift_id = p_shift_id), '[]'::jsonb),
    'ink', (select jsonb_build_object('expense', expense, 'reason', reason) from inkassations where shift_id = p_shift_id));
  insert into shift_save_ops (op_id, restaurant_id, shift_id, result) values (v_op, p_restaurant_id, p_shift_id, v_result);
  return v_result;
end;
$function$;

revoke all on function public.save_shift(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.save_shift(uuid, uuid, jsonb) to service_role;
