-- Additive only. Apply before releasing custom-expense clients; no existing row is removed.
BEGIN;
ALTER TABLE public.shift_expenses ADD COLUMN IF NOT EXISTS is_custom boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS shift_expenses_restaurant_id_id_key
  ON public.shift_expenses (restaurant_id, id);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shift_expenses_custom_valid' AND conrelid = 'public.shift_expenses'::regclass) THEN
    ALTER TABLE public.shift_expenses ADD CONSTRAINT shift_expenses_custom_valid CHECK (
      NOT is_custom OR (
        category_id IS NULL AND employee_id IS NULL AND shift_id IS NOT NULL
        AND category_name IS NOT NULL AND length(btrim(category_name)) BETWEEN 1 AND 120
        AND amount IS NOT NULL AND amount > 0 AND amount <= 1000000000
        AND amount::numeric = round(amount::numeric, 2)
      )
    );
  END IF;
END $$;

-- A caller cannot attach its custom expense to another restaurant's shift.
CREATE OR REPLACE FUNCTION public.check_custom_shift_expense_scope() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.is_custom AND OLD.paid_shift_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.shifts s WHERE s.id = OLD.shift_id AND s.restaurant_id = OLD.restaurant_id
    ) THEN RAISE EXCEPTION 'Settled custom expense is immutable' USING ERRCODE = '23514'; END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND (OLD.is_custom OR NEW.is_custom) THEN
    IF OLD.is_custom IS DISTINCT FROM NEW.is_custom OR OLD.shift_id IS DISTINCT FROM NEW.shift_id
       OR OLD.restaurant_id IS DISTINCT FROM NEW.restaurant_id THEN
      RAISE EXCEPTION 'Custom expense identity is immutable' USING ERRCODE = '23514';
    END IF;
    IF OLD.paid_shift_id IS NOT NULL AND
       ROW(OLD.amount, OLD.category_name, OLD.is_paid, OLD.note, OLD.category_id, OLD.employee_id, OLD.paid_shift_id)
       IS DISTINCT FROM ROW(NEW.amount, NEW.category_name, NEW.is_paid, NEW.note, NEW.category_id, NEW.employee_id, NEW.paid_shift_id) THEN
      RAISE EXCEPTION 'Settled custom expense is immutable' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW.is_custom AND NOT EXISTS (
    SELECT 1 FROM public.shifts s WHERE s.id = NEW.shift_id AND s.restaurant_id = NEW.restaurant_id
  ) THEN
    RAISE EXCEPTION 'Custom expense shift scope mismatch' USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS custom_shift_expense_scope ON public.shift_expenses;
CREATE TRIGGER custom_shift_expense_scope BEFORE INSERT OR UPDATE OR DELETE ON public.shift_expenses
  FOR EACH ROW EXECUTE FUNCTION public.check_custom_shift_expense_scope();
REVOKE ALL ON FUNCTION public.check_custom_shift_expense_scope() FROM PUBLIC, anon, authenticated;

-- Store names separately from money rows: renaming/removing an expense must not erase
-- previously saved suggestions. This table contains no amounts or staff information.
CREATE TABLE IF NOT EXISTS public.custom_expense_name_history (
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  normalized_name text NOT NULL,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  last_used_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (restaurant_id, normalized_name)
);
ALTER TABLE public.custom_expense_name_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS custom_expense_name_history_service ON public.custom_expense_name_history;
CREATE POLICY custom_expense_name_history_service ON public.custom_expense_name_history
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON TABLE public.custom_expense_name_history FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.custom_expense_name_history TO service_role;

CREATE OR REPLACE FUNCTION public.remember_custom_expense_name() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE expense_name text := btrim(regexp_replace(NEW.category_name, '\s+', ' ', 'g'));
BEGIN
  IF expense_name IS NULL OR length(expense_name) NOT BETWEEN 1 AND 120 OR coalesce(NEW.note, '') LIKE 'SALPERIOD:%' THEN RETURN NEW; END IF;
  INSERT INTO public.custom_expense_name_history (restaurant_id, normalized_name, name, last_used_at)
    VALUES (NEW.restaurant_id, lower(expense_name), expense_name, now())
    ON CONFLICT (restaurant_id, normalized_name) DO UPDATE
      SET name = EXCLUDED.name, last_used_at = EXCLUDED.last_used_at;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.remember_custom_expense_name() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS remember_custom_expense_name ON public.shift_expenses;
CREATE TRIGGER remember_custom_expense_name AFTER INSERT OR UPDATE ON public.shift_expenses
  FOR EACH ROW WHEN (NEW.employee_id IS NULL AND NEW.paid_shift_id IS NULL AND NEW.category_name IS NOT NULL)
  EXECUTE FUNCTION public.remember_custom_expense_name();

INSERT INTO public.custom_expense_name_history (restaurant_id, normalized_name, name, last_used_at)
  SELECT DISTINCT ON (e.restaurant_id, lower(btrim(regexp_replace(e.category_name, '\s+', ' ', 'g'))))
    e.restaurant_id, lower(btrim(regexp_replace(e.category_name, '\s+', ' ', 'g'))),
    btrim(regexp_replace(e.category_name, '\s+', ' ', 'g')), coalesce(e.created_at, now())
  FROM public.shift_expenses e WHERE e.employee_id IS NULL AND e.paid_shift_id IS NULL
    AND coalesce(e.note, '') NOT LIKE 'SALPERIOD:%'
    AND length(btrim(regexp_replace(e.category_name, '\s+', ' ', 'g'))) BETWEEN 1 AND 120
  ORDER BY e.restaurant_id, lower(btrim(regexp_replace(e.category_name, '\s+', ' ', 'g'))), e.created_at DESC, e.id
  ON CONFLICT (restaurant_id, normalized_name) DO NOTHING;

-- Search all saved names BEFORE limiting. No local-only history or permanent categories.
CREATE OR REPLACE FUNCTION public.shift_expense_name_suggestions(p_restaurant_id uuid, p_prefix text DEFAULT '')
RETURNS TABLE(name text) LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT h.name FROM public.custom_expense_name_history h
  WHERE h.restaurant_id = p_restaurant_id
    AND starts_with(h.normalized_name, lower(btrim(regexp_replace(left(coalesce(p_prefix, ''), 120), '\s+', ' ', 'g'))))
  ORDER BY h.last_used_at DESC, h.name LIMIT 20;
$$;
REVOKE ALL ON FUNCTION public.shift_expense_name_suggestions(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shift_expense_name_suggestions(uuid, text) TO service_role;
COMMIT;
