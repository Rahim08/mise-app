import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { verifyStaffToken, STAFF_COOKIE } from '@/lib/staffToken'
import { checkRateLimit, rateLimitKey } from '@/lib/rateLimit'

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
  const rlKey = rateLimitKey(req, 'ai')
  if (!await checkRateLimit(rlKey, 20, 60_000)) return NextResponse.json({ error: 'Rate limit' }, { status: 429 })

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

  const key = process.env.GROQ_API_KEY
  if (!key) return NextResponse.json({ error: 'No API key' }, { status: 500 })

  const groqUrl = 'https://api.groq.com/openai/v1/chat/completions'

  async function groqChat(systemPrompt: string, userMessage: string): Promise<{ ok: boolean; text: string }> {
    const r = await fetch(groqUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        temperature: 0.2,
        max_tokens: 512,
      }),
    })
    const d = await r.json()
    if (!r.ok) return { ok: false, text: d?.error?.message || 'AI request failed' }
    return { ok: true, text: d.choices?.[0]?.message?.content ?? '' }
  }

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  // Native iOS request: { module, message, context, lang }
  if (body.module) {
    const { module, message, context, lang } = body as { module: string; message: string; context?: string; lang?: string }

    const langNames: Record<string, string> = {
      ru: 'Russian', en: 'English', it: 'Italian', fr: 'French',
      az: 'Azerbaijani', tr: 'Turkish', uk: 'Ukrainian', kk: 'Kazakh',
    }
    // Fallback: detect language from message script when lang not provided
    const detectedLang = lang ?? (
      /[Ѐ-ӿ]/.test(message) ? 'ru' :
      /[؀-ۿ]/.test(message) ? 'az' :
      /[Ͱ-Ͽ]/.test(message) ? 'fr' : 'en'
    )
    const resolvedLang = langNames[detectedLang] ?? 'Russian'
    const langInstruction = `Always respond in ${resolvedLang}, regardless of the language of the context data. `

    let system: string
    let user: string
    if (module === 'stash') {
      system = STASH_SYSTEM
      user = `${context ? 'Known brands/flavors: ' + context + '\n\n' : ''}User: ${message}`
    } else if (module === 'manager') {
      system = MANAGER_SYSTEM
      user = `${context ? 'Context: ' + context + '\n\n' : ''}User: ${message}`
    } else {
      system = `You are a concise restaurant analytics assistant. ${langInstruction}Give a direct answer in 1-2 short sentences. No preamble, no suggestions, just the answer.`
      user = `${context ? 'Data: ' + context + '\n\n' : ''}Question: ${message}`
    }

    const { ok, text } = await groqChat(system, user)
    if (!ok) return NextResponse.json({ error: text }, { status: 502 })

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
  if (!Array.isArray(messages) || messages.length === 0 || !messages[messages.length - 1]?.text) {
    return NextResponse.json({ error: 'Invalid messages format' }, { status: 400 })
  }
  const system = context ?? 'You are a helpful restaurant analytics assistant.'
  const lastMsg = messages[messages.length - 1].text
  const { ok, text } = await groqChat(system, lastMsg)
  if (!ok) return NextResponse.json({ error: text }, { status: 502 })
  return NextResponse.json({ text: text || 'Нет ответа' })
}
