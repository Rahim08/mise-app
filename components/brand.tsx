'use client'
import React from 'react'

// Бренд v2 (финал, выбор владельца): тёмные glow-иконки — графитовый фон,
// цветная окантовка и свечение приложения, белый глиф (стиль Final Cut/Logic).
// Логотип — wordmark «mise» с акцентной серой «e» (#8e8e93).
// Превью и история вариантов: docs/mise-brand-v2.html

export const ACCENT = '#8e8e93'
export const ACCENT_GLOW = 'rgba(142,142,147,.45)' // акцент для свечений (splash, hover)

export const APP_META = {
  mise:      { color: '#8e8e93', name: 'Mise' },
  manager:   { color: '#007aff', name: 'Mise Manager' },
  analytics: { color: '#34c759', name: 'Mise Analytics' },
  stash:     { color: '#ff9500', name: 'Mise Stash' },
  people:    { color: '#5856d6', name: 'Mise People' },
  menu:      { color: '#ff2d55', name: 'Mise Menu' },
} as const
export type BrandApp = keyof typeof APP_META

// Глифы: сетка 48×48, поле 7–41, белым
const GLYPHS: Record<BrandApp, React.ReactNode> = {
  // строчная «m» двумя арками
  mise: (
    <path d="M10 36 V18 a7 7 0 0 1 14 0 M24 36 V18 M24 18 a7 7 0 0 1 14 0 V36"
      stroke="#fff" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
  ),
  // mise en place: три строки
  manager: (
    <g fill="#fff">
      <rect x="7" y="11" width="34" height="7" rx="3.5" />
      <rect x="7" y="22" width="26" height="7" rx="3.5" opacity=".72" />
      <rect x="7" y="33" width="17" height="7" rx="3.5" opacity=".44" />
    </g>
  ),
  // рост: столбцы + тренд
  analytics: (
    <g>
      <rect x="5" y="34" width="10" height="10" rx="3" fill="#fff" opacity=".44" />
      <rect x="19" y="24" width="10" height="20" rx="3" fill="#fff" opacity=".72" />
      <rect x="33" y="12" width="10" height="32" rx="3" fill="#fff" />
      <path d="M10 30 L24 20 L38 8" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" opacity=".9" />
    </g>
  ),
  // склад: ящики + списание (минус)
  stash: (
    <g>
      <rect x="6" y="22" width="36" height="22" rx="4" stroke="#fff" strokeWidth="2.5" opacity=".55" fill="none" />
      <rect x="10" y="10" width="28" height="14" rx="4" stroke="#fff" strokeWidth="2.5" opacity=".3" fill="none" />
      <path d="M18 33 H30" stroke="#fff" strokeWidth="4" strokeLinecap="round" />
    </g>
  ),
  // команда: двое
  people: (
    <g stroke="#fff" strokeWidth="3" strokeLinecap="round" fill="none">
      <circle cx="18" cy="16" r="6.5" />
      <path d="M7 40 c0-7 5-11 11-11 s11 4 11 11" />
      <path d="M32 9.5 a6.5 6.5 0 0 1 0 13" opacity=".55" />
      <path d="M41 40 c0-5.5-2.6-9.3-6.8-10.7" opacity=".55" />
    </g>
  ),
  // плитки меню + QR-угол
  menu: (
    <g fill="#fff">
      <rect x="7" y="7" width="14" height="14" rx="4" opacity=".44" />
      <rect x="27" y="7" width="14" height="14" rx="4" opacity=".72" />
      <rect x="7" y="27" width="14" height="14" rx="4" />
      <rect x="27" y="27" width="7.5" height="7.5" rx="2" opacity=".9" />
      <rect x="37.5" y="27" width="3.5" height="3.5" rx="1.2" opacity=".55" />
      <rect x="27" y="37.5" width="3.5" height="3.5" rx="1.2" opacity=".55" />
      <rect x="34" y="34" width="7" height="7" rx="2" opacity=".75" />
    </g>
  ),
}

export function AppIcon({ app, size = 64, glow = true }: { app: BrandApp; size?: number; glow?: boolean }) {
  const c = APP_META[app].color
  return (
    <div style={{
      width: size, height: size, borderRadius: Math.round(size * 0.228), flexShrink: 0,
      background: `linear-gradient(145deg,#0e0e0e 0%,#141414 55%,${c}1a 100%)`,
      border: `${size > 50 ? 1.5 : 1}px solid ${c}77`,
      boxShadow: glow
        ? `0 0 ${size * 0.14}px ${c}55, 0 0 ${size * 0.4}px ${c}26, 0 ${size * 0.04}px ${size * 0.12}px rgba(0,0,0,.4)`
        : `0 ${size * 0.04}px ${size * 0.12}px rgba(0,0,0,.4)`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      position: 'relative', overflow: 'hidden',
    }}>
      <div style={{ position: 'absolute', inset: 0, background: `radial-gradient(ellipse at 40% 18%, ${c}24 0%, transparent 55%)` }} />
      <svg viewBox="0 0 48 48" fill="none" width={Math.round(size * 0.62)} height={Math.round(size * 0.62)} style={{ position: 'relative' }}>
        {GLYPHS[app]}
      </svg>
    </div>
  )
}

const BRAND_FONT = "-apple-system,BlinkMacSystemFont,'SF Pro Display',sans-serif"

// Словесный знак W2: «mise», акцентная «e». color — базовый цвет текста
// (по умолчанию CSS-переменная дашборда; в экранах с собственной темой передавать явно).
export function Wordmark({ size = 22, color = 'var(--tx)' }: { size?: number; color?: string }) {
  return (
    <span style={{
      fontWeight: 800, fontSize: size, letterSpacing: '-.05em', lineHeight: 1,
      color, whiteSpace: 'nowrap', fontFamily: BRAND_FONT,
    }}>
      mis<span style={{ color: ACCENT }}>e</span>
    </span>
  )
}

// Монограмма «m» — та же типографика, что и wordmark, с акцентной точкой над хвостом
// (намёк на «i»/«e»). Для свёрнутых пространств: collapsed-сайдбар, фавиконы, аватар.
// НЕ glyph-иконка (отклонена) — бренд mise остаётся типографическим.
export function WordmarkMark({ size = 24, color = 'var(--tx)' }: { size?: number; color?: string }) {
  return (
    <span style={{
      position: 'relative', display: 'inline-flex', alignItems: 'flex-end',
      fontWeight: 800, fontSize: size, letterSpacing: '-.05em', lineHeight: 1,
      color, fontFamily: BRAND_FONT,
    }}>
      m<span style={{
        width: Math.max(3, size * 0.13), height: Math.max(3, size * 0.13), borderRadius: '50%',
        background: ACCENT, marginLeft: size * 0.04, marginBottom: size * 0.06,
      }} />
    </span>
  )
}
