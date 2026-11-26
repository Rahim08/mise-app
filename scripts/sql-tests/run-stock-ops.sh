#!/bin/sh
# Проверка операций склада на временном локальном Postgres (прод не трогает).
#   sh scripts/sql-tests/run-stock-ops.sh
set -e
cd "$(dirname "$0")/../.."
PATH="${PGBIN:-/opt/homebrew/opt/postgresql@16/bin}:$PATH"; export PATH LC_ALL=en_US.UTF-8
D=$(mktemp -d /tmp/mise-sql.XXXXXX); PORT=54329
initdb -D "$D/pg" -U postgres >/dev/null 2>&1
pg_ctl -D "$D/pg" -o "-k $D -p $PORT -c listen_addresses=''" -l "$D/pg.log" start >/dev/null
trap 'pg_ctl -D "$D/pg" stop >/dev/null; rm -rf "$D"' EXIT
P="psql -h $D -p $PORT -U postgres -d postgres -q -v ON_ERROR_STOP=1"
$P -f scripts/sql-tests/stock-ops.sql >/dev/null
# две одновременные выдачи всего остатка: проходит ровно одна
R="'00000000-0000-0000-0000-0000000000aa'"
O() { echo "begin; select stock_save_movement($R, jsonb_build_object('op_id', gen_random_uuid(), 'mode', 'out', 'rows', '[{\"brand\":\"B\",\"flavor\":\"X\",\"grams\":70.5}]'::jsonb)); select pg_sleep(1); commit;"; }
$P -c "$(O)" >"$D/a" 2>&1 & $P -c "$(O)" >"$D/b" 2>&1 & wait
test "$($P -Atc "select count(*) from tobacco_movements where type='out' and quantity_g=70.5")" = 1
test "$($P -Atc "select quantity_g = 0 from tobacco_stock where flavor='X'")" = t
echo "PASS stock operations"
