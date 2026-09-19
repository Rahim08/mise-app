-- Точечные исправления данных SO (2026-09-19). Каждый блок независим: смотри комментарий,
-- запускай только нужные. Перед запуском ПОСЛЕДОВАТЕЛЬНО выполни SELECT из блока, чтобы увидеть,
-- что именно изменится. Порядок: сначала выложить веб-код (git push) и собрать iOS, потом эти
-- блоки — иначе старая сборка iOS может удалить восстановленную строку при пересохранении смены.
-- Все правки попадут в financial_audit_log (нужен financial-audit-v2-2026-09-19.sql).

-- ═══ 1. Владимир: вернуть удалённое списание €1100 (смена 15.08) ══════════════════════════
-- Строку удалило сохранение смены 14.09 22:22 UTC (баг, исправлен в коде). Копия из журнала.
-- Проверка: select old_data from financial_audit_log
--   where table_name='inkassations' and operation='DELETE' and changed_at='2026-09-14 22:22:28.922247+00';
insert into inkassations
select * from jsonb_populate_record(null::inkassations,
  (select old_data from financial_audit_log
   where table_name = 'inkassations' and operation = 'DELETE'
     and changed_at = '2026-09-14 22:22:28.922247+00'))
on conflict (id) do nothing;
-- После: баланс инкассации SO уменьшится на 1100 (6230 → 5130).

-- ═══ 2. Ера: списать аванс €100 от 31.07 (не попал в инкассацию) ══════════════════════════
-- Аванс внесён 11.08 (до фикса 16.08, когда ошибка записи в инкассацию терялась молча).
-- ВНИМАНИЕ: делай, только если 100 евро реально выданы из инкассации (уточнить у менеджера).
-- Проверка: select * from inkassations where date='2026-07-31' and restaurant_id=(select id from restaurants where name='SO');
update inkassations
set expense = coalesce(expense, 0) + 100,
    reason  = concat_ws(', ', nullif(reason, ''), 'Ера аванс €100·bc2887d8'),
    total   = coalesce(amount, 0) - (coalesce(expense, 0) + 100) - coalesce(salary, 0)
where restaurant_id = (select id from restaurants where name = 'SO')
  and date = '2026-07-31'
  and coalesce(expense, 0) = 0
  and coalesce(reason, '') not like '%bc2887d8%';
-- После: баланс инкассации SO уменьшится ещё на 100.

-- ═══ 3. Артемий: убрать дубль выплаты €1530 за август (двойное нажатие 14.09) ═════════════
-- В инкассации списано один раз (правильно), а в salary_payments две записи — в People он
-- числится оплаченным на 3060. Удаляем позднюю из двух. Баланс инкассации не меняется.
-- Проверка (должно быть 2 строки):
--   select id, amount, created_at from salary_payments
--   where employee_id in (select id from employees where name='Артемий' and restaurant_id=(select id from restaurants where name='SO'))
--     and period='2026-08-01' and amount=1530 order by created_at;
delete from salary_payments
where id = (
  select id from salary_payments
  where employee_id in (select id from employees where name = 'Артемий'
                        and restaurant_id = (select id from restaurants where name = 'SO'))
    and period = '2026-08-01' and amount = 1530
  order by created_at desc limit 1
)
and (select count(*) from salary_payments
     where employee_id in (select id from employees where name = 'Артемий'
                           and restaurant_id = (select id from restaurants where name = 'SO'))
       and period = '2026-08-01' and amount = 1530) = 2;

-- ═══ 4. (по желанию) Дубли неоплаченных долгов SALPERIOD ═════════════════════════════════
-- Создал долг-леджер (теперь выключен): по две одинаковые «ЗП — август 2026» на сотрудника.
-- Оставляем по одной. Сначала посмотри: select * from financial_integrity_issues
--   where check_code='duplicate_open_debt';
delete from shift_expenses
where id in (
  select id from (
    select id, row_number() over (partition by employee_id, note, amount order by created_at) as rn
    from shift_expenses
    where is_paid = false and note like 'SALPERIOD:%'
      and restaurant_id = (select id from restaurants where name = 'SO')
  ) t where rn > 1
);
