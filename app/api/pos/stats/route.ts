import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'

export async function GET(req: NextRequest) {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll() } }
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: restaurant } = await supabase
    .from('restaurants').select('id').eq('owner_id', user.id).single()
  if (!restaurant) return NextResponse.json({ error: 'No restaurant' }, { status: 404 })
  const rid = restaurant.id
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)

  const [tablesRes, openRes, ordersRes, menuRes, devicesRes, sessionsRes] = await Promise.all([
    supabase.from('pos_tables').select('id', { count: 'exact', head: true }).eq('restaurant_id', rid),
    supabase.from('pos_tables').select('id', { count: 'exact', head: true }).eq('restaurant_id', rid).eq('status', 'occupied'),
    supabase.from('pos_orders').select('total').eq('restaurant_id', rid).gte('created_at', todayStart.toISOString()),
    supabase.from('pos_menu_items').select('id', { count: 'exact', head: true }).eq('restaurant_id', rid),
    supabase.from('pos_devices').select('id', { count: 'exact', head: true }).eq('restaurant_id', rid).eq('is_active', true),
    supabase.from('pos_sessions').select('id', { count: 'exact', head: true }).eq('restaurant_id', rid),
  ])

  const revenue = (ordersRes.data ?? []).reduce((s, o) => s + (o.total ?? 0), 0)

  return NextResponse.json({
    tables: tablesRes.count ?? 0,
    open_tables: openRes.count ?? 0,
    orders_today: ordersRes.data?.length ?? 0,
    revenue_today: revenue,
    menu_items: menuRes.count ?? 0,
    devices: devicesRes.count ?? 0,
    sessions: sessionsRes.count ?? 0,
  })
}
