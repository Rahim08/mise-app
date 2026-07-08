-- Атомарный rate-limit поверх БД (заменяет in-memory Map, который не работает между
-- serverless-инстансами Vercel) + закрывает TOCTOU-гонку в pin_attempts (read-then-write
-- инкремент из JS мог пропустить конкурентные попытки мимо лимита в 5).

-- 1. Общий rate-limit для остальных роутов (ai, admin, menu/event, menu/order, log, welcome).
CREATE TABLE IF NOT EXISTS rate_limits (
  key text PRIMARY KEY,
  count int NOT NULL DEFAULT 0,
  window_start timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY; -- доступ только service role

-- Атомарный upsert-инкремент: если окно истекло — сброс на 1, иначе +1. Инкремент
-- считается в самом SQL (count + 1), блокировка строки при UPSERT сериализует
-- конкурентные попытки. Возвращает true, если запрос разрешён (не превышен max).
CREATE OR REPLACE FUNCTION rate_limit_hit(p_key text, p_max int, p_window_ms int)
RETURNS boolean AS $$
DECLARE
  v_count int;
BEGIN
  INSERT INTO rate_limits (key, count, window_start)
  VALUES (p_key, 1, now())
  ON CONFLICT (key) DO UPDATE SET
    count = CASE WHEN now() - rate_limits.window_start > (p_window_ms || ' ms')::interval
                  THEN 1 ELSE rate_limits.count + 1 END,
    window_start = CASE WHEN now() - rate_limits.window_start > (p_window_ms || ' ms')::interval
                         THEN now() ELSE rate_limits.window_start END
  RETURNING count INTO v_count;
  RETURN v_count <= p_max;
END;
$$ LANGUAGE plpgsql;

-- 2. Тот же паттерн для pin_attempts — закрывает race в app/api/auth/pin/check.
-- Возвращает новый count (route сам решает блокировку по MAX_ATTEMPTS/BLOCK_MS).
CREATE OR REPLACE FUNCTION pin_record_failure(p_key text, p_max_attempts int, p_block_ms int)
RETURNS int AS $$
DECLARE
  v_count int;
BEGIN
  INSERT INTO pin_attempts (key, count, blocked_until, updated_at)
  VALUES (p_key, 1, NULL, now())
  ON CONFLICT (key) DO UPDATE SET
    count = pin_attempts.count + 1,
    updated_at = now()
  RETURNING count INTO v_count;

  IF v_count >= p_max_attempts THEN
    UPDATE pin_attempts SET blocked_until = now() + (p_block_ms || ' ms')::interval WHERE key = p_key;
  END IF;

  RETURN v_count;
END;
$$ LANGUAGE plpgsql;
