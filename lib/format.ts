// Shared formatting helpers — single source of truth for date/number display.
// Imported by manager, analytics, people, tobacco, dashboard, cron pages.

/** Local calendar date YYYY-MM-DD (avoids toISOString timezone shift). */
export function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
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
