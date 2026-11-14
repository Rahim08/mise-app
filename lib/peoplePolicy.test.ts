import { describe, it, expect } from 'vitest'
import { applyPeoplePolicy, peopleContext, PeoplePolicyError } from './peoplePolicy'
import { computePersonalSalary } from './peopleSalary'
import { mergeChecklistItem } from './checklistMerge'
import type { Caller } from './apiAuth'

// Минимальный мок supabase-клиента: таблица → строки; поддерживает цепочку фильтров,
// которую использует peoplePolicy (eq/in/limit/maybeSingle).
function mockAdmin(tables: Record<string, any[]>) {
  return {
    from(table: string) {
      let rows = [...(tables[table] || [])]
      const q: any = {
        select: () => q,
        eq: (c: string, v: any) => { rows = rows.filter(r => r[c] === v); return q },
        in: (c: string, v: any[]) => { rows = rows.filter(r => v.includes(r[c])); return q },
        limit: (n: number) => { rows = rows.slice(0, n); return q },
        maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
        then: (res: any, rej: any) => Promise.resolve({ data: rows, error: null }).then(res, rej),
      }
      return q
    },
  }
}

const RID = 'r1'
const staff = [
  { id: 'w1', restaurant_id: RID, role: 'waiter', employee_id: 'e1', name: 'Анна' },
  { id: 'w2', restaurant_id: RID, role: 'waiter', employee_id: null, name: 'Иван' },
  { id: 'm1', restaurant_id: RID, role: 'manager', employee_id: 'e9', name: 'Босс' },
]
const employees = [
  { id: 'e1', restaurant_id: RID, name: 'Анна', is_active: true },
  { id: 'e2', restaurant_id: RID, name: 'Иван', is_active: true },
  { id: 'e3', restaurant_id: RID, name: 'Иван', is_active: true },
]
const waiter: Caller = { rid: RID, owner: false, apps: ['people'], sid: 'w1', name: 'Анна' }
const waiter2: Caller = { rid: RID, owner: false, apps: ['people'], sid: 'w2', name: 'Иван' }
const manager: Caller = { rid: RID, owner: false, apps: ['people'], sid: 'm1', name: 'Босс' }

async function run(caller: Caller, table: string, op: string, values: any, filters: any[] = [], extra: Record<string, any[]> = {}) {
  const admin = mockAdmin({ staff, employees, ...extra })
  return applyPeoplePolicy(admin, caller, peopleContext(admin, caller), { table, op, values, filters })
}

describe('peoplePolicy — зарплата', () => {
  it('сотрудник читает только свою строку оклада', async () => {
    const r = await run(waiter, 'salary_payments', 'select', undefined)
    expect(r.filters).toContainEqual({ op: 'eq', col: 'employee_id', val: 'e1' })
  })
  it('неоднозначное имя без staff.employee_id — пустой ответ, не чужая строка', async () => {
    const r = await run(waiter2, 'employees', 'select', undefined)
    expect(r.empty).toBe(true)
  })
  it('менеджер видит всех', async () => {
    const r = await run(manager, 'employees', 'select', undefined)
    expect(r.filters).toEqual([])
  })
  it('сотрудник не может записать выплату', async () => {
    await expect(run(waiter, 'salary_payments', 'insert', { employee_id: 'e1', amount: 1 })).rejects.toBeInstanceOf(PeoplePolicyError)
  })
  it('ЗП-долг из shift_expenses — только свой', async () => {
    const r = await run(waiter, 'shift_expenses', 'select', undefined, [{ op: 'eq', col: 'note', val: 'SALPERIOD:2026-10-01' }])
    expect(r.filters).toContainEqual({ op: 'eq', col: 'employee_id', val: 'e1' })
  })
})

describe('peoplePolicy — роли', () => {
  it('сотрудник не меняет график и шаблоны', async () => {
    await expect(run(waiter, 'staff_schedules', 'update', { staff_id: 'w1' }, [{ op: 'eq', col: 'id', val: 's1' }])).rejects.toThrow()
    await expect(run(waiter, 'shift_checklists', 'insert', { items: [] })).rejects.toThrow()
  })
  it('сотрудник не видит черновики графика', async () => {
    const r = await run(waiter, 'staff_schedules', 'select', undefined)
    expect(r.filters).toContainEqual({ op: 'eq', col: 'published', val: true })
  })
  it('явка пишется только на себя', async () => {
    const r = await run(waiter, 'attendance_records', 'upsert', { staff_id: 'w2', date: '2026-11-14' })
    expect(r.values.staff_id).toBe('w1')
    await expect(run(waiter, 'attendance_records', 'update', { status: 'present' }, [{ op: 'eq', col: 'id', val: 'a1' }])).rejects.toThrow()
  })
  it('нельзя удалить чужую задачу', async () => {
    const tasks = [{ id: 't1', restaurant_id: RID, assigned_to: 'w1', created_by: 'm1' }]
    await expect(run(waiter, 'staff_tasks', 'delete', undefined, [{ op: 'eq', col: 'id', val: 't1' }], { staff_tasks: tasks })).rejects.toThrow()
    const ok = await run(waiter, 'staff_tasks', 'update', { status: 'done' }, [{ op: 'eq', col: 'id', val: 't1' }], { staff_tasks: tasks })
    expect(ok.filters).toContainEqual({ op: 'in', col: 'id', val: ['t1'] })
  })
  it('автор задачи — сам вызывающий', async () => {
    const r = await run(waiter, 'staff_tasks', 'insert', { title: 'x', created_by: 'owner-uid' })
    expect(r.values.created_by).toBe('w1')
  })
  it('стоп-лист меняет только доступность', async () => {
    await expect(run(manager, 'menu_items', 'update', { price: 1 }, [{ op: 'eq', col: 'id', val: 'i1' }])).rejects.toThrow()
    await expect(run(manager, 'menu_items', 'update', { is_available: false }, [{ op: 'eq', col: 'id', val: 'i1' }])).resolves.toBeTruthy()
  })
  it('сотрудник не утверждает обмен сам', async () => {
    const swaps = [{ id: 'sw1', restaurant_id: RID, requester_id: 'w2', target_id: 'w1', status: 'pending_peer' }]
    await expect(run(waiter, 'shift_swap_requests', 'update', { status: 'approved' }, [{ op: 'eq', col: 'id', val: 'sw1' }], { shift_swap_requests: swaps })).rejects.toThrow()
    await expect(run(waiter, 'shift_swap_requests', 'update', { status: 'peer_accepted' }, [{ op: 'eq', col: 'id', val: 'sw1' }], { shift_swap_requests: swaps })).resolves.toBeTruthy()
  })
})

describe('computePersonalSalary', () => {
  const base = {
    employee: { id: 'e1', name: 'Анна', salary: 1000, deduct_per_absence: 50 },
    history: [], absences: [{ date: '2026-10-03', source: 'manager' }, { date: '2026-10-04', source: 'auto' }],
    cardAmount: 200, advances: [{ amount: 100 }], payments: [], openDebt: 0, attendance: [], monthStart: '2026-10-01',
  }
  it('считает остаток наличными; авто-прогул не удерживается', () => {
    const r = computePersonalSalary(base)
    expect(r.total).toBe(950)
    expect(r.cash).toBe(650)
    expect(r.status).toBe('partial')
  })
  it('открытый ЗП-долг — не «Выплачено»', () => {
    const r = computePersonalSalary({ ...base, openDebt: 650 })
    expect(r.remaining).toBe(0)
    expect(r.status).toBe('debt')
  })
  it('полная выплата — paid', () => {
    const r = computePersonalSalary({ ...base, payments: [{ amount: 650, method: 'cash', paid_at: '2026-10-31T10:00:00Z' }] })
    expect(r.status).toBe('paid')
  })
})

describe('mergeChecklistItem', () => {
  it('меняет только свой индекс', () => {
    const { state, allDone } = mergeChecklistItem([{ done: true }, { done: false }], 3, 1, { done: true })
    expect(state.map(s => s.done)).toEqual([true, true, false])
    expect(allDone).toBe(false)
  })
})
