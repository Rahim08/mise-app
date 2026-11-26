\set ON_ERROR_STOP on
set client_min_messages=warning;
\set QUIET on
create role anon; create role authenticated; create role service_role;
do $$ declare t text; begin
  foreach t in array array['inkassation_topups','bookings','news_posts','staff_tasks','staff_reports','purchase_items','employees','staff','shift_checklists','shift_checklist_completions','menu_orders','hookah_goals'] loop
    execute format('create table %I(id uuid primary key default gen_random_uuid(), restaurant_id uuid, title text, amount numeric, pin_hash text, created_at timestamptz default now())', t);
  end loop; end $$;
alter table employees alter created_at type timestamp;
create table hookah_sales(id uuid primary key default gen_random_uuid(), restaurant_id uuid, shift_id uuid, flavor_id uuid, quantity int, price numeric, created_at timestamptz default now(), date date, brand text, flavor text, is_free boolean default false, hookah_type_id uuid, portion_g numeric);
\i docs/migrations/repeat-guards-2026-11-25.sql
\i docs/migrations/repeat-guards-2026-11-25.sql
\set R '''00000000-0000-0000-0000-0000000000aa'''
create function must_fail(q text, code text) returns void language plpgsql as $$
begin execute q; raise exception 'no failure: %', q;
exception when others then if sqlstate <> code then raise; end if; end $$;
insert into inkassation_topups(restaurant_id,title,amount) values (:R,'a',10);
select must_fail($q$insert into inkassation_topups(restaurant_id,title,amount) values ('00000000-0000-0000-0000-0000000000aa','a',10)$q$,'MS006');
insert into inkassation_topups(restaurant_id,title,amount) values (:R,'a',11);
insert into inkassation_topups(restaurant_id,title,amount) values ('00000000-0000-0000-0000-0000000000bb','a',10);
-- identical rows inside one batch are allowed
insert into purchase_items(restaurant_id,title) values (:R,'milk'),(:R,'milk');
-- timestamp without time zone + different PIN salt
insert into employees(restaurant_id,title) values (:R,'Анна');
select must_fail($q$insert into employees(restaurant_id,title) values ('00000000-0000-0000-0000-0000000000aa','Анна')$q$,'MS006');
insert into staff(restaurant_id,title,pin_hash) values (:R,'Анна','x');
select must_fail($q$insert into staff(restaurant_id,title,pin_hash) values ('00000000-0000-0000-0000-0000000000aa','Анна','y')$q$,'MS006');
-- after the window the same record is fine
update inkassation_topups set created_at = now() - interval '31 seconds';
insert into inkassation_topups(restaurant_id,title,amount) values (:R,'a',10);
-- hookah: replace, repeat, atomic failure
select replace_hookah_sales(:R,'2026-11-01','[{"hookah_type_id":"00000000-0000-0000-0000-000000000001","quantity":3,"price":10,"portion_g":20}]');
select replace_hookah_sales(:R,'2026-11-01','[{"hookah_type_id":"00000000-0000-0000-0000-000000000001","quantity":4,"price":10,"portion_g":20}]');
select must_fail($q$select replace_hookah_sales('00000000-0000-0000-0000-0000000000aa','2026-11-01','[{"quantity":"x"}]')$q$,'22P02');
do $$ begin assert (select count(*) from hookah_sales)=1 and (select quantity from hookah_sales)=4 and (select is_free from hookah_sales)=false; end $$;
