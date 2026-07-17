'use client'
// Дашборд v2: общие константы и мелкие визуальные хелперы shell-страниц.
import { useEffect, useState } from 'react'
import { tCurrent } from '@/lib/i18n'
import { PLANS as PLAN_DEFS } from '@/lib/plans'
import { ACCENT_GLOW } from '@/components/brand'

export const APPS = [
  { id: 'manager',   name: 'Mise Manager',   desc: 'dash.appManagerDesc',   color: '#007aff', hint: 'dash.appManagerHint',   path: '/manager' },
  { id: 'analytics', name: 'Mise Analytics', desc: 'dash.appAnalyticsDesc', color: '#34c759', hint: 'dash.appAnalyticsHint', path: '/analytics' },
  { id: 'stash',     name: 'Mise Stash',     desc: 'dash.appStashDesc',     color: '#ff9500', hint: 'dash.appStashHint',     path: '/tobacco' },
  { id: 'people',    name: 'Mise People',    desc: 'dash.appPeopleDesc',    color: '#5856d6', hint: 'dash.appPeopleHint',    path: '/people' },
  { id: 'menu',      name: 'Mise Menu',      desc: 'dash.appMenuDesc',      color: '#ff2d55', hint: 'dash.appMenuHint',      path: '/dashboard/menu' },
]

// Цены/места — из lib/plans.ts (биллинг v2, единый источник с сервером);
// здесь только представление карточек.
export const PLANS = [
  { id: 'starter',  name: PLAN_DEFS.starter.name,  price: PLAN_DEFS.starter.price,  maxStaff: PLAN_DEFS.starter.seats,  color: PLAN_DEFS.starter.color, features: ['Mise Manager', 'Mise Analytics', 'dash.feat2users'] },
  { id: 'business', name: PLAN_DEFS.business.name, price: PLAN_DEFS.business.price, maxStaff: PLAN_DEFS.business.seats, color: PLAN_DEFS.business.color, popular: true, features: ['dash.featAllApps', 'dash.featQrGuests', 'dash.featUpTo5'] },
  { id: 'pro',      name: PLAN_DEFS.pro.name,      price: PLAN_DEFS.pro.price,      maxStaff: PLAN_DEFS.pro.seats,      color: PLAN_DEFS.pro.color, features: ['dash.featAllBusiness', 'dash.featAiAnalytics', 'dash.featUpTo10', 'dash.featIntegrations'] },
]

export const ROLE_OPTS = [
  { value: 'waiter', label: 'pe.roleWaiter' }, { value: 'kitchen', label: 'pe.roleKitchen' }, { value: 'bar', label: 'pe.roleBar' },
  { value: 'hookah', label: 'pe.roleHookah' }, { value: 'manager', label: 'pe.roleManager' }, { value: 'host', label: 'pe.roleHost' },
  { value: 'cleaner', label: 'pe.roleCleaner' }, { value: 'admin', label: 'pe.roleAdmin' },
]
export function roleLabel(role?: string) { return ROLE_OPTS.find(r => r.value === role)?.label || (role || '—') }

export function timeAgo(iso: string) {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  if (m < 1) return tCurrent('dash.justNow')
  if (m < 60) return tCurrent('dash.minAgo', { m })
  const h = Math.floor(m / 60)
  if (h < 24) return tCurrent('dash.hAgo', { h })
  const loc = tCurrent('dash.locale') || 'en'
  return new Date(iso).toLocaleDateString(loc, { day: 'numeric', month: 'short' })
}

// SF-Symbols-style line icons (no emoji): вкладки сервиса + модули сайдбара.
export function TabIcon({ id, size = 15 }: { id: string; size?: number }) {
  const p: any = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round', strokeLinejoin: 'round' }
  switch (id) {
    case 'overview':   return <svg {...p}><path d="M3 11l9-8 9 8"/><path d="M5 9.5V20a1 1 0 001 1h12a1 1 0 001-1V9.5"/></svg>
    case 'analytics':  return <svg {...p}><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>
    case 'stash':      return <svg {...p}><path d="M21 8l-9-5-9 5v8l9 5 9-5V8z"/><path d="M3 8l9 5 9-5M12 13v8"/></svg>
    case 'people':     return <svg {...p}><path d="M12 21s-7-5.5-7-11a7 7 0 0114 0c0 5.5-7 11-7 11z"/><circle cx="12" cy="10" r="2.6"/></svg>
    case 'menu':       return <svg {...p}><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><path d="M14 14h3v3h-3zM18 18h3v3h-3z"/></svg>
    case 'shifts':     return <svg {...p}><rect x="2" y="7" width="20" height="14" rx="2.5"/><path d="M2 11h20"/><path d="M8 3v6M16 3v6"/></svg>
    case 'bookings':   return <svg {...p}><path d="M12 21s-7-5.5-7-11a7 7 0 0114 0c0 5.5-7 11-7 11z"/><path d="M9.5 10.5l1.8 1.8 3.2-3.6"/></svg>
    case 'news':       return <svg {...p}><path d="M4 4h13a2 2 0 012 2v13a1 1 0 01-1.7.7L14 16H6a2 2 0 01-2-2V4z"/><path d="M7 8h7M7 11.5h5"/></svg>
    case 'team':       return <svg {...p}><circle cx="9" cy="8" r="3.2"/><path d="M3.5 20c0-3.3 2.5-5.5 5.5-5.5s5.5 2.2 5.5 5.5"/><path d="M16 4.2a3.2 3.2 0 010 6.1M19.5 20c0-2.6-1.3-4.5-3.3-5.2"/></svg>
    case 'settings':   return <svg {...p}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" /></svg>
    case 'billing':    return <svg {...p}><rect x="2" y="5" width="20" height="14" rx="2.5"/><path d="M2 10h20"/></svg>
    case 'notifications': return <svg {...p}><path d="M18 8.4a6 6 0 10-12 0c0 6.6-2.7 8.6-2.7 8.6h17.4S18 15 18 8.4"/><path d="M13.7 21a2 2 0 01-3.4 0"/></svg>
    case 'account':    return <svg {...p}><circle cx="12" cy="8" r="3.6"/><path d="M5 20c0-3.9 3.1-6.4 7-6.4s7 2.5 7 6.4"/></svg>
    case 'lock':       return <svg {...p}><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 018 0v4"/></svg>
    case 'more':       return <svg {...p}><circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/></svg>
    default:           return null
  }
}

// ── SPLASH SCREEN ─────────────────────────────────────────────────────────────
// Apple-style: типографический логотип «mise» собирается по буквам (blur→резкость,
// подъём, проявление), акцентная «e» подсвечивается мягким свечением, затем весь
// знак чуть приближается и экран растворяется.
export function SplashScreen({ onDone }: { onDone: () => void }) {
  const [out, setOut] = useState(false)
  const letters = ['m', 'i', 's', 'e']

  useEffect(() => {
    const tOut = setTimeout(() => setOut(true), 1550)
    const tDone = setTimeout(() => onDone(), 2050)
    return () => { clearTimeout(tOut); clearTimeout(tDone) }
  }, [])

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999, background: 'var(--bg)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
      transition: 'opacity .5s cubic-bezier(.4,0,.2,1), transform .5s cubic-bezier(.4,0,.2,1)',
      opacity: out ? 0 : 1, transform: out ? 'scale(1.08)' : 'scale(1)',
      pointerEvents: out ? 'none' : 'auto',
    }}>
      <style>{`
        @keyframes splashLetter {
          0%   { opacity: 0; transform: translateY(14px) scale(.94); filter: blur(10px); }
          60%  { opacity: 1; filter: blur(0); }
          100% { opacity: 1; transform: translateY(0) scale(1); filter: blur(0); }
        }
        @keyframes splashGlow {
          0%   { opacity: 0; transform: translate(-50%,-50%) scale(.6); }
          100% { opacity: .9; transform: translate(-50%,-50%) scale(1); }
        }
        @keyframes splashLift {
          0%   { letter-spacing: .04em; }
          100% { letter-spacing: -.05em; }
        }
      `}</style>

      <div style={{
        position: 'absolute', top: '50%', left: '50%', width: 320, height: 320, borderRadius: '50%',
        background: `radial-gradient(circle, ${ACCENT_GLOW} 0%, transparent 65%)`,
        animation: 'splashGlow 1.2s cubic-bezier(.22,1,.36,1) .35s both', pointerEvents: 'none',
      }} />

      <div style={{
        position: 'relative', display: 'flex', fontWeight: 800, fontSize: 'clamp(2.4rem,9vw,3.4rem)',
        fontFamily: "-apple-system,BlinkMacSystemFont,'SF Pro Display',sans-serif",
        animation: 'splashLift 1.4s cubic-bezier(.22,1,.36,1) both',
      }}>
        {letters.map((ch, i) => (
          <span key={i} style={{
            color: ch === 'e' ? '#8e8e93' : 'var(--tx)',
            display: 'inline-block',
            animation: `splashLetter .7s cubic-bezier(.22,1,.36,1) ${i * 0.09}s both`,
            textShadow: ch === 'e' ? `0 0 24px ${ACCENT_GLOW}` : 'none',
          }}>{ch}</span>
        ))}
      </div>
    </div>
  )
}
