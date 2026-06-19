import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'

async function getRestaurantId(req: NextRequest) {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll() } }
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Unauthorized', supabase, user: null, restaurantId: null }
  const { data } = await supabase.from('restaurants').select('id').eq('owner_id', user.id).single()
  return { supabase, user, restaurantId: data?.id ?? null, error: data ? null : 'No restaurant' }
}

export async function GET(req: NextRequest) {
  const { supabase, restaurantId, error } = await getRestaurantId(req)
  if (error || !restaurantId) return NextResponse.json({ error }, { status: 401 })

  const { data: floors } = await supabase
    .from('pos_floors')
    .select('*, pos_tables(*)')
    .eq('restaurant_id', restaurantId)
    .order('sort')

  return NextResponse.json({ floors: floors ?? [] })
}

export async function POST(req: NextRequest) {
  const { supabase, restaurantId, error } = await getRestaurantId(req)
  if (error || !restaurantId) return NextResponse.json({ error }, { status: 401 })

  const body = await req.json()
  const id = crypto.randomUUID()
  const { data, error: err } = await supabase
    .from('pos_floors')
    .insert({ id, restaurant_id: restaurantId, name: body.name, sort: body.sort ?? 0 })
    .select()
    .single()

  if (err) return NextResponse.json({ error: err.message }, { status: 400 })
  return NextResponse.json({ floor: data })
}

export async function PATCH(req: NextRequest) {
  const { supabase, restaurantId, error } = await getRestaurantId(req)
  if (error || !restaurantId) return NextResponse.json({ error }, { status: 401 })

  const body = await req.json()
  const { id, ...fields } = body
  const { data, error: err } = await supabase
    .from('pos_floors')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('restaurant_id', restaurantId)
    .select()
    .single()

  if (err) return NextResponse.json({ error: err.message }, { status: 400 })
  return NextResponse.json({ floor: data })
}

export async function DELETE(req: NextRequest) {
  const { supabase, restaurantId, error } = await getRestaurantId(req)
  if (error || !restaurantId) return NextResponse.json({ error }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const { error: err } = await supabase
    .from('pos_floors')
    .delete()
    .eq('id', id)
    .eq('restaurant_id', restaurantId)

  if (err) return NextResponse.json({ error: err.message }, { status: 400 })
  return NextResponse.json({ ok: true })
}
