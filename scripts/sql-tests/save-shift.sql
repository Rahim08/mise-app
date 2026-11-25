\set ON_ERROR_STOP on
set client_min_messages=warning;
\set QUIET on
create role anon; create role authenticated; create role service_role;
create table restaurants(id uuid primary key);
create table expense_categories(id uuid primary key, restaurant_id uuid, name text);
create table employees(id uuid primary key, restaurant_id uuid, name text);
create table shifts(id uuid primary key default gen_random_uuid(), restaurant_id uuid, date date, opened_at timestamp default now(), opening_balance numeric, income numeric, income_card numeric not null default 0, total_expense numeric, inkassation numeric, closing_balance numeric);
create table shift_expenses(id uuid primary key default gen_random_uuid(), shift_id uuid, restaurant_id uuid, category_id uuid, category_name text, amount numeric not null, note text, created_at timestamptz default clock_timestamp(), employee_id uuid, is_paid boolean not null default true, paid_at date, paid_shift_id uuid);
create table inkassations(id uuid primary key default gen_random_uuid(), restaurant_id uuid, date date, amount numeric not null, expense numeric default 0, reason text, total numeric, salary numeric not null default 0, shift_id uuid);
create unique index uniq_inkassations_shift on inkassations(shift_id) where shift_id is not null;
create table shift_absences(id uuid primary key default gen_random_uuid(), shift_id uuid, restaurant_id uuid, employee_id uuid, date date, source text);
create table salary_payments(restaurant_id uuid, employee_id uuid, period date, amount numeric, method text, paid_at timestamptz, note text, created_by text);
\i docs/migrations/custom-shift-expenses-2026-11-13.sql
\i docs/migrations/shift-money-fixes-2026-11-25.sql
\i docs/migrations/shift-save-atomic-2026-11-25.sql
\i docs/migrations/shift-save-atomic-2026-11-25.sql
insert into restaurants values ('00000000-0000-0000-0000-0000000000aa');
insert into expense_categories values ('00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000aa','Магазин'),('00000000-0000-0000-0000-0000000000c9','00000000-0000-0000-0000-0000000000bb','Чужая');
insert into employees values ('00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000aa','Анна');
insert into shifts(id,restaurant_id,date,opening_balance,income,total_expense,inkassation,closing_balance) values
 ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000aa','2026-10-25',0,100,0,0,100),
 ('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-0000000000aa','2026-10-26',100,0,0,0,100),
 ('00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-0000000000aa','2026-10-27',100,0,0,0,100);
insert into shift_expenses(id,shift_id,restaurant_id,category_id,category_name,amount,is_paid) values
 ('00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000aa','00000000-0000-0000-0000-0000000000c1','Магазин',7,false);
insert into shift_absences(restaurant_id,employee_id,date,source) values ('00000000-0000-0000-0000-0000000000aa','00000000-0000-0000-0000-0000000000e1','2026-10-26','auto');

create function snap(s uuid) returns jsonb language sql as $$ select coalesce(jsonb_agg(to_jsonb(e)),'[]') from shift_expenses e where shift_id=s $$;
create function owned(s uuid) returns jsonb language sql as $$ select coalesce(jsonb_agg(id),'[]') from shift_expenses where shift_id=s and paid_shift_id is null $$;
create function save(s uuid, patch jsonb) returns jsonb language sql as $$
 select save_shift('00000000-0000-0000-0000-0000000000aa', s, jsonb_build_object('op_id',gen_random_uuid(),
  'expected', (select jsonb_build_object('income',income,'income_card',income_card,'inkassation',inkassation) from shifts where id=s),
  'income',200,'income_card',0,'inkassation',50,'seen',snap(s),'replace_ids',owned(s),
  'rows','[{"category_id":"00000000-0000-0000-0000-0000000000c1","amount":25},{"employee_id":"00000000-0000-0000-0000-0000000000e1","amount":10}]'::jsonb,
  'custom','[{"id":"00000000-0000-0000-0000-0000000000f1","name":"Такси","amount":5}]'::jsonb) || patch) $$;
create function must_fail(q text, code text) returns void language plpgsql as $$
begin execute q; raise exception 'no failure: %', q;
exception when others then if sqlstate <> code then raise; end if; end $$;
create function state() returns text language sql as $$ select md5(coalesce((select string_agg(e::text,',' order by id) from shift_expenses e),'')||coalesce((select string_agg(s::text,',' order by id) from shifts s),'')||coalesce((select string_agg(i::text,',' order by id) from inkassations i),'')) $$;

\set S '''00000000-0000-0000-0000-000000000002'''
-- first save: totals from rows
create table first as select jsonb_build_object('op_id',gen_random_uuid(),'expected','{"income":0,"income_card":0,"inkassation":0}'::jsonb,'income',200,'inkassation',50,
 'rows','[{"category_id":"00000000-0000-0000-0000-0000000000c1","amount":25},{"employee_id":"00000000-0000-0000-0000-0000000000e1","amount":10}]'::jsonb,
 'custom','[{"id":"00000000-0000-0000-0000-0000000000f1","name":"Такси","amount":5}]'::jsonb) p;
do $$ declare r jsonb; begin
 r := save_shift('00000000-0000-0000-0000-0000000000aa','00000000-0000-0000-0000-000000000002',(select p from first));
 assert (r->>'total_expense')::numeric=90 and (r->>'closing_balance')::numeric=210, r::text;
 assert (select count(*) from shift_expenses where shift_id='00000000-0000-0000-0000-000000000002')=3;
 assert (select closing_balance from shifts where date='2026-10-27')=210, 'cascade';
 assert (select total from inkassations)=50;
 assert (select source from shift_absences)='manager';
end $$;
-- same op repeated: no-op
create table before as select state() h;
select save_shift('00000000-0000-0000-0000-0000000000aa',:S,p) is not null from first \g /dev/null
do $$ begin assert state()=(select h from before), 'replay changed data'; end $$;
-- 26.10 scenario: second save from the same stale form with a new op -> rejected, nothing changes
select must_fail($q$select save_shift('00000000-0000-0000-0000-0000000000aa','00000000-0000-0000-0000-000000000002',(select p||jsonb_build_object('op_id',gen_random_uuid()) from first))$q$,'MS001');
-- even if it claims current sums, unseen rows reject it
select must_fail($q$select save('00000000-0000-0000-0000-000000000002','{"seen":[],"replace_ids":[]}')$q$,'MS001');
do $$ begin assert state()=(select h from before), 'stale changed data'; end $$;
-- resave unchanged: ids kept, no duplicates
create table ids as select array_agg(id order by id) a from shift_expenses where shift_id=:S;
select save(:S,'{}') is not null \g /dev/null
do $$ begin assert (select array_agg(id order by id) from shift_expenses where shift_id='00000000-0000-0000-0000-000000000002')=(select a from ids), 'ids changed'; end $$;
-- atomic: foreign category aborts everything
update before set h=state();
select must_fail($q$select save('00000000-0000-0000-0000-000000000002','{"income":999,"rows":[{"category_id":"00000000-0000-0000-0000-0000000000c9","amount":1}]}')$q$,'P0001');
do $$ begin assert state()=(select h from before), 'partial write'; end $$;
-- edit + remove custom and rows; advance written meanwhile is preserved
update inkassations set expense=20;
select save(:S,'{"custom":[],"rows":[{"category_id":"00000000-0000-0000-0000-0000000000c1","amount":30}],"ink_expense_delta":3,"ink_reason":"x"}') is not null \g /dev/null
do $$ begin
 assert (select count(*) from shift_expenses where shift_id='00000000-0000-0000-0000-000000000002')=1;
 assert (select total_expense from shifts where date='2026-10-26')=80;
 assert (select expense from inkassations)=23 and (select total from inkassations)=27;
end $$;
-- debt from earlier shift settled once; resave keeps it counted once
select save(:S,'{"debts":[{"id":"00000000-0000-0000-0000-0000000000d1","amount":7}],"rows":[]}') is not null \g /dev/null
select save(:S,'{"rows":[],"custom":[]}') is not null \g /dev/null
do $$ begin
 assert (select total_expense from shifts where date='2026-10-26')=57, (select total_expense::text from shifts where date='2026-10-26');
 assert (select count(*) from shift_expenses where paid_shift_id='00000000-0000-0000-0000-000000000002')=2;
end $$;
-- iOS float tails: cents compare, both in save_shift and settle_debts
insert into shift_expenses(id,shift_id,restaurant_id,amount,is_paid) values ('00000000-0000-0000-0000-0000000000d7','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000aa',1.1,false);
select settle_debts('00000000-0000-0000-0000-0000000000aa','00000000-0000-0000-0000-000000000002','2026-10-26','[{"id":"00000000-0000-0000-0000-0000000000d7","amount":1.1000000000000001}]') \g /dev/null
select save(:S,'{"rows":[{"category_id":"00000000-0000-0000-0000-0000000000c1","amount":7.4000000000000004}]}') is not null \g /dev/null
select save(:S,jsonb_build_object('rows','[]'::jsonb,'seen',(select jsonb_agg(to_jsonb(e)||jsonb_build_object('amount',e.amount+0.0000000000000004)) from shift_expenses e where shift_id=:S))) is not null \g /dev/null
-- debt already paid elsewhere
select must_fail($q$select save('00000000-0000-0000-0000-000000000003','{"debts":[{"id":"00000000-0000-0000-0000-0000000000d1","amount":7}]}')$q$,'MS002');
-- foreign restaurant cannot touch the shift
select must_fail($q$select save_shift('00000000-0000-0000-0000-0000000000bb','00000000-0000-0000-0000-000000000002','{"op_id":"00000000-0000-0000-0000-000000000099"}')$q$,'MS001');
create table race as select jsonb_build_object('expected','{"income":0,"income_card":0,"inkassation":0}'::jsonb,'income',1,
 'rows','[{"category_id":"00000000-0000-0000-0000-0000000000c1","amount":25}]'::jsonb) p;
update shifts set income=0,income_card=0,inkassation=0 where date='2026-10-27';
select 'ALL PASS';
