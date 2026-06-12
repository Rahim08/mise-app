'use client'
// Дизайн-система Mise — единые примитивы для всех экранов.
// Все компоненты тема-зависимые: принимают t = useTheme() и не содержат хардкод-цветов.
// Использование: новые экраны строить только из этих примитивов; старые переводить по мере правок.
import React from 'react'

type T = any // ReturnType<typeof useTheme> — any чтобы не тянуть hook в типы

// ── Card: базовая карточка-поверхность ───────────────────────────────────────
export function Card({ t, style, children, onClick }: { t: T; style?: React.CSSProperties; children: React.ReactNode; onClick?: () => void }) {
  return (
    <div onClick={onClick} style={{ background: t.surface, borderRadius: 16, padding: 16, boxShadow: t.sh, ...(onClick ? { cursor: 'pointer' } : {}), ...style }}>
      {children}
    </div>
  )
}

// ── SectionTitle: заголовок секции в стиле iOS Settings ──────────────────────
export function SectionTitle({ t, children }: { t: T; children: React.ReactNode }) {
  return <div style={{ fontSize: 12, fontWeight: 600, color: t.text3, textTransform: 'uppercase', letterSpacing: 0.5, padding: '12px 4px 8px' }}>{children}</div>
}

// ── Btn: основная/вторичная/опасная кнопка ────────────────────────────────────
export function Btn({ t, accent, variant = 'primary', disabled, onClick, style, children }: {
  t: T; accent?: string; variant?: 'primary' | 'secondary' | 'danger' | 'ghost'; disabled?: boolean; onClick?: () => void; style?: React.CSSProperties; children: React.ReactNode
}) {
  const a = accent || t.blue
  const base: React.CSSProperties = { width: '100%', padding: '15px', borderRadius: 14, border: 'none', fontFamily: 'inherit', fontSize: 15, fontWeight: 700, cursor: disabled ? 'default' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }
  const variants: Record<string, React.CSSProperties> = {
    primary: { background: disabled ? t.fill : a, color: disabled ? t.text3 : '#fff', boxShadow: disabled ? 'none' : `0 4px 16px ${a}44` },
    secondary: { background: t.fill, color: t.text, fontWeight: 600 },
    danger: { background: `${t.red}18`, color: t.red, fontWeight: 600 },
    ghost: { background: 'transparent', color: a, fontWeight: 600 },
  }
  return <button disabled={disabled} onClick={onClick} style={{ ...base, ...variants[variant], ...style }}>{children}</button>
}

// ── Field: подпись + инпут ────────────────────────────────────────────────────
export function Field({ t, label, value, onChange, placeholder, type = 'text', autoFocus }: {
  t: T; label?: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string; autoFocus?: boolean
}) {
  return (
    <div style={{ marginBottom: 12 }}>
      {label && <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: t.text3, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6 }}>{label}</label>}
      <input type={type} value={value} autoFocus={autoFocus} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        style={{ width: '100%', padding: '12px 14px', borderRadius: 12, border: `1px solid ${t.sep2}`, fontSize: 16, color: t.text, background: t.surface, fontFamily: 'inherit', outline: 'none' }} />
    </div>
  )
}

// ── Toggle: iOS-переключатель ─────────────────────────────────────────────────
export function Toggle({ value, onChange, color = '#34c759', disabled }: { value: boolean; onChange: (v: boolean) => void; color?: string; disabled?: boolean }) {
  return (
    <div onClick={() => !disabled && onChange(!value)} style={{ width: 51, height: 31, borderRadius: 16, background: value ? color : 'rgba(120,120,128,0.32)', cursor: disabled ? 'default' : 'pointer', transition: 'background .25s', position: 'relative', flexShrink: 0, opacity: disabled ? 0.45 : 1 }}>
      <div style={{ position: 'absolute', top: 2, left: value ? 22 : 2, width: 27, height: 27, borderRadius: '50%', background: '#fff', boxShadow: '0 2px 6px rgba(0,0,0,0.25)', transition: 'left .25s' }} />
    </div>
  )
}

// ── Sheet: нижняя шторка (учитывает safe-area iPhone) ─────────────────────────
export function Sheet({ t, onClose, title, children }: { t: T; onClose: () => void; title?: string; children: React.ReactNode }) {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 500, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }} onClick={onClose}>
      <div style={{ background: t.bg, borderRadius: '24px 24px 0 0', width: '100%', maxWidth: 480, maxHeight: '85dvh', overflowY: 'auto', paddingBottom: 'calc(12px + env(safe-area-inset-bottom, 0px))', animation: 'miseSlideUp .3s ease' }} onClick={e => e.stopPropagation()}>
        <div style={{ width: 40, height: 4, background: t.fill, borderRadius: 2, margin: '14px auto 0' }} />
        {title && <div style={{ fontSize: 18, fontWeight: 700, textAlign: 'center', color: t.text, padding: '14px 20px 0' }}>{title}</div>}
        {children}
        <style>{`@keyframes miseSlideUp{from{opacity:0;transform:translateY(100%)}to{opacity:1;transform:translateY(0)}}`}</style>
      </div>
    </div>
  )
}

// ── Toast: всплывающее подтверждение ──────────────────────────────────────────
export function Toast({ t, children }: { t: T; children: React.ReactNode }) {
  if (!children) return null
  return (
    <div style={{ position: 'fixed', bottom: 100, left: '50%', transform: 'translateX(-50%)', background: t.dark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.85)', backdropFilter: 'blur(16px)', color: '#fff', padding: '12px 22px', borderRadius: 22, fontSize: 14, fontWeight: 600, zIndex: 600, whiteSpace: 'nowrap' }}>
      {children}
    </div>
  )
}

// ── Pill: статусная метка ─────────────────────────────────────────────────────
export function Pill({ color, children }: { color: string; children: React.ReactNode }) {
  return <span style={{ fontSize: 11, fontWeight: 700, color, background: `${color}1a`, padding: '3px 9px', borderRadius: 8 }}>{children}</span>
}

// ── Empty: пустое состояние с CTA ─────────────────────────────────────────────
export function Empty({ t, accent, icon, title, sub, action }: { t: T; accent: string; icon?: React.ReactNode; title: string; sub?: string; action?: React.ReactNode }) {
  return (
    <div style={{ textAlign: 'center', padding: '56px 20px', color: t.text3 }}>
      {icon && <div style={{ width: 72, height: 72, borderRadius: 20, background: `${accent}14`, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', color: accent }}>{icon}</div>}
      <div style={{ fontWeight: 700, fontSize: 17, color: t.text }}>{title}</div>
      {sub && <div style={{ fontSize: 13, marginTop: 6, maxWidth: 280, marginInline: 'auto', lineHeight: 1.5 }}>{sub}</div>}
      {action && <div style={{ marginTop: 18 }}>{action}</div>}
    </div>
  )
}

// ── Skeleton: плейсхолдер загрузки вместо «Загрузка...» ───────────────────────
export function Skeleton({ t, h = 64, n = 3 }: { t: T; h?: number; n?: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} style={{ height: h, borderRadius: 16, background: t.fill, animation: 'misePulse 1.4s ease-in-out infinite', animationDelay: `${i * 0.12}s` }} />
      ))}
      <style>{`@keyframes misePulse{0%,100%{opacity:.55}50%{opacity:1}}`}</style>
    </div>
  )
}
