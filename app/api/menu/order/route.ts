// Guest order creation. Resolves the restaurant from the slug server-side (never trusts a
// client-supplied restaurant_id) and only allows orders on a published, orders-enabled menu.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export async function POST(req: NextRequest) {
  const { slug, items, total, table_number, type } = await req.json()
  const isCall = type === 'waiter_call' // вызов официанта — без позиций
  if (!slug || (!isCall && (!Array.isArray(items) || items.length === 0))) {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 })
  }

  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data: settings } = await admin
    .from('menu_settings').select('restaurant_id, is_published, allow_orders').eq('slug', slug).single()

  if (!settings || !settings.is_published || !settings.allow_orders) {
    return NextResponse.json({ error: 'Orders not available' }, { status: 403 })
  }

  // Вызов официанта кодируется маркером в items — без изменения схемы menu_orders.
  const { error } = await admin.from('menu_orders').insert({
    restaurant_id: settings.restaurant_id,
    items: isCall ? [{ call: 'waiter' }] : items,
    total: isCall ? 0 : total,
    table_number: table_number ?? null,
    status: 'new',
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ ok: true })
}
