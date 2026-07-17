// AI-импорт меню одним файлом — владелец загружает выгрузку из Poster/iiko/Syrve/R-Keeper
// (CSV/Excel) или текстовый PDF, AI читает содержимое и раскладывает на категории/позиции.
// Возвращает черновик — ничего не пишется в menu_categories/menu_items здесь; применение
// делает отдельный вызов из дашборда после того, как владелец проверил результат.
//
// Фото/скан-PDF пока не поддержаны — для этого нужна vision-модель, её сейчас в проекте нет
// (см. /api/ai — только текстовый Groq llama-3.3-70b).
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { verifyStaffToken, STAFF_COOKIE } from '@/lib/staffToken'
import { checkRateLimit, rateLimitKey } from '@/lib/rateLimit'

const MAX_FILE_BYTES = 8 * 1024 * 1024 // 8MB
const MAX_TEXT_CHARS = 14000 // держим промпт в разумных токенах вне зависимости от размера файла

async function getRestaurantId(req: NextRequest): Promise<string | null> {
  // Импорт меню — операция владельца (правит всё меню). Staff-токен принимаем только
  // owner-сессии (owner=true), PIN-сессии сотрудников отклоняем (аудит-находка 8).
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

async function extractText(file: File): Promise<{ text: string } | { error: string }> {
  const name = file.name.toLowerCase()
  const buf = Buffer.from(await file.arrayBuffer())

  if (name.endsWith('.jpg') || name.endsWith('.jpeg') || name.endsWith('.png') || name.endsWith('.heic')) {
    return { error: 'photo_not_supported' }
  }

  if (name.endsWith('.csv') || name.endsWith('.txt')) {
    return { text: buf.toString('utf-8') }
  }

  if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    const ExcelJS = (await import('exceljs')).default
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buf as any)
    const lines: string[] = []
    wb.eachSheet(sheet => {
      sheet.eachRow(row => {
        const cells = (row.values as any[]).slice(1).map(v => (v == null ? '' : String(v).trim()))
        if (cells.some(c => c)) lines.push(cells.join(' | '))
      })
    })
    return { text: lines.join('\n') }
  }

  if (name.endsWith('.pdf')) {
    const { PDFParse } = await import('pdf-parse')
    const parser = new PDFParse({ data: buf })
    const result = await parser.getText()
    return { text: result.text }
  }

  return { error: 'unsupported_format' }
}

const IMPORT_SYSTEM = `You extract a restaurant/lounge menu from raw exported text (any POS format: Poster, iiko, Syrve, R-Keeper, plain CSV, or PDF text — the layout varies, infer structure from content, not headers).
Return ONLY valid JSON, no markdown fences, in this exact shape:
{"categories":[{"name":"...","items":[{"name":"...","price":123.0,"description":""}]}]}
Rules:
- price is a plain number in the source currency's minor-free units (e.g. 450 not "450 ₽"); use null if genuinely absent — don't invent one.
- Group items into sensible categories using the source text (if no explicit category markers exist, infer a small number of logical categories from item names, e.g. drinks vs food vs hookah).
- Skip rows that are clearly not menu items (page headers, totals, empty rows).
- description is optional, leave "" if not present in source.
- Preserve the original language of names/descriptions — do not translate.`

export async function POST(req: NextRequest) {
  const rlKey = rateLimitKey(req, 'menu-import')
  if (!await checkRateLimit(rlKey, 5, 10 * 60_000)) return NextResponse.json({ error: 'Rate limit' }, { status: 429 })

  const restaurantId = await getRestaurantId(req)
  if (!restaurantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data: restaurant } = await admin
    .from('restaurants').select('subscription_plan, subscription_status, ai_enabled').eq('id', restaurantId).single()
  const activeStatuses = ['active', 'trialing', 'canceling']
  const isPro = restaurant?.subscription_plan === 'pro' && activeStatuses.includes(restaurant?.subscription_status)
  if (!(isPro || restaurant?.ai_enabled === true)) return NextResponse.json({ error: 'ai_pro_only' }, { status: 403 })

  const key = process.env.GROQ_API_KEY
  if (!key) return NextResponse.json({ error: 'No API key' }, { status: 500 })

  let form: FormData
  try { form = await req.formData() } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }) }
  const file = form.get('file')
  if (!(file instanceof File)) return NextResponse.json({ error: 'no_file' }, { status: 400 })
  if (file.size > MAX_FILE_BYTES) return NextResponse.json({ error: 'file_too_large' }, { status: 400 })

  const extracted = await extractText(file)
  if ('error' in extracted) return NextResponse.json({ error: extracted.error }, { status: 422 })
  const text = extracted.text.trim().slice(0, MAX_TEXT_CHARS)
  if (!text) return NextResponse.json({ error: 'empty_file' }, { status: 422 })

  const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: IMPORT_SYSTEM },
        { role: 'user', content: text },
      ],
      temperature: 0.1,
      max_tokens: 4000,
    }),
  })
  const groqData = await groqRes.json()
  if (!groqRes.ok) return NextResponse.json({ error: groqData?.error?.message || 'AI request failed' }, { status: 502 })

  const raw = (groqData.choices?.[0]?.message?.content ?? '').trim()
  const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
  let parsed: { categories?: { name: string; items?: { name: string; price?: number | null; description?: string }[] }[] }
  try { parsed = JSON.parse(cleaned) } catch { return NextResponse.json({ error: 'parse_failed' }, { status: 502 }) }

  const categories = (parsed.categories || [])
    .map(c => ({
      name: (c.name || '').trim(),
      items: (c.items || [])
        .map(i => ({ name: (i.name || '').trim(), price: typeof i.price === 'number' ? i.price : null, description: (i.description || '').trim() }))
        .filter(i => i.name),
    }))
    .filter(c => c.name && c.items.length > 0)

  const totalItems = categories.reduce((s, c) => s + c.items.length, 0)
  if (totalItems === 0) return NextResponse.json({ error: 'nothing_recognized' }, { status: 422 })

  return NextResponse.json({ categories, source_chars: text.length })
}
