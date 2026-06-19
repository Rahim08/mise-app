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

export async function POST(req: NextRequest) {
  const { supabase, restaurantId, error } = await getCtx()
  if (error || !restaurantId) return NextResponse.json({ error }, { status: 401 })

  const body = await req.json()
  const { data, error: err } = await supabase
    .from('pos_modifiers')
    .insert({ id: crypto.randomUUID(), restaurant_id: restaurantId, ...body })
    .select().single()

  if (err) return NextResponse.json({ error: err.message }, { status: 400 })
  return NextResponse.json({ modifier: data })
}

export async function DELETE(req: NextRequest) {
  const { supabase, restaurantId, error } = await getCtx()
  if (error || !restaurantId) return NextResponse.json({ error }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  await supabase.from('pos_modifiers').delete().eq('id', id).eq('restaurant_id', restaurantId)
  return NextResponse.json({ ok: true })
}
