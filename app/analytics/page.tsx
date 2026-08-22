'use client'
export const dynamic = 'force-dynamic'
import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import { db } from '@/lib/db'
import { useTheme } from '@/hooks/useTheme'
import { AuthGate } from '@/components/AuthGate'
import { AppLoading } from '@/components/AppLoading'
import { Spinner } from '@/components/ui'
import { AppSwitchBrand } from '@/components/AppSwitchBrand'
import { useI18n, tCurrent } from '@/lib/i18n'
import { fmtDate, fv, dd, displayReason } from '@/lib/format'
import { computeAccruedToday } from '@/lib/analytics'
const COLORS = ['#34c759', '#ff3b30', '#007aff', '#ff9500', '#af52de', '#00c7be', '#ff6b35', '#5856d6']

// Банк (Open Banking) — короткий список стран для поиска института в GoCardless
// (Revolut Business регистрируется под разным institution_id по стране). Названия —
// через Intl.DisplayNames на локали юзера, без отдельных i18n-ключей на каждую страну.
// IT первой — целевой рынок банк-интеграции после теста на личном Revolut юзера
// (LT/GB — типичные страны регистрации самого Revolut).
const BANK_COUNTRIES = ['IT', 'CH', 'FR', 'DE', 'GB', 'LT', 'TR', 'AZ']
function countryName(code: string, locale: string): string {
  try { return new Intl.DisplayNames([locale], { type: 'region' }).of(code) || code } catch { return code }
}

// «Вход» дня N = «Касса» дня N-1 из этого же (уже отсортированного по дате) списка,
// а не хранимое поле opening_balance — оно пишется один раз при открытии смены и
// может «застыть» на 0, если предыдущий день был закрыт позже (баг SO 2026-07-07).
// prevClosing — закрытие последней смены ДО списка, чтобы и первая строка не осталась
// на сыром (потенциально «застывшем») opening_balance.
function withDerivedOpening<T extends { opening_balance?: number; closing_balance?: number }>(rows: T[], prevClosing?: number): T[] {
  return rows.map((r, i) => (i === 0 ? (prevClosing != null ? { ...r, opening_balance: prevClosing } : r) : { ...r, opening_balance: rows[i - 1].closing_balance }))
}

// ── CSV EXPORT (Excel-compatible: ';' delimiter + UTF-8 BOM for Cyrillic) ──────
function downloadCSV(filename: string, rows: (string | number)[][]) {
  const esc = (cell: string | number) => {
    const s = String(cell ?? '')
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const csv = rows.map(r => r.map(esc).join(';')).join('\r\n')
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// ── PDF EXPORT (jsPDF + embedded PT Sans for Cyrillic) ─────────────────────────
async function makePdfDoc() {
  const { jsPDF } = await import('jspdf')
  const { ptSansBase64 } = await import('@/lib/ptSansFont')
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  doc.addFileToVFS('PTSans.ttf', ptSansBase64)
  doc.addFont('PTSans.ttf', 'PTSans', 'normal')
  doc.setFont('PTSans')
  return doc
}

function pdfTable(doc: any, title: string, headers: string[], rows: string[][], colX: number[]) {
  doc.setFontSize(15); doc.text(title, 40, 40)
  let y = 64
  doc.setFontSize(9)
  doc.setTextColor(130); headers.forEach((h, i) => doc.text(h, colX[i], y)); doc.setTextColor(20)
  y += 5; doc.setDrawColor(210); doc.line(40, y, 555, y); y += 15
  rows.forEach((r, ri) => {
    if (y > 800) { doc.addPage(); y = 56 }
    if (ri === rows.length - 1) { doc.setDrawColor(210); doc.line(40, y - 11, 555, y - 11) }
    r.forEach((c, i) => doc.text(String(c ?? ''), colX[i], y))
    y += 16
  })
}

// ── ANIMATED NUMBER ───────────────────────────────────────────────────────────

function AnimatedNumber({ value, prefix = '', suffix = '', duration = 800, style = {} }: {
  value: number; prefix?: string; suffix?: string; duration?: number; style?: React.CSSProperties
}) {
  const [display, setDisplay] = useState(0)
  const startRef = useRef(0)
  const startTimeRef = useRef(0)
  const rafRef = useRef(0)

  useEffect(() => {
    startRef.current = display
    startTimeRef.current = performance.now()
    const target = value

    const animate = (now: number) => {
      const elapsed = now - startTimeRef.current
      const progress = Math.min(elapsed / duration, 1)
      const eased = 1 - Math.pow(1 - progress, 3)
      setDisplay(startRef.current + (target - startRef.current) * eased)
      if (progress < 1) rafRef.current = requestAnimationFrame(animate)
    }
    rafRef.current = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(rafRef.current)
  }, [value])

  const formatted = display.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return <span style={style}>{prefix}{formatted}{suffix}</span>
}

// ── SPARKLINE ─────────────────────────────────────────────────────────────────

function Sparkline({ values, color, width = 60, height = 24 }: { values: number[]; color: string; width?: number; height?: number }) {
  if (values.length < 2) return null
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * width
    const y = height - ((v - min) / range) * height
    return `${x},${y}`
  }).join(' ')

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ overflow: 'visible' }}>
      <defs>
        <linearGradient id={`sg-${color.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// ── LINE CHART (SVG, Apple Stocks style) ──────────────────────────────────────

function LineChartSVG({ labels, values, color, currency, height = 160 }: {
  labels: string[]; values: number[]; color: string; currency: string; height?: number
}) {
  const [tooltip, setTooltip] = useState<{ x: number; y: number; label: string; val: number } | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const [animated, setAnimated] = useState(false)

  useEffect(() => {
    setTimeout(() => setAnimated(true), 50)
  }, [values])

  if (values.length < 2) return null

  const W = 320; const H = height
  const pad = { top: 12, right: 16, bottom: 24, left: 8 }
  const min = Math.min(...values); const max = Math.max(...values)
  const range = max - min || 1

  const toX = (i: number) => pad.left + (i / (values.length - 1)) * (W - pad.left - pad.right)
  const toY = (v: number) => pad.top + ((max - v) / range) * (H - pad.top - pad.bottom)

  const linePts = values.map((v, i) => `${toX(i)},${toY(v)}`).join(' L ')
  const areaPath = `M ${toX(0)},${toY(values[0])} L ${linePts.split(' L ').slice(1).join(' L ')} L ${toX(values.length - 1)},${H - pad.bottom} L ${toX(0)},${H - pad.bottom} Z`
  const linePath = `M ${toX(0)},${toY(values[0])} L ${linePts.split(' L ').slice(1).join(' L ')}`

  const gradId = `lg-${color.replace('#', '')}`

  const handleMove = (e: React.TouchEvent | React.MouseEvent) => {
    if (!svgRef.current) return
    const rect = svgRef.current.getBoundingClientRect()
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX
    const relX = (clientX - rect.left) / rect.width * W
    const idx = Math.max(0, Math.min(values.length - 1, Math.round((relX - pad.left) / (W - pad.left - pad.right) * (values.length - 1))))
    setTooltip({ x: toX(idx), y: toY(values[idx]), label: labels[idx], val: values[idx] })
  }

  return (
    <div style={{ position: 'relative', width: '100%' }}>
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height, overflow: 'visible', touchAction: 'none' }}
        onMouseMove={handleMove} onTouchMove={handleMove}
        onMouseLeave={() => setTooltip(null)} onTouchEnd={() => setTooltip(null)}>
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.25" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
          <clipPath id={`clip-${gradId}`}>
            <rect x="0" y="0" width={animated ? W : 0} height={H} style={{ transition: `width 0.9s cubic-bezier(.16,1,.3,1)` }} />
          </clipPath>
        </defs>

        {/* Grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map(t => {
          const y = pad.top + t * (H - pad.top - pad.bottom)
          const val = max - t * range
          return (
            <g key={t}>
              <line x1={pad.left} y1={y} x2={W - pad.right} y2={y} stroke="currentColor" strokeOpacity="0.06" strokeWidth="1" />
              <text x={W - pad.right + 4} y={y + 4} fontSize="8" fill="currentColor" fillOpacity="0.35">{currency}{Math.round(val)}</text>
            </g>
          )
        })}

        {/* Area */}
        <path d={areaPath} fill={`url(#${gradId})`} clipPath={`url(#clip-${gradId})`} />

        {/* Line */}
        <path d={linePath} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" clipPath={`url(#clip-${gradId})`} />

        {/* X labels */}
        {labels.filter((_, i) => i === 0 || i === labels.length - 1 || (labels.length > 5 && i === Math.floor(labels.length / 2))).map((l, _, arr) => {
          const origIdx = labels.indexOf(l)
          return (
            <text key={l} x={toX(origIdx)} y={H - 2} textAnchor="middle" fontSize="8" fill="currentColor" fillOpacity="0.4">{l}</text>
          )
        })}

        {/* Tooltip */}
        {tooltip && (
          <>
            <line x1={tooltip.x} y1={pad.top} x2={tooltip.x} y2={H - pad.bottom} stroke={color} strokeOpacity="0.4" strokeWidth="1" strokeDasharray="3,3" />
            <circle cx={tooltip.x} cy={tooltip.y} r="5" fill={color} />
            <circle cx={tooltip.x} cy={tooltip.y} r="3" fill="white" />
            <rect x={Math.max(4, Math.min(tooltip.x - 36, W - 76))} y={Math.max(4, tooltip.y - 32)} width={72} height={22} rx="6" fill={color} />
            <text x={Math.max(4, Math.min(tooltip.x - 36, W - 76)) + 36} y={Math.max(4, tooltip.y - 32) + 15} textAnchor="middle" fontSize="10" fontWeight="700" fill="white">{currency}{fv(tooltip.val)}</text>
          </>
        )}
      </svg>
    </div>
  )
}

// ── BAR CHART (SVG) ───────────────────────────────────────────────────────────

function BarChartSVG({ labels, income, expense, currency }: { labels: string[]; income: number[]; expense: number[]; currency: string }) {
  const [animated, setAnimated] = useState(false)
  useEffect(() => { setTimeout(() => setAnimated(true), 50) }, [income])

  const W = 320; const H = 130
  const pad = { top: 8, right: 8, bottom: 20, left: 8 }
  const max = Math.max(...income, ...expense, 1)
  const barW = Math.max(4, (W - pad.left - pad.right) / labels.length / 2 - 2)
  const gap = (W - pad.left - pad.right) / labels.length

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: H }}>
      <defs>
        <linearGradient id="inc-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#34c759" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#34c759" stopOpacity="0.5" />
        </linearGradient>
        <linearGradient id="exp-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ff3b30" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#ff3b30" stopOpacity="0.5" />
        </linearGradient>
      </defs>
      {labels.map((l, i) => {
        const x = pad.left + i * gap
        const aH = income[i] / max * (H - pad.top - pad.bottom)
        const bH = expense[i] / max * (H - pad.top - pad.bottom)
        const base = H - pad.bottom
        return (
          <g key={l}>
            <rect x={x + gap / 2 - barW - 1} y={base - (animated ? aH : 0)} width={barW} height={animated ? aH : 0} rx="3" fill="url(#inc-grad)" style={{ transition: `y 0.7s cubic-bezier(.16,1,.3,1) ${i * 30}ms, height 0.7s cubic-bezier(.16,1,.3,1) ${i * 30}ms` }} />
            <rect x={x + gap / 2 + 1} y={base - (animated ? bH : 0)} width={barW} height={animated ? bH : 0} rx="3" fill="url(#exp-grad)" style={{ transition: `y 0.7s cubic-bezier(.16,1,.3,1) ${i * 30}ms, height 0.7s cubic-bezier(.16,1,.3,1) ${i * 30}ms` }} />
            <text x={x + gap / 2} y={H - 4} textAnchor="middle" fontSize="7.5" fill="currentColor" fillOpacity="0.4">{l}</text>
          </g>
        )
      })}
      <g>
        <rect x={W - 80} y={4} width={8} height={8} rx="2" fill="#34c759" opacity="0.8" />
        <text x={W - 70} y={12} fontSize="8" fill="currentColor" fillOpacity="0.5">{tCurrent('an.income')}</text>
        <rect x={W - 80} y={16} width={8} height={8} rx="2" fill="#ff3b30" opacity="0.8" />
        <text x={W - 70} y={24} fontSize="8" fill="currentColor" fillOpacity="0.5">{tCurrent('an.expense')}</text>
      </g>
    </svg>
  )
}

// ── DONUT CHART (SVG, Apple style with center value) ──────────────────────────

function DonutChartSVG({ data, colors, labels, centerVal, centerLabel }: {
  data: number[]; colors: string[]; labels: string[]; centerVal: string; centerLabel: string
}) {
  const [animated, setAnimated] = useState(false)
  useEffect(() => { setTimeout(() => setAnimated(true), 100) }, [data])

  const size = 120; const cx = size / 2; const cy = size / 2
  const r = 44; const innerR = 30
  const total = data.reduce((s, v) => s + v, 0) || 1
  const circumference = 2 * Math.PI * r

  let cumAngle = -Math.PI / 2
  const slices = data.map((v, i) => {
    const angle = (v / total) * 2 * Math.PI
    const startAngle = cumAngle
    cumAngle += angle
    const endAngle = cumAngle

    const x1 = cx + r * Math.cos(startAngle)
    const y1 = cy + r * Math.sin(startAngle)
    const x2 = cx + r * Math.cos(endAngle)
    const y2 = cy + r * Math.sin(endAngle)
    const largeArc = angle > Math.PI ? 1 : 0

    const ix1 = cx + innerR * Math.cos(startAngle)
    const iy1 = cy + innerR * Math.sin(startAngle)
    const ix2 = cx + innerR * Math.cos(endAngle)
    const iy2 = cy + innerR * Math.sin(endAngle)

    const d = `M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} L ${ix2} ${iy2} A ${innerR} ${innerR} 0 ${largeArc} 0 ${ix1} ${iy1} Z`
    return { d, color: colors[i], angle }
  })

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: 16 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flexShrink: 0 }}>
        {slices.map((s, i) => (
          <path key={i} d={s.d} fill={s.color}
            style={{ opacity: animated ? 1 : 0, transition: `opacity 0.4s ease ${i * 80}ms, transform 0.6s cubic-bezier(.16,1,.3,1) ${i * 80}ms`, transformOrigin: `${cx}px ${cy}px`, transform: animated ? 'scale(1)' : 'scale(0.8)' }}
          />
        ))}
        <text x={cx} y={cy - 4} textAnchor="middle" fontSize="13" fontWeight="800" fill="currentColor">{centerVal}</text>
        <text x={cx} y={cy + 11} textAnchor="middle" fontSize="8" fill="currentColor" fillOpacity="0.45">{centerLabel}</text>
      </svg>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {labels.map((l, i) => (
          <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: colors[i], flexShrink: 0 }} />
            <div style={{ fontSize: 12, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{l}</div>
            <div style={{ fontSize: 12, fontWeight: 600 }}>{fv(data[i])}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── HORIZONTAL BAR ────────────────────────────────────────────────────────────

function HBar({ name, val, max, color, currency, sub, t }: { name: string; val: number; max: number; color: string; currency: string; sub?: string; t: any }) {
  const [animated, setAnimated] = useState(false)
  useEffect(() => { setTimeout(() => setAnimated(true), 100) }, [val])
  const pct = Math.min(val / max * 100, 100)

  return (
    <div style={{ padding: '12px 16px', borderBottom: `0.5px solid ${t.sep2}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
        <div>
          <span style={{ fontSize: 15, color: t.text }}>{name}</span>
          {sub && <span style={{ fontSize: 11, color: t.text3, marginLeft: 6 }}>{sub}</span>}
        </div>
        <span style={{ fontSize: 15, fontWeight: 700, color }}>{currency}{fv(val)}</span>
      </div>
      <div style={{ height: 4, background: t.fill, borderRadius: 2, overflow: 'hidden' }}>
        <div style={{
          height: '100%',
          width: animated ? `${pct}%` : '0%',
          background: color,
          borderRadius: 2,
          transition: 'width 0.6s cubic-bezier(0.4, 0, 0.2, 1)',
        }} />
      </div>
    </div>
  )
}

// ── STAT CARD ─────────────────────────────────────────────────────────────────

function StatCard({ label, value, rawValue, color, sub, sm, pct, sparkValues, t }: {
  label: string; value: string; rawValue?: number; color?: string; sub?: string; sm?: boolean; pct?: number | null; sparkValues?: number[]; t: any
}) {
  const up = pct !== null && pct !== undefined && pct >= 0
  return (
    <div style={{ background: t.surface, borderRadius: 16, padding: sm ? '12px 14px' : '16px 14px', boxShadow: t.sh, position: 'relative', overflow: 'hidden' }}>
      <div style={{ fontSize: 10, color: t.text3, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: sm ? 17 : 26, fontWeight: 800, color: color || t.text, letterSpacing: -0.5 }}>
        {rawValue !== undefined ? <AnimatedNumber value={rawValue} style={{ fontSize: sm ? 17 : 26, fontWeight: 800, color: color || t.text, letterSpacing: -0.5 }} /> : value}
      </div>
      {pct !== null && pct !== undefined && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 5 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 3, background: up ? `${t.green}18` : `${t.red}18`, padding: '2px 7px', borderRadius: 8 }}>
            <span style={{ fontSize: 10, color: up ? t.green : t.red, fontWeight: 700 }}>{up ? '↑' : '↓'} {Math.abs(pct).toFixed(1)}%</span>
          </div>
          <span style={{ fontSize: 10, color: t.text4 }}>{tCurrent('an.vsPrev')}</span>
        </div>
      )}
      {sub && <div style={{ fontSize: 11, color: t.text4, marginTop: 4 }}>{sub}</div>}
      {sparkValues && sparkValues.length > 2 && (
        <div style={{ position: 'absolute', bottom: 8, right: 10, opacity: 0.5 }}>
          <Sparkline values={sparkValues} color={color || t.text} />
        </div>
      )}
    </div>
  )
}

// ── PROGRESS RING ─────────────────────────────────────────────────────────────

function ProgressRing({ value, max, color, size = 56, label }: { value: number; max: number; color: string; size?: number; label: string }) {
  const [animated, setAnimated] = useState(false)
  useEffect(() => { setTimeout(() => setAnimated(true), 100) }, [value])
  const r = (size - 8) / 2; const circ = 2 * Math.PI * r
  const pct = Math.min(value / max, 1)
  const offset = circ - (animated ? pct : 0) * circ

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
      <div style={{ position: 'relative', width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: 'rotate(-90deg)' }}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeOpacity="0.1" strokeWidth="4" />
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth="4" strokeLinecap="round"
            strokeDasharray={circ} strokeDashoffset={offset} style={{ transition: 'stroke-dashoffset 1s cubic-bezier(.16,1,.3,1)' }} />
        </svg>
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800, color }}>
          {Math.round(pct * 100)}%
        </div>
      </div>
      <div style={{ fontSize: 10, color: 'currentColor', opacity: 0.5, textAlign: 'center' }}>{label}</div>
    </div>
  )
}

// ── MAIN APP ──────────────────────────────────────────────────────────────────

export default function AnalyticsApp({ rid = '' }: { rid?: string }) {
  // rid задан → embedded-режим: рендер внутри дашборд-shell (/dashboard/analytics),
  // без AuthGate/PIN, без фикс-хрома (шапка и таб-бар в обычном потоке), тема дашборда.
  const embedded = !!rid
  // Desktop-режим внутри shell: контент шире мобильных 640px. Staff-приложение
  // (standalone /analytics на телефоне) не трогаем — там maxWidth всегда 640.
  const contentMaxWidth = embedded ? 1100 : 640
  const t = useTheme(embedded ? 'mise_dash_dark' : 'mise_ana_dark')
  const { t: tr, locale } = useI18n()
  const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1)
  const mFull = (d: Date) => cap(d.toLocaleDateString(locale, { month: 'long' }))
  const mShort = (d: Date) => mFull(d).slice(0, 3)
  const dowShort = (d: Date) => cap(d.toLocaleDateString(locale, { weekday: 'short' }))
  const [restaurantId, setRestaurantId] = useState(rid)
  const [currency, setCurrency] = useState('€')
  const [isPro, setIsPro] = useState(false)
  const [tab, setTab] = useState<'period' | 'kassa' | 'bank' | 'salary' | 'hookah'>('period')
  const [periodMode, setPeriodMode] = useState<'day' | 'week' | 'month'>('month')
  const [kassaMode, setKassaMode] = useState<'kassa' | 'inkass'>('kassa')
  const [currentDate, setCurrentDate] = useState(new Date())
  const [includeCard, setIncludeCard] = useState(false) // restaurant_settings.include_card_in_analytics
  const [payoutDay, setPayoutDay] = useState<number | null>(null) // restaurant_settings.salary_payout_day — только для «до выплаты N дн.», в рамп начисления НЕ входит
  // Банк (Open Banking, GoCardless) — вкладка «Банк» заменила «Прогноз» (юзер-фидбок
  // 2026-08-16). connection: последняя строка bank_connections (null пока не подключено
  // или status!=='linked'); tx: её лента операций, свежие сверху.
  const [bankConnection, setBankConnection] = useState<any>(null)
  const [bankTx, setBankTx] = useState<any[]>([])
  const [bankBusy, setBankBusy] = useState(false)
  const [bankCountry, setBankCountry] = useState('IT')
  const [bankQuery, setBankQuery] = useState('') // название банка — разные заведения подключают разные банки
  const [bankInstitutions, setBankInstitutions] = useState<{ name: string; country: string }[]>([])
  const [bankError, setBankError] = useState<string | null>(null)
  const [expSalary, setExpSalary] = useState<string | null>(null) // раскрытая карточка ЗП (сворачиваемые)
  const [expDay, setExpDay] = useState<string | null>(null)       // раскрытый день в «По дням» (кальян)
  // Кальян: настройки + остатки (all-time) + строки смен кальянщика за месяц
  const [hk, setHk] = useState<{ price: number; portion: number; stockG: number; issuedG: number; allRows: any[]; types: any[]; stockRows: any[] }>({ price: 0, portion: 20, stockG: 0, issuedG: 0, allRows: [], types: [], stockRows: [] })
  const [hookahRows, setHookahRows] = useState<any[]>([])
  const [shiftsRaw, setShifts] = useState<any[]>([])
  const [prevShiftsRaw, setPrevShifts] = useState<any[]>([])
  const [allShiftsRaw, setAllShifts] = useState<any[]>([])
  const [inkDeductions, setInkDeductions] = useState<any[]>([])
  // C6 (юзер-фидбок 2026-08-15): дневная карточка «Инкассация» была хардкод-заглушкой
  // (expense:0, reason:null) — не читала реальную запись вообще. Полные строки по shift_id,
  // включая salary_note (выплаты ЗП), для дневного вида периода.
  const [inkByShift, setInkByShift] = useState<Record<string, any>>({})
  const [expenses, setExpenses] = useState<any[]>([])
  const [allExpenses, setAllExpenses] = useState<any[]>([])
  const [pinnedCats, setPinnedCats] = useState<Set<string>>(new Set())
  const [employees, setEmployees] = useState<any[]>([])
  const [cardAmounts, setCardAmounts] = useState<any[]>([])
  const [absences, setAbsences] = useState<any[]>([])
  const [advances, setAdvances] = useState<any[]>([])
  const [payments, setPayments] = useState<any[]>([])
  const [prevAbsences, setPrevAbsences] = useState<any[]>([])
  const [prevAdvances, setPrevAdvances] = useState<any[]>([])
  const [prevCardAmounts, setPrevCardAmounts] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [showMonthPicker, setShowMonthPicker] = useState(false)
  const [showAI, setShowAI] = useState(false)
  const [showDebts, setShowDebts] = useState(false)
  const [showDebtHistory, setShowDebtHistory] = useState(false)
  const [chatMsgs, setChatMsgs] = useState<{ role: string; text: string }[]>([])
  const [chatInput, setChatInput] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const chatEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const saved = localStorage.getItem('mise_chat')
    if (saved) { try { setChatMsgs(JSON.parse(saved)) } catch {} }
  }, [])

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    if (chatMsgs.length) localStorage.setItem('mise_chat', JSON.stringify(chatMsgs.slice(-30)))
  }, [chatMsgs])

  useEffect(() => {
    if (!restaurantId) return
    db.from('restaurants').select('currency, subscription_plan, subscription_status').eq('id', restaurantId).single().then(({ data: rest }) => {
      if (rest?.currency) setCurrency(rest.currency)
      setIsPro(rest?.subscription_plan === 'pro' && ['active', 'trialing', 'canceling'].includes(rest?.subscription_status))
    })
    db.from('restaurant_settings').select('*').limit(1).then(({ data }: any) => {
      const r = Array.isArray(data) ? data[0] : data
      setIncludeCard(!!r?.include_card_in_analytics)
      setPayoutDay(r?.salary_payout_day ?? null)
      setHk(h => ({ ...h, price: Number(r?.hookah_price || 0), portion: Number(r?.hookah_portion_g || 20) }))
    })
    // Кальян: склад, выдано в зал (all-time) и продано (all-time) — для остатка «в заведении»
    db.from('tobacco_stock').select('brand, flavor, flavor_name, quantity_g, min_quantity_g').then(({ data }: any) =>
      setHk(h => ({ ...h, stockRows: data || [], stockG: (data || []).reduce((s: number, r: any) => s + (r.quantity_g || 0), 0) })))
    db.from('tobacco_movements').select('quantity_g, type').then(({ data }: any) =>
      setHk(h => ({ ...h, issuedG: (data || []).filter((r: any) => r.type === 'out').reduce((s: number, r: any) => s + (r.quantity_g || 0), 0) })))
    db.from('hookah_sales').select('quantity, portion_g').then(({ data }: any) =>
      setHk(h => ({ ...h, allRows: data || [] })))
    db.from('hookah_types').select('id, name').then(({ data }: any) =>
      setHk(h => ({ ...h, types: data || [] })))
    // Закреплённые категории расходов — показываются первыми в разбивке.
    db.from('expense_categories').select('name, is_pinned').then(({ data }: any) =>
      setPinnedCats(new Set((data || []).filter((c: any) => c.is_pinned).map((c: any) => c.name))))
    loadAll(restaurantId, new Date())
    loadAllHistory(restaurantId)
    loadBank()
    const bankErr = new URLSearchParams(window.location.search).get('bankError')
    if (bankErr) { setBankError(bankErr); window.history.replaceState(null, '', window.location.pathname + '?tab=bank') }
  }, [restaurantId])

  const loadBank = async () => {
    const { data } = await db.from('bank_connections').select('*').order('created_at', { ascending: false }).limit(1)
    const c = Array.isArray(data) ? data[0] : data
    setBankConnection(c && c.status === 'linked' ? c : null)
    if (c?.id && c.status === 'linked') {
      const { data: tx } = await db.from('bank_transactions').select('*').eq('connection_id', c.id).order('booking_date', { ascending: false })
      setBankTx(tx || [])
    }
  }

  const connectBank = async (institutionName?: string, countryOverride?: string) => {
    setBankBusy(true); setBankError(null); setBankInstitutions([])
    try {
      const res = await fetch('/api/bank/connect', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ country: countryOverride || bankCountry, query: bankQuery, institutionName }),
      })
      const data = await res.json()
      if (!res.ok) { setBankError(data?.error || 'error'); setBankBusy(false); return }
      if (data.institutions) { setBankInstitutions(data.institutions); setBankBusy(false); return }
      if (data.link) window.location.href = data.link
    } catch (err: any) {
      setBankError(err?.message || 'error'); setBankBusy(false)
    }
  }

  const refreshBank = async () => {
    setBankBusy(true); setBankError(null)
    try {
      const res = await fetch('/api/bank/sync', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) setBankError(data?.error || 'error')
      await loadBank()
    } finally { setBankBusy(false) }
  }

  const loadAll = async (rid: string, date: Date) => {
    setLoading(true)
    const monthStart = fmtDate(new Date(date.getFullYear(), date.getMonth(), 1))
    const monthEnd = fmtDate(new Date(date.getFullYear(), date.getMonth() + 1, 0))
    const prevStart = fmtDate(new Date(date.getFullYear(), date.getMonth() - 1, 1))
    const prevEnd = fmtDate(new Date(date.getFullYear(), date.getMonth(), 0))

    const [s1, s2, s3, s4, s5, s6, s7, s8, s9, s10, s11] = await Promise.all([
      db.from('shifts').select('*').eq('restaurant_id', rid).gte('date', monthStart).lte('date', monthEnd).order('date'),
      db.from('shifts').select('*').eq('restaurant_id', rid).gte('date', prevStart).lte('date', prevEnd).order('date'),
      db.from('employees').select('*').eq('restaurant_id', rid).eq('is_active', true).order('name'),
      db.from('monthly_card_amounts').select('*').eq('restaurant_id', rid).eq('month', fmtDate(date).slice(0, 7)),
      db.from('shift_absences').select('*').eq('restaurant_id', rid).gte('date', monthStart).lte('date', monthEnd),
      db.from('hookah_sales').select('*').gte('date', monthStart).lte('date', monthEnd).order('date'),
      // Фильтр по period (месяц ЗП), не по date (день списания из кассы) — паритет с
      // ManagerSalary.computeSalary / tabs-salary.tsx (юзер-фидбок 2026-08-15).
      db.from('salary_advances').select('*').eq('period', monthStart),
      // Прошлый месяц — для «Начислено» до payout_day (см. cycleTotalCash): до дня выплаты
      // карточка ещё показывает не выплаченную ЗП за прошлый месяц, а не новый цикл.
      db.from('shift_absences').select('*').eq('restaurant_id', rid).gte('date', prevStart).lte('date', prevEnd),
      db.from('salary_advances').select('*').eq('period', prevStart),
      db.from('monthly_card_amounts').select('*').eq('restaurant_id', rid).eq('month', prevStart.slice(0, 7)),
      // Паритет с PeopleModel.computeSalary (canon-расчёт 2026-07-28) — без этого Analytics
      // показывала «к выплате» без учёта уже выданного (аудит 2026-08-09).
      db.from('salary_payments').select('*').eq('period', fmtDate(date).slice(0, 7) + '-01'),
    ])
    setAdvances(s7.data || [])
    setPayments(s11.data || [])
    setHookahRows(s6.data || [])
    setPrevAbsences((s8.data || []).filter((a: any) => a.source !== 'auto'))
    setPrevAdvances(s9.data || [])
    setPrevCardAmounts(s10.data || [])

    const shiftList = s1.data || []
    setShifts(shiftList); setPrevShifts(s2.data || [])
    // Авто-прогулы (source='auto') — черновик до подтверждения менеджером при закрытии смены.
    // Исключаем из расчёта ЗП, пока не подтверждены (тогда source='manager'). Фильтр в JS —
    // чтобы не падать до применения миграции (у старых строк source отсутствует → учитываются).
    setEmployees(s3.data || []); setCardAmounts(s4.data || []); setAbsences((s5.data || []).filter((a: any) => a.source !== 'auto'))

    if (shiftList.length > 0) {
      const ids = shiftList.map((s: any) => s.id)
      const { data: e1 } = await db.from('shift_expenses').select('*').in('shift_id', ids)
      setExpenses(e1 || [])
      const { data: inkRows } = await db.from('inkassations').select('shift_id, amount, expense, reason, total, salary, salary_note').in('shift_id', ids)
      const byShift: Record<string, any> = {}
      ;(inkRows || []).forEach((r: any) => { if (r.shift_id) byShift[r.shift_id] = r })
      setInkByShift(byShift)
    }
    setLoading(false)
  }

  const loadAllHistory = async (rid: string) => {
    // Без нижней границы даты: cumulativeInkass вычитает inkDeductions ЗА ВСЁ ВРЕМЯ (тоже
    // без границы, см. ниже) из этого gross — граница только с одной стороны занижала бы
    // накопительный остаток, как только истории станет больше года.
    const { data: sh } = await db.from('shifts').select('*').eq('restaurant_id', rid).order('date')
    setAllShifts(sh || [])
    if (sh && sh.length > 0) {
      const { data: ex } = await db.from('shift_expenses').select('*').in('shift_id', sh.map((s: any) => s.id))
      setAllExpenses(ex || [])
    }
    // Инкассация копится через месяцы, не обнуляется 1-го числа (как «Касса» на iOS):
    // валовая инкассация по сменам минус всё списанное из неё (расход + выплаченная ЗП).
    const { data: ink } = await db.from('inkassations').select('expense, salary')
    setInkDeductions(ink || [])
  }

  // ── COMPUTED ──
  // shifts.income хранит НАЛИЧНЫЕ; безнал (income_card) добавляется только если
  // владелец включил «учитывать безнал в аналитике» в настройках дашборда.
  const adjustCard = useCallback((rows: any[]) => includeCard
    ? rows.map((s: any) => ({ ...s, income: (s.income || 0) + (s.income_card || 0) }))
    : rows, [includeCard])
  const shifts = useMemo(() => adjustCard(shiftsRaw), [shiftsRaw, adjustCard])
  const prevShifts = useMemo(() => adjustCard(prevShiftsRaw), [prevShiftsRaw, adjustCard])
  const allShifts = useMemo(() => adjustCard(allShiftsRaw), [allShiftsRaw, adjustCard])
  // Единый источник для всех «Вход»-зависимых видов (неделя/касса/экспорт) — дериватив
  // считается один раз по полному месяцу, включая первую строку (см. withDerivedOpening).
  const shiftsDisplay = useMemo(
    () => withDerivedOpening(shifts, prevShifts[prevShifts.length - 1]?.closing_balance),
    [shifts, prevShifts]
  )

  const totalIncome = shifts.reduce((s: number, sh: any) => s + (sh.income || 0), 0)
  const totalExpense = shifts.reduce((s: number, sh: any) => s + (sh.total_expense || 0), 0)
  const totalInkass = shifts.reduce((s: number, sh: any) => s + (sh.inkassation || 0), 0)
  const cumulativeInkass = allShifts.reduce((s: number, sh: any) => s + (sh.inkassation || 0), 0)
    - inkDeductions.reduce((s: number, d: any) => s + (d.expense || 0) + (d.salary || 0), 0)
  const lastShift = shifts[shifts.length - 1]
  // Фактический баланс кассы «сейчас» (юзер-фидбок 2026-08-20): не должен меняться от
  // пролистывания старых месяцев — allShifts не фильтрован по periodMode/currentDate (вся
  // история по order('date')), последняя строка = самая свежая смена ресторана, а не
  // последняя смена ПРОСМАТРИВАЕМОГО периода (это lastShift, он и остаётся для
  // экспорта/AI-контекста — там нужен именно баланс на конец отчётного периода).
  const trueCurrentBalance = allShifts[allShifts.length - 1]?.closing_balance || 0
  const prevIncome = prevShifts.reduce((s: number, sh: any) => s + (sh.income || 0), 0)
  const prevExpense = prevShifts.reduce((s: number, sh: any) => s + (sh.total_expense || 0), 0)
  const pct = (cur: number, prev: number) => prev ? ((cur - prev) / prev * 100) : null

  // Долги (Б, 2026-08-09): is_paid=false — ещё не оплачен; paid_shift_id на ДРУГУЮ смену —
  // историческая пометка «здесь был долг», уже посчитан в дне погашения.
  const countsInRollup = (e: any) => e.is_paid !== false && (!e.paid_shift_id || e.paid_shift_id === e.shift_id)

  // C1 (аудит 2026-08-15): web вообще не показывал «Долги» — countsInRollup выше молча
  // исключает неоплаченные shift_expenses из всех ролапов расходов, без единого UI-сигнала,
  // что деньги пропущены. Портируем iOS AnalyticsView.periodDebts/periodDebtHistory: источник —
  // allExpenses/allShifts (без границы по времени, как в iOS loadDebts, долг мог возникнуть
  // в прошлом месяце), фильтр по текущему периоду (день/неделя/месяц) — здесь.
  const dateByShiftId: Record<string, string> = {}
  allShifts.forEach((s: any) => { dateByShiftId[s.id] = s.date })
  const [periodStart, periodEnd] = periodMode === 'day' ? [fmtDate(currentDate), fmtDate(currentDate)]
    : periodMode === 'week' ? (() => {
        const start = new Date(currentDate); const day = start.getDay()
        start.setDate(start.getDate() - (day === 0 ? 6 : day - 1))
        const end = new Date(start); end.setDate(start.getDate() + 6)
        return [fmtDate(start), fmtDate(end)]
      })()
    : [fmtDate(new Date(currentDate.getFullYear(), currentDate.getMonth(), 1)), fmtDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0))]
  const toDebtRow = (e: any) => {
    const date = dateByShiftId[e.shift_id]
    if (!date) return null
    return { id: e.id, shiftId: e.shift_id, date, categoryName: e.category_name || '—', amount: e.amount || 0, paidAt: e.paid_at || null }
  }
  const inPeriod = (d: { date: string } | null): d is { date: string; id: string; shiftId: string; categoryName: string; amount: number; paidAt: string | null } =>
    !!d && d.date >= periodStart && d.date <= periodEnd
  const periodDebts = allExpenses.filter((e: any) => e.is_paid === false).map(toDebtRow).filter(inPeriod).sort((a, b) => a.date < b.date ? -1 : 1)
  const periodDebtHistory = allExpenses.filter((e: any) => e.paid_shift_id && e.paid_shift_id !== e.shift_id).map(toDebtRow).filter(inPeriod).sort((a, b) => a.date > b.date ? -1 : 1)
  const debtTotal = periodDebts.reduce((s, d) => s + d.amount, 0)

  const debtsCard = periodDebts.length > 0 && (
    <div onClick={() => setShowDebts(true)} style={{ display: 'flex', alignItems: 'center', gap: 10, background: t.surface, borderRadius: 16, padding: '14px 16px', marginBottom: 12, boxShadow: t.sh, cursor: 'pointer' }}>
      <svg width="17" height="17" fill="none" stroke={t.orange} strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><path d="M12 7.5v5.5M12 16.5h.01" strokeLinecap="round" /></svg>
      <span style={{ fontSize: 15, fontWeight: 500, color: t.text }}>{tr('an.debts')}</span>
      <span style={{ fontSize: 11, fontWeight: 700, color: '#fff', background: t.orange, borderRadius: 999, padding: '2px 7px', minWidth: 18, textAlign: 'center' as const }}>{periodDebts.length}</span>
      <span style={{ flex: 1 }} />
      <span style={{ fontSize: 13, fontWeight: 700, color: t.orange }}>{currency}{fv(debtTotal)}</span>
      <svg width="7" height="13" fill="none" stroke={t.text3} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 10 18"><path d="M2 1l7 8-7 8" /></svg>
    </div>
  )

  const getCatMap = (exps: any[]) => {
    const m: Record<string, number> = {}
    exps.filter((e: any) => !e.employee_id && countsInRollup(e)).forEach((e: any) => { m[e.category_name] = (m[e.category_name] || 0) + e.amount })
    return Object.entries(m).sort((a, b) => {
      const pa = pinnedCats.has(a[0]) ? 1 : 0, pb = pinnedCats.has(b[0]) ? 1 : 0
      return pb - pa || b[1] - a[1]
    })
  }

  const buildContext = () => {
    const catMap: Record<string, number> = {}
    allExpenses.filter((e: any) => !e.employee_id && countsInRollup(e)).forEach((e: any) => { catMap[e.category_name] = (catMap[e.category_name] || 0) + e.amount })
    const topCats = Object.entries(catMap).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([n, v]) => `${n}: ${currency}${fv(v)}`).join(', ')
    const totalAllIncome = allShifts.reduce((s: number, sh: any) => s + (sh.income || 0), 0)
    const totalAllExpense = allShifts.reduce((s: number, sh: any) => s + (sh.total_expense || 0), 0)
    return `Ты AI-ассистент ресторана. Текущий месяц (${mFull(currentDate)} ${currentDate.getFullYear()}): доход ${currency}${fv(totalIncome)}, расходы ${currency}${fv(totalExpense)}, касса ${currency}${fv(lastShift?.closing_balance || 0)}, инкассация ${currency}${fv(totalInkass)}, смен ${shifts.length}. Прошлый месяц: доход ${currency}${fv(prevIncome)}, расходы ${currency}${fv(prevExpense)}. За последний год: общий доход ${currency}${fv(totalAllIncome)}, общие расходы ${currency}${fv(totalAllExpense)}, смен ${allShifts.length}. Топ расходов за всё время: ${topCats}. Сотрудников: ${employees.length}, ФОТ: ${currency}${fv(employees.reduce((s: number, e: any) => s + e.salary, 0))}. ${tr('an.aiInstruction')}`
  }

  const sendAI = async (msg?: string) => {
    const input = msg || chatInput.trim(); if (!input) return
    setChatInput('')
    const userMsg = { role: 'user', text: input }
    setChatMsgs(p => [...p, userMsg]); setChatLoading(true)
    try {
      const r = await fetch('/api/ai', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: [...chatMsgs, userMsg], context: buildContext() }) })
      const d = await r.json()
      setChatMsgs(p => [...p, { role: 'ai', text: d.text || tr('an.aiNoAnswer') }])
    } catch { setChatMsgs(p => [...p, { role: 'ai', text: tr('an.aiConnErr') }]) }
    setChatLoading(false)
  }

  // ── EXPORTS ──
  const monthTag = `${mFull(currentDate)}_${currentDate.getFullYear()}`
  const pdfCur = currency === '₸' ? 'KZT ' : currency // ₸ glyph not in embedded font
  const monthTitle = `${mFull(currentDate)} ${currentDate.getFullYear()}`

  const exportShifts = () => {
    const rows: (string | number)[][] = [[tr('an.csvDate'), tr('an.csvEntry'), tr('an.csvIncome'), tr('an.csvExpense'), tr('an.csvDeposit'), tr('an.csvCash')]]
    shiftsDisplay.forEach((s: any) => rows.push([
      s.date,
      (s.opening_balance || 0).toFixed(2),
      (s.income || 0).toFixed(2),
      (s.total_expense || 0).toFixed(2),
      (s.inkassation || 0).toFixed(2),
      (s.closing_balance || 0).toFixed(2),
    ]))
    rows.push([tr('an.csvTotal'), '', totalIncome.toFixed(2), totalExpense.toFixed(2), totalInkass.toFixed(2), (lastShift?.closing_balance || 0).toFixed(2)])
    downloadCSV(`smeny_${monthTag}.csv`, rows)
  }

  const exportShiftsPDF = async () => {
    const doc = await makePdfDoc()
    const headers = [tr('an.csvDate'), tr('an.csvEntry'), tr('an.csvIncome'), tr('an.csvExpense'), tr('an.csvDeposit'), tr('an.csvCash')]
    const colX = [40, 130, 220, 310, 400, 485]
    const rows: string[][] = shiftsDisplay.map((s: any) => [
      s.date,
      pdfCur + fv(s.opening_balance || 0),
      pdfCur + fv(s.income || 0),
      pdfCur + fv(s.total_expense || 0),
      pdfCur + fv(s.inkassation || 0),
      pdfCur + fv(s.closing_balance || 0),
    ])
    rows.push([tr('an.csvTotal'), '', pdfCur + fv(totalIncome), pdfCur + fv(totalExpense), pdfCur + fv(totalInkass), pdfCur + fv(lastShift?.closing_balance || 0)])
    pdfTable(doc, `Смены — ${monthTitle}`, headers, rows, colX)
    doc.save(`smeny_${monthTag}.pdf`)
  }

  // Экспорт одной смены (сессии) — вкладка «Период» → День.
  const sessionData = () => {
    const dayStr = fmtDate(currentDate)
    const dayShift = shifts.find((s: any) => s.date === dayStr)
    const dayExps = (dayShift ? expenses.filter((e: any) => e.shift_id === dayShift.id && !e.employee_id && countsInRollup(e)) : [])
      .sort((a: any, b: any) => ((pinnedCats.has(b.category_name) ? 1 : 0) - (pinnedCats.has(a.category_name) ? 1 : 0)) || b.amount - a.amount)
    return { dayStr, dayShift, dayExps }
  }

  const exportSession = () => {
    const { dayStr, dayShift, dayExps } = sessionData()
    if (!dayShift) return
    const rows: (string | number)[][] = [[tr('an.csvDate'), tr('an.csvEntry'), tr('an.csvIncome'), tr('an.csvExpense'), tr('an.csvDeposit'), tr('an.csvCash')]]
    rows.push([
      dayStr,
      (dayShift.opening_balance || 0).toFixed(2),
      (dayShift.income || 0).toFixed(2),
      (dayShift.total_expense || 0).toFixed(2),
      (dayShift.inkassation || 0).toFixed(2),
      (dayShift.closing_balance || 0).toFixed(2),
    ])
    if (dayExps.length) {
      rows.push([])
      rows.push([tr('an.csvCategory'), tr('an.csvAmount')])
      dayExps.forEach((e: any) => rows.push([e.category_name, (e.amount || 0).toFixed(2)]))
    }
    downloadCSV(`smena_${dayStr}.csv`, rows)
  }

  const exportSessionPDF = async () => {
    const { dayStr, dayShift, dayExps } = sessionData()
    if (!dayShift) return
    const doc = await makePdfDoc()
    const headers = [tr('an.csvDate'), tr('an.csvEntry'), tr('an.csvIncome'), tr('an.csvExpense'), tr('an.csvDeposit'), tr('an.csvCash')]
    const colX = [40, 130, 220, 310, 400, 485]
    const rows: string[][] = [[
      dayStr,
      pdfCur + fv(dayShift.opening_balance || 0),
      pdfCur + fv(dayShift.income || 0),
      pdfCur + fv(dayShift.total_expense || 0),
      pdfCur + fv(dayShift.inkassation || 0),
      pdfCur + fv(dayShift.closing_balance || 0),
    ]]
    pdfTable(doc, `Смена — ${dd(dayStr)}`, headers, rows, colX)
    if (dayExps.length) {
      doc.addPage()
      pdfTable(doc, `${tr('an.dayExpenses')} — ${dd(dayStr)}`, [tr('an.csvCategory'), tr('an.csvAmount')], dayExps.map((e: any) => [e.category_name, pdfCur + fv(e.amount || 0)]), [40, 300])
    }
    doc.save(`smena_${dayStr}.pdf`)
  }

  // Сумма на карту за выбранный месяц: строго из monthly_card_amounts (канон = iOS, без fallback на employees.card_amount).
  const cardOf = (emp: any) => {
    const m = cardAmounts.find((c: any) => c.employee_id === emp.id)
    return m ? Number(m.card_amount || 0) : 0
  }
  const advanceOf = (emp: any) => advances.filter((a: any) => a.employee_id === emp.id).reduce((s: number, a: any) => s + Number(a.amount || 0), 0)
  const paidOf = (emp: any) => payments.filter((p: any) => p.employee_id === emp.id).reduce((s: number, p: any) => s + Number(p.amount || 0), 0)

  const exportSalary = () => {
    const rows: (string | number)[][] = [[tr('an.csvEmployee'), tr('an.csvSalary'), tr('an.csvAbsences'), tr('an.csvDeduct'), tr('an.csvCard'), tr('an.csvCashPay'), tr('an.csvTotal')]]
    employees.forEach((emp: any) => {
      const abs = absences.filter((a: any) => a.employee_id === emp.id).length
      const deduct = abs * emp.deduct_per_absence
      const card = cardOf(emp)
      const total = Math.max(0, (emp.salary || 0) - deduct)
      const cash = Math.max(0, total - advanceOf(emp) - card)
      rows.push([emp.name, (emp.salary || 0).toFixed(2), abs, deduct.toFixed(2), card.toFixed(2), cash.toFixed(2), total.toFixed(2)])
    })
    downloadCSV(`zarplaty_${monthTag}.csv`, rows)
  }

  const exportSalaryPDF = async () => {
    const doc = await makePdfDoc()
    const headers = [tr('an.csvEmployee'), tr('an.csvSalary'), tr('an.csvAbsences'), tr('an.csvDeduct'), tr('an.csvCard'), tr('an.csvCashPay'), tr('an.csvTotal')]
    const colX = [40, 200, 270, 330, 400, 465, 520]
    const rows: string[][] = employees.map((emp: any) => {
      const abs = absences.filter((a: any) => a.employee_id === emp.id).length
      const deduct = abs * emp.deduct_per_absence
      const card = cardOf(emp)
      const total = Math.max(0, (emp.salary || 0) - deduct)
      const cash = Math.max(0, total - advanceOf(emp) - card)
      return [emp.name, pdfCur + fv(emp.salary || 0), String(abs), pdfCur + fv(deduct), pdfCur + fv(card), pdfCur + fv(cash), pdfCur + fv(total)]
    })
    pdfTable(doc, `Зарплаты — ${monthTitle}`, headers, rows, colX)
    doc.save(`zarplaty_${monthTag}.pdf`)
  }

  // ── RENDER PERIOD ──
  const renderPeriod = () => {
    const dayStr = fmtDate(currentDate)
    const dayShift = shifts.find((s: any) => s.date === dayStr)
    const dayExps = (dayShift ? expenses.filter((e: any) => e.shift_id === dayShift.id && !e.employee_id && countsInRollup(e)) : [])
      .sort((a: any, b: any) => ((pinnedCats.has(b.category_name) ? 1 : 0) - (pinnedCats.has(a.category_name) ? 1 : 0)) || b.amount - a.amount)
    const inkRow = dayShift ? inkByShift[dayShift.id] : null
    const inkAmt = dayShift?.inkassation || 0
    const dayInk = inkAmt > 0 ? {
      amount: inkAmt, expense: inkRow?.expense || 0,
      reason: [inkRow?.reason ? displayReason(inkRow.reason) : null, inkRow?.salary_note].filter(Boolean).join(' · ') || null,
      balance: inkRow?.total ?? inkAmt,
    } : null

    const getWeekShifts = () => {
      const start = new Date(currentDate); const day = start.getDay()
      start.setDate(start.getDate() - (day === 0 ? 6 : day - 1))
      const end = new Date(start); end.setDate(start.getDate() + 6)
      return shiftsDisplay.filter((s: any) => s.date >= fmtDate(start) && s.date <= fmtDate(end))
    }

    if (periodMode === 'day') {
      if (!dayShift) return (
        <div style={{ padding: '60px 20px', textAlign: 'center', color: t.text3 }}>
          <div style={{ fontSize: 44, marginBottom: 12, opacity: 0.3 }}>
            <svg fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" width="48" height="48"><rect x="3" y="4" width="18" height="18" rx="3" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>
          </div>
          <div style={{ fontWeight: 600, fontSize: 16, color: t.text2 }}>{tr('an.noDataFor', { d: dd(dayStr) })}</div>
        </div>
      )

      const maxExp = Math.max(...dayExps.map((e: any) => e.amount), 1)
      return (
        <div>
          {/* Hero cards */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
            <StatCard label={tr('an.income')} rawValue={dayShift.income} value={`${currency}${fv(dayShift.income)}`} color={t.green} t={t} />
            <StatCard label={tr('an.expense')} rawValue={dayShift.total_expense} value={`${currency}${fv(dayShift.total_expense)}`} color={t.red} t={t} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8, marginBottom: 16 }}>
            <StatCard label={tr('an.cOpen')} value={`${currency}${fv(dayShift.opening_balance)}`} rawValue={dayShift.opening_balance} color={t.blue} sm t={t} />
            <StatCard label={tr('an.income')} value={`${currency}${fv(dayShift.income)}`} rawValue={dayShift.income} color={t.green} sm t={t} />
            <StatCard label={tr('an.expense')} value={`${currency}${fv(dayShift.total_expense)}`} rawValue={dayShift.total_expense} color={t.red} sm t={t} />
            <StatCard label={tr('an.cKassa')} value={`${currency}${fv(dayShift.closing_balance)}`} rawValue={dayShift.closing_balance} color={t.blue} sm t={t} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginBottom: 4 }}>
            <button onClick={exportSession} style={{ display: 'flex', alignItems: 'center', gap: 5, background: `${t.green}18`, border: 'none', borderRadius: 16, padding: '5px 12px', fontSize: 12, fontWeight: 600, color: t.green, cursor: 'pointer', fontFamily: 'inherit' }}>
              <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" /></svg>
              Excel
            </button>
            <button onClick={exportSessionPDF} style={{ display: 'flex', alignItems: 'center', gap: 5, background: `${t.red}14`, border: 'none', borderRadius: 16, padding: '5px 12px', fontSize: 12, fontWeight: 600, color: t.red, cursor: 'pointer', fontFamily: 'inherit' }}>
              <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" /></svg>
              PDF
            </button>
          </div>
          {dayExps.length > 0 && <>
            <div style={{ fontSize: 12, fontWeight: 600, color: t.text3, textTransform: 'uppercase', letterSpacing: 0.5, padding: '12px 4px 8px' }}>{tr('an.dayExpenses')}</div>
            <div style={{ background: t.surface, borderRadius: 16, overflow: 'hidden', marginBottom: 12, boxShadow: t.sh }}>
              {dayExps.map((e: any, i: number) => (
                <HBar key={e.id} name={e.category_name} val={e.amount} max={maxExp} color={COLORS[i % COLORS.length]} currency={currency} sub={e.note} t={t} />
              ))}
            </div>
          </>}
          {dayInk && <>
            <div style={{ fontSize: 12, fontWeight: 600, color: t.text3, textTransform: 'uppercase', letterSpacing: 0.5, padding: '12px 4px 8px' }}>{tr('an.inkassation')}</div>
            <div style={{ background: t.surface, borderRadius: 16, overflow: 'hidden', marginBottom: 12, boxShadow: t.sh }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '0.5px', background: t.sep2 }}>
                {[{ l: tr('an.inkIncome'), v: dayInk.amount > 0 ? `${currency}${fv(dayInk.amount)}` : '—', c: t.green }, { l: tr('an.expense'), v: dayInk.expense > 0 ? `${currency}${fv(dayInk.expense)}` : '—', c: t.red }, { l: tr('an.reason'), v: dayInk.reason || '—', c: t.text3 }, { l: tr('an.inkTotal'), v: `${currency}${fv(dayInk.balance)}`, c: t.orange }].map(cell => (
                  <div key={cell.l} style={{ background: t.surface, padding: '12px 10px' }}>
                    <div style={{ fontSize: 9, color: t.text3, textTransform: 'uppercase', marginBottom: 5, fontWeight: 600 }}>{cell.l}</div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: cell.c }}>{cell.v}</div>
                  </div>
                ))}
              </div>
            </div>
          </>}
          {debtsCard}
        </div>
      )
    }

    if (periodMode === 'week') {
      const ws = getWeekShifts()
      const wi = ws.reduce((s: number, sh: any) => s + sh.income, 0)
      const we = ws.reduce((s: number, sh: any) => s + sh.total_expense, 0)
      const wExps = expenses.filter((e: any) => ws.map((s: any) => s.id).includes(e.shift_id))
      const cats = getCatMap(wExps); const maxV = Math.max(...cats.map((c: any) => c[1]), 1)
      // Closed-day matching (юзер-фидбок 2026-08-21): та же логика, что в Month — незакрытый
      // «сегодня» не должен занижать %. Баг здесь ещё грубее: базой было prevIncome/4 (среднее
      // за неделю прошлого месяца ЦЕЛИКОМ), сравниваемое с неполной текущей неделей.
      // Теперь база пропорциональна числу уже ЗАКРЫТЫХ дней недели (daysElapsed/7).
      const closedWs = ws.filter((s: any) => s.closing_balance != null)
      const daysElapsed = closedWs.length
      const wiToDate = closedWs.reduce((s: number, sh: any) => s + (sh.income || 0), 0)
      const weToDate = closedWs.reduce((s: number, sh: any) => s + (sh.total_expense || 0), 0)
      const ip = daysElapsed ? pct(wiToDate, (prevIncome / 4) * (daysElapsed / 7)) : null
      const ep = daysElapsed ? pct(weToDate, (prevExpense / 4) * (daysElapsed / 7)) : null

      return (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
            <StatCard label={tr('an.weekIncome')} rawValue={wi} value={`${currency}${fv(wi)}`} color={t.green} pct={ip} t={t} />
            <StatCard label={tr('an.expenses')} rawValue={we} value={`${currency}${fv(we)}`} color={t.red} pct={ep} t={t} />
          </div>
          {ws.length > 1 && <>
            <div style={{ fontSize: 12, fontWeight: 600, color: t.text3, textTransform: 'uppercase', letterSpacing: 0.5, padding: '12px 4px 8px' }}>{tr('an.incomeExpense')}</div>
            <div style={{ background: t.surface, borderRadius: 16, overflow: 'hidden', marginBottom: 12, boxShadow: t.sh }}>
              <div style={{ padding: '14px 14px 10px', color: t.text }}>
                <BarChartSVG labels={ws.map((s: any) => dd(s.date))} income={ws.map((s: any) => s.income || 0)} expense={ws.map((s: any) => s.total_expense || 0)} currency={currency} />
              </div>
            </div>
          </>}
          {cats.length > 0 && <>
            <div style={{ fontSize: 12, fontWeight: 600, color: t.text3, textTransform: 'uppercase', letterSpacing: 0.5, padding: '12px 4px 8px' }}>{tr('an.expenseStructure')}</div>
            <div style={{ background: t.surface, borderRadius: 16, overflow: 'hidden', marginBottom: 12, boxShadow: t.sh }}>
              {cats.map(([n, v], i) => <HBar key={n} name={n} val={v} max={maxV} color={COLORS[i % COLORS.length]} currency={currency} t={t} />)}
            </div>
          </>}
          <div style={{ fontSize: 12, fontWeight: 600, color: t.text3, textTransform: 'uppercase', letterSpacing: 0.5, padding: '12px 4px 8px' }}>{tr('an.byDays')}</div>
          <div style={{ background: t.surface, borderRadius: 16, overflow: 'hidden', boxShadow: t.sh }}>
            {ws.map((s: any, i: number) => (
              <div key={s.id} style={{ display: 'grid', gridTemplateColumns: '44px 1fr 1fr 1fr 1fr', padding: '12px 14px', gap: 4, borderBottom: i < ws.length - 1 ? `0.5px solid ${t.sep2}` : 'none', fontSize: 13 }}>
                <span style={{ color: t.text3 }}>{dd(s.date)}</span>
                <span style={{ color: t.blue }}>{s.opening_balance > 0 ? `${currency}${fv(s.opening_balance)}` : '—'}</span>
                <span style={{ color: t.green, fontWeight: 600 }}>{s.income > 0 ? `${currency}${fv(s.income)}` : '—'}</span>
                <span style={{ color: t.red }}>{s.total_expense > 0 ? `${currency}${fv(s.total_expense)}` : '—'}</span>
                <span style={{ color: t.blue, fontWeight: 700 }}>{currency}{fv(s.closing_balance)}</span>
              </div>
            ))}
          </div>
          {debtsCard}
        </div>
      )
    }

    // Month
    const cats = getCatMap(expenses); const top5 = cats.slice(0, 5); const maxV = Math.max(...cats.map((c: any) => c[1]), 1)
    const incomeArr = shifts.map((s: any) => s.income || 0)
    const daysInMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0).getDate()
    const isCurrentMonth = currentDate.getMonth() === new Date().getMonth() && currentDate.getFullYear() === new Date().getFullYear()
    // Closed-day matching (юзер-фидбок 2026-08-21): daysPassed раньше брался из календарной даты
    // «сегодня» — открытая (ещё не закрытая) смена сегодняшнего дня всё равно попадала в
    // сравнение против ПОЛНОГО дня прошлого месяца, занижая % искусственно. daysPassed теперь —
    // последний ЗАКРЫТЫЙ день текущего месяца (closing_balance != null), сегодняшний
    // незакрытый день не участвует в сравнении ни с одной из сторон (см. также getWeekShifts).
    const closedDatesThisMonth = shifts.filter((s: any) => s.closing_balance != null).map((s: any) => Number(s.date.slice(8, 10)))
    const daysPassed = isCurrentMonth ? (closedDatesThisMonth.length ? Math.max(...closedDatesThisMonth) : 0) : daysInMonth
    // Equal day matching (юзер-фидбок 2026-08-20): в начале месяца daysPassed < daysInMonth —
    // сравнивать нужно с ТЕМИ ЖЕ первыми daysPassed днями прошлого месяца, а не с целым прошлым
    // месяцем целиком, иначе 1-5 числа % всегда «хуже», чем реально (сравниваем часть с целым).
    const shiftsToDate = daysPassed < daysInMonth ? shifts.filter((sh: any) => Number(sh.date.slice(8, 10)) <= daysPassed) : shifts
    const prevShiftsToDate = daysPassed < daysInMonth ? prevShifts.filter((sh: any) => Number(sh.date.slice(8, 10)) <= daysPassed) : prevShifts
    const incomeToDate = shiftsToDate.reduce((s: number, sh: any) => s + (sh.income || 0), 0)
    const expenseToDate = shiftsToDate.reduce((s: number, sh: any) => s + (sh.total_expense || 0), 0)
    const prevIncomeToDate = prevShiftsToDate.reduce((s: number, sh: any) => s + (sh.income || 0), 0)
    const prevExpenseToDate = prevShiftsToDate.reduce((s: number, sh: any) => s + (sh.total_expense || 0), 0)
    const ip = pct(incomeToDate, prevIncomeToDate); const ep = pct(expenseToDate, prevExpenseToDate)

    return (
      <div>
        {/* Top stats */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
          <StatCard label={tr('an.income')} rawValue={totalIncome} value={`${currency}${fv(totalIncome)}`} color={t.green} pct={ip} sparkValues={incomeArr} t={t} />
          <StatCard label={tr('an.expenses')} rawValue={totalExpense} value={`${currency}${fv(totalExpense)}`} color={t.red} pct={ep} t={t} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginBottom: 16 }}>
          <StatCard label={tr('an.shiftsCount')} value={String(shifts.length)} sm t={t} />
          <StatCard label={tr('an.cInkassShort')} rawValue={totalInkass} value={`${currency}${fv(totalInkass)}`} color={t.orange} sm t={t} />
          <StatCard label={tr('an.cKassa')} rawValue={trueCurrentBalance} value={`${currency}${fv(trueCurrentBalance)}`} color={t.blue} sm t={t} />
        </div>

        {/* Нал vs безнал: соотношение продаж за месяц (инкассация — всегда только нал) */}
        {(() => {
          const cash = shiftsRaw.reduce((s: number, sh: any) => s + (sh.income || 0), 0)
          const card = shiftsRaw.reduce((s: number, sh: any) => s + (sh.income_card || 0), 0)
          if (card <= 0) return null
          const total = cash + card
          const cashPct = Math.round(cash / total * 100)
          return (
            <div style={{ background: t.surface, borderRadius: 16, padding: '14px 16px', boxShadow: t.sh, marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: t.text }}>{tr('an.cashCard')}</span>
                <span style={{ fontSize: 12, color: t.text3 }}>{currency}{fv(total)} {tr('an.totalWord')}</span>
              </div>
              <div style={{ display: 'flex', height: 10, borderRadius: 5, overflow: 'hidden', gap: 2 }}>
                <div style={{ width: `${cashPct}%`, background: t.green, borderRadius: 5, transition: 'width .4s ease' }} />
                <div style={{ flex: 1, background: t.purple, borderRadius: 5 }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10 }}>
                <span style={{ fontSize: 12.5, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: t.green }} />
                  <span style={{ color: t.text2 }}>{tr('an.cashShort')}</span>
                  <span style={{ fontWeight: 700, color: t.green }}>{currency}{fv(cash)}</span>
                  <span style={{ color: t.text3 }}>{cashPct}%</span>
                </span>
                <span style={{ fontSize: 12.5, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: t.purple }} />
                  <span style={{ color: t.text2 }}>{tr('an.card')}</span>
                  <span style={{ fontWeight: 700, color: t.purple }}>{currency}{fv(card)}</span>
                  <span style={{ color: t.text3 }}>{100 - cashPct}%</span>
                </span>
              </div>
            </div>
          )
        })()}



        {shifts.length > 1 && <>
          <div style={{ fontSize: 12, fontWeight: 600, color: t.text3, textTransform: 'uppercase', letterSpacing: 0.5, padding: '12px 4px 8px' }}>{tr('an.incomeExpense')}</div>
          <div style={{ background: t.surface, borderRadius: 16, overflow: 'hidden', marginBottom: 12, boxShadow: t.sh }}>
            <div style={{ padding: '14px 14px 8px', color: t.text }}>
              <BarChartSVG labels={shifts.map((s: any) => dd(s.date))} income={incomeArr} expense={shifts.map((s: any) => s.total_expense || 0)} currency={currency} />
            </div>
          </div>
        </>}

        {/* Donut */}
        {top5.length > 0 && <>
          <div style={{ fontSize: 12, fontWeight: 600, color: t.text3, textTransform: 'uppercase', letterSpacing: 0.5, padding: '12px 4px 8px' }}>{tr('an.expenseStructure')}</div>
          <div style={{ background: t.surface, borderRadius: 16, overflow: 'hidden', marginBottom: 12, boxShadow: t.sh, color: t.text }}>
            <DonutChartSVG data={top5.map(([, v]) => v)} colors={COLORS.slice(0, top5.length)} labels={top5.map(([n]) => n)} centerVal={`${currency}${Math.round(totalExpense)}`} centerLabel={tr('an.expensesLc')} />
          </div>

          <div style={{ fontSize: 12, fontWeight: 600, color: t.text3, textTransform: 'uppercase', letterSpacing: 0.5, padding: '12px 4px 8px' }}>{tr('an.topExpenses')}</div>
          <div style={{ background: t.surface, borderRadius: 16, overflow: 'hidden', marginBottom: 12, boxShadow: t.sh }}>
            {top5.map(([n, v], i) => <HBar key={n} name={n} val={v} max={maxV} color={COLORS[i % COLORS.length]} currency={currency} t={t} />)}
          </div>
        </>}

        {cats.length > 0 && <>
          <div style={{ fontSize: 12, fontWeight: 600, color: t.text3, textTransform: 'uppercase', letterSpacing: 0.5, padding: '12px 4px 8px' }}>{tr('an.allCategories')}</div>
          <div style={{ background: t.surface, borderRadius: 16, overflow: 'hidden', marginBottom: 12, boxShadow: t.sh }}>
            {cats.map(([n, v], i) => (
              <div key={n} style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 16px', borderBottom: i < cats.length - 1 ? `0.5px solid ${t.sep2}` : 'none' }}>
                <span style={{ color: t.text }}>{n}</span>
                <span style={{ color: t.red, fontWeight: 600 }}>{currency}{fv(v)}</span>
              </div>
            ))}
          </div>
        </>}
        {debtsCard}
      </div>
    )
  }

  const renderKassa = () => {
    const filled = shiftsDisplay.filter((s: any) => s.income > 0 || s.total_expense > 0)
    const balArr = filled.map((s: any) => s.closing_balance || 0)

    if (kassaMode === 'kassa') {
      return (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
            <StatCard label={tr('an.balance')} rawValue={trueCurrentBalance} value={`${currency}${fv(trueCurrentBalance)}`} color={t.blue} sparkValues={balArr} t={t} />
            <StatCard label={tr('an.lastIncome')} rawValue={lastShift?.income || 0} value={`${currency}${fv(lastShift?.income || 0)}`} color={t.green} sub={lastShift ? dd(lastShift.date) : undefined} t={t} />
          </div>
          {filled.length > 1 && <>
            <div style={{ fontSize: 12, fontWeight: 600, color: t.text3, textTransform: 'uppercase', letterSpacing: 0.5, padding: '12px 4px 8px' }}>{tr('an.kassaBalance')}</div>
            <div style={{ background: t.surface, borderRadius: 16, overflow: 'hidden', marginBottom: 12, boxShadow: t.sh }}>
              <div style={{ padding: '14px 14px 8px', color: t.text }}>
                <LineChartSVG labels={filled.map((s: any) => dd(s.date))} values={balArr} color={t.blue} currency={currency} />
              </div>
            </div>
            <div style={{ fontSize: 12, fontWeight: 600, color: t.text3, textTransform: 'uppercase', letterSpacing: 0.5, padding: '12px 4px 8px' }}>{tr('an.incomeExpense')}</div>
            <div style={{ background: t.surface, borderRadius: 16, overflow: 'hidden', marginBottom: 12, boxShadow: t.sh }}>
              <div style={{ padding: '14px 14px 8px', color: t.text }}>
                <BarChartSVG labels={filled.map((s: any) => dd(s.date))} income={filled.map((s: any) => s.income || 0)} expense={filled.map((s: any) => s.total_expense || 0)} currency={currency} />
              </div>
            </div>
          </>}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 4px 8px' }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: t.text3, textTransform: 'uppercase', letterSpacing: 0.5 }}>{tr('an.byDays')}</div>
            {filled.length > 0 && (
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={exportShifts} style={{ display: 'flex', alignItems: 'center', gap: 5, background: `${t.green}18`, border: 'none', borderRadius: 16, padding: '5px 12px', fontSize: 12, fontWeight: 600, color: t.green, cursor: 'pointer', fontFamily: 'inherit' }}>
                  <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" /></svg>
                  Excel
                </button>
                <button onClick={exportShiftsPDF} style={{ display: 'flex', alignItems: 'center', gap: 5, background: `${t.red}14`, border: 'none', borderRadius: 16, padding: '5px 12px', fontSize: 12, fontWeight: 600, color: t.red, cursor: 'pointer', fontFamily: 'inherit' }}>
                  <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" /></svg>
                  PDF
                </button>
              </div>
            )}
          </div>
          <div style={{ background: t.surface, borderRadius: 16, overflow: 'hidden', boxShadow: t.sh }}>
            {filled.map((s: any, i: number) => (
              <div key={s.id} style={{ display: 'grid', gridTemplateColumns: '44px 1fr 1fr 1fr 1fr', padding: '12px 14px', gap: 4, borderBottom: i < filled.length - 1 ? `0.5px solid ${t.sep2}` : 'none', fontSize: 13 }}>
                <span style={{ color: t.text3 }}>{dd(s.date)}</span>
                <span style={{ color: t.green, fontWeight: 600 }}>{s.income > 0 ? `${currency}${fv(s.income)}` : '—'}</span>
                <span style={{ color: t.red }}>{Math.max((s.total_expense || 0) - (s.inkassation || 0), 0) > 0 ? `${currency}${fv(Math.max(s.total_expense - (s.inkassation || 0), 0))}` : '—'}</span>
                <span style={{ color: t.orange }}>{s.inkassation > 0 ? `${currency}${fv(s.inkassation)}` : '—'}</span>
                <span style={{ color: t.blue, fontWeight: 700 }}>{currency}{fv(s.closing_balance)}</span>
              </div>
            ))}
          </div>
        </div>
      )
    }

    const now = new Date(); const dIM = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
    const prevDIM = new Date(now.getFullYear(), now.getMonth(), 0).getDate()
    // Не только дни с реальным сбором (s.inkassation) — так же дни, где из фонда просто
    // списали расход/ЗП без нового сбора (юзер-фидбок 2026-08-16: выплата Ренате 11 авг
    // была именно такой и пропадала из истории целиком, хотя корректно учитывалась в
    // cumulativeInkass).
    const shiftsWithInk = shifts.filter((s: any) =>
      (s.inkassation || 0) > 0 || (inkByShift[s.id]?.expense || 0) > 0 || (inkByShift[s.id]?.salary || 0) > 0)
    // Инкассация — не месячный, а накопительный счёт (не обнуляется 1-го числа): валовая
    // инкассация по сменам минус всё списанное из неё (расход + выплаченная ЗП), см. cumulativeInkass.
    const inkBal = cumulativeInkass
    // Нетто, не оклад: прогулы/аванс/карта уменьшают то, что реально нужно из кассы —
    // те же вычеты, что в People→Зарплата (salaryOf в exportSalary), иначе «начислено»
    // не падает при выданном авансе/выплате на карту и не совпадает с реальным долгом.
    const totalCash = employees.reduce((s: number, e: any) => {
      const abs = absences.filter((a: any) => a.employee_id === e.id).length
      const deduct = abs * Number(e.deduct_per_absence || 0)
      const total = Math.max(0, Number(e.salary || 0) - deduct)
      return s + Math.max(0, total - advanceOf(e) - cardOf(e))
    }, 0)
    // Та же формула, но по прошлому месяцу — нужна, пока не наступил payout_day (см. ниже).
    const prevCardOf = (emp: any) => Number(prevCardAmounts.find((c: any) => c.employee_id === emp.id)?.card_amount || 0)
    const prevAdvanceOf = (emp: any) => prevAdvances.filter((a: any) => a.employee_id === emp.id).reduce((s: number, a: any) => s + Number(a.amount || 0), 0)
    const prevTotalCash = employees.reduce((s: number, e: any) => {
      const abs = prevAbsences.filter((a: any) => a.employee_id === e.id).length
      const deduct = abs * Number(e.deduct_per_absence || 0)
      const total = Math.max(0, Number(e.salary || 0) - deduct)
      return s + Math.max(0, total - prevAdvanceOf(e) - prevCardOf(e))
    }, 0)
    // Рамп завязан на РЕАЛЬНУЮ сегодняшнюю дату — при просмотре прошлого/будущего месяца
    // (пикером) даёт бессмысленную цифру (% от чужого месяца по чужому дню). Прошлый
    // закрытый месяц уже полностью начислен — 100%.
    const isCurrentMonth = currentDate.getFullYear() === now.getFullYear() && currentDate.getMonth() === now.getMonth()
    // Цикл начисления привязан к payout_day, не к 1-му числу — см. computeAccruedToday
    // (C3, аудит 2026-08-15: вынесено в lib/analytics, единая формула с Manager→Зарплата).
    const salToday = Math.round(computeAccruedToday({ isCurrentMonth, totalCash, daysInMonth: dIM, payoutDay, prevTotalCash, prevDaysInMonth: prevDIM, today: now }))
    const diff = inkBal - salToday

    return (
      <div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
          <StatCard label={tr('an.totalInkass')} rawValue={inkBal} value={`${currency}${fv(inkBal)}`} color={t.orange} t={t} />
          <StatCard label={tr('an.salToday')} rawValue={salToday} value={`${currency}${fv(salToday)}`} color={diff >= 0 ? t.green : t.red} sub={`${diff >= 0 ? tr('an.ahead') : tr('an.behind')} ${currency}${fv(Math.abs(diff))}`} t={t} />
        </div>
        {shiftsWithInk.length > 1 && <>
          <div style={{ fontSize: 12, fontWeight: 600, color: t.text3, textTransform: 'uppercase', letterSpacing: 0.5, padding: '12px 4px 8px' }}>{tr('an.dynamics')}</div>
          <div style={{ background: t.surface, borderRadius: 16, overflow: 'hidden', marginBottom: 12, boxShadow: t.sh }}>
            <div style={{ padding: '14px 14px 8px', color: t.text }}>
              <LineChartSVG labels={shiftsWithInk.map((s: any) => dd(s.date))} values={shiftsWithInk.map((s: any) => s.inkassation || 0)} color={t.orange} currency={currency} />
            </div>
          </div>
        </>}
        <div style={{ fontSize: 12, fontWeight: 600, color: t.text3, textTransform: 'uppercase', letterSpacing: 0.5, padding: '12px 4px 8px' }}>{tr('an.history')}</div>
        <div style={{ background: t.surface, borderRadius: 16, overflow: 'hidden', boxShadow: t.sh }}>
          {shiftsWithInk.length === 0
            ? <div style={{ padding: '32px', textAlign: 'center', color: t.text4 }}>{tr('an.noInkass')}</div>
            : <>
              {/* C4 (аудит 2026-08-15): паритет с iOS-таблицей Дата/Инкассация/Расход/Итого —
                  веб раньше показывал только валовую сумму + свободный текст, без числового
                  расхода и итогового нетто по дню. */}
              <div style={{ display: 'grid', gridTemplateColumns: '38px 1fr 1fr 1fr', gap: 4, padding: '10px 14px 6px', fontSize: 10, fontWeight: 600, color: t.text3, textTransform: 'uppercase', letterSpacing: 0.4 }}>
                <span>{tr('an.csvDate')}</span>
                <span style={{ textAlign: 'right' }}>{tr('an.inkassation')}</span>
                <span style={{ textAlign: 'right' }}>{tr('an.expense')}</span>
                <span style={{ textAlign: 'right' }}>{tr('an.inkNet')}</span>
              </div>
              {shiftsWithInk.map((s: any, i: number) => {
                // C6 (юзер-фидбок 2026-08-15): истории не хватало причины/заметки — reason и
                // salary_note (выплаты ЗП с этого дня) были невидимы нигде на вебе.
                const row = inkByShift[s.id]
                const note = [row?.reason ? displayReason(row.reason) : null, row?.salary_note].filter(Boolean).join(' · ')
                // «Расход» = expense + salary (реально списанное из фонда), не только expense —
                // паритет с iOS (2fc0215).
                const deducted = (row?.expense || 0) + (row?.salary || 0)
                const net = row?.total ?? s.inkassation
                return (
                  <div key={s.id} style={{ padding: '10px 14px', borderTop: `0.5px solid ${t.sep2}` }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '38px 1fr 1fr 1fr', gap: 4, fontSize: 13, alignItems: 'baseline' }}>
                      <span style={{ color: t.text3 }}>{dd(s.date)}</span>
                      <span style={{ color: t.orange, fontWeight: 600, textAlign: 'right' }}>{currency}{fv(s.inkassation)}</span>
                      <span style={{ color: t.red, textAlign: 'right' }}>{deducted > 0 ? `−${currency}${fv(deducted)}` : '—'}</span>
                      <span style={{ color: t.blue, fontWeight: 700, textAlign: 'right' }}>{currency}{fv(net)}</span>
                    </div>
                    {note && <div style={{ fontSize: 11, color: t.text3, marginTop: 4 }}>{note}</div>}
                  </div>
                )
              })}
            </>
          }
        </div>
      </div>
    )
  }

  const renderSalary = () => {
    // Read-only (92f6076/86f1673) — редактирование карты/аванса только в Manager→Зарплата
    // (app/manager/tabs-salary.tsx), единая точка правки, без риска задвоенной правки
    // (A3, аудит 2026-08-13: этот таб оставался живым write-путём вопреки докам, починено).
    const totFOT = employees.reduce((s: number, e: any) => s + e.salary, 0)
    const totCard = employees.reduce((s: number, e: any) => s + cardOf(e), 0)
    const totCash = employees.reduce((s: number, emp: any) => {
      const abs = absences.filter((a: any) => a.employee_id === emp.id).length
      const total = Math.max(0, (emp.salary || 0) - abs * emp.deduct_per_absence)
      return s + Math.max(0, total - advanceOf(emp) - cardOf(emp))
    }, 0)

    return (
      <div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginBottom: 16 }}>
          <StatCard label={tr('an.payroll')} rawValue={totFOT} value={`${currency}${fv(totFOT)}`} color={t.blue} sm t={t} />
          <StatCard label={tr('an.cashFull')} rawValue={totCash} value={`${currency}${fv(totCash)}`} color={t.orange} sm t={t} />
          <StatCard label={tr('an.card')} rawValue={totCard} value={`${currency}${fv(totCard)}`} color={t.purple} sm t={t} />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 4px 8px' }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: t.text3, textTransform: 'uppercase', letterSpacing: 0.5 }}>{tr('an.employees')}</div>
          {employees.length > 0 && (
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={exportSalary} style={{ display: 'flex', alignItems: 'center', gap: 5, background: `${t.green}18`, border: 'none', borderRadius: 16, padding: '5px 12px', fontSize: 12, fontWeight: 600, color: t.green, cursor: 'pointer', fontFamily: 'inherit' }}>
                <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" /></svg>
                Excel
              </button>
              <button onClick={exportSalaryPDF} style={{ display: 'flex', alignItems: 'center', gap: 5, background: `${t.red}14`, border: 'none', borderRadius: 16, padding: '5px 12px', fontSize: 12, fontWeight: 600, color: t.red, cursor: 'pointer', fontFamily: 'inherit' }}>
                <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" /></svg>
                PDF
              </button>
            </div>
          )}
        </div>
        <div style={{ background: t.surface, borderRadius: 16, overflow: 'hidden', boxShadow: t.sh }}>
          {employees.map((emp: any, i: number) => {
            const abs = absences.filter((a: any) => a.employee_id === emp.id).length
            const deduct = abs * emp.deduct_per_absence
            const card = cardOf(emp)
            const advance = advanceOf(emp)
            const total = Math.max(0, (emp.salary || 0) - deduct)
            const cash = Math.max(0, total - advance - card)
            const paid = paidOf(emp)
            const remaining = Math.max(0, cash - paid)

            const open = expSalary === emp.id

            return (
              <div key={emp.id} style={{ borderBottom: i < employees.length - 1 ? `0.5px solid ${t.sep2}` : 'none' }}>
                {/* Шапка — тап раскрывает/сворачивает */}
                <button onClick={() => setExpSalary(open ? null : emp.id)} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', background: 'transparent', border: 'none', fontFamily: 'inherit', cursor: 'pointer', textAlign: 'left' }}>
                  <div>
                    <div style={{ fontSize: 15, color: t.text, fontWeight: 600 }}>{emp.name}</div>
                    <div style={{ fontSize: 11, color: t.text3, marginTop: 2 }}>
                      {abs > 0 ? `${abs} ${tr('an.absWord')} · −${currency}${fv(deduct)}` : tr('an.fullSalary')}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ fontSize: 18, fontWeight: 800, color: t.blue }}>{currency}{fv(total)}</div>
                    <svg width="9" height="15" fill="none" stroke={t.text3} strokeWidth="2.2" strokeLinecap="round" viewBox="0 0 10 18" style={{ transform: open ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform .25s ease', flexShrink: 0 }}><path d="M2 1l7 8-7 8" /></svg>
                  </div>
                </button>
                {/* Тело — плавно выезжает (grid-rows 0fr↔1fr, без замера высоты) */}
                <div style={{ display: 'grid', gridTemplateRows: open ? '1fr' : '0fr', transition: 'grid-template-rows .28s cubic-bezier(.32,.72,0,1)' }}>
                  <div style={{ overflow: 'hidden' }}>
                    <div style={{ padding: '0 16px 14px' }}>
                      <div style={{ fontSize: 12, color: t.text3, marginBottom: 8 }}>{tr('an.salaryLabel')}: {currency}{fv(emp.salary)}{deduct > 0 ? ` · ${tr('an.deductWord')} −${currency}${fv(deduct)}` : ''}{advance > 0 ? ` · ${tr('pe.advances')} −${currency}${fv(advance)}` : ''}</div>
                      {abs > 0 && <div style={{ marginBottom: 8, height: 3, background: t.fill2, borderRadius: 2, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${Math.min(abs / 22 * 100, 100).toFixed(1)}%`, background: t.red, borderRadius: 2 }} />
                      </div>}
                      {paid > 0 && <div style={{ fontSize: 12, color: t.green, marginBottom: 6 }}>{tr('pe.paidStatus')} −{currency}{fv(paid)}</div>}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span style={{ fontSize: 13, color: t.orange, fontWeight: 600 }}>{tr('an.cashShort')} {currency}{fv(remaining)}</span>
                        {card > 0 && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ fontSize: 12, color: t.text3 }}>{tr('an.toCard')}</span>
                            <span style={{ fontSize: 14, fontWeight: 700, color: t.purple }}>{currency}{fv(card)}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  const renderBank = () => {
    if (!isPro) {
      return (
        <div style={{ background: t.surface, borderRadius: 18, padding: '28px 20px', textAlign: 'center' as const, boxShadow: t.sh }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: t.text, marginBottom: 6 }}>{tr('an.bankProOnly')}</div>
          <div style={{ fontSize: 13, color: t.text3 }}>{tr('an.bankProOnlyHint')}</div>
        </div>
      )
    }

    if (!bankConnection) {
      return (
        <div style={{ background: t.surface, borderRadius: 18, padding: '24px 20px', boxShadow: t.sh }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: t.text, marginBottom: 12 }}>{tr('an.bankConnectCta')}</div>
          {bankError && <div style={{ fontSize: 13, color: t.red, marginBottom: 12 }}>{bankError}</div>}
          {bankInstitutions.length > 0 ? (
            <div>
              {bankInstitutions.map((inst) => (
                <button key={`${inst.name}-${inst.country}`} onClick={() => connectBank(inst.name)} disabled={bankBusy}
                  style={{ display: 'block', width: '100%', textAlign: 'left' as const, padding: '12px 14px', borderRadius: 12, border: `1px solid ${t.sep2}`, background: t.fill, color: t.text, fontFamily: 'inherit', fontSize: 14, marginBottom: 8, cursor: 'pointer' }}>
                  {inst.name}
                </button>
              ))}
              <button onClick={() => setBankInstitutions([])} style={{ background: 'none', border: 'none', color: t.text3, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>{tr('an.back')}</button>
            </div>
          ) : (
            <>
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 12, color: t.text3, marginBottom: 6 }}>{tr('an.bankCountry')}</div>
                <select value={bankCountry} onChange={e => setBankCountry(e.target.value)}
                  style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: `1px solid ${t.sep2}`, background: t.fill, color: t.text, fontFamily: 'inherit', fontSize: 14 }}>
                  {BANK_COUNTRIES.map(code => <option key={code} value={code}>{countryName(code, locale)}</option>)}
                </select>
              </div>
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 12, color: t.text3, marginBottom: 6 }}>{tr('an.bankName')}</div>
                <input value={bankQuery} onChange={e => setBankQuery(e.target.value)} placeholder={tr('an.bankNamePlaceholder')}
                  style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: `1px solid ${t.sep2}`, background: t.fill, color: t.text, fontFamily: 'inherit', fontSize: 14, boxSizing: 'border-box' as const }} />
              </div>
              <button onClick={() => connectBank()} disabled={bankBusy || !bankQuery.trim()}
                style={{ width: '100%', padding: '14px', borderRadius: 14, background: t.green, color: '#fff', border: 'none', fontFamily: 'inherit', fontSize: 15, fontWeight: 700, cursor: 'pointer', opacity: (bankBusy || !bankQuery.trim()) ? 0.6 : 1 }}>
                {bankBusy ? '···' : tr('an.bankConnect')}
              </button>
            </>
          )}
        </div>
      )
    }

    const expiresAt = bankConnection.consent_expires_at ? new Date(bankConnection.consent_expires_at) : null
    const daysLeft = expiresAt ? Math.ceil((expiresAt.getTime() - Date.now()) / 86400000) : null
    const grouped: Record<string, any[]> = {}
    ;(bankTx || []).forEach((row: any) => { const k = row.booking_date || '—'; (grouped[k] = grouped[k] || []).push(row) })
    const days = Object.keys(grouped).sort((a, b) => a < b ? 1 : -1)

    return (
      <div>
        {bankError && <div style={{ fontSize: 13, color: t.red, marginBottom: 12 }}>{bankError}</div>}
        {daysLeft !== null && daysLeft <= 7 && (
          <div style={{ background: `${t.orange}18`, borderRadius: 14, padding: '12px 14px', marginBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <span style={{ fontSize: 13, color: t.orange, fontWeight: 500 }}>{tr('an.bankReconsentSoon', { n: String(Math.max(0, daysLeft)) })}</span>
            <button onClick={() => connectBank(bankConnection.institution_name, bankConnection.institution_id)} style={{ background: 'none', border: 'none', color: t.orange, fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>{tr('an.bankReconnect')}</button>
          </div>
        )}
        <div style={{ background: t.surface, borderRadius: 18, padding: '20px 18px', boxShadow: t.sh, marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: t.text3, textTransform: 'uppercase', letterSpacing: 0.5 }}>{tr('an.bankBalance')}</div>
              <div style={{ fontSize: 34, fontWeight: 800, color: t.text, letterSpacing: -1, marginTop: 6 }}>{currency}{fv(bankConnection.balance || 0)}</div>
              {bankConnection.balance_synced_at && <div style={{ fontSize: 12, color: t.text3, marginTop: 4 }}>{tr('an.bankUpdated', { d: new Date(bankConnection.balance_synced_at).toLocaleString(locale) })}</div>}
            </div>
            <button onClick={refreshBank} disabled={bankBusy} style={{ width: 40, height: 40, borderRadius: '50%', background: t.fill, border: 'none', color: t.text, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: bankBusy ? 0.5 : 1 }}>
              <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M23 4v6h-6M1 20v-6h6" /><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" /></svg>
            </button>
          </div>
        </div>
        <div style={{ fontSize: 12, fontWeight: 600, color: t.text3, textTransform: 'uppercase', letterSpacing: 0.5, padding: '8px 4px 8px' }}>{tr('an.history')}</div>
        <div style={{ background: t.surface, borderRadius: 16, overflow: 'hidden', boxShadow: t.sh }}>
          {days.length === 0
            ? <div style={{ padding: '32px', textAlign: 'center' as const, color: t.text4 }}>{tr('an.bankNoTransactions')}</div>
            : days.map((day, di) => (
              <div key={day} style={{ borderBottom: di < days.length - 1 ? `0.5px solid ${t.sep2}` : 'none' }}>
                <div style={{ padding: '10px 14px 4px', fontSize: 12, fontWeight: 600, color: t.text3 }}>{day}</div>
                {grouped[day].map((row: any) => (
                  <div key={row.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px' }}>
                    <div style={{ width: 30, height: 30, borderRadius: '50%', background: row.amount >= 0 ? `${t.green}18` : `${t.red}18`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <svg width="14" height="14" fill="none" stroke={row.amount >= 0 ? t.green : t.red} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                        {row.amount >= 0 ? <path d="M12 19V5M5 12l7-7 7 7" /> : <path d="M12 5v14M5 12l7 7 7-7" />}
                      </svg>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, color: t.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{row.description || row.counterparty || '—'}</div>
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: row.amount >= 0 ? t.green : t.red, flexShrink: 0 }}>{row.amount >= 0 ? '+' : ''}{currency}{fv(row.amount)}</div>
                  </div>
                ))}
              </div>
            ))
          }
        </div>
      </div>
    )
  }

  if (!restaurantId) return <AuthGate appId="analytics" appName="Mise Analytics" onAuth={setRestaurantId} />

  if (!t.mounted || loading) return embedded
    ? <div style={{ display: 'flex', justifyContent: 'center', padding: '80px 0' }}><Spinner /></div>
    : <AppLoading app="analytics" bg={t.bg} fill={t.fill} accent={t.blue} />

  const TABS = [
    { id: 'period', label: tr('an.tabPeriod'), icon: (a: boolean) => <svg fill="none" stroke="currentColor" strokeWidth={a ? 2.2 : 1.8} viewBox="0 0 24 24" width="26" height="26"><rect x="3" y="4" width="18" height="18" rx="3" /><path d="M16 2v4M8 2v4M3 10h18" /></svg> },
    { id: 'kassa', label: tr('an.tabKassa'), icon: (a: boolean) => <svg fill="none" stroke="currentColor" strokeWidth={a ? 2.2 : 1.8} viewBox="0 0 24 24" width="26" height="26"><rect x="2" y="7" width="20" height="14" rx="2" /><path d="M16 3H8L2 7h20z" /></svg> },
    { id: 'bank', label: tr('an.tabBank'), icon: (a: boolean) => <svg fill="none" stroke="currentColor" strokeWidth={a ? 2.2 : 1.8} viewBox="0 0 24 24" width="26" height="26"><rect x="2" y="6" width="20" height="14" rx="2" /><path d="M2 10h20" strokeLinecap="round" /><path d="M6 15h4" strokeLinecap="round" /></svg> },
    { id: 'salary', label: tr('an.tabSalary'), icon: (a: boolean) => <svg fill="none" stroke="currentColor" strokeWidth={a ? 2.2 : 1.8} viewBox="0 0 24 24" width="26" height="26"><circle cx="12" cy="8" r="4" /><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" /></svg> },
    { id: 'hookah', label: tr('an.tabHookah'), icon: (a: boolean) => <svg fill="none" stroke="currentColor" strokeWidth={a ? 2.2 : 1.8} viewBox="0 0 24 24" width="26" height="26"><path d="M8 8c0-2.5 3-4 3-6" strokeLinecap="round"/><path d="M12 8c0-2.5 3-4 3-6" strokeLinecap="round"/><path d="M16 8c0-2.5 3-4 3-6" strokeLinecap="round"/><path d="M5 14h14" strokeLinecap="round"/><path d="M5 17c1 1.5 2 2 3.5 2s2.5-1 4-1 2.5 1 4 1 2.5-.5 3.5-2" strokeLinecap="round"/></svg> },
  ] as const

  return (
    <div style={embedded
      ? { display: 'flex', flexDirection: 'column', fontFamily: "-apple-system,BlinkMacSystemFont,'SF Pro Text',sans-serif", WebkitFontSmoothing: 'antialiased', color: t.text }
      : { height: '100vh', overflow: 'hidden', background: t.bg, fontFamily: "-apple-system,BlinkMacSystemFont,'SF Pro Text',sans-serif", WebkitFontSmoothing: 'antialiased', color: t.text }}>
      <style>{`
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes fadeUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
        @keyframes pulse{0%,100%{transform:scale(1);opacity:1}50%{transform:scale(1.2);opacity:.6}}
        @keyframes orbit{from{transform:rotate(0deg) translateX(7px) rotate(0deg)}to{transform:rotate(360deg) translateX(7px) rotate(-360deg)}}
        * { box-sizing: border-box }
        ::-webkit-scrollbar { display: none }
      `}</style>

      {/* HEADER: standalone — фикс-шапка с брендом и темой; embedded — строка контролов в потоке */}
      <div style={embedded
        ? { order: 0, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, marginBottom: 12, maxWidth: contentMaxWidth, width: '100%', alignSelf: 'center', boxSizing: 'border-box' as const }
        : { position: 'fixed', top: 0, left: 0, right: 0, zIndex: 300, height: 56, background: t.hbg, backdropFilter: 'saturate(200%) blur(24px)', WebkitBackdropFilter: 'saturate(200%) blur(24px)', borderBottom: `0.5px solid ${t.sep2}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px' }}>
        {!embedded && <AppSwitchBrand name="Analytics" accent={t.green} color={t.text} muted={t.text3} size={18} />}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {!embedded && <button onClick={t.toggle} style={{ width: 36, height: 36, borderRadius: '50%', background: t.fill, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: t.text }}>
            {t.dark
              ? <svg width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="5" /><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" /></svg>
              : <svg width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" /></svg>
            }
          </button>}
          <button onClick={() => setShowMonthPicker(true)} style={{ display: 'flex', alignItems: 'center', gap: 5, background: `${t.green}18`, borderRadius: 20, padding: '7px 14px', cursor: 'pointer', fontSize: 14, fontWeight: 600, color: t.green, border: 'none', fontFamily: 'inherit' }}>
            {mShort(currentDate)} {currentDate.getFullYear()}
            <svg width="10" height="6" fill="none" stroke={t.green} strokeWidth="2.5" viewBox="0 0 10 6"><path d="M1 1l4 4 4-4" /></svg>
          </button>
          <button onClick={() => isPro ? setShowAI(true) : alert(tr('an.aiProOnly'))} style={{ width: 36, height: 36, borderRadius: '50%', background: `${t.green}18`, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' as const, opacity: isPro ? 1 : 0.55 }}>
            <div style={{ position: 'relative' as const, width: 20, height: 20 }}>
              <div style={{ position: 'absolute' as const, inset: 0, borderRadius: '50%', border: `1.5px solid ${t.green}66`, animation: 'pulse 2s ease-in-out infinite' }} />
              <div style={{ position: 'absolute' as const, inset: 3, borderRadius: '50%', background: t.green, animation: 'pulse 2s ease-in-out infinite .3s' }} />
              <div style={{ position: 'absolute' as const, width: 4, height: 4, borderRadius: '50%', background: '#fff', top: '50%', left: '50%', marginTop: -2, marginLeft: -2, animation: 'orbit 1.5s linear infinite' }} />
            </div>
          </button>
        </div>
      </div>

      {/* CONTENT */}
      <div style={embedded
        ? { order: 2 }
        : { position: 'fixed', top: 56, left: 0, right: 0, bottom: 82, overflowY: 'auto', background: t.bg }}>
        <div style={{ padding: embedded ? '0 0 28px' : '16px 16px 28px', maxWidth: contentMaxWidth, margin: '0 auto', animation: 'fadeUp .22s ease' }}>

          {tab === 'period' && (
            <>
              <div style={{ display: 'flex', background: t.fill, borderRadius: 12, padding: 3, marginBottom: 16, gap: 2 }}>
                {(['day', 'week', 'month'] as const).map(m => (
                  <button key={m} onClick={() => setPeriodMode(m)} style={{ flex: 1, padding: '8px 0', borderRadius: 10, border: 'none', fontFamily: 'inherit', fontSize: 13, fontWeight: periodMode === m ? 700 : 500, cursor: 'pointer', background: periodMode === m ? t.surface : 'transparent', color: periodMode === m ? t.green : t.text3, boxShadow: periodMode === m ? t.sh2 : 'none', transition: 'all .18s' }}>
                    {m === 'day' ? tr('an.day') : m === 'week' ? tr('an.week') : tr('an.month')}
                  </button>
                ))}
              </div>
              {periodMode !== 'month' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, background: t.surface, borderRadius: 14, padding: '12px 16px', marginBottom: 16, boxShadow: t.sh }}>
                  <button onClick={() => { const d = new Date(currentDate); d.setDate(d.getDate() - (periodMode === 'week' ? 7 : 1)); setCurrentDate(d) }} style={{ width: 40, height: 40, borderRadius: '50%', background: t.fill, border: 'none', color: t.text, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <svg width="10" height="18" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" viewBox="0 0 10 18"><path d="M8 1L1 9l7 8" /></svg>
                  </button>
                  <div style={{ flex: 1, textAlign: 'center' as const }}>
                    <div style={{ fontSize: 16, fontWeight: 700, color: t.text }}>{periodMode === 'day' ? `${currentDate.getDate()} ${mShort(currentDate)}` : `${tr('an.week')} ${currentDate.getDate()} ${mShort(currentDate)}`}</div>
                    <div style={{ fontSize: 12, color: t.green, marginTop: 1, fontWeight: 500 }}>{periodMode === 'day' ? dowShort(currentDate) : ''}</div>
                  </div>
                  <button onClick={() => { const d = new Date(currentDate); d.setDate(d.getDate() + (periodMode === 'week' ? 7 : 1)); setCurrentDate(d) }} style={{ width: 40, height: 40, borderRadius: '50%', background: t.fill, border: 'none', color: t.text, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <svg width="10" height="18" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" viewBox="0 0 10 18"><path d="M2 1l7 8-7 8" /></svg>
                  </button>
                </div>
              )}
              {renderPeriod()}
            </>
          )}

          {tab === 'kassa' && (
            <>
              <div style={{ display: 'flex', background: t.fill, borderRadius: 12, padding: 3, marginBottom: 16, gap: 2 }}>
                {(['kassa', 'inkass'] as const).map(m => (
                  <button key={m} onClick={() => setKassaMode(m)} style={{ flex: 1, padding: '8px 0', borderRadius: 10, border: 'none', fontFamily: 'inherit', fontSize: 13, fontWeight: kassaMode === m ? 700 : 500, cursor: 'pointer', background: kassaMode === m ? t.surface : 'transparent', color: kassaMode === m ? t.green : t.text3, boxShadow: kassaMode === m ? t.sh2 : 'none', transition: 'all .18s' }}>
                    {m === 'kassa' ? tr('an.cKassa') : tr('an.cInkassShort')}
                  </button>
                ))}
              </div>
              {renderKassa()}
            </>
          )}

          {tab === 'bank' && renderBank()}

          {tab === 'salary' && renderSalary()}

          {tab === 'hookah' && (() => {
            // Смены кальянщика из Mise Stash: выручка = кол-во × цена, табак = кол-во × порция
            // Бесплатные (владелец/сотрудники) не входят в выручку, но табак расходуют
            const paidRows = hookahRows.filter((r: any) => !r.is_free)
            const qtyMonth = paidRows.reduce((s: number, r: any) => s + (r.quantity || 0), 0)
            const qtyFree = hookahRows.filter((r: any) => r.is_free).reduce((s: number, r: any) => s + (r.quantity || 0), 0)
            const revMonth = paidRows.reduce((s: number, r: any) => s + (r.quantity || 0) * Number(r.price ?? hk.price), 0)
            // Граммовка хранится в строке продажи (у каждого вида кальяна — своя)
            const rowG = (r: any) => (r.quantity || 0) * Number(r.portion_g ?? hk.portion)
            const usedMonthG = hookahRows.reduce((s: number, r: any) => s + rowG(r), 0)
            const allUsedG = hk.allRows.reduce((s: number, r: any) => s + rowG(r), 0)
            const venueG = Math.max(0, hk.issuedG - allUsedG) // выдано в зал − списано по сменам
            const fmtKg = (g: number) => g >= 1000 ? `${(g / 1000).toLocaleString('de-DE', { maximumFractionDigits: 1 })} ${tr('an.kg')}` : `${Math.round(g)} ${tr('an.gUnit')}`
            // По дням и по вкусам
            const byDay = new Map<string, { total: number; paid: number }>()
            const byFlavor = new Map<string, number>()
            hookahRows.forEach((r: any) => {
              const d = byDay.get(r.date) || { total: 0, paid: 0 }
              d.total += r.quantity || 0
              if (!r.is_free) d.paid += r.quantity || 0
              byDay.set(r.date, d)
              // У бесплатных flavor = категория («Сотрудники» и т.п.) — в «Топ вкусов» не включаем
              if (!r.is_free) {
                const key = `${r.brand || ''} ${r.flavor || ''}`.trim() || '—'
                byFlavor.set(key, (byFlavor.get(key) || 0) + (r.quantity || 0))
              }
            })
            const flavors = [...byFlavor.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
            const maxFlavor = flavors[0]?.[1] || 1

            return (
              <div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
                  <StatCard label={tr('an.soldMonth')} rawValue={qtyMonth} value={String(qtyMonth)} color={t.orange} t={t} />
                  <StatCard label={tr('an.hookahRevenue')} rawValue={revMonth} value={`${currency}${fv(revMonth)}`} color={t.green} t={t} />
                  <StatCard label={tr('an.free')} rawValue={qtyFree} value={`${qtyFree} · ${fmtKg(qtyFree * hk.portion)}`} color={t.purple} sm t={t} />
                  <StatCard label={tr('an.tobaccoUsed')} rawValue={usedMonthG} value={fmtKg(usedMonthG)} color={t.blue} sm t={t} />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 10, marginBottom: 12 }}>
                  <StatCard label={tr('an.inStock')} rawValue={hk.stockG} value={fmtKg(hk.stockG)} color={t.text2 as any} sm t={t} />
                </div>
                <div style={{ background: t.surface, borderRadius: 16, padding: '14px 16px', boxShadow: t.sh, marginBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: t.text }}>{tr('an.atVenue')}</div>
                    <div style={{ fontSize: 12, color: t.text3, marginTop: 2 }}>{tr('an.venueFormula', { n: hk.portion })}</div>
                  </div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: t.orange }}>{fmtKg(venueG)}</div>
                </div>

                {/* Склад по брендам — read-only обзор для владельца (полное управление в Stash) */}
                {hk.stockRows.length > 0 && (() => {
                  const byBrand = new Map<string, { g: number; low: number }>()
                  hk.stockRows.forEach((r: any) => {
                    const b = r.brand || '—'
                    const x = byBrand.get(b) || { g: 0, low: 0 }
                    x.g += Number(r.quantity_g || 0)
                    if (Number(r.quantity_g || 0) <= Number(r.min_quantity_g || 0)) x.low += 1
                    byBrand.set(b, x)
                  })
                  const brands = [...byBrand.entries()].sort((a, b) => b[1].g - a[1].g)
                  const lowTotal = brands.reduce((s, [, x]) => s + x.low, 0)
                  return (
                    <>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 4px 8px' }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: t.text3, textTransform: 'uppercase', letterSpacing: 0.5 }}>{tr('an.stockByBrand')}</div>
                        {lowTotal > 0 && <span style={{ fontSize: 11, fontWeight: 700, color: t.red, background: `${t.red}14`, padding: '2px 8px', borderRadius: 10 }}>{tr('an.endingCount', { n: lowTotal })}</span>}
                      </div>
                      <div style={{ background: t.surface, borderRadius: 16, overflow: 'hidden', boxShadow: t.sh, marginBottom: 12 }}>
                        {brands.map(([b, x], i) => (
                          <div key={b} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '11px 16px', borderBottom: i < brands.length - 1 ? `0.5px solid ${t.sep2}` : 'none' }}>
                            <span style={{ fontSize: 14, color: t.text, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 7 }}>
                              {x.low > 0 && <span style={{ width: 7, height: 7, borderRadius: '50%', background: t.red, flexShrink: 0 }} />}
                              {b}
                            </span>
                            <span style={{ fontSize: 14, fontWeight: 700, color: x.low > 0 ? t.red : t.text2 }}>{fmtKg(x.g)}</span>
                          </div>
                        ))}
                      </div>
                    </>
                  )
                })()}

                {hookahRows.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '40px 20px', color: t.text3 }}>
                    <div style={{ fontWeight: 600, fontSize: 16, color: t.text2 }}>{tr('an.noShifts')}</div>
                    <div style={{ fontSize: 13, marginTop: 4 }}>{tr('an.hookahHint')}</div>
                  </div>
                ) : (
                  <>
                    {/* По видам кальяна */}
                    {hk.types.length > 0 && (() => {
                      const byType = new Map<string, { paid: number; free: number }>()
                      hookahRows.forEach((r: any) => {
                        if (!r.hookah_type_id) return
                        const d = byType.get(r.hookah_type_id) || { paid: 0, free: 0 }
                        if (r.is_free) d.free += r.quantity || 0; else d.paid += r.quantity || 0
                        byType.set(r.hookah_type_id, d)
                      })
                      const list = [...byType.entries()].sort((a, b) => (b[1].paid + b[1].free) - (a[1].paid + a[1].free))
                      if (!list.length) return null
                      return (
                        <>
                          <div style={{ fontSize: 12, fontWeight: 600, color: t.text3, textTransform: 'uppercase', letterSpacing: 0.5, padding: '8px 4px 8px' }}>{tr('an.byTypes')}</div>
                          <div style={{ background: t.surface, borderRadius: 16, overflow: 'hidden', boxShadow: t.sh, marginBottom: 12 }}>
                            {list.map(([id, n], i) => (
                              <div key={id} style={{ display: 'flex', justifyContent: 'space-between', padding: '11px 16px', borderBottom: i < list.length - 1 ? `0.5px solid ${t.sep2}` : 'none' }}>
                                <span style={{ fontSize: 14, color: t.text, fontWeight: 500 }}>{hk.types.find((tp: any) => tp.id === id)?.name || '—'}</span>
                                <span style={{ fontSize: 14 }}>
                                  <span style={{ fontWeight: 700, color: t.orange }}>{n.paid}</span>
                                  {n.free > 0 && <span style={{ color: t.purple }}> +{n.free} {tr('an.freeShort')}</span>}
                                </span>
                              </div>
                            ))}
                          </div>
                        </>
                      )
                    })()}

                    <div style={{ fontSize: 12, fontWeight: 600, color: t.text3, textTransform: 'uppercase', letterSpacing: 0.5, padding: '8px 4px 8px' }}>{tr('an.topFlavors')}</div>
                    <div style={{ background: t.surface, borderRadius: 16, padding: '14px 16px', boxShadow: t.sh, marginBottom: 12 }}>
                      {flavors.map(([name, n]) => (
                        <div key={name} style={{ marginBottom: 10 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                            <span style={{ fontSize: 13, color: t.text, fontWeight: 500 }}>{name}</span>
                            <span style={{ fontSize: 13, fontWeight: 700, color: t.orange }}>{n}</span>
                          </div>
                          <div style={{ height: 6, borderRadius: 3, background: t.fill }}>
                            <div style={{ height: '100%', width: `${n / maxFlavor * 100}%`, borderRadius: 3, background: t.orange }} />
                          </div>
                        </div>
                      ))}
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: t.text3, textTransform: 'uppercase', letterSpacing: 0.5, padding: '4px 4px 8px' }}>{tr('an.byDays')}</div>
                    <div style={{ background: t.surface, borderRadius: 16, overflow: 'hidden', boxShadow: t.sh }}>
                      {[...byDay.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([d, n], i, arr) => {
                        const open = expDay === d
                        // Разбивка дня по подкатегориям (видам) — считаем при раскрытии
                        const dayByType = new Map<string, { paid: number; free: number }>()
                        hookahRows.forEach((r: any) => {
                          if (r.date !== d || !r.hookah_type_id) return
                          const x = dayByType.get(r.hookah_type_id) || { paid: 0, free: 0 }
                          if (r.is_free) x.free += r.quantity || 0; else x.paid += r.quantity || 0
                          dayByType.set(r.hookah_type_id, x)
                        })
                        const dayTypes = [...dayByType.entries()].sort((a, b) => (b[1].paid + b[1].free) - (a[1].paid + a[1].free))
                        return (
                          <div key={d} style={{ borderBottom: i < arr.length - 1 ? `0.5px solid ${t.sep2}` : 'none' }}>
                            <button onClick={() => setExpDay(open ? null : d)} style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '11px 16px', background: 'transparent', border: 'none', fontFamily: 'inherit', cursor: 'pointer', textAlign: 'left' }}>
                              <span style={{ fontSize: 14, color: t.text, display: 'flex', alignItems: 'center', gap: 8 }}>
                                <svg width="8" height="13" fill="none" stroke={t.text3} strokeWidth="2.2" strokeLinecap="round" viewBox="0 0 10 18" style={{ transform: open ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform .25s ease' }}><path d="M2 1l7 8-7 8" /></svg>
                                {dd(d)}
                              </span>
                              <span style={{ fontSize: 14 }}>
                                <span style={{ fontWeight: 700, color: t.orange }}>{n.paid}</span>
                                {n.total > n.paid && <span style={{ color: t.purple }}> +{n.total - n.paid} {tr('an.freeShort')}</span>}
                                <span style={{ color: t.text3 }}> · {currency}{fv(n.paid * hk.price)}</span>
                              </span>
                            </button>
                            <div style={{ display: 'grid', gridTemplateRows: open ? '1fr' : '0fr', transition: 'grid-template-rows .28s cubic-bezier(.32,.72,0,1)' }}>
                              <div style={{ overflow: 'hidden' }}>
                                <div style={{ padding: '0 16px 12px 36px' }}>
                                  {dayTypes.length === 0
                                    ? <div style={{ fontSize: 12, color: t.text3, paddingBottom: 4 }}>{tr('an.noTypeBreakdown')}</div>
                                    : dayTypes.map(([id, x]) => (
                                      <div key={id} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', fontSize: 13 }}>
                                        <span style={{ color: t.text2 }}>{hk.types.find((tp: any) => tp.id === id)?.name || '—'}</span>
                                        <span><span style={{ fontWeight: 600, color: t.orange }}>{x.paid}</span>{x.free > 0 && <span style={{ color: t.purple }}> +{x.free} {tr('an.freeShort')}</span>}</span>
                                      </div>
                                    ))}
                                </div>
                              </div>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </>
                )}
              </div>
            )
          })()}
        </div>
      </div>

      {/* NAV: standalone — фикс-бар снизу; embedded — сегмент-строка над контентом (order 1) */}
      <div style={embedded
        ? { order: 1, display: 'flex', gap: 2, background: t.fill, borderRadius: 12, padding: 3, marginBottom: 16, maxWidth: contentMaxWidth, width: '100%', alignSelf: 'center', boxSizing: 'border-box' as const }
        : { position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 300, height: 82, background: t.nbg, backdropFilter: 'saturate(200%) blur(24px)', WebkitBackdropFilter: 'saturate(200%) blur(24px)', borderTop: `0.5px solid ${t.sep2}`, display: 'flex', alignItems: 'flex-start', paddingTop: 10, paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
        {TABS.map(tb => (
          embedded ? (
            <button key={tb.id} onClick={() => setTab(tb.id as any)} style={{ flex: 1, padding: '8px 0', borderRadius: 10, border: 'none', fontFamily: 'inherit', fontSize: 13, fontWeight: tab === tb.id ? 700 : 500, cursor: 'pointer', background: tab === tb.id ? t.surface : 'transparent', color: tab === tb.id ? t.green : t.text3, boxShadow: tab === tb.id ? t.sh2 : 'none', transition: 'all .18s' }}>
              {tb.label}
            </button>
          ) : (
            <button key={tb.id} onClick={() => setTab(tb.id as any)} style={{ flex: 1, display: 'flex', flexDirection: 'column' as const, alignItems: 'center', gap: 3, cursor: 'pointer', color: tab === tb.id ? t.green : t.text3, border: 'none', background: 'none', fontFamily: 'inherit', padding: 0, fontSize: 10, fontWeight: tab === tb.id ? 700 : 500, transition: 'color .18s' }}>
              <span style={{ transform: tab === tb.id ? 'scale(1.08)' : 'scale(1)', transition: 'transform .18s ease', display: 'flex' }}>{tb.icon(tab === tb.id)}</span>
              {tb.label}
            </button>
          )
        ))}
      </div>

      {/* ДОЛГИ (C1, аудит 2026-08-15) — портировано с iOS AnalyticsView.DebtsTab */}
      {showDebts && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 500, background: 'rgba(0,0,0,.45)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }} onClick={() => { setShowDebts(false); setShowDebtHistory(false) }}>
          <div style={{ background: t.surface, borderRadius: '24px 24px 0 0', width: '100%', maxWidth: 480, maxHeight: '82vh', overflowY: 'auto' as const, paddingBottom: 32 }} onClick={(e: any) => e.stopPropagation()}>
            <div style={{ width: 36, height: 4, background: t.fill, borderRadius: 2, margin: '12px auto 0' }} />
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px 0' }}>
              <div style={{ fontSize: 17, fontWeight: 700, color: t.text }}>{tr('an.debts')}</div>
              <button onClick={() => { setShowDebts(false); setShowDebtHistory(false) }} style={{ background: 'none', border: 'none', color: t.text4, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit' }}>{tr('pe.stDone')}</button>
            </div>
            <div style={{ padding: '16px 16px 0' }}>
              <div style={{ textAlign: 'center' as const, padding: '18px 0', background: t.fill, borderRadius: 16, marginBottom: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: t.text3, textTransform: 'uppercase', letterSpacing: 0.5 }}>{tr('an.debts')}</div>
                <div style={{ fontSize: 28, fontWeight: 800, color: t.orange, marginTop: 4 }}>{currency}{fv(debtTotal)}</div>
                <div style={{ fontSize: 11, color: t.text3, marginTop: 4, padding: '0 20px' }}>{tr('an.debtTotalHint')}</div>
              </div>

              {periodDebts.length === 0 ? (
                <div style={{ textAlign: 'center' as const, padding: '28px 0', color: t.text3, fontSize: 13 }}>{tr('an.debtsNonePeriod')}</div>
              ) : (
                <div style={{ background: t.fill, borderRadius: 14, overflow: 'hidden', marginBottom: 12 }}>
                  {periodDebts.map((d, i) => (
                    <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: i < periodDebts.length - 1 ? `0.5px solid ${t.sep2}` : 'none' }}>
                      <svg width="14" height="14" fill="none" stroke={t.orange} strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><path d="M12 7.5v5.5M12 16.5h.01" strokeLinecap="round" /></svg>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 14, fontWeight: 500, color: t.text }}>{d.categoryName}</div>
                        <div style={{ fontSize: 11, color: t.text3 }}>{dd(d.date)}</div>
                      </div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: t.orange }}>{currency}{fv(d.amount)}</div>
                    </div>
                  ))}
                </div>
              )}

              {periodDebtHistory.length > 0 && (
                <div style={{ background: t.fill, borderRadius: 14, overflow: 'hidden' }}>
                  <div onClick={() => setShowDebtHistory(v => !v)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', cursor: 'pointer' }}>
                    <span style={{ fontSize: 12, fontWeight: 500, color: t.text3 }}>{tr('an.debtHistory')}</span>
                    <svg width="10" height="10" fill="none" stroke={t.text3} strokeWidth="2" strokeLinecap="round" viewBox="0 0 12 12" style={{ transform: showDebtHistory ? 'rotate(180deg)' : 'none', transition: 'transform .18s' }}><path d="M2 4l4 4 4-4" /></svg>
                  </div>
                  {showDebtHistory && periodDebtHistory.map((d, i) => (
                    <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', borderTop: `0.5px solid ${t.sep2}` }}>
                      <svg width="14" height="14" fill="none" stroke={t.green} strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><path d="M8 12l2.5 2.5L16 9" strokeLinecap="round" strokeLinejoin="round" /></svg>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 500, color: t.text2 }}>{d.categoryName}</div>
                        <div style={{ fontSize: 11, color: t.text3 }}>{dd(d.date)}{d.paidAt ? ` · ${tr('pe.paidOn', { date: dd(d.paidAt) })}` : ''}</div>
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 500, color: t.text3 }}>{currency}{fv(d.amount)}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* MONTH PICKER */}
      {showMonthPicker && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 500, background: 'rgba(0,0,0,.45)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }} onClick={() => setShowMonthPicker(false)}>
          <div style={{ background: t.surface, borderRadius: '24px 24px 0 0', width: '100%', maxWidth: 480, paddingBottom: 32 }} onClick={(e: any) => e.stopPropagation()}>
            <div style={{ width: 36, height: 4, background: t.fill, borderRadius: 2, margin: '12px auto 0' }} />
            <div style={{ fontSize: 17, fontWeight: 700, textAlign: 'center' as const, padding: '14px 20px 0', color: t.text }}>{tr('an.monthPick')}</div>
            {Array.from({ length: 12 }, (_, i) => {
              const d = new Date(); d.setMonth(d.getMonth() - i)
              const active = d.getMonth() === currentDate.getMonth() && d.getFullYear() === currentDate.getFullYear()
              return (
                <div key={i} onClick={() => { setCurrentDate(d); setShowMonthPicker(false); loadAll(restaurantId, d) }} style={{ padding: '15px 20px', fontSize: 16, cursor: 'pointer', borderBottom: `0.5px solid ${t.sep2}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: active ? t.green : t.text, fontWeight: active ? 700 : 400 }}>
                  {mFull(d)} {d.getFullYear()}
                  {active && <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="10" fill={t.green} /><path d="m6 10 2.5 2.5L14 7" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" /></svg>}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* AI CHAT */}
      {showAI && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 500, background: 'rgba(0,0,0,.45)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }} onClick={() => setShowAI(false)}>
          <div style={{ background: t.surface, borderRadius: '24px 24px 0 0', width: '100%', maxWidth: 480, height: '82vh', display: 'flex', flexDirection: 'column' as const }} onClick={(e: any) => e.stopPropagation()}>
            <div style={{ width: 36, height: 4, background: t.fill, borderRadius: 2, margin: '12px auto 0' }} />
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px 0' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ position: 'relative' as const, width: 28, height: 28 }}>
                  <div style={{ position: 'absolute' as const, inset: 0, borderRadius: '50%', border: `1.5px solid ${t.green}55`, animation: 'pulse 2s ease-in-out infinite' }} />
                  <div style={{ position: 'absolute' as const, inset: 4, borderRadius: '50%', background: t.green }} />
                </div>
                <div style={{ fontSize: 17, fontWeight: 700, color: t.text }}>Mise AI</div>
              </div>
              <button onClick={() => { setChatMsgs([]); localStorage.removeItem('mise_chat') }} style={{ background: 'none', border: 'none', color: t.text4, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>{tr('an.clear')}</button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto' as const, padding: '12px 16px', display: 'flex', flexDirection: 'column' as const, gap: 10 }}>
              {chatMsgs.length === 0 && (
                <div>
                  <div style={{ textAlign: 'center' as const, color: t.text4, padding: '16px 0 20px', fontSize: 13 }}>{tr('an.askBusiness')}</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    {[tr('an.sg1'), tr('an.sg2'), tr('an.sg3'), tr('an.sg4')].map(q => (
                      <button key={q} onClick={() => sendAI(q)} style={{ padding: '10px 12px', borderRadius: 12, background: t.fill, border: 'none', fontFamily: 'inherit', fontSize: 13, color: t.text, cursor: 'pointer', textAlign: 'left' as const, lineHeight: 1.4 }}>{q}</button>
                    ))}
                  </div>
                </div>
              )}
              {chatMsgs.map((m, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
                  <div style={{ maxWidth: '82%', padding: '10px 14px', borderRadius: m.role === 'user' ? '16px 16px 4px 16px' : '16px 16px 16px 4px', background: m.role === 'user' ? t.green : t.fill, color: m.role === 'user' ? '#fff' : t.text, fontSize: 14, lineHeight: 1.5 }}>{m.text}</div>
                </div>
              ))}
              {chatLoading && <div style={{ display: 'flex' }}><div style={{ padding: '10px 14px', borderRadius: '16px 16px 16px 4px', background: t.fill, color: t.text3, fontSize: 14 }}>{tr('an.thinking')}</div></div>}
              <div ref={chatEndRef} />
            </div>
            <div style={{ padding: '10px 16px 20px', display: 'flex', gap: 8 }}>
              <input value={chatInput} onChange={e => setChatInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && sendAI()} placeholder={tr('an.askBusinessPh')} style={{ flex: 1, padding: '11px 14px', borderRadius: 12, border: `1px solid ${t.sep2}`, fontSize: 14, color: t.text, background: t.surface, fontFamily: 'inherit', outline: 'none' }} />
              <button onClick={() => sendAI()} disabled={chatLoading || !chatInput.trim()} style={{ padding: '11px 18px', borderRadius: 12, background: t.green, color: '#fff', border: 'none', fontFamily: 'inherit', fontSize: 14, fontWeight: 600, cursor: 'pointer', opacity: chatLoading || !chatInput.trim() ? 0.5 : 1 }}>
                <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M22 2L11 13M22 2L15 22l-4-9-9-4 20-7z" /></svg>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
