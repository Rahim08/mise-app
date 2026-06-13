-- =============================================================================
-- mise — ДЕМО-СЧЁТ для проверки Apple App Review (и собственных демонстраций).
--
-- ЧТО ДЕЛАЕТ (одним запуском):
--   1. Создаёт демо-владельца в auth.users (email+пароль — РЕАЛЬНЫЙ ПОЧТОВЫЙ ЯЩИК
--      НЕ НУЖЕН, вход работает сразу: e-mail уже подтверждён).
--   2. Создаёт ресторан «Mise Demo Lounge» на тарифе PRO с активной подпиской и
--      БЕЗ owner_pin → владелец заходит во все приложения сразу, без QR/PIN.
--   3. Наполняет ВСЕ приложения реалистичными данными за ~30 дней:
--      Manager (смены нал/безнал/расходы/инкассация), Analytics (выручка/ЗП/кальян),
--      Stash (виды кальянов, продажи, склад табака), People (сотрудники, график,
--      явка, заказы), Menu (категории, блюда, гостевые заказы, опубликованное QR-меню).
--
-- КАК ЗАПУСТИТЬ:
--   Supabase → SQL Editor → вставить весь файл → Run. Идемпотентно (можно гонять
--   повторно — старый демо-аккаунт пересоздаётся начисто, твои реальные данные не трогаются).
--
-- КРЕДЫ ДЛЯ APP STORE CONNECT (App Review Information → Sign-In required):
--   E-mail:  demo@getmise.app
--   Пароль:  MiseDemo2026!
--
-- ПУБЛИЧНОЕ QR-МЕНЮ (для демонстрации гостевого меню):
--   https://mise-app-omega.vercel.app/menu/demo
-- =============================================================================

-- pgcrypto нужен для хеширования пароля (crypt/gen_salt). В Supabase уже включён.
create extension if not exists pgcrypto;

DO $$
DECLARE
  -- Фиксированные UUID → идемпотентность и ссылочная целостность.
  v_uid uuid := 'd0d0d0d0-0000-4000-8000-000000000001';  -- демо-владелец (auth.users.id)
  v_rid uuid := 'd0d0d0d0-0000-4000-8000-0000000000a1';  -- ресторан

  v_email text := 'demo@getmise.app';
  v_pass  text := 'MiseDemo2026!';

  -- Сотрудники (employees — для ЗП/аналитики)
  e_sara   uuid := 'd0d0d0d0-0000-4000-8000-00000000e001';  -- управляющая
  e_marco  uuid := 'd0d0d0d0-0000-4000-8000-00000000e002';  -- официант
  e_giulia uuid := 'd0d0d0d0-0000-4000-8000-00000000e003';  -- официант
  e_anton  uuid := 'd0d0d0d0-0000-4000-8000-00000000e004';  -- кальянщик

  -- Staff (для приложений / графика / явки)
  s_sara   uuid := 'd0d0d0d0-0000-4000-8000-00000000c001';
  s_anton  uuid := 'd0d0d0d0-0000-4000-8000-00000000c002';
  s_marco  uuid := 'd0d0d0d0-0000-4000-8000-00000000c003';

  -- Виды кальянов
  ht_classic uuid := 'd0d0d0d0-0000-4000-8000-000000000a01';
  ht_premium uuid := 'd0d0d0d0-0000-4000-8000-000000000a02';
  ht_fruit   uuid := 'd0d0d0d0-0000-4000-8000-000000000a03';

  -- Категории расходов
  ec_food     uuid := 'd0d0d0d0-0000-4000-8000-000000000f01';
  ec_coal     uuid := 'd0d0d0d0-0000-4000-8000-000000000f02';
  ec_delivery uuid := 'd0d0d0d0-0000-4000-8000-000000000f03';
  ec_salary   uuid := 'd0d0d0d0-0000-4000-8000-000000000f04';
  ec_other    uuid := 'd0d0d0d0-0000-4000-8000-000000000f05';

  -- Категории меню
  mc_hookah  uuid := 'd0d0d0d0-0000-4000-8000-000000000b01';
  mc_drinks  uuid := 'd0d0d0d0-0000-4000-8000-000000000b02';
  mc_snacks  uuid := 'd0d0d0d0-0000-4000-8000-000000000b03';
  mc_dessert uuid := 'd0d0d0d0-0000-4000-8000-000000000b04';

  v_month text := to_char(CURRENT_DATE, 'YYYY-MM');

  -- переменные цикла смен
  i          int;
  v_date     date;
  v_shift    uuid;
  v_cash     numeric;
  v_card     numeric;
  v_exp      numeric;
  v_open_bal numeric;
  v_status   text;
  v_closed   timestamptz;
  v_qty1     int;
  v_qty2     int;
  v_qty3     int;
  v_free     int;
BEGIN
  -- ===========================================================================
  -- 0. ОЧИСТКА предыдущего демо (идемпотентность). Чистим строго по демо-ресторану
  --    и демо-владельцу — реальные данные не затрагиваются.
  -- ===========================================================================
  -- Чистим данные ВСЕХ ресторанов, когда-либо принадлежавших демо-владельцу
  -- (id ресторана может отличаться между прогонами — его создаёт триггер регистрации).
  DELETE FROM hookah_sales        WHERE restaurant_id IN (SELECT id FROM restaurants WHERE owner_id = v_uid);
  DELETE FROM tobacco_movements   WHERE restaurant_id IN (SELECT id FROM restaurants WHERE owner_id = v_uid);
  DELETE FROM tobacco_stock       WHERE restaurant_id IN (SELECT id FROM restaurants WHERE owner_id = v_uid);
  DELETE FROM shift_expenses      WHERE restaurant_id IN (SELECT id FROM restaurants WHERE owner_id = v_uid);
  DELETE FROM shift_absences      WHERE restaurant_id IN (SELECT id FROM restaurants WHERE owner_id = v_uid);
  DELETE FROM inkassations        WHERE restaurant_id IN (SELECT id FROM restaurants WHERE owner_id = v_uid);
  DELETE FROM monthly_card_amounts WHERE restaurant_id IN (SELECT id FROM restaurants WHERE owner_id = v_uid);
  DELETE FROM attendance_records  WHERE restaurant_id IN (SELECT id FROM restaurants WHERE owner_id = v_uid);
  DELETE FROM staff_schedules     WHERE restaurant_id IN (SELECT id FROM restaurants WHERE owner_id = v_uid);
  DELETE FROM notifications       WHERE restaurant_id IN (SELECT id FROM restaurants WHERE owner_id = v_uid);
  DELETE FROM menu_orders         WHERE restaurant_id IN (SELECT id FROM restaurants WHERE owner_id = v_uid);
  DELETE FROM menu_items          WHERE restaurant_id IN (SELECT id FROM restaurants WHERE owner_id = v_uid);
  DELETE FROM menu_categories     WHERE restaurant_id IN (SELECT id FROM restaurants WHERE owner_id = v_uid);
  DELETE FROM menu_settings       WHERE restaurant_id IN (SELECT id FROM restaurants WHERE owner_id = v_uid);
  DELETE FROM expense_categories  WHERE restaurant_id IN (SELECT id FROM restaurants WHERE owner_id = v_uid);
  DELETE FROM hookah_types        WHERE restaurant_id IN (SELECT id FROM restaurants WHERE owner_id = v_uid);
  DELETE FROM shifts              WHERE restaurant_id IN (SELECT id FROM restaurants WHERE owner_id = v_uid);
  DELETE FROM staff               WHERE restaurant_id IN (SELECT id FROM restaurants WHERE owner_id = v_uid);
  DELETE FROM employees           WHERE restaurant_id IN (SELECT id FROM restaurants WHERE owner_id = v_uid);
  DELETE FROM restaurant_settings WHERE restaurant_id IN (SELECT id FROM restaurants WHERE owner_id = v_uid);
  -- profiles.restaurant_id ссылается на ресторан (без каскада) → снимаем ссылку до удаления
  DELETE FROM profiles            WHERE id = v_uid OR restaurant_id IN (SELECT id FROM restaurants WHERE owner_id = v_uid);
  DELETE FROM restaurants         WHERE owner_id = v_uid;
  DELETE FROM auth.identities     WHERE user_id = v_uid;
  DELETE FROM auth.users          WHERE id = v_uid;

  -- ===========================================================================
  -- 1. ДЕМО-ВЛАДЕЛЕЦ (auth.users + auth.identities). Пароль хешируется bcrypt.
  -- ===========================================================================
  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data,
    confirmation_token, recovery_token, email_change, email_change_token_new
  ) VALUES (
    '00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated',
    v_email, crypt(v_pass, gen_salt('bf')),
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('restaurant_name', 'Mise Demo Lounge'),
    '', '', '', ''
  );

  INSERT INTO auth.identities (
    id, user_id, provider_id, identity_data, provider,
    last_sign_in_at, created_at, updated_at
  ) VALUES (
    gen_random_uuid(), v_uid, v_uid::text,
    jsonb_build_object('sub', v_uid::text, 'email', v_email, 'email_verified', true, 'phone_verified', false),
    'email', now(), now(), now()
  );

  -- ===========================================================================
  -- 2. РЕСТОРАН — ПРИСВАИВАЕМ ресторан, созданный триггером регистрации, под демо.
  --    (Не боремся с триггером: берём его ресторан и приводим к демо-виду — так
  --     не зависим от того, какие дочерние строки триггер успел создать.)
  -- ===========================================================================
  SELECT id INTO v_rid FROM restaurants WHERE owner_id = v_uid ORDER BY created_at DESC LIMIT 1;
  IF v_rid IS NULL THEN
    -- триггера нет → создаём ресторан сами
    v_rid := gen_random_uuid();
    INSERT INTO restaurants (id, owner_id, name, created_at) VALUES (v_rid, v_uid, 'Mise Demo Lounge', now());
  END IF;

  -- Приводим к демо-виду: PRO, активная подписка, без owner_pin
  UPDATE restaurants SET
    name = 'Mise Demo Lounge', is_active = true,
    subscription_status = 'active', subscription_plan = 'pro',
    subscription_ends_at = now() + interval '1 year',
    currency = '€', comp_apps = '{}', discount_pct = 0, owner_pin = NULL,
    created_at = now() - interval '40 days'
  WHERE id = v_rid;

  -- Если триггер создал несколько ресторанов — оставляем один (чистим лишние и их ссылки)
  DELETE FROM profiles            WHERE restaurant_id IN (SELECT id FROM restaurants WHERE owner_id = v_uid AND id <> v_rid);
  DELETE FROM restaurant_settings WHERE restaurant_id IN (SELECT id FROM restaurants WHERE owner_id = v_uid AND id <> v_rid);
  DELETE FROM menu_settings       WHERE restaurant_id IN (SELECT id FROM restaurants WHERE owner_id = v_uid AND id <> v_rid);
  DELETE FROM restaurants         WHERE owner_id = v_uid AND id <> v_rid;

  -- Профиль владельца указывает на демо-ресторан
  INSERT INTO profiles (id, full_name, role, restaurant_id)
  VALUES (v_uid, 'Demo Owner', 'owner', v_rid)
  ON CONFLICT (id) DO UPDATE SET restaurant_id = v_rid, role = 'owner';

  -- Настройки заведения (перезаписываем — триггер мог их создать)
  DELETE FROM restaurant_settings WHERE restaurant_id = v_rid;
  INSERT INTO restaurant_settings (
    restaurant_id, name, currency, timezone, working_days,
    latitude, longitude, geo_radius_m, attendance_enabled,
    reminder_mode, reminder_hours, reminder_time,
    include_card_in_analytics, hookah_price, hookah_portion_g
  ) VALUES (
    v_rid, 'Mise Demo Lounge', '€', 'Europe/Rome', 26,
    41.9028, 12.4964, 150, true,     -- координаты центра Рима для демонстрации геолокации явки
    'hours_before', 12, '18:00',
    true, 20, 20
  );

  -- Защита: чистим дочерние данные присвоенного ресторана (вдруг триггер засеял
  -- дефолты — категории и т.п.), FK-безопасный порядок. Делает демо детерминированным.
  DELETE FROM hookah_sales        WHERE restaurant_id = v_rid;
  DELETE FROM tobacco_movements   WHERE restaurant_id = v_rid;
  DELETE FROM tobacco_stock       WHERE restaurant_id = v_rid;
  DELETE FROM shift_expenses      WHERE restaurant_id = v_rid;
  DELETE FROM shift_absences      WHERE restaurant_id = v_rid;
  DELETE FROM inkassations        WHERE restaurant_id = v_rid;
  DELETE FROM monthly_card_amounts WHERE restaurant_id = v_rid;
  DELETE FROM attendance_records  WHERE restaurant_id = v_rid;
  DELETE FROM staff_schedules     WHERE restaurant_id = v_rid;
  DELETE FROM notifications       WHERE restaurant_id = v_rid;
  DELETE FROM menu_orders         WHERE restaurant_id = v_rid;
  DELETE FROM menu_items          WHERE restaurant_id = v_rid;
  DELETE FROM menu_categories     WHERE restaurant_id = v_rid;
  DELETE FROM menu_settings       WHERE restaurant_id = v_rid;
  DELETE FROM expense_categories  WHERE restaurant_id = v_rid;
  DELETE FROM hookah_types        WHERE restaurant_id = v_rid;
  DELETE FROM shifts              WHERE restaurant_id = v_rid;
  DELETE FROM staff               WHERE restaurant_id = v_rid;
  DELETE FROM employees           WHERE restaurant_id = v_rid;

  -- ===========================================================================
  -- 3. СОТРУДНИКИ (employees) и STAFF (доступ к приложениям)
  -- ===========================================================================
  INSERT INTO employees (id, restaurant_id, name, salary, deduct_per_absence, card_amount, is_active, created_at) VALUES
    (e_sara,   v_rid, 'Sara Conte',     1800, 60, 1200, true, now() - interval '35 days'),
    (e_marco,  v_rid, 'Marco Rossi',    1400, 50,  900, true, now() - interval '30 days'),
    (e_giulia, v_rid, 'Giulia Bianchi', 1400, 50,  900, true, now() - interval '25 days'),
    (e_anton,  v_rid, 'Anton Petrov',   1600, 55, 1000, true, now() - interval '28 days');

  -- pin_hash валиден (PIN 1234), но в демо вход идёт по логину владельца — staff-PIN не нужен.
  INSERT INTO staff (id, restaurant_id, name, pin_hash, apps, is_active, created_at, role) VALUES
    (s_sara,  v_rid, 'Sara Conte',   crypt('1234', gen_salt('bf')), ARRAY['manager','analytics','people'], true, now(), 'manager'),
    (s_anton, v_rid, 'Anton Petrov', crypt('1234', gen_salt('bf')), ARRAY['stash'],                        true, now(), 'hookah'),
    (s_marco, v_rid, 'Marco Rossi',  crypt('1234', gen_salt('bf')), ARRAY['people'],                       true, now(), 'waiter');

  -- ===========================================================================
  -- 4. КАТЕГОРИИ РАСХОДОВ
  -- ===========================================================================
  INSERT INTO expense_categories (id, restaurant_id, name, is_salary) VALUES
    (ec_food,     v_rid, 'Groceries', false),
    (ec_coal,     v_rid, 'Coal',      false),
    (ec_delivery, v_rid, 'Delivery',  false),
    (ec_salary,   v_rid, 'Salary',    true),
    (ec_other,    v_rid, 'Other',     false);

  -- ===========================================================================
  -- 5. ВИДЫ КАЛЬЯНОВ (Stash)
  -- ===========================================================================
  INSERT INTO hookah_types (id, restaurant_id, name, price, portion_g, brands, is_active) VALUES
    (ht_classic, v_rid, 'Classic', 15, 20, ARRAY['Darkside','Element'], true),
    (ht_premium, v_rid, 'Premium', 25, 25, ARRAY['Musthave','Tangiers'], true),
    (ht_fruit,   v_rid, 'Fruit bowl', 30, 30, ARRAY['Adalya'], true);

  -- ===========================================================================
  -- 6. СКЛАД ТАБАКА (одна позиция ниже минимума → алерт «заканчивается» на дашборде)
  -- ===========================================================================
  INSERT INTO tobacco_stock (restaurant_id, flavor_name, brand, flavor, quantity_g, min_quantity_g, updated_at) VALUES
    (v_rid, 'Darkside — Bananapapa',  'Darkside',  'Bananapapa',   620, 200, now()),
    (v_rid, 'Musthave — Pinkman',     'Musthave',  'Pinkman',      450, 200, now()),
    (v_rid, 'Adalya — Lady Killer',   'Adalya',    'Lady Killer',  140, 200, now()),  -- ниже минимума
    (v_rid, 'Element — Grapefruit',   'Element',   'Grapefruit',   780, 200, now()),
    (v_rid, 'Tangiers — Cane Mint',   'Tangiers',  'Cane Mint',     90, 150, now()),  -- ниже минимума
    (v_rid, 'Darkside — Supernova',   'Darkside',  'Supernova',    540, 200, now());

  INSERT INTO tobacco_movements (restaurant_id, type, quantity_g, reason, brand, flavor, created_at) VALUES
    (v_rid, 'in',  1000, 'Поставка',  'Darkside', 'Bananapapa', now() - interval '14 days'),
    (v_rid, 'in',   500, 'Поставка',  'Adalya',   'Lady Killer', now() - interval '10 days'),
    (v_rid, 'out',  100, 'Списание (отсырел)', 'Tangiers', 'Cane Mint', now() - interval '3 days'),
    (v_rid, 'in',   500, 'Поставка',  'Element',  'Grapefruit', now() - interval '6 days');

  -- ===========================================================================
  -- 7. МЕНЮ: категории + блюда
  -- ===========================================================================
  INSERT INTO menu_categories (id, restaurant_id, name, description, position, is_visible) VALUES
    (mc_hookah,  v_rid, 'Hookah',   'Premium tobacco blends',     1, true),
    (mc_drinks,  v_rid, 'Drinks',   'Cocktails, tea & soft',      2, true),
    (mc_snacks,  v_rid, 'Snacks',   'Small plates to share',      3, true),
    (mc_dessert, v_rid, 'Desserts', 'Sweet finish',               4, true);

  INSERT INTO menu_items (restaurant_id, category_id, name, description, price, is_visible, is_available, calories, position) VALUES
    (v_rid, mc_hookah,  'Classic Hookah',  'House blend, your choice of flavor',        15, true, true, NULL, 1),
    (v_rid, mc_hookah,  'Premium Hookah',  'Musthave / Tangiers, fuller body',          25, true, true, NULL, 2),
    (v_rid, mc_hookah,  'Fruit Bowl',      'Served in a fresh pineapple or grapefruit', 30, true, true, NULL, 3),
    (v_rid, mc_drinks,  'Moroccan Mint Tea','Pot, serves two',                           8, true, true,  90, 1),
    (v_rid, mc_drinks,  'Fresh Lemonade',  'Mint & lime',                                6, true, true, 120, 2),
    (v_rid, mc_drinks,  'Espresso',        'Single origin',                              3, true, true,   5, 3),
    (v_rid, mc_snacks,  'Hummus & Pita',   'Warm pita, olive oil',                       9, true, true, 320, 1),
    (v_rid, mc_snacks,  'Mixed Olives',    'Marinated, citrus zest',                     5, true, true, 150, 2),
    (v_rid, mc_snacks,  'Cheese Plate',    'Selection of three',                        14, true, true, 540, 3),
    (v_rid, mc_dessert, 'Baklava',         'Pistachio, honey',                           7, true, true, 410, 1),
    (v_rid, mc_dessert, 'Tiramisu',        'Classic recipe',                             7, true, true, 380, 2);

  -- Опубликованное QR-меню: /menu/demo, заказ за столом включён
  INSERT INTO menu_settings (restaurant_id, slug, is_published, theme, accent_color, show_photos, allow_orders, show_calories, language, allow_pay_at_table)
  VALUES (v_rid, 'demo', true, 'dark', '#8e8e93', true, true, true, 'en', true);

  -- ===========================================================================
  -- 8. СМЕНЫ за 30 дней (Manager) + расходы + продажи кальянов (Stash/Analytics)
  -- ===========================================================================
  FOR i IN 0..29 LOOP
    v_date := CURRENT_DATE - i;

    -- Детерминированные «реалистичные» суммы; выходные (пт/сб) выше.
    v_cash := 420 + ((i * 37) % 280) + (CASE WHEN EXTRACT(DOW FROM v_date) IN (5,6) THEN 180 ELSE 0 END);
    v_card := 130 + ((i * 23) % 190) + (CASE WHEN EXTRACT(DOW FROM v_date) IN (5,6) THEN 90  ELSE 0 END);
    v_open_bal := 200;

    -- Сегодняшняя смена остаётся ОТКРЫТОЙ (демонстрирует активную смену в Manager)
    IF i = 0 THEN
      v_status := 'open';  v_closed := NULL;
    ELSE
      v_status := 'closed'; v_closed := (v_date + time '23:30') AT TIME ZONE 'Europe/Rome';
    END IF;

    -- Кальяны по видам (распределение зависит от дня)
    v_qty1 := 6 + (i % 5);          -- Classic
    v_qty2 := 3 + (i % 4);          -- Premium
    v_qty3 := 1 + (i % 3);          -- Fruit
    v_free := (CASE WHEN i % 6 = 0 THEN 2 ELSE 0 END);  -- комплименты/для своих

    INSERT INTO shifts (
      id, restaurant_id, manager_id, opened_by, opened_at, closed_at, status,
      date, opening_balance, income, income_card, inkassation,
      total_income, total_expense, closing_balance, notes
    ) VALUES (
      gen_random_uuid(), v_rid, v_uid, v_uid,   -- opened_by/manager_id → auth.users (демо-владелец)
      (v_date + time '11:00') AT TIME ZONE 'Europe/Rome', v_closed, v_status,
      v_date, v_open_bal, v_cash, v_card,
      CASE WHEN i = 0 THEN 0 ELSE v_cash END,           -- инкассация = собранный нал (кроме открытой смены)
      v_cash + v_card, 0, v_open_bal, NULL
    ) RETURNING id INTO v_shift;

    -- Расходы смены (1–2 строки)
    v_exp := 0;
    INSERT INTO shift_expenses (shift_id, restaurant_id, category_id, category_name, amount, note, created_at)
    VALUES (v_shift, v_rid, ec_food, 'Groceries', 60 + (i % 5) * 12, 'Закупка продуктов', v_closed);
    v_exp := v_exp + 60 + (i % 5) * 12;

    IF i % 3 = 0 THEN
      INSERT INTO shift_expenses (shift_id, restaurant_id, category_id, category_name, amount, note, created_at)
      VALUES (v_shift, v_rid, ec_coal, 'Coal', 35, 'Уголь', v_closed);
      v_exp := v_exp + 35;
    END IF;
    IF i % 7 = 0 THEN
      INSERT INTO shift_expenses (shift_id, restaurant_id, category_id, category_name, amount, note, created_at)
      VALUES (v_shift, v_rid, ec_delivery, 'Delivery', 20, 'Доставка', v_closed);
      v_exp := v_exp + 20;
    END IF;

    UPDATE shifts SET total_expense = v_exp, closing_balance = v_open_bal + v_cash - v_exp WHERE id = v_shift;

    -- Инкассация дня (нал минус расход; по пятницам — выплата ЗП)
    IF i <> 0 THEN
      INSERT INTO inkassations (restaurant_id, date, amount, expense, salary, salary_note, total, reason, created_at)
      VALUES (
        v_rid, v_date, v_cash, v_exp,
        CASE WHEN EXTRACT(DOW FROM v_date) = 5 THEN 200 ELSE 0 END,
        CASE WHEN EXTRACT(DOW FROM v_date) = 5 THEN 'Аванс смене' ELSE NULL END,
        v_cash - v_exp - (CASE WHEN EXTRACT(DOW FROM v_date) = 5 THEN 200 ELSE 0 END),
        'Сдача кассы', v_closed
      );
    END IF;

    -- Продажи кальянов по видам (история не плывёт: цена и порция фиксируются)
    INSERT INTO hookah_sales (restaurant_id, shift_id, hookah_type_id, quantity, price, portion_g, is_free, date, created_at) VALUES
      (v_rid, v_shift, ht_classic, v_qty1, 15, 20, false, v_date, v_closed),
      (v_rid, v_shift, ht_premium, v_qty2, 25, 25, false, v_date, v_closed),
      (v_rid, v_shift, ht_fruit,   v_qty3, 30, 30, false, v_date, v_closed);
    IF v_free > 0 THEN
      INSERT INTO hookah_sales (restaurant_id, shift_id, hookah_type_id, quantity, price, portion_g, is_free, date, created_at)
      VALUES (v_rid, v_shift, ht_classic, v_free, 15, 20, true, v_date, v_closed);
    END IF;
  END LOOP;

  -- ===========================================================================
  -- 9. ЗАРПЛАТА: помесячная сумма «на карту» (Analytics → Зарплата) + пара прогулов
  -- ===========================================================================
  INSERT INTO monthly_card_amounts (restaurant_id, employee_id, month, card_amount) VALUES
    (v_rid, e_sara,   v_month, 1200),
    (v_rid, e_marco,  v_month,  900),
    (v_rid, e_giulia, v_month,  850),
    (v_rid, e_anton,  v_month, 1000);

  INSERT INTO shift_absences (restaurant_id, employee_id, date) VALUES
    (v_rid, e_marco,  CURRENT_DATE - 9),
    (v_rid, e_giulia, CURRENT_DATE - 4);

  -- ===========================================================================
  -- 10. PEOPLE: график на неделю вперёд + явка + заказы + уведомления
  -- ===========================================================================
  FOR i IN 0..6 LOOP
    v_date := CURRENT_DATE + i;
    INSERT INTO staff_schedules (restaurant_id, staff_id, date, shift_start, shift_end, published) VALUES
      (v_rid, s_sara,  v_date, '11:00', '23:00', true),
      (v_rid, s_marco, v_date, '12:00', '00:00', true),
      (v_rid, s_anton, v_date, '17:00', '02:00', true);
  END LOOP;

  -- Явка за последние дни (foreground check-in рядом с заведением)
  FOR i IN 1..5 LOOP
    v_date := CURRENT_DATE - i;
    INSERT INTO attendance_records (restaurant_id, staff_id, date, check_in_at, check_in_lat, check_in_lng, check_in_distance_m, late_minutes, status, source) VALUES
      (v_rid, s_sara,  v_date, (v_date + time '10:55') AT TIME ZONE 'Europe/Rome', 41.9028, 12.4964, 18, 0, 'present', 'manual'),
      (v_rid, s_marco, v_date, (v_date + time '12:08') AT TIME ZONE 'Europe/Rome', 41.9029, 12.4963, 30, 8, 'present', 'manual'),
      (v_rid, s_anton, v_date, (v_date + time '17:02') AT TIME ZONE 'Europe/Rome', 41.9027, 12.4965, 22, 2, 'present', 'manual');
  END LOOP;

  -- Гостевые заказы из QR-меню (инбокс People + «заказы сегодня» на дашборде)
  INSERT INTO menu_orders (restaurant_id, table_number, items, total, status, created_at) VALUES
    (v_rid, '4',  '[{"name":"Premium Hookah","qty":1,"price":25,"opts":["Musthave"]},{"name":"Moroccan Mint Tea","qty":1,"price":8}]'::jsonb, 33, 'new',  now() - interval '12 minutes'),
    (v_rid, '7',  '[{"name":"Classic Hookah","qty":2,"price":15},{"name":"Fresh Lemonade","qty":2,"price":6}]'::jsonb, 42, 'new',  now() - interval '35 minutes'),
    (v_rid, '2',  '[{"name":"Fruit Bowl","qty":1,"price":30},{"name":"Hummus & Pita","qty":1,"price":9},{"name":"Baklava","qty":2,"price":7}]'::jsonb, 53, 'done', now() - interval '3 hours'),
    (v_rid, '5',  '[{"name":"Cheese Plate","qty":1,"price":14},{"name":"Espresso","qty":2,"price":3}]'::jsonb, 20, 'done', now() - interval '1 day');

  -- Вызов официанта (цифровой счёт) — отдельная карточка в инбоксе
  INSERT INTO menu_orders (restaurant_id, table_number, items, total, status, created_at) VALUES
    (v_rid, '7', '[{"call":"waiter"}]'::jsonb, 0, 'new', now() - interval '5 minutes');

  -- Уведомления для колокольчика
  INSERT INTO notifications (restaurant_id, staff_id, type, title, body, created_at) VALUES
    (v_rid, s_sara, 'order',   'Новый заказ',  'Стол 4 · Premium Hookah, Mint Tea', now() - interval '12 minutes'),
    (v_rid, s_sara, 'low_stock','Табак заканчивается', 'Adalya — Lady Killer: 140 г', now() - interval '2 hours');

END $$;

-- =============================================================================
-- ГОТОВО. Проверь, что демо-аккаунт собрался:
--   select email from auth.users where email = 'demo@getmise.app';
--   select name, subscription_plan, subscription_status from restaurants
--     where owner_id = 'd0d0d0d0-0000-4000-8000-000000000001';
-- Вход в приложение: demo@getmise.app / MiseDemo2026!
-- =============================================================================
