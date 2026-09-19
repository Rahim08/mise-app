import { describe, it, expect } from 'vitest'
import { dd, businessDate, fmtDate } from './format'

describe('dd', () => {
  it('formats an ISO date string to DD.MM', () => {
    expect(dd('2026-07-08T00:00:00')).toBe('08.07')
    expect(dd('2026-07-08')).toBe('08.07')
  })

  it('returns empty string for null/undefined', () => {
    expect(dd(null)).toBe('')
    expect(dd(undefined)).toBe('')
  })

  it('returns empty string for malformed input', () => {
    expect(dd('garbage')).toBe('')
    expect(dd('')).toBe('')
  })
})

// MISE-003 (full-system audit 2026-08-28) — web had no day_start_hour concept at all;
// businessDate ports AppModel.businessDate (iOS) so both clients agree on "today" for a
// venue open past midnight, avoiding a split shifts row (unique on restaurant_id, date).
describe('businessDate', () => {
  it('stays on the same calendar day at/after day_start_hour', () => {
    const now = new Date(2026, 6, 15, 6, 0, 0) // 2026-07-15 06:00
    expect(fmtDate(businessDate(6, now))).toBe('2026-07-15')
  })

  it('rolls back to the previous day before day_start_hour (venue open past midnight)', () => {
    const now = new Date(2026, 6, 15, 2, 30, 0) // 2026-07-15 02:30
    expect(fmtDate(businessDate(6, now))).toBe('2026-07-14')
  })

  it('handles a month boundary correctly when rolling back', () => {
    const now = new Date(2026, 7, 1, 1, 0, 0) // 2026-08-01 01:00
    expect(fmtDate(businessDate(6, now))).toBe('2026-07-31')
  })

  it('with day_start_hour=0, never rolls back (every hour is "after" start)', () => {
    const now = new Date(2026, 6, 15, 0, 30, 0)
    expect(fmtDate(businessDate(0, now))).toBe('2026-07-15')
  })
})
