// Anonymous menu analytics. Guests POST lightweight events (view / item_view /
// add_to_cart / checkout_click). Restaurant + menu are resolved server-side from the slug,
// so the client can't forge another venue's stats. Writes via service role (like
// /api/menu/order).
//
// checkout_click (аудит 2026-08-15, block-E #9): раньше называлось 'order', что легко
// спутать с реальным заказом (app/api/menu/order → menu_orders) — ничего их не связывает
// (нет общего id), это лёгкое клиентское событие "нажал отправить", не факт успешного
// заказа на сервере. Переименовано, чтобы аналитика по этому типу не читалась как
// «число реальных заказов».
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { checkRateLimit, rateLimitKey } from '@/lib/rateLimit'

const ALLOWED = new Set(['view', 'item_view', 'add_to_cart', 'checkout_click'])

export async function POST(req: NextRequest) {
  const rlKey = rateLimitKey(req, 'menu-event')
  if (!await checkRateLimit(rlKey, 60, 60_000)) return NextResponse.json({ error: 'Rate limit' }, { status: 429 })
  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }) }
  const { slug, type, item_id, session_id, table_number } = body || {}
  if (!slug || !ALLOWED.has(type)) return NextResponse.json({ error: 'Bad request' }, { status: 400 })

  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  // Resolve restaurant + menu from slug (multi-menu first, legacy fallback).
  let restaurantId: string | null = null
  let menuId: string | null = null
  const { data: menu } = await admin.from('menus').select('id, restaurant_id').eq('slug', slug).maybeSingle()
  if (menu) { restaurantId = menu.restaurant_id; menuId = menu.id }
  else {
    const { data: legacy } = await admin.from('menu_settings').select('restaurant_id').eq('slug', slug).maybeSingle()
    if (legacy) restaurantId = legacy.restaurant_id
  }
  if (!restaurantId) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Ошибку вставки раньше не проверяли — аналитика меню могла молча не писаться
  // (например, после смены схемы), и это никак не было видно.
  const { error } = await admin.from('menu_events').insert({
    restaurant_id: restaurantId,
    menu_id: menuId,
    type,
    item_id: item_id || null,
    session_id: typeof session_id === 'string' ? session_id.slice(0, 64) : null,
    table_number: table_number ? String(table_number).replace(/[^0-9a-zA-Zа-яА-Я-]/g, '').slice(0, 10) || null : null,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
