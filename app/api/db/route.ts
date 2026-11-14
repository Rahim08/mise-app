// Authenticated data gateway.
//
// Replaces direct anon-key Supabase access from the browser. Every request is bound to a
// restaurant via the verified staff token (PIN session) or the owner's Supabase session.
// The server forces restaurant scoping and per-app authorization, then runs the query with
// the service-role key. With this in place, RLS can deny anon entirely (see docs/security/rls.sql).
//
// NOTE: the public guest menu (read published menu + create order) is intentionally NOT routed
// here — it stays anon and is guarded by narrow public RLS policies.

import { NextRequest, NextResponse, after } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { normalizeExpenseName, customExpenseWriteError } from '@/lib/customExpenses'
import { BookingPolicyError, BOOKING_APPS, UUID_RE, GUEST_KEY_RE, validBookingDate, validateBookingValues, validateGuestProfile, requireBookingAccess, requireGuestAuthor, bookingAuthor, sameBookingCreate } from '@/lib/bookingPolicy'
import { resolveCaller, isOfficial, type Caller } from '@/lib/apiAuth'
import { entitlements, isActiveStatus } from '@/lib/plans'
import { checkRateLimit, rateLimitKey } from '@/lib/rateLimit'
import { AUDITED_TABLES, auditWrite, auditRpc } from '@/lib/financialAudit'
import { applyPeoplePolicy, peopleContext, isSalaryDebtRead, PeoplePolicyError, SALARY_TABLES } from '@/lib/peoplePolicy'

type AppId = 'manager' | 'analytics' | 'stash' | 'people'

// Per-table policy. `read`/`write` list the apps allowed (owner is always allowed).
// Empty array = owner only. `scope` is the column used to restrict rows to the restaurant.
const POLICY: Record<string, { read: AppId[]; write: AppId[]; scope?: string }> = {
  restaurants:          { read: ['manager', 'analytics', 'stash', 'people'], write: [], scope: 'id' },
  restaurant_settings:  { read: ['manager', 'analytics', 'people', 'stash'], write: [] },
  staff:                { read: [], write: [] },
  employees:            { read: ['manager', 'analytics', 'people'], write: [] }, // people: свой расчёт зарплаты
  salary_history:       { read: ['manager', 'analytics', 'people'], write: [] }, // снэпшоты оклада по месяцам; пишет только dashboard (owner), как и employees
  expense_categories:   { read: ['manager', 'analytics'], write: [] },
  shifts:               { read: ['manager', 'analytics', 'people'], write: ['manager'] }, // people: чек-лист привязан к открытой смене
  shift_expenses:       { read: ['manager', 'analytics'], write: ['manager'] },
  shift_absences:       { read: ['manager', 'analytics', 'people'], write: ['manager'] },
  inkassations:         { read: ['manager', 'analytics'], write: ['manager', 'analytics'] },
  inkassation_topups:   { read: ['manager', 'analytics'], write: ['manager'] }, // поступления в баланс инкассации (не касса); правит только Manager
  // VIEW (docs/migrations/inkassation-balance-view-2026-09-23.sql): готовый агрегат вместо
  // перекачки всей истории shifts+inkassations+topups на клиент ради одной цифры. Read-only.
  inkassation_balance:  { read: ['manager', 'analytics'], write: [] },
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
  // Booking reads/creates are available to any granted module. Mutations below
  // enforce author-or-official access independently of client controls.
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
  booking_guest_update: { write: [...BOOKING_APPS], restaurantArg: 'p_restaurant_id' },
  booking_guest_delete: { write: [...BOOKING_APPS], restaurantArg: 'p_restaurant_id' },
  booking_history_page: { write: [...BOOKING_APPS], restaurantArg: 'p_restaurant_id' },
  // Read-only history; the gateway still enforces module access and its own tenant.
  shift_expense_name_suggestions: { write: ['manager', 'analytics'], restaurantArg: 'p_restaurant_id' },
  increment_tobacco_stock: { write: ['stash'], restaurantArg: 'p_restaurant_id' },
  settle_debts: { write: ['manager'], restaurantArg: 'p_restaurant_id' },
}

const FILTER_OPS = new Set(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'is', 'like', 'ilike'])
function validBookingFilter(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const filter = value as Record<string, unknown>
  return typeof filter.op === 'string' && FILTER_OPS.has(filter.op)
    && typeof filter.col === 'string' && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(filter.col)
}

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
  // gemini_api_key: колонка в проде ещё есть (cleanup-dead-columns не применён) — select '*'
  // отдавал ключ любому сотруднику со stash/people/manager/analytics (аудит 2026-10-26).
  restaurant_settings: ['google_places_api_key', 'gemini_api_key'],
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

const PEOPLE_GUARDED = new Set(['menu_items', 'menu_orders', 'staff_schedules', 'shift_checklists', 'tech_cards',
  'attendance_records', 'staff_tasks', 'staff_reports', 'shift_swap_requests', 'tech_card_sessions', 'purchase_items'])

function authorized(caller: Caller, allowed: AppId[]): boolean {
  if (caller.owner) return true
  return allowed.some(a => caller.apps.includes(a))
}

export async function POST(req: NextRequest) {
  const caller = await resolveCaller(req)
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Лимит запросов и проверка подписки независимы — параллельно, а не двумя round-trip'ами
  // подряд (аудит скорости 2026-10-26: каждый вызов шлюза делал 3–4 последовательных запроса
  // к БД перед основным).
  const rlKey = rateLimitKey(req, `db:${caller.rid}:${caller.sid || 'owner'}`)
  const [rlOk, subStatus] = await Promise.all([
    checkRateLimit(rlKey, DB_GATEWAY_RATE_LIMIT, DB_GATEWAY_RATE_WINDOW_MS),
    // Ни PIN-логин, ни этот шлюз раньше не сверялись с subscription_status: после
    // canceled/past_due сотрудники работали бессрочно (аудит 2026-08-05, раздел 3).
    // Owner исключён — иначе не смог бы дойти до /dashboard/billing чтобы починить оплату.
    caller.owner ? Promise.resolve(null) : createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
      .from('restaurants').select('subscription_status').eq('id', caller.rid).single()
      .then(({ data }) => data?.subscription_status),
  ])
  if (!rlOk) {
    return NextResponse.json({ error: 'Rate limit' }, { status: 429 })
  }
  if (!caller.owner && !isActiveStatus(subStatus)) {
    return NextResponse.json({ error: 'Subscription inactive', code: 'subscription_inactive' }, { status: 403 })
  }

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }) }

  const { table, op, columns, values: rawValues, filters: rawFilters, order, limit, returning, onConflict, fn, args } = body || {}
  let values = rawValues
  let filters = rawFilters

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
    const isExpenseHistory = fn === 'shift_expense_name_suggestions'
    if (isExpenseHistory && (args?.p_prefix != null && (typeof args.p_prefix !== 'string' || args.p_prefix.length > 120))) {
      return NextResponse.json({ error: 'Invalid expense prefix' }, { status: 400 })
    }
    let bookingArgs: Record<string, unknown> | undefined
    if (typeof fn === 'string' && fn.startsWith('booking_')) {
      try {
        await requireBookingAccess(admin, caller)
        const bookingInput = args ?? {}
        if (typeof bookingInput !== 'object' || Array.isArray(bookingInput)) throw new BookingPolicyError('Invalid booking arguments')
        if (fn === 'booking_history_page') {
          const date = bookingInput.p_after_date ?? null, id = bookingInput.p_after_id ?? null, count = bookingInput.p_limit ?? 500
          if ((date === null) !== (id === null) || (date !== null && (!validBookingDate(date) || typeof id !== 'string' || !UUID_RE.test(id))) || !Number.isInteger(count) || count < 1 || count > 500) throw new BookingPolicyError('Invalid history cursor')
          bookingArgs = { p_after_date: date, p_after_id: id, p_limit: count }
        } else {
          const key = bookingInput.p_guest_key
          if (typeof key !== 'string' || !GUEST_KEY_RE.test(key)) throw new BookingPolicyError('Invalid guest identity')
          await requireGuestAuthor(admin, caller, key.toLowerCase())
          bookingArgs = { p_guest_key: key.toLowerCase(), p_actor_id: bookingAuthor(caller) ?? null, p_official: await isOfficial(admin,caller) }
          if (fn === 'booking_guest_update') {
            for (const [argument, maximum] of [['p_name', 200], ['p_phone', 80]] as const) {
              const value = bookingInput[argument]
              if (value != null && (typeof value !== 'string' || value.length > maximum)) throw new BookingPolicyError('Invalid guest contact')
              bookingArgs[argument] = value == null ? null : value.trim()
            }
            bookingArgs.p_profile = bookingInput.p_profile == null ? {} : validateGuestProfile(bookingInput.p_profile)
          }
        }
      } catch (error) {
        if (error instanceof BookingPolicyError) return NextResponse.json({ error: error.message }, { status: error.status })
        return NextResponse.json({ error: 'Booking access could not be verified' }, { status: 503 })
      }
    }
    const rpcArgs = bookingArgs ?? (isExpenseHistory ? { p_prefix: normalizeExpenseName(args?.p_prefix ?? '') } : (args && typeof args === 'object' ? args : {}))
    const safeArgs = { ...rpcArgs, [rpcPolicy.restaurantArg]: caller.rid }
    const { data, error } = await admin.rpc(fn, safeArgs)
    if (error) {
      console.error(`[api/db] rpc ${fn} failed:`, error)
      return NextResponse.json({ error: clientSafeError(error), code: (error as any).code }, { status: 400 })
    }
    // Off the critical path (Next.js `after`): the actor lookup + audit insert added 1-2
    // sequential Supabase round-trips to every settle_debts call, felt as sluggish buttons.
    // Logging must never delay the response the client is waiting on.
    if (fn === 'settle_debts') after(() => auditRpc(admin, caller, fn, safeArgs))
    return NextResponse.json({ data })
  }

  const policy = POLICY[table]
  if (!policy) return NextResponse.json({ error: 'Unknown table' }, { status: 400 })

  const isWrite = op === 'insert' || op === 'update' || op === 'delete' || op === 'upsert'
  if (table === 'shift_expenses' && (op === 'insert' || op === 'upsert') && customExpenseWriteError(values)) {
    return NextResponse.json({ error: 'Invalid custom expense' }, { status: 400 })
  }
  // Узкое исключение: менеджер (people-доступ) может менять порог опоздания в «Дисциплине»,
  // не открывая write на всю restaurant_settings (там гео/деньги — owner-only).
  const graceOnlyUpdate = table === 'restaurant_settings' && op === 'update'
    && values && typeof values === 'object' && !Array.isArray(values)
    && Object.keys(values).length > 0 && Object.keys(values).every(k => k === 'late_grace_min')
    && authorized(caller, ['people'])
  // Личный расчёт ЗП в People читает свой открытый ЗП-долг (SALPERIOD) — сам shift_expenses
  // людям без Manager/Analytics закрыт; peoplePolicy ниже сужает выборку до своей строки.
  const salaryDebtRead = isSalaryDebtRead(table, op, filters) && authorized(caller, ['people'])
  if (!graceOnlyUpdate && !salaryDebtRead && !authorized(caller, isWrite ? policy.write : policy.read)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (table === 'restaurants' && isWrite) {
    const rows = Array.isArray(values) ? values : [values]
    if (rows.some(v => v && typeof v === 'object' && Object.keys(v).some(k => BILLING_ONLY_COLUMNS.has(k)))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  // Подписки на пуши и журнал уведомлений — только свои строки (аудит безопасности
  // 2026-10-26): scope навязывал лишь restaurant_id, а staff_id/to_owner присылал клиент —
  // сотрудник с People мог перепривязать подписку менеджера на себя (получать его пуши о
  // кассе/ЗП) и читать чужой журнал. Клиенты (Push.swift, AppModel, people/tabs-salary)
  // и так работают только со своими строками. Владелец — без ограничений.
  // notification_prefs — то же: иначе сотрудник мог выключить уведомления менеджеру.
  if ((table === 'push_subscriptions' || table === 'notifications' || table === 'notification_prefs') && !caller.owner) {
    if (!caller.sid) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (table === 'notifications' && (op === 'insert' || op === 'upsert')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    filters = [...(Array.isArray(filters) ? filters : []), { op: 'eq', col: 'staff_id', val: caller.sid }]
    if (values && typeof values === 'object') {
      const own = (v: any) => ({ ...v, staff_id: caller.sid, to_owner: false })
      values = Array.isArray(values) ? values.map(own) : own(values)
    }
  }

  const scope = policy.scope || 'restaurant_id'
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  // Серверные границы People (аудит 2026-11-14): чужие зарплаты, чужие записи, цены меню.
  if (!caller.owner && (PEOPLE_GUARDED.has(table) || SALARY_TABLES[table] || salaryDebtRead)) {
    try {
      const r = await applyPeoplePolicy(admin, caller, peopleContext(admin, caller), {
        table, op, values, filters: Array.isArray(filters) ? filters : [],
      })
      if (r.empty) return NextResponse.json({ data: returning === 'single' || returning === 'maybeSingle' ? null : [] })
      values = r.values; filters = r.filters
    } catch (error) {
      if (error instanceof PeoplePolicyError) return NextResponse.json({ error: error.message }, { status: error.status })
      console.error('[api/db] people policy failed', error)
      return NextResponse.json({ error: 'Access could not be verified' }, { status: 503 })
    }
  }

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

  // Booking ownership is a server boundary. The service-role query bypasses RLS,
  // so both the authorization probe and the eventual write retain tenant/author filters.
  if (['bookings', 'guest_notes', 'google_reviews', 'google_rating_snapshots'].includes(table)) {
    try {
      await requireBookingAccess(admin, caller)
      if (isWrite && (!Array.isArray(filters) && filters != null)) throw new BookingPolicyError('Invalid filters')
      if (table === 'bookings' && isWrite) {
        if (op === 'upsert') throw new BookingPolicyError('Use a stable-ID booking insert')
        if (op === 'insert') {
          const desired = validateBookingValues(values, true)
          desired.restaurant_id = caller.rid
          desired.created_by = bookingAuthor(caller)
          desired.created_by_name = caller.name || (caller.owner ? 'Owner' : 'Staff')
          const existing = async () => {
            const result = await admin.from('bookings').select('*').eq('restaurant_id',caller.rid).eq('id',desired.id).maybeSingle()
            if (result.error) throw new BookingPolicyError('Booking retry could not be verified',503)
            return result.data
          }
          const prior = await existing()
          if (prior) {
            if (!sameBookingCreate(prior,desired)) throw new BookingPolicyError('Booking ID already has different content',409)
            return NextResponse.json({ data: returning === 'single' ? prior : [prior] })
          }
          const {data: inserted, error} = await admin.from('bookings').insert(desired).select('*').single()
          if (error) {
            if (error.code === '23505') {
              const raced = await existing()
              if (raced && sameBookingCreate(raced,desired)) return NextResponse.json({ data: returning === 'single' ? raced : [raced] })
              throw new BookingPolicyError('Booking ID already exists',409)
            }
            return NextResponse.json({ error: clientSafeError(error), code: error.code }, {status:400})
          }
          return NextResponse.json({ data: returning === 'single' ? inserted : [inserted] })
        }
        if (!(filters || []).length) throw new BookingPolicyError('Filter required for booking mutation')
        if ((filters || []).some((filter: unknown) => !validBookingFilter(filter))) throw new BookingPolicyError('Invalid booking filter')
        const official = await isOfficial(admin,caller)
        if (!official) {
          const author = bookingAuthor(caller)
          if (!author) throw new BookingPolicyError('Forbidden',403)
          const query = applyFilters(admin.from('bookings').select('id').eq('restaurant_id',caller.rid))
          const {data: unauthorized, error} = await query.or(`created_by.is.null,created_by.neq.${author}`).limit(1)
          if (error) throw new BookingPolicyError('Booking access could not be verified',503)
          if (unauthorized?.length) throw new BookingPolicyError('Forbidden',403)
          filters = [...filters, {col:'created_by',op:'eq',val:author}]
        }
        if (op === 'update') {
          const prepared = validateBookingValues(values,false)
          delete prepared.updated_at // SQL owns the write timestamp.
          const {data: targets,error: targetError} = await applyFilters(admin.from('bookings').select('id').eq('restaurant_id',caller.rid)).order('id').limit(101)
          if (targetError) throw new BookingPolicyError('Booking access could not be verified',503)
          if (!targets?.length) throw new BookingPolicyError('Booking not found or no longer editable',404)
          if (targets.length > 100) throw new BookingPolicyError('Too many bookings in one update')
          if (returning === 'single' && targets.length !== 1) throw new BookingPolicyError('A single booking is required')
          // Serialize contacts with keyless creates inside SQL, then recheck the
          // pinned rows' tenant/authorship under lock before changing any values.
          const {data: updated,error: updateError} = await admin.rpc('booking_rows_update',{
            p_restaurant_id:caller.rid, p_ids:targets.map((row: {id:string})=>row.id),
            p_values:prepared, p_actor_id:bookingAuthor(caller) ?? null, p_official:official,
          })
          if (updateError) {
            if (updateError.code === '23505') throw new BookingPolicyError('Phone is already assigned to another guest',409)
            if (updateError.code === '42501') throw new BookingPolicyError('Forbidden',403)
            if (updateError.code === 'P0002') throw new BookingPolicyError('Booking changed; refresh before editing',409)
            const status = ['22023','23514','22P02'].includes(updateError.code || '') ? 400 : 503
            throw new BookingPolicyError('Booking could not be saved',status)
          }
          if (!Array.isArray(updated) || updated.length !== targets.length) throw new BookingPolicyError('Saved booking could not be verified',503)
          return NextResponse.json({data:returning === 'single' ? updated[0] : updated})
        }
      }
      if (table === 'guest_notes' && isWrite) {
        if (op === 'insert' || op === 'upsert') {
          const rows = Array.isArray(values) ? values : [values]
          if (!rows.length || rows.length > 100) throw new BookingPolicyError('Invalid guest profiles')
          const prepared: Record<string, unknown>[] = []
          for (const row of rows) {
            if (!row || typeof row !== 'object' || typeof row.guest_key !== 'string') throw new BookingPolicyError('Invalid guest profile')
            await requireGuestAuthor(admin,caller,row.guest_key)
            const profile = { ...row }
            delete profile.guest_key; delete profile.restaurant_id; delete profile.updated_at
            prepared.push({ guest_key:row.guest_key, ...validateGuestProfile(profile), updated_at:new Date().toISOString() })
          }
          values = Array.isArray(values) ? prepared : prepared[0]
        } else {
          if (!(filters || []).length || (filters || []).some((filter: unknown)=>!validBookingFilter(filter))) throw new BookingPolicyError('Filter required for guest mutation')
          // A cap avoids silently checking only the first PostgREST response page.
          // Larger bulk profile changes belong in an explicit administrative workflow.
          const {data: notes,error} = await applyFilters(admin.from('guest_notes').select('guest_key').eq('restaurant_id',caller.rid)).limit(101)
          if (error) throw new BookingPolicyError('Guest access could not be verified',503)
          if ((notes || []).length > 100) throw new BookingPolicyError('Too many guest profiles in one mutation')
          for (const note of notes || []) await requireGuestAuthor(admin,caller,note.guest_key)
          // Do not let a concurrently inserted profile broaden the already-authorized set.
          filters = [...filters, {col:'guest_key',op:'in',val:(notes || []).map((note: {guest_key:string})=>note.guest_key)}]
          if (op === 'update') {
            const profile = { ...(values || {}) }
            delete profile.restaurant_id; delete profile.updated_at; delete profile.guest_key
            values = {...validateGuestProfile(profile),updated_at:new Date().toISOString()}
          }
        }
      }
    } catch (error) {
      if (error instanceof BookingPolicyError) return NextResponse.json({ error:error.message },{status:error.status})
      console.error('[api/db] booking authorization failed',error)
      return NextResponse.json({ error:'Booking access could not be verified' },{status:503})
    }
  }

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

  // Журнал финансов (lib/financialAudit.ts): для правок денежных таблиц запоминаем строки ДО
  // (update/delete) и берём строки ПОСЛЕ, чтобы записать «кто/когда/что изменил».
  const audited = isWrite && AUDITED_TABLES.has(table)
  let auditOldRows: any[] = []
  if (audited && (op === 'update' || op === 'delete')) {
    let pq: any = admin.from(table).select('*').eq(scope, caller.rid)
    pq = applyFilters(pq)
    const { data: pre } = await pq.limit(500)
    auditOldRows = pre || []
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
      if (returning || audited) q = q.select()
      if (returning === 'single') q = q.single()
    } else if (op === 'upsert') {
      // Конфликт только по ключу, включающему scope-колонку (аудит безопасности 2026-10-26):
      // без onConflict upsert конфликтует по PK id из запроса — строка ДРУГОГО ресторана с
      // этим id превращалась в UPDATE и переезжала в ресторан вызывающего (forceScope).
      // Все легитимные вызовы (guest_notes, attendance_records, staff_schedules,
      // push_subscriptions) и так шлют onConflict с restaurant_id.
      const conflictCols = typeof onConflict === 'string' ? onConflict.split(',').map(s => s.trim()) : []
      if (!conflictCols.includes(scope)) {
        return NextResponse.json({ error: 'onConflict must include ' + scope }, { status: 400 })
      }
      q = admin.from(table).upsert(forceScope(values), { onConflict })
      if (returning || audited) q = q.select()
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
      if (returning || audited || table === 'bookings') q = q.select()
      if (returning === 'single') q = q.single()
    } else if (op === 'delete') {
      // Тот же риск, ещё необратимее: {table:'shifts',op:'delete'} без фильтра стирает
      // всю историю смен ресторана одним запросом.
      if (!(filters || []).length) {
        return NextResponse.json({ error: 'Filter required for delete' }, { status: 400 })
      }
      q = admin.from(table).delete().eq(scope, caller.rid)
      q = applyFilters(q)
      if (table === 'bookings') q = q.select()
    } else {
      return NextResponse.json({ error: 'Unknown op' }, { status: 400 })
    }

    const { data, error } = await q
    if (error) {
      console.error(`[api/db] ${table}.${op} failed:`, error)
      return NextResponse.json({ error: clientSafeError(error), code: (error as any).code }, { status: 400 })
    }
    if (table === 'bookings' && isWrite && (!data || (Array.isArray(data) && !data.length))) {
      return NextResponse.json({ error:'Booking not found or no longer editable' },{status:404})
    }
    if (staffDeactivatedIds.length) {
      await admin.from('push_subscriptions').delete().in('staff_id', staffDeactivatedIds)
    }
    if (audited) {
      // Off the critical path (Next.js `after`): resolveActor (staff lookup) + the audit
      // insert added 2 sequential Supabase round-trips to every write on a money table —
      // felt as sluggish buttons/saves. The response below no longer waits on them; the
      // DB trigger (source='db') still logs synchronously either way, so nothing is lost
      // if this callback is ever cut short.
      const newRows = op === 'delete' ? [] : (Array.isArray(data) ? data : data ? [data] : [])
      after(() => auditWrite(admin, caller, { table, op, filters, oldRows: auditOldRows, newRows }))
    }
    // Без `returning` клиент раньше получал null — не меняем форму ответа из-за внутреннего .select() выше.
    const respData = audited && !returning ? null : data
    return NextResponse.json({ data: stripOwnerOnlyColumns(table, respData, caller) })
  } catch (err: any) {
    console.error(`[api/db] ${table}.${op} threw:`, err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
