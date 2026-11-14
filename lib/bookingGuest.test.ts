import { describe, expect, it } from 'vitest'
import { bookingGuestKey, fullPhoneDigits, isBookingVisit, loadBookingHistory } from './bookingGuest'

describe('booking guest identity and visit semantics', () => {
  it('keeps distinct international numbers distinct and prefers stable identity after phone edits', () => {
    expect(bookingGuestKey({ id: 'a', phone: '+41791234567' })).not.toBe(bookingGuestKey({ id: 'b', phone: '+393791234567' }))
    expect(bookingGuestKey({ id: 'a', guest_key: 'g:stable', phone: '111' })).toBe(bookingGuestKey({ id: 'a', guest_key: 'g:stable', phone: '222' }))
    expect(fullPhoneDigits('+41 (79) 123-45-67')).toBe('41791234567')
  })
  it('does not merge unrelated phoneless guests by common name', () => {
    expect(bookingGuestKey({ id: 'a', guest_name: 'Alex' })).not.toBe(bookingGuestKey({ id: 'b', guest_name: 'Alex' }))
  })
  it('excludes future/cancelled visits and counts today only on arrival', () => {
    expect(isBookingVisit({ id: 'a', booking_date: '2099-01-01', status: 'arrived' }, '2026-11-13')).toBe(false)
    expect(isBookingVisit({ id: 'b', booking_date: '2026-11-13', status: 'new' }, '2026-11-13')).toBe(false)
    expect(isBookingVisit({ id: 'c', booking_date: '2026-11-13', status: 'arrived' }, '2026-11-13')).toBe(true)
    expect(isBookingVisit({ id: 'd', booking_date: '2026-11-12', status: 'new' }, '2026-11-13')).toBe(true)
    expect(isBookingVisit({ id: 'e', booking_date: '2026-11-12', status: 'cancelled' }, '2026-11-13')).toBe(false)
  })
})

describe('complete booking history paging', () => {
  const page = Array.from({ length: 500 }, (_, i) => ({ id: `id-${i}`, booking_date: '2026-11-13' }))
  it('loads beyond the first page and deduplicates repeated IDs', async () => {
    const calls: unknown[] = []
    const rows = await loadBookingHistory(async args => {
      calls.push(args)
      return { data: calls.length === 1 ? page : [{ ...page[499] }, { id: 'older', booking_date: '2020-01-01' }], error: null }
    })
    expect(rows).toHaveLength(501)
    expect(calls).toEqual([{ p_limit: 500 }, { p_limit: 500, p_after_date: '2026-11-13', p_after_id: 'id-499' }])
  })
  it('does not silently present partial data when a later page fails', async () => {
    let calls = 0
    await expect(loadBookingHistory(async () => ++calls === 1 ? { data: page } : { data: null, error: { message: 'offline' } })).rejects.toThrow('offline')
  })
  it('stops a broken server repeating the same full page', async () => {
    await expect(loadBookingHistory(async () => ({ data: page }))).rejects.toThrow('cursor')
  })
})
