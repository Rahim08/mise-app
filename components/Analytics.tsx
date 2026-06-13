'use client'
// Mounts PostHog (when configured + consented) and sends a pageview on every route change.
// Dormant until NEXT_PUBLIC_POSTHOG_KEY is set and the user accepts analytics cookies.
import { useEffect } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { initAnalytics, capturePageview } from '@/lib/analytics'

export function Analytics() {
  const pathname = usePathname()
  const search = useSearchParams()

  // Start as soon as consent is given (CookieConsent dispatches this on "Accept").
  useEffect(() => {
    initAnalytics()
    const onConsent = () => initAnalytics()
    window.addEventListener('mise:analytics-consent', onConsent)
    return () => window.removeEventListener('mise:analytics-consent', onConsent)
  }, [])

  // Pageview on navigation (App Router gives no native page events).
  useEffect(() => {
    const qs = search?.toString()
    capturePageview(pathname + (qs ? `?${qs}` : ''))
  }, [pathname, search])

  return null
}
