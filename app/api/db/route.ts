// Authenticated data gateway.
//
// Replaces direct anon-key Supabase access from the browser. Every request is bound to a
// restaurant via the verified staff token (PIN session) or the owner's Supabase session.
// The server forces restaurant scoping and per-app authorization, then runs the query with
// the service-role key. With this in place, RLS can deny anon entirely (see docs/security/rls.sql).
//
// NOTE: the public guest menu (read published menu + create order) is intentionally NOT routed
// here — it stays anon and is guarded by narrow public RLS policies.

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { verifyStaffToken, STAFF_COOKIE } from '@/lib/staffToken'

type AppId = 'manager' | 'analytics' | 'stash' | 'people'

interface Caller { rid: string; owner: boolean; apps: string[] }

// Per-table policy. `read`/`write` list the apps allowed (owner is always allowed).
// Empty array = owner only. `scope` is the column used to restrict rows to the restaurant.
const POLICY: Record<string, { read: AppId[]; write: AppId[]; scope?: string }> = {
  restaurants:          { read: ['manager', 'analytics', 'stash', 'people'], write: [], scope: 'id' },
  restaurant_settings:  { read: ['manager', 'analytics', 'people'], write: [] },
  staff:                { read: [], write: [] },
  employees:            { read: ['manager', 'analytics', 'people'], write: [] }, // people: свой расчёт зарплаты
  expense_categories:   { read: ['manager', 'analytics'], write: [] },
  shifts:               { read: ['manager', 'analytics', 'people'], write: ['manager'] }, // people: чек-лист привязан к открытой смене
  shift_expenses:       { read: ['manager', 'analytics'], write: ['manager'] },
  shift_absences:       { read: ['manager', 'analytics', 'people'], write: ['manager'] },
  inkassations:         { read: ['manager', 'analytics'], write: ['manager'] },
  transactions:         { read: ['manager', 'analytics'], write: ['manager'] },
  monthly_card_amounts: { read: ['analytics', 'people'], write: ['analytics'] }, // помесячная сумма на карту правится в Analytics
  salary_records:       { read: ['analytics'], write: [] },
  tobacco_stock:        { read: ['stash', 'analytics'], write: ['stash'] }, // analytics: остаток склада на вкладке Кальян
  tobacco_movements:    { read: ['stash', 'analytics'], write: ['stash'] },
  hookah_sales:         { read: ['stash', 'analytics'], write: ['stash'] }, // смена кальянщика
  hookah_types:         { read: ['stash', 'analytics'], write: [] },        // виды кальянов — правит владелец
  tobacco_flavors:      { read: ['stash'], write: ['stash'] },
  tobacco_inventories:  { read: ['stash'], write: ['stash'] },
  menu_settings:        { read: ['people'], write: [] },
  menu_categories:      { read: ['people'], write: [] },
  menu_items:           { read: ['people'], write: ['people'] }, // People stop-list toggles is_available
  menu_orders:          { read: ['manager', 'people'], write: ['people'] }, // orders inbox updates status
  // mise People (operational layer)
  staff_tasks:                 { read: ['people'], write: ['people'] },
  staff_reports:               { read: ['people'], write: ['people'] },
  staff_schedules:             { read: ['people'], write: ['people'] },
  tech_cards:                  { read: ['people'], write: ['people'] },
  tech_card_sessions:          { read: ['people'], write: ['people'] },
  shift_checklists:            { read: ['people'], write: ['people'] },
  shift_checklist_completions: { read: ['people'], write: ['people'] },
  shift_swap_requests:         { read: ['people'], write: ['people'] },
  attendance_records:          { read: ['people'], write: ['people'] },
  push_subscriptions:          { read: ['people'], write: ['people'] },
  notifications:               { read: ['people'], write: ['people'] },
  // safe read-only directory of teammates (no pin_hash)
  staff_directory:             { read: ['manager', 'analytics', 'stash', 'people'], write: [] },
}

const FILTER_OPS = new Set(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'is', 'like', 'ilike'])

// Plan limits — must match PLANS in app/dashboard/page.tsx. Enforced server-side so the
// UI gate can't be bypassed by calling the gateway directly.
const PLAN_LIMITS: Record<string, { maxStaff: number; apps: string[] }> = {
  starter:  { maxStaff: 2,  apps: ['manager', 'analytics'] },
  business: { maxStaff: 5,  apps: ['manager', 'analytics', 'stash', 'people'] },
  pro:      { maxStaff: 10, apps: ['manager', 'analytics', 'stash', 'people'] },
}

// Granting app access on `staff` is the billable action: check the count of active staff
// with access and the per-plan app whitelist. Returns an error message or null.
async function checkStaffPlanLimit(admin: any, rid: string, values: any, filters: any[]): Promise<string | null> {
  const rows = Array.isArray(values) ? values : [values]
  const grantsApps = rows.some(v => Array.isArray(v?.apps) && v.apps.length > 0)
  if (!grantsApps) return null

  const { data: rest } = await admin.from('restaurants').select('subscription_plan, comp_apps').eq('id', rid).single()
  const plan = PLAN_LIMITS[rest?.subscription_plan] || PLAN_LIMITS.starter
  // comp_apps — приложения, выданные супер-админом поверх тарифа
  const allowedApps = [...plan.apps, ...(rest?.comp_apps || [])]

  for (const v of rows) {
    for (const app of (v.apps || [])) {
      if (!allowedApps.includes(app)) return 'Приложение недоступно на вашем тарифе'
    }
  }

  const { data: staff } = await admin.from('staff').select('id, apps').eq('restaurant_id', rid).eq('is_active', true)
  // Rows being updated are not "new" grants — exclude them from the current count.
  const updatedIds = new Set((filters || []).filter((f: any) => f.col === 'id' && f.op === 'eq').map((f: any) => f.val))
  const withAccess = (staff || []).filter((s: any) => Array.isArray(s.apps) && s.apps.length > 0 && !updatedIds.has(s.id)).length
  const newGrants = rows.filter(v => Array.isArray(v?.apps) && v.apps.length > 0).length
  if (withAccess + newGrants > plan.maxStaff) return `Лимит тарифа: до ${plan.maxStaff} сотрудников с доступом`
  return null
}

async function resolveCaller(req: NextRequest): Promise<Caller | null> {
  const staff = verifyStaffToken(req.cookies.get(STAFF_COOKIE)?.value)

  // Владелец тестирует PIN-приложения в том же браузере → есть И staff-кука, И
  // Supabase-сессия. Раньше staff-кука побеждала и записи владельца резались
  // правами сотрудника (тихие 403 в настройках). Если есть Supabase-кука —
  // сначала пробуем владельца; у сотрудников её нет, для них ничего не меняется.
  const hasSbSession = req.cookies.getAll().some(c => c.name.startsWith('sb-') && c.name.includes('auth-token'))
  if (staff && !hasSbSession) return { rid: staff.rid, owner: staff.owner, apps: staff.apps || [] }

  // Owner via Supabase session
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => req.cookies.getAll(), setAll: () => {} } }
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return staff ? { rid: staff.rid, owner: staff.owner, apps: staff.apps || [] } : null
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data } = await admin.from('restaurants').select('id').eq('owner_id', user.id).single()
  if (!data?.id) return staff ? { rid: staff.rid, owner: staff.owner, apps: staff.apps || [] } : null
  return { rid: data.id, owner: true, apps: ['manager', 'analytics', 'stash'] }
}

function authorized(caller: Caller, allowed: AppId[]): boolean {
  if (caller.owner) return true
  return allowed.some(a => caller.apps.includes(a))
}

export async function POST(req: NextRequest) {
  const caller = await resolveCaller(req)
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }) }

  const { table, op, columns, values, filters, order, limit, returning, onConflict } = body || {}
  const policy = POLICY[table]
  if (!policy) return NextResponse.json({ error: 'Unknown table' }, { status: 400 })

  const isWrite = op === 'insert' || op === 'update' || op === 'delete' || op === 'upsert'
  if (!authorized(caller, isWrite ? policy.write : policy.read)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const scope = policy.scope || 'restaurant_id'
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  if (table === 'staff' && (op === 'insert' || op === 'update' || op === 'upsert')) {
    const limitErr = await checkStaffPlanLimit(admin, caller.rid, values, filters)
    if (limitErr) return NextResponse.json({ error: limitErr, code: 'plan_limit' }, { status: 403 })
  }

  const applyFilters = (q: any) => {
    for (const f of (filters || [])) {
      if (!FILTER_OPS.has(f.op)) continue
      q = q[f.op](f.col, f.val)
    }
    return q
  }
  const forceScope = (vals: any) => Array.isArray(vals)
    ? vals.map(v => ({ ...v, [scope]: caller.rid }))
    : { ...vals, [scope]: caller.rid }

  try {
    let q: any
    if (op === 'select') {
      q = admin.from(table).select(columns || '*').eq(scope, caller.rid)
      q = applyFilters(q)
      for (const o of (order || [])) q = q.order(o.col, { ascending: o.ascending !== false })
      if (limit) q = q.limit(limit)
      if (returning === 'single') q = q.single()
      else if (returning === 'maybeSingle') q = q.maybeSingle()
    } else if (op === 'insert') {
      q = admin.from(table).insert(forceScope(values))
      if (returning) q = q.select()
      if (returning === 'single') q = q.single()
    } else if (op === 'upsert') {
      q = admin.from(table).upsert(forceScope(values), onConflict ? { onConflict } : undefined)
      if (returning) q = q.select()
      if (returning === 'single') q = q.single()
    } else if (op === 'update') {
      q = admin.from(table).update(values).eq(scope, caller.rid)
      q = applyFilters(q)
      if (returning) q = q.select()
      if (returning === 'single') q = q.single()
    } else if (op === 'delete') {
      q = admin.from(table).delete().eq(scope, caller.rid)
      q = applyFilters(q)
    } else {
      return NextResponse.json({ error: 'Unknown op' }, { status: 400 })
    }

    const { data, error } = await q
    if (error) return NextResponse.json({ error: error.message, code: (error as any).code }, { status: 400 })
    return NextResponse.json({ data })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Server error' }, { status: 500 })
  }
}
