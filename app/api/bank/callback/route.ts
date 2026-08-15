// Редирект от банка после авторизации согласия (Enable Banking /auth redirect):
// ?code=...&state=<bank_connections.id>[:ios]. state — тот же токен мы передали как
// `state` при создании /auth в /api/bank/connect (":ios" суффикс — маркер платформы,
// см. комментарий там). Обменивает code на session_id + список привязанных счетов,
// сразу тянет первую историю (syncConnection), редиректит обратно в Analytics (веб)
// либо на кастомную схему com.rahim.mise:// (iOS, перехватывает ASWebAuthenticationSession).
// Reverse-DNS, не голое "mise" (аудит 2026-08-15, block-B — RFC 8252 §7.1).
//
// Авторизация — не cookie-сессия: на iOS этот запрос идёт из отдельного webview
// (ASWebAuthenticationSession), у которого нет staff-cookie нашего URLSession. Доверяем
// самому `state` — непредсказуемый UUID, созданный секундами ранее уже авторизованным
// /api/bank/connect, и single-use: как только status уходит в 'linked', повторный вызов
// с тем же state больше не найдёт 'pending'-строку.
//
// bank_connections.requisition_id хранит session_id Enable Banking (переиспользуем
// колонку от первой версии на GoCardless — семантика та же: «идентификатор согласия»).
//
// Claim атомарный (аудит-находка 2026-08-15): pending → processing одним UPDATE с
// условием status='pending' в WHERE — если строка не вернулась, значит state уже
// обработан параллельным вызовом (WebKit-ретрай навигации, двойной тап), и второй
// вызов не должен второй раз обменивать code на сессию.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createSession, syncConnection } from '@/lib/enableBanking'

export const dynamic = 'force-dynamic'

// ASWebAuthenticationSession перехватывает навигацию НА кастомную схему, но HTTP
// Location-редирект (30x) на неё WebKit часто не отдаёт сессии — сам пытается открыть
// com.rahim.mise://... как страницу и падает с «address is invalid» (юзер-фидбок 2026-08-16).
// Обходной путь (стандартный для OAuth+ASWebAuthenticationSession): 200 OK с HTML,
// который сам делает JS-навигацию на кастомную схему — это WebKit перехватывает.
function schemeRedirectHTML(url: string): NextResponse {
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>` +
    `<script>location.replace(${JSON.stringify(url)})</script></body></html>`
  return new NextResponse(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
}

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code')
  const rawState = req.nextUrl.searchParams.get('state')
  const origin = process.env.NEXT_PUBLIC_APP_URL
  const [ref, platform] = (rawState || '').split(':')
  const isIos = platform === 'ios'

  const fail = (msg: string) => isIos
    ? schemeRedirectHTML(`com.rahim.mise://bank-callback?error=${encodeURIComponent(msg)}`)
    : NextResponse.redirect(`${origin}/analytics?tab=bank&bankError=${encodeURIComponent(msg)}`)

  if (!ref || !code) return fail('unauthorized')

  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data: connection } = await admin.from('bank_connections')
    .update({ status: 'processing' }).eq('id', ref).eq('status', 'pending').select().single()
  if (!connection) return fail('not_found')

  try {
    const { sessionId, accountIds } = await createSession(code)
    if (accountIds.length === 0) {
      await admin.from('bank_connections').update({ status: 'error', error_message: 'Банк не вернул счёт' }).eq('id', connection.id)
      return fail('no_account')
    }
    const now = new Date()
    const expires = new Date(now.getTime() + 90 * 86400000)
    const { data: updated } = await admin.from('bank_connections').update({
      requisition_id: sessionId, account_id: accountIds[0], status: 'linked',
      consent_created_at: now.toISOString(), consent_expires_at: expires.toISOString(),
    }).eq('id', connection.id).select().single()

    await syncConnection(admin, updated)
    return isIos
      ? schemeRedirectHTML('com.rahim.mise://bank-callback?ok=1')
      : NextResponse.redirect(`${origin}/analytics?tab=bank`)
  } catch (err: any) {
    await admin.from('bank_connections').update({ status: 'error', error_message: err?.message || 'callback failed' }).eq('id', connection.id)
    return fail('sync_failed')
  }
}
