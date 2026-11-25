-- Аудит денег Manager 2026-11-25. Применять целиком. Данные задним числом не меняет.

-- 1) settle_debts: долг своей смены не получает вторую строку (раньше исходная и строка
--    погашения обе имели paid_shift_id этой смены — расход считался дважды); долг, уже
--    погашенный другой сменой, удалённый или с другой суммой, — ошибка, а не тихий пропуск
--    (клиент уже посчитал его в кассе). Повтор той же сменой по-прежнему пропускается.
--    Защищает и старые iOS-сборки.
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
       or v_row.amount <> (v_debt->>'amount')::numeric then
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

-- 2) Цепочка кассы: изменение closing_balance смены пересчитывает вход и кассу всех следующих
--    смен заведения (раньше правка прошлого дня их не трогала — SO 18.10, расхождение 7.40).
create or replace function public.shifts_cascade_balance()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
begin
  -- вход самой смены приводим в согласие с сохранённой кассой
  new.opening_balance := coalesce(new.closing_balance, 0) - coalesce(new.income, 0) + coalesce(new.total_expense, 0);

  with chain as (
    select id,
           coalesce(income, 0) - coalesce(total_expense, 0) as delta,
           coalesce(new.closing_balance, 0)
             + sum(coalesce(income, 0) - coalesce(total_expense, 0)) over (order by date, opened_at, id) as closing
    from shifts
    where restaurant_id = new.restaurant_id and date > new.date
  )
  update shifts s
  set opening_balance = c.closing - c.delta, closing_balance = c.closing
  from chain c
  where s.id = c.id
    and (s.opening_balance is distinct from c.closing - c.delta or s.closing_balance is distinct from c.closing);

  return new;
end;
$function$;

drop trigger if exists shifts_cascade_balance on shifts;
create trigger shifts_cascade_balance
  before update of closing_balance on shifts
  for each row
  when (pg_trigger_depth() = 0 and old.closing_balance is distinct from new.closing_balance)
  execute function public.shifts_cascade_balance();
