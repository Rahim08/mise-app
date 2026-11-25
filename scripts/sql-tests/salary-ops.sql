\set ON_ERROR_STOP on
set client_min_messages=warning;
\set QUIET on
create role anon; create role authenticated; create role service_role;
create table employees(id uuid primary key, restaurant_id uuid, name text, salary numeric, deduct_per_absence numeric);
create table salary_history(restaurant_id uuid, employee_id uuid, salary numeric, deduct_per_absence numeric, effective_from date);
create table monthly_card_amounts(restaurant_id uuid, employee_id uuid, month text, card_amount numeric);
create table salary_advances(id uuid primary key default gen_random_uuid(), restaurant_id uuid, employee_id uuid, amount numeric, date date, period date, note text, created_at timestamptz default now());
create table salary_payments(id uuid primary key default gen_random_uuid(), restaurant_id uuid, employee_id uuid, period date, amount numeric, method text, paid_at timestamptz, note text, created_by text, created_at timestamptz default now());
create table shift_absences(restaurant_id uuid, employee_id uuid, date date, source text);
create table shifts(id uuid primary key default gen_random_uuid(), restaurant_id uuid, date date, opened_at timestamp default now(), opening_balance numeric, income numeric, total_expense numeric, inkassation numeric, closing_balance numeric, status text, unique(restaurant_id,date));
create table shift_expenses(id uuid primary key default gen_random_uuid(), shift_id uuid, restaurant_id uuid, employee_id uuid, category_name text, amount numeric, is_paid boolean, note text);
create table inkassations(id uuid primary key default gen_random_uuid(), restaurant_id uuid, date date, amount numeric not null, expense numeric default 0, reason text, total numeric, salary numeric not null default 0, salary_note text, shift_id uuid);
create unique index uniq_inkassations_shift on inkassations(shift_id) where shift_id is not null;
create view inkassation_balance as select s.restaurant_id, coalesce(sum(s.inkassation),0) - coalesce((select sum(expense+salary) from inkassations i where i.restaurant_id=s.restaurant_id),0) balance from shifts s group by s.restaurant_id;
\i docs/migrations/salary-ops-atomic-2026-11-25.sql
\i docs/migrations/salary-ops-atomic-2026-11-25.sql
\set R '''00000000-0000-0000-0000-0000000000aa'''
\set E '''00000000-0000-0000-0000-0000000000e1'''
-- 1000 - 1 прогул*50 - карта 200 = 750; авто-прогул не считается
insert into employees values (:E,:R,'Анна',2000,0);
insert into salary_history values (:R,:E,1000,50,'2026-01-01');
insert into shift_absences values (:R,:E,'2026-10-03','manager'),(:R,:E,'2026-10-04','auto');
insert into monthly_card_amounts values (:R,:E,'2026-10',200);
insert into shifts(restaurant_id,date,opening_balance,income,inkassation,closing_balance) values (:R,'2026-10-31',10,0,700,10);
create function must_fail(q text, code text) returns void language plpgsql as $$
begin execute q; raise exception 'no failure: %', q;
exception when others then if sqlstate <> code then raise; end if; end $$;
create function p(op int, extra jsonb) returns jsonb language sql as $$
 select jsonb_build_object('op_id',('00000000-0000-0000-0000-'||lpad(op::text,12,'0'))::uuid,'employee_id','00000000-0000-0000-0000-0000000000e1','period','2026-10-01','date','2026-11-05','method','cash') || extra $$;
do $$ begin assert salary_remaining('00000000-0000-0000-0000-0000000000aa','00000000-0000-0000-0000-0000000000e1','2026-10-01')=750; end $$;
-- advance: creates shift, repeat is a no-op
select add_advance(:R, p(1,'{"amount":100,"tag":"Анна аванс €100·x1","note":"Анна аванс"}')) is not null \g /dev/null
select add_advance(:R, p(1,'{"amount":100,"tag":"Анна аванс €100·x1"}')) is not null \g /dev/null
do $$ begin
 assert (select count(*) from salary_advances)=1 and (select expense from inkassations)=100;
 assert (select opening_balance from shifts where date='2026-11-05')=10;
end $$;
-- payment: appended to the same day row; replay no-op; same payment with new op = duplicate
select pay_salary(:R, p(2,'{"amount":300.1,"entry":"Анна: €300"}'));
select pay_salary(:R, p(2,'{"amount":300.1,"entry":"Анна: €300"}'));
select must_fail($q$select pay_salary('00000000-0000-0000-0000-0000000000aa', p(3,'{"amount":300.1}'))$q$,'MS005');
do $$ begin
 assert (select count(*) from salary_payments)=1;
 assert (select count(*) from inkassations)=1 and (select salary from inkassations)=300.1 and (select total from inkassations)=-400.1;
 assert money_pool('00000000-0000-0000-0000-0000000000aa')=299.9;
end $$;
-- more than remaining (349.9) and more than pool
select must_fail($q$select pay_salary('00000000-0000-0000-0000-0000000000aa', p(4,'{"amount":349.91}'))$q$,'MS003');
select must_fail($q$select pay_salary('00000000-0000-0000-0000-0000000000aa', p(5,'{"amount":349.9}'))$q$,'MS004');
-- failed operation leaves nothing and its op_id stays usable
do $$ begin assert (select count(*) from money_ops)=2 and (select count(*) from salary_payments)=1; end $$;
-- debt: one open row, adds up, counts against remaining
select add_salary_debt(:R, p(6,'{"amount":100,"title":"ЗП"}'));
select add_salary_debt(:R, p(7,'{"amount":50,"title":"ЗП"}'));
select add_salary_debt(:R, p(7,'{"amount":50,"title":"ЗП"}'));
select must_fail($q$select add_salary_debt('00000000-0000-0000-0000-0000000000aa', p(8,'{"amount":200}'))$q$,'MS003');
do $$ begin assert (select count(*) from shift_expenses)=1 and (select amount from shift_expenses)=150; end $$;
-- card does not touch the cash pool
select pay_salary(:R, p(9,'{"amount":5,"method":"card"}'));
do $$ begin assert money_pool('00000000-0000-0000-0000-0000000000aa')=299.9; end $$;
-- delete advance once, however many times it is pressed
select delete_advance(:R, p(10,'{"advance_id":"00000000-0000-0000-0000-000000000001","tag":"Анна аванс €100·x1","prefix":"Анна аванс"}'));
select delete_advance(:R, p(11,'{"advance_id":"00000000-0000-0000-0000-000000000001","tag":"Анна аванс €100·x1","prefix":"Анна аванс"}'));
do $$ begin assert (select count(*) from salary_advances)=0 and (select expense from inkassations)=0 and (select reason from inkassations)=''; end $$;
select must_fail($q$select pay_salary('00000000-0000-0000-0000-0000000000bb', p(12,'{"amount":1}'))$q$,'P0001');
-- race setup: remaining 449.9 - 5 card irrelevant; two devices pay 300 each
update shifts set inkassation=5000 where date='2026-10-31';
