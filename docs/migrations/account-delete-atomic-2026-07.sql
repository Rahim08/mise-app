-- Атомарное удаление аккаунта: оборачивает явный список DELETE из
-- app/api/account/delete/route.ts в один вызов функции, так что весь набор
-- удалений — одна неявная Postgres-транзакция (откат целиком при любой ошибке).
-- Список и порядок таблиц зеркалят route.ts — не все таблицы имеют ON DELETE
-- CASCADE на restaurant_id (см. комментарий в route.ts), поэтому явный список,
-- не удаление одной restaurants-строки с расчётом на каскад.

CREATE OR REPLACE FUNCTION delete_restaurant_account(p_restaurant_id uuid, p_user_id uuid)
RETURNS void AS $$
BEGIN
  DELETE FROM hookah_sales WHERE restaurant_id = p_restaurant_id;
  DELETE FROM tobacco_movements WHERE restaurant_id = p_restaurant_id;
  DELETE FROM tobacco_stock WHERE restaurant_id = p_restaurant_id;
  DELETE FROM shift_expenses WHERE restaurant_id = p_restaurant_id;
  DELETE FROM shift_absences WHERE restaurant_id = p_restaurant_id;
  DELETE FROM inkassations WHERE restaurant_id = p_restaurant_id;
  DELETE FROM monthly_card_amounts WHERE restaurant_id = p_restaurant_id;
  DELETE FROM attendance_records WHERE restaurant_id = p_restaurant_id;
  DELETE FROM staff_schedules WHERE restaurant_id = p_restaurant_id;
  DELETE FROM notifications WHERE restaurant_id = p_restaurant_id;
  DELETE FROM menu_orders WHERE restaurant_id = p_restaurant_id;
  DELETE FROM menu_items WHERE restaurant_id = p_restaurant_id;
  DELETE FROM menu_categories WHERE restaurant_id = p_restaurant_id;
  DELETE FROM menu_settings WHERE restaurant_id = p_restaurant_id;
  DELETE FROM expense_categories WHERE restaurant_id = p_restaurant_id;
  DELETE FROM hookah_types WHERE restaurant_id = p_restaurant_id;
  DELETE FROM shifts WHERE restaurant_id = p_restaurant_id;
  DELETE FROM staff WHERE restaurant_id = p_restaurant_id;
  DELETE FROM employees WHERE restaurant_id = p_restaurant_id;
  DELETE FROM restaurant_settings WHERE restaurant_id = p_restaurant_id;

  -- profiles has no CASCADE on restaurant_id
  DELETE FROM profiles WHERE id = p_user_id OR restaurant_id = p_restaurant_id;

  DELETE FROM restaurants WHERE id = p_restaurant_id;
END;
$$ LANGUAGE plpgsql;
