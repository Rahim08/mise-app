-- Atomic debt settlement (MISE-002, full-system audit 2026-08-28, owner decision:
-- "атомарная транзакция").
--
-- Problem: persistDebtSettlements (app/manager/page.tsx, native/Mise/Mise/ManagerView.swift)
-- ran 2-3 sequential, independent writes with no rollback on partial failure:
--   1. (web only, salary-linked debts) insert into salary_payments — source of truth "paid"
--      for the Payroll tab
--   2. insert a new shift_expenses row dated today (the cash that actually left the register)
--   3. update the original shift_expenses row to is_paid=true
-- A network blip between steps left the system in a state no one would notice: e.g. step 1
-- succeeds but step 2/3 fails → employee shows "paid" in Payroll while the original debt
-- stays open in Manager's debt list forever, and the day's register never reflects the
-- settlement.
--
-- Fix: one Postgres function, one transaction (implicit — plpgsql functions run inside the
-- calling statement's transaction; any exception rolls back everything the function did).
-- Called via /api/db's RPC allowlist (RPC_POLICY in app/api/db/route.ts), same model as
-- increment_tobacco_stock (see atomic-stock-increment-2026-08.sql) — restaurant_id is always
-- the caller's own, enforced server-side, never a client-supplied value.
--
-- p_debts shape (one element per debt being settled), all fields required except where noted:
--   id            uuid   — the original shift_expenses.id being settled
--   amount        numeric
--   category_id   uuid | null
--   category_name text | null
--   employee_id   uuid | null
--   is_salary     boolean (optional, default false) — true for a SALPERIOD-tagged salary debt
--   salary_period date as text 'YYYY-MM-01' (required when is_salary)
--   salary_note   text (required when is_salary) — note for the salary_payments row
--   expense_note  text — note for the new shift_expenses settlement row

create or replace function settle_debts(
  p_restaurant_id uuid,
  p_shift_id uuid,
  p_date_str date,
  p_debts jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  -- MISE-002 hotfix (2026-08-30, prod error 42702 "column reference d is ambiguous"):
  -- this variable was named `d`, same as the `jsonb_array_elements(...) as d` alias used
  -- in the SELECT statements below — PL/pgSQL couldn't tell the loop variable from the
  -- FROM-clause alias. Renamed to v_debt; the SQL aliases stay `d`, now unambiguous.
  v_debt jsonb;
  debt_ids uuid[];
begin
  if p_debts is null or jsonb_array_length(p_debts) = 0 then
    return;
  end if;

  -- 1) salary_payments first — source of truth "paid" for Payroll (parity with the
  --    non-batched savePayment/markSalaryPaid flow, which also writes this first).
  for v_debt in select value from jsonb_array_elements(p_debts)
  loop
    if coalesce((v_debt->>'is_salary')::boolean, false) then
      insert into salary_payments (restaurant_id, employee_id, period, amount, method, paid_at, note, created_by)
      values (
        p_restaurant_id,
        (v_debt->>'employee_id')::uuid,
        (v_debt->>'salary_period')::date,
        (v_debt->>'amount')::numeric,
        'cash',
        p_date_str::timestamptz,
        v_debt->>'salary_note',
        null
      );
    end if;
  end loop;

  -- 2) new settlement row dated today — the cash that actually left the register today.
  insert into shift_expenses (shift_id, restaurant_id, amount, category_id, category_name, employee_id, is_paid, paid_shift_id, note)
  select
    p_shift_id,
    p_restaurant_id,
    (d->>'amount')::numeric,
    nullif(d->>'category_id', '')::uuid,
    d->>'category_name',
    nullif(d->>'employee_id', '')::uuid,
    true,
    p_shift_id,
    d->>'expense_note'
  from jsonb_array_elements(p_debts) as d;

  -- 3) original rows — flip to paid, excluded from their own day's rollup forever
  --    (paid_shift_id != own shift_id, see Analytics countsInRollup).
  select array_agg((d->>'id')::uuid) into debt_ids from jsonb_array_elements(p_debts) as d;

  update shift_expenses
  set is_paid = true, paid_at = p_date_str, paid_shift_id = p_shift_id
  where id = any(debt_ids) and restaurant_id = p_restaurant_id;
end;
$$;

revoke all on function settle_debts(uuid, uuid, date, jsonb) from public, anon, authenticated;
grant execute on function settle_debts(uuid, uuid, date, jsonb) to service_role;
