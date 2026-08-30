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
import { resolveCaller, isOfficial, type Caller } from '@/lib/apiAuth'
import { entitlements, isActiveStatus } from '@/lib/plans'
import { checkRateLimit, rateLimitKey } from '@/lib/rateLimit'

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
  salary_payments:      { read: ['analytics', 'people'], write: ['people'] }, // факт выдачи ЗП — отмечается в People→Зарплата
  tobacco_stock:        { read: ['stash', 'analytics'], write: ['stash'] }, // analytics: остаток склада на вкладке Кальян
  tobacco_movements:    { read: ['stash', 'analytics'], write: ['stash'] },
  hookah_sales:         { read: ['stash', 'analytics'], write: ['stash'] }, // смена кальянщика
  hookah_types:         { read: ['stash', 'analytics'], write: [] },        // виды кальянов — правит владелец
  hookah_goals:         { read: ['stash', 'analytics'], write: ['stash', 'analytics'] }, // KPI-цели по кальянам; постановку гейтит UI на должностных лиц. StashModel.saveGoal/deleteGoal зовутся из Stash (ShiftTab) — без 'stash' здесь сотрудник с доступом только к Stash получал молчаливый 403 (try? глотал ошибку)
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
  // Банк (Open Banking, GoCardless) — баланс/лента операций во вкладке «Банк» в
  // Analytics. Пишет только сервер (app/api/bank/*, cron/bank-sync через service-role),
  // клиент только читает — та же логика, что у google_reviews выше.
  bank_connections:            { read: ['manager', 'analytics'], write: [] },
  bank_transactions:           { read: ['manager', 'analytics'], write: [] },
}

// RPC allowlist — same per-app authorization model as POLICY, for atomic SQL functions a
// client can't express as a plain insert/update (e.g. `quantity_g = quantity_g + delta`,
// which a read-then-write from the client can't do atomically). `restaurantArg` is the
// name of the scoping parameter in the SQL function signature — always overwritten with
// caller.rid below, never trusted from client-supplied args (audit MISE-006, 2026-08-28).
const RPC_POLICY: Record<string, { write: AppId[]; restaurantArg: string }> = {
  increment_tobacco_stock: { write: ['stash'], restaurantArg: 'p_restaurant_id' },
  settle_debts: { write: ['manager'], restaurantArg: 'p_restaurant_id' },
}

const FILTER_OPS = new Set(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'is', 'like', 'ilike'])

// Generic backstop against a runaway client (retry loop with no backoff, scripted staff
// session) — this is the busiest endpoint in the app, so the ceiling is deliberately
// generous and shouldn't affect any normal usage pattern.
const DB_GATEWAY_RATE_LIMIT = 300
const DB_GATEWAY_RATE_WINDOW_MS = 60_000

// Postgres error codes safe to name specifically; anything else collapses to a generic
// message so table/column/constraint names and value details don't reach the client
// (audit 2026-08-15, block-G #2). Full error is always logged server-side below.
const PG_ERROR_MESSAGES: Record<string, string> = {
  '23505': 'Duplicate entry',
  '23503': 'Referenced record not found',
  '23502': 'Missing required field',
  '22P02': 'Invalid input',
}
function clientSafeError(error: any): string {
  const code = error?.code
  return (code && PG_ERROR_MESSAGES[code]) || 'Internal error'
}

// Только Stripe webhook / /api/admin (сервис-роль напрямую, минуя этот шлюз) вправе менять
// биллинг. Иначе owner из консоли браузера: db.from('restaurants').update({subscription_plan:
// 'pro', staff_limit:999, addon_modules:[...]}) — entitlements() читает ровно эти поля,
// бессрочный Pro без Stripe (аудит 2026-08-05, раздел 3, приоритет 6).
const BILLING_ONLY_COLUMNS = new Set([
  'subscription_plan', 'subscription_status', 'subscription_id', 'subscription_ends_at',
  'staff_limit', 'addon_modules', 'extra_seats', 'addon_ai', 'ai_enabled', 'billing_interval',
  'discount_pct', 'comp_apps', 'stripe_customer_id',
])

// Plain column list only — no PostgREST embedding syntax (`(`, `!`, `:`, `.`), which lets a
// client select through a foreign key into an owner-only table (e.g. staff.pin_hash via a
// shifts→staff FK) even though POLICY only checks the root table.
const SAFE_COLUMNS_RE = /^[a-zA-Z0-9_,\s*]+$/
function safeColumns(columns: unknown): string {
  if (typeof columns !== 'string' || !columns.trim()) return '*'
  return SAFE_COLUMNS_RE.test(columns) ? columns : '*'
}

// Columns readable by owner only, even when the table itself is open to staff apps for
// other columns. Stripped from the response post-fetch — robust regardless of what the
// client asked for (including '*').
const OWNER_ONLY_COLUMNS: Record<string, string[]> = {
  restaurants: ['owner_pin', 'stripe_customer_id', 'subscription_id'],
  restaurant_settings: ['google_places_api_key'],
}
function stripOwnerOnlyColumns(table: string, data: any, caller: Caller): any {
  if (caller.owner) return data
  const secret = OWNER_ONLY_COLUMNS[table]
  if (!secret || !data) return data
  const strip = (row: any) => {
    if (!row || typeof row !== 'object') return row
    const copy = { ...row }
    for (const k of secret) delete copy[k]
    return copy
  }
  return Array.isArray(data) ? data.map(strip) : strip(data)
}

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

  const rlKey = rateLimitKey(req, `db:${caller.rid}:${caller.sid || 'owner'}`)
  if (!await checkRateLimit(rlKey, DB_GATEWAY_RATE_LIMIT, DB_GATEWAY_RATE_WINDOW_MS)) {
    return NextResponse.json({ error: 'Rate limit' }, { status: 429 })
  }

  // Ни PIN-логин, ни этот шлюз раньше не сверялись с subscription_status: после
  // canceled/past_due сотрудники работали бессрочно (аудит 2026-08-05, раздел 3).
  // Owner исключён — иначе не смог бы дойти до /dashboard/billing чтобы починить оплату.
  if (!caller.owner) {
    const admin0 = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
    const { data: rest0 } = await admin0.from('restaurants').select('subscription_status').eq('id', caller.rid).single()
    if (!isActiveStatus(rest0?.subscription_status)) {
      return NextResponse.json({ error: 'Subscription inactive', code: 'subscription_inactive' }, { status: 403 })
    }
  }

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }) }

  const { table, op, columns, values, filters, order, limit, returning, onConflict, fn, args } = body || {}

  if (op === 'rpc') {
    const rpcPolicy = RPC_POLICY[fn]
    if (!rpcPolicy) return NextResponse.json({ error: 'Unknown function' }, { status: 400 })
    if (!authorized(caller, rpcPolicy.write)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    // settle_debts может писать salary_payments (POLICY выше ограничивает эту таблицу
    // 'people'-приложением, не 'manager') — сохраняем ту же границу здесь: менеджер без
    // доступа к People не должен получить возможность создавать записи о выплате ЗП через
    // этот RPC только потому, что он умеет settle_debts для обычных expense-долгов.
    if (fn === 'settle_debts') {
      const debts = Array.isArray((args as any)?.p_debts) ? (args as any).p_debts : []
      const hasSalary = debts.some((d: any) => d && d.is_salary)
      if (hasSalary && !authorized(caller, ['people'])) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
    }
    const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
    const safeArgs = { ...(args && typeof args === 'object' ? args : {}), [rpcPolicy.restaurantArg]: caller.rid }
    const { data, error } = await admin.rpc(fn, safeArgs)
    if (error) {
      console.error(`[api/db] rpc ${fn} failed:`, error)
      return NextResponse.json({ error: clientSafeError(error), code: (error as any).code }, { status: 400 })
    }
    return NextResponse.json({ data })
  }

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
  if (table === 'restaurants' && isWrite) {
    const rows = Array.isArray(values) ? values : [values]
    if (rows.some(v => v && typeof v === 'object' && Object.keys(v).some(k => BILLING_ONLY_COLUMNS.has(k)))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  const scope = policy.scope || 'restaurant_id'
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  if (table === 'staff' && (op === 'insert' || op === 'update' || op === 'upsert')) {
    const limitErr = await checkStaffPlanLimit(admin, caller.rid, op, values, filters)
    if (limitErr) return NextResponse.json({ error: limitErr, code: 'plan_limit' }, { status: 403 })
  }

  // news_posts write открыт всему people/manager/analytics/stash в POLICY (любой сотрудник
  // может дёрнуть шлюз напрямую) — публикация «от всего заведения» и удаление чужих постов
  // ограничены только UI, поэтому проверяются здесь дополнительно (аудит 2026-08-05, №5).
  if (table === 'news_posts' && isWrite && !(await isOfficial(admin, caller))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
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

  // Deactivating a staff row previously left their push_subscriptions live — they kept
  // receiving cash-amount pushes until the device token itself went stale, since
  // unsubscribe only ever ran from the staff member's own logout() (audit 2026-08-15,
  // block-G #3). Capture the affected staff ids before the update so we can prune after.
  let staffDeactivatedIds: string[] = []
  if (table === 'staff' && op === 'update' && values && typeof values === 'object'
    && !Array.isArray(values) && values.is_active === false) {
    let sq = admin.from('staff').select('id').eq(scope, caller.rid)
    for (const f of (filters || [])) {
      if (FILTER_OPS.has(f.op) && typeof sq[f.op] === 'function') sq = sq[f.op](f.col, f.val)
    }
    const { data: rows } = await sq
    staffDeactivatedIds = (rows || []).map((r: any) => r.id)
  }

  try {
    let q: any
    if (op === 'select') {
      q = admin.from(table).select(safeColumns(columns)).eq(scope, caller.rid)
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
      // Без фильтра .eq(scope, rid) — единственное условие, значит update бьёт по ВСЕМ
      // строкам ресторана в один запрос. Единственная легитимная безфильтровая запись —
      // restaurant_settings (одна строка на ресторан, tabs-shifts.tsx saveGrace); везде
      // ещё явный фильтр требуется (аудит 2026-08-05, п.8 сводного приоритета).
      if (!(filters || []).length && table !== 'restaurant_settings') {
        return NextResponse.json({ error: 'Filter required for update' }, { status: 400 })
      }
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
      // Тот же риск, ещё необратимее: {table:'shifts',op:'delete'} без фильтра стирает
      // всю историю смен ресторана одним запросом.
      if (!(filters || []).length) {
        return NextResponse.json({ error: 'Filter required for delete' }, { status: 400 })
      }
      q = admin.from(table).delete().eq(scope, caller.rid)
      q = applyFilters(q)
    } else {
      return NextResponse.json({ error: 'Unknown op' }, { status: 400 })
    }

    const { data, error } = await q
    if (error) {
      console.error(`[api/db] ${table}.${op} failed:`, error)
      return NextResponse.json({ error: clientSafeError(error), code: (error as any).code }, { status: 400 })
    }
    if (staffDeactivatedIds.length) {
      await admin.from('push_subscriptions').delete().in('staff_id', staffDeactivatedIds)
    }
    return NextResponse.json({ data: stripOwnerOnlyColumns(table, data, caller) })
  } catch (err: any) {
    console.error(`[api/db] ${table}.${op} threw:`, err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
