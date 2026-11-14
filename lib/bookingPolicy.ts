import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { entitlements, isActiveStatus } from '@/lib/plans'
import { isOfficial, type Caller } from '@/lib/apiAuth'

export class BookingPolicyError extends Error {
  constructor(message: string, public status = 400) { super(message) }
}
export const BOOKING_APPS = ['manager', 'analytics', 'stash', 'people'] as const
export const BOOKING_STATUSES = new Set(['new', 'confirmed', 'arrived', 'cancelled', 'no_show', 'late'])
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const GUEST_KEY_RE = /^g:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const bookingAuthor = (caller: Caller) => caller.owner ? 'owner' : caller.sid
const own = (object: object, key: string) => Object.prototype.hasOwnProperty.call(object,key)
export function validBookingDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return false
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0,10) === value
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BookingPolicyError('Invalid booking payload')
  return value as Record<string,unknown>
}
function optionalText(value: unknown, max: number): string | null {
  if (value == null || value === '') return null
  if (typeof value !== 'string' || value.length > max) throw new BookingPolicyError('Invalid booking text')
  return value.trim() || null
}
export function validateBookingValues(input: unknown, create: boolean): Record<string,unknown> {
  const row = record(input)
  const result: Record<string,unknown> = {}
  const metadata = new Set(['id','restaurant_id','created_by','created_by_name','created_at','updated_at','notification_claimed_at'])
  const textLimits: Record<string,number> = {guest_name:200,phone:80,table_label:80,note:4000}
  for (const [key,value] of Object.entries(row)) {
    if (metadata.has(key)) continue
    if (own(textLimits,key)) result[key] = optionalText(value,textLimits[key])
    else if (key === 'booking_date') {
      if (!validBookingDate(value)) throw new BookingPolicyError('Invalid booking date')
      result[key] = value
    } else if (key === 'booking_time') {
      if (value != null && value !== '' && (typeof value !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value))) throw new BookingPolicyError('Invalid booking time')
      result[key] = value || null
    } else if (key === 'guests_count') {
      if (value != null && (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 2147483647)) throw new BookingPolicyError('Invalid guest count')
      result[key] = value ?? null
    } else if (key === 'status') {
      if (value != null && (typeof value !== 'string' || !BOOKING_STATUSES.has(value))) throw new BookingPolicyError('Invalid booking status')
      result[key] = value ?? 'new'
    } else if (key === 'guest_key') {
      if (create && value != null) {
        if (typeof value !== 'string' || !GUEST_KEY_RE.test(value)) throw new BookingPolicyError('Invalid guest identity')
        result[key] = value.toLowerCase()
      } // Existing guest identity never changes when editing a booking's contacts.
    } else throw new BookingPolicyError('Unknown booking field')
  }
  if (create) {
    if (row.id != null && (typeof row.id !== 'string' || !UUID_RE.test(row.id))) throw new BookingPolicyError('Invalid booking ID')
    if (!own(result,'booking_date')) throw new BookingPolicyError('Booking date is required')
    result.id = typeof row.id === 'string' ? row.id.toLowerCase() : randomUUID()
    for (const key of ['booking_time','guest_name','guests_count','phone','table_label','note']) if (!own(result,key)) result[key] = null
    result.status ??= 'new'
  } else {
    if (!Object.keys(result).length) throw new BookingPolicyError('No editable booking fields')
    result.updated_at = new Date().toISOString()
  }
  return result
}
export function validateGuestProfile(input: unknown): Record<string,unknown> {
  const row = record(input), result: Record<string,unknown> = {}
  for (const [key,value] of Object.entries(row)) {
    if (key === 'note' || key === 'last_name' || key === 'email') {
      const text = optionalText(value,key === 'note' ? 4000 : key === 'email' ? 254 : 200)
      if (key === 'email' && text && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) throw new BookingPolicyError('Invalid email')
      result[key] = key === 'note' ? text ?? '' : text
    } else if (key === 'birthday') {
      if (value != null && value !== '' && !validBookingDate(value)) throw new BookingPolicyError('Invalid birthday')
      result[key] = value || null
    } else throw new BookingPolicyError('Unknown guest profile field')
  }
  return result
}
export async function requireBookingAccess(admin: Pick<SupabaseClient, 'from'>, caller: Caller): Promise<void> {
  if (!caller.owner && !BOOKING_APPS.some(app=>caller.apps.includes(app))) throw new BookingPolicyError('Forbidden',403)
  const {data,error} = await admin.from('restaurants').select('subscription_plan, subscription_status, addon_modules, comp_apps').eq('id',caller.rid).single()
  if (error || !data) throw new BookingPolicyError('Booking availability could not be verified',503)
  if (!isActiveStatus(data.subscription_status) || !entitlements(data).modules.includes('bookings')) throw new BookingPolicyError('Booking is not included in this subscription',403)
}
export async function requireGuestAuthor(admin: Pick<SupabaseClient, 'from'>, caller: Caller, key: string): Promise<void> {
  if (!GUEST_KEY_RE.test(key)) throw new BookingPolicyError('Invalid guest identity')
  const base = () => admin.from('bookings').select('id').eq('restaurant_id',caller.rid).eq('guest_key',key)
  const {data,error} = await base().limit(1)
  if (error) throw new BookingPolicyError('Guest access could not be verified',503)
  if (!data?.length) throw new BookingPolicyError('Guest not found',404)
  if (await isOfficial(admin,caller)) return
  const author = bookingAuthor(caller)
  if (!author) throw new BookingPolicyError('Forbidden',403)
  const {data:foreign,error:authorError} = await base().or(`created_by.is.null,created_by.neq.${author}`).limit(1)
  if (authorError) throw new BookingPolicyError('Guest access could not be verified',503)
  if (foreign?.length) throw new BookingPolicyError('Forbidden',403)
}

/** Idempotency compares only the submitted domain payload, never generated identity/time metadata. */
export function sameBookingCreate(existing: Record<string,unknown>, desired: Record<string,unknown>): boolean {
  return existing.created_by === desired.created_by && Object.entries(desired).every(([key,value]) =>
    ['restaurant_id','id','created_by_name'].includes(key) || (existing[key] ?? null) === value)
}
