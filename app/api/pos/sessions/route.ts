import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'

async function getRestaurantId() {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll() } }
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Unauthorized', supabase, user, restaurantId: null }
  const { data } = await supabase.from('restaurants').select('id').eq('owner_id', user.id).single()
  return { supabase, user, restaurantId: data?.id ?? null, error: data ? null : 'No restaurant' }
}

// GET — current open session or last closed one
export async function GET(req: NextRequest) {
  const { supabase, restaurantId, error } = await getRestaurantId()
  if (error || !restaurantId) return NextResponse.json({ error }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const limit = Number(searchParams.get('limit') ?? '1')

  const { data } = await supabase
    .from('pos_sessions')
    .select('*, pos_session_payins(*), pos_session_payouts(*)')
    .eq('restaurant_id', restaurantId)
    .order('opened_at', { ascending: false })
    .limit(limit)

  const sessions = data ?? []
  return NextResponse.json({ sessions, current: sessions.find(s => s.status === 'open') ?? null })
}

// POST — open new session
export async function POST(req: NextRequest) {
  const { supabase, restaurantId, user, error } = await getRestaurantId()
  if (error || !restaurantId) return NextResponse.json({ error }, { status: 401 })

  // Only one open session at a time
  const { data: existing } = await supabase
    .from('pos_sessions')
    .select('id')
    .eq('restaurant_id', restaurantId)
    .eq('status', 'open')
    .single()
  if (existing) return NextResponse.json({ error: 'Смена уже открыта' }, { status: 409 })

  const body = await req.json()
  const { data, error: err } = await supabase
    .from('pos_sessions')
    .insert({
      id: crypto.randomUUID(),
      restaurant_id: restaurantId,
      staff_id: user?.id,
      opening_cash: body.opening_cash ?? 0,
      opened_at: new Date().toISOString(),
    })
    .select().single()

  if (err) return NextResponse.json({ error: err.message }, { status: 400 })
  return NextResponse.json({ session: data })
}

// PATCH — close session or update totals
export async function PATCH(req: NextRequest) {
  const { supabase, restaurantId, error } = await getRestaurantId()
  if (error || !restaurantId) return NextResponse.json({ error }, { status: 401 })

  const body = await req.json()
  const { id, action, ...fields } = body

  if (action === 'close') {
    const { data, error: err } = await supabase
      .from('pos_sessions')
      .update({
        status: 'closed',
        closed_at: new Date().toISOString(),
        closing_cash_actual: fields.closing_cash_actual,
        ...fields,
      })
      .eq('id', id)
      .eq('restaurant_id', restaurantId)
      .select().single()
    if (err) return NextResponse.json({ error: err.message }, { status: 400 })
    return NextResponse.json({ session: data })
  }

  const { data, error: err } = await supabase
    .from('pos_sessions')
    .update(fields)
    .eq('id', id)
    .eq('restaurant_id', restaurantId)
    .select().single()
  if (err) return NextResponse.json({ error: err.message }, { status: 400 })
  return NextResponse.json({ session: data })
}
