import { describe, it, expect } from 'vitest'
import { dd } from './format'

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
