import { describe, it, expect } from 'vitest'
import { splitShiftExpenses, eligibleDebtsFor, hasStaleDebt, round2 } from './shiftForm'

const cats = new Set(['cat1', 'cat2'])
const emps = new Set(['emp1', 'emp2'])

describe('splitShiftExpenses', () => {
  it('keeps salary-period debts out of the form', () => {
    const s = splitShiftExpenses([
      { id: 'a', employee_id: 'emp1', amount: 100, note: 'SALPERIOD:2026-08-01', is_paid: false },
    ], 'sh', cats, emps)
    expect(s.empExtras).toEqual({})
    expect(s.ownedIds).toEqual([])
    expect(s.unmanagedPaidTotal).toBe(0)
  })

  it('sums duplicate rows of one employee instead of dropping them', () => {
    const s = splitShiftExpenses([
      { id: 'a', employee_id: 'emp1', amount: 20, is_paid: true },
      { id: 'b', employee_id: 'emp1', amount: 30, is_paid: true },
    ], 'sh', cats, emps)
    expect(s.empExtras.emp1).toBe('50')
    expect(s.ownedIds).toEqual(['a', 'b'])
  })

  it('leaves inactive employee/category rows alone but counts their paid amount', () => {
    const s = splitShiftExpenses([
      { id: 'a', employee_id: 'gone', amount: 40, is_paid: true },
      { id: 'b', category_id: 'oldcat', amount: 10, is_paid: true },
      { id: 'c', category_id: 'oldcat', amount: 99, is_paid: false },
    ], 'sh', cats, emps)
    expect(s.ownedIds).toEqual([])
    expect(s.unmanagedPaidTotal).toBe(50)
  })

  it('does not mix paid and unpaid rows of one key', () => {
    const s = splitShiftExpenses([
      { id: 'a', category_id: 'cat1', amount: 10, is_paid: true, note: 'x' },
      { id: 'b', category_id: 'cat1', amount: 5, is_paid: false },
    ], 'sh', cats, emps)
    expect(s.catAmounts.cat1).toBe('10')
    expect(s.catUnpaid.cat1).toBeUndefined()
    expect(s.catNotes.cat1).toBe('x')
    expect(s.ownedIds).toEqual(['a'])
    expect(s.unmanagedPaidTotal).toBe(0)
  })

  it('splits settlement rows from history markers', () => {
    const s = splitShiftExpenses([
      { id: 'a', category_id: 'cat1', amount: 120, is_paid: true, paid_shift_id: 'sh' },
      { id: 'b', category_id: 'cat1', amount: 70, is_paid: true, paid_shift_id: 'other' },
    ], 'sh', cats, emps)
    expect(s.settledTodayTotal).toBe(120)
    expect(s.ownedIds).toEqual([])
    expect(s.catAmounts).toEqual({})
  })
})

describe('round2', () => {
  it('drops float tails', () => {
    expect(round2(482.49999999999864)).toBe(482.5)
    expect(round2(0.1 + 0.2)).toBe(0.3)
  })
})

describe('погашение долгов', () => {
  it('долг своей смены не погашается ею же', () => {
    expect(eligibleDebtsFor([{ shiftId: 'a' }, { shiftId: 'b' }], 'b')).toEqual([{ shiftId: 'a' }])
  })
  it('устаревший долг: погашен другой сменой, удалён, изменён', () => {
    const d = [{ id: '1', amount: 10 }]
    const open = { id: '1', amount: 10, is_paid: false }
    expect(hasStaleDebt(d, [open], 's')).toBe(false)
    expect(hasStaleDebt(d, [{ ...open, is_paid: true, paid_shift_id: 's' }], 's')).toBe(false)
    expect(hasStaleDebt(d, [{ ...open, is_paid: true, paid_shift_id: 'x' }], 's')).toBe(true)
    expect(hasStaleDebt(d, [{ ...open, is_paid: true }], 's')).toBe(true)
    expect(hasStaleDebt(d, [{ ...open, amount: 12 }], 's')).toBe(true)
    expect(hasStaleDebt(d, [], 's')).toBe(true)
  })
})
