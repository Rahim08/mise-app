import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { resolveCaller } from '@/lib/apiAuth'
import { checkRateLimit, rateLimitKey } from '@/lib/rateLimit'

// MISE-011 (аудит 2026-08-28): раньше здесь был отдельный verifyStaffToken(), в обход
// resolveCaller() и его staffTokenRevoked()-проверки (lib/apiAuth.ts) — уволенный сотрудник
// с валидной 10-летней кукой мог дёргать этот эндпоинт бесконечно после увольнения. Impact был
// ограничен (эндпоинт не читает/не пишет бизнес-данные, только расходует AI-квоту под
// rate-limit 20/мин), но нет причины держать отдельный auth-путь без ревокации.
async function getRestaurantId(req: NextRequest): Promise<string | null> {
  const caller = await resolveCaller(req)
  return caller?.rid ?? null
}

const STASH_SYSTEM = `You extract tobacco stock movement data from speech or text.
Return ONLY valid JSON: {"rows":[{"brand":"...","flavor":"...","grams":"..."}]}
Rules: grams is a number string (digits only, no units). Multiple items allowed. If unclear, best-guess.`

const MANAGER_SYSTEM = `You extract restaurant shift financial data from speech or text.
Return ONLY valid JSON with any subset of these fields (empty string if not mentioned):
{"income":"","incomeCard":"","inkSum":"","inkExpense":"","inkReason":""}
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
        // llama-3.3-70b-versatile retired on Groq (2026-08-30, prod outage — "model_not_found").
        // gpt-oss-120b is a reasoning model: without reasoning_effort:'low' it can burn the
        // whole max_tokens budget on the hidden reasoning trace and return empty content.
        model: 'openai/gpt-oss-120b',
        reasoning_effort: 'low',
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
