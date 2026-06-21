-- Device limit per restaurant. NULL = use plan default (starter=2, business=5, pro=10).
-- Admin can override manually via /admin panel or Supabase Table Editor.
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS device_limit int;
