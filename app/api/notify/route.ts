// Centralised notification trigger. Inserts the journal row(s) and sends APNs push,
// honoring each recipient's notification_prefs. Called from the app whenever an event
// happens (cash open/close, attendance, task, swap, purchase).
//
// Auth: same as /api/db — staff PIN token or owner Supabase session. The caller can only
// notify within its own restaurant (rid is taken from the verified session, never the body).

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { resolveCaller, isOfficial } from '@/lib/apiAuth'
import { dispatchNotification, type Audience } from '@/lib/notify'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const caller = await resolveCaller(req)
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }) }

  const { type, title, body: msgBody, titleKey, titleParams, bodyKey, bodyParams, bodySegments, secureBody, secureBodySegments, data, audience } = body || {}
  if (!type || !title) return NextResponse.json({ error: 'type and title required' }, { status: 400 })

  const aud: Audience = audience || {}
  if (!aud.staff_ids?.length && !aud.owner && !aud.managers && !aud.all) {
    return NextResponse.json({ error: 'audience required' }, { status: 400 })
  }

  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  // Широковещательный пуш всей команде не гейтится ролью нигде ниже (dispatchNotification
  // просто рассылает) — без этой проверки любой сотрудник мог разослать пуш от имени
  // руководства (аудит 2026-08-05, №5).
  if (aud.all && !(await isOfficial(admin, caller))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const result = await dispatchNotification(admin, caller.rid, {
      type, title, body: msgBody, titleKey, titleParams, bodyKey, bodyParams, bodySegments, secureBody, secureBodySegments, data, audience: aud,
    })
    return NextResponse.json({ ok: true, ...result })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Server error' }, { status: 500 })
  }
}
