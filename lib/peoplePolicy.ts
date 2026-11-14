// Серверные границы People-данных (аудит People 2026-11-14).
//
// POLICY в app/api/db/route.ts открывает People-таблицы целиком любому, у кого есть модуль
// 'people', а различие «сотрудник / должностное лицо» существовало только в UI. Прямой
// запрос к шлюзу позволял сотруднику читать оклады коллег, писать выплаты, править чужое
// расписание/явку/шаблоны, удалять чужие задачи и менять цены блюд через «стоп-лист».
// Здесь — те же правила, что показывает интерфейс, но на сервере.

import type { Caller } from '@/lib/apiAuth'
import { buildCheckIn, localDateKey, AttendanceError } from '@/lib/attendanceCheckIn'

type Admin = { from: (t: string) => any }
type Filter = { op: string; col: string; val: any }

export class PeoplePolicyError extends Error {
  constructor(message: string, public status = 403) { super(message) }
}

/** Ленивый контекст вызывающего: роль и связанный employees.id запрашиваются один раз. */
export function peopleContext(admin: Admin, caller: Caller) {
  let staffRow: Promise<{ role: string | null; employee_id: string | null; name: string } | null> | null = null
  const staff = () => staffRow ??= (async () => {
    if (caller.owner || !caller.sid) return null
    const { data, error } = await admin.from('staff').select('role, employee_id, name')
      .eq('id', caller.sid).eq('restaurant_id', caller.rid).maybeSingle()
    if (error) throw new PeoplePolicyError('Access could not be verified', 503)
    return data ? { role: data.role ?? null, employee_id: data.employee_id ?? null, name: data.name || '' } : null
  })()

  let empId: Promise<string | null> | null = null
  return {
    /** owner или staff.role manager/admin, либо доступ к модулю Manager. */
    async official(): Promise<boolean> {
      if (caller.owner) return true
      if (caller.apps.includes('manager')) return true
      const s = await staff()
      return s?.role === 'manager' || s?.role === 'admin'
    },
    async role(): Promise<string | null> { return (await staff())?.role ?? null },
    /** Видит зарплаты всех: owner, Manager/Analytics или должностное лицо. */
    async fullSalary(): Promise<boolean> {
      if (caller.owner || caller.apps.includes('manager') || caller.apps.includes('analytics')) return true
      return this.official()
    },
    /**
     * employees.id вызывающего: staff.employee_id, иначе — единственный активный сотрудник
     * с тем же именем (неоднозначность = нет доступа, а не «первый попавшийся»).
     */
    ownEmployeeId(): Promise<string | null> {
      return empId ??= (async () => {
        const s = await staff()
        if (!s) return null
        if (s.employee_id) return s.employee_id
        if (!s.name.trim()) return null
        const { data, error } = await admin.from('employees').select('id')
          .eq('restaurant_id', caller.rid).eq('is_active', true).eq('name', s.name).limit(2)
        if (error) throw new PeoplePolicyError('Access could not be verified', 503)
        return data?.length === 1 ? data[0].id : null
      })()
    },
  }
}
export type PeopleContext = ReturnType<typeof peopleContext>

/** Таблицы с персональными зарплатными данными → колонка-владелец строки. */
export const SALARY_TABLES: Record<string, string> = {
  employees: 'id',
  salary_history: 'employee_id',
  monthly_card_amounts: 'employee_id',
  salary_advances: 'employee_id',
  salary_payments: 'employee_id',
  shift_absences: 'employee_id',
}

/** Чтение открытого ЗП-долга за месяц (SALPERIOD:...) из shift_expenses — только своё. */
export function isSalaryDebtRead(table: string, op: string, filters: unknown): boolean {
  if (table !== 'shift_expenses' || op !== 'select' || !Array.isArray(filters)) return false
  return filters.some((f: any) => f && f.op === 'eq' && f.col === 'note' && typeof f.val === 'string' && /^SALPERIOD:\d{4}-\d{2}-01$/.test(f.val))
}

const rowsOf = (values: any): any[] => Array.isArray(values) ? values : values && typeof values === 'object' ? [values] : []
const onlyKeys = (values: any, allowed: string[]) => rowsOf(values).length > 0
  && rowsOf(values).every(v => Object.keys(v).every(k => allowed.includes(k)))
const mapRows = (values: any, fn: (v: any) => any) => Array.isArray(values) ? values.map(fn) : fn(values)

async function targetRows(admin: Admin, caller: Caller, table: string, filters: Filter[], columns: string): Promise<any[]> {
  if (!filters.length) throw new PeoplePolicyError('Filter required', 400)
  let q = admin.from(table).select(columns).eq('restaurant_id', caller.rid)
  for (const f of filters) {
    if (typeof q[f.op] !== 'function') throw new PeoplePolicyError('Invalid filter', 400)
    q = q[f.op](f.col, f.val)
  }
  const { data, error } = await q.limit(201)
  if (error) throw new PeoplePolicyError('Access could not be verified', 503)
  if ((data || []).length > 200) throw new PeoplePolicyError('Too many rows in one change', 400)
  return data || []
}

const SWAP_PEER_STATUSES = ['peer_accepted', 'peer_declined']
const ORDER_STATUSES = ['new', 'in_progress', 'done', 'cancelled']

/**
 * Проверяет и при необходимости сужает запрос к People-таблицам.
 * Возвращает новые values/filters или { empty: true } — «ответить пустым результатом».
 */
export async function applyPeoplePolicy(
  admin: Admin, caller: Caller, ctx: PeopleContext,
  req: { table: string; op: string; values: any; filters: Filter[] },
): Promise<{ values: any; filters: Filter[]; empty?: boolean }> {
  let { values, filters } = req
  const { table, op } = req
  if (caller.owner) return { values, filters }
  const isWrite = op !== 'select'
  const sid = caller.sid
  const write = () => { if (!sid) throw new PeoplePolicyError('Forbidden') }

  // ── Зарплата ──────────────────────────────────────────────────────────────
  const salaryKey = SALARY_TABLES[table]
  if (salaryKey && op === 'select' && !(await ctx.fullSalary())) {
    const emp = await ctx.ownEmployeeId()
    if (!emp) return { values, filters, empty: true }
    filters = [...filters, { op: 'eq', col: salaryKey, val: emp }]
  }
  if (table === 'salary_payments' && isWrite && !(await ctx.official())) throw new PeoplePolicyError('Forbidden')
  if (isSalaryDebtRead(table, op, filters) && !caller.apps.includes('manager') && !caller.apps.includes('analytics')) {
    const emp = await ctx.ownEmployeeId()
    if (!emp) return { values, filters, empty: true }
    filters = [...filters, { op: 'eq', col: 'employee_id', val: emp }]
  }

  // ── Стоп-лист и заказы: только доступность/статус, даже у должностных лиц ──
  if (table === 'menu_items' && isWrite) {
    if (op !== 'update' || !onlyKeys(values, ['is_available'])) throw new PeoplePolicyError('Only availability can be changed')
    const role = await ctx.role()
    if (!(await ctx.official()) && role !== 'kitchen') throw new PeoplePolicyError('Forbidden')
  }
  if (table === 'menu_orders' && isWrite) {
    if (op !== 'update' || !onlyKeys(values, ['status']) || !ORDER_STATUSES.includes(values.status)) throw new PeoplePolicyError('Only order status can be changed')
  }

  // Неопубликованные черновики графика видят только должностные лица.
  if (table === 'staff_schedules' && op === 'select' && !(await ctx.official())) {
    filters = [...filters, { op: 'eq', col: 'published', val: true }]
  }

  if (!isWrite) return { values, filters }
  const official = await ctx.official()

  // Автор строки — всегда сам вызывающий (а не то, что прислал клиент: встроенный веб
  // владельца слал id, которого нет в staff).
  const author = sid && sid !== 'owner' ? sid : null

  switch (table) {
    case 'staff_schedules':
    case 'shift_checklists':
    // Прогоны чек-листов/аудитов: сотрудник отмечает пункты только через
    // /api/people/checklist-item (CAS + снимок пункта); прямая запись через шлюз позволяла
    // переписать или удалить любой прогон, включая менеджерскую верификацию (аудит 2026-11-14, К2).
    case 'shift_checklist_completions':
      if (!official) throw new PeoplePolicyError('Forbidden')
      break
    case 'tech_cards': {
      const role = await ctx.role()
      if (!official && role !== 'kitchen' && role !== 'bar') throw new PeoplePolicyError('Forbidden')
      break
    }
    case 'attendance_records': {
      if (official) break
      write()
      if (op === 'delete') throw new PeoplePolicyError('Forbidden')
      if (op === 'insert' || op === 'upsert') {
        // К3 (аудит 2026-11-14): опоздание/статус/дистанцию считает сервер; одна запись,
        // только за себя, и уже отмеченный приход нельзя перезаписать.
        if (Array.isArray(values)) throw new PeoplePolicyError('One check-in at a time', 400)
        const { data: settings } = await admin.from('restaurant_settings').select('*').eq('restaurant_id', caller.rid).maybeSingle()
        const now = new Date()
        const probeDate = typeof values?.date === 'string' ? values.date : localDateKey(now, settings?.timezone)
        const { data: sched } = await admin.from('staff_schedules').select('id, shift_start, published')
          .eq('restaurant_id', caller.rid).eq('staff_id', sid).eq('date', probeDate).maybeSingle()
        let row: Record<string, any>
        try {
          row = buildCheckIn({ input: values, staffId: sid!, now, settings, schedule: sched?.published ? sched : null })
        } catch (e) {
          if (e instanceof AttendanceError) throw new PeoplePolicyError(e.message, e.status)
          throw e
        }
        const { data: dup } = await admin.from('attendance_records').select('id')
          .eq('restaurant_id', caller.rid).eq('staff_id', sid).eq('date', row.date).maybeSingle()
        if (dup) throw new PeoplePolicyError('Already checked in', 409)
        values = row
      } else {
        if (!onlyKeys(values, ['check_out_at', 'check_out_lat', 'check_out_lng'])) throw new PeoplePolicyError('Forbidden')
        filters = [...filters, { op: 'eq', col: 'staff_id', val: sid }]
      }
      break
    }
    case 'staff_tasks': {
      if (op === 'insert' || op === 'upsert') { values = mapRows(values, v => ({ ...v, created_by: author })); break }
      if (official) break
      write()
      const rows = await targetRows(admin, caller, table, filters, 'id, assigned_to, created_by')
      const mine = (r: any) => op === 'delete' ? r.created_by === sid : (r.created_by === sid || r.assigned_to === sid)
      if (rows.some(r => !mine(r))) throw new PeoplePolicyError('Forbidden')
      if (op === 'update' && rows.some(r => r.created_by !== sid) && !onlyKeys(values, ['status', 'completed_at', 'updated_at'])) throw new PeoplePolicyError('Forbidden')
      filters = [...filters, { op: 'in', col: 'id', val: rows.map(r => r.id) }]
      break
    }
    case 'staff_reports': {
      if (op === 'insert' || op === 'upsert') { values = mapRows(values, v => ({ ...v, author_id: author })); break }
      if (official) break
      write()
      if (op !== 'delete') throw new PeoplePolicyError('Forbidden')
      const rows = await targetRows(admin, caller, table, filters, 'id, author_id')
      if (rows.some(r => r.author_id !== sid)) throw new PeoplePolicyError('Forbidden')
      filters = [...filters, { op: 'in', col: 'id', val: rows.map(r => r.id) }]
      break
    }
    case 'shift_swap_requests': {
      if (official) break
      write()
      if (op === 'insert') {
        const rows = rowsOf(values)
        for (const v of rows) {
          if (v.status && v.status !== 'pending_peer') throw new PeoplePolicyError('Forbidden')
          const { data, error } = await admin.from('staff_schedules').select('staff_id, published')
            .eq('restaurant_id', caller.rid).eq('id', v.schedule_id).maybeSingle()
          if (error) throw new PeoplePolicyError('Access could not be verified', 503)
          if (!data || data.staff_id !== sid || data.published !== true) throw new PeoplePolicyError('Forbidden')
        }
        values = mapRows(values, v => ({ ...v, requester_id: sid, status: 'pending_peer', manager_id: null, manager_responded_at: null }))
        break
      }
      if (op !== 'update' || !onlyKeys(values, ['status', 'peer_responded_at', 'updated_at'])) throw new PeoplePolicyError('Forbidden')
      const rows = await targetRows(admin, caller, table, filters, 'id, requester_id, target_id, status')
      const next = values.status
      const ok = (r: any) => (r.target_id === sid && r.status === 'pending_peer' && SWAP_PEER_STATUSES.includes(next))
        || (r.requester_id === sid && ['pending_peer', 'peer_accepted'].includes(r.status) && next === 'cancelled')
      if (rows.some(r => !ok(r))) throw new PeoplePolicyError('Forbidden')
      filters = [...filters, { op: 'in', col: 'id', val: rows.map(r => r.id) }]
      break
    }
    case 'tech_card_sessions': {
      if (official) break
      write()
      if (op === 'insert' || op === 'upsert') values = mapRows(values, v => ({ ...v, staff_id: sid }))
      else filters = [...filters, { op: 'eq', col: 'staff_id', val: sid }]
      break
    }
    case 'purchase_items': {
      if (op === 'insert' || op === 'upsert') {
        values = mapRows(values, v => ({ ...v, created_by: author, created_by_name: caller.name || v.created_by_name || null }))
        break
      }
      if (official) break
      write()
      // Отметка «куплено» — общая; правка содержимого и удаление — только своё.
      if (op === 'update' && onlyKeys(values, ['status', 'bought_by', 'bought_at'])) {
        values = { ...values, bought_by: values.status === 'bought' ? sid : null }
        break
      }
      const rows = await targetRows(admin, caller, table, filters, 'id, created_by')
      if (rows.some(r => r.created_by !== sid)) throw new PeoplePolicyError('Forbidden')
      filters = [...filters, { op: 'in', col: 'id', val: rows.map(r => r.id) }]
      break
    }
  }
  return { values, filters }
}
