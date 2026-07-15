// Ручной sync Google-отзывов сразу после того, как владелец вписал Place ID + свой
// API-ключ в Settings — чтобы статистика появилась мгновенно, не дожидаясь ночного cron.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { resolveCaller } from '@/lib/apiAuth'
import { syncRestaurantReviews } from '@/lib/googleReviews'

export async function POST(req: NextRequest) {
  const caller = await resolveCaller(req)
  if (!caller || !caller.owner) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data: settings } = await admin
    .from('restaurant_settings')
    .select('google_place_id, google_places_api_key')
    .eq('restaurant_id', caller.rid).maybeSingle()

  if (!settings?.google_place_id || !settings?.google_places_api_key) {
    return NextResponse.json({ error: 'Заполните Place ID и API-ключ' }, { status: 400 })
  }

  const result = await syncRestaurantReviews(admin, caller.rid, settings.google_place_id, settings.google_places_api_key)
  if (!result.ok) return NextResponse.json({ error: result.error || 'Ошибка Google API' }, { status: 400 })
  return NextResponse.json({ ok: true, rating: result.rating, ratingsTotal: result.ratingsTotal })
}
