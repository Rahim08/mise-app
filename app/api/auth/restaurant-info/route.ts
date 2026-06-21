// Public branding lookup for the PIN/login screens (before the staff token exists).
// Returns ONLY safe fields — never owner_pin, stripe ids, etc.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export async function POST(req: NextRequest) {
  const { restaurantId } = await req.json()
  if (!restaurantId) return NextResponse.json({ error: 'Missing restaurantId' }, { status: 400 })

  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data } = await admin
    .from('restaurants')
    .select('id, name, logo_url, currency, subscription_status, subscription_plan, ai_enabled, owner_pin')
    .eq('id', restaurantId)
    .single()

  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  // Never leak the hash — only whether a PIN is set.
  const { owner_pin, ...safe } = data
  return NextResponse.json({ restaurant: { ...safe, has_owner_pin: !!owner_pin } })
}
