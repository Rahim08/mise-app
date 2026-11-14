// Отключение банка — вкладка «Банк» в Analytics. Раньше выйти из подключённого счёта
// было нельзя: тестово подключённый личный счёт навсегда оставался виден всем, у кого
// есть доступ к Analytics/Manager заведения (юзер-фидбок 2026-09-30).
//
// Права — как у /api/bank/connect (owner + manager). Отзываем сессию в Enable Banking
// (best-effort: истёкшая/уже отозванная сессия не должна блокировать выход) и удаляем
// все подключения заведения — bank_transactions уходят каскадом, чтобы чужие операции
// не оставались в базе. Переподключить можно заново тем же флоу.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { resolveCaller } from '@/lib/apiAuth'
import { deleteSession } from '@/lib/enableBanking'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const caller = await resolveCaller(req)
  if (!caller || (!caller.owner && !caller.apps.includes('manager'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data: connections, error: selErr } = await admin.from('bank_connections')
    .select('id, requisition_id').eq('restaurant_id', caller.rid)
  if (selErr) return NextResponse.json({ error: selErr.message }, { status: 500 })

  for (const c of connections || []) {
    if (c.requisition_id) await deleteSession(c.requisition_id).catch(() => {})
  }

  const { error: delErr } = await admin.from('bank_connections').delete().eq('restaurant_id', caller.rid)
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
