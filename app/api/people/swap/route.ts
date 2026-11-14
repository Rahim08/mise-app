// POST /api/people/swap {id} — утверждение обмена сменой должностным лицом.
//
// Раньше клиент делал два независимых запроса (перевесить смену → пометить заявку): при
// сбое второго сотрудник в графике уже был заменён, заявка оставалась «ждёт менеджера», а
// iOS всё равно показывал «Обмен утверждён». Теперь: сначала атомарно «захватываем»
// заявку (peer_accepted → approved, повторное утверждение невозможно), затем перевешиваем
// смену только если она всё ещё за инициатором; при неудаче заявка откатывается.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { resolveCaller } from '@/lib/apiAuth'
import { peopleContext, PeoplePolicyError } from '@/lib/peoplePolicy'

export const dynamic = 'force-dynamic'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(req: NextRequest) {
  const caller = await resolveCaller(req)
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!caller.owner && !caller.apps.includes('people')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }) }
  const id = body?.id
  if (typeof id !== 'string' || !UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  try {
    if (!(await peopleContext(admin, caller).official())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  } catch (e) {
    return NextResponse.json({ error: e instanceof PeoplePolicyError ? e.message : 'Internal error' }, { status: 503 })
  }
  const managerId = caller.owner || !caller.sid || caller.sid === 'owner' ? null : caller.sid
  const now = new Date().toISOString()

  const { data: claimed, error: claimErr } = await admin.from('shift_swap_requests')
    .update({ status: 'approved', manager_id: managerId, manager_responded_at: now })
    .eq('restaurant_id', caller.rid).eq('id', id).eq('status', 'peer_accepted')
    .select('id, schedule_id, requester_id, target_id').maybeSingle()
  if (claimErr) return NextResponse.json({ error: 'Swap could not be saved' }, { status: 503 })
  if (!claimed) return NextResponse.json({ error: 'Swap is no longer waiting for approval', code: 'swap_state' }, { status: 409 })

  const rollback = () => admin.from('shift_swap_requests')
    .update({ status: 'peer_accepted', manager_id: null, manager_responded_at: null })
    .eq('restaurant_id', caller.rid).eq('id', id).eq('status', 'approved')

  const { data: moved, error: moveErr } = await admin.from('staff_schedules')
    .update({ staff_id: claimed.target_id })
    .eq('restaurant_id', caller.rid).eq('id', claimed.schedule_id).eq('staff_id', claimed.requester_id)
    .select('id')
  if (moveErr || !moved?.length) {
    const { error: rbErr } = await rollback()
    if (rbErr) console.error('[api/people/swap] rollback failed', id, rbErr)
    return moveErr
      ? NextResponse.json({ error: 'Swap could not be saved' }, { status: 503 })
      : NextResponse.json({ error: 'Shift changed since the request', code: 'swap_shift_changed' }, { status: 409 })
  }
  return NextResponse.json({ data: claimed })
}
