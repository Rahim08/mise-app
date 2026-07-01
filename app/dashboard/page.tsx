'use client'
import { useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { db } from '@/lib/db'
import { QRCodeSVG as QRCode } from 'qrcode.react'
import { useTheme } from '@/hooks/useTheme'
import { AppIcon, Wordmark, WordmarkMark, ACCENT_GLOW, type BrandApp } from '@/components/brand'
import { track } from '@/lib/analytics'
import { openCookieSettings } from '@/components/CookieConsent'
import { fmtDate as fmtDay } from '@/lib/format'
import { useIsNative } from '@/lib/native'
import { useI18n, tCurrent } from '@/lib/i18n'



type Restaurant = {
  id: string; name: string; currency: string
  subscription_status: string; subscription_plan: string
  subscription_ends_at: string; stripe_customer_id?: string
  logo_url?: string; owner_pin?: string
}

const APPS = [
  { id: 'manager',   name: 'Mise Manager',   desc: 'dash.appManagerDesc',             color: '#007aff', hint: 'dash.appManagerHint', path: '/manager',        plans: ['starter','business','pro'] },
  { id: 'analytics', name: 'Mise Analytics', desc: 'dash.appAnalyticsDesc',                  color: '#34c759', hint: 'dash.appAnalyticsHint',  path: '/analytics',      plans: ['starter','business','pro'] },
  { id: 'stash',     name: 'Mise Stash',     desc: 'dash.appStashDesc',          color: '#ff9500', hint: 'dash.appStashHint', path: '/tobacco',        plans: ['business','pro'] },
  { id: 'people',    name: 'Mise People',    desc: 'dash.appPeopleDesc',         color: '#5856d6', hint: 'dash.appPeopleHint',    path: '/people',         plans: ['business','pro'] },
  { id: 'menu',      name: 'Mise Menu',      desc: 'dash.appMenuDesc',               color: '#ff2d55', hint: 'dash.appMenuHint',     path: '/dashboard/menu', plans: ['business','pro'] },
]


const PLANS = [
  // maxStaff = доступы сотрудников (устройства); лимит дублируется на сервере в /api/db (PLAN_LIMITS)
  { id: 'starter',  name: 'Starter',  price: 14, maxStaff: 2,  color: '#007aff', features: ['Mise Manager', 'Mise Analytics', 'dash.feat2users'] },
  { id: 'business', name: 'Business', price: 24, maxStaff: 5,  color: '#34c759', popular: true, features: ['dash.featAllApps', 'dash.featQrGuests', 'dash.featUpTo5'] },
  { id: 'pro',      name: 'Pro',      price: 39, maxStaff: 10, color: '#af52de', features: ['dash.featAllBusiness', 'dash.featAiAnalytics', 'dash.featUpTo10', 'dash.featIntegrations'] },
]

const ROLE_OPTS = [
  { value: 'waiter', label: 'pe.roleWaiter' }, { value: 'kitchen', label: 'pe.roleKitchen' }, { value: 'bar', label: 'pe.roleBar' },
  { value: 'hookah', label: 'pe.roleHookah' }, { value: 'manager', label: 'pe.roleManager' }, { value: 'host', label: 'pe.roleHost' },
  { value: 'cleaner', label: 'pe.roleCleaner' }, { value: 'admin', label: 'pe.roleAdmin' },
]
function roleLabel(role?: string) { return ROLE_OPTS.find(r => r.value === role)?.label || (role || '—') }

// Сайдбар, два этажа: верхний — «работа» (каждый день), нижний — «обслуживание» (раз в неделю/месяц).
// Аккаунт — отдельно внизу, категории расходов живут внутри Настроек.
const NAV_MAIN = [
  { id: 'overview', label: 'dash.navOverview' },
  { id: 'apps',     label: 'dash.navApps' },
  { id: 'team',     label: 'dash.navTeam' },
]
const NAV_SERVICE = [
  { id: 'notifications', label: 'dash.navNotifications' },
  { id: 'settings',      label: 'dash.navSettings' },
  { id: 'billing',       label: 'dash.navBilling' },
]

// SF-Symbols-style line icons for the dashboard tabs (no emoji).
function TabIcon({ id, size = 15 }: { id: string; size?: number }) {
  const p: any = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round', strokeLinejoin: 'round' }
  switch (id) {
    case 'apps':       return <svg {...p}><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>
    case 'employees':  return <svg {...p}><circle cx="9" cy="8" r="3.2"/><path d="M3.5 20c0-3.3 2.5-5.5 5.5-5.5s5.5 2.2 5.5 5.5"/><path d="M16 4.2a3.2 3.2 0 010 6.1M19.5 20c0-2.6-1.3-4.5-3.3-5.2"/></svg>
    case 'categories': return <svg {...p}><path d="M3 7a2 2 0 012-2h4l2 2.5h8A2 2 0 0121 9.5V17a2 2 0 01-2 2H5a2 2 0 01-2-2z"/></svg>
    case 'team':       return <svg {...p}><circle cx="9" cy="8" r="3.2"/><path d="M3.5 20c0-3.3 2.5-5.5 5.5-5.5s5.5 2.2 5.5 5.5"/><path d="M16 4.2a3.2 3.2 0 010 6.1M19.5 20c0-2.6-1.3-4.5-3.3-5.2"/></svg>
    case 'settings':   return <svg {...p}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" /></svg>
    case 'billing':    return <svg {...p}><rect x="2" y="5" width="20" height="14" rx="2.5"/><path d="M2 10h20"/></svg>
    case 'overview':   return <svg {...p}><path d="M3 11l9-8 9 8"/><path d="M5 9.5V20a1 1 0 001 1h12a1 1 0 001-1V9.5"/></svg>
    case 'notifications': return <svg {...p}><path d="M18 8.4a6 6 0 10-12 0c0 6.6-2.7 8.6-2.7 8.6h17.4S18 15 18 8.4"/><path d="M13.7 21a2 2 0 01-3.4 0"/></svg>
    case 'account':    return <svg {...p}><circle cx="12" cy="8" r="3.6"/><path d="M5 20c0-3.9 3.1-6.4 7-6.4s7 2.5 7 6.4"/></svg>
    default:           return null
  }
}

// Локальная дата YYYY-MM-DD — toISOString() сдвигает «сегодня» в не-UTC зонах
function timeAgo(iso: string) {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  if (m < 1) return tCurrent('dash.justNow')
  if (m < 60) return tCurrent('dash.minAgo', { m })
  const h = Math.floor(m / 60)
  if (h < 24) return tCurrent('dash.hAgo', { h })
  return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
}

// ── SPLASH SCREEN ─────────────────────────────────────────────────────────────

// Apple-style: типографический логотип «mise» собирается по буквам (blur→резкость,
// подъём, проявление), акцентная «e» подсвечивается мягким свечением, затем весь
// знак чуть приближается и экран растворяется. Никакой glyph-иконки — бренд типографический.
function SplashScreen({ onDone }: { onDone: () => void }) {
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

      {/* Акцентное свечение за словом */}
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

// ── UI PRIMITIVES ─────────────────────────────────────────────────────────────

// Branded loading spinner — replaces plain "Загрузка..." text for a calmer, Apple-like wait.
function Spinner({ label, compact }: { label?: string; compact?: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: compact ? 0 : 32 }}>
      <style>{`@keyframes miseSpin{to{transform:rotate(360deg)}}`}</style>
      <div style={{
        width: compact ? 20 : 26, height: compact ? 20 : 26, borderRadius: '50%',
        border: '2.5px solid rgba(120,120,128,.16)', borderTopColor: '#007aff',
        animation: 'miseSpin .7s linear infinite',
      }} />
      {label && <div style={{ fontSize: '.82rem', color: 'var(--tx2)' }}>{label}</div>}
    </div>
  )
}

function Card({ children, style = {}, onClick }: any) {
  return (
    <div onClick={onClick} style={{ background: 'var(--surface)', borderRadius: 16, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,.06),0 4px 16px rgba(0,0,0,.04)', ...(onClick ? { cursor: 'pointer' } : {}), ...style }}>
      {children}
    </div>
  )
}

function Btn({ children, onClick, variant = 'primary', small = false, disabled = false, full = false }: any) {
  const s: any = {
    primary: { background: '#007aff', color: '#fff', border: 'none' },
    danger:  { background: '#ff3b30', color: '#fff', border: 'none' },
    ghost:   { background: 'transparent', color: '#007aff', border: '1px solid rgba(0,122,255,.3)' },
    gray:    { background: 'var(--fill)', color: 'var(--tx)', border: 'none' },
  }
  return (
    <button onClick={onClick} disabled={disabled} style={{
      ...s[variant], padding: small ? '6px 14px' : '10px 20px',
      borderRadius: 980, fontFamily: 'inherit',
      fontSize: small ? '.78rem' : '.88rem', fontWeight: 600,
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? .5 : 1, transition: 'opacity .15s',
      width: full ? '100%' : undefined,
    }}>
      {children}
    </button>
  )
}

function Field({ label, value, onChange, placeholder, type = 'text', select, options }: any) {
  const { t: tr } = useI18n()
  return (
    <div style={{ marginBottom: 12 }}>
      {label && <label style={{ display: 'block', fontSize: '.72rem', fontWeight: 600, color: 'var(--tx2)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '.04em' }}>{label}</label>}
      {select ? (
        <select value={value} onChange={e => onChange(e.target.value)} style={inputStyle}>
          {options.map((o: any) => <option key={o.value} value={o.value}>{tr(o.label)}</option>)}
        </select>
      ) : (
        <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} style={inputStyle} />
      )}
    </div>
  )
}

const inputStyle: any = {
  width: '100%', padding: '9px 12px', borderRadius: 10,
  border: '1px solid rgba(var(--seprgb),.2)', fontSize: '.88rem',
  fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
  color: 'var(--tx)', background: 'var(--surface)',
}

function SectionTitle({ title, sub }: { title: string; sub?: string }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--tx)', marginBottom: 2 }}>{title}</div>
      {sub && <div style={{ color: 'var(--tx2)', fontSize: '.83rem' }}>{sub}</div>}
    </div>
  )
}


// ── APPS TAB ──────────────────────────────────────────────────────────────────

function AppsTab({ restaurant }: { restaurant: Restaurant | null }) {
  const router = useRouter()
  const { t: tr } = useI18n()
  const plan = restaurant?.subscription_plan || ''
  const status = restaurant?.subscription_status || ''
  // 'canceling' = отмена в конце периода: Stripe держит подписку живой до endsAt
  const isActive = status === 'active' || status === 'trialing' || status === 'canceling'

  return (
    <div>
      <SectionTitle title={tr('dash.navApps')} sub={restaurant?.name || '—'} />

      {status === 'trialing' && (
        <div style={{ background: 'rgba(0,122,255,.08)', border: '1px solid rgba(0,122,255,.2)', borderRadius: 12, padding: '12px 16px', marginBottom: 16, fontSize: '.85rem', color: '#007aff', fontWeight: 500 }}>
          {tr('dash.trialActive')}
        </div>
      )}
      {!isActive && (
        <div style={{ background: 'rgba(255,59,48,.08)', border: '1px solid rgba(255,59,48,.2)', borderRadius: 12, padding: '12px 16px', marginBottom: 16, fontSize: '.85rem', color: '#ff3b30', fontWeight: 500 }}>
          {tr('dash.subInactive')}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(250px,1fr))', gap: 12, marginBottom: 16 }}>
        {APPS.map(app => {
          // comp_apps — доступ, выданный супер-админом поверх тарифа
          const comped = ((restaurant as any)?.comp_apps || []).includes(app.id)
          const locked = isActive && !app.plans.includes(plan) && !comped
          const enabled = isActive && !locked
          return (
            <Card key={app.id} onClick={enabled ? () => router.push(app.path) : undefined}
              style={{ display: 'flex', alignItems: 'center', gap: 14, padding: 16, opacity: locked || !isActive ? .55 : 1 }}>
              <div style={{ flexShrink: 0, filter: enabled ? 'none' : 'grayscale(1) opacity(.6)' }}>
                <AppIcon app={app.id as BrandApp} size={44} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontWeight: 700, fontSize: '.92rem', color: 'var(--tx)' }}>{app.name}</span>
                  {comped && <span style={{ fontSize: '.6rem', fontWeight: 700, color: '#34c759', background: '#34c75918', padding: '2px 7px', borderRadius: 980 }}>{tr('dash.gift')}</span>}
                </div>
                <div style={{ color: 'var(--tx2)', fontSize: '.74rem', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {locked ? tr('dash.availFromBusiness') : !isActive ? tr('dash.needSub') : tr(app.desc)}
                </div>
              </div>
              {enabled
                ? <svg width="8" height="14" fill="none" stroke="var(--tx3)" strokeWidth="2.2" strokeLinecap="round" viewBox="0 0 10 18"><path d="M2 1l7 8-7 8" /></svg>
                : <svg width="14" height="14" fill="none" stroke="var(--tx3)" strokeWidth="2" viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0110 0v4" /></svg>}
            </Card>
          )
        })}
      </div>

    </div>
  )
}

// ── CATEGORIES CARD (живёт в Настройках) ──────────────────────────────────────

function CategoriesCard({ restaurantId }: { restaurantId: string }) {
  const { t: tr } = useI18n()
  const [cats, setCats] = useState<any[]>([])
  const [newName, setNewName] = useState('')
  const [loading, setLoading] = useState(true)

  const load = async () => {
    setLoading(true)
    const { data } = await db.from('expense_categories').select('*').eq('restaurant_id', restaurantId).order('name')
    // Закреплённые — первыми (как в Аналитике), внутри групп по алфавиту.
    const rows = (data || []).sort((a: any, b: any) => (b.is_pinned ? 1 : 0) - (a.is_pinned ? 1 : 0) || String(a.name).localeCompare(String(b.name)))
    setCats(rows); setLoading(false)
  }

  useEffect(() => { if (restaurantId) load() }, [restaurantId])

  const add = async () => {
    if (!newName.trim()) return
    await db.from('expense_categories').insert({ restaurant_id: restaurantId, name: newName.trim() })
    setNewName(''); load()
  }

  const togglePin = async (cat: any) => {
    const { error } = await db.from('expense_categories').update({ is_pinned: !cat.is_pinned }).eq('id', cat.id)
    if (error) { alert(tr('dash.notSaved') + error.message); return }
    load()
  }

  const remove = async (id: string) => {
    // Detach from any saved shift expenses (keeps their category_name) so the FK doesn't block deletion.
    await db.from('shift_expenses').update({ category_id: null }).eq('category_id', id)
    const { error } = await db.from('expense_categories').delete().eq('id', id)
    if (error) { alert(tr('dash.notSaved') + error.message); return }
    load()
  }

  return (
    <Card style={{ marginBottom: 14 }}>
      <div style={{ fontWeight: 600, fontSize: '.9rem', color: 'var(--tx)' }}>{tr('dash.expenseCats')}</div>
      <div style={{ fontSize: '.78rem', color: 'var(--tx2)', margin: '2px 0 14px' }}>{tr('dash.expenseCatsSub')}</div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
        <input value={newName} onChange={e => setNewName(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()}
          placeholder={tr('dash.catPh')}
          style={{ ...inputStyle, flex: 1 }} />
        <Btn onClick={add}>{tr('dash.add')}</Btn>
      </div>
      {loading ? <Spinner />
        : cats.length === 0
          ? <div style={{ color: 'var(--tx2)', fontSize: '.85rem' }}>{tr('dash.noCats')}</div>
          : <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {cats.map(cat => (
                <div key={cat.id} style={{ display: 'flex', alignItems: 'center', gap: 6, background: cat.is_pinned ? 'var(--accent-soft, rgba(10,132,255,.14))' : 'var(--fill)', border: cat.is_pinned ? '1px solid var(--accent, #0a84ff)' : '1px solid transparent', borderRadius: 980, padding: '6px 12px' }}>
                  <button onClick={() => togglePin(cat)} title={cat.is_pinned ? tr('dash.unpinCat') : tr('dash.pinCat')}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, lineHeight: 0, display: 'flex', color: cat.is_pinned ? 'var(--accent, #0a84ff)' : 'var(--tx3)' }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill={cat.is_pinned ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M9 4h6l-1 7 3 3v2H7v-2l3-3-1-7z" /><line x1="12" y1="16" x2="12" y2="21" />
                    </svg>
                  </button>
                  <span style={{ fontSize: '.85rem', fontWeight: 500, color: 'var(--tx)' }}>{cat.name}</span>
                  <button onClick={() => remove(cat.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--tx3)', fontSize: '.85rem', padding: 0, lineHeight: 1 }}>✕</button>
                </div>
              ))}
            </div>
      }
    </Card>
  )
}

// ── TEAM TAB ──────────────────────────────────────────────────────────────────

function TeamTab({ restaurant }: { restaurant: Restaurant | null }) {
  const { t: tr } = useI18n()
  const restaurantId = restaurant?.id || ''
  const plan = restaurant?.subscription_plan || 'starter'
  const maxStaff = PLANS.find(p => p.id === plan)?.maxStaff || 2

  const [staff, setStaff] = useState<any[]>([])
  const [employees, setEmployees] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ name: '', role: 'waiter', salary: '', deduct: '', card: '', pin: '', apps: [] as string[] })
  const [saving, setSaving] = useState(false)
  const [editingEmpId, setEditingEmpId] = useState<string | null>(null)
  const [ownerPin, setOwnerPin] = useState(restaurant?.owner_pin || '')
  const [ownerPinEdit, setOwnerPinEdit] = useState(false)
  const [ownerPinVal, setOwnerPinVal] = useState('')
  const [ownerSaving, setOwnerSaving] = useState(false)
  const [ownerSaved, setOwnerSaved] = useState(false)
  const [showQR, setShowQR] = useState(false)

  const blank = { name: '', role: 'waiter', salary: '', deduct: '', card: '', pin: '', apps: [] as string[] }
  const qrUrl = typeof window !== 'undefined' ? `${window.location.origin}/join?restaurant=${restaurantId}` : ''

  const load = async () => {
    setLoading(true)
    const [{ data: staffData }, { data: empData }] = await Promise.all([
      db.from('staff').select('*').eq('restaurant_id', restaurantId).eq('is_active', true).order('name'),
      db.from('employees').select('*').eq('restaurant_id', restaurantId).eq('is_active', true).order('name'),
    ])
    setStaff(staffData || [])
    setEmployees(empData || [])
    setLoading(false)
  }

  useEffect(() => { if (restaurantId) load() }, [restaurantId])

  const saveOwnerPin = async () => {
    if (ownerPinVal.length !== 4 || !/^\d+$/.test(ownerPinVal)) { alert(tr('dash.pin4digits')); return }
    setOwnerSaving(true)
    const hashRes = await fetch('/api/auth/pin/hash', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: ownerPinVal }) })
    const { hash } = await hashRes.json()
    await db.from('restaurants').update({ owner_pin: hash }).eq('id', restaurantId)
    setOwnerPin(ownerPinVal); setOwnerPinEdit(false); setOwnerPinVal('')
    setOwnerSaving(false); setOwnerSaved(true); setTimeout(() => setOwnerSaved(false), 2000)
  }

  const toggleApp = (appId: string) => {
    setForm(f => ({ ...f, apps: f.apps.includes(appId) ? f.apps.filter(a => a !== appId) : [...f.apps, appId] }))
  }
  const staffFor = (name: string) => staff.find(s => s.name === name)

  // One save handles both HR (employees) and access (staff).
  const save = async () => {
    if (!form.name.trim()) { alert(tr('dash.enterName')); return }
    setSaving(true)
    const name = form.name.trim()
    const empPayload = { restaurant_id: restaurantId, name, salary: +form.salary || 0, deduct_per_absence: +form.deduct || 0, card_amount: +form.card || 0, is_active: true }
    if (editingEmpId) await db.from('employees').update(empPayload).eq('id', editingEmpId)
    else await db.from('employees').insert(empPayload)

    const existing = staffFor(name)
    if (form.apps.length) {
      if (!existing && (form.pin.length !== 4 || !/^\d+$/.test(form.pin))) { alert(tr('dash.setPinForAccess')); setSaving(false); return }
      let pinHash: string | undefined
      if (form.pin) { const r = await fetch('/api/auth/pin/hash', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: form.pin }) }); pinHash = (await r.json()).hash }
      const sp: any = { restaurant_id: restaurantId, name, apps: form.apps, role: form.role, is_active: true }
      if (pinHash) sp.pin_hash = pinHash
      if (existing) await db.from('staff').update(sp).eq('id', existing.id)
      else { await db.from('staff').insert(sp); track('team_member_invited', { apps_count: form.apps.length }) }
    } else if (existing) {
      await db.from('staff').update({ is_active: false }).eq('id', existing.id) // access revoked
    }
    setForm(blank); setShowForm(false); setEditingEmpId(null); setSaving(false); load()
  }

  const removePerson = async (emp: any) => {
    await db.from('employees').update({ is_active: false }).eq('id', emp.id)
    const s = staffFor(emp.name); if (s) await db.from('staff').update({ is_active: false }).eq('id', s.id)
    load()
  }
  const resetDevice = async (id: string) => { await db.from('staff').update({ device_id: null }).eq('id', id); load() }

  const startEdit = (emp: any) => {
    const s = staffFor(emp.name)
    setForm({ name: emp.name, role: s?.role || 'waiter', salary: String(emp.salary || ''), deduct: String(emp.deduct_per_absence || ''), card: String(emp.card_amount || ''), pin: '', apps: s?.apps || [] })
    setEditingEmpId(emp.id); setShowForm(true)
  }

  const appColor = (id: string) => APPS.find(a => a.id === id)?.color || '#007aff'
  const appName = (id: string) => APPS.find(a => a.id === id)?.name || id
  const totalSalary = employees.reduce((s, e) => s + (e.salary || 0), 0)
  const withAccess = staff.length
  const atLimit = withAccess >= maxStaff

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <SectionTitle title={tr('dash.navTeam')} sub={tr('dash.teamSub')} />
        <Btn onClick={() => { setShowForm(!showForm); setEditingEmpId(null); setForm(blank) }}>
          {showForm ? tr('dash.cancel') : tr('dash.addBtn')}
        </Btn>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginBottom: 16 }}>
        {[{ l: tr('dash.inTeam'), v: String(employees.length), c: 'var(--tx)' }, { l: tr('dash.withAccess'), v: `${withAccess}/${maxStaff}`, c: '#007aff' }, { l: tr('dash.payrollMo'), v: `€${totalSalary.toLocaleString()}`, c: '#af52de' }].map(it => (
          <Card key={it.l} style={{ padding: '14px 16px', textAlign: 'center' }}>
            <div style={{ fontSize: '.68rem', color: 'var(--tx2)', fontWeight: 600, textTransform: 'uppercase', marginBottom: 4, letterSpacing: '.04em' }}>{it.l}</div>
            <div style={{ fontSize: '1.3rem', fontWeight: 700, color: it.c }}>{it.v}</div>
          </Card>
        ))}
      </div>

      {atLimit && (
        <div style={{ background: 'rgba(255,149,0,.08)', border: '1px solid rgba(255,149,0,.25)', borderRadius: 12, padding: '10px 14px', marginBottom: 14, fontSize: '.83rem', color: '#ff9500', fontWeight: 500 }}>
          {tr('dash.accessLimit', { n: maxStaff })}
        </div>
      )}

      {/* ─ QR БЛОК ─ */}
      <Card style={{ marginBottom: 14, background: 'linear-gradient(135deg, #007aff08 0%, #5856d608 100%)', border: '1px solid rgba(0,122,255,.15)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: '.95rem', color: 'var(--tx)', marginBottom: 4 }}>{tr('dash.venueQr')}</div>
            <div style={{ fontSize: '.8rem', color: 'var(--tx2)', lineHeight: 1.5 }}>
              {tr('dash.qrSub')}
            </div>
          </div>
          <button onClick={() => setShowQR(!showQR)} style={{ flexShrink: 0, background: '#007aff', border: 'none', borderRadius: 12, padding: '10px 18px', color: '#fff', fontFamily: 'inherit', fontSize: '.85rem', fontWeight: 600, cursor: 'pointer' }}>
            {showQR ? tr('dash.hide') : tr('dash.showQr')}
          </button>
        </div>

        {showQR && (
          <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid rgba(0,122,255,.1)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
            <div style={{ background: 'var(--surface)', borderRadius: 16, padding: 16, boxShadow: '0 2px 12px rgba(0,0,0,.08)' }}>
              <QRCode value={qrUrl} size={160} />
            </div>
            <div style={{ fontSize: '.75rem', color: 'var(--tx3)', textAlign: 'center', maxWidth: 260, lineHeight: 1.5 }}>
              {qrUrl}
            </div>
            <button onClick={() => {
              if (navigator.clipboard) {
                navigator.clipboard.writeText(qrUrl)
              } else {
                const el = document.createElement('textarea')
                el.value = qrUrl
                document.body.appendChild(el)
                el.select()
                document.execCommand('copy')
                document.body.removeChild(el)
              }
            }} style={{ background: 'var(--fill)', border: 'none', borderRadius: 980, padding: '7px 16px', fontSize: '.78rem', fontWeight: 600, color: '#007aff', cursor: 'pointer', fontFamily: 'inherit' }}>
              {tr('dash.copyLink')}
            </button>
          </div>
        )}
      </Card>

      {/* ─ ВЛАДЕЛЕЦ PIN ─ */}
      <Card style={{ marginBottom: 14, border: '1px solid rgba(175,82,222,.2)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <div style={{ fontWeight: 700, fontSize: '.95rem', color: 'var(--tx)' }}>{tr('dash.owner')}</div>
              <div style={{ fontSize: '.7rem', fontWeight: 700, padding: '2px 8px', borderRadius: 980, background: '#af52de15', color: '#af52de' }}>{tr('dash.fullAccess')}</div>
            </div>
            <div style={{ fontSize: '.8rem', color: 'var(--tx2)' }}>
              {ownerPin ? tr('dash.pinSet') : tr('dash.pinNotSet')}
            </div>
          </div>
          <button onClick={() => { setOwnerPinEdit(!ownerPinEdit); setOwnerPinVal('') }} style={{ background: 'none', border: '1px solid rgba(175,82,222,.3)', borderRadius: 980, padding: '7px 14px', fontSize: '.78rem', fontWeight: 600, color: '#af52de', cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 }}>
            {ownerPinEdit ? tr('dash.cancel') : ownerPin ? tr('dash.changePin') : tr('dash.setPin')}
          </button>
        </div>

        {ownerPinEdit && (
          <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid rgba(175,82,222,.1)', display: 'flex', gap: 10, alignItems: 'flex-end' }}>
            <div style={{ flex: 1 }}>
              <label style={{ display: 'block', fontSize: '.72rem', fontWeight: 600, color: 'var(--tx2)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '.04em' }}>{tr('dash.newPin4')}</label>
              <input
                type="password" inputMode="numeric" maxLength={4}
                value={ownerPinVal} onChange={e => setOwnerPinVal(e.target.value.replace(/\D/g,'').slice(0,4))}
                placeholder="••••"
                style={{ ...inputStyle, letterSpacing: '.2em', fontSize: '1.2rem', textAlign: 'center' }}
              />
            </div>
            <Btn onClick={saveOwnerPin} disabled={ownerSaving}>
              {ownerSaving ? '...' : ownerSaved ? '✓' : tr('dash.save')}
            </Btn>
          </div>
        )}
      </Card>

      {/* ─ ФОРМА ─ */}
      {showForm && (
        <Card style={{ marginBottom: 14, border: '1px solid #007aff' }}>
          <div style={{ fontWeight: 700, fontSize: '.95rem', marginBottom: 14 }}>{editingEmpId ? tr('dash.editEmployee') : tr('dash.newEmployee')}</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div style={{ gridColumn: '1/-1' }}>
              <Field label={tr('dash.name')} value={form.name} onChange={(v: string) => setForm({ ...form, name: v })} placeholder={tr('dash.namePh')} />
            </div>
            <Field label={tr('dash.role')} value={form.role} onChange={(v: string) => setForm({ ...form, role: v })} select options={ROLE_OPTS} />
            <Field label={tr('dash.salary')} value={form.salary} onChange={(v: string) => setForm({ ...form, salary: v })} placeholder="1000" type="number" />
            <Field label={tr('dash.deductPerAbsence')} value={form.deduct} onChange={(v: string) => setForm({ ...form, deduct: v })} placeholder="50" type="number" />
            <Field label={tr('dash.toCard')} value={form.card} onChange={(v: string) => setForm({ ...form, card: v })} placeholder="0" type="number" />
          </div>

          <div style={{ borderTop: '1px solid rgba(var(--seprgb),.1)', margin: '8px 0 14px', paddingTop: 14 }}>
            <div style={{ fontSize: '.72rem', fontWeight: 600, color: 'var(--tx2)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '.04em' }}>{tr('dash.appAccess')}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
              {APPS.map(app => (
                <label key={app.id} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', padding: '9px 12px', borderRadius: 10, background: form.apps.includes(app.id) ? app.color + '10' : 'var(--fill2)', border: `1px solid ${form.apps.includes(app.id) ? app.color : 'transparent'}`, transition: 'all .15s' }}>
                  <input type="checkbox" checked={form.apps.includes(app.id)} onChange={() => toggleApp(app.id)} style={{ width: 16, height: 16, accentColor: app.color }} />
                  <div>
                    <div style={{ fontSize: '.88rem', fontWeight: 600, color: 'var(--tx)' }}>{app.name}</div>
                    <div style={{ fontSize: '.72rem', color: 'var(--tx2)' }}>{app.hint}</div>
                  </div>
                </label>
              ))}
            </div>
            {form.apps.length > 0 && (
              <Field
                label={staffFor(form.name.trim()) ? tr('dash.newPinOptional') : tr('dash.pinForLogin')}
                value={form.pin} onChange={(v: string) => setForm({ ...form, pin: v.replace(/\D/g, '').slice(0, 4) })}
                placeholder="1234" type="password"
              />
            )}
            <div style={{ fontSize: '.72rem', color: 'var(--tx3)' }}>{tr('dash.noAppsNote')}</div>
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <Btn onClick={save} disabled={saving}>{saving ? tr('dash.saving') : editingEmpId ? tr('dash.save') : tr('dash.add')}</Btn>
            <Btn variant="gray" onClick={() => { setShowForm(false); setEditingEmpId(null) }}>{tr('dash.cancel')}</Btn>
          </div>
        </Card>
      )}

      {/* ─ СПИСОК ─ */}
      {loading ? (
        <Spinner />
      ) : employees.length === 0 ? (
        <Card><div style={{ textAlign: 'center', padding: '28px 0', color: 'var(--tx2)', fontSize: '.88rem' }}>{tr('dash.addFirstEmployee')}</div></Card>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {employees.map(emp => {
            const s = staffFor(emp.name)
            return (
              <Card key={emp.id} style={{ padding: 16 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                      <div style={{ fontWeight: 700, fontSize: '.95rem', color: 'var(--tx)' }}>{emp.name}</div>
                      <div style={{ fontSize: '.7rem', fontWeight: 600, padding: '2px 8px', borderRadius: 980, background: '#5856d615', color: '#5856d6' }}>{tr(roleLabel(s?.role))}</div>
                      {s
                        ? <div style={{ fontSize: '.7rem', fontWeight: 600, padding: '2px 8px', borderRadius: 980, background: s.device_id ? '#34c75915' : 'var(--fill)', color: s.device_id ? '#34c759' : 'var(--tx3)' }}>{s.device_id ? tr('dash.bound') : tr('dash.notBound')}</div>
                        : <div style={{ fontSize: '.7rem', fontWeight: 600, padding: '2px 8px', borderRadius: 980, background: 'var(--fill)', color: 'var(--tx3)' }}>{tr('dash.noAccess')}</div>}
                    </div>
                    <div style={{ fontSize: '.75rem', color: 'var(--tx2)', display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: s ? 8 : 0 }}>
                      <span>{tr('dash.salaryShort')}: <strong style={{ color: 'var(--tx)' }}>€{emp.salary}</strong></span>
                      <span>{tr('dash.deductShort')}: <strong style={{ color: 'var(--tx)' }}>€{emp.deduct_per_absence}</strong></span>
                      {emp.card_amount > 0 && <span>{tr('dash.cardShort')}: <strong style={{ color: '#af52de' }}>€{emp.card_amount}</strong></span>}
                    </div>
                    {s && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                        {(s.apps || []).map((appId: string) => (
                          <span key={appId} style={{ fontSize: '.7rem', fontWeight: 600, padding: '2px 8px', borderRadius: 980, background: appColor(appId) + '15', color: appColor(appId) }}>{appName(appId)}</span>
                        ))}
                        {s.device_id && <button onClick={() => resetDevice(s.id)} style={{ background: 'none', border: 'none', color: '#ff9500', fontSize: '.75rem', fontWeight: 600, cursor: 'pointer', padding: 0, fontFamily: 'inherit' }}>{tr('dash.resetDevice')}</button>}
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                    <Btn small variant="ghost" onClick={() => startEdit(emp)}>{tr('dash.edit')}</Btn>
                    <Btn small variant="danger" onClick={() => removePerson(emp)}>✕</Btn>
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── SETTINGS TAB ──────────────────────────────────────────────────────────────

// ── GEO / ATTENDANCE SETTINGS (mise People) ───────────────────────────────────

function MiniToggle({ value, onChange, color = '#5856d6' }: { value: boolean; onChange: (v: boolean) => void; color?: string }) {
  return (
    <div onClick={() => onChange(!value)} style={{ width: 46, height: 28, borderRadius: 14, background: value ? color : 'rgba(120,120,128,0.32)', cursor: 'pointer', transition: 'background .2s', position: 'relative', flexShrink: 0 }}>
      <div style={{ position: 'absolute', top: 2, left: value ? 20 : 2, width: 24, height: 24, borderRadius: '50%', background: 'var(--surface)', boxShadow: '0 2px 5px rgba(0,0,0,.25)', transition: 'left .2s' }} />
    </div>
  )
}

function GeoSettingsCard() {
  const { t: tr } = useI18n()
  const [row, setRow] = useState<any>(null)
  const [f, setF] = useState({ attendance_enabled: false, latitude: '', longitude: '', geo_radius_m: '150', reminder_mode: 'hours_before', reminder_hours: '12', reminder_time: '18:00' })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [locating, setLocating] = useState(false)

  useEffect(() => {
    db.from('restaurant_settings').select('*').limit(1).then(({ data }: any) => {
      const r = Array.isArray(data) ? data[0] : data
      if (r) {
        setRow(r)
        setF({
          attendance_enabled: !!r.attendance_enabled,
          latitude: r.latitude != null ? String(r.latitude) : '',
          longitude: r.longitude != null ? String(r.longitude) : '',
          geo_radius_m: String(r.geo_radius_m ?? 150),
          reminder_mode: r.reminder_mode || 'hours_before',
          reminder_hours: String(r.reminder_hours ?? 12),
          reminder_time: (r.reminder_time || '18:00').slice(0, 5),
        })
      }
    })
  }, [])

  const useMyLocation = () => {
    if (!navigator.geolocation) return
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      p => { setF(s => ({ ...s, latitude: p.coords.latitude.toFixed(6), longitude: p.coords.longitude.toFixed(6) })); setLocating(false) },
      () => { alert(tr('dash.geoFailed')); setLocating(false) },
      { enableHighAccuracy: true, timeout: 10000 }
    )
  }

  const save = async () => {
    setSaving(true)
    const payload: any = {
      attendance_enabled: f.attendance_enabled,
      latitude: f.latitude ? Number(f.latitude) : null,
      longitude: f.longitude ? Number(f.longitude) : null,
      geo_radius_m: parseInt(f.geo_radius_m) || 150,
      reminder_mode: f.reminder_mode,
      reminder_hours: parseInt(f.reminder_hours) || 12,
      reminder_time: f.reminder_time || '18:00',
    }
    const res = row?.id
      ? await db.from('restaurant_settings').update(payload).eq('id', row.id)
      : await db.from('restaurant_settings').insert(payload).select().single()
    if (res.error) { alert(tr('dash.notSaved') + res.error.message); setSaving(false); return }
    if (!row?.id && res.data) setRow(res.data)
    setSaving(false); setSaved(true); setTimeout(() => setSaved(false), 2000)
  }

  return (
    <Card style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: '.9rem', color: 'var(--tx)', display: 'flex', alignItems: 'center', gap: 7 }}>
            {tr('dash.geoTitle')}
            <span style={{ fontSize: '.6rem', fontWeight: 800, letterSpacing: '.4px', color: '#5856d6', background: 'rgba(88,86,214,.12)', padding: '2px 6px', borderRadius: 6, textTransform: 'uppercase' }}>Beta</span>
          </div>
          <div style={{ fontSize: '.78rem', color: 'var(--tx2)', marginTop: 2 }}>{tr('dash.geoSub')}</div>
        </div>
        <MiniToggle value={f.attendance_enabled} onChange={v => setF({ ...f, attendance_enabled: v })} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 4 }}>
        <Field label={tr('dash.latitude')} value={f.latitude} onChange={(v: string) => setF({ ...f, latitude: v })} placeholder="41.3111" />
        <Field label={tr('dash.longitude')} value={f.longitude} onChange={(v: string) => setF({ ...f, longitude: v })} placeholder="69.2797" />
      </div>
      <button onClick={useMyLocation} style={{ background: 'var(--fill)', border: 'none', borderRadius: 980, padding: '7px 16px', fontSize: '.78rem', fontWeight: 600, color: '#5856d6', cursor: 'pointer', fontFamily: 'inherit', marginBottom: 12 }}>
        {locating ? tr('dash.locating') : tr('dash.useMyLocation')}
      </button>
      <Field label={tr('dash.radiusM')} value={f.geo_radius_m} onChange={(v: string) => setF({ ...f, geo_radius_m: v })} type="number" placeholder="150" />

      <div style={{ fontWeight: 600, fontSize: '.82rem', color: 'var(--tx)', margin: '8px 0 10px' }}>{tr('dash.shiftReminder')}</div>
      <Field label={tr('dash.mode')} value={f.reminder_mode} onChange={(v: string) => setF({ ...f, reminder_mode: v })} select options={[{ value: 'hours_before', label: 'dash.remHoursBefore' }, { value: 'fixed_time', label: 'dash.remFixedTime' }]} />
      {f.reminder_mode === 'hours_before'
        ? <Field label={tr('dash.hoursBefore')} value={f.reminder_hours} onChange={(v: string) => setF({ ...f, reminder_hours: v })} type="number" placeholder="12" />
        : <Field label={tr('dash.timeEve')} value={f.reminder_time} onChange={(v: string) => setF({ ...f, reminder_time: v })} type="time" />}

      <Btn onClick={save}>{saving ? tr('dash.saving') : saved ? tr('dash.savedCheck') : tr('dash.save')}</Btn>
    </Card>
  )
}

// Безнал в аналитике: менеджер не видит расходов по карте, поэтому включённый безнал
// раздувает итог. По умолчанию выкл — владелец видит реальные (наличные) показатели.
function AnalyticsSettingsCard() {
  const { t: tr } = useI18n()
  const [row, setRow] = useState<any>(null)
  const [includeCard, setIncludeCard] = useState(false)

  useEffect(() => {
    db.from('restaurant_settings').select('*').limit(1).then(({ data }: any) => {
      const r = Array.isArray(data) ? data[0] : data
      if (r) { setRow(r); setIncludeCard(!!r.include_card_in_analytics) }
    })
  }, [])

  const toggle = async (v: boolean) => {
    setIncludeCard(v)
    if (row?.id) await db.from('restaurant_settings').update({ include_card_in_analytics: v }).eq('id', row.id)
    else { const { data } = await db.from('restaurant_settings').insert({ include_card_in_analytics: v }).select().single(); if (data) setRow(data) }
  }

  return (
    <Card style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: '.9rem', color: 'var(--tx)' }}>{tr('dash.includeCard')}</div>
          <div style={{ fontSize: '.78rem', color: 'var(--tx2)', marginTop: 2, maxWidth: 380 }}>
            {tr('dash.includeCardSub')}
          </div>
        </div>
        <MiniToggle value={includeCard} onChange={toggle} color="#34c759" />
      </div>
    </Card>
  )
}

// Виды кальянов: у каждого своё имя, цена, граммовка и допустимые бренды
// (пусто = любые). Кальянщик в Stash отмечает продажи по этим видам.
function HookahSettingsCard() {
  const { t: tr } = useI18n()
  const [types, setTypes] = useState<any[]>([])
  const [edit, setEdit] = useState<{ id?: string; name: string; price: string; portion: string; brands: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [cats, setCats] = useState<string[]>([])
  const [newCat, setNewCat] = useState('')

  const load = () => {
    db.from('hookah_types').select('*').eq('is_active', true).order('created_at').then(({ data }: any) => setTypes(data || []))
    db.from('restaurant_settings').select('free_hookah_categories').then(({ data }: any) => setCats(data?.[0]?.free_hookah_categories || []))
  }
  useEffect(() => { load() }, [])

  // Категории бесплатных кальянов — кальянщик выбирает из них в Stash.
  const saveCats = async (next: string[]) => {
    setCats(next)
    const res = await db.from('restaurant_settings').update({ free_hookah_categories: next })
    if (res.error) { alert(tr('dash.notSaved') + res.error.message); load() }
  }
  const addCat = () => {
    const v = newCat.trim()
    if (!v || cats.includes(v)) { setNewCat(''); return }
    saveCats([...cats, v]); setNewCat('')
  }

  const save = async () => {
    if (!edit || !edit.name.trim()) { alert(tr('dash.enterTitle')); return }
    setSaving(true)
    const payload = {
      name: edit.name.trim(),
      price: parseFloat(edit.price) || 0,
      portion_g: parseFloat(edit.portion) || 20,
      brands: edit.brands.split(',').map(b => b.trim()).filter(Boolean),
    }
    const res = edit.id
      ? await db.from('hookah_types').update(payload).eq('id', edit.id)
      : await db.from('hookah_types').insert(payload)
    setSaving(false)
    if (res.error) { alert(tr('dash.notSaved') + res.error.message); return }
    setEdit(null); await load()
  }
  const remove = async (id: string) => {
    if (!confirm(tr('dash.removeHookahType'))) return
    await db.from('hookah_types').update({ is_active: false }).eq('id', id)
    await load()
  }

  return (
    <Card style={{ marginBottom: 14 }}>
      <div style={{ fontWeight: 600, fontSize: '.9rem', color: 'var(--tx)' }}>{tr('dash.hookahTypes')}</div>
      <div style={{ fontSize: '.78rem', color: 'var(--tx2)', margin: '2px 0 14px' }}>{tr('dash.hookahTypesSub')}</div>

      {types.map(tp => (
        <div key={tp.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: 'var(--fill)', borderRadius: 12, marginBottom: 8 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: '.86rem', color: 'var(--tx)' }}>{tp.name} · €{tp.price} · {tp.portion_g} г</div>
            <div style={{ fontSize: '.72rem', color: 'var(--tx2)', marginTop: 1 }}>{tp.brands?.length ? tp.brands.join(', ') : tr('dash.anyBrands')}</div>
          </div>
          <button onClick={() => setEdit({ id: tp.id, name: tp.name, price: String(tp.price), portion: String(tp.portion_g), brands: (tp.brands || []).join(', ') })} style={{ background: 'none', border: 'none', color: '#007aff', fontSize: '.78rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>{tr('dash.edit')}</button>
          <button onClick={() => remove(tp.id)} style={{ background: 'none', border: 'none', color: '#ff3b30', fontSize: '.78rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>{tr('dash.remove')}</button>
        </div>
      ))}

      {edit ? (
        <div style={{ background: 'var(--fill2)', borderRadius: 12, padding: 12, marginTop: 8 }}>
          <Field label={tr('dash.title')} value={edit.name} onChange={(v: string) => setEdit({ ...edit, name: v })} placeholder={tr('dash.hookahNamePh')} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Field label={tr('dash.price')} value={edit.price} onChange={(v: string) => setEdit({ ...edit, price: v })} type="number" placeholder="15" />
            <Field label={tr('dash.portionG')} value={edit.portion} onChange={(v: string) => setEdit({ ...edit, portion: v })} type="number" placeholder="20" />
          </div>
          <Field label={tr('dash.brandsField')} value={edit.brands} onChange={(v: string) => setEdit({ ...edit, brands: v })} placeholder="Darkside, Element" />
          <div style={{ display: 'flex', gap: 8 }}>
            <Btn onClick={save}>{saving ? tr('dash.saving') : tr('dash.saveType')}</Btn>
            <Btn variant="gray" onClick={() => setEdit(null)}>{tr('dash.cancel')}</Btn>
          </div>
        </div>
      ) : (
        <Btn variant="ghost" onClick={() => setEdit({ name: '', price: '', portion: '20', brands: '' })}>{tr('dash.addHookahType')}</Btn>
      )}

      {/* Категории бесплатных кальянов */}
      <div style={{ fontWeight: 600, fontSize: '.9rem', color: 'var(--tx)', marginTop: 20 }}>{tr('dash.freeCats')}</div>
      <div style={{ fontSize: '.78rem', color: 'var(--tx2)', margin: '2px 0 12px' }}>{tr('dash.freeCatsSub')}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
        {cats.map(c => (
          <span key={c} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 10px', background: 'var(--fill)', borderRadius: 999, fontSize: '.8rem', color: 'var(--tx)' }}>
            {c}
            <button onClick={() => saveCats(cats.filter(x => x !== c))} style={{ background: 'none', border: 'none', color: '#ff3b30', fontSize: '.95rem', lineHeight: 1, cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>×</button>
          </span>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <input value={newCat} onChange={e => setNewCat(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addCat() }}
          placeholder={tr('dash.freeCatPh')}
          style={{ flex: 1, padding: '9px 12px', background: 'var(--fill)', border: '1px solid var(--bd)', borderRadius: 10, color: 'var(--tx)', fontSize: '.85rem', fontFamily: 'inherit' }} />
        <Btn variant="gray" onClick={addCat}>{tr('dash.add')}</Btn>
      </div>
    </Card>
  )
}

function SettingsTab({ restaurant, theme, onUpdate }: { restaurant: Restaurant | null; theme: { dark: boolean; toggle: () => void; mode: 'system' | 'light' | 'dark'; setMode: (m: 'system' | 'light' | 'dark') => void }; onUpdate: () => void }) {
  const { t: tr } = useI18n()
  const [name, setName] = useState(restaurant?.name || '')
  const [currency, setCurrency] = useState(restaurant?.currency || '€')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [logoFile, setLogoFile] = useState<File | null>(null)
  const [logoPreview, setLogoPreview] = useState(restaurant?.logo_url || '')
  const [logoUploading, setLogoUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (restaurant) { setName(restaurant.name); setCurrency(restaurant.currency || '€'); setLogoPreview(restaurant.logo_url || '') }
  }, [restaurant])

  const pickLogo = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setLogoFile(file)
    setLogoPreview(URL.createObjectURL(file))
  }

  const uploadLogo = async () => {
    if (!logoFile || !restaurant) return
    setLogoUploading(true)
    const ext = logoFile.name.split('.').pop()
    const path = `logos/${restaurant.id}.${ext}`
    const { error } = await supabase.storage.from('restaurant-assets').upload(path, logoFile, { upsert: true })
    if (!error) {
      const { data: { publicUrl } } = supabase.storage.from('restaurant-assets').getPublicUrl(path)
      await db.from('restaurants').update({ logo_url: publicUrl }).eq('id', restaurant.id)
      onUpdate()
    }
    setLogoUploading(false)
  }

  const save = async () => {
    if (!restaurant) return
    setSaving(true)
    const { error } = await db.from('restaurants').update({ name, currency }).eq('id', restaurant.id)
    if (error) { alert(tr('dash.notSaved') + error.message); setSaving(false); return }
    if (logoFile) await uploadLogo()
    setSaving(false); setSaved(true); setTimeout(() => setSaved(false), 2000); onUpdate()
  }

  return (
    <div>
      <SectionTitle title={tr('dash.navSettings')} sub={tr('dash.settingsSub')} />

      {/* Логотип */}
      <Card style={{ marginBottom: 14 }}>
        <div style={{ fontWeight: 600, fontSize: '.9rem', marginBottom: 14, color: 'var(--tx)' }}>{tr('dash.venueLogo')}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ width: 72, height: 72, borderRadius: 16, background: 'var(--fill)', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid rgba(var(--seprgb),.12)', flexShrink: 0 }}>
            {logoPreview ? (
              <img src={logoPreview} alt="logo" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <svg width="30" height="30" fill="none" stroke="var(--tx3)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M3 9l1.2-5h15.6L21 9" /><path d="M4 9v11a1 1 0 001 1h14a1 1 0 001-1V9" /><path d="M3 9h18" /><path d="M9 21v-6h6v6" /></svg>
            )}
          </div>
          <div>
            <div style={{ fontSize: '.85rem', color: 'var(--tx)', fontWeight: 500, marginBottom: 6 }}>
              {logoPreview ? tr('dash.logoUploaded') : tr('dash.logoNotUploaded')}
            </div>
            <div style={{ fontSize: '.78rem', color: 'var(--tx2)', marginBottom: 10 }}>
              <span dangerouslySetInnerHTML={{ __html: tr('dash.logoNote') }} />
            </div>
            <button onClick={() => fileRef.current?.click()} style={{ background: 'var(--fill)', border: 'none', borderRadius: 980, padding: '7px 16px', fontSize: '.78rem', fontWeight: 600, color: '#007aff', cursor: 'pointer', fontFamily: 'inherit' }}>
              {logoPreview ? tr('dash.replace') : tr('dash.uploadPhoto')}
            </button>
            <input ref={fileRef} type="file" accept="image/*" onChange={pickLogo} style={{ display: 'none' }} />
          </div>
        </div>
      </Card>

      <Card style={{ marginBottom: 14 }}>
        <div style={{ fontWeight: 600, fontSize: '.9rem', marginBottom: 14, color: 'var(--tx)' }}>{tr('dash.venue')}</div>
        <Field label={tr('dash.name')} value={name} onChange={setName} placeholder={tr('dash.restaurantNamePh')} />
        <Field
          label={tr('dash.currency')}
          value={currency}
          onChange={setCurrency}
          select
          options={[
            { value: '€', label: 'dash.curEur' },
            { value: '₸', label: 'dash.curKzt' },
            { value: '₽', label: 'dash.curRub' },
            { value: '$', label: 'dash.curUsd' },
          ]}
        />
        <Btn onClick={save}>{saving ? tr('dash.saving') : saved ? tr('dash.savedCheck') : tr('dash.save')}</Btn>
      </Card>

      {restaurant && <CategoriesCard restaurantId={restaurant.id} />}

      <HookahSettingsCard />

      <AnalyticsSettingsCard />

      <GeoSettingsCard />

      <Card>
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontWeight: 600, fontSize: '.9rem', color: 'var(--tx)' }}>{tr('dash.theme')}</div>
          <div style={{ fontSize: '.78rem', color: 'var(--tx2)', marginTop: 2 }}>{tr('dash.themeSub')}</div>
        </div>
        <div style={{ display: 'flex', gap: 6, background: 'var(--fill, rgba(120,120,128,.12))', padding: 4, borderRadius: 12 }}>
          {([['system', tr('dash.system')], ['light', tr('dash.light')], ['dark', tr('dash.dark')]] as const).map(([m, label]) => {
            const on = theme.mode === m
            return (
              <button key={m} type="button" onClick={() => theme.setMode(m)} style={{
                flex: 1, padding: '8px 4px', borderRadius: 9, border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                fontSize: '.82rem', fontWeight: on ? 700 : 500,
                background: on ? 'var(--surface,#fff)' : 'transparent',
                color: on ? '#007aff' : 'var(--tx2)',
                boxShadow: on ? '0 1px 4px rgba(0,0,0,.12)' : 'none', transition: 'all .15s',
              }}>{label}</button>
            )
          })}
        </div>
      </Card>
    </div>
  )
}

// ── BILLING TAB ───────────────────────────────────────────────────────────────

function BillingTab({ restaurant, user, onRefresh }: { restaurant: Restaurant | null; user: any; onRefresh: () => void }) {
  const { t: tr, locale } = useI18n()
  const [loading, setLoading] = useState(false)
  const [cancelConfirm, setCancelConfirm] = useState(false)
  const [portalLoading, setPortalLoading] = useState(false)
  // App Store (Guideline 3.1.1): в нативной iOS-сборке НЕ показываем цены/оплату/портал —
  // подписка оформляется в веб-версии. Внутри приложения — только статус (read-only).
  const native = useIsNative()

  const currentPlan = PLANS.find(p => p.id === restaurant?.subscription_plan)
  const status = restaurant?.subscription_status
  const endsAt = restaurant?.subscription_ends_at ? new Date(restaurant.subscription_ends_at) : null
  // 'canceling' = доступ сохраняется до конца оплаченного периода
  const isActive = status === 'active' || status === 'trialing' || status === 'canceling'

  // Дней до конца триала (показываем баннер при ≤ 3 дня)
  const trialDaysLeft = status === 'trialing' && endsAt
    ? Math.ceil((endsAt.getTime() - Date.now()) / 86400000)
    : null

  const openPortal = async () => {
    if (!restaurant) return
    setPortalLoading(true)
    try {
      const res = await fetch('/api/stripe/portal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ restaurantId: restaurant.id }),
      })
      const data = await res.json()
      if (data.error) { alert(data.error); return }
      if (data.url) window.location.href = data.url
    } catch (e: any) {
      alert(tr('dash.error') + e?.message)
    } finally { setPortalLoading(false) }
  }

  const statusLabel: Record<string, { label: string; color: string; bg: string }> = {
    trialing: { label: 'dash.stTrialing', color: '#007aff', bg: 'rgba(0,122,255,.1)' },
    active:   { label: 'dash.stActive',   color: '#34c759', bg: 'rgba(52,199,89,.1)' },
    past_due: { label: 'dash.stPastDue',  color: '#ff9500', bg: 'rgba(255,149,0,.1)' },
    canceling: { label: 'dash.stCanceling', color: '#ff9500', bg: 'rgba(255,149,0,.1)' },
    canceled:  { label: 'dash.stCanceled', color: '#ff3b30', bg: 'rgba(255,59,48,.1)' },
    inactive:  { label: 'dash.stInactive', color: 'var(--tx3)', bg: 'var(--fill)' },
  }
  const badge = statusLabel[status || 'inactive'] || statusLabel['inactive']

  const [pendingPlan, setPendingPlan] = useState<string | null>(null)
  const subscribe = async (planId: string) => {
    if (!restaurant || !user || pendingPlan) return
    setPendingPlan(planId)
    setLoading(true)
    track('checkout_started', { plan: planId })
    try {
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: planId, restaurantId: restaurant.id, userId: user.id, email: user.email }),
      })
      // Ошибки наружу: молчаливый фейл выглядел как «кнопка не работает»
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data.error) { alert(`${tr('dash.checkoutFailed')} (${res.status}): ${data.error || tr('dash.tryRelogin')}`); return }
      if (data.url) window.location.href = data.url
      else alert(tr('dash.noStripeUrl'))
    } catch (e: any) {
      alert(tr('dash.netErrCheckout') + (e?.message || e))
    } finally { setLoading(false); setPendingPlan(null) }
  }

  const cancel = async () => {
    if (!restaurant) return
    setLoading(true)
    try {
      const res = await fetch('/api/stripe/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ restaurantId: restaurant.id }),
      })
      const data = await res.json()
      if (data.error) { alert(data.error); return }
      setCancelConfirm(false)
      onRefresh()
    } finally {
      setLoading(false)
    }
  }

  const justPaid = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('success') === '1'

  return (
    <div>
      <SectionTitle title={tr('dash.navBilling')} sub={tr('dash.billingSub')} />

      {justPaid && !isActive && (
        <Card style={{ marginBottom: 16, border: '1px solid rgba(0,122,255,.25)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: '.85rem', color: 'var(--tx2)' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#007aff', flexShrink: 0 }} />
            {tr('dash.paymentReceived')}
          </div>
        </Card>
      )}

      {/* App Store: подписка управляется в вебе (нативная сборка) */}
      {native && (
        <Card style={{ marginBottom: 16, background: 'var(--fill2)', boxShadow: 'none' }}>
          <div style={{ fontWeight: 600, fontSize: '.88rem', color: 'var(--tx)', marginBottom: 4 }}>{tr('dash.manageSub')}</div>
          <div style={{ fontSize: '.82rem', color: 'var(--tx2)', lineHeight: 1.5 }}>{tr('dash.manageSubNative')}</div>
        </Card>
      )}

      {/* Баннер: триал заканчивается */}
      {!native && trialDaysLeft !== null && trialDaysLeft <= 3 && (
        <Card style={{ marginBottom: 16, border: '1px solid rgba(255,149,0,.35)', background: 'rgba(255,149,0,.06)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: '.92rem', color: 'var(--tx)', marginBottom: 2 }}>
                {trialDaysLeft <= 0 ? tr('dash.trialEndsToday') : locale === 'ru' ? `Пробный период заканчивается через ${trialDaysLeft} ${trialDaysLeft === 1 ? 'день' : 'дня'}` : tr('dash.trialEndsIn', { n: trialDaysLeft })}
              </div>
              <div style={{ fontSize: '.8rem', color: 'var(--tx2)' }}>{tr('dash.choosePlanKeepAccess')}</div>
            </div>
            <svg width="20" height="20" fill="none" stroke="#ff9500" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" /></svg>
          </div>
        </Card>
      )}

      {currentPlan && (
        <Card style={{ marginBottom: 16, border: `1px solid ${currentPlan.color}25` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <div style={{ display: 'inline-block', background: badge.bg, color: badge.color, fontSize: '.72rem', fontWeight: 700, padding: '3px 10px', borderRadius: 980, marginBottom: 10 }}>{badge.label}</div>
              <div style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--tx)', marginBottom: 2 }}>{currentPlan.name}</div>
              {endsAt && (
                <div style={{ fontSize: '.8rem', color: 'var(--tx2)' }}>
                  {isActive && status !== 'canceling' ? tr('dash.nextPayment') : tr('dash.accessUntil')}: {endsAt.toLocaleDateString(locale)}
                </div>
              )}
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '1.8rem', fontWeight: 700, color: 'var(--tx)' }}>€{currentPlan.price}</div>
              <div style={{ color: 'var(--tx2)', fontSize: '.78rem' }}>{tr('dash.perMonth')}</div>
            </div>
          </div>
          {!native && isActive && status !== 'canceling' && (
            <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid rgba(var(--seprgb),.08)' }}>
              {!cancelConfirm ? (
                <button onClick={() => setCancelConfirm(true)} style={{ background: 'none', border: 'none', color: '#ff3b30', fontSize: '.82rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>
                  {tr('dash.cancelSub')}
                </button>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '.82rem', color: 'var(--tx2)' }}>{tr('dash.confirmCancel')}</span>
                  <Btn small variant="danger" onClick={cancel} disabled={loading}>{tr('dash.yesCancel')}</Btn>
                  <Btn small variant="gray" onClick={() => setCancelConfirm(false)}>{tr('dash.no')}</Btn>
                </div>
              )}
            </div>
          )}
        </Card>
      )}

      {/* Stripe Customer Portal: обновить карту, посмотреть инвойсы */}
      {!native && isActive && (restaurant as any)?.stripe_customer_id && (
        <Card style={{ marginBottom: 16, background: 'var(--fill2)', boxShadow: 'none' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: '.88rem', color: 'var(--tx)', marginBottom: 2 }}>{tr('dash.manageCard')}</div>
              <div style={{ fontSize: '.78rem', color: 'var(--tx2)' }}>{tr('dash.manageCardSub')}</div>
            </div>
            <button onClick={openPortal} disabled={portalLoading} style={{ background: 'var(--surface)', border: '1px solid rgba(var(--seprgb),.15)', borderRadius: 10, padding: '9px 16px', fontSize: '.82rem', fontWeight: 600, color: '#007aff', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
              {portalLoading ? '...' : tr('dash.openPortal')}
            </button>
          </div>
        </Card>
      )}

      {!native && <>
      <div style={{ fontWeight: 600, fontSize: '.78rem', color: 'var(--tx2)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '.06em' }}>
        {currentPlan ? tr('dash.changePlan') : tr('dash.choosePlan')}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 12, marginBottom: 16 }}>
        {PLANS.map(plan => {
          const isCurrent = restaurant?.subscription_plan === plan.id
          return (
            <Card key={plan.id} style={{ border: `2px solid ${isCurrent ? plan.color : plan.popular ? plan.color + '40' : 'rgba(var(--seprgb),.1)'}`, position: 'relative', padding: 16 }}>
              {plan.popular && !isCurrent && (
                <div style={{ position: 'absolute', top: -10, left: '50%', transform: 'translateX(-50%)', background: plan.color, color: '#fff', fontSize: '.65rem', fontWeight: 700, padding: '3px 10px', borderRadius: 980, whiteSpace: 'nowrap' }}>{tr('dash.popular')}</div>
              )}
              {isCurrent && (
                <div style={{ position: 'absolute', top: -10, left: '50%', transform: 'translateX(-50%)', background: plan.color, color: '#fff', fontSize: '.65rem', fontWeight: 700, padding: '3px 10px', borderRadius: 980, whiteSpace: 'nowrap' }}>{tr('dash.current')}</div>
              )}
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontWeight: 700, fontSize: '1.05rem', color: 'var(--tx)', marginBottom: 2 }}>{plan.name}</div>
                <div style={{ fontSize: '1.5rem', fontWeight: 700, color: plan.color }}>€{plan.price}<span style={{ fontSize: '.75rem', color: 'var(--tx2)', fontWeight: 400 }}>{tr('dash.perMo')}</span></div>
              </div>
              <div style={{ marginBottom: 14 }}>
                {plan.features.map(f => (
                  <div key={f} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '.8rem', color: 'var(--tx2)', marginBottom: 4 }}>
                    <span style={{ color: plan.color, fontWeight: 700 }}>✓</span> {tr(f)}
                  </div>
                ))}
              </div>
              <button type="button" onClick={() => !isCurrent && subscribe(plan.id)} disabled={isCurrent}
                style={{ width: '100%', padding: '10px 0', borderRadius: 10, border: 'none', background: isCurrent ? 'var(--fill)' : plan.color, color: isCurrent ? 'var(--tx3)' : '#fff', fontFamily: 'inherit', fontSize: '.85rem', fontWeight: 600, cursor: isCurrent ? 'default' : 'pointer' }}>
                {isCurrent ? tr('dash.active') : pendingPlan === plan.id ? tr('dash.openingPayment') : tr('dash.choose')}
              </button>
            </Card>
          )
        })}
      </div>

      <div style={{ textAlign: 'center', fontSize: '.75rem', color: 'var(--tx3)' }}>
        {tr('dash.stripeNote')}
      </div>
      </>}
    </div>
  )
}

// ── OVERVIEW TAB ──────────────────────────────────────────────────────────────
// Один вопрос экрана: «как дела сегодня?» — касса, кальяны, заказы + максимум 2 аномалии.

function OverviewTab({ restaurant, onGo }: { restaurant: Restaurant | null; onGo: (tab: string) => void }) {
  const { t: tr, locale } = useI18n()
  const cur = restaurant?.currency || '€'
  const plan = restaurant?.subscription_plan || ''
  const status = restaurant?.subscription_status || ''
  const isActive = status === 'active' || status === 'trialing' || status === 'canceling'
  const appOk = (id: string) => {
    const a = APPS.find(x => x.id === id)
    return isActive && !!a && (a.plans.includes(plan) || ((restaurant as any)?.comp_apps || []).includes(id))
  }

  const [loading, setLoading] = useState(true)
  const [shift, setShift] = useState<any>(null)
  const [hookah, setHookah] = useState({ qty: 0, revenue: 0 })
  const [orders, setOrders] = useState({ total: 0, fresh: 0 })
  const [setup, setSetup] = useState({ hasStaff: false, hasShift: false })

  useEffect(() => {
    if (!restaurant?.id) return
    let gone = false
    ;(async () => {
      const today = fmtDay(new Date())
      const dayStartISO = new Date(new Date().setHours(0, 0, 0, 0)).toISOString()
      const [shiftRes, hookahRes, ordersRes, staffRes, anyShiftRes] = await Promise.all([
        db.from('shifts').select('*').eq('restaurant_id', restaurant.id).eq('date', today).order('opened_at', { ascending: false }).limit(1),
        appOk('stash') ? db.from('hookah_sales').select('quantity, price, is_free, date').eq('date', today) : Promise.resolve({ data: [] }),
        appOk('menu') ? db.from('menu_orders').select('id, status, created_at').gte('created_at', dayStartISO) : Promise.resolve({ data: [] }),
        db.from('employees').select('id').eq('restaurant_id', restaurant.id).eq('is_active', true).limit(1),
        db.from('shifts').select('id').eq('restaurant_id', restaurant.id).limit(1),
      ])
      if (gone) return
      setSetup({ hasStaff: (staffRes.data || []).length > 0, hasShift: (anyShiftRes.data || []).length > 0 })
      setShift((shiftRes.data || [])[0] || null)
      const hs = hookahRes.data || []
      setHookah({
        qty: hs.reduce((s: number, r: any) => s + (r.quantity || 0), 0),
        revenue: hs.reduce((s: number, r: any) => s + (r.is_free ? 0 : (r.price || 0) * (r.quantity || 0)), 0),
      })
      const os = ordersRes.data || []
      setOrders({ total: os.length, fresh: os.filter((o: any) => o.status === 'new').length })
      setLoading(false)
    })()
    return () => { gone = true }
  }, [restaurant?.id])

  // Аномалии: показываем максимум две, по убыванию важности
  const issues: { key: string; title: string; sub: string; color: string; tab?: string }[] = []
  if (status === 'past_due') issues.push({ key: 'pd', title: tr('dash.paymentFailed'), sub: tr('dash.updateCardElseLock'), color: '#ff3b30', tab: 'billing' })
  if (!loading && (!shift || shift.status !== 'open')) issues.push({ key: 'sh', title: tr('dash.shiftNotOpen'), sub: tr('dash.managerNotOpenedShift'), color: '#ff9500' })
  if (orders.fresh > 0) issues.push({ key: 'or', title: tr('dash.newOrdersN', { n: orders.fresh }), sub: tr('dash.waitingAcceptance'), color: '#007aff', tab: 'notifications' })
  if (status === 'canceling' && restaurant?.subscription_ends_at) issues.push({ key: 'cn', title: tr('dash.subCancelled'), sub: tr('dash.accessUntilD', { date: new Date(restaurant.subscription_ends_at).toLocaleDateString(locale) }), color: '#ff9500', tab: 'billing' })

  const stats: { l: string; v: string; c: string }[] = [
    { l: tr('dash.cash'), v: `${cur}${(shift?.income || 0).toLocaleString()}`, c: '#007aff' },
    { l: tr('dash.card'), v: `${cur}${(shift?.income_card || 0).toLocaleString()}`, c: '#34c759' },
    ...(appOk('stash') ? [{ l: tr('dash.hookahs'), v: `${hookah.qty} · ${cur}${hookah.revenue.toLocaleString()}`, c: '#ff9500' }] : []),
    ...(appOk('menu') ? [{ l: tr('dash.menuOrders'), v: String(orders.total), c: '#ff2d55' }] : []),
  ]

  // Шаги настройки: data-driven, ведём до полной активации (даже после оплаты — пока не добавлены
  // сотрудники и не открыта первая смена). Скрываем, когда всё готово.
  const allSteps = [
    { done: true,          label: tr('dash.stepAccount'),       sub: null,                    tab: null },
    { done: isActive,      label: tr('dash.stepActivateSub'),   sub: tr('dash.days7free'),    tab: 'billing' },
    { done: setup.hasStaff, label: tr('dash.stepAddStaff'),      sub: tr('dash.givePins'),     tab: 'team' },
    { done: setup.hasShift, label: tr('dash.stepFirstShift'),    sub: tr('dash.viaManager'),   tab: 'apps' },
  ]
  const setupDone = allSteps.every(s => s.done)
  const nextStepIdx = allSteps.findIndex(s => !s.done)
  const setupSteps = !loading && !setupDone ? allSteps : null

  return (
    <div>
      <SectionTitle title={tr('dash.navOverview')} sub={new Date().toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' })} />

      {/* Onboarding: показывается пока нет активной подписки */}
      {setupSteps && (
        <Card style={{ marginBottom: 16, border: '1px solid rgba(0,122,255,.18)', background: 'linear-gradient(135deg,rgba(0,122,255,.05) 0%,rgba(88,86,214,.05) 100%)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <div style={{ fontWeight: 700, fontSize: '.95rem', color: 'var(--tx)' }}>{tr('dash.whereToStart')}</div>
            <div style={{ fontSize: '.72rem', fontWeight: 700, color: '#007aff', background: 'rgba(0,122,255,.1)', padding: '3px 10px', borderRadius: 980 }}>
              {allSteps.filter(s => s.done).length} {tr('dash.ofWord')} {allSteps.length}
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {setupSteps.map((step, i) => (
              <button key={i} onClick={step.tab && !step.done ? () => onGo(step.tab!) : undefined}
                style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderRadius: 12, border: 'none', background: step.done ? 'rgba(52,199,89,.08)' : 'var(--surface)', cursor: step.tab && !step.done ? 'pointer' : 'default', textAlign: 'left', width: '100%', fontFamily: 'inherit' }}>
                <div style={{ width: 28, height: 28, borderRadius: '50%', background: step.done ? '#34c759' : i === nextStepIdx ? '#007aff' : 'var(--fill)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  {step.done
                    ? <svg width="12" height="10" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 12 10"><path d="M1 5l3.5 3.5L11 1" /></svg>
                    : <span style={{ fontSize: '.72rem', fontWeight: 700, color: i === nextStepIdx ? '#fff' : 'var(--tx3)' }}>{i + 1}</span>}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '.88rem', fontWeight: 600, color: step.done ? '#34c759' : 'var(--tx)' }}>{step.label}</div>
                  {step.sub && <div style={{ fontSize: '.74rem', color: 'var(--tx2)', marginTop: 1 }}>{step.sub}</div>}
                </div>
                {step.tab && !step.done && <svg width="7" height="12" fill="none" stroke="var(--tx3)" strokeWidth="2.2" strokeLinecap="round" viewBox="0 0 8 14"><path d="M2 1l6 6-6 6" /></svg>}
              </button>
            ))}
          </div>
        </Card>
      )}

      {loading ? (
        // Скелетоны той же геометрии, что и контент — данные «проявляются», а не грузятся
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10 }}>
          {[0, 1, 2, 3].map(i => <div key={i} style={{ height: 76, borderRadius: 16, background: 'var(--fill)', animation: 'dashPulse 1.2s ease-in-out infinite' }} />)}
        </div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10, marginBottom: 16 }}>
            {stats.map(it => (
              <Card key={it.l} style={{ padding: '14px 16px' }}>
                <div style={{ fontSize: '.68rem', color: 'var(--tx2)', fontWeight: 600, textTransform: 'uppercase', marginBottom: 4, letterSpacing: '.04em' }}>{it.l}</div>
                <div style={{ fontSize: '1.3rem', fontWeight: 700, color: it.c, whiteSpace: 'nowrap' }}>{it.v}</div>
              </Card>
            ))}
          </div>

          {shift?.status === 'open' && (
            <Card style={{ marginBottom: 10, padding: '12px 16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: '.85rem', color: 'var(--tx2)' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#34c759', flexShrink: 0 }} />
                {tr('dash.shiftOpenLine', { v: `${cur}${(shift.closing_balance || 0).toLocaleString()}` })}
              </div>
            </Card>
          )}

          {issues.slice(0, 2).map(it => (
            <Card key={it.key} onClick={it.tab ? () => onGo(it.tab!) : undefined}
              style={{ marginBottom: 10, padding: '12px 16px', borderLeft: `3px solid ${it.color}` }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: '.88rem', color: 'var(--tx)' }}>{it.title}</div>
                  <div style={{ fontSize: '.78rem', color: 'var(--tx2)', marginTop: 1 }}>{it.sub}</div>
                </div>
                {it.tab && <svg width="8" height="14" fill="none" stroke="var(--tx3)" strokeWidth="2.2" strokeLinecap="round" viewBox="0 0 10 18"><path d="M2 1l7 8-7 8" /></svg>}
              </div>
            </Card>
          ))}

          {issues.length === 0 && (
            <Card style={{ padding: '12px 16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: '.85rem', color: 'var(--tx2)' }}>
                <span style={{ color: '#34c759', fontWeight: 700 }}>✓</span> {tr('dash.allGood')}
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  )
}

// ── NOTIFICATIONS TAB ─────────────────────────────────────────────────────────
// Не раздел с табами, а одна лента: заказы, вызовы официанта, события подписки.

function NotificationsTab({ restaurant, onSeen }: { restaurant: Restaurant | null; onSeen: () => void }) {
  const { t: tr } = useI18n()
  const [rows, setRows] = useState<any[]>([])
  const [lowStock, setLowStock] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const status = restaurant?.subscription_status || ''

  useEffect(() => { onSeen() }, [])
  useEffect(() => {
    if (!restaurant?.id) return
    const from = new Date(Date.now() - 2 * 864e5).toISOString()
    Promise.all([
      db.from('menu_orders').select('*').gte('created_at', from).order('created_at', { ascending: false }).limit(50),
      db.from('tobacco_stock').select('flavor_name, brand, flavor, quantity_g, min_quantity_g'),
    ]).then(([ord, stock]: any) => {
      setRows(ord.data || [])
      const low = (stock.data || [])
        .filter((s: any) => Number(s.quantity_g || 0) <= Number(s.min_quantity_g ?? 100))
        .sort((a: any, b: any) => Number(a.quantity_g || 0) - Number(b.quantity_g || 0))
      setLowStock(low)
      setLoading(false)
    })
  }, [restaurant?.id])

  const stockName = (s: any) => s.flavor_name || [s.brand, s.flavor].filter(Boolean).join(' ') || tr('dash.tobacco')

  const orderStatus: Record<string, { label: string; color: string }> = {
    new: { label: 'pe.osNew', color: '#ff9500' }, in_progress: { label: 'pe.osInProgress', color: '#007aff' },
    done: { label: 'pe.osDone', color: '#34c759' }, cancelled: { label: 'pe.osCancelled', color: 'var(--tx3)' },
  }

  return (
    <div>
      <SectionTitle title={tr('dash.navNotifications')} sub={tr('dash.notifsSub')} />

      {status === 'past_due' && (
        <Card style={{ marginBottom: 10, padding: '12px 16px', borderLeft: '3px solid #ff3b30' }}>
          <div style={{ fontWeight: 600, fontSize: '.88rem', color: 'var(--tx)' }}>{tr('dash.subPaymentFailed')}</div>
          <div style={{ fontSize: '.78rem', color: 'var(--tx2)', marginTop: 1 }}>{tr('dash.stripeRetry')}</div>
        </Card>
      )}

      {/* Проактивно: заканчивающийся табак (Stash) */}
      {lowStock.slice(0, 5).map((s, i) => {
        const out = Number(s.quantity_g || 0) <= 0
        return (
          <Card key={`low-${i}`} style={{ marginBottom: 10, padding: '12px 16px', borderLeft: `3px solid ${out ? '#ff3b30' : '#ff9500'}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 34, height: 34, borderRadius: 10, background: (out ? '#ff3b30' : '#ff9500') + '15', color: out ? '#ff3b30' : '#ff9500', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" viewBox="0 0 24 24"><path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /></svg>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: '.88rem', color: 'var(--tx)' }}>{out ? tr('dash.tobaccoOut') : tr('dash.tobaccoLow')}</div>
                <div style={{ fontSize: '.78rem', color: 'var(--tx2)', marginTop: 1 }}>{stockName(s)} · {Math.round(Number(s.quantity_g || 0))} г</div>
              </div>
            </div>
          </Card>
        )
      })}

      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[0, 1, 2].map(i => <div key={i} style={{ height: 64, borderRadius: 16, background: 'var(--fill)', animation: 'dashPulse 1.2s ease-in-out infinite' }} />)}
        </div>
      ) : rows.length === 0 && lowStock.length === 0 ? (
        <Card><div style={{ textAlign: 'center', padding: '28px 0', color: 'var(--tx2)', fontSize: '.88rem' }}>{tr('dash.quietNoNotifs')}</div></Card>
      ) : rows.length === 0 ? null : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {rows.map(o => {
            const isCall = Array.isArray(o.items) && o.items[0]?.call === 'waiter'
            const st = orderStatus[o.status] || orderStatus.new
            const count = isCall ? 0 : (Array.isArray(o.items) ? o.items.reduce((s: number, i: any) => s + (i.qty || 1), 0) : 0)
            return (
              <Card key={o.id} style={{ padding: '12px 16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ width: 34, height: 34, borderRadius: 10, background: (isCall ? '#ff9500' : '#ff2d55') + '15', color: isCall ? '#ff9500' : '#ff2d55', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    {isCall
                      ? <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" viewBox="0 0 24 24"><path d="M18 8.4a6 6 0 10-12 0c0 6.6-2.7 8.6-2.7 8.6h17.4S18 15 18 8.4"/><path d="M13.7 21a2 2 0 01-3.4 0"/></svg>
                      : <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: '.88rem', color: 'var(--tx)' }}>
                      {isCall ? tr('dash.waiterCall') : tr('dash.orderNItems', { n: count })}{o.table_number ? ` · ${tr('dash.tableWord')} ${o.table_number}` : ''}
                    </div>
                    <div style={{ fontSize: '.75rem', color: 'var(--tx2)', marginTop: 1 }}>{timeAgo(o.created_at)}</div>
                  </div>
                  <span style={{ fontSize: '.7rem', fontWeight: 700, color: st.color, background: 'var(--fill)', padding: '3px 10px', borderRadius: 980, flexShrink: 0 }}>{tr(st.label)}</span>
                </div>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── ACCOUNT TAB ───────────────────────────────────────────────────────────────

function AccountTab({ restaurant, user }: { restaurant: Restaurant | null; user: any }) {
  const { t: tr } = useI18n()
  const router = useRouter()
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const planName = PLANS.find(p => p.id === restaurant?.subscription_plan)?.name

  const deleteAccount = async () => {
    setDeleting(true)
    try {
      const res = await fetch('/api/account/delete', { method: 'POST' })
      const data = await res.json()
      if (data.error) { alert(data.error); return }
      await supabase.auth.signOut()
      router.replace('/auth/login')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div>
      <SectionTitle title={tr('dash.account')} sub={tr('dash.accountSub')} />

      <Card style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ width: 56, height: 56, borderRadius: 14, background: 'var(--fill)', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: '1.4rem', fontWeight: 700, color: 'var(--tx2)' }}>
            {restaurant?.logo_url
              ? <img src={restaurant.logo_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              : (restaurant?.name || 'M')[0].toUpperCase()}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: '1.05rem', color: 'var(--tx)' }}>{restaurant?.name || tr('dash.myRestaurant')}</div>
            <div style={{ fontSize: '.8rem', color: 'var(--tx2)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis' }}>{user?.email}</div>
          </div>
          {planName && <span style={{ fontSize: '.7rem', fontWeight: 700, color: '#007aff', background: '#007aff12', padding: '3px 10px', borderRadius: 980, flexShrink: 0 }}>{planName}</span>}
        </div>
      </Card>

      <Card style={{ marginBottom: 14 }}>
        <button onClick={async () => { await supabase.auth.signOut(); router.replace('/auth/login') }}
          style={{ background: 'none', border: 'none', color: '#ff3b30', fontSize: '.88rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>
          {tr('dash.signOut')}
        </button>
      </Card>

      <Card style={{ marginBottom: 14, display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center' }}>
        <button onClick={openCookieSettings}
          style={{ background: 'none', border: 'none', color: 'var(--tx2)', fontSize: '.84rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>
          {tr('dash.cookieSettings')}
        </button>
        <a href="/privacy.html" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--tx2)', fontSize: '.84rem', fontWeight: 600, textDecoration: 'none' }}>{tr('dash.privacy')}</a>
        <a href="/terms.html" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--tx2)', fontSize: '.84rem', fontWeight: 600, textDecoration: 'none' }}>{tr('dash.terms')}</a>
      </Card>

      <Card style={{ border: '1px solid rgba(255,59,48,.15)' }}>
        <div style={{ fontWeight: 600, fontSize: '.9rem', marginBottom: 4, color: 'var(--tx)' }}>{tr('dash.dangerZone')}</div>
        <div style={{ fontSize: '.82rem', color: 'var(--tx2)', marginBottom: 14 }}>{tr('dash.deleteAccountNote')}</div>
        {!deleteConfirm ? (
          <Btn variant="danger" onClick={() => setDeleteConfirm(true)}>{tr('dash.deleteAccount')}</Btn>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: '.82rem', color: '#ff3b30', fontWeight: 600 }}>{tr('dash.sureIrreversible')}</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <Btn variant="danger" small onClick={deleteAccount} disabled={deleting}>
                {deleting ? tr('dash.deleting') : tr('dash.yesDeleteAll')}
              </Btn>
              <Btn variant="ghost" small onClick={() => setDeleteConfirm(false)}>{tr('dash.cancel')}</Btn>
            </div>
          </div>
        )}
      </Card>
    </div>
  )
}

// ── MAIN ──────────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const { t: tr } = useI18n()
  const router = useRouter()
  // Тёмная тема: цвета дашборда — CSS-переменные (globals.css), класс mise-dark на <html>
  const theme = useTheme('mise_dash_dark')
  useEffect(() => {
    document.documentElement.classList.toggle('mise-dark', !!theme.dark)
    return () => { document.documentElement.classList.remove('mise-dark') }
  }, [theme.dark])
  const [showSplash, setShowSplash] = useState(() => {
    if (typeof window === 'undefined') return false
    const shown = sessionStorage.getItem('mise_splash_shown')
    return !shown
  })
  const [user, setUser] = useState<any>(null)
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null)
  const [tab, setTab] = useState('overview')
  const [sideCollapsed, setSideCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false
    return localStorage.getItem('mise_dash_side_collapsed') === '1'
  })
  const toggleSide = () => setSideCollapsed(c => {
    const next = !c
    localStorage.setItem('mise_dash_side_collapsed', next ? '1' : '0')
    return next
  })
  const [authChecked, setAuthChecked] = useState(false)
  const [unseen, setUnseen] = useState(0)

  const loadRestaurant = async (userId: string) => {
    const { data } = await db.from('restaurants').select('*').eq('owner_id', userId).single()
    setRestaurant(data)
  }

  // Переходы — состояние внутри страницы; URL синхронизируется без перезагрузок
  const go = (id: string) => {
    setTab(id)
    history.replaceState(null, '', `/dashboard?tab=${id}`)
  }

  // Бейдж уведомлений: новые заказы, появившиеся после последнего открытия ленты
  useEffect(() => {
    if (!restaurant?.id) return
    const check = async () => {
      const seen = +(localStorage.getItem('mise_notif_seen') || 0)
      const { data } = await db.from('menu_orders').select('id, created_at, status').eq('status', 'new').limit(50)
      setUnseen((data || []).filter((o: any) => new Date(o.created_at).getTime() > seen).length)
    }
    check()
    const iv = setInterval(check, 60000)
    return () => clearInterval(iv)
  }, [restaurant?.id])
  const markSeen = () => { localStorage.setItem('mise_notif_seen', String(Date.now())); setUnseen(0) }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const t = params.get('tab')
    if (t) setTab(t === 'categories' ? 'settings' : t) // категории переехали в настройки
    supabase.auth.getSession().then(async ({ data }) => {
      if (!data.session?.user) {
        setAuthChecked(true)
        router.replace('/auth/login')
        return
      }
      setUser(data.session.user)
      await loadRestaurant(data.session.user.id)
      setAuthChecked(true)
      // После оплаты Stripe редиректит раньше, чем доходит вебхук —
      // дотягиваем статус ~20 секунд, чтобы подписка не выглядела «не оформленной»
      if (params.get('success') === '1') {
        const uid = data.session.user.id
        for (let i = 0; i < 8; i++) {
          await new Promise(r => setTimeout(r, 2500))
          const { data: rest } = await db.from('restaurants').select('*').eq('owner_id', uid).single()
          if (rest) setRestaurant(rest)
          if (rest && (rest.subscription_status === 'active' || rest.subscription_status === 'trialing')) break
        }
      }
    })
  }, [])

  if (!authChecked || !user) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: '-apple-system,sans-serif', color: 'var(--tx2)', fontSize: '.9rem', background: 'var(--bg)' }}>
      {/* На первом (холодном) заходе бренд-момент — это SplashScreen ниже; пред-индикатор
          не показываем, чтобы не было «надпись+спиннер → потом анимация». На перезаходе
          (сплэш уже был в сессии) показываем аккуратный вордмарк+спиннер. */}
      {!showSplash && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
          <Wordmark size={34} />
          <Spinner compact />
        </div>
      )}
    </div>
  )

  const SideItem = ({ id, label, badge = 0 }: { id: string; label: string; badge?: number }) => {
    const active = tab === id
    const handle = () => { go(id); if (id === 'notifications') markSeen() }
    if (sideCollapsed) return (
      <button onClick={handle} title={tr(label)} style={{
        position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center',
        width: 40, height: 40, borderRadius: 10, border: 'none', fontFamily: 'inherit',
        background: active ? 'var(--fill)' : 'transparent', color: active ? 'var(--tx)' : 'var(--tx2)',
        cursor: 'pointer', margin: '0 auto',
      }}>
        <TabIcon id={id} size={17} />
        {badge > 0 && <span style={{ position: 'absolute', top: 7, right: 7, width: 7, height: 7, borderRadius: '50%', background: '#ff3b30', border: '2px solid var(--surface)' }} />}
      </button>
    )
    return (
      <button onClick={handle} style={{
        display: 'flex', alignItems: 'center', gap: 10, width: '100%',
        padding: '9px 12px', borderRadius: 10, border: 'none', fontFamily: 'inherit',
        fontSize: '.85rem', fontWeight: active ? 600 : 500, textAlign: 'left',
        background: active ? 'var(--fill)' : 'transparent',
        color: active ? 'var(--tx)' : 'var(--tx2)', cursor: 'pointer',
      }}>
        <TabIcon id={id} size={16} />
        <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden' }}>{tr(label)}</span>
        {badge > 0 && <span style={{ fontSize: '.65rem', fontWeight: 700, color: '#fff', background: '#ff3b30', borderRadius: 980, padding: '1px 7px' }}>{badge}</span>}
      </button>
    )
  }

  const avatar = (size: number) => (
    <div style={{ width: size, height: size, borderRadius: size * 0.3, background: 'var(--fill)', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: size * 0.42, fontWeight: 700, color: 'var(--tx2)' }}>
      {restaurant?.logo_url
        ? <img src={restaurant.logo_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        : (restaurant?.name || 'M')[0].toUpperCase()}
    </div>
  )

  return (
    <>
      {showSplash && <SplashScreen onDone={() => { sessionStorage.setItem('mise_splash_shown', '1'); setShowSplash(false) }} />}

      <div style={{ minHeight: '100vh', background: 'var(--bg)', fontFamily: '-apple-system,BlinkMacSystemFont,sans-serif', WebkitFontSmoothing: 'antialiased', '--dash-side-w': sideCollapsed ? '64px' : '232px' } as any}>
        <style>{`
          /* Тактильный отклик: на iPhone без :active кнопки выглядят «мёртвыми» */
          button { -webkit-tap-highlight-color: transparent; transition: transform .1s ease, opacity .15s ease, background .15s ease; }
          button:active:not(:disabled) { transform: scale(.96); opacity: .8; }
          /* Контент проявляется: crossfade + сдвиг 8px; рама (сайдбар/шапка) неподвижна */
          @keyframes dashIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
          @keyframes dashPulse { 0%, 100% { opacity: 1; } 50% { opacity: .45; } }
          .dash-fade { animation: dashIn .16s ease-out; }
          .dash-side { display: none; }
          @media (min-width: 900px) {
            .dash-side { display: flex; }
            .dash-mobilebar, .dash-pills { display: none !important; }
            .dash-content { margin-left: var(--dash-side-w, 232px); transition: margin-left .28s cubic-bezier(.32,.72,0,1); will-change: margin-left; }
          }
        `}</style>

        {/* Сайдбар (desktop): два этажа — работа / обслуживание, аккаунт внизу */}
        <aside className="dash-side" style={{
          position: 'fixed', top: 0, left: 0, bottom: 0,
          width: sideCollapsed ? 64 : 232,
          flexDirection: 'column', padding: '20px 12px 16px',
          borderRight: '1px solid rgba(var(--seprgb),.1)',
          background: 'var(--surface)', zIndex: 100, boxSizing: 'border-box',
          overflow: 'hidden', transition: 'width .28s cubic-bezier(.32,.72,0,1)', willChange: 'width', whiteSpace: 'nowrap',
        }}>
          {/* Заголовок: wordmark + кнопка свернуть / развернуть */}
          {sideCollapsed ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, marginBottom: 14 }}>
              <WordmarkMark size={26} />
              <button onClick={toggleSide} title={tr('dash.expand')} style={{
                width: 28, height: 28, borderRadius: 8, background: 'var(--fill)', border: 'none',
                cursor: 'pointer', color: 'var(--tx2)', display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" viewBox="0 0 12 12"><path d="M4 2l4 4-4 4" /></svg>
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 4px 0 12px', marginBottom: 24 }}>
              <Wordmark size={24} />
              <button onClick={toggleSide} title={tr('dash.collapse')} style={{
                width: 28, height: 28, borderRadius: 8, background: 'var(--fill)', border: 'none',
                cursor: 'pointer', color: 'var(--tx2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}>
                <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" viewBox="0 0 12 12"><path d="M8 2L4 6l4 4" /></svg>
              </button>
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {NAV_MAIN.map(t => <SideItem key={t.id} id={t.id} label={t.label} />)}
          </div>
          <div style={{ height: 1, background: 'rgba(var(--seprgb),.1)', margin: sideCollapsed ? '10px 8px' : '14px 12px' }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {NAV_SERVICE.map(t => <SideItem key={t.id} id={t.id} label={t.label} badge={t.id === 'notifications' ? unseen : 0} />)}
          </div>
          <div style={{ flex: 1 }} />

          {/* Аккаунт */}
          {sideCollapsed ? (
            <button onClick={() => go('account')} title={tr('dash.account')} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 40, height: 40, borderRadius: 10, border: 'none', cursor: 'pointer',
              background: tab === 'account' ? 'var(--fill)' : 'transparent', margin: '0 auto',
            }}>
              {avatar(32)}
            </button>
          ) : (
            <button onClick={() => go('account')} style={{
              display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '10px 12px',
              borderRadius: 12, border: 'none', fontFamily: 'inherit', cursor: 'pointer', textAlign: 'left',
              background: tab === 'account' ? 'var(--fill)' : 'transparent',
            }}>
              {avatar(32)}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '.82rem', fontWeight: 600, color: 'var(--tx)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{restaurant?.name || tr('dash.myRestaurant')}</div>
                <div style={{ fontSize: '.68rem', color: 'var(--tx3)' }}>{tr('dash.account')}</div>
              </div>
            </button>
          )}
        </aside>

        {/* Шапка (mobile): логотип + колокольчик + аватар */}
        <nav className="dash-mobilebar" style={{ background: 'var(--navbg)', backdropFilter: 'blur(20px)', borderBottom: '1px solid rgba(var(--seprgb),.1)', padding: '0 16px', height: 52, display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 100 }}>
          <Wordmark size={22} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button onClick={() => { go('notifications'); markSeen() }} style={{ position: 'relative', width: 32, height: 32, borderRadius: '50%', background: 'var(--fill)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--tx)' }}>
              <TabIcon id="notifications" size={15} />
              {unseen > 0 && <span style={{ position: 'absolute', top: 2, right: 2, width: 9, height: 9, borderRadius: '50%', background: '#ff3b30', border: '2px solid var(--bg)' }} />}
            </button>
            <button onClick={() => go('account')} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>{avatar(32)}</button>
          </div>
        </nav>

        <div className="dash-content">
          <div style={{ maxWidth: 880, margin: '0 auto', padding: '20px 16px' }}>
            {/* Пилюли (mobile) */}
            <div className="dash-pills" style={{ display: 'flex', gap: 4, marginBottom: 20, overflowX: 'auto', paddingBottom: 2, scrollbarWidth: 'none' }}>
              {[...NAV_MAIN, ...NAV_SERVICE].map(t => (
                <button key={t.id} onClick={() => { go(t.id); if (t.id === 'notifications') markSeen() }} style={{
                  display: 'flex', alignItems: 'center', gap: 7,
                  padding: '7px 15px', borderRadius: 10, border: 'none', fontFamily: 'inherit',
                  fontSize: '.8rem', fontWeight: tab === t.id ? 700 : 500,
                  cursor: 'pointer', whiteSpace: 'nowrap',
                  background: tab === t.id ? 'var(--tx)' : 'var(--surface)',
                  color: tab === t.id ? 'var(--tabon)' : 'var(--tx2)',
                  boxShadow: tab === t.id ? 'none' : '0 1px 3px rgba(0,0,0,.06)',
                }}>
                  <TabIcon id={t.id} />
                  {tr(t.label)}
                </button>
              ))}
            </div>

            {/* key={tab} перезапускает анимацию проявления при каждом переходе */}
            <main key={tab} className="dash-fade">
              {tab === 'overview'      && <OverviewTab restaurant={restaurant} onGo={go} />}
              {tab === 'apps'          && <AppsTab restaurant={restaurant} />}
              {tab === 'team'          && <TeamTab restaurant={restaurant} />}
              {tab === 'notifications' && <NotificationsTab restaurant={restaurant} onSeen={markSeen} />}
              {tab === 'settings'      && <SettingsTab restaurant={restaurant} theme={theme} onUpdate={() => user && loadRestaurant(user.id)} />}
              {tab === 'billing'       && <BillingTab restaurant={restaurant} user={user} onRefresh={() => user && loadRestaurant(user.id)} />}
              {tab === 'account'       && <AccountTab restaurant={restaurant} user={user} />}
            </main>
          </div>
        </div>
      </div>
    </>
  )
}
