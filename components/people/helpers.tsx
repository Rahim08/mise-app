// Shared helpers for People module components.
import { tCurrent } from '@/lib/i18n'

export function mondayOf(d: Date) {
  const x = new Date(d); const day = x.getDay()
  x.setDate(x.getDate() - (day === 0 ? 6 : day - 1)); x.setHours(0, 0, 0, 0)
  return x
}

export function addDays(d: Date, n: number) { const x = new Date(d); x.setDate(x.getDate() + n); return x }

export function hhmm(t: string | null) { return t ? t.slice(0, 5) : '' }

export function timeRange(a: string | null, b: string | null) {
  if (!a) return ''
  return `${hhmm(a)}${b ? '–' + hhmm(b) : ''}`
}

export function dayLabel(dateStr: string) {
  const d = new Date(dateStr + 'T00:00:00')
  return `${d.getDate()} ${MON()[d.getMonth()]}`
}

export function navBtn(t: any): React.CSSProperties {
  return { width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 10, border: 'none', background: t.surface2, color: t.text2, cursor: 'pointer', flexShrink: 0 }
}

export function roleLabel(role?: string) {
  switch (role) {
    case 'manager': return 'pe.roleManager'
    case 'barista': return 'pe.roleBarista'
    case 'waiter': return 'pe.roleWaiter'
    case 'hostess': return 'pe.roleHostess'
    case 'hookah': return 'pe.roleHookah'
    case 'cook': return 'pe.roleCook'
    case 'admin': return 'pe.roleAdmin'
    default: return role || ''
  }
}

export function getMe(rid: string): { id?: string; name?: string; role?: string; is_owner?: boolean } {
  try {
    const raw = typeof window !== 'undefined' ? localStorage.getItem(`mise_me_${rid}`) : null
    return raw ? JSON.parse(raw) : {}
  } catch { return {} }
}

export function Sheet({ children, onClose, t }: { children: React.ReactNode; onClose: () => void; t: any }) {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.35)' }} />
      <div style={{ position: 'relative', width: '100%', maxWidth: 480, maxHeight: '90vh', overflowY: 'auto', background: t.bg, borderRadius: '20px 20px 0 0', boxShadow: '0 -8px 40px rgba(0,0,0,.12)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <div style={{ display: 'flex', justifyContent: 'center', padding: '10px 0 4px' }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: t.sep2 }} />
        </div>
        {children}
      </div>
    </div>
  )
}

export function Placeholder({ title, sub, accent, t, icon }: { title: string; sub: string; accent: string; t: any; icon: React.ReactNode }) {
  return (
    <div style={{ textAlign: 'center', padding: '60px 20px' }}>
      <div style={{ width: 56, height: 56, borderRadius: 16, background: `${accent}14`, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', color: accent }}>{icon}</div>
      <div style={{ fontSize: 16, fontWeight: 700, color: t.text, marginBottom: 6 }}>{title}</div>
      <div style={{ fontSize: 13, color: t.text3, lineHeight: 1.5 }}>{sub}</div>
    </div>
  )
}

export const DOW_SHORT = () => [tCurrent('me.mon'), tCurrent('me.tue'), tCurrent('me.wed'), tCurrent('me.thu'), tCurrent('me.fri'), tCurrent('me.sat'), tCurrent('me.sun')]
const DOW_FULL_KEYS = ['pe.dowSun', 'pe.dowMon', 'pe.dowTue', 'pe.dowWed', 'pe.dowThu', 'pe.dowFri', 'pe.dowSat'] as const
export const DOW_FULL = () => DOW_FULL_KEYS.map(k => tCurrent(k))
const MON_KEYS = ['pe.monJan', 'pe.monFeb', 'pe.monMar', 'pe.monApr', 'pe.monMay', 'pe.monJun', 'pe.monJul', 'pe.monAug', 'pe.monSep', 'pe.monOct', 'pe.monNov', 'pe.monDec'] as const
export const MON = () => MON_KEYS.map(k => tCurrent(k))
