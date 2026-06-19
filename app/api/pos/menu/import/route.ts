import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import { randomUUID } from 'crypto'

async function getCtx() {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll() } }
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Unauthorized' as const, supabase, restaurantId: null }
  const { data } = await supabase.from('restaurants').select('id').eq('owner_id', user.id).single()
  return { supabase, restaurantId: data?.id ?? null, error: data ? null : 'No restaurant' as const }
}

// GET — preview what would be imported
export async function GET() {
  const { supabase, restaurantId, error } = await getCtx()
  if (error || !restaurantId) return NextResponse.json({ error }, { status: 401 })

  const [catsRes, itemsRes, existingCatsRes] = await Promise.all([
    supabase.from('menu_categories').select('id,name,position').eq('restaurant_id', restaurantId).eq('is_visible', true).order('position'),
    supabase.from('menu_items').select('id,category_id,name,description,price,image_url,is_available,calories,allergens,position').eq('restaurant_id', restaurantId).eq('is_visible', true).order('position'),
    supabase.from('pos_menu_categories').select('id', { count: 'exact', head: true }).eq('restaurant_id', restaurantId),
  ])

  return NextResponse.json({
    categories: catsRes.data ?? [],
    items: itemsRes.data ?? [],
    already_has_pos_menu: (existingCatsRes.count ?? 0) > 0,
  })
}

// POST — execute import
export async function POST(req: NextRequest) {
  const { supabase, restaurantId, error } = await getCtx()
  if (error || !restaurantId) return NextResponse.json({ error }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const overwrite = body.overwrite === true

  // Check if POS menu already exists
  const { count } = await supabase
    .from('pos_menu_categories')
    .select('id', { count: 'exact', head: true })
    .eq('restaurant_id', restaurantId)

  if ((count ?? 0) > 0 && !overwrite) {
    return NextResponse.json({ error: 'POS menu already has data. Pass overwrite:true to replace.' }, { status: 409 })
  }

  // Fetch source data
  const [catsRes, itemsRes] = await Promise.all([
    supabase.from('menu_categories').select('id,name,position').eq('restaurant_id', restaurantId).eq('is_visible', true).order('position'),
    supabase.from('menu_items').select('id,category_id,name,description,price,image_url,is_available,calories,allergens,position').eq('restaurant_id', restaurantId).eq('is_visible', true).order('position'),
  ])

  const srcCats = catsRes.data ?? []
  const srcItems = itemsRes.data ?? []

  // Build new POS categories, preserving old→new id mapping
  const catIdMap = new Map<string, string>()
  const newCats = srcCats.map((c, i) => {
    const newId = randomUUID()
    catIdMap.set(c.id, newId)
    return {
      id: newId,
      restaurant_id: restaurantId,
      name: { ru: c.name },
      sort: c.position ?? i,
    }
  })

  const newItems = srcItems.map((item, i) => ({
    id: randomUUID(),
    restaurant_id: restaurantId,
    category_id: catIdMap.get(item.category_id) ?? newCats[0]?.id ?? randomUUID(),
    name: { ru: item.name },
    description: item.description ? { ru: item.description } : null,
    base_price: item.price ?? 0,
    photo_url: item.image_url ?? null,
    calories: item.calories ?? null,
    allergens: item.allergens ?? [],
    is_available: item.is_available ?? true,
    is_active: true,
    sort: item.position ?? i,
  }))

  if (newCats.length === 0) {
    return NextResponse.json({ error: 'No visible source categories found' }, { status: 400 })
  }

  // If overwrite, cascade-delete existing POS menu data first
  if (overwrite) {
    await supabase.from('pos_menu_categories').delete().eq('restaurant_id', restaurantId)
  }

  const catInsert = await supabase.from('pos_menu_categories').insert(newCats)
  if (catInsert.error) {
    return NextResponse.json({ error: catInsert.error.message }, { status: 500 })
  }

  const itemInsert = await supabase.from('pos_menu_items').insert(newItems)
  if (itemInsert.error) {
    return NextResponse.json({ error: itemInsert.error.message }, { status: 500 })
  }

  return NextResponse.json({
    imported_categories: newCats.length,
    imported_items: newItems.length,
  })
}
