import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'

async function getCtx() {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll() } }
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Unauthorized', supabase, restaurantId: null }
  const { data } = await supabase.from('restaurants').select('id').eq('owner_id', user.id).single()
  return { supabase, restaurantId: data?.id ?? null, error: data ? null : 'No restaurant' }
}

export async function GET(req: NextRequest) {
  const { supabase, restaurantId, error } = await getCtx()
  if (error || !restaurantId) return NextResponse.json({ error }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status') // 'open' | 'paid' | null = all

  // Get active seatings with their orders and table info
  let q = supabase
    .from('pos_seatings')
    .select(`
      id, guests_count, opened_at, closed_at,
      pos_tables!inner(number, label, pos_floors!inner(name)),
      pos_orders(
        id, status, subtotal, discount_amount, tax_amount, total,
        pos_order_items(id, menu_item_id, menu_item_name, qty, unit_price, discount, status, note, modifiers)
      )
    `)
    .eq('pos_tables.restaurant_id', restaurantId)
    .order('opened_at', { ascending: false })
    .limit(100)

  if (status === 'open') {
    q = q.is('closed_at', null)
  } else if (status === 'paid') {
    q = q.not('closed_at', 'is', null)
  }

  const { data: seatings } = await q

  const orders = (seatings ?? []).flatMap((s: any) => {
    const table = s.pos_tables
    const floor = table?.pos_floors
    return (s.pos_orders ?? []).map((o: any) => ({
      id: o.id,
      table_number: table?.number ?? '?',
      table_label: table?.label ?? null,
      floor_name: floor?.name ?? '',
      status: o.status,
      subtotal: o.subtotal,
      discount_amount: o.discount_amount,
      total: o.total,
      opened_at: s.opened_at,
      guests: s.guests_count,
      items: (o.pos_order_items ?? []).map((i: any) => ({
        id: i.id,
        menu_item_name: i.menu_item_name,
        qty: i.qty,
        unit_price: i.unit_price,
        status: i.status,
        note: i.note,
        modifier_summary: Array.isArray(i.modifiers)
          ? i.modifiers.map((m: any) => m.option_name ?? m.name ?? '').filter(Boolean).join(', ')
          : '',
      })),
    }))
  })

  return NextResponse.json({ orders })
}
