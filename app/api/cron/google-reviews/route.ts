// Vercel Cron: подтягивает свежие Google-отзывы + снэпшот рейтинга для ресторанов,
// у которых в restaurant_settings заполнены google_place_id и google_places_api_key.
// Hobby-план Vercel — 1 запуск/день (расписание в vercel.json), см. комментарий
// в app/api/cron/reminders/route.ts.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { syncRestaurantReviews } from '@/lib/googleReviews'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  const { data: settings } = await admin
    .from('restaurant_settings')
    .select('restaurant_id, google_place_id, google_places_api_key')
    .not('google_place_id', 'is', null).not('google_places_api_key', 'is', null)

  let synced = 0
  let failed = 0
  for (const s of (settings || [])) {
    const result = await syncRestaurantReviews(admin, s.restaurant_id, s.google_place_id, s.google_places_api_key)
    if (result.ok) synced++; else failed++
  }

  return NextResponse.json({ ok: true, synced, failed })
}
