import { describe, expect, it } from 'vitest'
import { customExpenseTotal, customExpenseWriteError, normalizeExpenseName, parseExpenseCents, prepareCustomExpenses } from './customExpenses'
import { splitShiftExpenses } from './shiftForm'

describe('one-off shift expenses', () => {
  it('normalizes names and parses exact decimal cents', () => {
    expect(normalizeExpenseName('  Perfume   refill ')).toBe('Perfume refill')
    expect(parseExpenseCents('12,50')).toBe(1250)
    expect(parseExpenseCents('.50')).toBe(50)
    for (const value of ['-1', '0', 'NaN', 'Infinity', '1e3', '1.234', '12abc']) expect(parseExpenseCents(value)).toBeNull()
  })
  it('ignores blank rows and rejects partial rows before producing writes', () => {
    expect(prepareCustomExpenses([{ id: 'blank', name: '', amount: '' }])).toEqual([])
    expect(() => prepareCustomExpenses([{ id: 'x', name: 'Perfume', amount: '' }])).toThrow()
    expect(() => prepareCustomExpenses([{ id: 'x', name: '', amount: '12' }])).toThrow()
    expect(() => prepareCustomExpenses([{ id: 'x', name: 'x'.repeat(121), amount: '12' }])).toThrow()
  })
  it('rejects malformed custom writes at the server boundary', () => {
    const valid = { is_custom: true, category_name: 'Perfume', amount: 12.5 }
    expect(customExpenseWriteError([valid])).toBe(false)
    for (const invalid of [{ amount: 1.234 }, { amount: Infinity }, { amount: '12' }, { category_name: ' ' }, { category_id: 'cat' }, { employee_id: 'employee' }, { is_custom: 'true' }]) {
      expect(customExpenseWriteError([{ ...valid, ...invalid }])).toBe(true)
    }
    expect(customExpenseWriteError([{ category_id: 'legacy', amount: 4 }])).toBe(false)
  })
  it('counts paid amounts once and does not subtract unpaid expenses', () => {
    expect(customExpenseTotal([{ id: 'a', name: 'Perfume', amount: '0.10' }, { id: 'b', name: 'Taxi', amount: '0.20' }, { id: 'c', name: 'Repair', amount: '50', unpaid: true }])).toBe(0.3)
  })
  it('round-trips custom rows independently of templates and legacy expenses', () => {
    const rows = [{ id: 'x', is_custom: true, category_name: 'Perfume', amount: 12.5, is_paid: true },
      { id: 'legacy', category_name: 'Historical', amount: 4 },
      { id: 'template', category_id: 'cat', amount: 3 },
      { id: 'inactive', category_id: 'gone', amount: 8 }]
    const split = splitShiftExpenses(rows, 'sh', new Set(['cat']), new Set(), true)
    expect(split.customExpenses).toEqual([{ id: 'x', name: 'Perfume', amount: '12.5', unpaid: false, note: '' }])
    expect(split.ownedIds).toEqual(['x', 'template'])
    expect(split.unmanagedPaidTotal).toBe(12)
    expect(prepareCustomExpenses(split.customExpenses)).toEqual([{ id: 'x', category_name: 'Perfume', amount: 12.5, is_custom: true, is_paid: true, note: '' }])
    expect(splitShiftExpenses(rows, 'sh', new Set(['cat']), new Set()).unmanagedPaidTotal).toBe(24.5)
  })
  it('never owns settlement markers, payroll debts or foreign-key custom impostors', () => {
    const split = splitShiftExpenses([
      { id: 'settlement', is_custom: true, category_name: 'Perfume', amount: 10, paid_shift_id: 'sh' },
      { id: 'debt', is_custom: true, category_name: 'Payroll', amount: 20, note: 'SALPERIOD:2026-11-01', is_paid: false },
      { id: 'foreign', is_custom: true, category_id: 'active', category_name: 'Old category', amount: 5 },
    ], 'sh', new Set(['active']), new Set(), true)
    expect(split.customExpenses).toEqual([])
    expect(split.settledTodayTotal).toBe(10)
    expect(split.unmanagedPaidTotal).toBe(5)
    expect(split.ownedIds).toEqual([])
  })
})
