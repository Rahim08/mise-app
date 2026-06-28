// Guest order creation. Resolves the restaurant from the slug server-side (never trusts a
// client-supplied restaurant_id) and only allows orders on a published, orders-enabled menu.
//
// Returns the created order id and accepts tip / order_type — this is the stable contract
// that a future Mise POS sync will consume (see docs/integrations/mise-pos.md).
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export async function POST(req: NextRequest) {
  const { slug, items, total, tip, order_type, table_number, type } = await req.json()
  const isCall = type === 'waiter_call' // вызов официанта — без позиций
  if (!slug || (!isCall && (!Array.isArray(items) || items.length === 0))) {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 })
  }

  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  // Resolve the menu (multi-menu first, legacy menu_settings fallback).
  let restaurantId: string | null = null
  let menuId: string | null = null
  let published = false
  let allowOrders = false
  const { data: menu } = await admin
    .from('menus').select('id, restaurant_id, is_published, allow_orders').eq('slug', slug).maybeSingle()
  if (menu) {
    restaurantId = menu.restaurant_id; menuId = menu.id
    published = menu.is_published; allowOrders = menu.allow_orders
  } else {
    const { data: legacy } = await admin
      .from('menu_settings').select('restaurant_id, is_published, allow_orders').eq('slug', slug).maybeSingle()
    if (legacy) { restaurantId = legacy.restaurant_id; published = legacy.is_published; allowOrders = legacy.allow_orders }
  }

  if (!restaurantId || !published || !allowOrders) {
    return NextResponse.json({ error: 'Orders not available' }, { status: 403 })
  }

  // QR-меню — с тарифа Business (или comp_apps от супер-админа) + активная подписка
  const { data: rest } = await admin.from('restaurants').select('subscription_plan, subscription_status, comp_apps').eq('id', restaurantId).single()
  const subActive = ['active', 'trialing', 'canceling'].includes(rest?.subscription_status)
  if (!subActive || (!['business', 'pro'].includes(rest?.subscription_plan) && !(rest?.comp_apps || []).includes('menu'))) {
    return NextResponse.json({ error: 'Orders not available' }, { status: 403 })
  }

  // Вызов официанта кодируется маркером в items — без изменения схемы menu_orders.
  const { data, error } = await admin.from('menu_orders').insert({
    restaurant_id: restaurantId,
    menu_id: menuId,
    items: isCall ? [{ call: 'waiter' }] : items,
    total: isCall ? 0 : (total || 0),
    tip: isCall ? 0 : (Number(tip) || 0),
    order_type: order_type === 'pickup' ? 'pickup' : 'dine_in',
    source: 'qr',
    table_number: table_number ?? null,
    status: 'new',
  }).select('id').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ ok: true, id: data?.id })
}
