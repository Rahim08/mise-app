// Public branding lookup for the PIN/login screens (before the staff token exists).
// Returns ONLY safe fields — never owner_pin, stripe ids, etc.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { checkRateLimit, rateLimitKey } from '@/lib/rateLimit'

export async function POST(req: NextRequest) {
  // Публичный и без авторизации — лимит по IP против перебора/подтверждения id ресторанов
  // перед подбором PIN (аудит безопасности 2026-10-26).
  if (!await checkRateLimit(rateLimitKey(req, 'restaurant-info'), 30, 60_000)) {
    return NextResponse.json({ error: 'Rate limit' }, { status: 429 })
  }
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
