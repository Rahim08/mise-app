import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { verifyStaffToken, STAFF_COOKIE } from '@/lib/staffToken'

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

const STASH_SYSTEM = `You extract tobacco stock movement data from speech or text.
Return ONLY valid JSON: {"rows":[{"brand":"...","flavor":"...","grams":"..."}]}
Rules: grams is a number string (digits only, no units). Multiple items allowed. If unclear, best-guess.`

const MANAGER_SYSTEM = `You extract restaurant shift financial data from speech or text.
Return ONLY valid JSON with any subset of these fields (empty string if not mentioned):
{"income":"","incomeCard":"","inkSum":"","inkExpense":"","inkReason":"","inkSalary":""}
Numbers as digit strings only (no currency symbols).`

export async function POST(req: NextRequest) {
  const restaurantId = await getRestaurantId(req)
  if (!restaurantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data: restaurant } = await admin
    .from('restaurants')
    .select('subscription_plan, subscription_status, ai_enabled')
    .eq('id', restaurantId)
    .single()

  const activeStatuses = ['active', 'trialing', 'canceling']
  const isPro = restaurant?.subscription_plan === 'pro' && activeStatuses.includes(restaurant?.subscription_status)
  const isAllowed = isPro || restaurant?.ai_enabled === true
  if (!isAllowed) return NextResponse.json({ error: 'ai_pro_only' }, { status: 403 })

  const key = process.env.GEMINI_API_KEY
  if (!key) return NextResponse.json({ error: 'No API key' }, { status: 500 })

  const body = await req.json()
  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`

  // Native iOS request: { module, message, context }
  if (body.module) {
    const { module, message, context } = body as { module: string; message: string; context?: string }

    let prompt: string
    if (module === 'stash') {
      prompt = `${STASH_SYSTEM}\n\n${context ? 'Known brands/flavors: ' + context + '\n\n' : ''}User: ${message}`
    } else if (module === 'manager') {
      prompt = `${MANAGER_SYSTEM}\n\n${context ? 'Context: ' + context + '\n\n' : ''}User: ${message}`
    } else {
      // analytics or unknown — plain text reply
      prompt = `${context ? context + '\n\n' : ''}Question: ${message}\nAnswer concisely in 2-4 sentences in the same language as the question.`
    }

    const r = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.2, maxOutputTokens: 512 } }),
    })
    const d = await r.json()
    if (!r.ok) return NextResponse.json({ error: d?.error?.message || 'AI request failed' }, { status: 502 })
    const text: string = d.candidates?.[0]?.content?.parts?.[0]?.text ?? ''

    if (module === 'stash' || module === 'manager') {
      try {
        const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
        return NextResponse.json({ type: 'prefill', ...JSON.parse(cleaned) })
      } catch {
        return NextResponse.json({ type: 'text', reply: text })
      }
    }
    return NextResponse.json({ type: 'text', reply: text })
  }

  // Legacy web request: { messages, context }
  const { messages, context } = body
  const prompt = `${context}\n\nВопрос: ${messages[messages.length - 1].text}`
  const r = await fetch(geminiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
  })
  const d = await r.json()
  if (!r.ok) return NextResponse.json({ error: d?.error?.message || 'AI request failed' }, { status: 502 })
  const text = d.candidates?.[0]?.content?.parts?.[0]?.text || 'Нет ответа'
  return NextResponse.json({ text })
}
