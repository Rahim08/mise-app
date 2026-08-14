// Vercel Cron: ежедневный синк всех подключённых банк-счетов (Enable Banking). Hobby-план —
// 1 запуск/день (расписание в vercel.json), см. комментарий в
// app/api/cron/reminders/route.ts. Форма 1:1 с app/api/cron/google-reviews/route.ts.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { syncConnection } from '@/lib/enableBanking'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data: connections } = await admin.from('bank_connections').select('*').eq('status', 'linked')

  let synced = 0
  let failed = 0
  for (const c of (connections || [])) {
    const result = await syncConnection(admin, c)
    if (result.ok) synced++; else failed++
  }

  return NextResponse.json({ ok: true, synced, failed })
}
