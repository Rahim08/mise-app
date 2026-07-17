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
import { dispatchNotification } from '@/lib/notify'

export const dynamic = 'force-dynamic'
import { fmtDate } from '@/lib/format'

// Аудит-находка 7: «сегодня/сейчас» считаем в таймзоне ресторана
// (restaurant_settings.timezone, IANA, дефолт UTC). Колонка может отсутствовать до
// миграции restaurant-timezone-2026-07.sql — loadTimezones терпит это (нет ключа → UTC).
function localParts(now: Date, tz?: string | null): { dateKey: string; hm: string; dow: number; dom: number } {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short',
    }).formatToParts(now)
    const g = (t: string) => parts.find(p => p.type === t)?.value || ''
    const dowMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
    return { dateKey: `${g('year')}-${g('month')}-${g('day')}`, hm: `${g('hour')}:${g('minute')}`, dow: dowMap[g('weekday')] ?? now.getUTCDay(), dom: parseInt(g('day'), 10) }
  } catch {
    // Кривая tz в БД не должна ронять cron — падаем в UTC.
    return { dateKey: fmtDate(now), hm: `${String(now.getUTCHours()).padStart(2, '0')}:${String(now.getUTCMinutes()).padStart(2, '0')}`, dow: now.getUTCDay(), dom: now.getUTCDate() }
  }
}

function nextDayKey(dateKey: string): string {
  const d = new Date(`${dateKey}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

async function loadTimezones(admin: any): Promise<Record<string, string>> {
  try {
    const { data } = await admin.from('restaurant_settings').select('*')
    const map: Record<string, string> = {}
    ;(data || []).forEach((s: any) => { if (s.timezone) map[s.restaurant_id] = s.timezone })
    return map
  } catch { return {} }
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
      // Журнал+пуш владельцу на его языке; запись даже при пропущенном email (нет ключа) —
      // чтобы не перезапрашивать каждый прогон (дедуп выше читает эти строки).
      await dispatchNotification(admin, r.id, {
        type: 'trial_ending',
        title: 'Trial ending', body: `Trial ends in ${daysLeft} d.`,
        titleKey: 'notify.trialEndingTitle', bodyKey: 'notify.trialEndingBody', bodyParams: { n: daysLeft },
        data: { days_left: daysLeft, email_ok: !!res.ok },
        audience: { owner: true },
      }).catch(() => {})
      if (res.ok) sent++
    }
    return sent
  } catch {
    return 0
  }
}

// Биллинг v2: триал 14 дней живёт только в БД (без Stripe) — истёкшие гасим сами.
// Только ряды без subscription_id: триалы, начатые через Stripe-checkout (старый флоу),
// закрывает вебхук.
async function expireTrials(admin: any, now: Date): Promise<number> {
  try {
    const { data, error } = await admin.from('restaurants')
      .update({ subscription_status: 'inactive' })
      .eq('subscription_status', 'trialing')
      .is('subscription_id', null)
      .lt('subscription_ends_at', now.toISOString())
      .select('id')
    if (error) return 0
    return data?.length || 0
  } catch { return 0 }
}

// Авто-прогул: для опубликованных смен сегодня, где с начала смены прошло grace-часов
// и нет гео-чек-ина, ставим черновик shift_absences (source='auto'). Менеджер увидит «X»
// при закрытии смены и подтвердит/снимет. Server-side, без фоновой геолокации → батарея не тратится.
// Полностью обёрнуто; no-op до применения миграции attendance-automation.sql.
async function autoMarkNoShows(admin: any, now: Date, tzMap: Record<string, string>): Promise<number> {
  try {
    const today = fmtDate(now)
    const tomorrow = fmtDate(new Date(now.getTime() + 86400000))
    const { data: settings } = await admin.from('restaurant_settings').select('*')
    const cfg: Record<string, any> = {}; (settings || []).forEach((s: any) => { cfg[s.restaurant_id] = s })

    // Местное «сегодня» точки восточнее UTC может быть уже utc-завтра → берём оба дня и фильтруем по tz.
    const { data: scheds } = await admin.from('staff_schedules')
      .select('restaurant_id, staff_id, date, shift_start')
      .eq('published', true).in('date', [today, tomorrow]).not('shift_start', 'is', null)
    if (!scheds?.length) return 0

    const staffIds = [...new Set(scheds.map((s: any) => s.staff_id))]
    const { data: staffRows } = await admin.from('staff').select('id, employee_id').in('id', staffIds)
    const empOf: Record<string, string> = {}; (staffRows || []).forEach((s: any) => { if (s.employee_id) empOf[s.id] = s.employee_id })

    const { data: att } = await admin.from('attendance_records').select('staff_id, date').in('date', [today, tomorrow])
    const checkedIn = new Set((att || []).map((a: any) => `${a.staff_id}|${a.date}`))
    const { data: existAbs } = await admin.from('shift_absences').select('employee_id, date').in('date', [today, tomorrow])
    const hasAbs = new Set((existAbs || []).map((a: any) => `${a.employee_id}|${a.date}`))

    const inserts: any[] = []
    for (const sc of scheds) {
      const c = cfg[sc.restaurant_id]
      if (!c?.attendance_enabled) continue            // геоконтроль выключен у этой точки
      const lp = localParts(now, tzMap[sc.restaurant_id])
      if (sc.date !== lp.dateKey) continue              // смена не «сегодня» по местному времени
      if (checkedIn.has(`${sc.staff_id}|${sc.date}`)) continue // отметился — не прогул
      const empId = empOf[sc.staff_id]
      if (!empId || hasAbs.has(`${empId}|${sc.date}`)) continue // нет связи staff↔employee или прогул уже есть
      const grace = Number(c.no_show_grace_hours ?? 3)
      const [h, m] = String(sc.shift_start).split(':').map(Number)
      const [nh, nm] = lp.hm.split(':').map(Number)
      if (nh * 60 + nm < (h || 0) * 60 + (m || 0) + grace * 60) continue // grace ещё не истёк (местное время)
      inserts.push({ restaurant_id: sc.restaurant_id, employee_id: empId, date: sc.date, source: 'auto', auto_reason: 'no_show' })
      hasAbs.add(`${empId}|${sc.date}`)
    }
    if (inserts.length) await admin.from('shift_absences').insert(inserts)
    return inserts.length
  } catch {
    return 0
  }
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

      // Локализованный дайджест на языке устройства получателя; data.digest — чтобы
      // dispatchNotification не глушил push у purchase_digest='daily' (это и есть их дайджест).
      const res = await dispatchNotification(admin, rid, {
        type: 'purchase',
        title: 'Purchase — daily summary', body: `${count} items to purchase`,
        titleKey: 'notify.purchaseDigestTitle',
        bodyKey: 'notify.purchaseDigestBody', bodyParams: { n: count },
        data: { digest: true },
        audience: {
          owner: recipients.some(r => r.to_owner),
          staff_ids: recipients.filter(r => r.staff_id).map(r => r.staff_id!),
        },
      }).catch(() => ({ inserted: 0, push: 0 }))
      sent += res.push
    }
    return sent
  } catch { return 0 }
}

// Аудиты Ф2: авто-запуск разовых проверок по расписанию (kind='audit', recurrence != 'none').
// Один прогон/день (та же Vercel Hobby-оговорка, что и у остальных функций в этом файле) —
// daily срабатывает каждый день, weekly — если сегодняшний день недели в recurrence_weekdays,
// monthly — если сегодняшнее число месяца === recurrence_day_of_month. Дедуп —
// recurrence_last_run != сегодня (обновляем сразу после создания прогона).
async function runScheduledAudits(admin: any, now: Date, tzMap: Record<string, string>): Promise<number> {
  try {
    const { data: templates } = await admin.from('shift_checklists')
      .select('id, restaurant_id, title, items, role, target_scope, assigned_staff_id, recurrence, recurrence_weekdays, recurrence_day_of_month, recurrence_last_run')
      .eq('kind', 'audit').neq('recurrence', 'none')
    if (!templates?.length) return 0

    let created = 0
    for (const tpl of templates) {
      // «Сегодня»/день недели/число месяца — в таймзоне точки.
      const lp = localParts(now, tzMap[tpl.restaurant_id])
      const today = lp.dateKey
      if (tpl.recurrence_last_run === today) continue // уже заведён сегодня
      const matches =
        tpl.recurrence === 'daily' ||
        (tpl.recurrence === 'weekly' && Array.isArray(tpl.recurrence_weekdays) && tpl.recurrence_weekdays.includes(lp.dow)) ||
        (tpl.recurrence === 'monthly' && tpl.recurrence_day_of_month === lp.dom)
      if (!matches) continue

      // Доп. страховка от задвоения: recurrence_last_run обновляется отдельным запросом от
      // insert (не атомарно) — если между ними прервётся выполнение, следующий прогон в тот
      // же день не должен создать второй completion на (checklist_id, date).
      const { data: already } = await admin.from('shift_checklist_completions')
        .select('id').eq('checklist_id', tpl.id).eq('date', today).limit(1)
      if (already?.length) { await admin.from('shift_checklists').update({ recurrence_last_run: today }).eq('id', tpl.id); continue }

      const { error: compErr } = await admin.from('shift_checklist_completions').insert({
        checklist_id: tpl.id, date: today, status: 'pending', requested_by: null,
      })
      if (compErr) continue
      await admin.from('shift_checklists').update({ recurrence_last_run: today }).eq('id', tpl.id)
      created++

      // Целевая аудитория — та же логика, что при ручном запуске (роль/сотрудник/вся точка).
      let staffIds: string[] = []
      if (tpl.target_scope === 'role' && tpl.role) {
        const { data: byRole } = await admin.from('staff').select('id').eq('restaurant_id', tpl.restaurant_id).eq('is_active', true).eq('role', tpl.role)
        staffIds = (byRole || []).map((s: any) => s.id)
      } else if (tpl.target_scope === 'staff' && tpl.assigned_staff_id) {
        staffIds = [tpl.assigned_staff_id]
      } else {
        const { data: all } = await admin.from('staff').select('id').eq('restaurant_id', tpl.restaurant_id).eq('is_active', true)
        staffIds = (all || []).map((s: any) => s.id)
      }
      if (staffIds.length) {
        await dispatchNotification(admin, tpl.restaurant_id, {
          type: 'audit', title: 'New audit', body: tpl.title || '',
          titleKey: 'notify.auditAssignedTitle', bodyKey: 'notify.auditAssignedBody',
          bodyParams: { name: 'Mise', title: tpl.title || '' },
          audience: { staff_ids: staffIds },
        }).catch(() => {})
      }
    }
    return created
  } catch {
    return 0
  }
}

// Напоминание менеджеру: чек-лист закрытия смены не пройден, а смена за сегодня уже открыта
// (значит рабочий день идёт/подходит к концу). Один раз в день на точку, дедуп через
// notifications.type='audit_close_reminder'.
async function remindOpenCloseChecklist(admin: any, now: Date, tzMap: Record<string, string>): Promise<number> {
  try {
    const today = fmtDate(now)
    const tomorrow = fmtDate(new Date(now.getTime() + 86400000))
    const { data: shifts } = await admin.from('shifts').select('id, restaurant_id, date').in('date', [today, tomorrow])
    if (!shifts?.length) return 0

    const { data: sentRows } = await admin.from('notifications')
      .select('restaurant_id').eq('type', 'audit_close_reminder').gte('created_at', `${today}T00:00:00Z`)
    const alreadySent = new Set((sentRows || []).map((n: any) => n.restaurant_id))

    const { data: closeLists } = await admin.from('shift_checklists').select('id, restaurant_id').eq('kind', 'shift').eq('type', 'close')
    const closeIdsByRest: Record<string, string[]> = {}
    ;(closeLists || []).forEach((l: any) => { (closeIdsByRest[l.restaurant_id] ||= []).push(l.id) })

    const { data: completions } = await admin.from('shift_checklist_completions').select('checklist_id, status, date').in('date', [today, tomorrow])
    const doneIds = new Set((completions || []).filter((c: any) => c.status === 'done').map((c: any) => `${c.checklist_id}|${c.date}`))

    let sent = 0
    for (const sh of shifts) {
      if (alreadySent.has(sh.restaurant_id)) continue
      if (sh.date !== localParts(now, tzMap[sh.restaurant_id]).dateKey) continue // смена не «сегодня» по местному времени
      const closeIds = closeIdsByRest[sh.restaurant_id]
      if (!closeIds?.length) continue // нет чек-листа закрытия — нечего напоминать
      const allDone = closeIds.every(id => doneIds.has(`${id}|${sh.date}`))
      if (allDone) continue

      await dispatchNotification(admin, sh.restaurant_id, {
        type: 'audit_close_reminder', title: 'Closing checklist not done', body: 'Not all items are checked yet',
        titleKey: 'notify.closeChecklistReminderTitle', bodyKey: 'notify.closeChecklistReminderBody',
        audience: { managers: true },
      }).catch(() => {})
      sent++
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
  const dayAfter = fmtDate(new Date(now.getTime() + 2 * 86400000))
  const tzMap = await loadTimezones(admin)

  // Местное «завтра» точки может быть utc-послезавтра (tz восточнее UTC) → берём 3 дня, фильтруем по tz.
  const { data: schedules } = await admin
    .from('staff_schedules').select('id, restaurant_id, staff_id, date, shift_start, shift_end')
    .eq('published', true).in('date', [today, tomorrow, dayAfter])
  if (!schedules?.length) {
    const trialEmails = await sendTrialReminders(admin, now)
    const trialsExpired = await expireTrials(admin, now)
    const noShows = await autoMarkNoShows(admin, now, tzMap)
    const purchaseDigest = await sendPurchaseDigest(admin, now)
    const scheduledAudits = await runScheduledAudits(admin, now, tzMap)
    const closeReminders = await remindOpenCloseChecklist(admin, now, tzMap)
    return NextResponse.json({ ok: true, sent: 0, trialEmails, trialsExpired, noShows, purchaseDigest, scheduledAudits, closeReminders })
  }

  // Уже отправленные напоминания за последние 2 дня → set(schedule_id)
  const since = new Date(now.getTime() - 2 * 86400000).toISOString()
  const { data: sentRows } = await admin.from('notifications')
    .select('data').eq('type', 'shift_reminder').gte('created_at', since)
  const alreadySent = new Set((sentRows || []).map((n: any) => n.data?.schedule_id).filter(Boolean))

  // Журнал + push на языке устройства получателя (dispatchNotification уважает
  // pref shift_reminder и пишет notifications.data.schedule_id для дедупа выше).
  let reminded = 0
  let pushed = 0
  for (const sc of schedules) {
    if (alreadySent.has(sc.id)) continue
    // Один запуск в день → напоминаем накануне обо всех завтрашних (по tz точки) сменах.
    if (sc.date !== nextDayKey(localParts(now, tzMap[sc.restaurant_id]).dateKey)) continue

    const time = sc.shift_start ? String(sc.shift_start).slice(0, 5) : ''
    const res = await dispatchNotification(admin, sc.restaurant_id, {
      type: 'shift_reminder',
      title: 'Shift reminder', body: time ? `Your shift is tomorrow at ${time}` : 'Your shift is tomorrow',
      titleKey: 'notify.shiftReminderTitle',
      bodyKey: time ? 'notify.shiftReminderBodyTime' : 'notify.shiftReminderBody',
      bodyParams: time ? { time } : undefined,
      data: { schedule_id: sc.id },
      audience: { staff_ids: [sc.staff_id] },
    }).catch(() => ({ inserted: 0, push: 0 }))
    reminded += res.inserted
    pushed += res.push
  }

  const trialEmails = await sendTrialReminders(admin, now)
  const trialsExpired = await expireTrials(admin, now)
  const noShows = await autoMarkNoShows(admin, now, tzMap)
  const purchaseDigest = await sendPurchaseDigest(admin, now)
  const scheduledAudits = await runScheduledAudits(admin, now, tzMap)
  const closeReminders = await remindOpenCloseChecklist(admin, now, tzMap)
  return NextResponse.json({ ok: true, sent: reminded, pushed, trialEmails, trialsExpired, noShows, purchaseDigest, scheduledAudits, closeReminders })
}
