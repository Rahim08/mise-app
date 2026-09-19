-- Автопроверка целостности денег (2026-09-19). Только чтение: два VIEW, данные не меняются.
-- Применять в Supabase SQL editor (безопасно перезапускать). Использование:
--
--   select * from financial_integrity_issues where restaurant_id = '<id>' order by severity, ref_date;
--   select * from inkassation_balance;                 -- баланс инкассации по заведениям
--
-- Каждая строка — одно расхождение с пояснением. Пусто = всё сходится. Смотреть вместе с
-- financial_audit_view (кто и когда менял запись) из financial-audit-v2-2026-09-19.sql.
--
-- Проверки (check_code):
--   advance_not_deducted          аванс есть в salary_advances, а в списаниях инкассации его тега нет
--   deduction_without_advance     в причине списания есть тег аванса, а самого аванса нет
--   cash_salary_vs_inkassation    сумма выплат ЗП наличными за месяц ≠ inkassations.salary за месяц
--                                 (settle_debts платит из кассы, не из инкассации — такие покажутся, это ок)
--   duplicate_salary_payment      две одинаковые выплаты одному сотруднику за период с разницей < 10 мин
--   shift_inkassation_mismatch    shifts.inkassation ≠ inkassations.amount той же смены
--   shift_inkassation_no_row      у смены есть инкассация, а строки в inkassations нет
--   duplicate_inkassation_rows    больше одной строки inkassations на смену
--   empty_inkassation_row         строка, где все суммы и причина пустые (мёртвая)
--   inkassation_total_stale       total ≠ amount − expense − salary
--   duplicate_open_debt           две одинаковые неоплаченные строки долга (сотрудник + заметка + сумма)
--   inkassation_fund_negative     накопительный баланс инкассации ушёл в минус на какую-то дату

create or replace view inkassation_balance as
select
  coalesce(g.restaurant_id, d.restaurant_id) as restaurant_id,
  coalesce(g.gross, 0) as gross,
  coalesce(d.deducted, 0) as deducted,
  coalesce(g.gross, 0) - coalesce(d.deducted, 0) as balance
from (select restaurant_id, sum(coalesce(inkassation, 0)) as gross from shifts group by restaurant_id) g
full join (select restaurant_id, sum(coalesce(expense, 0) + coalesce(salary, 0)) as deducted from inkassations group by restaurant_id) d
  on d.restaurant_id = g.restaurant_id;

create or replace view financial_integrity_issues as
-- аванс без списания
select a.restaurant_id, 'advance_not_deducted'::text as check_code, 'high'::text as severity,
       a.date as ref_date, a.amount::numeric as amount,
       format('Аванс "%s" (id %s) на %s есть в salary_advances, но в списаниях инкассации его тега нет', a.note, left(a.id::text, 8), a.amount) as detail
from salary_advances a
where not exists (
  select 1 from inkassations i
  where i.restaurant_id = a.restaurant_id and i.reason like '%·' || left(a.id::text, 8) || '%'
)
union all
-- списание с тегом аванса, а аванса нет
select i.restaurant_id, 'deduction_without_advance', 'high', i.date, i.expense::numeric,
       format('В причине списания за %s есть тег аванса ·%s, но самого аванса в salary_advances нет', i.date, m.g[1])
from inkassations i
cross join lateral regexp_matches(coalesce(i.reason, ''), '·([0-9a-f]{8})', 'g') as m(g)
where not exists (
  select 1 from salary_advances a where a.restaurant_id = i.restaurant_id and left(a.id::text, 8) = m.g[1]
)
union all
-- выплаты наличными ↔ списания зарплатой по месяцам
select coalesce(p.restaurant_id, k.restaurant_id), 'cash_salary_vs_inkassation', 'medium',
       coalesce(p.month, k.month), (coalesce(p.paid, 0) - coalesce(k.ded, 0))::numeric,
       format('За месяц: выплат ЗП наличными %s, списано зарплатой в инкассации %s', coalesce(p.paid, 0), coalesce(k.ded, 0))
from (select restaurant_id, date_trunc('month', paid_at)::date as month, sum(amount) as paid
      from salary_payments where coalesce(method, 'cash') = 'cash' group by 1, 2) p
full join (select restaurant_id, date_trunc('month', date)::date as month, sum(coalesce(salary, 0)) as ded
           from inkassations group by 1, 2) k
  on k.restaurant_id = p.restaurant_id and k.month = p.month
where abs(coalesce(p.paid, 0) - coalesce(k.ded, 0)) > 0.01
union all
-- дубль выплаты
select p1.restaurant_id, 'duplicate_salary_payment', 'high', p1.paid_at::date, p1.amount::numeric,
       format('Две одинаковые выплаты %s (период %s) с разницей %s сек — возможное двойное нажатие', p1.amount, p1.period, round(abs(extract(epoch from (p2.created_at - p1.created_at)))))
from salary_payments p1
join salary_payments p2
  on p1.employee_id = p2.employee_id and p1.period = p2.period
 and coalesce(p1.method, 'cash') = coalesce(p2.method, 'cash') and p1.amount = p2.amount
 and p1.id < p2.id and abs(extract(epoch from (p2.created_at - p1.created_at))) < 600
union all
-- инкассация смены ≠ строка инкассации
select s.restaurant_id, 'shift_inkassation_mismatch', 'high', s.date, (coalesce(s.inkassation, 0) - coalesce(i.amount, 0))::numeric,
       format('shifts.inkassation = %s, inkassations.amount = %s', coalesce(s.inkassation, 0), coalesce(i.amount, 0))
from shifts s join inkassations i on i.shift_id = s.id
where coalesce(s.inkassation, 0) <> coalesce(i.amount, 0)
union all
select s.restaurant_id, 'shift_inkassation_no_row', 'medium', s.date, s.inkassation::numeric,
       format('У смены инкассация %s, но строки в inkassations нет', s.inkassation)
from shifts s
where coalesce(s.inkassation, 0) > 0
  and not exists (select 1 from inkassations i where i.shift_id = s.id)
union all
-- несколько строк на смену
select restaurant_id, 'duplicate_inkassation_rows', 'high', min(date), sum(coalesce(expense, 0) + coalesce(salary, 0))::numeric,
       format('На одну смену %s строк inkassations', count(*))
from inkassations where shift_id is not null
group by restaurant_id, shift_id having count(*) > 1
union all
-- мёртвые строки
select restaurant_id, 'empty_inkassation_row', 'low', date, 0::numeric,
       'Строка inkassations без сумм и причины (остаток от отката/пересохранения)'
from inkassations
where coalesce(amount, 0) = 0 and coalesce(expense, 0) = 0 and coalesce(salary, 0) = 0 and coalesce(reason, '') = ''
union all
-- total устарел
select restaurant_id, 'inkassation_total_stale', 'low', date,
       (coalesce(total, 0) - (coalesce(amount, 0) - coalesce(expense, 0) - coalesce(salary, 0)))::numeric,
       format('total = %s, а amount − expense − salary = %s', coalesce(total, 0), coalesce(amount, 0) - coalesce(expense, 0) - coalesce(salary, 0))
from inkassations
where abs(coalesce(total, 0) - (coalesce(amount, 0) - coalesce(expense, 0) - coalesce(salary, 0))) > 0.01
union all
-- дубли неоплаченных долгов
select restaurant_id, 'duplicate_open_debt', 'medium', min(created_at)::date, amount::numeric,
       format('%s одинаковых неоплаченных долгов (%s, %s)', count(*), coalesce(category_name, '?'), coalesce(note, ''))
from shift_expenses
where is_paid = false and note is not null
group by restaurant_id, employee_id, note, amount, category_name having count(*) > 1
union all
-- накопительный баланс инкассации ушёл в минус
select x.restaurant_id, 'inkassation_fund_negative', 'high', x.date, x.bal::numeric,
       format('Баланс инкассации на %s отрицательный: %s', x.date, x.bal)
from (
  select s.restaurant_id, s.date,
         sum(coalesce(s.inkassation, 0) - coalesce(d.ded, 0)) over (partition by s.restaurant_id order by s.date, s.id) as bal
  from shifts s
  left join (select shift_id, sum(coalesce(expense, 0) + coalesce(salary, 0)) as ded from inkassations group by shift_id) d
    on d.shift_id = s.id
) x
where x.bal < -0.01;

revoke all on financial_integrity_issues from public, anon, authenticated;
revoke all on inkassation_balance from public, anon, authenticated;
grant select on financial_integrity_issues to service_role;
grant select on inkassation_balance to service_role;
