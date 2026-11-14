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

  // Compact bar: one row on wide screens, so it never sits on top of the hero CTAs;
  // on phones text + nowrap buttons stack in a short card above the safe area.
  return (
    <div role="dialog" aria-label="Cookie consent" className="mise-cookie">
      <style>{`
        @keyframes miseCookieUp{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}
        .mise-cookie{position:fixed;left:12px;right:12px;bottom:calc(12px + env(safe-area-inset-bottom));z-index:9999;
          margin:0 auto;max-width:680px;background:rgba(28,28,30,.94);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);
          color:#fff;border-radius:16px;padding:10px 10px 10px 16px;box-shadow:0 12px 48px rgba(0,0,0,.32);
          display:flex;align-items:center;gap:12px;font-family:-apple-system,BlinkMacSystemFont,system-ui,sans-serif;
          animation:miseCookieUp .32s cubic-bezier(.16,1,.3,1)}
        .mise-cookie p{margin:0;flex:1;font-size:.8rem;line-height:1.4;color:rgba(255,255,255,.82)}
        .mise-cookie a{color:#0a84ff;text-decoration:none;font-weight:600}
        .mise-cookie .btns{display:flex;gap:6px;flex:none}
        .mise-cookie button{padding:8px 14px;border-radius:10px;cursor:pointer;font-size:.8rem;font-family:inherit;white-space:nowrap}
        .mise-cookie .ess{border:1px solid rgba(255,255,255,.18);background:transparent;color:#fff;font-weight:600}
        .mise-cookie .all{border:none;background:#fff;color:#1c1c1e;font-weight:700}
        @media (max-width:560px){
          .mise-cookie{flex-direction:column;align-items:stretch;gap:10px;padding:12px}
          .mise-cookie .btns button{flex:1}
        }
        @media (prefers-reduced-motion:reduce){.mise-cookie{animation:none}}
      `}</style>
      <p>
        {t('cookie.text')}{' '}
        <a href="/privacy.html" target="_blank" rel="noopener noreferrer">{t('cookie.privacy')}</a>
      </p>
      <div className="btns">
        <button className="ess" onClick={() => choose('essential')}>{t('cookie.decline')}</button>
        <button className="all" onClick={() => choose('all')}>{t('cookie.accept')}</button>
      </div>
    </div>
  )
}
