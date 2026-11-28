import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { resolveCaller } from '@/lib/apiAuth'
import { checkRateLimit, rateLimitKey } from '@/lib/rateLimit'
import { entitlements } from '@/lib/plans'
import { formatCatalog, parseStashReply, stashSystemPrompt, type CatalogItem } from '@/lib/stashAi'

// MISE-011 (аудит 2026-08-28): раньше здесь был отдельный verifyStaffToken(), в обход
// resolveCaller() и его staffTokenRevoked()-проверки (lib/apiAuth.ts) — уволенный сотрудник
// с валидной 10-летней кукой мог дёргать этот эндпоинт бесконечно после увольнения. Impact был
// ограничен (эндпоинт не читает/не пишет бизнес-данные, только расходует AI-квоту под
// rate-limit 20/мин), но нет причины держать отдельный auth-путь без ревокации.
async function getRestaurantId(req: NextRequest): Promise<string | null> {
  const caller = await resolveCaller(req)
  return caller?.rid ?? null
}

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
    .select('subscription_plan, subscription_status, ai_enabled, addon_ai')
    .eq('id', restaurantId)
    .single()

  const activeStatuses = ['active', 'trialing', 'canceling']
  // Pro или купленный AI-аддон — только при живой подписке; ai_enabled — ручной override.
  const subscribed = activeStatuses.includes(restaurant?.subscription_status ?? '')
  const isAllowed = restaurant?.ai_enabled === true || (subscribed && entitlements(restaurant).ai)
  if (!isAllowed) return NextResponse.json({ error: 'ai_pro_only' }, { status: 403 })

  const key = process.env.GROQ_API_KEY
  if (!key) return NextResponse.json({ error: 'No API key' }, { status: 500 })

  const groqUrl = 'https://api.groq.com/openai/v1/chat/completions'

  async function groqChat(systemPrompt: string, userMessage: string, opts: { json?: boolean; maxTokens?: number } = {}): Promise<{ ok: boolean; status: number; text: string }> {
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
        max_tokens: opts.maxTokens ?? 900,
        ...(opts.json ? { response_format: { type: 'json_object' } } : {}),
      }),
    })
    const d = await r.json()
    // 429/413 — лимит токенов Groq: отдаём клиенту 429, а не «ошибку сервиса».
    if (r.status === 429 || r.status === 413) return { ok: false, status: 429, text: 'ai_busy' }
    if (!r.ok) return { ok: false, status: 502, text: d?.error?.message || 'AI request failed' }
    return { ok: true, status: 200, text: d.choices?.[0]?.message?.content ?? '' }
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
      // Каталог берём из базы сами: приложение присылало только 30 брендов без вкусов.
      const { data: stock, error } = await admin
        .from('tobacco_stock')
        .select('brand, flavor')
        .eq('restaurant_id', restaurantId)
        .order('brand')
        .order('flavor')
        .limit(1000)
      if (error) return NextResponse.json({ error: 'stock_unavailable' }, { status: 500 })
      const items = (stock ?? []) as CatalogItem[]
      const res = await groqChat(stashSystemPrompt(formatCatalog(items)), `User: ${message}`, { json: true, maxTokens: 1500 })
      if (!res.ok) return NextResponse.json({ error: res.text }, { status: res.status })
      const parsed = parseStashReply(res.text, items)
      if (!parsed) return NextResponse.json({ type: 'text', reply: res.text })
      return NextResponse.json({ type: 'prefill', ...parsed })
    }
    if (module === 'manager') {
      system = MANAGER_SYSTEM
      user = `${context ? 'Context: ' + context + '\n\n' : ''}User: ${message}`
    } else {
      // Professional-analyst tone + no-names-on-payroll rule (owner feedback 2026-08-30):
      // the model was transliterating a Cyrillic employee name into Latin script mid-reply
      // ("Рахим" → "Rahim"), and separately naming specific staff in pay-cut suggestions —
      // uncomfortable for an owner-facing tool. Banning individual names in payroll context
      // fixes both: no name in the output, no name left to mis-transliterate.
      system = `You are a senior restaurant financial analyst reviewing this venue's numbers for its owner. ${langInstruction}Be precise, data-grounded and professional — reference concrete figures and trends from the data, not generic advice. Answer directly, no preamble, no filler.
Output plain text only — no markdown (no **bold**, no #headers, no numbered lists). One observation or recommendation per line, each a complete short sentence or two, nothing more.
HARD RULE, no exceptions: the data may list individual employee names next to payroll, extra-payment, absence, or cost figures — you must NEVER repeat any of those names in your answer, not even in passing. Talk about the money only ("extra payments totaled X", "payroll costs rose Y%"), never who received it. Bad: "1000 paid to Oleg and 700 to Dasha, review these". Good: "two extra payments of 1000 and 700 stand out as irregular — worth reviewing". The only exception is if the owner's question explicitly asks about one specific named person — then that one name is fine. Also never transliterate or otherwise alter any name that does appear — copy it exactly as given in the data.`
      user = `${context ? 'Data: ' + context + '\n\n' : ''}Question: ${message}`
    }

    const { ok, status, text } = await groqChat(system, user)
    if (!ok) return NextResponse.json({ error: text }, { status })

    if (module === 'manager') {
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
  const { ok, status, text } = await groqChat(system, lastMsg)
  if (!ok) return NextResponse.json({ error: text }, { status })
  return NextResponse.json({ text: text || 'Нет ответа' })
}
