// Серверный расчёт отметки прихода (аудит People 2026-11-14, К3).
// Раньше время прихода, статус и опоздание присылал клиент как есть — через шлюз /api/db
// сотрудник мог записать себе «пришёл вовремя» задним числом. Теперь клиент присылает только
// факт (дату, время для офлайн-досылки, координаты), а опоздание/статус/дистанцию считает сервер
// по графику и таймзоне заведения.

export class AttendanceError extends Error {
  status: number
  constructor(message: string, status = 400) { super(message); this.status = status }
}

export type AttendanceSettings = {
  timezone?: string | null
  late_grace_min?: number | null
  attendance_enabled?: boolean | null
  latitude?: number | string | null
  longitude?: number | string | null
  geo_radius_m?: number | null
}

/** Офлайн-приход досылается позже; дальше этого окна — не принимаем. */
export const OFFLINE_WINDOW_MS = 12 * 3600_000
/** Расхождение часов устройства и сервера, которое считаем «сейчас». */
const CLOCK_SKEW_MS = 2 * 60_000

/** Календарная дата YYYY-MM-DD момента `at` в таймзоне `tz`. */
export function localDateKey(at: Date, tz?: string | null): string {
  try {
    const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(at)
    const g = (t: string) => p.find(x => x.type === t)?.value || ''
    return `${g('year')}-${g('month')}-${g('day')}`
  } catch { return at.toISOString().slice(0, 10) }
}

function prevDayKey(key: string): string {
  const d = new Date(`${key}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

/** UTC-момент для локального времени `hm` даты `dateKey` в таймзоне `tz` (с учётом DST). */
export function zonedToUtc(dateKey: string, hm: string, tz?: string | null): Date {
  const [y, mo, d] = dateKey.split('-').map(Number)
  const [h, mi] = hm.split(':').map(Number)
  const wall = Date.UTC(y, mo - 1, d, h || 0, mi || 0)
  const offsetAt = (ms: number) => {
    try {
      const p = new Intl.DateTimeFormat('en-CA', {
        timeZone: tz || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
      }).formatToParts(new Date(ms))
      const g = (t: string) => Number(p.find(x => x.type === t)?.value || 0)
      return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute')) - ms
    } catch { return 0 }
  }
  let utc = wall - offsetAt(wall)
  utc = wall - offsetAt(utc) // вторая итерация — для перехода на летнее/зимнее время
  return new Date(utc)
}

function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000, rad = Math.PI / 180
  const dLat = (lat2 - lat1) * rad, dLng = (lng2 - lng1) * rad
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}

/**
 * Собирает строку attendance_records для отметки прихода сотрудника.
 * `schedule` — его смена в графике на `input.date` (или null).
 */
export function buildCheckIn(args: {
  input: any; staffId: string; now: Date; settings: AttendanceSettings | null
  schedule: { shift_start?: string | null; id?: string | null } | null
}): Record<string, any> {
  const { input, staffId, now, settings, schedule } = args
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new AttendanceError('Invalid attendance')
  const tz = settings?.timezone || 'UTC'

  // Время прихода: «сейчас», либо время из офлайн-очереди (не из будущего, не старше окна).
  let at = now
  let offline = false
  if (input.check_in_at != null) {
    const parsed = new Date(input.check_in_at)
    if (Number.isNaN(parsed.getTime())) throw new AttendanceError('Invalid check-in time')
    if (parsed.getTime() > now.getTime() + CLOCK_SKEW_MS) at = now
    else if (parsed.getTime() < now.getTime() - OFFLINE_WINDOW_MS) throw new AttendanceError('Check-in is too old')
    else if (parsed.getTime() < now.getTime() - CLOCK_SKEW_MS) { at = parsed; offline = true }
  }

  // Дата смены: день прихода по часам заведения, либо предыдущий (ночная смена после полуночи).
  const localDay = localDateKey(at, tz)
  const date = typeof input.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input.date) ? input.date : localDay
  if (date !== localDay && date !== prevDayKey(localDay)) throw new AttendanceError('Invalid attendance date')

  // Гео: если у заведения задана точка и клиент прислал координаты — проверяем радиус сами.
  // Без координат (старые iOS-сборки их не шлют) запись принимается без дистанции.
  let distance: number | null = null
  const lat = num(input.check_in_lat), lng = num(input.check_in_lng)
  const venueLat = num(settings?.latitude), venueLng = num(settings?.longitude)
  if (settings?.attendance_enabled && venueLat != null && venueLng != null && lat != null && lng != null) {
    distance = Math.round(haversineM(lat, lng, venueLat, venueLng))
    if (distance > (settings.geo_radius_m || 150)) throw new AttendanceError('Out of zone', 403)
  }

  // Опоздание — от начала смены по графику в таймзоне заведения.
  const grace = settings?.late_grace_min ?? 5
  let late: number | null = null
  let status = 'present'
  const start = schedule?.shift_start
  if (start && /^\d{1,2}:\d{2}/.test(start)) {
    late = Math.max(0, Math.round((at.getTime() - zonedToUtc(date, start.slice(0, 5), tz).getTime()) / 60000))
    status = late > grace ? 'late' : 'present'
  }

  return {
    staff_id: staffId,
    date,
    schedule_id: schedule?.id ?? null,
    check_in_at: at.toISOString(),
    check_in_lat: lat,
    check_in_lng: lng,
    check_in_distance_m: distance,
    late_minutes: late,
    status,
    // CHECK в БД допускает только geo/manual; офлайн-досылка (время из прошлого) — manual.
    source: !offline && lat != null && lng != null ? 'geo' : 'manual',
  }
}
