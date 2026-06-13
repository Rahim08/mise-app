'use client'
export const dynamic = 'force-dynamic'
import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import { db } from '@/lib/db'
import { useTheme } from '@/hooks/useTheme'
import { AuthGate } from '@/components/AuthGate'
import { AppLoading } from '@/components/AppLoading'

// ── HELPERS ───────────────────────────────────────────────────────────────────

function fv(v: number) { return v.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }
// Local calendar date (YYYY-MM-DD). Using toISOString() would shift the day in non-UTC timezones.
function fmtDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function dd(s: string) { return s.slice(8, 10) + '.' + s.slice(5, 7) }
const MRU = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь']
const DOW = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб']
const COLORS = ['#34c759', '#ff3b30', '#007aff', '#ff9500', '#af52de', '#00c7be', '#ff6b35', '#5856d6']
const SUGGESTED = ['Как идёт этот месяц?', 'Где больше всего трат?', 'Сравни с прошлым месяцем', 'Хватит ли на зарплаты?']

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
    if (ri === rows.length - 1 && r[0] === 'Итого') { doc.setDrawColor(210); doc.line(40, y - 11, 555, y - 11) }
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
        <text x={W - 70} y={12} fontSize="8" fill="currentColor" fillOpacity="0.5">Доход</text>
        <rect x={W - 80} y={16} width={8} height={8} rx="2" fill="#ff3b30" opacity="0.8" />
        <text x={W - 70} y={24} fontSize="8" fill="currentColor" fillOpacity="0.5">Расход</text>
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
          <span style={{ fontSize: 10, color: t.text4 }}>vs прошлый</span>
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

export default function AnalyticsApp() {
  const t = useTheme('mise_ana_dark')
  const [restaurantId, setRestaurantId] = useState('')
  const [currency, setCurrency] = useState('€')
  const [isPro, setIsPro] = useState(false)
  const [tab, setTab] = useState<'period' | 'kassa' | 'forecast' | 'salary' | 'hookah'>('period')
  const [periodMode, setPeriodMode] = useState<'day' | 'week' | 'month'>('month')
  const [kassaMode, setKassaMode] = useState<'kassa' | 'inkass'>('kassa')
  const [currentDate, setCurrentDate] = useState(new Date())
  const [includeCard, setIncludeCard] = useState(false) // restaurant_settings.include_card_in_analytics
  const [revGoal, setRevGoal] = useState(0)             // restaurant_settings.monthly_revenue_goal (цель выручки на месяц)
  const [expSalary, setExpSalary] = useState<string | null>(null) // раскрытая карточка ЗП (сворачиваемые)
  // Кальян: настройки + остатки (all-time) + строки смен кальянщика за месяц
  const [hk, setHk] = useState<{ price: number; portion: number; stockG: number; issuedG: number; allRows: any[]; types: any[] }>({ price: 0, portion: 20, stockG: 0, issuedG: 0, allRows: [], types: [] })
  const [hookahRows, setHookahRows] = useState<any[]>([])
  const [shiftsRaw, setShifts] = useState<any[]>([])
  const [prevShiftsRaw, setPrevShifts] = useState<any[]>([])
  const [allShiftsRaw, setAllShifts] = useState<any[]>([])
  const [expenses, setExpenses] = useState<any[]>([])
  const [allExpenses, setAllExpenses] = useState<any[]>([])
  const [employees, setEmployees] = useState<any[]>([])
  const [cardAmounts, setCardAmounts] = useState<any[]>([])
  const [absences, setAbsences] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [showMonthPicker, setShowMonthPicker] = useState(false)
  const [showAI, setShowAI] = useState(false)
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
      setRevGoal(Number(r?.monthly_revenue_goal || 0))
      setHk(h => ({ ...h, price: Number(r?.hookah_price || 0), portion: Number(r?.hookah_portion_g || 20) }))
    })
    // Кальян: склад, выдано в зал (all-time) и продано (all-time) — для остатка «в заведении»
    db.from('tobacco_stock').select('quantity_g').then(({ data }: any) =>
      setHk(h => ({ ...h, stockG: (data || []).reduce((s: number, r: any) => s + (r.quantity_g || 0), 0) })))
    db.from('tobacco_movements').select('quantity_g, type').then(({ data }: any) =>
      setHk(h => ({ ...h, issuedG: (data || []).filter((r: any) => r.type === 'out').reduce((s: number, r: any) => s + (r.quantity_g || 0), 0) })))
    db.from('hookah_sales').select('quantity, portion_g').then(({ data }: any) =>
      setHk(h => ({ ...h, allRows: data || [] })))
    db.from('hookah_types').select('id, name').then(({ data }: any) =>
      setHk(h => ({ ...h, types: data || [] })))
    loadAll(restaurantId, new Date())
    loadAllHistory(restaurantId)
  }, [restaurantId])

  const loadAll = async (rid: string, date: Date) => {
    setLoading(true)
    const monthStart = fmtDate(new Date(date.getFullYear(), date.getMonth(), 1))
    const monthEnd = fmtDate(new Date(date.getFullYear(), date.getMonth() + 1, 0))
    const prevStart = fmtDate(new Date(date.getFullYear(), date.getMonth() - 1, 1))
    const prevEnd = fmtDate(new Date(date.getFullYear(), date.getMonth(), 0))

    const [s1, s2, s3, s4, s5, s6] = await Promise.all([
      db.from('shifts').select('*').eq('restaurant_id', rid).gte('date', monthStart).lte('date', monthEnd).order('date'),
      db.from('shifts').select('*').eq('restaurant_id', rid).gte('date', prevStart).lte('date', prevEnd).order('date'),
      db.from('employees').select('*').eq('restaurant_id', rid).eq('is_active', true).order('name'),
      db.from('monthly_card_amounts').select('*').eq('restaurant_id', rid).eq('month', fmtDate(date).slice(0, 7)),
      db.from('shift_absences').select('*').eq('restaurant_id', rid).gte('date', monthStart).lte('date', monthEnd),
      db.from('hookah_sales').select('*').gte('date', monthStart).lte('date', monthEnd).order('date'),
    ])
    setHookahRows(s6.data || [])

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
    }
    setLoading(false)
  }

  const loadAllHistory = async (rid: string) => {
    const yearStart = fmtDate(new Date(new Date().getFullYear() - 1, 0, 1))
    const { data: sh } = await db.from('shifts').select('*').eq('restaurant_id', rid).gte('date', yearStart).order('date')
    setAllShifts(sh || [])
    if (sh && sh.length > 0) {
      const { data: ex } = await db.from('shift_expenses').select('*').in('shift_id', sh.map((s: any) => s.id))
      setAllExpenses(ex || [])
    }
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

  const totalIncome = shifts.reduce((s: number, sh: any) => s + (sh.income || 0), 0)
  const totalExpense = shifts.reduce((s: number, sh: any) => s + (sh.total_expense || 0), 0)
  const totalInkass = shifts.reduce((s: number, sh: any) => s + (sh.inkassation || 0), 0)
  const lastShift = shifts[shifts.length - 1]
  const prevIncome = prevShifts.reduce((s: number, sh: any) => s + (sh.income || 0), 0)
  const prevExpense = prevShifts.reduce((s: number, sh: any) => s + (sh.total_expense || 0), 0)
  const pct = (cur: number, prev: number) => prev ? ((cur - prev) / prev * 100) : null

  const getCatMap = (exps: any[]) => {
    const m: Record<string, number> = {}
    exps.filter((e: any) => !e.employee_id).forEach((e: any) => { m[e.category_name] = (m[e.category_name] || 0) + e.amount })
    return Object.entries(m).sort((a, b) => b[1] - a[1])
  }

  const buildContext = () => {
    const catMap: Record<string, number> = {}
    allExpenses.filter((e: any) => !e.employee_id).forEach((e: any) => { catMap[e.category_name] = (catMap[e.category_name] || 0) + e.amount })
    const topCats = Object.entries(catMap).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([n, v]) => `${n}: ${currency}${fv(v)}`).join(', ')
    const totalAllIncome = allShifts.reduce((s: number, sh: any) => s + (sh.income || 0), 0)
    const totalAllExpense = allShifts.reduce((s: number, sh: any) => s + (sh.total_expense || 0), 0)
    return `Ты AI-ассистент ресторана. Текущий месяц (${MRU[currentDate.getMonth()]} ${currentDate.getFullYear()}): доход ${currency}${fv(totalIncome)}, расходы ${currency}${fv(totalExpense)}, касса ${currency}${fv(lastShift?.closing_balance || 0)}, инкассация ${currency}${fv(totalInkass)}, смен ${shifts.length}. Прошлый месяц: доход ${currency}${fv(prevIncome)}, расходы ${currency}${fv(prevExpense)}. За последний год: общий доход ${currency}${fv(totalAllIncome)}, общие расходы ${currency}${fv(totalAllExpense)}, смен ${allShifts.length}. Топ расходов за всё время: ${topCats}. Сотрудников: ${employees.length}, ФОТ: ${currency}${fv(employees.reduce((s: number, e: any) => s + e.salary, 0))}. Отвечай кратко и по делу на русском.`
  }

  const sendAI = async (msg?: string) => {
    const input = msg || chatInput.trim(); if (!input) return
    setChatInput('')
    const userMsg = { role: 'user', text: input }
    setChatMsgs(p => [...p, userMsg]); setChatLoading(true)
    try {
      const r = await fetch('/api/ai', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: [...chatMsgs, userMsg], context: buildContext() }) })
      const d = await r.json()
      setChatMsgs(p => [...p, { role: 'ai', text: d.text || 'Нет ответа' }])
    } catch { setChatMsgs(p => [...p, { role: 'ai', text: 'Ошибка соединения' }]) }
    setChatLoading(false)
  }

  // ── EXPORTS ──
  const monthTag = `${MRU[currentDate.getMonth()]}_${currentDate.getFullYear()}`
  const pdfCur = currency === '₸' ? 'KZT ' : currency // ₸ glyph not in embedded font
  const monthTitle = `${MRU[currentDate.getMonth()]} ${currentDate.getFullYear()}`

  const exportShifts = () => {
    const rows: (string | number)[][] = [['Дата', 'Вход', 'Доход', 'Расход', 'Инкассация', 'Касса']]
    shifts.forEach((s: any) => rows.push([
      s.date,
      (s.opening_balance || 0).toFixed(2),
      (s.income || 0).toFixed(2),
      (s.total_expense || 0).toFixed(2),
      (s.inkassation || 0).toFixed(2),
      (s.closing_balance || 0).toFixed(2),
    ]))
    rows.push(['Итого', '', totalIncome.toFixed(2), totalExpense.toFixed(2), totalInkass.toFixed(2), (lastShift?.closing_balance || 0).toFixed(2)])
    downloadCSV(`smeny_${monthTag}.csv`, rows)
  }

  const exportShiftsPDF = async () => {
    const doc = await makePdfDoc()
    const headers = ['Дата', 'Вход', 'Доход', 'Расход', 'Инкасс', 'Касса']
    const colX = [40, 130, 220, 310, 400, 485]
    const rows: string[][] = shifts.map((s: any) => [
      s.date,
      pdfCur + fv(s.opening_balance || 0),
      pdfCur + fv(s.income || 0),
      pdfCur + fv(s.total_expense || 0),
      pdfCur + fv(s.inkassation || 0),
      pdfCur + fv(s.closing_balance || 0),
    ])
    rows.push(['Итого', '', pdfCur + fv(totalIncome), pdfCur + fv(totalExpense), pdfCur + fv(totalInkass), pdfCur + fv(lastShift?.closing_balance || 0)])
    pdfTable(doc, `Смены — ${monthTitle}`, headers, rows, colX)
    doc.save(`smeny_${monthTag}.pdf`)
  }

  // Сумма на карту за выбранный месяц: помесячная перекрывает фиксированную (employees.card_amount).
  const cardOf = (emp: any) => {
    const m = cardAmounts.find((c: any) => c.employee_id === emp.id)
    return m ? Number(m.card_amount || 0) : Number(emp.card_amount || 0)
  }

  const exportSalary = () => {
    const rows: (string | number)[][] = [['Сотрудник', 'Оклад', 'Пропуски', 'Вычет', 'Карта', 'Наличные', 'Итого']]
    employees.forEach((emp: any) => {
      const abs = absences.filter((a: any) => a.employee_id === emp.id).length
      const deduct = abs * emp.deduct_per_absence
      const card = cardOf(emp)
      const cash = emp.salary - deduct - card
      rows.push([emp.name, (emp.salary || 0).toFixed(2), abs, deduct.toFixed(2), card.toFixed(2), cash.toFixed(2), (cash + card).toFixed(2)])
    })
    downloadCSV(`zarplaty_${monthTag}.csv`, rows)
  }

  const exportSalaryPDF = async () => {
    const doc = await makePdfDoc()
    const headers = ['Сотрудник', 'Оклад', 'Проп.', 'Вычет', 'Карта', 'Нал.', 'Итого']
    const colX = [40, 200, 270, 330, 400, 465, 520]
    const rows: string[][] = employees.map((emp: any) => {
      const abs = absences.filter((a: any) => a.employee_id === emp.id).length
      const deduct = abs * emp.deduct_per_absence
      const card = cardOf(emp)
      const cash = emp.salary - deduct - card
      return [emp.name, pdfCur + fv(emp.salary || 0), String(abs), pdfCur + fv(deduct), pdfCur + fv(card), pdfCur + fv(cash), pdfCur + fv(cash + card)]
    })
    pdfTable(doc, `Зарплаты — ${monthTitle}`, headers, rows, colX)
    doc.save(`zarplaty_${monthTag}.pdf`)
  }

  // ── RENDER PERIOD ──
  const renderPeriod = () => {
    const dayStr = fmtDate(currentDate)
    const dayShift = shifts.find((s: any) => s.date === dayStr)
    const dayExps = dayShift ? expenses.filter((e: any) => e.shift_id === dayShift.id && !e.employee_id) : []
    const inkAmt = dayShift?.inkassation || 0
    const dayInk = inkAmt > 0 ? { amount: inkAmt, expense: 0, reason: null, balance: inkAmt } : null

    const getWeekShifts = () => {
      const start = new Date(currentDate); const day = start.getDay()
      start.setDate(start.getDate() - (day === 0 ? 6 : day - 1))
      const end = new Date(start); end.setDate(start.getDate() + 6)
      return shifts.filter((s: any) => s.date >= fmtDate(start) && s.date <= fmtDate(end))
    }

    if (periodMode === 'day') {
      if (!dayShift) return (
        <div style={{ padding: '60px 20px', textAlign: 'center', color: t.text3 }}>
          <div style={{ fontSize: 44, marginBottom: 12, opacity: 0.3 }}>
            <svg fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" width="48" height="48"><rect x="3" y="4" width="18" height="18" rx="3" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>
          </div>
          <div style={{ fontWeight: 600, fontSize: 16, color: t.text2 }}>Нет данных за {dd(dayStr)}</div>
        </div>
      )

      const maxExp = Math.max(...dayExps.map((e: any) => e.amount), 1)
      return (
        <div>
          {/* Hero cards */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
            <StatCard label="Доход" rawValue={dayShift.income} value={`${currency}${fv(dayShift.income)}`} color={t.green} t={t} />
            <StatCard label="Расход" rawValue={dayShift.total_expense} value={`${currency}${fv(dayShift.total_expense)}`} color={t.red} t={t} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8, marginBottom: 16 }}>
            <StatCard label="Вход" value={`${currency}${fv(dayShift.opening_balance)}`} rawValue={dayShift.opening_balance} color={t.blue} sm t={t} />
            <StatCard label="Доход" value={`${currency}${fv(dayShift.income)}`} rawValue={dayShift.income} color={t.green} sm t={t} />
            <StatCard label="Расход" value={`${currency}${fv(dayShift.total_expense)}`} rawValue={dayShift.total_expense} color={t.red} sm t={t} />
            <StatCard label="Касса" value={`${currency}${fv(dayShift.closing_balance)}`} rawValue={dayShift.closing_balance} color={t.blue} sm t={t} />
          </div>
          {dayExps.length > 0 && <>
            <div style={{ fontSize: 12, fontWeight: 600, color: t.text3, textTransform: 'uppercase', letterSpacing: 0.5, padding: '12px 4px 8px' }}>Расходы дня</div>
            <div style={{ background: t.surface, borderRadius: 16, overflow: 'hidden', marginBottom: 12, boxShadow: t.sh }}>
              {dayExps.map((e: any, i: number) => (
                <HBar key={e.id} name={e.category_name} val={e.amount} max={maxExp} color={COLORS[i % COLORS.length]} currency={currency} sub={e.note} t={t} />
              ))}
            </div>
          </>}
          {dayInk && <>
            <div style={{ fontSize: 12, fontWeight: 600, color: t.text3, textTransform: 'uppercase', letterSpacing: 0.5, padding: '12px 4px 8px' }}>Инкассация</div>
            <div style={{ background: t.surface, borderRadius: 16, overflow: 'hidden', marginBottom: 12, boxShadow: t.sh }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '0.5px', background: t.sep2 }}>
                {[{ l: 'Приход', v: dayInk.amount > 0 ? `${currency}${fv(dayInk.amount)}` : '—', c: t.green }, { l: 'Расход', v: dayInk.expense > 0 ? `${currency}${fv(dayInk.expense)}` : '—', c: t.red }, { l: 'Причина', v: dayInk.reason || '—', c: t.text3 }, { l: 'Итог', v: `${currency}${fv(dayInk.balance)}`, c: t.orange }].map(cell => (
                  <div key={cell.l} style={{ background: t.surface, padding: '12px 10px' }}>
                    <div style={{ fontSize: 9, color: t.text3, textTransform: 'uppercase', marginBottom: 5, fontWeight: 600 }}>{cell.l}</div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: cell.c }}>{cell.v}</div>
                  </div>
                ))}
              </div>
            </div>
          </>}
        </div>
      )
    }

    if (periodMode === 'week') {
      const ws = getWeekShifts()
      const wi = ws.reduce((s: number, sh: any) => s + sh.income, 0)
      const we = ws.reduce((s: number, sh: any) => s + sh.total_expense, 0)
      const wExps = expenses.filter((e: any) => ws.map((s: any) => s.id).includes(e.shift_id))
      const cats = getCatMap(wExps); const maxV = cats[0]?.[1] || 1
      const ip = pct(wi, prevIncome / 4); const ep = pct(we, prevExpense / 4)

      return (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
            <StatCard label="Доход за неделю" rawValue={wi} value={`${currency}${fv(wi)}`} color={t.green} pct={ip} t={t} />
            <StatCard label="Расходы" rawValue={we} value={`${currency}${fv(we)}`} color={t.red} pct={ep} t={t} />
          </div>
          {ws.length > 1 && <>
            <div style={{ fontSize: 12, fontWeight: 600, color: t.text3, textTransform: 'uppercase', letterSpacing: 0.5, padding: '12px 4px 8px' }}>Доходы и расходы</div>
            <div style={{ background: t.surface, borderRadius: 16, overflow: 'hidden', marginBottom: 12, boxShadow: t.sh }}>
              <div style={{ padding: '14px 14px 10px', color: t.text }}>
                <BarChartSVG labels={ws.map((s: any) => dd(s.date))} income={ws.map((s: any) => s.income || 0)} expense={ws.map((s: any) => s.total_expense || 0)} currency={currency} />
              </div>
            </div>
          </>}
          {cats.length > 0 && <>
            <div style={{ fontSize: 12, fontWeight: 600, color: t.text3, textTransform: 'uppercase', letterSpacing: 0.5, padding: '12px 4px 8px' }}>Структура расходов</div>
            <div style={{ background: t.surface, borderRadius: 16, overflow: 'hidden', marginBottom: 12, boxShadow: t.sh }}>
              {cats.map(([n, v], i) => <HBar key={n} name={n} val={v} max={maxV} color={COLORS[i % COLORS.length]} currency={currency} t={t} />)}
            </div>
          </>}
          <div style={{ fontSize: 12, fontWeight: 600, color: t.text3, textTransform: 'uppercase', letterSpacing: 0.5, padding: '12px 4px 8px' }}>По дням</div>
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
        </div>
      )
    }

    // Month
    const cats = getCatMap(expenses); const top5 = cats.slice(0, 5); const maxV = cats[0]?.[1] || 1
    const ip = pct(totalIncome, prevIncome); const ep = pct(totalExpense, prevExpense)
    const incomeArr = shifts.map((s: any) => s.income || 0)
    const daysInMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0).getDate()
    const daysPassed = currentDate.getMonth() === new Date().getMonth() && currentDate.getFullYear() === new Date().getFullYear() ? new Date().getDate() : daysInMonth

    return (
      <div>
        {/* Top stats */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
          <StatCard label="Доход" rawValue={totalIncome} value={`${currency}${fv(totalIncome)}`} color={t.green} pct={ip} sparkValues={incomeArr} t={t} />
          <StatCard label="Расходы" rawValue={totalExpense} value={`${currency}${fv(totalExpense)}`} color={t.red} pct={ep} t={t} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginBottom: 16 }}>
          <StatCard label="Смен" value={String(shifts.length)} sm t={t} />
          <StatCard label="Инкасс" rawValue={totalInkass} value={`${currency}${fv(totalInkass)}`} color={t.orange} sm t={t} />
          <StatCard label="Касса" rawValue={lastShift?.closing_balance || 0} value={`${currency}${fv(lastShift?.closing_balance || 0)}`} color={t.blue} sm t={t} />
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
                <span style={{ fontSize: 13, fontWeight: 700, color: t.text }}>Наличные · Безнал</span>
                <span style={{ fontSize: 12, color: t.text3 }}>{currency}{fv(total)} всего</span>
              </div>
              <div style={{ display: 'flex', height: 10, borderRadius: 5, overflow: 'hidden', gap: 2 }}>
                <div style={{ width: `${cashPct}%`, background: t.green, borderRadius: 5, transition: 'width .4s ease' }} />
                <div style={{ flex: 1, background: t.purple, borderRadius: 5 }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10 }}>
                <span style={{ fontSize: 12.5, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: t.green }} />
                  <span style={{ color: t.text2 }}>Нал</span>
                  <span style={{ fontWeight: 700, color: t.green }}>{currency}{fv(cash)}</span>
                  <span style={{ color: t.text3 }}>{cashPct}%</span>
                </span>
                <span style={{ fontSize: 12.5, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: t.purple }} />
                  <span style={{ color: t.text2 }}>Карта</span>
                  <span style={{ fontWeight: 700, color: t.purple }}>{currency}{fv(card)}</span>
                  <span style={{ color: t.text3 }}>{100 - cashPct}%</span>
                </span>
              </div>
            </div>
          )
        })()}



        {shifts.length > 1 && <>
          <div style={{ fontSize: 12, fontWeight: 600, color: t.text3, textTransform: 'uppercase', letterSpacing: 0.5, padding: '12px 4px 8px' }}>Доходы и расходы</div>
          <div style={{ background: t.surface, borderRadius: 16, overflow: 'hidden', marginBottom: 12, boxShadow: t.sh }}>
            <div style={{ padding: '14px 14px 8px', color: t.text }}>
              <BarChartSVG labels={shifts.map((s: any) => dd(s.date))} income={incomeArr} expense={shifts.map((s: any) => s.total_expense || 0)} currency={currency} />
            </div>
          </div>
        </>}

        {/* Donut */}
        {top5.length > 0 && <>
          <div style={{ fontSize: 12, fontWeight: 600, color: t.text3, textTransform: 'uppercase', letterSpacing: 0.5, padding: '12px 4px 8px' }}>Структура расходов</div>
          <div style={{ background: t.surface, borderRadius: 16, overflow: 'hidden', marginBottom: 12, boxShadow: t.sh, color: t.text }}>
            <DonutChartSVG data={top5.map(([, v]) => v)} colors={COLORS.slice(0, top5.length)} labels={top5.map(([n]) => n)} centerVal={`${currency}${Math.round(totalExpense)}`} centerLabel="расходы" />
          </div>

          <div style={{ fontSize: 12, fontWeight: 600, color: t.text3, textTransform: 'uppercase', letterSpacing: 0.5, padding: '12px 4px 8px' }}>Топ расходов</div>
          <div style={{ background: t.surface, borderRadius: 16, overflow: 'hidden', marginBottom: 12, boxShadow: t.sh }}>
            {top5.map(([n, v], i) => <HBar key={n} name={n} val={v} max={maxV} color={COLORS[i % COLORS.length]} currency={currency} t={t} />)}
          </div>
        </>}

        {cats.length > 0 && <>
          <div style={{ fontSize: 12, fontWeight: 600, color: t.text3, textTransform: 'uppercase', letterSpacing: 0.5, padding: '12px 4px 8px' }}>Все категории</div>
          <div style={{ background: t.surface, borderRadius: 16, overflow: 'hidden', marginBottom: 12, boxShadow: t.sh }}>
            {cats.map(([n, v], i) => (
              <div key={n} style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 16px', borderBottom: i < cats.length - 1 ? `0.5px solid ${t.sep2}` : 'none' }}>
                <span style={{ color: t.text }}>{n}</span>
                <span style={{ color: t.red, fontWeight: 600 }}>{currency}{fv(v)}</span>
              </div>
            ))}
          </div>
        </>}
      </div>
    )
  }

  const renderKassa = () => {
    const filled = shifts.filter((s: any) => s.income > 0 || s.total_expense > 0)
    const balArr = filled.map((s: any) => s.closing_balance || 0)

    if (kassaMode === 'kassa') {
      return (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
            <StatCard label="Остаток" rawValue={lastShift?.closing_balance || 0} value={`${currency}${fv(lastShift?.closing_balance || 0)}`} color={t.blue} sparkValues={balArr} t={t} />
            <StatCard label="Последний доход" rawValue={lastShift?.income || 0} value={`${currency}${fv(lastShift?.income || 0)}`} color={t.green} sub={lastShift ? dd(lastShift.date) : undefined} t={t} />
          </div>
          {filled.length > 1 && <>
            <div style={{ fontSize: 12, fontWeight: 600, color: t.text3, textTransform: 'uppercase', letterSpacing: 0.5, padding: '12px 4px 8px' }}>Баланс кассы</div>
            <div style={{ background: t.surface, borderRadius: 16, overflow: 'hidden', marginBottom: 12, boxShadow: t.sh }}>
              <div style={{ padding: '14px 14px 8px', color: t.text }}>
                <LineChartSVG labels={filled.map((s: any) => dd(s.date))} values={balArr} color={t.blue} currency={currency} />
              </div>
            </div>
            <div style={{ fontSize: 12, fontWeight: 600, color: t.text3, textTransform: 'uppercase', letterSpacing: 0.5, padding: '12px 4px 8px' }}>Доходы и расходы</div>
            <div style={{ background: t.surface, borderRadius: 16, overflow: 'hidden', marginBottom: 12, boxShadow: t.sh }}>
              <div style={{ padding: '14px 14px 8px', color: t.text }}>
                <BarChartSVG labels={filled.map((s: any) => dd(s.date))} income={filled.map((s: any) => s.income || 0)} expense={filled.map((s: any) => s.total_expense || 0)} currency={currency} />
              </div>
            </div>
          </>}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 4px 8px' }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: t.text3, textTransform: 'uppercase', letterSpacing: 0.5 }}>По дням</div>
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
                <span style={{ color: t.blue }}>{s.opening_balance > 0 ? `${currency}${fv(s.opening_balance)}` : '—'}</span>
                <span style={{ color: t.green, fontWeight: 600 }}>{s.income > 0 ? `${currency}${fv(s.income)}` : '—'}</span>
                <span style={{ color: t.red }}>{s.total_expense > 0 ? `${currency}${fv(s.total_expense)}` : '—'}</span>
                <span style={{ color: t.blue, fontWeight: 700 }}>{currency}{fv(s.closing_balance)}</span>
              </div>
            ))}
          </div>
        </div>
      )
    }

    const now = new Date(); const dIM = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
    const shiftsWithInk = shifts.filter((s: any) => (s.inkassation || 0) > 0)
    const inkBal = totalInkass
    const totalSal = employees.reduce((s: number, e: any) => s + e.salary, 0)
    const salToday = Math.round(totalSal / dIM * now.getDate()); const diff = inkBal - salToday

    return (
      <div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
          <StatCard label="Итого инкасс." rawValue={inkBal} value={`${currency}${fv(inkBal)}`} color={t.orange} t={t} />
          <StatCard label="ЗП на сегодня" rawValue={salToday} value={`${currency}${fv(salToday)}`} color={diff >= 0 ? t.green : t.red} sub={`${diff >= 0 ? 'Опережаем' : 'Отстаём'} ${currency}${fv(Math.abs(diff))}`} t={t} />
        </div>
        {shiftsWithInk.length > 1 && <>
          <div style={{ fontSize: 12, fontWeight: 600, color: t.text3, textTransform: 'uppercase', letterSpacing: 0.5, padding: '12px 4px 8px' }}>Динамика</div>
          <div style={{ background: t.surface, borderRadius: 16, overflow: 'hidden', marginBottom: 12, boxShadow: t.sh }}>
            <div style={{ padding: '14px 14px 8px', color: t.text }}>
              <LineChartSVG labels={shiftsWithInk.map((s: any) => dd(s.date))} values={shiftsWithInk.map((s: any) => s.inkassation || 0)} color={t.orange} currency={currency} />
            </div>
          </div>
        </>}
        <div style={{ fontSize: 12, fontWeight: 600, color: t.text3, textTransform: 'uppercase', letterSpacing: 0.5, padding: '12px 4px 8px' }}>История</div>
        <div style={{ background: t.surface, borderRadius: 16, overflow: 'hidden', boxShadow: t.sh }}>
          {shiftsWithInk.length === 0
            ? <div style={{ padding: '32px', textAlign: 'center', color: t.text4 }}>Нет инкассаций</div>
            : shiftsWithInk.map((s: any, i: number) => (
              <div key={s.id} style={{ display: 'grid', gridTemplateColumns: '44px 1fr 1fr', padding: '12px 14px', gap: 4, borderBottom: i < shiftsWithInk.length - 1 ? `0.5px solid ${t.sep2}` : 'none', fontSize: 13 }}>
                <span style={{ color: t.text3 }}>{dd(s.date)}</span>
                <span style={{ color: t.text }}>{s.date}</span>
                <span style={{ color: t.orange, fontWeight: 600 }}>{currency}{fv(s.inkassation)}</span>
              </div>
            ))
          }
        </div>
      </div>
    )
  }

  const renderSalary = () => {
    const monthKey = fmtDate(currentDate).slice(0, 7)
    // Правка суммы на карту за выбранный месяц (каждый месяц своя). Без unique-constraint: update by id или insert.
    const saveCard = async (emp: any, value: string) => {
      const amt = Math.max(0, parseFloat(value) || 0)
      if (amt === cardOf(emp)) return
      const existing = cardAmounts.find((c: any) => c.employee_id === emp.id)
      if (existing) {
        await db.from('monthly_card_amounts').update({ card_amount: amt }).eq('id', existing.id)
        setCardAmounts((prev: any[]) => prev.map(c => c.id === existing.id ? { ...c, card_amount: amt } : c))
      } else {
        const { data } = await db.from('monthly_card_amounts').insert({ employee_id: emp.id, month: monthKey, card_amount: amt }).select().single()
        if (data) setCardAmounts((prev: any[]) => [...prev, data])
      }
    }
    const totFOT = employees.reduce((s: number, e: any) => s + e.salary, 0)
    const totCard = employees.reduce((s: number, e: any) => s + cardOf(e), 0)
    const totCash = employees.reduce((s: number, emp: any) => {
      const abs = absences.filter((a: any) => a.employee_id === emp.id).length
      return s + (emp.salary - abs * emp.deduct_per_absence - cardOf(emp))
    }, 0)

    return (
      <div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginBottom: 16 }}>
          <StatCard label="ФОТ" rawValue={totFOT} value={`${currency}${fv(totFOT)}`} color={t.blue} sm t={t} />
          <StatCard label="Наличные" rawValue={totCash} value={`${currency}${fv(totCash)}`} color={t.orange} sm t={t} />
          <StatCard label="Карта" rawValue={totCard} value={`${currency}${fv(totCard)}`} color={t.purple} sm t={t} />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 4px 8px' }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: t.text3, textTransform: 'uppercase', letterSpacing: 0.5 }}>Сотрудники</div>
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
            const cash = emp.salary - deduct - card

            const open = expSalary === emp.id

            return (
              <div key={emp.id} style={{ borderBottom: i < employees.length - 1 ? `0.5px solid ${t.sep2}` : 'none' }}>
                {/* Шапка — тап раскрывает/сворачивает */}
                <button onClick={() => setExpSalary(open ? null : emp.id)} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', background: 'transparent', border: 'none', fontFamily: 'inherit', cursor: 'pointer', textAlign: 'left' }}>
                  <div>
                    <div style={{ fontSize: 15, color: t.text, fontWeight: 600 }}>{emp.name}</div>
                    <div style={{ fontSize: 11, color: t.text3, marginTop: 2 }}>
                      {abs > 0 ? `${abs} пропусков · −${currency}${fv(deduct)}` : 'оклад полностью'}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ fontSize: 18, fontWeight: 800, color: t.blue }}>{currency}{fv(cash + card)}</div>
                    <svg width="9" height="15" fill="none" stroke={t.text3} strokeWidth="2.2" strokeLinecap="round" viewBox="0 0 10 18" style={{ transform: open ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform .25s ease', flexShrink: 0 }}><path d="M2 1l7 8-7 8" /></svg>
                  </div>
                </button>
                {/* Тело — плавно выезжает (grid-rows 0fr↔1fr, без замера высоты) */}
                <div style={{ display: 'grid', gridTemplateRows: open ? '1fr' : '0fr', transition: 'grid-template-rows .28s cubic-bezier(.32,.72,0,1)' }}>
                  <div style={{ overflow: 'hidden' }}>
                    <div style={{ padding: '0 16px 14px' }}>
                      <div style={{ fontSize: 12, color: t.text3, marginBottom: 8 }}>ЗП: {currency}{fv(emp.salary)}{deduct > 0 ? ` · вычет −${currency}${fv(deduct)}` : ''}</div>
                      {abs > 0 && <div style={{ marginBottom: 8, height: 3, background: t.fill2, borderRadius: 2, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${Math.min(abs / 22 * 100, 100).toFixed(1)}%`, background: t.red, borderRadius: 2 }} />
                      </div>}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span style={{ fontSize: 13, color: t.orange, fontWeight: 600 }}>Нал {currency}{fv(cash)}</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontSize: 12, color: t.text3 }}>На карту {currency}</span>
                          <input
                            key={`card-${emp.id}-${monthKey}`} type="number" inputMode="decimal"
                            defaultValue={card || ''} placeholder="0"
                            onBlur={e => saveCard(emp, e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                            style={{ width: 84, textAlign: 'right', padding: '7px 10px', borderRadius: 9, border: `1px solid ${t.sep2}`, background: t.fill, color: t.purple, fontWeight: 700, fontSize: 14, fontFamily: 'inherit', outline: 'none' }}
                          />
                        </div>
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

  if (!restaurantId) return <AuthGate appId="analytics" appName="Mise Analytics" onAuth={setRestaurantId} />

  if (!t.mounted || loading) return <AppLoading app="analytics" bg={t.bg} fill={t.fill} accent={t.blue} />

  const TABS = [
    { id: 'period', label: 'Период', icon: (a: boolean) => <svg fill="none" stroke="currentColor" strokeWidth={a ? 2.2 : 1.8} viewBox="0 0 24 24" width="26" height="26"><rect x="3" y="4" width="18" height="18" rx="3" /><path d="M16 2v4M8 2v4M3 10h18" /></svg> },
    { id: 'kassa', label: 'Касса', icon: (a: boolean) => <svg fill="none" stroke="currentColor" strokeWidth={a ? 2.2 : 1.8} viewBox="0 0 24 24" width="26" height="26"><rect x="2" y="7" width="20" height="14" rx="2" /><path d="M16 3H8L2 7h20z" /></svg> },
    { id: 'forecast', label: 'Прогноз', icon: (a: boolean) => <svg fill="none" stroke="currentColor" strokeWidth={a ? 2.2 : 1.8} viewBox="0 0 24 24" width="26" height="26"><path d="M3 17l6-6 4 4 7-7" strokeLinecap="round" strokeLinejoin="round" /><path d="M14 8h6v6" strokeLinecap="round" strokeLinejoin="round" /></svg> },
    { id: 'salary', label: 'Зарплаты', icon: (a: boolean) => <svg fill="none" stroke="currentColor" strokeWidth={a ? 2.2 : 1.8} viewBox="0 0 24 24" width="26" height="26"><circle cx="12" cy="8" r="4" /><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" /></svg> },
    { id: 'hookah', label: 'Кальян', icon: (a: boolean) => <svg fill="none" stroke="currentColor" strokeWidth={a ? 2.2 : 1.8} viewBox="0 0 24 24" width="26" height="26"><path d="M8 8c0-2.5 3-4 3-6" strokeLinecap="round"/><path d="M12 8c0-2.5 3-4 3-6" strokeLinecap="round"/><path d="M16 8c0-2.5 3-4 3-6" strokeLinecap="round"/><path d="M5 14h14" strokeLinecap="round"/><path d="M5 17c1 1.5 2 2 3.5 2s2.5-1 4-1 2.5 1 4 1 2.5-.5 3.5-2" strokeLinecap="round"/></svg> },
  ] as const

  return (
    <div style={{ height: '100vh', overflow: 'hidden', background: t.bg, fontFamily: "-apple-system,BlinkMacSystemFont,'SF Pro Text',sans-serif", WebkitFontSmoothing: 'antialiased', color: t.text }}>
      <style>{`
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes fadeUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
        @keyframes pulse{0%,100%{transform:scale(1);opacity:1}50%{transform:scale(1.2);opacity:.6}}
        @keyframes orbit{from{transform:rotate(0deg) translateX(7px) rotate(0deg)}to{transform:rotate(360deg) translateX(7px) rotate(-360deg)}}
        * { box-sizing: border-box }
        ::-webkit-scrollbar { display: none }
      `}</style>

      {/* HEADER */}
      <div style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 300, height: 56, background: t.hbg, backdropFilter: 'saturate(200%) blur(24px)', WebkitBackdropFilter: 'saturate(200%) blur(24px)', borderBottom: `0.5px solid ${t.sep2}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
          <span style={{ fontWeight: 800, fontSize: 18, color: t.green, letterSpacing: -0.8 }}>mise</span>
          <span style={{ fontWeight: 400, fontSize: 17, color: t.text, letterSpacing: -0.3 }}>Analytics</span>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button onClick={t.toggle} style={{ width: 36, height: 36, borderRadius: '50%', background: t.fill, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: t.text }}>
            {t.dark
              ? <svg width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="5" /><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" /></svg>
              : <svg width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" /></svg>
            }
          </button>
          <button onClick={() => setShowMonthPicker(true)} style={{ display: 'flex', alignItems: 'center', gap: 5, background: `${t.green}18`, borderRadius: 20, padding: '7px 14px', cursor: 'pointer', fontSize: 14, fontWeight: 600, color: t.green, border: 'none', fontFamily: 'inherit' }}>
            {MRU[currentDate.getMonth()].slice(0, 3)} {currentDate.getFullYear()}
            <svg width="10" height="6" fill="none" stroke={t.green} strokeWidth="2.5" viewBox="0 0 10 6"><path d="M1 1l4 4 4-4" /></svg>
          </button>
          <button onClick={() => isPro ? setShowAI(true) : alert('AI-аналитика доступна в тарифе Pro')} style={{ width: 36, height: 36, borderRadius: '50%', background: `${t.green}18`, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' as const, opacity: isPro ? 1 : 0.55 }}>
            <div style={{ position: 'relative' as const, width: 20, height: 20 }}>
              <div style={{ position: 'absolute' as const, inset: 0, borderRadius: '50%', border: `1.5px solid ${t.green}66`, animation: 'pulse 2s ease-in-out infinite' }} />
              <div style={{ position: 'absolute' as const, inset: 3, borderRadius: '50%', background: t.green, animation: 'pulse 2s ease-in-out infinite .3s' }} />
              <div style={{ position: 'absolute' as const, width: 4, height: 4, borderRadius: '50%', background: '#fff', top: '50%', left: '50%', marginTop: -2, marginLeft: -2, animation: 'orbit 1.5s linear infinite' }} />
            </div>
          </button>
        </div>
      </div>

      {/* CONTENT */}
      <div style={{ position: 'fixed', top: 56, left: 0, right: 0, bottom: 82, overflowY: 'auto', background: t.bg }}>
        <div style={{ padding: '16px 16px 28px', maxWidth: 640, margin: '0 auto', animation: 'fadeUp .22s ease' }}>

          {tab === 'period' && (
            <>
              <div style={{ display: 'flex', background: t.fill, borderRadius: 12, padding: 3, marginBottom: 16, gap: 2 }}>
                {(['day', 'week', 'month'] as const).map(m => (
                  <button key={m} onClick={() => setPeriodMode(m)} style={{ flex: 1, padding: '8px 0', borderRadius: 10, border: 'none', fontFamily: 'inherit', fontSize: 13, fontWeight: periodMode === m ? 700 : 500, cursor: 'pointer', background: periodMode === m ? t.surface : 'transparent', color: periodMode === m ? t.green : t.text3, boxShadow: periodMode === m ? t.sh2 : 'none', transition: 'all .18s' }}>
                    {m === 'day' ? 'День' : m === 'week' ? 'Неделя' : 'Месяц'}
                  </button>
                ))}
              </div>
              {periodMode !== 'month' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, background: t.surface, borderRadius: 14, padding: '12px 16px', marginBottom: 16, boxShadow: t.sh }}>
                  <button onClick={() => { const d = new Date(currentDate); d.setDate(d.getDate() - (periodMode === 'week' ? 7 : 1)); setCurrentDate(d) }} style={{ width: 40, height: 40, borderRadius: '50%', background: t.fill, border: 'none', color: t.text, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <svg width="10" height="18" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" viewBox="0 0 10 18"><path d="M8 1L1 9l7 8" /></svg>
                  </button>
                  <div style={{ flex: 1, textAlign: 'center' as const }}>
                    <div style={{ fontSize: 16, fontWeight: 700, color: t.text }}>{periodMode === 'day' ? `${currentDate.getDate()} ${MRU[currentDate.getMonth()].slice(0, 3)}` : `Неделя ${currentDate.getDate()} ${MRU[currentDate.getMonth()].slice(0, 3)}`}</div>
                    <div style={{ fontSize: 12, color: t.green, marginTop: 1, fontWeight: 500 }}>{periodMode === 'day' ? DOW[currentDate.getDay()] : ''}</div>
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
                    {m === 'kassa' ? 'Касса' : 'Инкасс'}
                  </button>
                ))}
              </div>
              {renderKassa()}
            </>
          )}

          {tab === 'forecast' && (() => {
            const now = new Date()
            const dim = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0).getDate()
            const isCur = currentDate.getMonth() === now.getMonth() && currentDate.getFullYear() === now.getFullYear()
            const dpass = isCur ? now.getDate() : dim
            const mtd = totalIncome
            const dailyAvg = dpass > 0 ? mtd / dpass : 0
            const projected = Math.round(dailyAvg * dim)
            const projPct = pct(projected, prevIncome)
            const goalPct = revGoal > 0 ? Math.min(100, mtd / revGoal * 100) : 0
            const daysLeft = Math.max(0, dim - dpass)
            const needPerDay = revGoal > mtd && daysLeft > 0 ? (revGoal - mtd) / daysLeft : 0
            const onTrack = revGoal > 0 && projected >= revGoal

            const saveGoal = async (value: string) => {
              const amt = Math.max(0, parseFloat(value) || 0)
              if (amt === revGoal) return
              setRevGoal(amt)
              await db.from('restaurant_settings').update({ monthly_revenue_goal: amt }).eq('restaurant_id', restaurantId)
            }

            return (
              <div>
                {/* Прогноз на месяц */}
                <div style={{ background: t.surface, borderRadius: 18, padding: '20px 18px', boxShadow: t.sh, marginBottom: 12 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: t.text3, textTransform: 'uppercase', letterSpacing: 0.5 }}>{isCur ? 'Прогноз на месяц' : 'Выручка за месяц'}</div>
                  <div style={{ fontSize: 34, fontWeight: 800, color: t.text, letterSpacing: -1, marginTop: 6 }}>{currency}{fv(isCur ? projected : mtd)}</div>
                  <div style={{ fontSize: 13, color: t.text3, marginTop: 4 }}>
                    {isCur ? `при текущем темпе ${currency}${fv(Math.round(dailyAvg))}/день` : 'итог месяца'}
                    {projPct !== null && <span style={{ color: projPct >= 0 ? t.green : t.red, fontWeight: 600 }}> · {projPct >= 0 ? '+' : ''}{projPct.toFixed(0)}% к прошлому</span>}
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 12 }}>
                  <StatCard label="С начала месяца" rawValue={mtd} value={`${currency}${fv(mtd)}`} color={t.blue} sm t={t} />
                  <StatCard label="В среднем/день" rawValue={dailyAvg} value={`${currency}${fv(Math.round(dailyAvg))}`} color={t.orange} sm t={t} />
                  <StatCard label="Прошлый месяц" rawValue={prevIncome} value={`${currency}${fv(prevIncome)}`} color={t.purple} sm t={t} />
                </div>

                {/* Цель на месяц */}
                <div style={{ fontSize: 12, fontWeight: 600, color: t.text3, textTransform: 'uppercase', letterSpacing: 0.5, padding: '8px 4px 8px' }}>Цель на месяц</div>
                <div style={{ background: t.surface, borderRadius: 16, padding: '16px', boxShadow: t.sh }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: revGoal > 0 ? 12 : 0 }}>
                    <span style={{ fontSize: 14, color: t.text, fontWeight: 500 }}>Цель выручки</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 14, color: t.text3 }}>{currency}</span>
                      <input
                        key={`goal-${fmtDate(currentDate).slice(0, 7)}`} type="number" inputMode="decimal"
                        defaultValue={revGoal || ''} placeholder="0"
                        onBlur={e => saveGoal(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                        style={{ width: 110, textAlign: 'right', padding: '7px 10px', borderRadius: 10, border: `1px solid ${t.sep2}`, background: t.fill, color: t.text, fontWeight: 700, fontSize: 15, fontFamily: 'inherit', outline: 'none' }}
                      />
                    </div>
                  </div>
                  {revGoal > 0 && (
                    <>
                      <div style={{ height: 8, borderRadius: 4, background: t.fill, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${goalPct}%`, borderRadius: 4, background: onTrack ? t.green : t.orange, transition: 'width 0.8s cubic-bezier(.16,1,.3,1)' }} />
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: 12 }}>
                        <span style={{ color: t.text3 }}>{goalPct.toFixed(0)}% · {currency}{fv(mtd)} из {currency}{fv(revGoal)}</span>
                        {isCur && daysLeft > 0
                          ? <span style={{ color: onTrack ? t.green : t.orange, fontWeight: 600 }}>{onTrack ? 'в графике' : `нужно ${currency}${fv(Math.round(needPerDay))}/день`}</span>
                          : <span style={{ color: mtd >= revGoal ? t.green : t.red, fontWeight: 600 }}>{mtd >= revGoal ? 'цель достигнута' : `не хватило ${currency}${fv(revGoal - mtd)}`}</span>}
                      </div>
                    </>
                  )}
                </div>
              </div>
            )
          })()}

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
            const fmtKg = (g: number) => g >= 1000 ? `${(g / 1000).toLocaleString('de-DE', { maximumFractionDigits: 1 })} кг` : `${Math.round(g)} г`
            // По дням и по вкусам
            const byDay = new Map<string, { total: number; paid: number }>()
            const byFlavor = new Map<string, number>()
            hookahRows.forEach((r: any) => {
              const d = byDay.get(r.date) || { total: 0, paid: 0 }
              d.total += r.quantity || 0
              if (!r.is_free) d.paid += r.quantity || 0
              byDay.set(r.date, d)
              const key = `${r.brand || ''} ${r.flavor || ''}`.trim() || '—'
              byFlavor.set(key, (byFlavor.get(key) || 0) + (r.quantity || 0))
            })
            const flavors = [...byFlavor.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
            const maxFlavor = flavors[0]?.[1] || 1

            return (
              <div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
                  <StatCard label="Продано за месяц" rawValue={qtyMonth} value={String(qtyMonth)} color={t.orange} t={t} />
                  <StatCard label="Выручка кальяна" rawValue={revMonth} value={`${currency}${fv(revMonth)}`} color={t.green} t={t} />
                  <StatCard label="Бесплатные" rawValue={qtyFree} value={`${qtyFree} · ${fmtKg(qtyFree * hk.portion)}`} color={t.purple} sm t={t} />
                  <StatCard label="Табака израсходовано" rawValue={usedMonthG} value={fmtKg(usedMonthG)} color={t.blue} sm t={t} />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 10, marginBottom: 12 }}>
                  <StatCard label="На складе" rawValue={hk.stockG} value={fmtKg(hk.stockG)} color={t.text2 as any} sm t={t} />
                </div>
                <div style={{ background: t.surface, borderRadius: 16, padding: '14px 16px', boxShadow: t.sh, marginBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: t.text }}>В заведении</div>
                    <div style={{ fontSize: 12, color: t.text3, marginTop: 2 }}>выдано в зал − продано × {hk.portion} г</div>
                  </div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: t.orange }}>{fmtKg(venueG)}</div>
                </div>

                {hookahRows.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '40px 20px', color: t.text3 }}>
                    <div style={{ fontWeight: 600, fontSize: 16, color: t.text2 }}>Смен пока нет</div>
                    <div style={{ fontSize: 13, marginTop: 4 }}>Кальянщик отмечает кальяны в Mise Stash → Смена</div>
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
                          <div style={{ fontSize: 12, fontWeight: 600, color: t.text3, textTransform: 'uppercase', letterSpacing: 0.5, padding: '8px 4px 8px' }}>По видам</div>
                          <div style={{ background: t.surface, borderRadius: 16, overflow: 'hidden', boxShadow: t.sh, marginBottom: 12 }}>
                            {list.map(([id, n], i) => (
                              <div key={id} style={{ display: 'flex', justifyContent: 'space-between', padding: '11px 16px', borderBottom: i < list.length - 1 ? `0.5px solid ${t.sep2}` : 'none' }}>
                                <span style={{ fontSize: 14, color: t.text, fontWeight: 500 }}>{hk.types.find((tp: any) => tp.id === id)?.name || '—'}</span>
                                <span style={{ fontSize: 14 }}>
                                  <span style={{ fontWeight: 700, color: t.orange }}>{n.paid}</span>
                                  {n.free > 0 && <span style={{ color: t.purple }}> +{n.free} бесп.</span>}
                                </span>
                              </div>
                            ))}
                          </div>
                        </>
                      )
                    })()}

                    <div style={{ fontSize: 12, fontWeight: 600, color: t.text3, textTransform: 'uppercase', letterSpacing: 0.5, padding: '8px 4px 8px' }}>Топ вкусов</div>
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
                    <div style={{ fontSize: 12, fontWeight: 600, color: t.text3, textTransform: 'uppercase', letterSpacing: 0.5, padding: '4px 4px 8px' }}>По дням</div>
                    <div style={{ background: t.surface, borderRadius: 16, overflow: 'hidden', boxShadow: t.sh }}>
                      {[...byDay.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([d, n], i, arr) => (
                        <div key={d} style={{ display: 'flex', justifyContent: 'space-between', padding: '11px 16px', borderBottom: i < arr.length - 1 ? `0.5px solid ${t.sep2}` : 'none' }}>
                          <span style={{ fontSize: 14, color: t.text }}>{dd(d)}</span>
                          <span style={{ fontSize: 14 }}>
                            <span style={{ fontWeight: 700, color: t.orange }}>{n.paid}</span>
                            {n.total > n.paid && <span style={{ color: t.purple }}> +{n.total - n.paid} бесп.</span>}
                            <span style={{ color: t.text3 }}> · {currency}{fv(n.paid * hk.price)}</span>
                          </span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )
          })()}
        </div>
      </div>

      {/* BOTTOM NAV */}
      <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 300, height: 82, background: t.nbg, backdropFilter: 'saturate(200%) blur(24px)', WebkitBackdropFilter: 'saturate(200%) blur(24px)', borderTop: `0.5px solid ${t.sep2}`, display: 'flex', alignItems: 'flex-start', paddingTop: 10, paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
        {TABS.map(tb => (
          <button key={tb.id} onClick={() => setTab(tb.id as any)} style={{ flex: 1, display: 'flex', flexDirection: 'column' as const, alignItems: 'center', gap: 3, cursor: 'pointer', color: tab === tb.id ? t.green : t.text3, border: 'none', background: 'none', fontFamily: 'inherit', padding: 0, fontSize: 10, fontWeight: tab === tb.id ? 700 : 500, transition: 'color .18s' }}>
            <span style={{ transform: tab === tb.id ? 'scale(1.08)' : 'scale(1)', transition: 'transform .18s ease', display: 'flex' }}>{tb.icon(tab === tb.id)}</span>
            {tb.label}
          </button>
        ))}
      </div>

      {/* MONTH PICKER */}
      {showMonthPicker && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 500, background: 'rgba(0,0,0,.45)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }} onClick={() => setShowMonthPicker(false)}>
          <div style={{ background: t.surface, borderRadius: '24px 24px 0 0', width: '100%', maxWidth: 480, paddingBottom: 32 }} onClick={(e: any) => e.stopPropagation()}>
            <div style={{ width: 36, height: 4, background: t.fill, borderRadius: 2, margin: '12px auto 0' }} />
            <div style={{ fontSize: 17, fontWeight: 700, textAlign: 'center' as const, padding: '14px 20px 0', color: t.text }}>Выбор месяца</div>
            {Array.from({ length: 12 }, (_, i) => {
              const d = new Date(); d.setMonth(d.getMonth() - i)
              const active = d.getMonth() === currentDate.getMonth() && d.getFullYear() === currentDate.getFullYear()
              return (
                <div key={i} onClick={() => { setCurrentDate(d); setShowMonthPicker(false); loadAll(restaurantId, d) }} style={{ padding: '15px 20px', fontSize: 16, cursor: 'pointer', borderBottom: `0.5px solid ${t.sep2}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: active ? t.green : t.text, fontWeight: active ? 700 : 400 }}>
                  {MRU[d.getMonth()]} {d.getFullYear()}
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
              <button onClick={() => { setChatMsgs([]); localStorage.removeItem('mise_chat') }} style={{ background: 'none', border: 'none', color: t.text4, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>Очистить</button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto' as const, padding: '12px 16px', display: 'flex', flexDirection: 'column' as const, gap: 10 }}>
              {chatMsgs.length === 0 && (
                <div>
                  <div style={{ textAlign: 'center' as const, color: t.text4, padding: '16px 0 20px', fontSize: 13 }}>Спросите о вашем бизнесе</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    {SUGGESTED.map(q => (
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
              {chatLoading && <div style={{ display: 'flex' }}><div style={{ padding: '10px 14px', borderRadius: '16px 16px 16px 4px', background: t.fill, color: t.text3, fontSize: 14 }}>Думаю...</div></div>}
              <div ref={chatEndRef} />
            </div>
            <div style={{ padding: '10px 16px 20px', display: 'flex', gap: 8 }}>
              <input value={chatInput} onChange={e => setChatInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && sendAI()} placeholder="Спросите о бизнесе..." style={{ flex: 1, padding: '11px 14px', borderRadius: 12, border: `1px solid ${t.sep2}`, fontSize: 14, color: t.text, background: t.surface, fontFamily: 'inherit', outline: 'none' }} />
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
