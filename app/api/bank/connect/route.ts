// Начало подключения банка (Enable Banking /auth) — owner-only, вкладка «Банк» в
// Analytics. Тело: { country, query, institutionName? }. Разные заведения подключают
// разные банки (напр. SO — Revolut, другое заведение — Banco Popolare di Sondrio),
// поэтому имя банка ищем по свободному тексту (`query`), не хардкодим. Если
// institutionName не передан, ищем ASPSP по стране+query; при >1 совпадении возвращаем
// список для выбора в UI вместо auth-ссылки (клиент повторяет запрос с institutionName).
//
// bank_connections.institution_id хранит СТРАНУ аспспа (не отдельный id — у Enable
// Banking институт идентifицируется парой name+country, отдельного id нет).

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { resolveCaller } from '@/lib/apiAuth'
import { findInstitutions, createAuth } from '@/lib/enableBanking'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const caller = await resolveCaller(req)
  if (!caller || !caller.owner) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }) }
  const { country, institutionName, query } = body || {}
  if (!country) return NextResponse.json({ error: 'country required' }, { status: 400 })
  if (!institutionName && !query) return NextResponse.json({ error: 'query required' }, { status: 400 })

  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  try {
    let institution: { name: string; country: string } | undefined
    if (institutionName) {
      institution = { name: institutionName, country }
    } else {
      const matches = await findInstitutions(country, query)
      if (matches.length === 0) {
        return NextResponse.json({ error: 'Банк не найден для этой страны' }, { status: 404 })
      }
      if (matches.length > 1) {
        return NextResponse.json({ institutions: matches })
      }
      institution = matches[0]
    }

    const { data: connection, error: insErr } = await admin.from('bank_connections').insert({
      restaurant_id: caller.rid, provider: 'enablebanking',
      institution_id: institution!.country, institution_name: institution!.name, status: 'pending',
    }).select().single()
    if (insErr || !connection) {
      return NextResponse.json({ error: insErr?.message || 'Не удалось создать подключение' }, { status: 500 })
    }

    const redirectUrl = `${req.nextUrl.origin}/api/bank/callback`
    const { link } = await createAuth(institution!, redirectUrl, connection.id)

    return NextResponse.json({ link })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Server error' }, { status: 500 })
  }
}
