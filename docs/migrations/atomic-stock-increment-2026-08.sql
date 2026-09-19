-- Atomic increment for tobacco_stock.quantity_g (MISE-006, full-system audit 2026-08-28).
--
-- Problem: app/tobacco/page.tsx saveMov() read a snapshot of tobacco_stock, computed a
-- delta client-side, then wrote back an ABSOLUTE value (base.quantity_g + delta). Two
-- staff on different devices recording movements for the same brand/flavor within the
-- same round-trip window both read the same base value; the second write silently
-- overwrites the first's effect on the denormalized stock total (the tobacco_movements
-- audit row itself is never lost — only its effect on the running total is).
--
-- Fix: move the read-modify-write into a single atomic SQL statement (`quantity_g =
-- quantity_g + delta`), called via /api/db's RPC allowlist (app/api/db/route.ts
-- RPC_POLICY) so restaurant_id is always the caller's own, never a client-supplied value.
--
-- SECURITY DEFINER is required because the RPC runs under the service-role key from the
-- server gateway (RLS on tobacco_stock denies everything by default, see
-- docs/security/rls.sql) — the function itself is the security boundary here, enforced by
-- always taking p_restaurant_id from the authenticated caller in the gateway, never from
-- client-controlled RPC args.

create or replace function increment_tobacco_stock(p_id uuid, p_restaurant_id uuid, p_delta numeric)
returns tobacco_stock
language plpgsql
security definer
set search_path = public
as $$
declare
  result tobacco_stock;
begin
  update tobacco_stock
  set quantity_g = greatest(0, quantity_g + p_delta),
      updated_at = now()
  where id = p_id and restaurant_id = p_restaurant_id
  returning * into result;

  if not found then
    raise exception 'tobacco_stock row % not found for restaurant %', p_id, p_restaurant_id;
  end if;

  return result;
end;
$$;

revoke all on function increment_tobacco_stock(uuid, uuid, numeric) from public, anon, authenticated;
grant execute on function increment_tobacco_stock(uuid, uuid, numeric) to service_role;
