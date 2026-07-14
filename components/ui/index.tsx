'use client'
// Дашборд v2 — UI-kit на семантических токенах (app/globals.css, блок «Дашборд v2»).
// Правила: тап-таргеты ≥44px (small-варианты ≥36 — desktop-плотность), focus-visible
// кольца и hover/press-состояния — классы ui-* в globals.css, motion через var(--dur)/var(--ease).
// Компоненты i18n-агностичны: подписи переводит вызывающий код.
import React from 'react'

export type Tone = 'accent' | 'ok' | 'warn' | 'danger' | 'violet' | 'pink' | 'neutral'

const TONE: Record<Tone, { color: string; soft: string }> = {
  accent:  { color: 'var(--accent)',  soft: 'var(--accent-soft)' },
  ok:      { color: 'var(--ok)',      soft: 'var(--ok-soft)' },
  warn:    { color: 'var(--warn)',    soft: 'var(--warn-soft)' },
  danger:  { color: 'var(--danger)',  soft: 'var(--danger-soft)' },
  violet:  { color: 'var(--violet)',  soft: 'var(--violet-soft)' },
  pink:    { color: 'var(--pink)',    soft: 'var(--pink-soft)' },
  neutral: { color: 'var(--tx2)',     soft: 'var(--fill)' },
}

// ── Card ──────────────────────────────────────────────────────────────────────
export function Card({ children, style, onClick, pad = 20 }: {
  children: React.ReactNode; style?: React.CSSProperties; onClick?: () => void; pad?: number
}) {
  return (
    <div
      onClick={onClick}
      className={onClick ? 'ui-card-tap' : undefined}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() } } : undefined}
      style={{ background: 'var(--surface)', borderRadius: 'var(--radius)', padding: pad, boxShadow: 'var(--sh-card)', border: 'var(--hairline)', ...style }}
    >
      {children}
    </div>
  )
}

// ── Btn ───────────────────────────────────────────────────────────────────────
export function Btn({ children, onClick, variant = 'primary', small = false, disabled = false, full = false, type = 'button', style }: {
  children: React.ReactNode; onClick?: () => void
  variant?: 'primary' | 'danger' | 'ghost' | 'gray' | 'ok'
  small?: boolean; disabled?: boolean; full?: boolean; type?: 'button' | 'submit'; style?: React.CSSProperties
}) {
  const v: Record<string, React.CSSProperties> = {
    primary: { background: 'var(--accent)', color: '#fff', border: 'none' },
    ok:      { background: 'var(--ok)', color: '#fff', border: 'none' },
    danger:  { background: 'var(--danger-soft)', color: 'var(--danger)', border: 'none' },
    ghost:   { background: 'transparent', color: 'var(--accent)', border: '1px solid var(--accent-soft)' },
    gray:    { background: 'var(--fill)', color: 'var(--tx)', border: 'none' },
  }
  return (
    <button type={type} onClick={onClick} disabled={disabled} className="ui-press ui-btn" style={{
      ...v[variant],
      minHeight: small ? 36 : 44, padding: small ? '6px 14px' : '10px 20px',
      borderRadius: 980, fontFamily: 'inherit',
      fontSize: small ? '.8rem' : '.9rem', fontWeight: 600,
      cursor: 'pointer', width: full ? '100%' : undefined,
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
      ...style,
    }}>
      {children}
    </button>
  )
}

// ── Field ─────────────────────────────────────────────────────────────────────
export const inputStyle: React.CSSProperties = {
  width: '100%', minHeight: 44, padding: '10px 14px', borderRadius: 'var(--radius-sm)',
  border: '1px solid rgba(var(--seprgb),.24)', fontSize: '16px',
  fontFamily: 'inherit', boxSizing: 'border-box',
  color: 'var(--tx)', background: 'var(--surface)',
}

export function Field({ label, value, onChange, placeholder, type = 'text', select, options, helper, error, disabled, autoFocus, min, max, step }: {
  label?: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string
  select?: boolean; options?: { value: string; label: string }[]
  helper?: string; error?: string; disabled?: boolean; autoFocus?: boolean
  min?: number | string; max?: number | string; step?: number | string
}) {
  const id = React.useId()
  return (
    <div style={{ marginBottom: 12 }}>
      {label && (
        <label htmlFor={id} style={{ display: 'block', fontSize: '.72rem', fontWeight: 600, color: 'var(--tx2)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '.04em' }}>
          {label}
        </label>
      )}
      {select ? (
        <select id={id} value={value} disabled={disabled} onChange={e => onChange(e.target.value)}
          className="ui-input" aria-invalid={error ? true : undefined} style={{ ...inputStyle, opacity: disabled ? .5 : 1 }}>
          {(options || []).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      ) : (
        <input id={id} type={type} value={value} disabled={disabled} autoFocus={autoFocus}
          min={min} max={max} step={step}
          onChange={e => onChange(e.target.value)} placeholder={placeholder}
          className="ui-input" aria-invalid={error ? true : undefined} style={{ ...inputStyle, opacity: disabled ? .5 : 1 }} />
      )}
      {error ? (
        <div role="alert" style={{ fontSize: '.76rem', color: 'var(--danger)', marginTop: 5 }}>{error}</div>
      ) : helper ? (
        <div style={{ fontSize: '.76rem', color: 'var(--tx3)', marginTop: 5 }}>{helper}</div>
      ) : null}
    </div>
  )
}

// ── Toggle (iOS switch) ───────────────────────────────────────────────────────
export function Toggle({ value, onChange, tone = 'ok', disabled, label }: {
  value: boolean; onChange: (v: boolean) => void; tone?: Tone; disabled?: boolean; label?: string
}) {
  return (
    <button
      type="button" role="switch" aria-checked={value} aria-label={label} disabled={disabled}
      onClick={() => onChange(!value)}
      className="ui-press"
      style={{
        width: 51, height: 31, borderRadius: 16, border: 'none', padding: 0, flexShrink: 0,
        background: value ? TONE[tone].color : 'rgba(120,120,128,.32)',
        cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? .45 : 1,
        position: 'relative',
      }}
    >
      <span style={{
        position: 'absolute', top: 2, left: value ? 22 : 2, width: 27, height: 27, borderRadius: '50%',
        background: '#fff', boxShadow: '0 2px 6px rgba(0,0,0,.25)',
        transition: 'left var(--dur) var(--ease)',
      }} />
    </button>
  )
}

// ── Segmented ─────────────────────────────────────────────────────────────────
export function Segmented({ options, value, onChange, small }: {
  options: { value: string; label: string }[]; value: string; onChange: (v: string) => void; small?: boolean
}) {
  return (
    <div role="radiogroup" style={{ display: 'flex', background: 'var(--fill)', borderRadius: 'var(--radius-sm)', padding: 3, gap: 2 }}>
      {options.map(o => {
        const on = value === o.value
        return (
          <button key={o.value} type="button" role="radio" aria-checked={on} onClick={() => onChange(o.value)}
            className="ui-press"
            style={{
              flex: 1, minHeight: small ? 32 : 38, padding: '0 12px', borderRadius: 8, border: 'none',
              fontFamily: 'inherit', fontSize: small ? '.8rem' : '.86rem', fontWeight: on ? 600 : 500,
              cursor: 'pointer',
              background: on ? 'var(--tabon)' : 'transparent',
              color: on ? 'var(--tx)' : 'var(--tx2)',
              boxShadow: on ? 'var(--sh-card)' : 'none',
            }}>
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

// ── Badge ─────────────────────────────────────────────────────────────────────
export function Badge({ children, tone = 'neutral', style }: {
  children: React.ReactNode; tone?: Tone; style?: React.CSSProperties
}) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      fontSize: '.72rem', fontWeight: 700, color: TONE[tone].color, background: TONE[tone].soft,
      padding: '3px 9px', borderRadius: 'var(--radius-xs)', whiteSpace: 'nowrap', ...style,
    }}>
      {children}
    </span>
  )
}

// ── Sparkline ─────────────────────────────────────────────────────────────────
// Glance-tile trend, не полноценный график: история — приглушённым тоном (--tx3),
// последний отрезок — акцентным (tone тайла). Ховер — тонкий crosshair + значение.
// https://…/dataviz: «Stat tile trend: 12-point sparkline in the de-emphasis hue, current period in the accent».
export function Sparkline({ values, tone = 'accent', height = 32, formatValue }: {
  values: number[]; tone?: Tone; height?: number; formatValue?: (v: number) => string
}) {
  const [hover, setHover] = React.useState<number | null>(null)
  const ref = React.useRef<SVGSVGElement>(null)
  if (values.length < 2) return null

  const W = 100, H = height, padY = 3
  const min = Math.min(...values), max = Math.max(...values)
  const range = max - min || 1
  const toX = (i: number) => (i / (values.length - 1)) * W
  const toY = (v: number) => H - padY - ((v - min) / range) * (H - padY * 2)
  const pts = values.map((v, i) => [toX(i), toY(v)] as const)

  const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')
  const last = pts[pts.length - 1]
  const prev = pts[pts.length - 2]
  const color = TONE[tone].color

  const handleMove = (e: React.MouseEvent) => {
    if (!ref.current) return
    const rect = ref.current.getBoundingClientRect()
    const relX = (e.clientX - rect.left) / rect.width * W
    setHover(Math.max(0, Math.min(values.length - 1, Math.round(relX / W * (values.length - 1)))))
  }

  return (
    <div style={{ position: 'relative', width: '100%' }}>
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} width="100%" height={height} preserveAspectRatio="none"
        style={{ display: 'block', overflow: 'visible', cursor: 'crosshair' }}
        onMouseMove={handleMove} onMouseLeave={() => setHover(null)}>
        <path d={path} fill="none" stroke="var(--tx3)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d={`M${prev[0].toFixed(1)},${prev[1].toFixed(1)} L${last[0].toFixed(1)},${last[1].toFixed(1)}`}
          fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx={last[0]} cy={last[1]} r="2.5" fill={color} stroke="var(--surface)" strokeWidth="1.5" />
        {hover != null && (
          <>
            <line x1={pts[hover][0]} y1={0} x2={pts[hover][0]} y2={H} stroke="var(--tx3)" strokeWidth="1" strokeDasharray="2,2" />
            <circle cx={pts[hover][0]} cy={pts[hover][1]} r="3" fill={hover === values.length - 1 ? color : 'var(--tx2)'} stroke="var(--surface)" strokeWidth="1.5" />
          </>
        )}
      </svg>
      {hover != null && (
        <div style={{
          position: 'absolute', top: -22, left: `${(pts[hover][0] / W) * 100}%`, transform: 'translateX(-50%)',
          background: 'var(--tx)', color: 'var(--bg)', fontSize: '.65rem', fontWeight: 700, padding: '2px 6px',
          borderRadius: 6, whiteSpace: 'nowrap', pointerEvents: 'none', zIndex: 1,
        }}>
          {formatValue ? formatValue(values[hover]) : values[hover]}
        </div>
      )}
    </div>
  )
}

// ── StatTile ──────────────────────────────────────────────────────────────────
export function StatTile({ label, value, sub, tone, icon, trend, trendFormat, onClick }: {
  label: string; value: React.ReactNode; sub?: string; tone?: Tone; icon?: React.ReactNode
  trend?: number[]; trendFormat?: (v: number) => string; onClick?: () => void
}) {
  return (
    <Card onClick={onClick} pad={16} style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '.72rem', fontWeight: 600, color: 'var(--tx2)', textTransform: 'uppercase', letterSpacing: '.04em' }}>
        {icon && <span style={{ display: 'inline-flex', color: tone ? TONE[tone].color : 'var(--tx2)' }}>{icon}</span>}
        {label}
      </div>
      <div style={{ fontSize: '1.5rem', fontWeight: 700, color: tone ? TONE[tone].color : 'var(--tx)', fontVariantNumeric: 'tabular-nums', lineHeight: 1.15, overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: '.78rem', color: 'var(--tx3)' }}>{sub}</div>}
      {trend && trend.length >= 2 && (
        <div style={{ marginTop: 4 }}>
          <Sparkline values={trend} tone={tone} formatValue={trendFormat} />
        </div>
      )}
    </Card>
  )
}

// ── EmptyState ────────────────────────────────────────────────────────────────
export function EmptyState({ icon, title, sub, action, tone = 'accent' }: {
  icon?: React.ReactNode; title: string; sub?: string; action?: React.ReactNode; tone?: Tone
}) {
  return (
    <div style={{ textAlign: 'center', padding: '48px 20px', color: 'var(--tx3)' }}>
      {icon && (
        <div style={{
          width: 64, height: 64, borderRadius: 20, background: TONE[tone].soft, color: TONE[tone].color,
          display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px',
        }}>{icon}</div>
      )}
      <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--tx)' }}>{title}</div>
      {sub && <div style={{ fontSize: '.83rem', marginTop: 6, maxWidth: 300, marginInline: 'auto', lineHeight: 1.5 }}>{sub}</div>}
      {action && <div style={{ marginTop: 16 }}>{action}</div>}
    </div>
  )
}

// ── Spinner ───────────────────────────────────────────────────────────────────
export function Spinner({ label, compact }: { label?: string; compact?: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: compact ? 0 : 32 }}>
      <div aria-hidden style={{
        width: compact ? 20 : 26, height: compact ? 20 : 26, borderRadius: '50%',
        border: '2.5px solid rgba(120,120,128,.16)', borderTopColor: 'var(--accent)',
        animation: 'ui-spin .7s linear infinite',
      }} />
      {label && <div style={{ fontSize: '.82rem', color: 'var(--tx2)' }}>{label}</div>}
    </div>
  )
}

// ── SectionTitle ──────────────────────────────────────────────────────────────
export function SectionTitle({ title, sub, right }: { title: string; sub?: string; right?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 20 }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: '1.25rem', fontWeight: 700, letterSpacing: '-.015em', color: 'var(--tx)', marginBottom: 2 }}>{title}</div>
        {sub && <div style={{ color: 'var(--tx2)', fontSize: '.83rem' }}>{sub}</div>}
      </div>
      {right && <div style={{ flexShrink: 0 }}>{right}</div>}
    </div>
  )
}

// ── Stepper ───────────────────────────────────────────────────────────────────
export function Stepper({ value, onChange, min = 0, max = 99, step = 1, format, decLabel = '−', incLabel = '+' }: {
  value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number
  format?: (v: number) => string; decLabel?: string; incLabel?: string
}) {
  const btn: React.CSSProperties = {
    width: 44, height: 40, border: 'none', background: 'transparent', color: 'var(--accent)',
    fontSize: '1.15rem', fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 8,
  }
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', background: 'var(--fill)', borderRadius: 'var(--radius-sm)', padding: 2 }}>
      <button type="button" className="ui-press ui-btn" aria-label={decLabel} disabled={value - step < min}
        onClick={() => onChange(Math.max(min, value - step))} style={btn}>−</button>
      <div style={{ minWidth: 44, textAlign: 'center', fontSize: '.95rem', fontWeight: 700, color: 'var(--tx)', fontVariantNumeric: 'tabular-nums' }}>
        {format ? format(value) : value}
      </div>
      <button type="button" className="ui-press ui-btn" aria-label={incLabel} disabled={value + step > max}
        onClick={() => onChange(Math.min(max, value + step))} style={btn}>+</button>
    </div>
  )
}

// ── Skeleton ──────────────────────────────────────────────────────────────────
export function Skeleton({ h = 64, n = 3, radius }: { h?: number; n?: number; radius?: number }) {
  return (
    <div aria-hidden style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} style={{
          height: h, borderRadius: radius ?? 'var(--radius)', background: 'var(--fill)',
          animation: 'ui-pulse 1.4s ease-in-out infinite', animationDelay: `${i * 0.12}s`,
        }} />
      ))}
    </div>
  )
}

// ── Container ─────────────────────────────────────────────────────────────────
// Ширина контента страницы — раньше была захардкожена в (shell)/layout.tsx (880px,
// «телефон на десктопе»). Теперь каждая страница сама выбирает: normal — карточки-грид
// (Обзор/Команда/Настройки/Оплата/Аккаунт), wide — таблицы/master-detail (Смены/Брони/Гости).
export function Container({ children, size = 'normal', style }: {
  children: React.ReactNode; size?: 'normal' | 'wide' | 'full'; style?: React.CSSProperties
}) {
  const maxWidth = size === 'normal' ? 1160 : size === 'wide' ? 1680 : undefined
  return <div style={{ maxWidth, width: '100%', margin: '0 auto', ...style }}>{children}</div>
}

// ── Table ─────────────────────────────────────────────────────────────────────
// Плотный desktop-список: сортировка по клику на заголовок, опциональный поиск.
// Client-side (без серверной пагинации) — рассчитан на сотни-тысячи строк в год
// (брони/смены/команда), не на десятки тысяч.
function SortArrow({ dir }: { dir: 1 | -1 }) {
  return (
    <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor" style={{ transform: dir === -1 ? 'rotate(180deg)' : undefined }}>
      <path d="M4 0l4 6H0z" />
    </svg>
  )
}

export type TableColumn<T> = {
  key: string; label: string; width?: string | number; align?: 'left' | 'right' | 'center'
  sortable?: boolean; render?: (row: T) => React.ReactNode; sortValue?: (row: T) => string | number
}

export function Table<T extends { id: string | number }>({
  columns, rows, searchable, searchPlaceholder, searchText, onRowClick, selectedId, emptyLabel,
  expandedId, renderExpanded,
}: {
  columns: TableColumn<T>[]; rows: T[]; searchable?: boolean; searchPlaceholder?: string
  searchText?: (row: T) => string; onRowClick?: (row: T) => void
  selectedId?: string | number | null; emptyLabel?: string
  // Раскрытая строка-панель прямо под нужной строкой (правки на месте — не форма вверху страницы).
  expandedId?: string | number | null; renderExpanded?: (row: T) => React.ReactNode
}) {
  const [query, setQuery] = React.useState('')
  const [sortKey, setSortKey] = React.useState<string | null>(null)
  const [sortDir, setSortDir] = React.useState<1 | -1>(1)

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(r => (searchText ? searchText(r) : Object.values(r as Record<string, unknown>).join(' ')).toLowerCase().includes(q))
  }, [rows, query, searchText])

  const sorted = React.useMemo(() => {
    if (!sortKey) return filtered
    const col = columns.find(c => c.key === sortKey)
    const val = col?.sortValue ?? ((r: T) => (r as Record<string, unknown>)[sortKey] as string | number)
    return [...filtered].sort((a, b) => {
      const av = val(a), bv = val(b)
      if (av === bv) return 0
      return (av > bv ? 1 : -1) * sortDir
    })
  }, [filtered, sortKey, sortDir, columns])

  const toggleSort = (key: string) => {
    if (sortKey === key) setSortDir(d => (d === 1 ? -1 : 1))
    else { setSortKey(key); setSortDir(1) }
  }

  return (
    <div>
      {searchable && (
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder={searchPlaceholder}
          className="ui-input" style={{ ...inputStyle, marginBottom: 12, maxWidth: 320 }} />
      )}
      <div style={{ overflowX: 'auto', background: 'var(--surface)', borderRadius: 'var(--radius)', border: 'var(--hairline)', boxShadow: 'var(--sh-card)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.86rem' }}>
          <thead>
            <tr>
              {columns.map(c => (
                <th key={c.key} onClick={c.sortable ? () => toggleSort(c.key) : undefined}
                  style={{
                    textAlign: c.align || 'left', padding: '10px 14px', width: c.width,
                    fontSize: '.7rem', fontWeight: 700, color: 'var(--tx2)', textTransform: 'uppercase', letterSpacing: '.04em',
                    borderBottom: 'var(--hairline)', cursor: c.sortable ? 'pointer' : 'default', whiteSpace: 'nowrap', userSelect: 'none',
                  }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                    {c.label}
                    {c.sortable && sortKey === c.key && <SortArrow dir={sortDir} />}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr><td colSpan={columns.length} style={{ padding: '32px 14px', textAlign: 'center', color: 'var(--tx3)', fontSize: '.85rem' }}>{emptyLabel || '—'}</td></tr>
            ) : sorted.map(row => (
              <React.Fragment key={row.id}>
                <tr onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={onRowClick ? 'ui-row' : undefined}
                  style={{ cursor: onRowClick ? 'pointer' : 'default', background: selectedId === row.id ? 'var(--accent-soft)' : undefined }}>
                  {columns.map(c => (
                    <td key={c.key} style={{ padding: '10px 14px', textAlign: c.align || 'left', borderBottom: 'var(--hairline)', color: 'var(--tx)' }}>
                      {c.render ? c.render(row) : String((row as Record<string, unknown>)[c.key] ?? '')}
                    </td>
                  ))}
                </tr>
                {renderExpanded && expandedId === row.id && (
                  <tr>
                    <td colSpan={columns.length} style={{ padding: 0, borderBottom: 'var(--hairline)', background: 'var(--fill2)' }}>
                      {renderExpanded(row)}
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── SplitView (master-detail) ───────────────────────────────────────────────
// Desktop: список слева фиксированной ширины, детали справа гибкой. Ниже 900px
// (тот же breakpoint, что у сайдбара shell) — колонки складываются в одну.
export function SplitView({ master, detail, masterWidth = 340, emptyDetail }: {
  master: React.ReactNode; detail: React.ReactNode | null; masterWidth?: number; emptyDetail?: React.ReactNode
}) {
  return (
    <div className="ui-split">
      <div className="ui-split-master" style={{ width: masterWidth, flexShrink: 0 }}>{master}</div>
      <div className="ui-split-detail" style={{ flex: 1, minWidth: 0 }}>{detail ?? emptyDetail}</div>
    </div>
  )
}
