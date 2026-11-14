// «Сегодня» и гео-явка для People (аудит People 2026-11-14, пакет B).
import { businessDate, fmtDate } from '@/lib/format'

type Settings = { attendance_enabled?: boolean | null; latitude?: unknown; longitude?: unknown; day_start_hour?: number | null } | null | undefined

/**
 * Гео-явка реально работает, только если она включена И задана точка заведения.
 * «Включено, но адреса нет» раньше трактовалось как включённое: на вебе явку нельзя было
 * отметить вообще, а чек-лист требовал отметку — сотрудники SO не могли заполнить ни пункта.
 */
export function geoActive(s: Settings): boolean {
  return !!s?.attendance_enabled && s?.latitude != null && s?.longitude != null
}

/** Включено, но адреса нет — показываем владельцу/менеджеру, что проверка места не идёт. */
export function geoMissingAddress(s: Settings): boolean {
  return !!s?.attendance_enabled && (s?.latitude == null || s?.longitude == null)
}

/**
 * Рабочий день заведения: до day_start_hour (по умолчанию 6) — ещё вчерашняя смена.
 * Тот же день, что у кассовой смены в Manager (shifts.date), иначе после полуночи чек-лист
 * закрытия, явка и график искались на «завтра».
 */
export function peopleToday(s: Settings, now: Date = new Date()): string {
  return fmtDate(businessDate(typeof s?.day_start_hour === 'number' ? s.day_start_hour : 6, now))
}
