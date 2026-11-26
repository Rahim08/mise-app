-- Склад одной операцией (приход, выдача, списание, правка, удаление, инвентаризация), 2026-11-26.
-- Только добавляет: старые клиенты продолжают писать напрямую.
--
-- Раньше одно сохранение = вставка движений, удаление старых, новые позиции и N правок остатка
-- отдельными запросами: обрыв посередине оставлял половину, повтор задваивал. Теперь одна
-- транзакция под блокировкой заведения, повтор с тем же op_id возвращает прежний результат.
-- Коды ошибок: MS007 данные изменились, MS008 не хватает на складе, MS009 не хватает в заведении.

create table if not exists public.stock_ops (
  op_id uuid primary key,
  restaurant_id uuid not null,
  result jsonb,
  created_at timestamptz not null default now()
);
alter table public.stock_ops enable row level security;
revoke all on public.stock_ops from public, anon, authenticated;
grant select, insert, update on public.stock_ops to service_role;

-- p = { op_id, mode: in|out|writeoff|venue|delete, rows: [{brand, flavor, grams}], reason,
--       replace_ids: [id движений, которые эта операция заменяет или удаляет] }
create or replace function public.stock_save_movement(p_restaurant_id uuid, p jsonb)
 returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_op uuid := (p->>'op_id')::uuid;
  v_mode text := p->>'mode';
  v_reason text := btrim(coalesce(p->>'reason', ''));
  v_ids uuid[] := array(select distinct x::uuid from jsonb_array_elements_text(coalesce(p->'replace_ids', '[]'::jsonb)) x);
  v_deltas jsonb := '{}';  -- id позиции склада -> изменение остатка
  v_taken uuid[] := '{}';  -- позиции, из которых новая выдача/списание берёт граммы
  v_new jsonb := '[]';
  v_inserted jsonb := '[]';
  v_stock jsonb;
  v_result jsonb;
  v_batch uuid;
  v_created timestamp;
  v_id uuid; v_brand text; v_flavor text; v_qty numeric; v_avail numeric;
  r record; m record;
begin
  if v_op is null then raise exception 'op_id required'; end if;
  perform pg_advisory_xact_lock(hashtext('stock:' || p_restaurant_id::text));
  select result into v_result from stock_ops where op_id = v_op and restaurant_id = p_restaurant_id;
  if found then return v_result; end if;
  insert into stock_ops (op_id, restaurant_id) values (v_op, p_restaurant_id);

  if v_mode is null or v_mode not in ('in', 'out', 'writeoff', 'venue', 'delete') then raise exception 'invalid mode'; end if;
  if v_mode = 'delete' and cardinality(v_ids) = 0 then raise exception 'nothing to delete'; end if;
  if v_mode in ('writeoff', 'venue') and v_reason = '' then raise exception 'reason required'; end if;

  -- Старые строки: все на месте, и в их партиях не появилось ничего, чего клиент не видел.
  if cardinality(v_ids) > 0 then
    if (select count(*) from tobacco_movements where restaurant_id = p_restaurant_id and id = any(v_ids)
          and type in ('in', 'out', 'writeoff')) <> cardinality(v_ids)
       or exists (select 1 from tobacco_movements t where t.restaurant_id = p_restaurant_id and not t.id = any(v_ids)
          and t.batch_id in (select batch_id from tobacco_movements where id = any(v_ids) and batch_id is not null))
    then raise exception using errcode = 'MS007', message = 'stock_changed'; end if;
    select (array_agg(batch_id order by created_at) filter (where batch_id is not null))[1], min(created_at)
      into v_batch, v_created from tobacco_movements where id = any(v_ids);
    for m in select * from tobacco_movements where id = any(v_ids) and coalesce(brand, '') <> '' and coalesce(flavor, '') <> '' loop
      select id into v_id from tobacco_stock s where s.restaurant_id = p_restaurant_id
        and lower(btrim(s.brand)) = lower(btrim(m.brand)) and lower(btrim(s.flavor)) = lower(btrim(m.flavor))
        order by (s.brand = m.brand and s.flavor = m.flavor) desc, s.quantity_g desc, s.id limit 1;
      if v_id is not null then
        v_deltas := jsonb_set(v_deltas, array[v_id::text], to_jsonb(coalesce((v_deltas->>v_id::text)::numeric, 0)
          + case when m.type = 'in' then -m.quantity_g else m.quantity_g end));
      end if;
    end loop;
  end if;
  v_batch := coalesce(v_batch, v_op);

  if v_mode in ('in', 'out', 'writeoff') then
    if jsonb_typeof(p->'rows') is distinct from 'array' or jsonb_array_length(p->'rows') = 0 then raise exception 'rows required'; end if;
    if exists (select 1 from jsonb_array_elements(p->'rows') e where btrim(coalesce(e->>'brand', '')) = ''
         or btrim(coalesce(e->>'flavor', '')) = '' or not coalesce((e->>'grams')::numeric > 0 and (e->>'grams')::numeric <= 10000000, false))
    then raise exception 'invalid row'; end if;
    -- повторяющиеся бренд/вкус складываются
    for r in
      select (array_agg(btrim(e->>'brand') order by n))[1] brand, (array_agg(btrim(e->>'flavor') order by n))[1] flavor,
             sum((e->>'grams')::numeric) grams
      from jsonb_array_elements(p->'rows') with ordinality x(e, n)
      group by lower(btrim(e->>'brand')), lower(btrim(e->>'flavor')) order by min(n)
    loop
      v_id := null;
      select id, brand, flavor into v_id, v_brand, v_flavor from tobacco_stock s where s.restaurant_id = p_restaurant_id
        and lower(btrim(s.brand)) = lower(r.brand) and lower(btrim(s.flavor)) = lower(r.flavor)
        order by (s.brand = r.brand and s.flavor = r.flavor) desc, s.quantity_g desc, s.id limit 1;
      if v_id is null then
        if v_mode <> 'in' then raise exception using errcode = 'MS008', message = 'insufficient_stock'; end if;
        v_brand := r.brand; v_flavor := r.flavor;
        insert into tobacco_stock (restaurant_id, brand, flavor, flavor_name, quantity_g, updated_at)
          values (p_restaurant_id, r.brand, r.flavor, r.flavor, 0, now()) returning id into v_id;
      end if;
      if v_mode <> 'in' then v_taken := v_taken || v_id; end if;
      v_deltas := jsonb_set(v_deltas, array[v_id::text], to_jsonb(coalesce((v_deltas->>v_id::text)::numeric, 0)
        + case when v_mode = 'in' then r.grams else -r.grams end));
      v_new := v_new || jsonb_build_object('stock_id', v_id, 'brand', v_brand, 'flavor', v_flavor, 'grams', r.grams);
    end loop;
  end if;

  -- Остаток считается по сумме «откат старого + новое»; в минус уйти может только откат
  -- уже израсходованной поставки (как и раньше, остаток тогда 0).
  for r in select key::uuid id, value::numeric delta from jsonb_each_text(v_deltas) order by key loop
    select quantity_g into v_qty from tobacco_stock where id = r.id for update;
    v_qty := coalesce(v_qty, 0) + r.delta;
    if r.id = any(v_taken) and round(v_qty, 2) < 0 then
      raise exception using errcode = 'MS008', message = 'insufficient_stock';
    end if;
    update tobacco_stock set quantity_g = greatest(0, v_qty), updated_at = now() where id = r.id;
  end loop;

  delete from tobacco_movements where restaurant_id = p_restaurant_id and id = any(v_ids);

  if v_mode = 'venue' then
    v_qty := (p->'rows'->0->>'grams')::numeric;
    if not coalesce(v_qty > 0, false) then raise exception 'invalid row'; end if;
    select coalesce((select sum(quantity_g) from tobacco_movements where restaurant_id = p_restaurant_id and type = 'out'), 0)
         - coalesce((select sum(quantity * coalesce(portion_g, 0)) from hookah_sales where restaurant_id = p_restaurant_id), 0)
         - coalesce((select sum(quantity_g) from tobacco_movements where restaurant_id = p_restaurant_id and type = 'writeoff'
             and coalesce(brand, '') = '' and coalesce(flavor, '') = ''), 0)
      into v_avail;
    if round(v_qty, 2) > round(greatest(0, v_avail), 2) then raise exception using errcode = 'MS009', message = 'insufficient_venue'; end if;
    v_new := jsonb_build_array(jsonb_build_object('stock_id', null, 'brand', '', 'flavor', '', 'grams', v_qty));
  end if;

  with ins as (
    insert into tobacco_movements (restaurant_id, flavor_id, type, quantity_g, reason, created_at, brand, flavor, batch_id)
    select p_restaurant_id, (e->>'stock_id')::uuid, case when v_mode = 'venue' then 'writeoff' else v_mode end,
      (e->>'grams')::numeric,
      coalesce(nullif(v_reason, ''), case v_mode when 'in' then 'Поставка' when 'out' then 'Выдача в зал' else 'Списание' end),
      coalesce(v_created, now()::timestamp), e->>'brand', e->>'flavor', v_batch
    from jsonb_array_elements(v_new) e
    returning *)
  select coalesce(jsonb_agg(to_jsonb(ins)), '[]'::jsonb) into v_inserted from ins;

  select coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb) into v_stock from tobacco_stock s
    where s.restaurant_id = p_restaurant_id and v_deltas ? s.id::text;
  v_result := jsonb_build_object('stock', v_stock, 'movements', v_inserted);
  update stock_ops set result = v_result where op_id = v_op;
  return v_result;
end $function$;

-- p = { op_id, rows: [{stock_id, expected_g, actual_g}] }
create or replace function public.stock_save_inventory(p_restaurant_id uuid, p jsonb)
 returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_op uuid := (p->>'op_id')::uuid;
  v_items jsonb := '[]';
  v_inserted jsonb := '[]';
  v_stock jsonb := '[]';
  v_result jsonb;
  v_row tobacco_stock%rowtype;
  v_mov tobacco_movements%rowtype;
  v_expected numeric; v_actual numeric;
  e jsonb;
begin
  if v_op is null then raise exception 'op_id required'; end if;
  perform pg_advisory_xact_lock(hashtext('stock:' || p_restaurant_id::text));
  select result into v_result from stock_ops where op_id = v_op and restaurant_id = p_restaurant_id;
  if found then return v_result; end if;
  insert into stock_ops (op_id, restaurant_id) values (v_op, p_restaurant_id);
  if jsonb_typeof(p->'rows') is distinct from 'array' or jsonb_array_length(p->'rows') = 0 then raise exception 'rows required'; end if;
  if (select count(distinct x->>'stock_id') from jsonb_array_elements(p->'rows') x) <> jsonb_array_length(p->'rows')
  then raise exception 'duplicate row'; end if;

  for e in select * from jsonb_array_elements(p->'rows') loop
    v_expected := (e->>'expected_g')::numeric; v_actual := (e->>'actual_g')::numeric;
    if v_expected is null or not coalesce(v_actual >= 0 and v_actual <= 10000000, false) then raise exception 'invalid row'; end if;
    select * into v_row from tobacco_stock where id = (e->>'stock_id')::uuid and restaurant_id = p_restaurant_id for update;
    -- остаток двигали, пока считали: иначе факт затёр бы чужую выдачу
    if not found or round(v_row.quantity_g, 2) <> round(v_expected, 2) then
      raise exception using errcode = 'MS007', message = 'stock_changed';
    end if;
    v_items := v_items || jsonb_build_object('brand', v_row.brand, 'flavor', v_row.flavor,
      'expected_g', v_expected, 'actual_g', v_actual, 'diff_g', v_actual - v_expected);
    insert into tobacco_movements (restaurant_id, flavor_id, type, quantity_g, reason, brand, flavor, batch_id)
      values (p_restaurant_id, v_row.id, 'inventory', abs(v_actual - v_expected),
        format('Инвентаризация: было %s г, стало %s г', round(v_expected), round(v_actual)), v_row.brand, v_row.flavor, v_op)
      returning * into v_mov;
    update tobacco_stock set quantity_g = v_actual, updated_at = now() where id = v_row.id returning * into v_row;
    v_inserted := v_inserted || to_jsonb(v_mov);
    v_stock := v_stock || to_jsonb(v_row);
  end loop;

  insert into tobacco_inventories (restaurant_id, type, items) values (p_restaurant_id, 'warehouse', v_items);
  v_result := jsonb_build_object('stock', v_stock, 'movements', v_inserted);
  update stock_ops set result = v_result where op_id = v_op;
  return v_result;
end $function$;

revoke all on function public.stock_save_movement(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.stock_save_inventory(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.stock_save_movement(uuid, jsonb) to service_role;
grant execute on function public.stock_save_inventory(uuid, jsonb) to service_role;
