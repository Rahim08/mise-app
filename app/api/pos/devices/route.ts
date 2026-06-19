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

export async function GET() {
  const { supabase, restaurantId, error } = await getCtx()
  if (error || !restaurantId) return NextResponse.json({ error }, { status: 401 })

  const { data } = await supabase
    .from('pos_devices')
    .select('id, name, role, last_seen_at, is_active, created_at')
    .eq('restaurant_id', restaurantId)
    .order('created_at')

  return NextResponse.json({ devices: data ?? [] })
}

export async function POST(req: NextRequest) {
  const { supabase, restaurantId, error } = await getCtx()
  if (error || !restaurantId) return NextResponse.json({ error }, { status: 401 })

  const body = await req.json()
  if (!body.name || !body.role || !body.pin) {
    return NextResponse.json({ error: 'name, role, pin required' }, { status: 400 })
  }

  // Hash PIN with Web Crypto (SHA-256, simple — not bcrypt, acceptable for LAN PIN)
  const enc = new TextEncoder()
  const hashBuf = await crypto.subtle.digest('SHA-256', enc.encode(body.pin))
  const hashHex = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, '0')).join('')

  const { data, error: err } = await supabase
    .from('pos_devices')
    .insert({
      id: crypto.randomUUID(),
      restaurant_id: restaurantId,
      name: body.name,
      role: body.role,
      pin_hash: hashHex,
      is_active: true,
    })
    .select('id, name, role, last_seen_at, is_active, created_at')
    .single()

  if (err) return NextResponse.json({ error: err.message }, { status: 400 })
  return NextResponse.json({ device: data })
}

export async function PATCH(req: NextRequest) {
  const { supabase, restaurantId, error } = await getCtx()
  if (error || !restaurantId) return NextResponse.json({ error }, { status: 401 })

  const body = await req.json()
  const { id, pin, ...fields } = body

  let extra: Record<string, string> = {}
  if (pin) {
    const enc = new TextEncoder()
    const hashBuf = await crypto.subtle.digest('SHA-256', enc.encode(pin))
    const hashHex = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, '0')).join('')
    extra.pin_hash = hashHex
  }

  const { data, error: err } = await supabase
    .from('pos_devices')
    .update({ ...fields, ...extra })
    .eq('id', id)
    .eq('restaurant_id', restaurantId)
    .select('id, name, role, last_seen_at, is_active, created_at')
    .single()

  if (err) return NextResponse.json({ error: err.message }, { status: 400 })
  return NextResponse.json({ device: data })
}

export async function DELETE(req: NextRequest) {
  const { supabase, restaurantId, error } = await getCtx()
  if (error || !restaurantId) return NextResponse.json({ error }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  await supabase.from('pos_devices').delete().eq('id', id).eq('restaurant_id', restaurantId)
  return NextResponse.json({ ok: true })
}
