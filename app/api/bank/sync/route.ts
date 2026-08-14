// Ручное «Обновить» во вкладке «Банк». Троттлинг — не дёргаем банк чаще раза в час,
// бережём дневной лимит запросов к банку (PSD2 RTS), ежедневный cron уже покрывает
// фоновое обновление (app/api/cron/bank-sync).

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { resolveCaller } from '@/lib/apiAuth'
import { syncConnection } from '@/lib/enableBanking'

export const dynamic = 'force-dynamic'
const THROTTLE_MS = 60 * 60 * 1000

export async function POST(req: NextRequest) {
  const caller = await resolveCaller(req)
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!caller.owner && !caller.apps.includes('manager') && !caller.apps.includes('analytics')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data: connection } = await admin.from('bank_connections').select('*')
    .eq('restaurant_id', caller.rid).eq('status', 'linked')
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (!connection) return NextResponse.json({ error: 'Банк не подключён' }, { status: 404 })

  if (connection.last_synced_at && Date.now() - new Date(connection.last_synced_at).getTime() < THROTTLE_MS) {
    return NextResponse.json({ ok: true, throttled: true })
  }

  const result = await syncConnection(admin, connection)
  return NextResponse.json(result)
}
