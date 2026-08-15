// Product analytics (PostHog) — privacy-first.
//
// Activates ONLY when both are true:
//   • NEXT_PUBLIC_POSTHOG_KEY is set (otherwise dormant, like lib/email.ts)
//   • the user accepted analytics cookies (consent === 'all')
//
// Defaults to the PostHog EU cloud for GDPR. posthog-js is loaded via dynamic import,
// so it stays out of the main bundle until analytics actually starts.

let started = false
let ph: any = null

const KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY
const HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://eu.i.posthog.com'

export function hasAnalyticsConsent(): boolean {
  try { return localStorage.getItem('mise_cookie_consent') === 'all' } catch { return false }
}

export async function initAnalytics(): Promise<void> {
  if (started || typeof window === 'undefined') return
  if (!KEY || !hasAnalyticsConsent()) return
  started = true
  try {
    const mod = await import('posthog-js')
    ph = mod.default
    ph.init(KEY, {
      api_host: HOST,
      capture_pageview: false,   // we send pageviews manually on route change
      persistence: 'localStorage', // no extra cookies beyond what we disclosed
      autocapture: false,          // explicit events only — predictable, privacy-friendly
    })
  } catch {
    started = false // allow a later retry
  }
}

export function capturePageview(path: string): void {
  if (!ph) return
  ph.capture('$pageview', { $current_url: path })
}

export function track(event: string, props?: Record<string, any>): void {
  if (!ph) return
  ph.capture(event, props)
}

// Called when the user withdraws consent — stop collection and clear local state.
export function stopAnalytics(): void {
  try { ph?.opt_out_capturing?.() } catch {}
  try { ph?.reset?.() } catch {}
  ph = null
  started = false
}

// C3 (аудит 2026-08-15): единая формула «начислено на сегодня» для Manager→Зарплата и
// Analytics→Инкассация — раньше расходились (линейная рампа над daysInMonth+payoutDay в
// Manager vs payout-day-цикл в Analytics), одна и та же ЗП на один день показывала разный
// % начисления на двух экранах (до ~17 п.п.). Канон — цикл, привязанный к payout_day:
// с payout_day этого месяца стартует новый цикл (копит на ЗП текущего месяца, выплата — в
// следующем на payout_day); до payout_day идёт дособор на прошлый месяц (выплата — в этом
// месяце на payout_day). Без настройки payout_day — обычный календарный месяц.
export function computeAccruedToday(params: {
  isCurrentMonth: boolean
  totalCash: number
  daysInMonth: number
  payoutDay: number | null
  prevTotalCash: number
  prevDaysInMonth: number
  today?: Date
}): number {
  const { isCurrentMonth, totalCash, daysInMonth, payoutDay, prevTotalCash, prevDaysInMonth } = params
  if (!isCurrentMonth) return totalCash
  const now = params.today || new Date()
  const cycleStart = payoutDay || 1
  const day = now.getDate()
  if (day >= cycleStart) {
    return Math.max(0, totalCash / daysInMonth * (day - cycleStart + 1))
  }
  return Math.max(0, prevTotalCash / prevDaysInMonth * (prevDaysInMonth - cycleStart + day + 1))
}
