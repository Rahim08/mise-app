/** Stable tenant-scoped keys come from bookings.guest_key after the additive migration. */
export type BookingIdentity = {
  id: string; guest_key?: string | null; phone?: string | null; guest_name?: string | null
  booking_date?: string | null; status?: string | null
}
export const fullPhoneDigits = (value?: string | null): string => (value || '').replace(/[^0-9]/g, '')
export function bookingGuestKey(booking: BookingIdentity): string {
  if (booking.guest_key?.trim()) return booking.guest_key.trim()
  const phone = fullPhoneDigits(booking.phone)
  return phone ? `phone:${phone}` : `booking:${booking.id}`
}
/** Preserve historical non-cancelled records; today's pending reservations are not visits yet. */
export function isBookingVisit(booking: BookingIdentity, today: string): boolean {
  const day = booking.booking_date
  return !!day && day <= today && booking.status !== 'cancelled' && booking.status !== 'no_show'
    && (day < today || booking.status === 'arrived')
}
export type BookingHistoryCursor = { p_limit: number; p_after_date?: string; p_after_id?: string }
export async function loadBookingHistory<T extends BookingIdentity>(
  fetchPage: (args: BookingHistoryCursor) => PromiseLike<{ data: T[] | null; error?: { message?: string } | null }>,
): Promise<T[]> {
  const rows = new Map<string, T>()
  const cursors = new Set<string>()
  let args: BookingHistoryCursor = { p_limit: 500 }
  for (;;) {
    const result = await fetchPage(args)
    if (result.error || !Array.isArray(result.data)) throw new Error(result.error?.message || 'booking_history_load_failed')
    for (const row of result.data) rows.set(row.id, row)
    if (result.data.length < 500) return [...rows.values()]
    const last = result.data[result.data.length - 1]
    if (!last.id || !last.booking_date) throw new Error('booking_history_cursor_invalid')
    const cursor = JSON.stringify([last.booking_date, last.id])
    if (cursors.has(cursor)) throw new Error('booking_history_cursor_repeated')
    cursors.add(cursor)
    args = { p_limit: 500, p_after_date: last.booking_date, p_after_id: last.id }
  }
}
