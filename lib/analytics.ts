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
