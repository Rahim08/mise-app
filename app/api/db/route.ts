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
import { createClient } from '@supabase/supabase-js'
import { resolveCaller, type Caller } from '@/lib/apiAuth'
import { entitlements } from '@/lib/plans'

type AppId = 'manager' | 'analytics' | 'stash' | 'people'

// Per-table policy. `read`/`write` list the apps allowed (owner is always allowed).
// Empty array = owner only. `scope` is the column used to restrict rows to the restaurant.
const POLICY: Record<string, { read: AppId[]; write: AppId[]; scope?: string }> = {
  restaurants:          { read: ['manager', 'analytics', 'stash', 'people'], write: [], scope: 'id' },
  restaurant_settings:  { read: ['manager', 'analytics', 'people', 'stash'], write: [] },
  staff:                { read: [], write: [] },
  employees:            { read: ['manager', 'analytics', 'people'], write: [] }, // people: свой расчёт зарплаты
  expense_categories:   { read: ['manager', 'analytics'], write: [] },
  shifts:               { read: ['manager', 'analytics', 'people'], write: ['manager'] }, // people: чек-лист привязан к открытой смене
  shift_expenses:       { read: ['manager', 'analytics'], write: ['manager'] },
  shift_absences:       { read: ['manager', 'analytics', 'people'], write: ['manager'] },
  inkassations:         { read: ['manager', 'analytics'], write: ['manager', 'analytics'] },
  transactions:         { read: ['manager', 'analytics'], write: ['manager'] },
  monthly_card_amounts: { read: ['analytics', 'people'], write: ['analytics'] }, // помесячная сумма на карту правится в Analytics
  salary_advances:      { read: ['analytics', 'people'], write: ['analytics'] }, // авансы по зарплате
  salary_records:       { read: ['analytics'], write: [] },
  tobacco_stock:        { read: ['stash', 'analytics'], write: ['stash'] }, // analytics: остаток склада на вкладке Кальян
  tobacco_movements:    { read: ['stash', 'analytics'], write: ['stash'] },
  hookah_sales:         { read: ['stash', 'analytics'], write: ['stash'] }, // смена кальянщика
  hookah_types:         { read: ['stash', 'analytics'], write: [] },        // виды кальянов — правит владелец
  hookah_goals:         { read: ['stash', 'analytics'], write: ['analytics'] }, // KPI-цели по кальянам; постановку гейтит UI на должностных лиц
  tobacco_flavors:      { read: ['stash'], write: ['stash'] },
  tobacco_inventories:  { read: ['stash'], write: ['stash'] },
  menus:                { read: ['people'], write: [] }, // multi-menu; owner always, people reads menu
  menu_settings:        { read: ['people'], write: [] },
  menu_categories:      { read: ['people'], write: [] },
  menu_items:           { read: ['people'], write: ['people'] }, // People stop-list toggles is_available
  menu_orders:          { read: ['manager', 'people'], write: ['people'] }, // orders inbox updates status
  menu_events:          { read: [], write: [] }, // owner-only analytics read; writes via anon /api/menu/event
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
  notification_prefs:          { read: ['manager', 'analytics', 'stash', 'people'], write: ['manager', 'analytics', 'stash', 'people'] },
  purchase_items:              { read: ['people'], write: ['people'] },
  // safe read-only directory of teammates (no pin_hash)
  staff_directory:             { read: ['manager', 'analytics', 'stash', 'people'], write: [] },
  // CRM-бронирование: любой сотрудник видит/создаёт; «только автор/должностные лица
  // редактируют» форсится в UI (строковая логика). Доступ — любой модуль.
  bookings:                    { read: ['manager', 'analytics', 'stash', 'people'], write: ['manager', 'analytics', 'stash', 'people'] },
  // Лента новостей: читают все; публикацию гейтит UI на должностных лиц (owner/manager).
  news_posts:                  { read: ['manager', 'analytics', 'stash', 'people'], write: ['manager', 'analytics', 'stash', 'people'] },
  // Заметки о гостях (CRM-бронирование): доступ — любой модуль.
  guest_notes:                 { read: ['manager', 'analytics', 'stash', 'people'], write: ['manager', 'analytics', 'stash', 'people'] },
  // Google-отзывы (вкладка внутри Bookings): пишет только сервер (cron/sync-now
  // через service-role напрямую, не через этот шлюз) — клиент только читает.
  google_reviews:              { read: ['manager', 'analytics', 'stash', 'people'], write: [] },
  google_rating_snapshots:     { read: ['manager', 'analytics', 'stash', 'people'], write: [] },
}

const FILTER_OPS = new Set(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'is', 'like', 'ilike'])

// Granting app access on `staff` is the billable action: «место» = сотрудник с доступом.
// Лимиты и состав модулей считает entitlements() из lib/plans.ts (тариф + addon_modules +
// extra_seats + comp_apps/staff_limit супер-админа). Enforced server-side so the UI gate
// can't be bypassed by calling the gateway directly.
async function checkStaffPlanLimit(admin: any, rid: string, op: string, values: any, filters: any[]): Promise<string | null> {
  const rows = Array.isArray(values) ? values : [values]
  const grantsApps = rows.some(v => Array.isArray(v?.apps) && v.apps.length > 0)
  if (!grantsApps) return null

  // select('*'): явный список новых колонок дал бы 400 на БД без миграции billing-v2 —
  // а это горячий путь прода (iOS). entitlements() терпит отсутствующие поля.
  const { data: rest } = await admin.from('restaurants').select('*').eq('id', rid).single()
  const ent = entitlements(rest)
  const allowedApps: string[] = ent.modules
  const maxStaff: number = ent.seats

  for (const v of rows) {
    for (const app of (v.apps || [])) {
      if (!allowedApps.includes(app)) return 'Приложение недоступно на вашем тарифе'
    }
  }

  const { data: staff } = await admin.from('staff').select('id, apps').eq('restaurant_id', rid).eq('is_active', true)
  // Rows being updated are not "new" grants — exclude them from the current count.
  // Update может прийти с любым фильтром (не только id eq) — считаем реально затронутые
  // строки тем же фильтром, иначе они задваиваются (аудит-находка 30).
  const updatedIds = new Set<string>()
  if (op === 'update') {
    let q = admin.from('staff').select('id').eq('restaurant_id', rid)
    for (const f of (filters || [])) {
      if (FILTER_OPS.has(f.op) && typeof q[f.op] === 'function') q = q[f.op](f.col, f.val)
    }
    const { data: affected } = await q
    ;(affected || []).forEach((s: any) => updatedIds.add(s.id))
  }
  const withAccess = (staff || []).filter((s: any) => Array.isArray(s.apps) && s.apps.length > 0 && !updatedIds.has(s.id)).length
  const newGrants = rows.filter(v => Array.isArray(v?.apps) && v.apps.length > 0).length
  if (withAccess + newGrants > maxStaff) return `Лимит тарифа: до ${maxStaff} сотрудников с доступом`
  return null
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
  // Узкое исключение: менеджер (people-доступ) может менять порог опоздания в «Дисциплине»,
  // не открывая write на всю restaurant_settings (там гео/деньги — owner-only).
  const graceOnlyUpdate = table === 'restaurant_settings' && op === 'update'
    && values && typeof values === 'object' && !Array.isArray(values)
    && Object.keys(values).length > 0 && Object.keys(values).every(k => k === 'late_grace_min')
    && authorized(caller, ['people'])
  if (!graceOnlyUpdate && !authorized(caller, isWrite ? policy.write : policy.read)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const scope = policy.scope || 'restaurant_id'
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  if (table === 'staff' && (op === 'insert' || op === 'update' || op === 'upsert')) {
    const limitErr = await checkStaffPlanLimit(admin, caller.rid, op, values, filters)
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
      // Скоуп-колонку менять нельзя: иначе update может «перекинуть» строку в чужой ресторан.
      let safeValues = values
      if (safeValues && typeof safeValues === 'object' && !Array.isArray(safeValues)) {
        safeValues = { ...safeValues }
        delete safeValues[scope]
      }
      q = admin.from(table).update(safeValues).eq(scope, caller.rid)
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
