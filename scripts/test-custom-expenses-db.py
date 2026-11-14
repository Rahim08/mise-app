#!/usr/bin/env python3
"""Run the additive migration and security/ledger checks in a disposable LOCAL Postgres.
No app env, credentials or remote database is read. Requires initdb/pg_ctl/psql on PATH.
"""
from pathlib import Path
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
for tool in ('initdb', 'pg_ctl', 'psql'):
    if not shutil.which(tool):
        raise SystemExit(f'Missing local PostgreSQL tool: {tool}')
with tempfile.TemporaryDirectory(prefix='mise-expenses-db-') as directory:
    base = Path(directory)
    data, socket = base / 'data', base / 'socket'
    socket.mkdir()
    subprocess.run(['initdb', '-D', str(data), '--auth=trust', '--no-locale', '--encoding=UTF8'], check=True, stdout=subprocess.DEVNULL)
    subprocess.run(['pg_ctl', '-D', str(data), '-l', str(base / 'postgres.log'), '-o', f"-k {socket} -c listen_addresses='' -p 55463", '-w', 'start'], check=True, stdout=subprocess.DEVNULL)
    psql = ['psql', '-X', '-h', str(socket), '-p', '55463', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1']
    def sql(text):
        subprocess.run(psql, input=text, text=True, check=True, stdout=subprocess.DEVNULL)
    try:
        sql('''
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE TABLE public.restaurants (id uuid PRIMARY KEY);
CREATE TABLE public.shifts (id uuid PRIMARY KEY, restaurant_id uuid NOT NULL REFERENCES restaurants(id));
CREATE TABLE public.shift_expenses (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), restaurant_id uuid NOT NULL,
 shift_id uuid, category_id uuid, employee_id uuid, category_name text, amount numeric(12,2), note text,
 is_paid boolean DEFAULT true, paid_shift_id uuid, created_at timestamptz DEFAULT now());
GRANT USAGE ON SCHEMA public TO service_role;
GRANT ALL ON public.restaurants, public.shifts, public.shift_expenses TO service_role;
INSERT INTO restaurants VALUES ('00000000-0000-0000-0000-000000000001'), ('00000000-0000-0000-0000-000000000002');
INSERT INTO shifts VALUES ('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000001'),
 ('00000000-0000-0000-0000-000000000022','00000000-0000-0000-0000-000000000002');
INSERT INTO shift_expenses (category_name, amount, restaurant_id) VALUES ('Legacy expense', 5,'00000000-0000-0000-0000-000000000001');
INSERT INTO shift_expenses (category_name, amount, restaurant_id) VALUES (E'\\tPerfume\\n', 1,'00000000-0000-0000-0000-000000000001');
''')
        migration = (ROOT / 'docs/migrations/custom-shift-expenses-2026-11-13.sql').read_text()
        sql(migration)
        sql(migration)  # idempotent replay, no lost legacy data
        sql('''
SET ROLE service_role;
INSERT INTO shift_expenses(id,restaurant_id,shift_id,category_name,amount,is_custom) VALUES
 ('00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','Perfume',12.50,true),
 ('00000000-0000-0000-0000-000000000102','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','  perfume  ',7,true),
 ('00000000-0000-0000-0000-000000000201','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000022','Private other venue',10,true);
INSERT INTO shift_expenses(id,restaurant_id,shift_id,category_name,amount,is_custom) VALUES
 ('00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','Perfume',12.50,true)
 ON CONFLICT(restaurant_id,id) DO UPDATE SET amount=EXCLUDED.amount;
DO $$ BEGIN
 IF (SELECT count(*) FROM shift_expenses WHERE id='00000000-0000-0000-0000-000000000101') <> 1 THEN RAISE EXCEPTION 'Repeated save duplicated custom row'; END IF;
 IF (SELECT count(*) FROM public.shift_expense_name_suggestions('00000000-0000-0000-0000-000000000001',' p ')) <> 1 THEN RAISE EXCEPTION 'Names not normalized/deduplicated'; END IF;
 IF EXISTS(SELECT 1 FROM public.shift_expense_name_suggestions('00000000-0000-0000-0000-000000000001','P') WHERE name='Private other venue') THEN RAISE EXCEPTION 'Cross tenant history leak'; END IF;
 IF EXISTS(SELECT 1 FROM public.shift_expense_name_suggestions('00000000-0000-0000-0000-000000000001','%')) THEN RAISE EXCEPTION 'Prefix treated as wildcard'; END IF;
 IF (SELECT count(*) FROM public.shift_expense_name_suggestions('00000000-0000-0000-0000-000000000001','Legacy')) <> 1 THEN RAISE EXCEPTION 'Existing expense names missing'; END IF;
 IF (SELECT count(*) FROM shift_expenses WHERE NOT is_custom AND category_name='Legacy expense' AND amount=5) <> 1 THEN RAISE EXCEPTION 'Legacy data modified'; END IF;
 BEGIN
  INSERT INTO shift_expenses(restaurant_id,shift_id,category_name,amount,is_custom) VALUES ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000022','Wrong shift',10,true);
  RAISE EXCEPTION 'Cross tenant shift accepted';
 EXCEPTION WHEN foreign_key_violation THEN NULL; END;
 BEGIN
  INSERT INTO shift_expenses(restaurant_id,shift_id,category_name,amount,is_custom) VALUES ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','',10,true);
  RAISE EXCEPTION 'Empty name accepted';
 EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
UPDATE shift_expenses SET is_paid=true,paid_shift_id='00000000-0000-0000-0000-000000000011' WHERE id='00000000-0000-0000-0000-000000000101';
DO $$ BEGIN
 BEGIN UPDATE shift_expenses SET is_paid=false WHERE id='00000000-0000-0000-0000-000000000101'; RAISE EXCEPTION 'Settled expense reopened'; EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN DELETE FROM shift_expenses WHERE id='00000000-0000-0000-0000-000000000101'; RAISE EXCEPTION 'Settled expense deleted'; EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
DELETE FROM shift_expenses WHERE restaurant_id='00000000-0000-0000-0000-000000000001' AND is_custom AND paid_shift_id IS NULL;
DO $$ BEGIN
 IF (SELECT count(*) FROM public.shift_expense_name_suggestions('00000000-0000-0000-0000-000000000001','P')) <> 1 THEN RAISE EXCEPTION 'Saved history lost on delete'; END IF;
END $$;
RESET ROLE; SET ROLE anon;
DO $$ BEGIN
 BEGIN PERFORM public.shift_expense_name_suggestions('00000000-0000-0000-0000-000000000002','P'); RAISE EXCEPTION 'Anonymous RPC access'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM * FROM public.custom_expense_name_history; RAISE EXCEPTION 'Anonymous table access'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE; SET ROLE authenticated;
DO $$ BEGIN
 BEGIN PERFORM public.shift_expense_name_suggestions('00000000-0000-0000-0000-000000000002','P'); RAISE EXCEPTION 'Direct authenticated RPC access'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
''')
        print('PASS local migration replay, legacy preservation, stable-ID upsert, tenant isolation, normalized history retention, input constraints and direct-access denial')
    finally:
        subprocess.run(['pg_ctl', '-D', str(data), '-m', 'fast', '-w', 'stop'], check=True, stdout=subprocess.DEVNULL)
