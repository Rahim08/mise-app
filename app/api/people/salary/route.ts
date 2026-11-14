// GET /api/people/salary?month=YYYY-MM — личный расчёт зарплаты вызывающего (People).
// Только своя строка: сотрудник определяется по сессии, не по имени из запроса.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { resolveCaller } from '@/lib/apiAuth'
import { peopleContext, PeoplePolicyError } from '@/lib/peoplePolicy'
import { computePersonalSalary, monthBounds } from '@/lib/peopleSalary'

export const dynamic = 'force-dynamic'

// Таблица salary_history в части окружений ещё не создана (миграция salary-history-2026-09)
// — это не сбой, а «истории нет»: расчёт падает на текущий оклад, как и раньше.
const missingTable = (e: any) => e && (e.code === '42P01' || e.code === 'PGRST205')

export async function GET(req: NextRequest) {
  const caller = await resolveCaller(req)
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!caller.owner && !caller.apps.includes('people')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const bounds = monthBounds(req.nextUrl.searchParams.get('month') || '')
  if (!bounds) return NextResponse.json({ error: 'Invalid month' }, { status: 400 })
  const { monthStart, monthEnd } = bounds
  const ym = monthStart.slice(0, 7)

  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  let empId: string | null
  try { empId = caller.owner ? null : await peopleContext(admin, caller).ownEmployeeId() }
  catch (e) { return NextResponse.json({ error: e instanceof PeoplePolicyError ? e.message : 'Internal error' }, { status: 503 }) }
  if (!empId) return NextResponse.json({ data: null, month: ym })

  const rid = caller.rid
  const [emp, hist, abs, card, adv, pay, debt, att] = await Promise.all([
    admin.from('employees').select('id, name, salary, deduct_per_absence, is_active').eq('restaurant_id', rid).eq('id', empId).maybeSingle(),
    admin.from('salary_history').select('employee_id, salary, deduct_per_absence, effective_from').eq('restaurant_id', rid).eq('employee_id', empId).lte('effective_from', monthStart),
    admin.from('shift_absences').select('date, source').eq('restaurant_id', rid).eq('employee_id', empId).gte('date', monthStart).lte('date', monthEnd),
    admin.from('monthly_card_amounts').select('card_amount').eq('restaurant_id', rid).eq('employee_id', empId).eq('month', ym).limit(1),
    admin.from('salary_advances').select('id, amount, date, note, period').eq('restaurant_id', rid).eq('employee_id', empId).eq('period', monthStart),
    admin.from('salary_payments').select('amount, method, paid_at').eq('restaurant_id', rid).eq('employee_id', empId).eq('period', monthStart),
    admin.from('shift_expenses').select('amount').eq('restaurant_id', rid).eq('employee_id', empId).eq('is_paid', false).eq('note', `SALPERIOD:${monthStart}`),
    caller.sid && caller.sid !== 'owner'
      ? admin.from('attendance_records').select('check_in_at, check_out_at').eq('restaurant_id', rid).eq('staff_id', caller.sid).gte('date', monthStart).lte('date', monthEnd)
      : Promise.resolve({ data: [], error: null }),
  ])
  const failed = [emp, abs, card, adv, pay, debt, att].find(r => r.error) || (hist.error && !missingTable(hist.error) ? hist : null)
  if (failed) {
    console.error('[api/people/salary] query failed', failed.error)
    return NextResponse.json({ error: 'Salary could not be loaded' }, { status: 503 })
  }
  if (!emp.data || emp.data.is_active === false) return NextResponse.json({ data: null, month: ym })

  const data = computePersonalSalary({
    employee: emp.data, history: hist.error ? [] : (hist.data || []), absences: abs.data || [],
    cardAmount: card.data?.[0]?.card_amount ?? null, advances: adv.data || [], payments: pay.data || [],
    openDebt: (debt.data || []).reduce((s: number, d: any) => s + Number(d.amount || 0), 0),
    attendance: att.data || [], monthStart,
  })
  return NextResponse.json({ data, month: ym })
}
