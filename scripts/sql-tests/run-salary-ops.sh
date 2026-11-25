#!/bin/sh
# Проверка операций зарплаты на временном локальном Postgres (прод не трогает).
#   sh scripts/sql-tests/run-salary-ops.sh
set -e
cd "$(dirname "$0")/../.."
PATH="${PGBIN:-/opt/homebrew/opt/postgresql@16/bin}:$PATH"; export PATH LC_ALL=en_US.UTF-8
D=$(mktemp -d /tmp/mise-sql.XXXXXX); PORT=54329
initdb -D "$D/pg" -U postgres >/dev/null 2>&1
pg_ctl -D "$D/pg" -o "-k $D -p $PORT -c listen_addresses=''" -l "$D/pg.log" start >/dev/null
trap 'pg_ctl -D "$D/pg" stop >/dev/null; rm -rf "$D"' EXIT
P="psql -h $D -p $PORT -U postgres -d postgres -q"
$P -f scripts/sql-tests/salary-ops.sql >/dev/null
# два устройства платят одновременно больше половины остатка: проходит только одно
q() { echo "begin; select pay_salary('00000000-0000-0000-0000-0000000000aa', p($1,'{\"amount\":$2}')); select pg_sleep(1); commit;"; }
$P -c "$(q 20 300)" >"$D/a" 2>&1 & $P -c "$(q 21 299)" >"$D/b" 2>&1 & wait
test "$(cat "$D/a" "$D/b" | grep -c exceeds_remaining)" = 1
test "$($P -Atc "select count(*) from salary_payments where method='cash'")" = 2
echo "PASS salary ops"
