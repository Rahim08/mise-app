-- QR-меню (Mise Menu) #2: раскладка гостевого меню.
-- 'list' (по умолчанию, как было) или 'grid' (плитки с фото).
-- Редактор устойчив к отсутствию колонки (сохраняет без layout), но для
-- сохранения выбора раскладки нужна эта колонка. Идемпотентно.

ALTER TABLE menu_settings
  ADD COLUMN IF NOT EXISTS layout text NOT NULL DEFAULT 'list';
