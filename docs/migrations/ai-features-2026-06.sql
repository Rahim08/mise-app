-- AI assistant toggle per restaurant.
-- admin can enable manually for any plan; Pro plan always has access without this flag.
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS ai_enabled boolean DEFAULT false;
