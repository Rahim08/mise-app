-- Категории бесплатных кальянов настраиваются владельцем (дашборд → Настройки → Кальян).
-- Хранятся в restaurant_settings.free_hookah_categories (jsonb-массив строк).
-- Кальянщик в Stash выбирает категорию из этого списка → вид кальяна → количество.
ALTER TABLE restaurant_settings
  ADD COLUMN IF NOT EXISTS free_hookah_categories jsonb NOT NULL
  DEFAULT '["Сотрудники","Владелец","Менеджер","Гость","Дегустация"]'::jsonb;
