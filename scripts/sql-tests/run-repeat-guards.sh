#!/bin/sh
# Проверка защиты от повторов на временном локальном Postgres (прод не трогает).
#   sh scripts/sql-tests/run-repeat-guards.sh
set -e
cd "$(dirname "$0")/../.."
PATH="${PGBIN:-/opt/homebrew/opt/postgresql@16/bin}:$PATH"; export PATH LC_ALL=en_US.UTF-8
D=$(mktemp -d /tmp/mise-sql.XXXXXX); PORT=54329
initdb -D "$D/pg" -U postgres >/dev/null 2>&1
pg_ctl -D "$D/pg" -o "-k $D -p $PORT -c listen_addresses=''" -l "$D/pg.log" start >/dev/null
trap 'pg_ctl -D "$D/pg" stop >/dev/null; rm -rf "$D"' EXIT
P="psql -h $D -p $PORT -U postgres -d postgres -q"
$P -f scripts/sql-tests/repeat-guards.sql >/dev/null
R="'00000000-0000-0000-0000-0000000000aa'"
# две одновременные одинаковые записи и два одновременных сохранения дня кальянов
Q="begin; insert into news_posts(restaurant_id,title) values ($R,'n'); select pg_sleep(1); commit;"
$P -c "$Q" >"$D/a" 2>&1 & $P -c "$Q" >"$D/b" 2>&1 & wait
test "$($P -Atc "select count(*) from news_posts")" = 1
H="begin; select replace_hookah_sales($R,'2026-11-02','[{\"quantity\":2}]'); select pg_sleep(1); commit;"
$P -c "$H" >/dev/null & $P -c "$H" >/dev/null & wait
test "$($P -Atc "select count(*) from hookah_sales where date='2026-11-02'")" = 1
echo "PASS repeat guards"
