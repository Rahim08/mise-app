-- Audit trigger for inkassations / shift_expenses (2026-09-04, user request после
-- расхождения €1600+ в накопительной инкассации SO, которое не удалось найти —
-- ни Postgres log_statement, ни edge_logs (retention ~1-2 дня) не хранят историю
-- UPDATE/DELETE достаточно долго). Пишем свой журнал изменений на будущее.

create table if not exists financial_audit_log (
  id uuid primary key default gen_random_uuid(),
  table_name text not null,
  operation text not null,
  row_id uuid,
  restaurant_id uuid,
  old_data jsonb,
  new_data jsonb,
  changed_at timestamptz not null default now()
);

alter table financial_audit_log enable row level security;
revoke all on financial_audit_log from public, anon, authenticated;
grant select on financial_audit_log to service_role;

create or replace function log_financial_change() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (tg_op = 'DELETE') then
    insert into financial_audit_log(table_name, operation, row_id, restaurant_id, old_data)
    values (tg_table_name, tg_op, old.id, old.restaurant_id, to_jsonb(old));
    return old;
  elsif (tg_op = 'UPDATE') then
    insert into financial_audit_log(table_name, operation, row_id, restaurant_id, old_data, new_data)
    values (tg_table_name, tg_op, new.id, new.restaurant_id, to_jsonb(old), to_jsonb(new));
    return new;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_audit_inkassations on inkassations;
create trigger trg_audit_inkassations
after update or delete on inkassations
for each row execute function log_financial_change();

drop trigger if exists trg_audit_shift_expenses on shift_expenses;
create trigger trg_audit_shift_expenses
after update or delete on shift_expenses
for each row execute function log_financial_change();
