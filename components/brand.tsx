'use client'
import React, { useId } from 'react'

// Фирменные иконки mise — стиль Apple pro-приложений: суперэллипс,
// вертикальный градиент (светлее сверху), белый глиф на единой сетке.
// Бренд — нейтральный графит, каждое приложение — свой цвет iOS-палитры.

export const BRAND_COLORS = {
  mise:      { top: '#5e5e62', bottom: '#2a2a2c', base: '#1d1d1f' },
  manager:   { top: '#3ba1ff', bottom: '#0068e1', base: '#007aff' },
  analytics: { top: '#56d677', bottom: '#26ab49', base: '#34c759' },
  stash:     { top: '#ffb340', bottom: '#ef8200', base: '#ff9500' },
  people:    { top: '#7d7be9', bottom: '#4442c2', base: '#5856d6' },
  menu:      { top: '#ff5b79', bottom: '#e51a45', base: '#ff2d55' },
} as const
export type BrandApp = keyof typeof BRAND_COLORS

// Классическая аппроксимация суперэллипса иконок iOS (viewBox 100×100)
const SQUIRCLE = 'M50 0C13 0 0 13 0 50s13 50 50 50 50-13 50-50S87 0 50 0Z'

// Глифы: сетка 100×100, поле ~22–78, штрих 7, скругления round
const GLYPHS: Record<BrandApp, React.ReactNode> = {
  // mise en place: три «строки» — всё разложено по местам (знак из приложения)
  mise: (
    <g fill="#fff">
      <rect x="23" y="29.5" width="54" height="9" rx="4.5" />
      <rect x="23" y="45.5" width="39" height="9" rx="4.5" opacity=".7" />
      <rect x="23" y="61.5" width="27" height="9" rx="4.5" opacity=".42" />
    </g>
  ),
  // смена: циферблат
  manager: (
    <g stroke="#fff" strokeWidth="7" fill="none" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="50" cy="50" r="25" />
      <path d="M50 37v13l10 7" />
    </g>
  ),
  // рост: три столбца
  analytics: (
    <g fill="#fff">
      <rect x="26" y="54" width="11" height="20" rx="5.5" />
      <rect x="44.5" y="41" width="11" height="33" rx="5.5" />
      <rect x="63" y="26" width="11" height="48" rx="5.5" />
    </g>
  ),
  // банка табака
  stash: (
    <g>
      <rect x="33" y="22" width="34" height="9" rx="4.5" fill="#fff" />
      <rect x="27.5" y="37.5" width="45" height="40" rx="11" stroke="#fff" strokeWidth="7" fill="none" />
      <path d="M41 57.5h18" stroke="#fff" strokeWidth="7" strokeLinecap="round" />
    </g>
  ),
  // команда: двое
  people: (
    <g fill="#fff">
      <circle cx="62" cy="37" r="9" opacity=".5" />
      <path d="M61 50c10.5 0 17 7 17 17.5V71H62" opacity=".5" />
      <circle cx="42" cy="35" r="11" />
      <path d="M42 50c12.5 0 19.5 8 19.5 19.5V74h-39v-4.5C22.5 58 29.5 50 42 50Z" />
    </g>
  ),
  // QR-меню: метки сканера
  menu: (
    <g>
      <rect x="26" y="26" width="19" height="19" rx="6" stroke="#fff" strokeWidth="6.5" fill="none" />
      <rect x="55" y="26" width="19" height="19" rx="6" stroke="#fff" strokeWidth="6.5" fill="none" />
      <rect x="26" y="55" width="19" height="19" rx="6" stroke="#fff" strokeWidth="6.5" fill="none" />
      <rect x="57.5" y="57.5" width="14" height="14" rx="5" fill="#fff" />
    </g>
  ),
}

export function AppIcon({ app, size = 64 }: { app: BrandApp; size?: number }) {
  const uid = useId()
  const c = BRAND_COLORS[app]
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" style={{ display: 'block', flexShrink: 0 }}>
      <defs>
        <linearGradient id={uid} x1="50" y1="0" x2="50" y2="100" gradientUnits="userSpaceOnUse">
          <stop stopColor={c.top} />
          <stop offset="1" stopColor={c.bottom} />
        </linearGradient>
      </defs>
      <path d={SQUIRCLE} fill={`url(#${uid})`} />
      {GLYPHS[app]}
    </svg>
  )
}

// Словесный знак: «mise» всегда нейтральный, имя приложения — обычным весом
export function Wordmark({ app, size = 22, dark = false }: { app?: string; size?: number; dark?: boolean }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: size * 0.22, whiteSpace: 'nowrap' }}>
      <span style={{ fontSize: size, fontWeight: 800, letterSpacing: -size * 0.045, color: dark ? '#f5f5f7' : '#1d1d1f' }}>mise</span>
      {app && <span style={{ fontSize: size * 0.94, fontWeight: 400, letterSpacing: -size * 0.02, color: dark ? 'rgba(245,245,247,.62)' : 'rgba(29,29,31,.58)' }}>{app}</span>}
    </span>
  )
}
