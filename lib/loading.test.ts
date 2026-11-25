import { readFileSync } from 'node:fs'
import { ScriptTarget, transpileModule } from 'typescript'
import { describe, expect, it } from 'vitest'
import { splitShiftExpenses } from './shiftForm'

// Execute the real component loaders with controlled query completion, without a
// live restaurant session or a DOM. These tests cover async ordering/state races.
type Row = Record<string, unknown>
type Query = {
  select(value?: string): Query; eq(key: string, value: unknown): Query; gte(key: string, value: unknown): Query
  lte(): Query; lt(): Query; order(): Query; limit(): Query; in(): Query
  then(resolve: (value: unknown) => void, reject: (error: unknown) => void): Promise<void>
}
const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const between = (source: string, start: string, end: string) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)))
const deferred = <T,>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(r => { resolve = r })
  return { promise, resolve }
}
const tick = () => new Promise(resolve => setTimeout(resolve, 0))
const database = (result: (table: string, filters: Row, columns: string) => unknown) => ({
  from(table: string) {
    const filters: Row = {}
    let columns = '*'
    const query: Query = {
      select(value = '*') { columns = value; return query },
      eq(key: string, value: unknown) { filters[key] = value; return query },
      gte(key: string, value: unknown) { filters[`gte:${key}`] = value; return query },
      lte() { return query }, lt() { return query }, order() { return query }, limit() { return query }, in() { return query },
      then(resolve: (value: unknown) => void, reject: (error: unknown) => void) {
        return Promise.resolve(result(table, filters, columns)).then(resolve, reject)
      },
    }
    return query
  },
})
function loader(body: string, name: string, values: Row) {
  const state: Row = {}
  for (const [, setter] of body.matchAll(/\b(set[A-Z]\w*)\(/g)) values[setter] = (value: unknown) => { state[setter] = value }
  const js = transpileModule(`${body}\nreturn ${name}`, { compilerOptions: { target: ScriptTarget.ES2020 } }).outputText
  return { load: new Function(...Object.keys(values), js)(...Object.values(values)), state }
}
const analytics = read('app/analytics/AnalyticsApp.tsx')
const periodBody = between(analytics, '  const loadAll = async', '\n  const loadAllHistory')
const periodLoader = (db: unknown, settings: Promise<unknown> | null = null) => loader(periodBody, 'loadAll', {
  db, fmtDate: (date: Date) => date.toISOString().slice(0, 10), SALPERIOD_PREFIX: 'SALPERIOD:',
  resolveEmployeesForMonth: (rows: Row[]) => rows, loadGenerationRef: { current: 0 }, settingsLoadRef: { current: settings },
})

describe('analytics load dependencies', () => {
  it('publishes turnover and clears primary loading while payroll is still pending', async () => {
    const payroll = deferred<unknown>()
    const { load, state } = periodLoader(database(table => table === 'employees' ? payroll.promise : { data: table === 'shifts' ? [{ id: 's', income: 100 }] : [] }))
    const pending = load('r', new Date('2026-11-12'))
    await tick()
    expect(state.setShifts).toMatchObject([{ income: 100 }])
    expect(state.setLoading).toBe(false)
    expect(state.setSalaryLoading).toBe(true)
    payroll.resolve({ data: [] }); await pending
    expect(state.setSalaryLoading).toBe(false)
  })

  it('waits for card-inclusion settings before publishing revenue', async () => {
    const settings = deferred<unknown>()
    const { load, state } = periodLoader(database(() => ({ data: [] })), settings.promise)
    const pending = load('r', new Date('2026-11-12'))
    await tick()
    expect(state.setShifts).toBeUndefined()
    expect(state.setLoading).toBe(true)
    settings.resolve(null); await pending
    expect(state.setShifts).toEqual([])
  })

  it('clears expense and collection details for an empty month', async () => {
    const { load, state } = periodLoader(database(() => ({ data: [] })))
    state.setExpenses = [{ amount: 42 }]; state.setInkByShift = { old: { expense: 12 } }
    await load('r', new Date('2026-11-12'))
    expect(state.setExpenses).toEqual([])
    expect(state.setInkByShift).toEqual({})
  })

  it('ignores an older month that finishes after the newer selection', async () => {
    const old = deferred<unknown>()
    const { load, state } = periodLoader(database((table, filters) => table === 'shifts'
      ? filters['gte:date'] === '2026-10-01' ? old.promise : { data: [{ id: 'new', income: 250 }] }
      : { data: [] }))
    const first = load('r', new Date('2026-10-12'))
    const latest = load('r', new Date('2026-12-12'))
    await latest
    old.resolve({ data: [{ id: 'old', income: 10 }] }); await first
    expect(state.setShifts).toMatchObject([{ id: 'new' }])
    expect(state.setLoading).toBe(false)
  })

  it('publishes the collection aggregate before all-time history arrives', async () => {
    const history = deferred<unknown>()
    const body = between(analytics, '  const loadAllHistory = async', '\n  // ── COMPUTED')
    const { load, state } = loader(body, 'loadAllHistory', { db: database(table => table === 'shifts' ? history.promise : { data: table === 'inkassation_balance' ? [{ balance: 245 }] : [] }) })
    const pending = load('r'); await tick()
    expect(state.setCumulativeInkass).toBe(245)
    history.resolve({ data: [] }); await pending
    expect(state.setAllExpenses).toEqual([])
  })
})

it('waits for the catalog on an empty Manager day and preserves ownership on navigation', async () => {
  const catalog = deferred<{ employees: Row[]; categories: Row[] }>()
  let detailsStarted = false
  const db = database((table, filters, columns) => {
    if (table === 'shifts' && columns === '*' && filters.date === '2026-11-11') return { data: [{ id: 's', income: 100 }] }
    if (table === 'shift_expenses') {
      detailsStarted = true
      return { data: [{ id: 'x', shift_id: 's', category_id: 'c', amount: 42 }, { id: 'y', shift_id: 's', employee_id: 'e', amount: 7 }] }
    }
    return { data: [] }
  })
  const body = between(read('app/manager/page.tsx'), '  const loadAbsencesByDate', '\n  const changeDate')
  const { load, state } = loader(body, 'loadDay', { db, splitShiftExpenses, fmtDate: (date: Date) => date.toISOString().slice(0, 10), dayLoadGeneration: { current: 0 }, catalogLoadRef: { current: catalog.promise }, formRows: { current: null } })
  const today = load('r', new Date('2026-11-12'), [], []); await tick()
  expect(state.setLoading).toBe(true)
  const previous = load('r', new Date('2026-11-11'), [], []); await tick()
  expect(detailsStarted).toBe(true)
  expect(state.setLoading).toBe(true)
  catalog.resolve({ employees: [{ id: 'e' }], categories: [{ id: 'c' }] })
  await Promise.all([today, previous])
  expect(state.setCatAmounts).toEqual({ c: '42' })
  expect(state.setEmpExtras).toEqual({ e: '7' })
  expect(state.setLoading).toBe(false)
})
