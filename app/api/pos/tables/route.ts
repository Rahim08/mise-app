import { NextRequest, NextResponse } from 'next/server'
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
  if (!user) return { error: 'Unauthorized', supabase, restaurantId: null }
  const { data } = await supabase.from('restaurants').select('id').eq('owner_id', user.id).single()
  return { supabase, restaurantId: data?.id ?? null, error: data ? null : 'No restaurant' }
}

export async function POST(req: NextRequest) {
  const { supabase, restaurantId, error } = await getRestaurantId(req)
  if (error || !restaurantId) return NextResponse.json({ error }, { status: 401 })

  const body = await req.json()
  const id = crypto.randomUUID()
  const { data, error: err } = await supabase
    .from('pos_tables')
    .insert({
      id,
      floor_id: body.floor_id,
      restaurant_id: restaurantId,
      number: body.number,
      label: body.label ?? null,
      shape: body.shape ?? 'rect',
      capacity: body.capacity ?? 4,
      pos_x: body.pos_x ?? 0,
      pos_y: body.pos_y ?? 0,
      width: body.width ?? 100,
      height: body.height ?? 80,
    })
    .select()
    .single()

  if (err) return NextResponse.json({ error: err.message }, { status: 400 })
  return NextResponse.json({ table: data })
}

export async function PATCH(req: NextRequest) {
  const { supabase, restaurantId, error } = await getRestaurantId(req)
  if (error || !restaurantId) return NextResponse.json({ error }, { status: 401 })

  const body = await req.json()
  const { id, ...fields } = body
  const { data, error: err } = await supabase
    .from('pos_tables')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('restaurant_id', restaurantId)
    .select()
    .single()

  if (err) return NextResponse.json({ error: err.message }, { status: 400 })
  return NextResponse.json({ table: data })
}

export async function DELETE(req: NextRequest) {
  const { supabase, restaurantId, error } = await getRestaurantId(req)
  if (error || !restaurantId) return NextResponse.json({ error }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const { error: err } = await supabase
    .from('pos_tables')
    .delete()
    .eq('id', id)
    .eq('restaurant_id', restaurantId)

  if (err) return NextResponse.json({ error: err.message }, { status: 400 })
  return NextResponse.json({ ok: true })
}

// Bulk update positions (drag & drop save)
export async function PUT(req: NextRequest) {
  const { supabase, restaurantId, error } = await getRestaurantId(req)
  if (error || !restaurantId) return NextResponse.json({ error }, { status: 401 })

  const { tables } = await req.json() as { tables: { id: string; pos_x: number; pos_y: number; width?: number; height?: number }[] }

  const results = await Promise.all(
    tables.map(t =>
      supabase
        .from('pos_tables')
        .update({ pos_x: t.pos_x, pos_y: t.pos_y, width: t.width, height: t.height, updated_at: new Date().toISOString() })
        .eq('id', t.id)
        .eq('restaurant_id', restaurantId)
    )
  )

  const err = results.find(r => r.error)
  if (err?.error) return NextResponse.json({ error: err.error.message }, { status: 400 })
  return NextResponse.json({ ok: true })
}
