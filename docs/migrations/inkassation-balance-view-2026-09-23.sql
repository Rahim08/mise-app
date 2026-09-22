-- Баланс инкассации одной строкой (2026-09-23).
--
--   Юзер-фидбок: плашка «общая сумма инкассации» (cumulativeInkass, веб+iOS) грузится
--   медленно и не ускорилась вместе с остальным. Причина: и веб (app/analytics/page.tsx),
--   и iOS (AnalyticsView.load), и Manager→ЗП (app/manager/tabs-salary.tsx) считали её,
--   перекачивая на клиент ВСЮ историю shifts (date, inkassation) и ВСЮ историю inkassations
--   (expense, salary) без диапазона — растёт с каждой сменой заведения за всё время жизни
--   ресторана, и это гонялось заново при каждом pull-to-refresh.
--
--   Эта VIEW считает сумму на стороне Postgres и отдаёт 1 строку вместо тысяч.
--   Обновляет docs/migrations/financial-integrity-checks-2026-09-19.sql: та версия не
--   знала про inkassation_topups (появилась позже, inkassation-topups-2026-09-21.sql) —
--   CREATE OR REPLACE безопасно перезаписывает то же имя, добавляя topups в баланс.
--
--   Доступ — только через /api/db (service-role), как у остальных денежных таблиц; вьюха
--   сама RLS не имеет (Postgres не разрешает ALTER ... ENABLE ROW LEVEL SECURITY на view),
--   но шлюз госстрого скопирует restaurant_id-скоуп так же, как для обычной таблицы.

-- CREATE OR REPLACE VIEW не даёт переставлять/переименовывать существующие колонки —
-- только менять их формулу или добавлять новые СТРОГО в конец (иначе 42P16). Старая vieha
-- (financial-integrity-checks-2026-09-19.sql) уже имеет restaurant_id/gross/deducted/balance
-- в этом порядке — сохраняем порядок и имена, topups добавляем 5-й колонкой.
create or replace view inkassation_balance as
select
  coalesce(g.restaurant_id, d.restaurant_id, t.restaurant_id) as restaurant_id,
  coalesce(g.gross, 0) as gross,
  coalesce(d.deducted, 0) as deducted,
  coalesce(g.gross, 0) - coalesce(d.deducted, 0) + coalesce(t.topups, 0) as balance,
  coalesce(t.topups, 0) as topups
from (select restaurant_id, sum(coalesce(inkassation, 0)) as gross from shifts group by restaurant_id) g
full join (select restaurant_id, sum(coalesce(expense, 0) + coalesce(salary, 0)) as deducted from inkassations group by restaurant_id) d
  on d.restaurant_id = g.restaurant_id
full join (select restaurant_id, sum(amount) as topups from inkassation_topups group by restaurant_id) t
  on t.restaurant_id = coalesce(g.restaurant_id, d.restaurant_id);
