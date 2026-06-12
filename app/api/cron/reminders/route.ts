// Vercel Cron: напоминания о сменах (mise People).
//
// Hobby-план Vercel ограничивает cron одним запуском в день, поэтому расписание —
// ежедневно в 18:00 UTC (vercel.json): напоминаем обо всех опубликованных сменах
// на завтра. Режимы reminder_mode/hours/time из restaurant_settings заработают точно
// после апгрейда на Vercel Pro (вернуть schedule "0 * * * *" и почасовую логику).
// Дедупликация — по notifications.data->schedule_id (одно напоминание на смену).
//
// Защита: Vercel сам шлёт `Authorization: Bearer ${CRON_SECRET}`, если переменная задана.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

function fmtDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const now = new Date()
  const today = fmtDate(now)
  const tomorrow = fmtDate(new Date(now.getTime() + 86400000))

  const { data: schedules } = await admin
    .from('staff_schedules').select('id, restaurant_id, staff_id, date, shift_start, shift_end')
    .eq('published', true).in('date', [today, tomorrow])
  if (!schedules?.length) return NextResponse.json({ ok: true, sent: 0 })

  // Уже отправленные напоминания за последние 2 дня → set(schedule_id)
  const since = new Date(now.getTime() - 2 * 86400000).toISOString()
  const { data: sentRows } = await admin.from('notifications')
    .select('data').eq('type', 'shift_reminder').gte('created_at', since)
  const alreadySent = new Set((sentRows || []).map((n: any) => n.data?.schedule_id).filter(Boolean))

  const inserts: any[] = []

  for (const sc of schedules) {
    if (alreadySent.has(sc.id)) continue
    // Один запуск в день → напоминаем накануне обо всех завтрашних сменах.
    if (sc.date !== tomorrow) continue

    const when = sc.date === today ? 'сегодня' : 'завтра'
    const time = sc.shift_start ? ` в ${String(sc.shift_start).slice(0, 5)}` : ''
    inserts.push({
      restaurant_id: sc.restaurant_id,
      staff_id: sc.staff_id,
      type: 'shift_reminder',
      title: 'Напоминание о смене',
      body: `Ваша смена ${when}${time}`,
      data: { schedule_id: sc.id },
      sent_at: now.toISOString(),
    })
  }

  if (inserts.length) {
    const { error } = await admin.from('notifications').insert(inserts)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true, sent: inserts.length })
}
