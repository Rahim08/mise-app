// Редирект от банка после авторизации согласия (Enable Banking /auth redirect):
// ?code=...&state=<bank_connections.id>. state — тот же id мы передали как `state` при
// создании /auth в /api/bank/connect. Обменивает code на session_id + список привязанных
// счетов, сразу тянет первую историю (syncConnection), редиректит обратно в Analytics.
//
// bank_connections.requisition_id хранит session_id Enable Banking (переиспользуем
// колонку от первой версии на GoCardless — семантика та же: «идентификатор согласия»).

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { resolveCaller } from '@/lib/apiAuth'
import { createSession, syncConnection } from '@/lib/enableBanking'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code')
  const ref = req.nextUrl.searchParams.get('state')
  const origin = req.nextUrl.origin
  const fail = (msg: string) => NextResponse.redirect(`${origin}/analytics?tab=bank&bankError=${encodeURIComponent(msg)}`)

  const caller = await resolveCaller(req)
  if (!caller || !ref || !code) return fail('unauthorized')

  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data: connection } = await admin.from('bank_connections').select('*')
    .eq('id', ref).eq('restaurant_id', caller.rid).single()
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
    return NextResponse.redirect(`${origin}/analytics?tab=bank`)
  } catch (err: any) {
    await admin.from('bank_connections').update({ status: 'error', error_message: err?.message || 'callback failed' }).eq('id', connection.id)
    return fail('sync_failed')
  }
}
