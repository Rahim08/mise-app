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
import { sendPush } from '@/lib/apns'

export const dynamic = 'force-dynamic'
import { fmtDate } from '@/lib/format'

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

// Авто-прогул: для опубликованных смен сегодня, где с начала смены прошло grace-часов
// и нет гео-чек-ина, ставим черновик shift_absences (source='auto'). Менеджер увидит «X»
// при закрытии смены и подтвердит/снимет. Server-side, без фоновой геолокации → батарея не тратится.
// Полностью обёрнуто; no-op до применения миграции attendance-automation.sql.
async function autoMarkNoShows(admin: any, now: Date): Promise<number> {
  try {
    const today = fmtDate(now)
    const { data: settings } = await admin.from('restaurant_settings').select('restaurant_id, attendance_enabled, no_show_grace_hours')
    const cfg: Record<string, any> = {}; (settings || []).forEach((s: any) => { cfg[s.restaurant_id] = s })

    const { data: scheds } = await admin.from('staff_schedules')
      .select('restaurant_id, staff_id, date, shift_start')
      .eq('published', true).eq('date', today).not('shift_start', 'is', null)
    if (!scheds?.length) return 0

    const staffIds = [...new Set(scheds.map((s: any) => s.staff_id))]
    const { data: staffRows } = await admin.from('staff').select('id, employee_id').in('id', staffIds)
    const empOf: Record<string, string> = {}; (staffRows || []).forEach((s: any) => { if (s.employee_id) empOf[s.id] = s.employee_id })

    const { data: att } = await admin.from('attendance_records').select('staff_id').eq('date', today)
    const checkedIn = new Set((att || []).map((a: any) => a.staff_id))
    const { data: existAbs } = await admin.from('shift_absences').select('employee_id').eq('date', today)
    const hasAbs = new Set((existAbs || []).map((a: any) => a.employee_id))

    const inserts: any[] = []
    for (const sc of scheds) {
      const c = cfg[sc.restaurant_id]
      if (!c?.attendance_enabled) continue            // геоконтроль выключен у этой точки
      if (checkedIn.has(sc.staff_id)) continue          // отметился — не прогул
      const empId = empOf[sc.staff_id]
      if (!empId || hasAbs.has(empId)) continue         // нет связи staff↔employee или прогул уже есть
      const grace = Number(c.no_show_grace_hours ?? 3)
      const [h, m] = String(sc.shift_start).split(':').map(Number)
      const start = new Date(now); start.setHours(h || 0, m || 0, 0, 0)
      if (now.getTime() < start.getTime() + grace * 3600000) continue // grace ещё не истёк
      inserts.push({ restaurant_id: sc.restaurant_id, employee_id: empId, date: today, source: 'auto', auto_reason: 'no_show' })
      hasAbs.add(empId)
    }
    if (inserts.length) await admin.from('shift_absences').insert(inserts)
    return inserts.length
  } catch {
    return 0
  }
}

// Push для только что созданных напоминаний о сменах (с учётом pref shift_reminder).
async function pushShiftReminders(admin: any, inserts: any[]): Promise<number> {
  try {
    const staffIds = [...new Set(inserts.map(i => i.staff_id).filter(Boolean))]
    if (!staffIds.length) return 0
    const { data: prefs } = await admin.from('notification_prefs').select('staff_id, prefs').in('staff_id', staffIds)
    const prefMap: Record<string, any> = {}; (prefs || []).forEach((p: any) => { prefMap[p.staff_id] = p.prefs || {} })
    const { data: subs } = await admin.from('push_subscriptions').select('staff_id, device_token').in('staff_id', staffIds).not('device_token', 'is', null)
    const subMap: Record<string, string[]> = {}; (subs || []).forEach((s: any) => { (subMap[s.staff_id] ||= []).push(s.device_token) })
    let sent = 0
    for (const i of inserts) {
      if (!i.staff_id || prefMap[i.staff_id]?.shift_reminder === false) continue
      const tokens = subMap[i.staff_id]; if (!tokens?.length) continue
      const r = await sendPush(tokens, { title: i.title, body: i.body, data: i.data })
      sent += r.sent
    }
    return sent
  } catch { return 0 }
}

// Дневной дайджест закупа — только тем, у кого включён режим purchase_digest='daily'.
async function sendPurchaseDigest(admin: any, now: Date): Promise<number> {
  try {
    const today = fmtDate(now)
    const { data: items } = await admin.from('purchase_items')
      .select('restaurant_id').eq('status', 'todo').gte('created_at', `${today}T00:00:00Z`)
    if (!items?.length) return 0
    const byRest: Record<string, number> = {}
    items.forEach((it: any) => { byRest[it.restaurant_id] = (byRest[it.restaurant_id] || 0) + 1 })

    let sent = 0
    for (const rid of Object.keys(byRest)) {
      const count = byRest[rid]
      const { data: prefs } = await admin.from('notification_prefs').select('staff_id, to_owner, prefs').eq('restaurant_id', rid)
      const { data: mgrs } = await admin.from('staff').select('id').eq('restaurant_id', rid).eq('is_active', true).eq('role', 'manager')

      const recipients: { staff_id: string | null; to_owner: boolean }[] = []
      const ownerPref = (prefs || []).find((p: any) => p.to_owner)?.prefs || {}
      if (ownerPref.purchase_digest === 'daily' && ownerPref.purchase !== false) recipients.push({ staff_id: null, to_owner: true })
      ;(mgrs || []).forEach((m: any) => {
        const p = (prefs || []).find((x: any) => x.staff_id === m.id)?.prefs || {}
        if (p.purchase_digest === 'daily' && p.purchase !== false) recipients.push({ staff_id: m.id, to_owner: false })
      })
      if (!recipients.length) continue

      const title = 'Закуп за день'
      const body = `${count} позиц. к закупке`
      const nowIso = now.toISOString()
      await admin.from('notifications').insert(recipients.map(r => ({ restaurant_id: rid, staff_id: r.staff_id, to_owner: r.to_owner, type: 'purchase', title, body, sent_at: nowIso })))

      const { data: subs } = await admin.from('push_subscriptions').select('staff_id, to_owner, device_token').eq('restaurant_id', rid).not('device_token', 'is', null)
      for (const r of recipients) {
        const tokens = (subs || []).filter((s: any) => r.to_owner ? s.to_owner : s.staff_id === r.staff_id).map((s: any) => s.device_token)
        if (!tokens.length) continue
        const res = await sendPush(tokens, { title, body })
        sent += res.sent
      }
    }
    return sent
  } catch { return 0 }
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
    const noShows = await autoMarkNoShows(admin, now)
    const purchaseDigest = await sendPurchaseDigest(admin, now)
    return NextResponse.json({ ok: true, sent: 0, trialEmails, noShows, purchaseDigest })
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

  let pushed = 0
  if (inserts.length) {
    const { error } = await admin.from('notifications').insert(inserts)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    pushed = await pushShiftReminders(admin, inserts)
  }

  const trialEmails = await sendTrialReminders(admin, now)
  const noShows = await autoMarkNoShows(admin, now)
  const purchaseDigest = await sendPurchaseDigest(admin, now)
  return NextResponse.json({ ok: true, sent: inserts.length, pushed, trialEmails, noShows, purchaseDigest })
}
