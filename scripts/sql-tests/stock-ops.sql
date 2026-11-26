\set ON_ERROR_STOP on
create role anon; create role authenticated; create role service_role;
create table tobacco_stock (id uuid primary key default gen_random_uuid(), restaurant_id uuid, flavor_name text,
  quantity_g numeric default 0, min_quantity_g numeric default 100, updated_at timestamp default now(), brand text, flavor text);
create table tobacco_movements (id uuid primary key default gen_random_uuid(), restaurant_id uuid, flavor_id uuid references tobacco_stock(id),
  type text not null, quantity_g numeric not null, reason text, created_at timestamp default now(), brand text, flavor text, batch_id uuid);
create table tobacco_inventories (id uuid primary key default gen_random_uuid(), restaurant_id uuid, type text not null default 'warehouse',
  items jsonb default '[]', notes text, created_at timestamptz default now(), created_by uuid);
create table hookah_sales (id uuid primary key default gen_random_uuid(), restaurant_id uuid, date date, quantity int, portion_g numeric);
\i docs/migrations/stock-ops-atomic-2026-11-26.sql
\i docs/migrations/stock-ops-atomic-2026-11-26.sql

create function q(f text) returns numeric language sql as $$ select quantity_g from tobacco_stock where flavor = f $$;
create function fails(sql text, code text) returns void language plpgsql as $$
begin execute sql; raise exception 'expected % for %', code, sql;
exception when others then if sqlstate <> code then raise; end if; end $$;
create function mv(p jsonb) returns jsonb language sql as $$
  select stock_save_movement('00000000-0000-0000-0000-0000000000aa', p) $$;
create function ids(b uuid) returns jsonb language sql as $$
  select jsonb_agg(id) from tobacco_movements where batch_id = b $$;

do $$
declare
  rid uuid := '00000000-0000-0000-0000-0000000000aa';
  a uuid := '11111111-0000-0000-0000-000000000001'; b uuid := '11111111-0000-0000-0000-000000000002';
  first jsonb; again jsonb; p jsonb; old jsonb; made timestamp; sid uuid;
begin
  -- приход: новые позиции, повторяющиеся строки складываются, повтор операции ничего не пишет
  p := jsonb_build_object('op_id', a, 'mode', 'in', 'rows', jsonb_build_array(
    jsonb_build_object('brand', 'B', 'flavor', 'X', 'grams', 300), jsonb_build_object('brand', ' b ', 'flavor', 'x', 'grams', 200),
    jsonb_build_object('brand', 'B', 'flavor', 'Y', 'grams', 100)));
  first := mv(p); again := mv(p);
  assert first = again, 'replay result';
  assert q('X') = 500 and q('Y') = 100, 'receipt';
  assert (select count(*) from tobacco_movements) = 2, 'merged rows';
  assert jsonb_array_length(first->'stock') = 2 and jsonb_array_length(first->'movements') = 2, 'result';

  -- нехватка по одной строке отменяет всё
  perform fails(format('select mv(%L)', jsonb_build_object('op_id', gen_random_uuid(), 'mode', 'out', 'rows', jsonb_build_array(
    jsonb_build_object('brand', 'B', 'flavor', 'X', 'grams', 50), jsonb_build_object('brand', 'B', 'flavor', 'Y', 'grams', 101)))), 'MS008');
  assert q('X') = 500 and (select count(*) from tobacco_movements) = 2, 'rollback';
  perform fails(format('select mv(%L)', jsonb_build_object('op_id', gen_random_uuid(), 'mode', 'writeoff', 'reason', ' ',
    'rows', jsonb_build_array(jsonb_build_object('brand', 'B', 'flavor', 'X', 'grams', 1)))), 'P0001');

  perform mv(jsonb_build_object('op_id', b, 'mode', 'out', 'rows', jsonb_build_array(jsonb_build_object('brand', 'B', 'flavor', 'X', 'grams', 400))));
  assert q('X') = 100, 'issue';

  -- правка поставки, часть которой уже выдана: считается разница, дата и партия прежние
  update tobacco_movements set created_at = '2026-01-01 12:00' where batch_id = a;
  old := ids(a);
  p := jsonb_build_object('op_id', gen_random_uuid(), 'mode', 'in', 'replace_ids', old, 'rows', jsonb_build_array(
    jsonb_build_object('brand', 'B', 'flavor', 'X', 'grams', 600), jsonb_build_object('brand', 'B', 'flavor', 'Y', 'grams', 100)));
  perform mv(p); perform mv(p);
  assert q('X') = 200 and q('Y') = 100, 'edit receipt';
  assert (select count(*) from tobacco_movements where batch_id = a and created_at = '2026-01-01 12:00') = 2, 'edit keeps batch and date';
  -- вторая правка по устаревшим строкам и неполная партия отклоняются
  perform fails(format('select mv(%L)', jsonb_build_object('op_id', gen_random_uuid(), 'mode', 'delete', 'replace_ids', old)), 'MS007');
  perform fails(format('select mv(%L)', jsonb_build_object('op_id', gen_random_uuid(), 'mode', 'delete',
    'replace_ids', jsonb_build_array(ids(a)->0))), 'MS007');

  -- правка выдачи: старая возвращается, лимит считается после возврата
  perform mv(jsonb_build_object('op_id', gen_random_uuid(), 'mode', 'out', 'replace_ids', ids(b),
    'rows', jsonb_build_array(jsonb_build_object('brand', 'B', 'flavor', 'X', 'grams', 600))));
  assert q('X') = 0, 'edit issue';

  -- списание с заведения: выдано 600, продано 100, доступно 500
  insert into hookah_sales (restaurant_id, date, quantity, portion_g) values (rid, '2026-01-01', 5, 20);
  perform fails(format('select mv(%L)', jsonb_build_object('op_id', gen_random_uuid(), 'mode', 'venue', 'reason', 'r',
    'rows', jsonb_build_array(jsonb_build_object('grams', 501)))), 'MS009');
  p := mv(jsonb_build_object('op_id', gen_random_uuid(), 'mode', 'venue', 'reason', 'r', 'rows', jsonb_build_array(jsonb_build_object('grams', 500))));
  -- правка того же списания возвращает старое в доступное
  p := mv(jsonb_build_object('op_id', gen_random_uuid(), 'mode', 'venue', 'reason', 'r',
    'replace_ids', jsonb_build_array(p->'movements'->0->'id'), 'rows', jsonb_build_array(jsonb_build_object('grams', 450))));
  assert (select count(*) from tobacco_movements where brand = '') = 1, 'venue edit';

  -- удаление поставки, израсходованной полностью: остаток 0, не в минусе
  perform mv(jsonb_build_object('op_id', gen_random_uuid(), 'mode', 'delete', 'replace_ids', ids(a)));
  assert q('X') = 0 and q('Y') = 0 and (select count(*) from tobacco_movements where batch_id = a) = 0, 'delete';

  -- чужое заведение не может тронуть строки
  perform fails(format('select stock_save_movement(%L, %L)', gen_random_uuid(),
    jsonb_build_object('op_id', gen_random_uuid(), 'mode', 'delete', 'replace_ids', ids(b))), 'MS007');

  -- инвентаризация
  select id into sid from tobacco_stock where flavor = 'X';
  perform fails(format('select stock_save_inventory(%L, %L)', rid, jsonb_build_object('op_id', gen_random_uuid(),
    'rows', jsonb_build_array(jsonb_build_object('stock_id', sid, 'expected_g', 5, 'actual_g', 70)))), 'MS007');
  p := jsonb_build_object('op_id', gen_random_uuid(), 'rows', jsonb_build_array(
    jsonb_build_object('stock_id', sid, 'expected_g', 0, 'actual_g', 70.5)));
  perform stock_save_inventory(rid, p); perform stock_save_inventory(rid, p);
  assert q('X') = 70.5 and (select count(*) from tobacco_inventories) = 1
    and (select count(*) from tobacco_movements where type = 'inventory') = 1, 'inventory';
end $$;
