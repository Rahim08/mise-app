-- Повторные записи и продажи кальянов (этап 3 устранения причин дублей, 2026-11-25).
--
-- 1) Двойной тап, повтор после обрыва связи, повторный запуск cron: база отклоняет вторую
--    ТОЧНО такую же запись в течение 30 секунд (код MS006). Защита в одном месте и работает
--    для всех клиентов, включая старые сборки iOS. Строки одного пакетного insert не
--    сравниваются между собой. Не сравниваются id, даты создания/изменения и соль PIN.
create or replace function public.reject_repeat_insert()
 returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare
  v_skip text[] := array['id', 'created_at', 'updated_at', 'pin_hash'];
  v_row jsonb := to_jsonb(new) - v_skip;
  v_found boolean;
begin
  -- одновременные одинаковые вставки идут по очереди, вторая видит первую
  perform pg_advisory_xact_lock(hashtextextended(tg_table_name || v_row::text, 0));
  execute format(
    'select exists(select 1 from public.%I t where t.restaurant_id = $1
       and t.created_at > now() - interval ''30 seconds'' and t.created_at <> now()
       and to_jsonb(t) - $2 = $3)', tg_table_name)
  into v_found using new.restaurant_id, v_skip, v_row;
  if v_found then
    raise exception using errcode = 'MS006', message = 'repeat_insert';
  end if;
  return new;
end $function$;
revoke all on function public.reject_repeat_insert() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['inkassation_topups', 'bookings', 'news_posts', 'staff_tasks', 'staff_reports',
    'purchase_items', 'employees', 'staff', 'shift_checklists', 'shift_checklist_completions',
    'menu_orders', 'hookah_goals']
  loop
    execute format('drop trigger if exists zz_reject_repeat on public.%I', t);
    -- zz_: после остальных before-триггеров, строка уже в окончательном виде
    execute format('create trigger zz_reject_repeat before insert on public.%I
      for each row execute function public.reject_repeat_insert()', t);
  end loop;
end $$;

-- 2) Продажи кальянов за день заменяются одной транзакцией: раньше delete и insert были двумя
--    запросами (обрыв = день пропал, два устройства = продажи задвоены).
create or replace function public.replace_hookah_sales(p_restaurant_id uuid, p_date date, p_rows jsonb)
 returns void language plpgsql security definer set search_path to 'public' as $function$
begin
  if p_date is null or jsonb_typeof(coalesce(p_rows, '[]'::jsonb)) <> 'array' then raise exception 'invalid sales'; end if;
  perform pg_advisory_xact_lock(hashtext('hookah:' || p_restaurant_id::text || p_date::text));
  delete from hookah_sales where restaurant_id = p_restaurant_id and date = p_date;
  insert into hookah_sales (restaurant_id, date, hookah_type_id, quantity, price, portion_g, is_free, brand, flavor, flavor_id)
  select p_restaurant_id, p_date, r.hookah_type_id, r.quantity, r.price, r.portion_g, coalesce(r.is_free, false),
         r.brand, r.flavor, r.flavor_id
  from jsonb_populate_recordset(null::hookah_sales, coalesce(p_rows, '[]'::jsonb)) r;
end $function$;
revoke all on function public.replace_hookah_sales(uuid, date, jsonb) from public, anon, authenticated;
grant execute on function public.replace_hookah_sales(uuid, date, jsonb) to service_role;
