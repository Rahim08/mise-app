-- Financial audit log v2 (2026-09-19, user request после потерь €630 (31.08) и €1100 (14.09) в
-- инкассации SO, которые не удалось проследить: v1 (financial-audit-trigger-2026-09-04.sql)
-- писал только UPDATE/DELETE двух таблиц и не знал «кто»).
--
-- Что даёт v2:
--   • триггеры на INSERT/UPDATE/DELETE во ВСЕХ денежных таблицах (source='db') — точный снимок
--     строки до/после, кто бы ни менял (шлюз, RPC, SQL-редактор, cron);
--   • колонки actor_* + request: шлюз /api/db (lib/financialAudit.ts, source='api') дописывает,
--     КТО именно (аккаунт владельца / сотрудник + роль) и из какого приложения;
--   • журнал неизменяем: UPDATE/DELETE по нему запрещены триггером;
--   • VIEW financial_audit_view — читаемое представление для разбора.
-- Безопасно перезапускать (idempotent). Применять в Supabase SQL editor.

-- 1) Колонки ---------------------------------------------------------------------------------
alter table financial_audit_log
  add column if not exists source text not null default 'db',       -- 'db' триггер | 'api' шлюз
  add column if not exists actor_type text,                          -- owner | staff | admin_view
  add column if not exists actor_id text,                            -- staff.id или auth uid владельца
  add column if not exists actor_name text,                          -- имя сотрудника / email владельца
  add column if not exists actor_role text,
  add column if not exists request jsonb;                            -- фильтры запроса, приложения

-- row_id раньше был uuid: не у всех таблиц id — uuid, текст надёжнее.
alter table financial_audit_log alter column row_id type text using row_id::text;

create index if not exists idx_fal_rest_time on financial_audit_log (restaurant_id, changed_at desc);
create index if not exists idx_fal_table_row on financial_audit_log (table_name, row_id);

-- 2) Неизменяемость журнала -------------------------------------------------------------------
create or replace function financial_audit_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'financial_audit_log is append-only';
end;
$$;

drop trigger if exists trg_fal_immutable on financial_audit_log;
create trigger trg_fal_immutable
before update or delete on financial_audit_log
for each row execute function financial_audit_immutable();

-- 3) Универсальный триггер (INSERT/UPDATE/DELETE) ---------------------------------------------
-- restaurant_id берём из строки; если колонки нет (salary_advances и т.п.) — через сотрудника.
create or replace function log_financial_change() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  j_old jsonb;
  j_new jsonb;
  j jsonb;
  v_rid uuid;
  v_emp uuid;
begin
  -- Сбой журнала НИКОГДА не должен блокировать запись денег: любая ошибка ниже — только warning.
  begin
    if (tg_op = 'DELETE') then
      j_old := to_jsonb(old); j_new := null; j := j_old;
    elsif (tg_op = 'UPDATE') then
      j_old := to_jsonb(old); j_new := to_jsonb(new); j := j_new;
      if j_old = j_new then return new; end if;  -- «пустое» пересохранение — не шумим
    else
      j_old := null; j_new := to_jsonb(new); j := j_new;
    end if;

    v_rid := nullif(j->>'restaurant_id', '')::uuid;
    if v_rid is null and (j ? 'employee_id') then
      v_emp := nullif(j->>'employee_id', '')::uuid;
      select restaurant_id into v_rid from employees where id = v_emp;
    end if;
    if v_rid is null and (j ? 'shift_id') then
      select restaurant_id into v_rid from shifts where id = nullif(j->>'shift_id', '')::uuid;
    end if;

    insert into financial_audit_log(source, table_name, operation, row_id, restaurant_id, old_data, new_data)
    values ('db', tg_table_name, tg_op, j->>'id', v_rid, j_old, j_new);
  exception when others then
    raise warning 'financial audit failed on %.%: %', tg_table_name, tg_op, sqlerrm;
  end;

  if (tg_op = 'DELETE') then return old; end if;
  return new;
end;
$$;

-- 4) Триггеры на все денежные таблицы ---------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'shifts', 'shift_expenses', 'shift_absences', 'inkassations', 'transactions',
    'salary_payments', 'salary_advances', 'salary_records', 'monthly_card_amounts',
    'employees', 'salary_history', 'expense_categories', 'restaurant_settings'
  ] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists trg_audit_%1$s on %1$I', t);
      execute format(
        'create trigger trg_audit_%1$s after insert or update or delete on %1$I
         for each row execute function log_financial_change()', t);
    end if;
  end loop;
end $$;

-- 5) Читаемое представление -------------------------------------------------------------------
-- Использование, например «что менялось в инкассации за неделю и кто»:
--   select * from financial_audit_view
--   where restaurant_id = '<id>' and table_name = 'inkassations' and at >= now() - interval '7 days'
--   order by at;
create or replace view financial_audit_view as
select
  changed_at as at,
  restaurant_id,
  table_name,
  operation,
  source,
  coalesce(actor_name, actor_id, case when source = 'db' then '(db trigger — actor см. строку source=api рядом)' end) as who,
  actor_role,
  row_id,
  coalesce(new_data->>'date', old_data->>'date') as row_date,
  old_data,
  new_data,
  request
from financial_audit_log;

alter table financial_audit_log enable row level security;
revoke all on financial_audit_log from public, anon, authenticated;
grant select, insert on financial_audit_log to service_role;
revoke all on financial_audit_view from public, anon, authenticated;
grant select on financial_audit_view to service_role;
