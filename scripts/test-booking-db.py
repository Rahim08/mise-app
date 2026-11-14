#!/usr/bin/env python3
"""Exercise Booking migration/RPCs in disposable LOCAL PostgreSQL; no app env or remote DB."""
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
for tool in ('initdb', 'pg_ctl', 'psql'):
    if not shutil.which(tool): raise SystemExit(f'Missing local tool: {tool}')
with tempfile.TemporaryDirectory(prefix='mise-booking-db-') as folder:
    base=Path(folder); data=base/'data'; sock=base/'socket'; sock.mkdir()
    subprocess.run(['initdb','-D',str(data),'--auth=trust','--no-locale','--encoding=UTF8'],check=True,stdout=subprocess.DEVNULL)
    subprocess.run(['pg_ctl','-D',str(data),'-l',str(base/'postgres.log'),'-o',f"-k {sock} -c listen_addresses='' -p 55464",'-w','start'],check=True,stdout=subprocess.DEVNULL)
    def sql(query):
        subprocess.run(['psql','-X','-h',str(sock),'-p','55464','-d','postgres','-v','ON_ERROR_STOP=1'],input=query,text=True,check=True,stdout=subprocess.DEVNULL)
    try:
        sql('''CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
CREATE TABLE restaurants(id uuid PRIMARY KEY);
INSERT INTO restaurants VALUES ('00000000-0000-0000-0000-000000000001'),('00000000-0000-0000-0000-000000000002');''')
        for source in ['bookings-2026-06.sql','guest-notes-2026-06.sql','guest-profile-fields-2026-07.sql']:
            sql((ROOT/'docs/migrations'/source).read_text())
        sql('''GRANT USAGE ON SCHEMA public TO service_role;
GRANT ALL ON bookings,guest_notes,restaurants TO service_role;
INSERT INTO bookings(id,restaurant_id,booking_date,phone,guest_name,created_by) VALUES
 ('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000001','2026-11-13','+41791234567','Swiss','alice'),
 ('00000000-0000-0000-0000-000000000012','00000000-0000-0000-0000-000000000001','2026-11-14','+41 (79)1234567','Swiss','alice'),
 ('00000000-0000-0000-0000-000000000013','00000000-0000-0000-0000-000000000001','2026-11-13','+393791234567','Italian','bob'),
 ('00000000-0000-0000-0000-000000000014','00000000-0000-0000-0000-000000000001','2026-11-13','+441234567890','Unique','alice'),
 ('00000000-0000-0000-0000-000000000015','00000000-0000-0000-0000-000000000001','2026-11-13',NULL,'Alex','alice'),
 ('00000000-0000-0000-0000-000000000016','00000000-0000-0000-0000-000000000001','2026-11-13',NULL,'Alex','bob'),
 ('00000000-0000-0000-0000-000000000021','00000000-0000-0000-0000-000000000002','2026-11-13','+441234567890','Other venue','other');
INSERT INTO guest_notes(restaurant_id,guest_key,note,email,birthday) VALUES
 ('00000000-0000-0000-0000-000000000001','791234567','Ambiguous legacy; preserve',NULL,NULL),
 ('00000000-0000-0000-0000-000000000001','441234567890','Unique VIP','vip@example.test','1990-01-01');''')
        migration=(ROOT/'docs/migrations/booking-guest-identity-2026-11-13.sql').read_text()
        sql(migration)
        sql('CREATE TABLE fixture_initial_keys AS SELECT id,guest_key FROM bookings; GRANT SELECT ON fixture_initial_keys TO service_role;')
        sql(migration)
        sql('''SET ROLE service_role;
DO $$ DECLARE swiss text; italian text; unique_guest text; other_key text; amount integer; first_claim boolean; next_date date; next_id uuid;
BEGIN
 SELECT guest_key INTO swiss FROM bookings WHERE id='00000000-0000-0000-0000-000000000011';
 SELECT guest_key INTO italian FROM bookings WHERE id='00000000-0000-0000-0000-000000000013';
 SELECT guest_key INTO unique_guest FROM bookings WHERE id='00000000-0000-0000-0000-000000000014';
 SELECT guest_key INTO other_key FROM bookings WHERE id='00000000-0000-0000-0000-000000000021';
 IF EXISTS(SELECT 1 FROM bookings b JOIN fixture_initial_keys f USING(id) WHERE b.guest_key IS DISTINCT FROM f.guest_key) THEN RAISE EXCEPTION 'Migration replay changed stable identities'; END IF;
 IF swiss=italian OR swiss IS NULL OR unique_guest=other_key THEN RAISE EXCEPTION 'Guest identity collision'; END IF;
 IF swiss IS DISTINCT FROM (SELECT guest_key FROM bookings WHERE id='00000000-0000-0000-0000-000000000012') THEN RAISE EXCEPTION 'Full phone formatting split identity'; END IF;
 IF (SELECT guest_key FROM bookings WHERE id='00000000-0000-0000-0000-000000000015')=(SELECT guest_key FROM bookings WHERE id='00000000-0000-0000-0000-000000000016') THEN RAISE EXCEPTION 'Same-name guests merged'; END IF;
 IF (SELECT count(*) FROM bookings) <> 7 OR (SELECT count(*) FROM guest_notes WHERE guest_key='791234567' AND note='Ambiguous legacy; preserve')<>1 THEN RAISE EXCEPTION 'Legacy data lost'; END IF;
 IF EXISTS(SELECT 1 FROM guest_notes WHERE guest_key IN(swiss,italian) AND note='Ambiguous legacy; preserve') THEN RAISE EXCEPTION 'Ambiguous note copied'; END IF;
 IF NOT EXISTS(SELECT 1 FROM guest_notes WHERE guest_key=unique_guest AND email='vip@example.test' AND birthday='1990-01-01') THEN RAISE EXCEPTION 'Unique metadata not copied'; END IF;
 INSERT INTO bookings(restaurant_id,booking_date,phone,created_by) VALUES ('00000000-0000-0000-0000-000000000001','2026-11-15','+41791234567','alice');
 IF (SELECT count(*) FROM bookings WHERE guest_key=swiss)<>3 THEN RAISE EXCEPTION 'New reservation lost guest link'; END IF;
 BEGIN
  INSERT INTO bookings(restaurant_id,booking_date,guest_key,created_by) VALUES ('00000000-0000-0000-0000-000000000001','2026-11-15',other_key,'alice');
  RAISE EXCEPTION 'Foreign guest accepted'; EXCEPTION WHEN foreign_key_violation THEN NULL;
 END;
 BEGIN PERFORM booking_guest_update('00000000-0000-0000-0000-000000000001',swiss,'Hacked',NULL,'{}','bob',false); RAISE EXCEPTION 'Non-author edited guest'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 PERFORM booking_guest_update('00000000-0000-0000-0000-000000000001',unique_guest,'Updated','+441112223334','{"note":"Updated note"}','alice',false);
 IF NOT EXISTS(SELECT 1 FROM guest_notes WHERE guest_key=unique_guest AND note='Updated note' AND email='vip@example.test' AND birthday='1990-01-01') THEN RAISE EXCEPTION 'Patch erased omitted fields'; END IF;
 IF (SELECT guest_key FROM bookings WHERE id='00000000-0000-0000-0000-000000000014')<>unique_guest THEN RAISE EXCEPTION 'Phone edit detached identity'; END IF;
 BEGIN
  PERFORM booking_guest_update('00000000-0000-0000-0000-000000000001',unique_guest,'Must rollback','+41791234567','{}','alice',false);
  RAISE EXCEPTION 'Phone collision accepted'; EXCEPTION WHEN unique_violation THEN NULL;
 END;
 BEGIN
  PERFORM booking_guest_update('00000000-0000-0000-0000-000000000001',unique_guest,'Must rollback',NULL,'{"birthday":"invalid"}','alice',false);
  RAISE EXCEPTION 'Invalid birthday accepted'; EXCEPTION WHEN invalid_datetime_format THEN NULL;
 END;
 IF (SELECT guest_name FROM bookings WHERE id='00000000-0000-0000-0000-000000000014')<>'Updated' THEN RAISE EXCEPTION 'Partial update survived failure'; END IF;
 IF NOT booking_notification_claim('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000091') THEN RAISE EXCEPTION 'Initial notification claim failed'; END IF;
 IF booking_notification_claim('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000092') OR booking_notification_claim('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000092') THEN RAISE EXCEPTION 'Duplicate/cross-tenant notification claimed'; END IF;
 IF booking_notification_finish('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000092',false) THEN RAISE EXCEPTION 'Another lease released'; END IF;
 PERFORM booking_notification_finish('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000091',false);
 IF NOT booking_notification_claim('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000092') THEN RAISE EXCEPTION 'Failed notification cannot retry'; END IF;
 PERFORM booking_notification_finish('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000092',true);
 IF booking_notification_claim('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011',gen_random_uuid()) THEN RAISE EXCEPTION 'Completed notification repeated'; END IF;
 UPDATE bookings SET notification_claimed_at=now()-interval '3 minutes',notification_claim_token='00000000-0000-0000-0000-000000000094' WHERE id='00000000-0000-0000-0000-000000000012';
 IF NOT booking_notification_claim('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000012','00000000-0000-0000-0000-000000000095') THEN RAISE EXCEPTION 'Expired notification lease cannot recover'; END IF;
 IF booking_notification_finish('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000012','00000000-0000-0000-0000-000000000094',false) THEN RAISE EXCEPTION 'Expired lease released a newer claim'; END IF;
 BEGIN
  PERFORM booking_rows_update('00000000-0000-0000-0000-000000000001',ARRAY['00000000-0000-0000-0000-000000000011'::uuid],'{"phone":"+393791234567"}','alice',false);
  RAISE EXCEPTION 'Single booking accepted another guest phone'; EXCEPTION WHEN unique_violation THEN NULL;
 END;
 BEGIN
  INSERT INTO bookings(restaurant_id,booking_date,guest_key,phone,created_by) VALUES ('00000000-0000-0000-0000-000000000001','2026-11-15',swiss,'+393791234567','alice');
  RAISE EXCEPTION 'Explicit guest accepted another guest phone'; EXCEPTION WHEN unique_violation THEN NULL;
 END;
 BEGIN
  PERFORM booking_rows_update('00000000-0000-0000-0000-000000000001',ARRAY['00000000-0000-0000-0000-000000000011'::uuid],'{"note":"Forbidden"}','bob',false);
  RAISE EXCEPTION 'Atomic booking update bypassed author'; EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 PERFORM booking_rows_update('00000000-0000-0000-0000-000000000001',ARRAY['00000000-0000-0000-0000-000000000011'::uuid],'{"note":"Updated safely","booking_time":"21:30"}','alice',false);
 IF NOT EXISTS (SELECT 1 FROM bookings WHERE id='00000000-0000-0000-0000-000000000011' AND note='Updated safely' AND booking_time='21:30') THEN RAISE EXCEPTION 'Atomic update result incorrect'; END IF;
END $$;
RESET ROLE;
CREATE FUNCTION fail_fixture_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF OLD.id='00000000-0000-0000-0000-000000000014' THEN RAISE EXCEPTION 'Fixture deletion failure'; END IF; RETURN OLD; END $$;
CREATE TRIGGER fixture_delete_failure BEFORE DELETE ON bookings FOR EACH ROW EXECUTE FUNCTION fail_fixture_delete();
SET ROLE service_role;
DO $$ DECLARE k text; BEGIN
 SELECT guest_key INTO k FROM bookings WHERE id='00000000-0000-0000-0000-000000000014';
 BEGIN PERFORM booking_guest_delete('00000000-0000-0000-0000-000000000001',k,'alice',false); RAISE EXCEPTION 'Fixture did not reject delete'; EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'Fixture deletion failure' THEN RAISE; END IF; END;
 IF NOT EXISTS(SELECT 1 FROM guest_notes WHERE guest_key=k AND note='Updated note') OR NOT EXISTS(SELECT 1 FROM bookings WHERE id='00000000-0000-0000-0000-000000000014') THEN RAISE EXCEPTION 'Partial guest deletion lost data'; END IF;
END $$;
RESET ROLE; DROP TRIGGER fixture_delete_failure ON bookings; DROP FUNCTION fail_fixture_delete();
SET ROLE service_role;
DO $$ DECLARE k text; BEGIN
 SELECT guest_key INTO k FROM bookings WHERE id='00000000-0000-0000-0000-000000000014';
 PERFORM booking_guest_delete('00000000-0000-0000-0000-000000000001',k,'alice',false);
 IF EXISTS(SELECT 1 FROM guest_notes WHERE guest_key=k OR canonical_guest_key=k) THEN RAISE EXCEPTION 'Successful delete left mapped metadata'; END IF;
END $$;
INSERT INTO bookings(restaurant_id,booking_date,created_by) SELECT '00000000-0000-0000-0000-000000000001','2020-01-01','alice' FROM generate_series(1,620);
DO $$ DECLARE d date; i uuid; n integer; all_count integer; BEGIN
 SELECT booking_date,id INTO d,i FROM booking_history_page('00000000-0000-0000-0000-000000000001') ORDER BY booking_date,id LIMIT 1;
 SELECT count(*) INTO n FROM booking_history_page('00000000-0000-0000-0000-000000000001',d,i);
 SELECT count(*) INTO all_count FROM bookings WHERE restaurant_id='00000000-0000-0000-0000-000000000001';
 IF (SELECT count(*) FROM booking_history_page('00000000-0000-0000-0000-000000000001'))<>500 OR 500+n<>all_count THEN RAISE EXCEPTION 'History paging lost rows'; END IF;
END $$;
RESET ROLE; SET ROLE anon;
DO $$ BEGIN
 BEGIN PERFORM booking_history_page('00000000-0000-0000-0000-000000000001'); RAISE EXCEPTION 'Anon history access'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM booking_guest_delete('00000000-0000-0000-0000-000000000001','x',NULL,true); RAISE EXCEPTION 'Anon delete access'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM booking_rows_update('00000000-0000-0000-0000-000000000001',ARRAY['00000000-0000-0000-0000-000000000011'::uuid],'{"note":"Forbidden"}',NULL,true); RAISE EXCEPTION 'Anon booking update access'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
''')
        sql("""DO $$ DECLARE k text; BEGIN
 SELECT guest_key INTO k FROM bookings WHERE id='00000000-0000-0000-0000-000000000013';
 PERFORM booking_guest_delete('00000000-0000-0000-0000-000000000001',k,'owner',true);
END $$;""")
        sql(migration)
        sql("""DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM guest_notes WHERE guest_key LIKE 'g:%' AND note='Ambiguous legacy; preserve') THEN RAISE EXCEPTION 'Replay reinterpreted ambiguous legacy metadata'; END IF;
END $$;""")
        # Concurrent phone edits serialize on the same normalized phone. Exactly one wins.
        sql("""INSERT INTO bookings(id,restaurant_id,booking_date,created_by) VALUES
 ('00000000-0000-0000-0000-000000000081','00000000-0000-0000-0000-000000000001','2026-11-13','alice'),
 ('00000000-0000-0000-0000-000000000082','00000000-0000-0000-0000-000000000001','2026-11-13','alice');""")
        sql("""DO $$ BEGIN
 BEGIN PERFORM booking_rows_update('00000000-0000-0000-0000-000000000001',ARRAY['00000000-0000-0000-0000-000000000081'::uuid,'00000000-0000-0000-0000-000000000082'::uuid],'{"phone":"+491111222233"}','alice',false);
 RAISE EXCEPTION 'Bulk update merged two guest phones'; EXCEPTION WHEN unique_violation THEN NULL; END;
END $$;""")
        def race_update(number):
            query=f"SET ROLE service_role; SELECT booking_rows_update('00000000-0000-0000-0000-000000000001',ARRAY['00000000-0000-0000-0000-0000000000{number}'::uuid],'{{\"phone\":\"+499999888877\"}}','alice',false);"
            return subprocess.run(['psql','-X','-h',str(sock),'-p','55464','-d','postgres','-v','ON_ERROR_STOP=1'],input=query,text=True,capture_output=True)
        with ThreadPoolExecutor(max_workers=2) as executor:
            raced=list(executor.map(race_update,[81,82]))
        assert sum(result.returncode == 0 for result in raced)==1, [(r.returncode,r.stderr) for r in raced]
        assert any('Phone belongs to another guest' in result.stderr for result in raced), 'Conflict not rejected'
        sql("""INSERT INTO bookings(restaurant_id,booking_date,phone,created_by) VALUES ('00000000-0000-0000-0000-000000000001','2026-11-16','+499999888877','alice');
DO $$ BEGIN IF (SELECT count(DISTINCT guest_key) FROM bookings WHERE phone='+499999888877')<>1 THEN RAISE EXCEPTION 'Concurrent update split guest identity'; END IF; END $$;""")
        print('PASS Booking migration replay, safe guest mapping/legacy retention, cross-tenant/author denial, atomic contact/profile edits/deletes, notification dedup and complete paged history')
    finally:
        subprocess.run(['pg_ctl','-D',str(data),'-m','fast','-w','stop'],check=True,stdout=subprocess.DEVNULL)
