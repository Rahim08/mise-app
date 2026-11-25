-- Деньги зарплаты одной операцией (этап 2 устранения причин дублей, 2026-11-25).
-- Только добавляет: старые клиенты продолжают писать напрямую.
--
-- Раньше выплата и аванс = 2-4 запроса с клиента с «откатами» и сверкой остатка по
-- устаревшему экрану. Теперь одна транзакция под блокировкой заведения: остаток к выплате и
-- пул инкассации считает база, повтор с тем же op_id ничего не делает.
-- Коды ошибок: MS003 больше остатка, MS004 не хватает в инкассации, MS005 повторная выплата.

create table if not exists public.money_ops (
  op_id uuid primary key,
  restaurant_id uuid not null,
  kind text not null,
  created_at timestamptz not null default now()
);
alter table public.money_ops enable row level security;
revoke all on public.money_ops from public, anon, authenticated;
grant select, insert on public.money_ops to service_role;

-- Один открытый ЗП-долг на сотрудника и месяц.
create unique index if not exists uniq_salperiod_debt
  on public.shift_expenses (restaurant_id, employee_id, note)
  where note like 'SALPERIOD:%' and is_paid = false;

-- Блокировка денег заведения до конца транзакции; false = эта операция уже выполнена.
create or replace function public.money_begin(p_restaurant_id uuid, p_op uuid, p_kind text)
 returns boolean language plpgsql set search_path to 'public' as $function$
declare v_count int;
begin
  if p_op is null then raise exception 'op_id required'; end if;
  perform pg_advisory_xact_lock(hashtext('money:' || p_restaurant_id::text));
  insert into money_ops (op_id, restaurant_id, kind) values (p_op, p_restaurant_id, p_kind)
  on conflict (op_id) do nothing;
  get diagnostics v_count = row_count;
  return v_count = 1;
end $function$;

-- Остаток нала к выплате за месяц — та же формула, что в клиентах (computeSalary).
create or replace function public.salary_remaining(p_restaurant_id uuid, p_employee_id uuid, p_period date)
 returns numeric language plpgsql stable set search_path to 'public' as $function$
declare v_salary numeric; v_deduct numeric; v_total numeric; v_cash numeric;
        v_end date := (p_period + interval '1 month' - interval '1 day')::date;
begin
  select coalesce(salary, 0), coalesce(deduct_per_absence, 0) into v_salary, v_deduct
  from employees where id = p_employee_id and restaurant_id = p_restaurant_id;
  if not found then raise exception 'unknown employee'; end if;
  select h.salary, h.deduct_per_absence into v_salary, v_deduct from (
    select salary, deduct_per_absence from salary_history
    where restaurant_id = p_restaurant_id and employee_id = p_employee_id and effective_from <= p_period
    order by effective_from desc limit 1) h;
  if not found then
    select coalesce(salary, 0), coalesce(deduct_per_absence, 0) into v_salary, v_deduct
    from employees where id = p_employee_id;
  end if;
  v_total := greatest(0, v_salary - v_deduct * (
    select count(*) from shift_absences where restaurant_id = p_restaurant_id and employee_id = p_employee_id
      and date between p_period and v_end and coalesce(source, 'manager') <> 'auto'));
  v_cash := greatest(0, v_total
    - coalesce((select sum(amount) from salary_advances where restaurant_id = p_restaurant_id and employee_id = p_employee_id and period = p_period), 0)
    - coalesce((select sum(card_amount) from monthly_card_amounts where restaurant_id = p_restaurant_id and employee_id = p_employee_id and month = to_char(p_period, 'YYYY-MM')), 0));
  return round(greatest(0, v_cash
    - coalesce((select sum(amount) from salary_payments where restaurant_id = p_restaurant_id and employee_id = p_employee_id and period = p_period and coalesce(method, 'cash') = 'cash'), 0)
    - coalesce((select sum(amount) from shift_expenses where restaurant_id = p_restaurant_id and employee_id = p_employee_id and is_paid = false and note = 'SALPERIOD:' || p_period::text), 0)), 2);
end $function$;

-- Смена на дату (нет — создаётся: выплата задним/будущим числом), заблокирована.
create or replace function public.money_shift(p_restaurant_id uuid, p_date date)
 returns public.shifts language plpgsql set search_path to 'public' as $function$
declare v_shift shifts%rowtype; v_opening numeric;
begin
  select * into v_shift from shifts where restaurant_id = p_restaurant_id and date = p_date for update;
  if found then return v_shift; end if;
  select closing_balance into v_opening from shifts
  where restaurant_id = p_restaurant_id and date < p_date order by date desc, opened_at desc limit 1;
  insert into shifts (restaurant_id, date, opening_balance, income, inkassation, closing_balance, status)
  values (p_restaurant_id, p_date, coalesce(v_opening, 0), 0, 0, coalesce(v_opening, 0), 'open')
  on conflict (restaurant_id, date) do nothing;
  select * into v_shift from shifts where restaurant_id = p_restaurant_id and date = p_date for update;
  return v_shift;
end $function$;

create or replace function public.money_pool(p_restaurant_id uuid)
 returns numeric language sql stable set search_path to 'public' as $function$
  select round(coalesce((select balance from inkassation_balance where restaurant_id = p_restaurant_id), 0), 2)
$function$;

-- p: {op_id, employee_id, period, amount, method, date, note, entry}
create or replace function public.pay_salary(p_restaurant_id uuid, p jsonb)
 returns void language plpgsql security definer set search_path to 'public' as $function$
declare
  v_emp uuid := (p->>'employee_id')::uuid;
  v_period date := (p->>'period')::date;
  v_amount numeric := round((p->>'amount')::numeric, 2);
  v_method text := coalesce(p->>'method', 'cash');
  v_date date := (p->>'date')::date;
  v_shift shifts%rowtype;
begin
  if not money_begin(p_restaurant_id, (p->>'op_id')::uuid, 'pay_salary') then return; end if;
  if v_amount is null or v_amount <= 0 or v_method not in ('cash', 'card') or v_date is null or v_period is null then
    raise exception 'invalid payment';
  end if;
  if not exists (select 1 from employees where id = v_emp and restaurant_id = p_restaurant_id) then
    raise exception 'unknown employee';
  end if;
  if exists (select 1 from salary_payments where restaurant_id = p_restaurant_id and employee_id = v_emp
             and period = v_period and amount = v_amount and method = v_method
             and created_at > now() - interval '2 minutes') then
    raise exception using errcode = 'MS005', message = 'duplicate_payment';
  end if;
  if v_method = 'cash' then
    if v_amount > salary_remaining(p_restaurant_id, v_emp, v_period) then
      raise exception using errcode = 'MS003', message = 'exceeds_remaining';
    end if;
    v_shift := money_shift(p_restaurant_id, v_date);
    if v_amount > money_pool(p_restaurant_id) then
      raise exception using errcode = 'MS004', message = 'insufficient_pool';
    end if;
  end if;
  insert into salary_payments (restaurant_id, employee_id, period, amount, method, paid_at, note)
  values (p_restaurant_id, v_emp, v_period, v_amount, v_method, v_date::timestamptz, nullif(p->>'note', ''));
  if v_method = 'cash' then
    insert into inkassations as i (shift_id, restaurant_id, date, amount, expense, salary, salary_note, total)
    values (v_shift.id, p_restaurant_id, v_date, coalesce(v_shift.inkassation, 0), 0, v_amount,
            p->>'entry', coalesce(v_shift.inkassation, 0) - v_amount)
    on conflict (shift_id) where shift_id is not null do update
      set salary = coalesce(i.salary, 0) + excluded.salary,
          salary_note = concat_ws('; ', nullif(i.salary_note, ''), excluded.salary_note),
          total = coalesce(i.amount, 0) - coalesce(i.expense, 0) - coalesce(i.salary, 0) - excluded.salary;
  end if;
end $function$;

-- p: {op_id (он же id аванса), employee_id, period, amount, date, note, tag}
create or replace function public.add_advance(p_restaurant_id uuid, p jsonb)
 returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_id uuid := (p->>'op_id')::uuid;
  v_emp uuid := (p->>'employee_id')::uuid;
  v_period date := (p->>'period')::date;
  v_amount numeric := round((p->>'amount')::numeric, 2);
  v_date date := (p->>'date')::date;
  v_shift shifts%rowtype;
begin
  if money_begin(p_restaurant_id, v_id, 'add_advance') then
    if v_amount is null or v_amount <= 0 or v_date is null or v_period is null then raise exception 'invalid advance'; end if;
    if v_amount > salary_remaining(p_restaurant_id, v_emp, v_period) then
      raise exception using errcode = 'MS003', message = 'exceeds_remaining';
    end if;
    v_shift := money_shift(p_restaurant_id, v_date);
    if v_amount > money_pool(p_restaurant_id) then
      raise exception using errcode = 'MS004', message = 'insufficient_pool';
    end if;
    insert into salary_advances (id, restaurant_id, employee_id, amount, date, period, note)
    values (v_id, p_restaurant_id, v_emp, v_amount, v_date, v_period, p->>'note');
    insert into inkassations as i (shift_id, restaurant_id, date, amount, expense, reason, total)
    values (v_shift.id, p_restaurant_id, v_date, coalesce(v_shift.inkassation, 0), v_amount, p->>'tag',
            coalesce(v_shift.inkassation, 0) - v_amount)
    on conflict (shift_id) where shift_id is not null do update
      set expense = coalesce(i.expense, 0) + excluded.expense,
          reason = concat_ws(', ', nullif(i.reason, ''), excluded.reason),
          total = coalesce(i.amount, 0) - coalesce(i.expense, 0) - excluded.expense - coalesce(i.salary, 0);
  end if;
  return (select to_jsonb(a) from salary_advances a where a.id = v_id and a.restaurant_id = p_restaurant_id);
end $function$;

-- p: {op_id, advance_id, tag, prefix}. Удалённый ранее аванс — не ошибка.
create or replace function public.delete_advance(p_restaurant_id uuid, p jsonb)
 returns void language plpgsql security definer set search_path to 'public' as $function$
declare
  v_adv salary_advances%rowtype;
  v_ink inkassations%rowtype;
  v_parts text[];
  v_tag text := p->>'tag';
  v_prefix text := coalesce(p->>'prefix', '');
  v_expense numeric;
begin
  if not money_begin(p_restaurant_id, (p->>'op_id')::uuid, 'delete_advance') then return; end if;
  select * into v_adv from salary_advances
  where id = (p->>'advance_id')::uuid and restaurant_id = p_restaurant_id for update;
  if not found then return; end if;
  select i.* into v_ink from inkassations i join shifts s on s.id = i.shift_id
  where s.restaurant_id = p_restaurant_id and s.date = v_adv.date for update of i;
  if found then
    v_parts := string_to_array(coalesce(v_ink.reason, ''), ', ');
    if v_tag = any(v_parts) then
      v_parts := array_remove(v_parts, v_tag);
    elsif v_prefix <> '' then -- авансы до тегов с id
      v_parts := array(select x from unnest(v_parts) x where not starts_with(x, v_prefix));
    end if;
    v_expense := greatest(0, coalesce(v_ink.expense, 0) - v_adv.amount);
    update inkassations set expense = v_expense, reason = array_to_string(v_parts, ', '),
      total = coalesce(amount, 0) - v_expense - coalesce(salary, 0)
    where id = v_ink.id;
  end if;
  delete from salary_advances where id = v_adv.id;
end $function$;

-- p: {op_id, employee_id, period, date, amount, title}. «Отметить как долг».
create or replace function public.add_salary_debt(p_restaurant_id uuid, p jsonb)
 returns void language plpgsql security definer set search_path to 'public' as $function$
declare
  v_emp uuid := (p->>'employee_id')::uuid;
  v_period date := (p->>'period')::date;
  v_amount numeric := round((p->>'amount')::numeric, 2);
  v_note text := 'SALPERIOD:' || (p->>'period');
  v_shift shifts%rowtype;
begin
  if not money_begin(p_restaurant_id, (p->>'op_id')::uuid, 'add_salary_debt') then return; end if;
  if v_amount is null or v_amount <= 0 or v_period is null then raise exception 'invalid debt'; end if;
  if v_amount > salary_remaining(p_restaurant_id, v_emp, v_period) then
    raise exception using errcode = 'MS003', message = 'exceeds_remaining';
  end if;
  update shift_expenses set amount = amount + v_amount
  where restaurant_id = p_restaurant_id and employee_id = v_emp and note = v_note and is_paid = false;
  if not found then
    v_shift := money_shift(p_restaurant_id, (p->>'date')::date);
    insert into shift_expenses (shift_id, restaurant_id, employee_id, category_name, amount, is_paid, note)
    values (v_shift.id, p_restaurant_id, v_emp, p->>'title', v_amount, false, v_note);
  end if;
end $function$;

revoke all on function public.money_begin(uuid, uuid, text), public.salary_remaining(uuid, uuid, date),
  public.money_shift(uuid, date), public.money_pool(uuid), public.pay_salary(uuid, jsonb),
  public.add_advance(uuid, jsonb), public.delete_advance(uuid, jsonb), public.add_salary_debt(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.salary_remaining(uuid, uuid, date), public.pay_salary(uuid, jsonb),
  public.add_advance(uuid, jsonb), public.delete_advance(uuid, jsonb), public.add_salary_debt(uuid, jsonb)
  to service_role;
