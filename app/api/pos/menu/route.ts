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
  if (!user) return { error: 'Unauthorized', supabase, restaurantId: null }
  const { data } = await supabase.from('restaurants').select('id').eq('owner_id', user.id).single()
  return { supabase, restaurantId: data?.id ?? null, error: data ? null : 'No restaurant' }
}

// GET — full menu snapshot for POS (categories + items + modifier groups + modifiers)
export async function GET(req: NextRequest) {
  const { supabase, restaurantId, error } = await getRestaurantId()
  if (error || !restaurantId) return NextResponse.json({ error }, { status: 401 })

  const [cats, items, groups, modifiers] = await Promise.all([
    supabase.from('pos_menu_categories').select('*').eq('restaurant_id', restaurantId).order('sort'),
    supabase.from('pos_menu_items').select('*').eq('restaurant_id', restaurantId).order('sort'),
    supabase.from('pos_modifier_groups').select('*').eq('restaurant_id', restaurantId).order('sort'),
    supabase.from('pos_modifiers').select('*').eq('restaurant_id', restaurantId).order('sort'),
  ])

  return NextResponse.json({
    categories: cats.data ?? [],
    items: items.data ?? [],
    groups: groups.data ?? [],
    modifiers: modifiers.data ?? [],
  })
}

// POST — create category or item
export async function POST(req: NextRequest) {
  const { supabase, restaurantId, error } = await getRestaurantId()
  if (error || !restaurantId) return NextResponse.json({ error }, { status: 401 })

  const body = await req.json()
  const { type, ...fields } = body

  if (type === 'category') {
    const { data, error: err } = await supabase
      .from('pos_menu_categories')
      .insert({ id: crypto.randomUUID(), restaurant_id: restaurantId, ...fields })
      .select().single()
    if (err) return NextResponse.json({ error: err.message }, { status: 400 })
    return NextResponse.json({ category: data })
  }

  if (type === 'item') {
    const { data, error: err } = await supabase
      .from('pos_menu_items')
      .insert({ id: crypto.randomUUID(), restaurant_id: restaurantId, ...fields })
      .select().single()
    if (err) return NextResponse.json({ error: err.message }, { status: 400 })
    return NextResponse.json({ item: data })
  }

  return NextResponse.json({ error: 'Unknown type' }, { status: 400 })
}

// PATCH — update item or category
export async function PATCH(req: NextRequest) {
  const { supabase, restaurantId, error } = await getRestaurantId()
  if (error || !restaurantId) return NextResponse.json({ error }, { status: 401 })

  const body = await req.json()
  const { id, type, ...fields } = body
  const table = type === 'category' ? 'pos_menu_categories' : 'pos_menu_items'

  const { data, error: err } = await supabase
    .from(table)
    .update(fields)
    .eq('id', id)
    .eq('restaurant_id', restaurantId)
    .select().single()

  if (err) return NextResponse.json({ error: err.message }, { status: 400 })
  return NextResponse.json({ data })
}

// DELETE — remove item or category
export async function DELETE(req: NextRequest) {
  const { supabase, restaurantId, error } = await getRestaurantId()
  if (error || !restaurantId) return NextResponse.json({ error }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  const type = searchParams.get('type') ?? 'item'
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const table = type === 'category' ? 'pos_menu_categories' : 'pos_menu_items'
  const { error: err } = await supabase.from(table).delete().eq('id', id).eq('restaurant_id', restaurantId)
  if (err) return NextResponse.json({ error: err.message }, { status: 400 })
  return NextResponse.json({ ok: true })
}
