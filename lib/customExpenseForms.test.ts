import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { customExpenseTotal, parseExpenseCents, prepareCustomExpenses, type CustomExpenseDraft } from './customExpenses'
import { eligibleDebtsFor, hasStaleDebt, round2, SALPERIOD_PREFIX, splitShiftExpenses } from './shiftForm'

type Row = Record<string, unknown>
type Mutation = { table: string; op: string; values: Row[]; ids: string[] }
const id = '11111111-1111-4111-8111-111111111111'
const otherId = '22222222-2222-4222-8222-222222222222'
const draft = (amount = '12,50'): CustomExpenseDraft => ({ id, name: 'Perfume', amount })
const saved = (extra: Row = {}): Row => ({ id, shift_id: 'shift', restaurant_id: 'venue', category_name: 'Perfume', amount: 12.5, is_custom: true, is_paid: true, category_id: null, employee_id: null, note: '', ...extra })

// An in-memory gateway boundary executes writes and returns affected rows. The code
// under test is each real component's persistence flow, including its actual calc.
function gateway(initial: Row[]) {
  const tables: Record<string, Row[]> = { shift_expenses: structuredClone(initial), shifts: [{ id: 'shift' }], inkassations: [], shift_absences: [] }
  const writes: Mutation[] = []
  let loseUpsertResponse = false
  let afterCustomSelect: (() => void) | undefined
  const db = {
    from(table: string) {
      let op = 'select', values: Row[] = [], returning = false
      const filters: ((row: Row) => boolean)[] = []
      const query = {
        select() { returning = true; return query },
        eq(key: string, value: unknown) { filters.push(row => row[key] === value); return query },
        is(key: string, value: unknown) { filters.push(row => (row[key] ?? null) === value); return query },
        in(key: string, entries: unknown[]) { filters.push(row => entries.includes(row[key])); return query },
        order() { return query }, limit() { return query },
        insert(value: Row | Row[]) { op = 'insert'; values = Array.isArray(value) ? value : [value]; return query },
        upsert(value: Row | Row[]) { op = 'upsert'; values = Array.isArray(value) ? value : [value]; return query },
        update(value: Row) { op = 'update'; values = [value]; return query },
        delete() { op = 'delete'; return query },
        then(resolve: (result: unknown) => unknown, reject: (error: unknown) => unknown) {
          const rows = tables[table] ?? (tables[table] = [])
          const selected = rows.filter(row => filters.every(filter => filter(row)))
          if (op === 'select') {
            const data = structuredClone(selected)
            if (table === 'shift_expenses' && afterCustomSelect) {
              const run = afterCustomSelect; afterCustomSelect = undefined; run()
            }
            return Promise.resolve({ data, error: null }).then(resolve, reject)
          }
          writes.push({ table, op, values: structuredClone(values), ids: selected.map(row => row.id as string) })
          if (op === 'delete') tables[table] = rows.filter(row => !selected.includes(row))
          if (op === 'update') selected.forEach(row => Object.assign(row, values[0]))
          if (op === 'insert') rows.push(...structuredClone(values))
          if (op === 'upsert') for (const value of values) {
            const current = rows.find(row => row.id === value.id && row.restaurant_id === value.restaurant_id)
            if (current) Object.assign(current, value)
            else rows.push(structuredClone(value))
          }
          if (op === 'upsert' && loseUpsertResponse) {
            loseUpsertResponse = false
            return Promise.resolve({ data: null, error: { message: 'Lost response' } }).then(resolve, reject)
          }
          return Promise.resolve({ data: returning ? structuredClone(selected) : null, error: null }).then(resolve, reject)
        },
      }
      return query
    },
    rpc() { throw new Error('Unexpected settlement') },
  }
  return { db, tables, writes, loseNextUpsertResponse() { loseUpsertResponse = true },
    addAfterPreflight(row: Row) { afterCustomSelect = () => tables.shift_expenses.push(row) } }
}

function persistence(path: string, database: ReturnType<typeof gateway>, drafts: CustomExpenseDraft[], loaded: CustomExpenseDraft[]) {
  const text = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const names = new Set(['eligibleDebts', 'debtSettleTotal', 'calc', 'persistDebtSettlements', 'validateCustomExpenses', 'persistShiftOnce'])
  const declarations: string[] = []
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && names.has(node.name.text) && node.initializer) {
      declarations.push(`const ${node.name.text} = ${node.initializer.getText(source)};`)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  if (declarations.length !== names.size) throw new Error('Persistence harness could not locate the real functions')
  const body = `
    const { db, prepareCustomExpenses, parseExpenseCents, customExpenseTotal, splitShiftExpenses, round2, SALPERIOD_PREFIX, eligibleDebtsFor, hasStaleDebt } = dependencies;
    let customExpenses = dependencies.drafts, loadedCustomExpenses = dependencies.loaded;
    let shift = { id: 'shift', opening_balance: 0 }, openDebts = [], selectedDebtIds = new Set(), settledTodayTotal = 0;
    const restaurantId = 'venue', currentDate = new Date('2026-11-13'), income = '100', incomeCard = '', inkSum = '', inkExpense = '', inkReason = '';
    const categories = [], employees = [], catUnpaid = {}, empUnpaid = {}, catAmounts = {}, empExtras = {}, catNotes = {};
    const unmanagedPaidTotal = 0, fmtDate = date => date.toISOString().slice(0, 10), tr = key => key;
    let loadedInkExpense = '', loadedInkReason = '';
    const setLoadedCustomExpenses = value => { loadedCustomExpenses = value };
    const setCustomExpenses = value => { customExpenses = typeof value === 'function' ? value(customExpenses) : value };
    const setShift = value => { shift = value };
    const setOpenDebts = value => { openDebts = typeof value === 'function' ? value(openDebts) : value };
    const setSelectedDebtIds = value => { selectedDebtIds = value };
    const setSettledTodayTotal = value => { settledTodayTotal = typeof value === 'function' ? value(settledTodayTotal) : value };
    const setLoadedInkExpense = value => { loadedInkExpense = value }, setLoadedInkReason = value => { loadedInkReason = value };
    const setAutoAbsences = () => {}, loadOpenDebts = async () => {};
    ${declarations.join('\n')}
    return () => persistShiftOnce(shift, currentDate);
  `
  const js = ts.transpileModule(body, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText
  return new Function('dependencies', js)({ db: database.db, prepareCustomExpenses, parseExpenseCents, customExpenseTotal, splitShiftExpenses, round2, SALPERIOD_PREFIX, eligibleDebtsFor, hasStaleDebt, drafts, loaded }) as () => Promise<number>
}

for (const [surface, path] of [['Manager', 'app/manager/page.tsx'], ['Dashboard', 'app/dashboard/(shell)/shifts/page.tsx']]) {
  describe(`${surface} custom expense persistence`, () => {
    it('rejects a partial row before any financial write', async () => {
      const db = gateway([])
      await expect(persistence(path, db, [{ ...draft(), amount: '' }], [])()).rejects.toThrow('mg.customExpenseInvalid')
      expect(db.writes).toEqual([])
    })
    it('rejects a remote addition before replacing the cash total', async () => {
      const db = gateway([saved({ id: otherId, category_name: 'Taxi' })])
      await expect(persistence(path, db, [draft()], [])()).rejects.toThrow('mg.customExpenseStale')
      expect(db.writes).toEqual([])
      expect(db.tables.shift_expenses).toHaveLength(1)
    })
    it('rejects a settled custom row without reopening it or changing cash', async () => {
      const db = gateway([saved({ is_paid: true, paid_shift_id: 'newer-shift' })])
      await expect(persistence(path, db, [{ ...draft(), unpaid: true }], [{ ...draft(), unpaid: true }])()).rejects.toThrow('mg.customExpenseStale')
      expect(db.writes).toEqual([])
      expect(db.tables.shift_expenses[0].paid_shift_id).toBe('newer-shift')
    })
    it('retains a stable UUID while editing and never deletes the retained row', async () => {
      const db = gateway([saved()])
      const balance = await persistence(path, db, [draft('15')], [draft()])()
      expect(balance).toBe(85)
      expect(db.tables.shift_expenses).toEqual([saved({ amount: 15 })])
      expect(db.writes.filter(write => write.op === 'delete').flatMap(write => write.ids)).not.toContain(id)
      expect(db.writes.findIndex(write => write.op === 'upsert')).toBeLessThan(db.writes.findIndex(write => write.table === 'shifts'))
    })
    it('only deletes dropped snapshot customs and preserves legacy and later remote rows', async () => {
      const db = gateway([saved(), { id: 'legacy', category_name: 'Historical', amount: 4 }])
      db.addAfterPreflight(saved({ id: otherId, category_name: 'Taxi', amount: 6 }))
      await persistence(path, db, [], [draft()])()
      expect(db.tables.shift_expenses.map(row => row.id).sort()).toEqual([otherId, 'legacy'].sort())
      expect(db.writes.filter(write => write.op === 'delete').flatMap(write => write.ids)).toEqual([id])
    })
    it('retries a lost response for an edit and accepts its own normalized saved values', async () => {
      const db = gateway([saved()])
      const save = persistence(path, db, [{ ...draft('15,00'), name: '  Perfume  ' }], [draft()])
      db.loseNextUpsertResponse()
      await expect(save()).rejects.toThrow('Lost response')
      expect(db.writes.some(write => write.table === 'shifts')).toBe(false)
      await expect(save()).resolves.toBe(85)
      await expect(save()).resolves.toBe(85)
      expect(db.tables.shift_expenses).toEqual([saved({ amount: 15 })])
    })
    it('retries a lost upsert response without creating a second expense', async () => {
      const db = gateway([])
      const save = persistence(path, db, [draft()], [])
      db.loseNextUpsertResponse()
      await expect(save()).rejects.toThrow('Lost response')
      expect(db.writes.some(write => write.table === 'shifts')).toBe(false)
      await expect(save()).resolves.toBe(87.5)
      expect(db.tables.shift_expenses).toEqual([saved()])
    })
  })
}
