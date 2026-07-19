-- Расходные категории: soft-delete вместо хардового delete (2026-07-19).
-- Раньше «удалить категорию → добавить с тем же названием» создавало дубль с новым id
-- и сбрасывало is_pinned. Теперь как у hookah_types: is_active=false вместо DELETE,
-- повторное добавление того же имени реактивирует старую строку.

ALTER TABLE expense_categories
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
