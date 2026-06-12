import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { verifyStaffToken, STAFF_COOKIE } from '@/lib/staffToken'

// Resolve the caller's restaurant id from the verified staff token or the owner session.
async function getRestaurantId(req: NextRequest): Promise<string | null> {
  const staff = verifyStaffToken(req.cookies.get(STAFF_COOKIE)?.value)
  if (staff) return staff.rid

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => req.cookies.getAll(), setAll: () => {} } }
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data } = await admin.from('restaurants').select('id').eq('owner_id', user.id).single()
  return data?.id ?? null
}

export async function POST(req: NextRequest) {
  const restaurantId = await getRestaurantId(req)
  if (!restaurantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // AI is a Pro-only feature — verify plan + active subscription server-side.
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data: restaurant } = await admin
    .from('restaurants')
    .select('subscription_plan, subscription_status')
    .eq('id', restaurantId)
    .single()

  const activeStatuses = ['active', 'trialing', 'canceling']
  const isPro = restaurant?.subscription_plan === 'pro' && activeStatuses.includes(restaurant?.subscription_status)
  if (!isPro) {
    return NextResponse.json({ error: 'AI доступен только в тарифе Pro' }, { status: 403 })
  }

  const { messages, context } = await req.json()
  const key = process.env.GEMINI_API_KEY
  if (!key) return NextResponse.json({ error: 'No API key' }, { status: 500 })

  const prompt = `${context}\n\nВопрос: ${messages[messages.length - 1].text}`

  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${key}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    }
  )
  const d = await r.json()
  const text = d.candidates?.[0]?.content?.parts?.[0]?.text || 'Нет ответа'
  return NextResponse.json({ text })
}
