#!/bin/sh
# Проверка save_shift на временном локальном Postgres (прод не трогает).
#   sh scripts/sql-tests/run-save-shift.sh
set -e
cd "$(dirname "$0")/../.."
PATH="${PGBIN:-/opt/homebrew/opt/postgresql@16/bin}:$PATH"; export PATH LC_ALL=en_US.UTF-8
D=$(mktemp -d /tmp/mise-sql.XXXXXX); PORT=54329
initdb -D "$D/pg" -U postgres >/dev/null 2>&1
pg_ctl -D "$D/pg" -o "-k $D -p $PORT -c listen_addresses=''" -l "$D/pg.log" start >/dev/null
trap 'pg_ctl -D "$D/pg" stop >/dev/null; rm -rf "$D"' EXIT
P="psql -h $D -p $PORT -U postgres -d postgres -q"
$P -f scripts/sql-tests/save-shift.sql >/dev/null
# два устройства одновременно, одна и та же форма: проходит ровно одно, строк не задваивается
Q="begin; select save_shift('00000000-0000-0000-0000-0000000000aa','00000000-0000-0000-0000-000000000003',p||jsonb_build_object('op_id',gen_random_uuid())) is not null from race; select pg_sleep(1); commit;"
$P -c "$Q" >"$D/a" 2>&1 & $P -c "$Q" >"$D/b" 2>&1 & wait
test "$(cat "$D/a" "$D/b" | grep -c shift_changed)" = 1
test "$($P -Atc "select count(*) from shift_expenses where shift_id='00000000-0000-0000-0000-000000000003'")" = 1
echo "PASS save_shift"
