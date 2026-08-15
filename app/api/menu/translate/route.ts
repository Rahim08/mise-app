// Owner-only menu auto-translation. Translates one field's base text into all 8 menu
// locales so the owner can review/edit before saving into the i18n JSONB column.
//
// Reuses the project's existing Groq integration (GROQ_API_KEY) — same pattern as
// /api/ai — to avoid introducing a new provider/secret.
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { verifyStaffToken, STAFF_COOKIE } from '@/lib/staffToken'
import { checkRateLimit, rateLimitKey } from '@/lib/rateLimit'
import { MENU_LOCALES, LOCALE_LABEL } from '@/lib/menu'

const MAX_TEXT_CHARS = 500 // это название/описание блюда, не документ

async function getRestaurantId(req: NextRequest): Promise<string | null> {
  // Владелец правит всё меню. Staff-токен принимаем только owner-сессии — PIN-сессии
  // сотрудников отклоняем, как это уже сделано в соседнем /api/menu/import (аудит-находка E2:
  // комментарий выше заявлял "Owner-only", код это не проверял).
  const staff = verifyStaffToken(req.cookies.get(STAFF_COOKIE)?.value)
  if (staff) return staff.owner ? staff.rid : null
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
  const rlKey = rateLimitKey(req, 'menu-translate')
  if (!await checkRateLimit(rlKey, 5, 10 * 60_000)) return NextResponse.json({ error: 'Rate limit' }, { status: 429 })

  const restaurantId = await getRestaurantId(req)
  if (!restaurantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { text } = await req.json()
  if (!text || typeof text !== 'string' || !text.trim()) {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 })
  }
  if (text.length > MAX_TEXT_CHARS) {
    return NextResponse.json({ error: 'text_too_long' }, { status: 400 })
  }

  const key = process.env.GROQ_API_KEY
  if (!key) return NextResponse.json({ error: 'No API key' }, { status: 500 })

  const langList = MENU_LOCALES.map(l => `"${l}" (${LOCALE_LABEL[l]})`).join(', ')
  const system = `You are a professional menu translator for restaurants. Translate the given dish name or description into these languages: ${langList}.
Keep it natural, appetizing and concise — this is a restaurant menu. Preserve proper names / brand names. Do NOT add notes.
Return ONLY valid JSON: an object whose keys are the exact language codes (${MENU_LOCALES.join(', ')}) and values are the translated strings.`

  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: text.trim() },
      ],
      temperature: 0.3,
      max_tokens: 1024,
      response_format: { type: 'json_object' },
    }),
  })
  const d = await r.json()
  if (!r.ok) return NextResponse.json({ error: d?.error?.message || 'Translation failed' }, { status: 502 })

  let parsed: Record<string, string> = {}
  try {
    const raw = (d.choices?.[0]?.message?.content ?? '{}').replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    const obj = JSON.parse(raw)
    for (const l of MENU_LOCALES) if (typeof obj[l] === 'string') parsed[l] = obj[l]
  } catch {
    return NextResponse.json({ error: 'Bad AI response' }, { status: 502 })
  }
  return NextResponse.json({ result: parsed })
}
