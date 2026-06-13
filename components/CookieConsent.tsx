'use client'
// GDPR cookie consent — required for the EU market (Italy is a target).
//
// Minimal and honest: the app only uses first-party cookies that are strictly necessary
// (auth session, staff token, language). "Accept" also opts into product analytics once
// that's wired (PostHog). Choice persists in localStorage; no banner inside the native
// Capacitor app (no browser cookies there).
import { useEffect, useState } from 'react'
import { useI18n } from '@/lib/i18n'
import { stopAnalytics } from '@/lib/analytics'

const LS_KEY = 'mise_cookie_consent'

// Lets any "Cookie settings" link re-open the banner so users can withdraw consent (GDPR).
export function openCookieSettings() {
  window.dispatchEvent(new CustomEvent('mise:open-cookie-settings'))
}

export function CookieConsent() {
  const { t } = useI18n()
  const [show, setShow] = useState(false)

  useEffect(() => {
    // Native app: no cookie banner.
    if (typeof window !== 'undefined' && (window as any).Capacitor?.isNativePlatform?.()) return
    try {
      if (!localStorage.getItem(LS_KEY)) setShow(true)
    } catch { /* private mode */ }
    const reopen = () => setShow(true)
    window.addEventListener('mise:open-cookie-settings', reopen)
    return () => window.removeEventListener('mise:open-cookie-settings', reopen)
  }, [])

  const choose = (v: 'all' | 'essential') => {
    try { localStorage.setItem(LS_KEY, v) } catch {}
    if (v === 'all') window.dispatchEvent(new CustomEvent('mise:analytics-consent'))
    else stopAnalytics() // withdrawn / declined → stop collection immediately
    setShow(false)
  }

  if (!show) return null

  return (
    <div
      role="dialog"
      aria-label="Cookie consent"
      style={{
        position: 'fixed', left: 16, right: 16, bottom: 16, zIndex: 9999,
        margin: '0 auto', maxWidth: 520,
        background: 'rgba(28,28,30,.92)', backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)', color: '#fff',
        borderRadius: 18, padding: '16px 18px',
        boxShadow: '0 12px 48px rgba(0,0,0,.32)',
        display: 'flex', flexDirection: 'column', gap: 12,
        fontFamily: '-apple-system,BlinkMacSystemFont,system-ui,sans-serif',
        animation: 'miseCookieUp .32s cubic-bezier(.16,1,.3,1)',
      }}
    >
      <style>{`@keyframes miseCookieUp{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}`}</style>
      <p style={{ margin: 0, fontSize: '.86rem', lineHeight: 1.5, color: 'rgba(255,255,255,.82)' }}>
        {t('cookie.text')}{' '}
        <a href="/privacy.html" target="_blank" rel="noopener noreferrer" style={{ color: '#0a84ff', textDecoration: 'none', fontWeight: 600 }}>
          {t('cookie.privacy')}
        </a>
      </p>
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={() => choose('essential')}
          style={{
            flex: 1, padding: '10px 14px', borderRadius: 12, cursor: 'pointer',
            border: '1px solid rgba(255,255,255,.18)', background: 'transparent',
            color: '#fff', fontSize: '.85rem', fontWeight: 600, fontFamily: 'inherit',
          }}
        >
          {t('cookie.decline')}
        </button>
        <button
          onClick={() => choose('all')}
          style={{
            flex: 1, padding: '10px 14px', borderRadius: 12, cursor: 'pointer',
            border: 'none', background: '#fff', color: '#1c1c1e',
            fontSize: '.85rem', fontWeight: 700, fontFamily: 'inherit',
          }}
        >
          {t('cookie.accept')}
        </button>
      </div>
    </div>
  )
}
