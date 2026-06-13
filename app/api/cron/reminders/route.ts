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
import { sendTrialEndingEmail } from '@/lib/email'

export const dynamic = 'force-dynamic'

function fmtDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Email owners whose trial ends within 3 days, once per day per restaurant.
// Fully guarded — any failure here must not affect shift reminders. No-op until
// RESEND_API_KEY is set (sendTrialEndingEmail skips silently).
async function sendTrialReminders(admin: any, now: Date): Promise<number> {
  try {
    const cutoff = new Date(now.getTime() + 3 * 86400000).toISOString()
    const { data: rests } = await admin
      .from('restaurants')
      .select('id, owner_id, subscription_status, subscription_ends_at')
      .eq('subscription_status', 'trialing')
      .not('subscription_ends_at', 'is', null)
      .lte('subscription_ends_at', cutoff)
    if (!rests?.length) return 0

    const today = fmtDate(now)
    // Dedup: one trial email per restaurant per day, tracked as a notification row.
    const { data: sentRows } = await admin.from('notifications')
      .select('restaurant_id, data').eq('type', 'trial_ending').gte('created_at', `${today}T00:00:00Z`)
    const sentToday = new Set((sentRows || []).map((n: any) => n.restaurant_id))

    let sent = 0
    for (const r of rests) {
      if (sentToday.has(r.id)) continue
      const ends = new Date(r.subscription_ends_at)
      const daysLeft = Math.max(0, Math.ceil((ends.getTime() - now.getTime()) / 86400000))
      const { data: u } = await admin.auth.admin.getUserById(r.owner_id)
      const email = u?.user?.email
      if (!email) continue
      const res = await sendTrialEndingEmail(email, daysLeft)
      // Record the attempt even when skipped (no key) to avoid re-querying every run.
      await admin.from('notifications').insert({
        restaurant_id: r.id, type: 'trial_ending',
        title: 'Окончание пробного периода', body: `Триал заканчивается через ${daysLeft} дн.`,
        data: { days_left: daysLeft, email_ok: !!res.ok }, sent_at: now.toISOString(),
      })
      if (res.ok) sent++
    }
    return sent
  } catch {
    return 0
  }
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
  if (!schedules?.length) {
    const trialEmails = await sendTrialReminders(admin, now)
    return NextResponse.json({ ok: true, sent: 0, trialEmails })
  }

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

  const trialEmails = await sendTrialReminders(admin, now)
  return NextResponse.json({ ok: true, sent: inserts.length, trialEmails })
}
