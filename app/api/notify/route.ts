// Centralised notification trigger. Inserts the journal row(s) and sends APNs push,
// honoring each recipient's notification_prefs. Called from the app whenever an event
// happens (cash open/close, attendance, task, swap, purchase).
//
// Auth: same as /api/db — staff PIN token or owner Supabase session. The caller can only
// notify within its own restaurant (rid is taken from the verified session, never the body).

import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { resolveCaller, isOfficial } from '@/lib/apiAuth'
import { dispatchNotification, type Audience } from '@/lib/notify'
import { checkRateLimit, rateLimitKey } from '@/lib/rateLimit'
import { BookingPolicyError, UUID_RE, requireBookingAccess, bookingAuthor } from '@/lib/bookingPolicy'

export const dynamic = 'force-dynamic'

// Что может отправить сотрудник без роли руководителя (аудит безопасности 2026-10-26): раньше
// любой сотрудник мог прямым запросом разослать владельцу/менеджерам пуш с произвольным
// заголовком и текстом — выглядело как системное уведомление («Касса закрыта…»). Теперь
// заголовок — только шаблон из этого списка (рендерится сервером), шаблоны кассы/склада —
// только при доступе к соответствующему модулю. null = любой сотрудник.
const STAFF_TITLE_KEYS: Record<string, string[] | null> = {
  'notify.cashOpenTitle': ['manager'],
  'notify.cashCloseTitle': ['manager'],
  'notify.stashInTitle': ['stash'],
  'notify.stashOutTitle': ['stash'],
  'notify.stashWriteoffTitle': ['stash'],
  'notify.lowStockTitle': ['stash'],
  'notify.bookingTitle': null,
  'notify.newTaskTitle': null,
  'notify.newReportTitle': null,
  'notify.attendanceTitle': null,
  'notify.swapRequestTitle': null,
  'notify.swapPendingTitle': null,
  'notify.swapDeclinedTitle': null,
  'notify.swapApprovedTitle': null,
  'notify.purchaseTitle': null,
  'notify.auditAssignedTitle': null,
  'notify.violationTitle': null,
}
// Старые сборки iOS могли слать уведомление без titleKey — заголовок берём по типу, а не
// из присланного текста, чтобы у сотрудников на старой версии пуши не пропали.
const TYPE_TITLE_KEY: Record<string, string> = {
  cash_close: 'notify.cashCloseTitle', cash_open: 'notify.cashOpenTitle',
  stash_in: 'notify.stashInTitle', stash_out: 'notify.stashOutTitle', stash_writeoff: 'notify.stashWriteoffTitle',
  booking: 'notify.bookingTitle', task: 'notify.newTaskTitle', report: 'notify.newReportTitle',
  attendance: 'notify.attendanceTitle', swap_request: 'notify.swapRequestTitle', audit: 'notify.auditAssignedTitle',
}
const MAX_TEXT = 300
const MAX_PARAM = 80
const clip = (v: unknown, n: number) => typeof v === 'string' ? v.slice(0, n) : v
const clipParams = (p: any) => p && typeof p === 'object'
  ? Object.fromEntries(Object.entries(p).map(([k, v]) => [k, clip(v, MAX_PARAM)])) : p

export async function POST(req: NextRequest) {
  const caller = await resolveCaller(req)
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }) }

  const { type, title, body: msgBody, titleKey, titleParams, bodyKey, bodyParams, bodySegments, secureBody, secureBodySegments, data, audience } = body || {}
  if (!type || !title) return NextResponse.json({ error: 'type and title required' }, { status: 400 })

  // Booking events are derived from a persisted record, never a client-supplied
  // announcement. A token-checked lease serializes retryable dispatch attempts.
  if (type === 'booking' || titleKey === 'notify.bookingTitle') {
    if (type !== 'booking') return NextResponse.json({ error:'Invalid booking event' },{status:400})
    if (!await checkRateLimit(rateLimitKey(req,`booking-notify:${caller.rid}:${caller.sid || 'owner'}`),30,60_000)) {
      return NextResponse.json({ error:'Rate limit' },{status:429})
    }
    if (typeof data?.booking_id !== 'string' || !UUID_RE.test(data.booking_id)) return NextResponse.json({ error:'Persisted booking ID required' },{status:400})
    const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!)
    const claimToken = randomUUID()
    let claimedBookingId: string | null = null
    try {
      await requireBookingAccess(admin,caller)
      const {data: booking,error} = await admin.from('bookings')
        .select('id, created_by, booking_date, booking_time, guest_name, guests_count, table_label')
        .eq('restaurant_id',caller.rid).eq('id',data.booking_id.toLowerCase()).maybeSingle()
      if (error) return NextResponse.json({ error:'Booking could not be verified' },{status:503})
      if (!booking) return NextResponse.json({ error:'Booking not found' },{status:404})
      if (booking.created_by !== bookingAuthor(caller) && !await isOfficial(admin,caller)) return NextResponse.json({ error:'Forbidden' },{status:403})
      const {data: claimed,error: claimError} = await admin.rpc('booking_notification_claim',{p_restaurant_id:caller.rid,p_booking_id:booking.id,p_claim_token:claimToken})
      if (claimError || typeof claimed !== 'boolean') return NextResponse.json({ error:'Booking notification could not be claimed' },{status:503})
      if (!claimed) return NextResponse.json({ok:true,inserted:0,push:0})
      claimedBookingId = booking.id
      const segments: {key?:string;value:string}[] = []
      if (booking.guest_name) segments.push({value:booking.guest_name})
      if (booking.guests_count) segments.push({value:String(booking.guests_count)})
      if (booking.booking_time) segments.push({value:booking.booking_time})
      if (booking.table_label) segments.push({key:'notify.bookingTable',value:booking.table_label})
      if (booking.booking_date) segments.push({value:booking.booking_date})
      const result = await dispatchNotification(admin,caller.rid,{
        type:'booking',title:'New booking',titleKey:'notify.bookingTitle',bodySegments:segments,eventKey:`booking:${booking.id}`,
        data:{module:'bookings',booking_id:booking.id,booking_date:booking.booking_date},audience:{managers:true},
      })
      const {data: finished,error: finishError} = await admin.rpc('booking_notification_finish',{
        p_restaurant_id:caller.rid,p_booking_id:booking.id,p_claim_token:claimToken,p_success:true,
      })
      if (finishError || finished !== true) throw new Error('Booking notification completion could not be recorded')
      claimedBookingId = null
      return NextResponse.json({ok:true,...result})
    } catch (error) {
      if (claimedBookingId) {
        try {
          const {error: releaseError} = await admin.rpc('booking_notification_finish',{
            p_restaurant_id:caller.rid,p_booking_id:claimedBookingId,p_claim_token:claimToken,p_success:false,
          })
          if (releaseError) console.error('[api/notify] booking lease release failed',releaseError)
        } catch (releaseError) { console.error('[api/notify] booking lease release failed',releaseError) }
      }
      if (error instanceof BookingPolicyError) return NextResponse.json({error:error.message},{status:error.status})
      console.error('[api/notify] booking dispatch failed',error)
      return NextResponse.json({error:'Booking notification failed'},{status:503})
    }
  }

  const aud: Audience = audience || {}
  if (!aud.staff_ids?.length && !aud.owner && !aud.managers && !aud.all) {
    return NextResponse.json({ error: 'audience required' }, { status: 400 })
  }

  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  // Широковещательный пуш всей команде не гейтится ролью нигде ниже (dispatchNotification
  // просто рассылает) — без этой проверки любой сотрудник мог разослать пуш от имени
  // руководства (аудит 2026-08-05, №5). Проверка — ниже, вместе с шаблонами заголовков.

  const official = await isOfficial(admin, caller)
  if (aud.all && !official) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  let effTitleKey: string | undefined = titleKey
  if (!official && !effTitleKey && typeof type === 'string') effTitleKey = TYPE_TITLE_KEY[type]
  if (!official) {
    if (typeof effTitleKey !== 'string' || !(effTitleKey in STAFF_TITLE_KEYS)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const needApps = STAFF_TITLE_KEYS[effTitleKey]
    if (needApps && !needApps.some(a => caller.apps.includes(a as any))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  try {
    const result = await dispatchNotification(admin, caller.rid, official ? {
      type, title, body: msgBody, titleKey, titleParams, bodyKey, bodyParams, bodySegments, secureBody, secureBodySegments, data, audience: aud,
    } : {
      type, title: clip(title, MAX_PARAM) as string, body: clip(msgBody, MAX_TEXT) as string, titleKey: effTitleKey,
      titleParams: clipParams(titleParams), bodyKey, bodyParams: clipParams(bodyParams),
      bodySegments, secureBody: clip(secureBody, MAX_TEXT) as string, secureBodySegments, data, audience: aud,
    })
    return NextResponse.json({ ok: true, ...result })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Server error' }, { status: 500 })
  }
}
