// Shared formatting helpers — single source of truth for date/number display.
// Imported by manager, analytics, people, tobacco, dashboard, cron pages.

/** Local calendar date YYYY-MM-DD (avoids toISOString timezone shift). */
export function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * "Today" of the venue's operating day — before day_start_hour it's still yesterday's
 * business day (a venue open past midnight). Port of AppModel.businessDate (iOS,
 * AppModel.swift) — web had no equivalent at all (MISE-003, full-system audit
 * 2026-08-28): a manager active after midnight saw a different "today" on web than on
 * iOS, and since shifts is unique on (restaurant_id, date), one operating night could
 * split into two shift rows depending on which client was used.
 */
export function businessDate(dayStartHour: number, now: Date = new Date()): Date {
  if (now.getHours() < dayStartHour) {
    const d = new Date(now)
    d.setDate(d.getDate() - 1)
    return d
  }
  return now
}

/** Format number with 2 decimal places (de-DE locale: 1.234,56). */
export function fv(v: number): string {
  return v.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** Short date display: DD.MM.YYYY */
export function displayDate(d: Date): string {
  return String(d.getDate()).padStart(2, '0') + '.' + String(d.getMonth() + 1).padStart(2, '0') + '.' + d.getFullYear()
}

/** Short day display: DD.MM from ISO string */
export function dd(s: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s ?? '')
  return m ? `${m[3]}.${m[2]}` : ''
}

/**
 * inkassations.reason stores internal tags like "Имя аванс·1fb7c57c" — the id suffix
 * only exists so tabs-salary.tsx deleteAdvance can target the exact advance without
 * erasing another same-name advance from the same day. Strip it for user display.
 */
export function displayReason(raw: string): string {
  return raw
    .split(', ')
    .map((part) => part.replace(/·[0-9a-f]{6,}$/i, ''))
    .join(', ')
}
