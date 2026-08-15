'use client'
export const dynamic = 'force-dynamic'
import React, { useEffect, useState, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { db } from '@/lib/db'
import { Segmented } from '@/components/Segmented'
import { useTheme } from '@/hooks/useTheme'
import { AuthGate } from '@/components/AuthGate'
import { AppLoading } from '@/components/AppLoading'
import { AppSwitchBrand } from '@/components/AppSwitchBrand'
import { Spinner } from '@/components/ui'
import { fmtDate as fmtDay } from '@/lib/format'
import { useI18n, tCurrent } from '@/lib/i18n'

// ── HELPERS ───────────────────────────────────────────────────────────────────

function fg(g: number) {
  if (!g) return `0 ${tCurrent('st.gramsPh')}`
  return g >= 1000 ? `${(g / 1000).toFixed(2).replace('.', ',')} ${tCurrent('st.kg')}` : `${g} ${tCurrent('st.gramsPh')}`
}
// Postgres created_at — "timestamp without time zone" (now() на сервере, сессия в UTC),
// приходит без Z/смещения. `new Date(iso)` без tz-суффикса JS трактует как ЛОКАЛЬНОЕ время
// браузера — движение, сохранённое в 14:00 UTC, показывалось как «14:00» вместо верных 16:00
// в Цюрихе (UTC+2), а рядом с полуночью дата целиком уезжала на соседний день.
function toUtcDate(iso: string): Date {
  const withTz = /[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : iso + 'Z'
  return new Date(withTz)
}
function timeStr(iso: string, locale: string) {
  return toUtcDate(iso).toLocaleString(locale, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(',', ' ')
}

// ── AUTOCOMPLETE INPUT ────────────────────────────────────────────────────────

function AutoInput({ value, onChange, suggestions, placeholder, disabled, t }: {
  value: string; onChange: (v: string) => void
  suggestions: string[]; placeholder: string
  disabled?: boolean; t: ReturnType<typeof useTheme>
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const filtered = [...new Set(suggestions)]
    .filter(s => !value.trim() || s.toLowerCase().includes(value.toLowerCase()))
    .slice(0, 8)

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  return (
    <div ref={ref} style={{ position: 'relative', flex: 1 }}>
      <input
        value={value}
        onChange={e => { onChange(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        disabled={disabled}
        style={{
          width: '100%', padding: '12px 14px', borderRadius: 12,
          border: `1px solid ${t.sep2}`, fontSize: 16,
          color: disabled ? t.text3 : t.text,
          background: disabled ? t.fill2 : t.surface,
          fontFamily: 'inherit', outline: 'none',
          WebkitAppearance: 'none',
        }}
      />
      {open && filtered.length > 0 && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0,
          background: t.surface, borderRadius: 14,
          boxShadow: `0 8px 32px rgba(0,0,0,${t.dark ? '.6' : '.16'})`,
          zIndex: 400, marginTop: 4, overflow: 'hidden',
          maxHeight: 220, overflowY: 'auto',
          border: `1px solid ${t.sep2}`,
        }}>
          {filtered.map((s, i) => (
            <div key={s}
              onMouseDown={e => { e.preventDefault(); onChange(s); setOpen(false) }}
              style={{
                padding: '13px 16px', fontSize: 16, color: t.text,
                borderBottom: i < filtered.length - 1 ? `1px solid ${t.sep2}` : 'none',
                cursor: 'pointer',
              }}
            >{s}</div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── INTERFACES ────────────────────────────────────────────────────────────────

interface StockItem { id: string; brand: string; flavor: string; quantity_g: number }
interface Movement { id: string; brand: string; flavor: string; quantity_g: number; type: string; batch_id: string; created_at: string }
interface Inventory { id: string; created_at: string; items: any[] }
interface MovRow { id: string; brand: string; flavor: string; quantity_g: string }
interface InvRow { brand: string; flavor: string; expected_g: number; actual_g: string }

const newRow = (): MovRow => ({ id: Math.random().toString(36).slice(2), brand: '', flavor: '', quantity_g: '' })

// ── ICON COMPONENTS ───────────────────────────────────────────────────────────

function IconStash({ color = 'currentColor' }: { color?: string }) {
  return (
    <svg width="28" height="28" viewBox="0 0 64 64" fill="none">
      <rect width="64" height="64" rx="14" fill={color} />
      <rect x="10" y="28" width="44" height="26" rx="5" fill="white" opacity="0.18" stroke="white" strokeOpacity="0.55" strokeWidth="2.5" />
      <rect x="14" y="14" width="36" height="17" rx="5" fill="white" opacity="0.1" stroke="white" strokeOpacity="0.38" strokeWidth="2.5" />
      <path d="M24 37 H40" stroke="white" strokeWidth="4.5" strokeLinecap="round" />
      <path d="M32 29 V45" stroke="white" strokeWidth="4.5" strokeLinecap="round" />
    </svg>
  )
}

// ── STAT CARD ─────────────────────────────────────────────────────────────────

function StatCard({ label, value, color, t }: { label: string; value: string; color: string; t: ReturnType<typeof useTheme> }) {
  return (
    <div style={{
      background: t.surface, borderRadius: 16, padding: '14px 16px',
      boxShadow: t.sh, flex: 1,
    }}>
      <div style={{ fontSize: 11, color: t.text3, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color, letterSpacing: -0.5 }}>{value}</div>
    </div>
  )
}

// ── SEGMENTED CONTROL ─────────────────────────────────────────────────────────


// ── MAIN ──────────────────────────────────────────────────────────────────────

// ── HOOKAH SHIFT (смена кальянщика) ───────────────────────────────────────────
// Кальянщик ставит число рядом с каждым видом кальяна (виды задаёт владелец:
// дашборд → Настройки → Виды кальянов). Табак списывается из массы «в заведении»
// (выдано в зал − продано × порция), склад не трогается. Конкретный вкус не
// указывается — отложено.

// Категории бесплатных кальянов (для кого/повод). Храним в hookah_sales.flavor — без миграции.
// Дефолт, если владелец не задал свои в дашборде (Настройки → restaurant_settings.free_hookah_categories) — см. StashView.swift DEFAULT_FREE_CATS.
const DEFAULT_FREE_CATS = ['Сотрудники', 'Владелец', 'Менеджер', 'Гость', 'Дегустация']
const FREE_CAT_KEYS: Record<string, string> = { 'Сотрудники': 'st.fcStaff', 'Владелец': 'st.fcOwner', 'Менеджер': 'st.fcManager', 'Гость': 'st.fcGuest', 'Дегустация': 'st.fcTasting' }

function HookahShiftTab({ restaurantId, t, toast, canSeeMoney }: { restaurantId: string; t: ReturnType<typeof useTheme>; toast: (m: string) => void; canSeeMoney: boolean }) {
  const { t: tr, locale } = useI18n()
  const [currentDate, setCurrentDate] = useState(new Date())
  const dateStr = fmtDay(currentDate)
  const [mode, setMode] = useState<'paid' | 'free'>('paid')
  const [freeCats, setFreeCats] = useState<string[]>(DEFAULT_FREE_CATS)
  const [freeCat, setFreeCat] = useState<string>(DEFAULT_FREE_CATS[0])
  const [types, setTypes] = useState<any[]>([])
  // vals[typeId] = { paid: число, free: { категория → число } }
  const [vals, setVals] = useState<Record<string, { paid: string; free: Record<string, string> }>>({})
  const [venueBase, setVenueBase] = useState(0) // выдано в зал − расход прочих дней
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  // Снэпшот уже сохранённых сегодня продаж — грамовка ЗАФИКСИРОВАНА на момент загрузки
  // (реальный portion_g из hookah_sales), а не живая настройка типа. Иначе смена грамовки
  // в Настройках задним числом двигает venueLeft для уже пробитых сегодня чеков.
  const [savedGrams, setSavedGrams] = useState(0)
  const [savedQty, setSavedQty] = useState<Record<string, number>>({})
  const savingRef = useRef(false)

  const loadShift = async () => {
    setLoading(true)
    const [{ data: tps }, { data: sales }, { data: outs }, { data: venueWo }, { data: settingsRows }] = await Promise.all([
      db.from('hookah_types').select('*').eq('is_active', true).order('created_at'),
      db.from('hookah_sales').select('hookah_type_id, quantity, portion_g, is_free, date, flavor'),
      db.from('tobacco_movements').select('quantity_g').eq('restaurant_id', restaurantId).eq('type', 'out'),
      // Списание «с заведения» = движение writeoff без бренда/вкуса (общий вес зала) — см. StashView.swift saveVenueWriteoff.
      db.from('tobacco_movements').select('quantity_g, brand, flavor').eq('restaurant_id', restaurantId).eq('type', 'writeoff'),
      // Категории бесплатных кальянов из настроек заведения (дашборд → Настройки → Кальян).
      db.from('restaurant_settings').select('free_hookah_categories').limit(1),
    ])
    setTypes(tps || [])
    const cats: string[] = settingsRows?.[0]?.free_hookah_categories
    const activeCats = cats && cats.length > 0 ? cats : DEFAULT_FREE_CATS
    setFreeCats(activeCats)
    setFreeCat(fc => activeCats.includes(fc) ? fc : activeCats[0])
    const v: Record<string, { paid: string; free: Record<string, string> }> = {}
    let pastGrams = 0
    let todaySavedGrams = 0
    const todaySavedQty: Record<string, number> = {}
    ;(sales || []).forEach((r: any) => {
      if (r.date === dateStr && r.hookah_type_id) {
        todaySavedQty[r.hookah_type_id] = (todaySavedQty[r.hookah_type_id] || 0) + (r.quantity || 0)
        todaySavedGrams += (r.quantity || 0) * Number(r.portion_g || 0)
        const cur = v[r.hookah_type_id] || { paid: '', free: {} }
        if (r.is_free) {
          const cat = r.flavor || activeCats[0]
          cur.free[cat] = String((Number(cur.free[cat]) || 0) + (r.quantity || 0))
        } else {
          cur.paid = String((Number(cur.paid) || 0) + (r.quantity || 0))
        }
        v[r.hookah_type_id] = cur
      } else if (r.date && r.date < dateStr) {
        // Только строго прошлые даты — иначе продажи ПОСЛЕ выбранного дня (навигация назад)
        // тоже считались «прошлым», и venueBase на старых днях врал.
        pastGrams += (r.quantity || 0) * Number(r.portion_g || 0)
      }
    })
    setVals(v)
    setSavedGrams(todaySavedGrams)
    setSavedQty(todaySavedQty)
    const venueWriteoff = (venueWo || []).filter((m: any) => !m.brand && !m.flavor).reduce((s: number, m: any) => s + (m.quantity_g || 0), 0)
    setVenueBase(Math.max(0, (outs || []).reduce((s: number, m: any) => s + (m.quantity_g || 0), 0) - pastGrams - venueWriteoff))
    setLoading(false)
  }

  useEffect(() => { loadShift() }, [dateStr])

  const paidOf = (typeId: string) => Number(vals[typeId]?.paid) || 0
  const freeOf = (typeId: string, cat: string) => Number(vals[typeId]?.free?.[cat]) || 0
  const freeTotalOf = (typeId: string) => freeCats.reduce((s, c) => s + freeOf(typeId, c), 0)
  const inputVal = (typeId: string) => mode === 'paid' ? (vals[typeId]?.paid || '') : (vals[typeId]?.free?.[freeCat] || '')
  const setQty = (typeId: string, val: string) => {
    const clean = val.replace(/[^\d]/g, '')
    setVals(vs => {
      const cur = vs[typeId] || { paid: '', free: {} }
      if (mode === 'paid') return { ...vs, [typeId]: { ...cur, paid: clean } }
      return { ...vs, [typeId]: { ...cur, free: { ...cur.free, [freeCat]: clean } } }
    })
  }

  const paidTotal = types.reduce((s, tp) => s + paidOf(tp.id), 0)
  const freeTotal = types.reduce((s, tp) => s + freeTotalOf(tp.id), 0)
  const revenue = types.reduce((s, tp) => s + paidOf(tp.id) * Number(tp.price || 0), 0)
  // Сохранённая часть — по реальной portion_g из БД (savedGrams). Несохранённая
  // дельта (введено, но ещё не нажали «Сохранить смену») — по живой настройке.
  const grams = types.reduce((s, tp) => {
    const currentQty = paidOf(tp.id) + freeTotalOf(tp.id)
    const delta = Math.max(0, currentQty - (savedQty[tp.id] || 0))
    return s + delta * Number(tp.portion_g || 0)
  }, savedGrams)
  const venueLeft = venueBase - grams

  const save = async () => {
    // Гвард по ref, не по стейту: setSaving(true) не успевает попасть в рендер до
    // быстрого второго клика — стейт ещё читается как false, второй save() проходит
    // и удваивает продажи за день (delete+insert не атомарны, второй прогон гонится с первым).
    if (savingRef.current) return
    savingRef.current = true
    setSaving(true)
    try {
      const { error: delErr } = await db.from('hookah_sales').delete().eq('date', dateStr)
      if (delErr) { toast(tr('st.err') + ': ' + delErr.message); return }
      const rows: any[] = []
      types.forEach(tp => {
        const p = paidOf(tp.id)
        if (p > 0) rows.push({
          hookah_type_id: tp.id, quantity: p, date: dateStr,
          price: Number(tp.price || 0), portion_g: Number(tp.portion_g || 0),
          is_free: false, brand: null, flavor: null, flavor_id: null,
        })
        freeCats.forEach(cat => {
          const f = freeOf(tp.id, cat)
          if (f > 0) rows.push({
            hookah_type_id: tp.id, quantity: f, date: dateStr,
            price: 0, portion_g: Number(tp.portion_g || 0),
            is_free: true, brand: null, flavor: cat, flavor_id: null, // flavor = категория бесплатного
          })
        })
      })
      if (rows.length) {
        const { error } = await db.from('hookah_sales').insert(rows)
        if (error) { toast(tr('st.err') + ': ' + error.message); return }
      }
      // Перечитываем — иначе savedGrams/savedQty остаются старыми и «Табак»/остаток зала
      // завышены до ручного refresh (уже сохранённый ввод считался ещё раз как несохранённый).
      await loadShift()
      toast(`${tr('st.shiftSaved')} · ${paidTotal} ${tr('st.soldWord')}${freeTotal ? ` · ${freeTotal} ${tr('st.freeWord')}` : ''}`)
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  if (loading) return <div style={{ textAlign: 'center', padding: 40, color: t.text3 }}>{tr('st.loading')}</div>

  if (types.length === 0) return (
    <div style={{ textAlign: 'center', padding: '60px 20px', color: t.text3 }}>
      <div style={{ fontWeight: 600, fontSize: 16, color: t.text2 }}>{tr('st.typesEmpty')}</div>
      <div style={{ fontSize: 13, marginTop: 6, lineHeight: 1.5 }} dangerouslySetInnerHTML={{ __html: tr('st.typesEmptySub') }} />
    </div>
  )

  const accent = mode === 'paid' ? t.orange : t.purple
  const isToday = dateStr === fmtDay(new Date())
  const dDisp = currentDate.toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'long' })
  const shiftDay = (delta: number) => setCurrentDate(d => { const n = new Date(d); n.setDate(n.getDate() + delta); return n })

  return (
    <div>
      {/* Навигация по дням (как в Manager) */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <button onClick={() => shiftDay(-1)} style={{ width: 36, height: 36, borderRadius: 10, background: t.surface, border: `0.5px solid ${t.sep2}`, color: t.text2, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: t.sh, fontFamily: 'inherit' }}>
          <svg width="8" height="14" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" viewBox="0 0 10 18"><path d="M8 1L1 9l7 8" /></svg>
        </button>
        <button onClick={() => setCurrentDate(new Date())} style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'center' }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: t.text, textTransform: 'capitalize' }}>{dDisp}</div>
          {!isToday && <div style={{ fontSize: 11, color: t.blue, fontWeight: 600, marginTop: 1 }}>{tr('st.backToday')}</div>}
        </button>
        <button onClick={() => shiftDay(1)} disabled={isToday} style={{ width: 36, height: 36, borderRadius: 10, background: t.surface, border: `0.5px solid ${t.sep2}`, color: isToday ? t.text3 : t.text2, opacity: isToday ? 0.4 : 1, cursor: isToday ? 'default' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: t.sh, fontFamily: 'inherit' }}>
          <svg width="8" height="14" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" viewBox="0 0 10 18"><path d="M2 1l7 8-7 8" /></svg>
        </button>
      </div>

      {/* Итог дня. Выручку видит только владелец/менеджер (кальянщику деньги не показываем). */}
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${canSeeMoney ? 4 : 3}, 1fr)`, gap: 8, marginBottom: 10 }}>
        {[
          { l: tr('st.statSold'), v: String(paidTotal), c: t.orange },
          { l: tr('st.statFree'), v: String(freeTotal), c: t.purple },
          ...(canSeeMoney ? [{ l: tr('st.statRevenue'), v: `€${revenue.toLocaleString('de-DE')}`, c: t.green }] : []),
          { l: tr('st.statTobacco'), v: `${grams.toLocaleString('de-DE')} ${tr('st.gramsPh')}`, c: t.blue },
        ].map(it => (
          <div key={it.l} style={{ background: t.surface, borderRadius: 14, padding: '12px 8px', boxShadow: t.sh, textAlign: 'center' }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: it.c }}>{it.v}</div>
            <div style={{ fontSize: 10, color: t.text3, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4, marginTop: 3 }}>{it.l}</div>
          </div>
        ))}
      </div>

      {/* Масса табака в заведении (выдано в зал − расход кальянов) */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: `${venueLeft < 0 ? t.red : t.blue}12`, borderRadius: 12, padding: '9px 14px', marginBottom: 12 }}>
        <span style={{ fontSize: 12.5, color: venueLeft < 0 ? t.red : t.blue, fontWeight: 600 }}>{tr('st.venueLeft')}</span>
        <span style={{ fontSize: 13, color: venueLeft < 0 ? t.red : t.blue, fontWeight: 800 }}>{fg(Math.round(venueLeft))}</span>
      </div>

      {/* Продажа | Бесплатно */}
      <div style={{ display: 'flex', background: t.fill, borderRadius: 12, padding: 3, marginBottom: 12, gap: 2 }}>
        {([['paid', tr('st.segPaid')], ['free', tr('st.statFree')]] as const).map(([id, label]) => (
          <button key={id} onClick={() => setMode(id)} style={{ flex: 1, padding: '8px 0', borderRadius: 10, border: 'none', fontFamily: 'inherit', fontSize: 13, fontWeight: mode === id ? 700 : 500, cursor: 'pointer', background: mode === id ? t.surface : 'transparent', color: mode === id ? (id === 'paid' ? t.orange : t.purple) : t.text3 }}>{label}</button>
        ))}
      </div>
      {mode === 'free' && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: t.text3, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4, padding: '0 2px 7px' }}>{tr('st.forWhom')}</div>
          <div style={{ display: 'flex', gap: 7, overflowX: 'auto', paddingBottom: 2, WebkitOverflowScrolling: 'touch' }}>
            {freeCats.map(cat => {
              const on = freeCat === cat
              const n = types.reduce((s, tp) => s + freeOf(tp.id, cat), 0)
              return (
                <button key={cat} onClick={() => setFreeCat(cat)} style={{ flexShrink: 0, padding: '7px 14px', borderRadius: 20, border: 'none', fontFamily: 'inherit', fontSize: 13, fontWeight: on ? 700 : 500, cursor: 'pointer', background: on ? t.purple : `${t.purple}14`, color: on ? '#fff' : t.purple, whiteSpace: 'nowrap' }}>
                  {FREE_CAT_KEYS[cat] ? tr(FREE_CAT_KEYS[cat]) : cat}{n > 0 ? ` · ${n}` : ''}
                </button>
              )
            })}
          </div>
          <div style={{ fontSize: 11.5, color: t.text3, marginTop: 8, padding: '0 2px' }}>{tr('st.freeNote')}</div>
        </div>
      )}

      {/* Виды кальянов: число за смену */}
      <div style={{ background: t.surface, borderRadius: 16, overflow: 'hidden', boxShadow: t.sh, marginBottom: 14 }}>
        {types.map((tp, i) => {
          const q = inputVal(tp.id)
          return (
            <div key={tp.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderBottom: i < types.length - 1 ? `0.5px solid ${t.sep2}` : 'none' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: t.text }}>{tp.name}</div>
                <div style={{ fontSize: 11, color: t.text3, marginTop: 1 }}>{canSeeMoney ? `€${tp.price} · ` : ''}{tp.portion_g} {tr('st.gramsPh')}</div>
              </div>
              <input
                value={q} onChange={e => setQty(tp.id, e.target.value)}
                type="text" inputMode="numeric" placeholder="0"
                style={{
                  width: 72, padding: '10px 0', borderRadius: 12, textAlign: 'center',
                  border: `1.5px solid ${Number(q) > 0 ? accent : t.sep2}`,
                  fontSize: 17, fontWeight: 700, color: Number(q) > 0 ? accent : t.text,
                  background: t.bg, fontFamily: 'inherit', outline: 'none', WebkitAppearance: 'none',
                }}
              />
            </div>
          )
        })}
      </div>

      <button onClick={save} disabled={saving} style={{ width: '100%', padding: '15px', borderRadius: 16, background: t.orange, color: '#fff', border: 'none', fontFamily: 'inherit', fontSize: 15, fontWeight: 700, cursor: 'pointer', boxShadow: `0 4px 16px ${t.orange}44` }}>
        {saving ? tr('st.savingShort') : tr('st.saveShift')}
      </button>
    </div>
  )
}


export default function StashApp({ rid = '' }: { rid?: string }) {
  // rid задан → embedded-режим: рендер внутри дашборд-shell (/dashboard/stash),
  // без AuthGate/PIN, без фикс-хрома, тема дашборда.
  const embedded = !!rid
  // Desktop-режим внутри shell: шире мобильных 860px. Staff-приложение не трогаем.
  const contentMaxWidth = embedded ? 1100 : 860
  const t = useTheme(embedded ? 'mise_dash_dark' : undefined)
  const { t: tr, locale } = useI18n()

  const [restaurantId, setRestaurantId] = useState(rid)
  const [tab, setTab] = useState<'shift' | 'stock' | 'movements' | 'inventory'>('shift')
  const [movMode, setMovMode] = useState<'in' | 'out' | 'writeoff'>('in')
  const [movReason, setMovReason] = useState('')
  const [invType, setInvType] = useState<'warehouse' | 'venue'>('warehouse')
  const [stock, setStock] = useState<StockItem[]>([])
  const [movements, setMovements] = useState<Movement[]>([])
  const [inventories, setInventories] = useState<Inventory[]>([])
  const [loading, setLoading] = useState(true)
  const [mounted, setMounted] = useState(false)
  const [search, setSearch] = useState('')
  const [showEmpty, setShowEmpty] = useState(false)
  const [showLowOnly, setShowLowOnly] = useState(false)
  // Кальянщик (роль hookah/waiter) не видит выручку — деньги только владельцу/менеджеру.
  // Владелец входит по Supabase-сессии (без staff-объекта) → по умолчанию видит.
  const [canSeeMoney, setCanSeeMoney] = useState(true)
  const [showAddMov, setShowAddMov] = useState(false)
  const [showInv, setShowInv] = useState(false)
  const [movRows, setMovRows] = useState<MovRow[]>([newRow()])
  // Списание «с заведения» (венью) — только вес, без бренда/вкуса. Уменьшает venueBase
  // в смене кальянщика, склад не трогает. Паритет с StashView.swift saveVenueWriteoff (H2).
  const [writeoffVenue, setWriteoffVenue] = useState(false)
  const [venueGrams, setVenueGrams] = useState('')
  const [venueAvailable, setVenueAvailable] = useState(0)
  const [invRows, setInvRows] = useState<InvRow[]>([])
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const [toast, setToast] = useState('')
  const [expandedBatch, setExpandedBatch] = useState<string | null>(null)
  const [expandedInv, setExpandedInv] = useState<string | null>(null)
  const [editBatch, setEditBatch] = useState<string | null>(null)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (!restaurantId) return
    loadAll(restaurantId)
    // Роль вошедшего: владелец (нет staff-объекта) или менеджер видят деньги; кальянщик/официант — нет.
    let role = 'owner'
    try {
      const raw = localStorage.getItem('mise_staff_' + restaurantId)
      if (raw) { const s = JSON.parse(raw); role = s.is_owner ? 'owner' : (s.role || 'staff') }
    } catch {}
    setCanSeeMoney(role === 'owner' || role === 'manager' || role === 'admin')
  }, [restaurantId])

  const loadAll = async (rid: string) => {
    setLoading(true)
    const [s1, s2, s3] = await Promise.all([
      db.from('tobacco_stock').select('*').eq('restaurant_id', rid).order('brand').order('flavor'),
      db.from('tobacco_movements').select('*').eq('restaurant_id', rid).order('created_at', { ascending: false }).limit(1000),
      db.from('tobacco_inventories').select('*').eq('restaurant_id', rid).order('created_at', { ascending: false }).limit(50),
    ])
    setStock(s1.data || [])
    setMovements(s2.data || [])
    setInventories(s3.data || [])
    setLoading(false)
    loadVenueAvailable(rid)
  }

  // Сколько табака физически в заведении прямо сейчас (для гейта списания «с заведения»):
  // всё выдано в зал минус всё продано минус уже списанное «с заведения». Независимый от
  // HookahShiftTab расчёт (та вкладка держит свой venueBase локально, с разбивкой по дню
  // навигации) — здесь нужен just актуальный тотал вне контекста конкретного дня смены.
  const loadVenueAvailable = async (rid: string) => {
    const [{ data: outs }, { data: sales }, { data: wo }] = await Promise.all([
      db.from('tobacco_movements').select('quantity_g').eq('restaurant_id', rid).eq('type', 'out'),
      db.from('hookah_sales').select('quantity, portion_g'),
      db.from('tobacco_movements').select('quantity_g, brand, flavor').eq('restaurant_id', rid).eq('type', 'writeoff'),
    ])
    const totalOut = (outs || []).reduce((s: number, m: any) => s + (m.quantity_g || 0), 0)
    const totalGrams = (sales || []).reduce((s: number, r: any) => s + (r.quantity || 0) * Number(r.portion_g || 0), 0)
    const totalVenueWo = (wo || []).filter((m: any) => !m.brand && !m.flavor).reduce((s: number, m: any) => s + (m.quantity_g || 0), 0)
    setVenueAvailable(Math.max(0, totalOut - totalGrams - totalVenueWo))
  }

  const showToastMsg = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 2500) }

  const allBrands = [...new Set(stock.map(s => s.brand))].filter(Boolean).sort()
  const allFlavors = [...new Set(stock.map(s => s.flavor))].filter(Boolean).sort()
  const outBrands = [...new Set(stock.filter(s => s.quantity_g > 0).map(s => s.brand))].sort()
  const inStockItems = stock.filter(s => s.quantity_g > 0)
  const emptyItems = stock.filter(s => s.quantity_g <= 0)
  // Заканчивается = остаток ≤ минимума позиции (fallback 200 г, если минимум не задан)
  const isLow = (s: any) => s.quantity_g > 0 && s.quantity_g <= (s.min_quantity_g || 200)
  const lowItems = inStockItems.filter(isLow)
  const filteredStock = inStockItems
    .filter(s => `${s.brand} ${s.flavor}`.toLowerCase().includes(search.toLowerCase()))
    .filter(s => !showLowOnly || isLow(s))
  const brandTotal = (brand: string) => stock.filter(s => s.brand === brand && s.quantity_g > 0).reduce((sum, s) => sum + s.quantity_g, 0)

  const updateMovRow = (id: string, field: keyof MovRow, val: string) => {
    setMovRows(rows => rows.map(r => {
      if (r.id !== id) return r
      const updated = { ...r, [field]: val }
      if (field === 'brand') updated.flavor = ''
      return updated
    }))
  }

  const removeMovRow = (id: string) => {
    setMovRows(rows => rows.length === 1 ? [newRow()] : rows.filter(r => r.id !== id))
  }

  const flavorsForBrand = (brand: string, outOnly: boolean) => {
    if (outOnly) return stock.filter(s => s.brand === brand && s.quantity_g > 0).map(s => s.flavor).sort()
    return stock.filter(s => s.brand === brand).map(s => s.flavor).sort()
  }

  const saveMov = async () => {
    // Гвард по ref — setSaving(true) не успевает в рендер до второго быстрого клика,
    // стейт saving ещё читается как false и второй вызов проходит следом за первым.
    if (savingRef.current) return
    const filled = movRows.filter(r => r.brand && r.flavor && parseFloat(r.quantity_g) > 0)
    if (!filled.length) { showToastMsg(tr('st.addAtLeastOne')); return }
    if (movMode === 'writeoff' && !movReason.trim()) { showToastMsg(tr('st.enterWriteoffReason')); return }
    savingRef.current = true
    setSaving(true)
    try {
      // Один живой снэпшот склада на всю операцию — валидация и апдейты идут по нему,
      // а не по возможно устаревшему стейту `stock` (правки в другой вкладке/сессии).
      const { data: freshData } = await db.from('tobacco_stock').select('*').eq('restaurant_id', restaurantId)
      const freshStock: StockItem[] = freshData || []
      if (movMode !== 'in') {
        // Копим дельту по бренд+вкус ПО ВСЕМ строкам батча — иначе два ряда на один и тот же
        // товар (напр. 300г + 300г при остатке 400г) проходили валидацию по отдельности,
        // а итоговый апдейт молча клампился в 0 без единого сообщения об ошибке.
        const cumulative = new Map()
        for (const r of filled) {
          const key = r.brand + ' ' + r.flavor
          const cur = cumulative.get(key)
          cumulative.set(key, { brand: r.brand, flavor: r.flavor, qty: (cur ? cur.qty : 0) + parseFloat(r.quantity_g) })
        }
        for (const { brand, flavor, qty } of cumulative.values()) {
          const item = freshStock.find(s => s.brand === brand && s.flavor === flavor)
          if (!item) { showToastMsg(`${brand} · ${flavor} ${tr('st.notFoundSuffix')}`); return }
          if (qty > item.quantity_g) { showToastMsg(`${brand} · ${flavor}: ${tr('st.onlyWord')} ${fg(item.quantity_g)}`); return }
        }
      }

      const batchId = editBatch || crypto.randomUUID()
      const byId: Record<string, StockItem> = {}
      freshStock.forEach(s => { byId[s.id] = s })
      // Дельты копим по id и применяем ОДНИМ апдейтом на позицию в конце — иначе несколько
      // строк батча (старый откат + новая запись), задевающих один и тот же товар,
      // перезаписывали друг друга последовательными update() по одному и тому же base-значению.
      const deltas: Record<string, number> = {}
      let originalCreatedAt: string | undefined

      if (editBatch) {
        const oldMovs = movements.filter(m => m.batch_id === editBatch)
        originalCreatedAt = oldMovs[0]?.created_at
        for (const m of oldMovs) {
          const item = freshStock.find(s => s.brand === m.brand && s.flavor === m.flavor)
          if (item) {
            const revert = m.type === 'in' ? -m.quantity_g : m.quantity_g
            deltas[item.id] = (deltas[item.id] || 0) + revert
          }
        }
        await db.from('tobacco_movements').delete().eq('batch_id', editBatch)
      }
      for (const r of filled) {
        const qty = parseFloat(r.quantity_g)
        const existing = freshStock.find(s => s.brand === r.brand && s.flavor === r.flavor)
        const reason = movReason.trim() || (movMode === 'in' ? 'Поставка' : movMode === 'out' ? 'Выдача в зал' : 'Списание')
        // Правка сохраняет исходный created_at — иначе дата/время движения «прыгали»
        // на момент правки вместо исходного момента поставки/выдачи.
        const movementRow: Record<string, unknown> = { restaurant_id: restaurantId, brand: r.brand, flavor: r.flavor, quantity_g: qty, type: movMode, batch_id: batchId, reason, flavor_id: existing?.id || null }
        if (originalCreatedAt) movementRow.created_at = originalCreatedAt
        await db.from('tobacco_movements').insert(movementRow)
        if (existing) {
          const delta = movMode === 'in' ? qty : -qty
          deltas[existing.id] = (deltas[existing.id] || 0) + delta
        } else if (movMode === 'in') {
          await db.from('tobacco_stock').insert({ restaurant_id: restaurantId, brand: r.brand, flavor: r.flavor, quantity_g: qty, flavor_name: r.flavor, updated_at: new Date().toISOString() })
        }
      }
      for (const id of Object.keys(deltas)) {
        const base = byId[id]
        if (!base) continue
        await db.from('tobacco_stock').update({ quantity_g: Math.max(0, base.quantity_g + deltas[id]), updated_at: new Date().toISOString() }).eq('id', id)
      }

      await loadAll(restaurantId)
      setMovRows([newRow()]); setMovReason(''); setShowAddMov(false); setEditBatch(null)
      showToastMsg(tr('st.savedItems', { n: filled.length }))
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  // Списание «с заведения»: только вес, без бренда/вкуса — паритет с iOS saveVenueWriteoff (H2).
  const saveVenueWriteoff = async () => {
    if (savingRef.current) return
    const qty = parseFloat(venueGrams)
    if (!(qty > 0)) { showToastMsg(tr('st.addAtLeastOne')); return }
    if (!movReason.trim()) { showToastMsg(tr('st.enterWriteoffReason')); return }
    if (qty > venueAvailable) { showToastMsg(tr('st.onlyLeftVenue', { g: fg(Math.round(venueAvailable)) })); return }
    savingRef.current = true
    setSaving(true)
    try {
      const batchId = editBatch || crypto.randomUUID()
      let originalCreatedAt: string | undefined
      if (editBatch) {
        originalCreatedAt = movements.find(m => m.batch_id === editBatch)?.created_at
        await db.from('tobacco_movements').delete().eq('batch_id', editBatch)
      }
      const row: Record<string, unknown> = { restaurant_id: restaurantId, brand: '', flavor: '', quantity_g: qty, type: 'writeoff', batch_id: batchId, reason: movReason.trim() }
      if (originalCreatedAt) row.created_at = originalCreatedAt
      await db.from('tobacco_movements').insert(row)
      await loadAll(restaurantId)
      setMovRows([newRow()]); setMovReason(''); setVenueGrams(''); setWriteoffVenue(false); setShowAddMov(false); setEditBatch(null)
      showToastMsg(tr('st.savedItems', { n: 1 }))
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  const openEdit = (batchId: string, items: Movement[]) => {
    setEditBatch(batchId)
    setMovMode(items[0].type as any)
    const isVenue = items.every(i => !i.brand && !i.flavor)
    setWriteoffVenue(isVenue)
    if (isVenue) {
      setVenueGrams(String(items.reduce((s, i) => s + i.quantity_g, 0)))
      setMovReason((items[0] as any).reason || '')
      setMovRows([newRow()])
    } else {
      setMovReason((items[0] as any).reason && items[0].type === 'writeoff' ? (items[0] as any).reason : '')
      setMovRows([...items.map(m => ({ id: m.id, brand: m.brand, flavor: m.flavor, quantity_g: String(m.quantity_g) }))])
    }
    setShowAddMov(true)
  }

  const openInv = () => {
    setInvRows(stock.filter(s => s.quantity_g > 0).map(s => ({ brand: s.brand, flavor: s.flavor, expected_g: s.quantity_g, actual_g: '' })))
    setShowInv(true)
  }

  const saveInv = async () => {
    if (savingRef.current) return
    const filled = invRows.filter(r => r.actual_g !== '' && parseFloat(r.actual_g) !== r.expected_g)
    if (!filled.length) { showToastMsg(tr('st.noDiff')); return }
    savingRef.current = true
    setSaving(true)
    try {
      const items = filled.map(r => ({ brand: r.brand, flavor: r.flavor, expected_g: r.expected_g, actual_g: parseFloat(r.actual_g), diff_g: parseFloat(r.actual_g) - r.expected_g }))
      await db.from('tobacco_inventories').insert({ restaurant_id: restaurantId, type: 'warehouse', items })
      // Движение-маркер рядом с апдейтом остатка — иначе коррекция по инвентаризации была
      // невидима в ленте «Движения» (нет ни одной строки tobacco_movements для неё).
      const invBatchId = crypto.randomUUID()
      for (const r of filled) {
        const item = stock.find(s => s.brand === r.brand && s.flavor === r.flavor)
        if (item) {
          await db.from('tobacco_stock').update({ quantity_g: Math.max(0, parseFloat(r.actual_g)), updated_at: new Date().toISOString() }).eq('id', item.id)
          const diff = parseFloat(r.actual_g) - r.expected_g
          await db.from('tobacco_movements').insert({
            restaurant_id: restaurantId, brand: r.brand, flavor: r.flavor, quantity_g: Math.abs(diff),
            type: 'inventory', batch_id: invBatchId, flavor_id: item.id,
            reason: `Инвентаризация: было ${fg(r.expected_g)}, стало ${fg(parseFloat(r.actual_g))}`,
          })
        }
      }
      await loadAll(restaurantId)
      setShowInv(false)
      showToastMsg(tr('st.invSaved', { n: filled.length }))
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  const groupedMovements = () => {
    const filtered = movements.filter(m => m.type === movMode)
    const batches: Record<string, Movement[]> = {}
    filtered.forEach(m => { const key = m.batch_id || m.id; if (!batches[key]) batches[key] = []; batches[key].push(m) })
    return Object.entries(batches).sort((a, b) => toUtcDate(b[1][0].created_at).getTime() - toUtcDate(a[1][0].created_at).getTime())
  }

  if (!restaurantId) return <AuthGate appId="stash" appName="Mise Stash" onAuth={setRestaurantId} />

  if (!mounted || loading) return embedded
    ? <div style={{ display: 'flex', justifyContent: 'center', padding: '80px 0' }}><Spinner /></div>
    : <AppLoading app="stash" bg={t.bg} fill={t.fill} accent={t.orange} />

  const batches = groupedMovements()

  const NAV_TABS = [
    {
      id: 'shift', label: tr('st.navShift'),
      icon: (active: boolean) => (
        <svg fill="none" stroke="currentColor" strokeWidth={active ? 2.2 : 1.8} viewBox="0 0 24 24" width="26" height="26">
          <path d="M8 8c0-2.5 3-4 3-6" strokeLinecap="round" /><path d="M12 8c0-2.5 3-4 3-6" strokeLinecap="round" /><path d="M16 8c0-2.5 3-4 3-6" strokeLinecap="round" />
          <path d="M5 14h14" strokeLinecap="round" /><path d="M5 17c1 1.5 2 2 3.5 2s2.5-1 4-1 2.5 1 4 1 2.5-.5 3.5-2" strokeLinecap="round" />
        </svg>
      )
    },
    {
      id: 'stock', label: tr('st.navStock'),
      icon: (active: boolean) => (
        <svg fill="none" stroke="currentColor" strokeWidth={active ? 2.2 : 1.8} viewBox="0 0 24 24" width="26" height="26">
          <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
          <polyline points="9 22 9 12 15 12 15 22" />
        </svg>
      )
    },
    {
      id: 'movements', label: tr('st.navMoves'),
      icon: (active: boolean) => (
        <svg fill="none" stroke="currentColor" strokeWidth={active ? 2.2 : 1.8} viewBox="0 0 24 24" width="26" height="26">
          <path d="M17 1l4 4-4 4" /><path d="M3 11V9a4 4 0 014-4h14" />
          <path d="M7 23l-4-4 4-4" /><path d="M21 13v2a4 4 0 01-4 4H3" />
        </svg>
      )
    },
    {
      id: 'inventory', label: tr('st.navInv'),
      icon: (active: boolean) => (
        <svg fill="none" stroke="currentColor" strokeWidth={active ? 2.2 : 1.8} viewBox="0 0 24 24" width="26" height="26">
          <path d="M9 11l3 3L22 4" />
          <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
        </svg>
      )
    },
  ]

  return (
    <div style={embedded
      ? { display: 'flex', flexDirection: 'column', fontFamily: "-apple-system,BlinkMacSystemFont,'SF Pro Text',sans-serif", WebkitFontSmoothing: 'antialiased', color: t.text }
      : { height: '100vh', overflow: 'hidden', background: t.bg, fontFamily: "-apple-system,BlinkMacSystemFont,'SF Pro Text',sans-serif", WebkitFontSmoothing: 'antialiased' }}>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg) } }
        @keyframes fadeUp { from { opacity:0; transform:translateY(10px) } to { opacity:1; transform:translateY(0) } }
        @keyframes toastIn { from { opacity:0; transform:translateX(-50%) translateY(10px) } to { opacity:1; transform:translateX(-50%) translateY(0) } }
        * { box-sizing: border-box }
        input[type=number]::-webkit-inner-spin-button { -webkit-appearance:none }
      `}</style>

      {/* ── HEADER: standalone — фикс-шапка; embedded — строка контролов в потоке ── */}
      <div style={embedded ? {
        order: 0, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, marginBottom: 12,
        maxWidth: contentMaxWidth, width: '100%', alignSelf: 'center', boxSizing: 'border-box' as const,
      } : {
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 300,
        height: 56, background: t.hbg,
        backdropFilter: 'saturate(200%) blur(24px)',
        WebkitBackdropFilter: 'saturate(200%) blur(24px)',
        borderBottom: `0.5px solid ${t.sep2}`,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px',
      }}>
        {!embedded && <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <AppSwitchBrand name="Stash" accent={t.orange} color={t.text} muted={t.text3} size={18} />
        </div>}
        <button
          onClick={() => { setEditBatch(null); setMovRows([newRow()]); setMovReason(''); setWriteoffVenue(false); setVenueGrams(''); setShowAddMov(true) }}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: `${t.orange}1a`, borderRadius: 20,
            padding: '8px 16px', cursor: 'pointer',
            fontSize: 15, fontWeight: 600, color: t.orange,
            border: 'none', fontFamily: 'inherit',
          }}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M7 1v12M1 7h12" />
          </svg>
          {tr('st.addBtn')}
        </button>
      </div>

      {/* ── CONTENT ── */}
      <div style={embedded
        ? { order: 2 }
        : { position: 'fixed', top: 56, left: 0, right: 0, bottom: 82, overflowY: 'auto', background: t.bg }}>
        <div style={{ padding: embedded ? '0 0 28px' : '16px 16px 28px', maxWidth: contentMaxWidth, margin: '0 auto', animation: 'fadeUp .22s ease' }}>

          {/* ══ HOOKAH SHIFT ══ */}
          {tab === 'shift' && !loading && (
            <HookahShiftTab restaurantId={restaurantId} t={t} toast={showToastMsg} canSeeMoney={canSeeMoney} />
          )}

          {/* ══ STOCK ══ */}
          {tab === 'stock' && (
            <div>
              {/* Search row */}
              <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
                <div style={{ position: 'relative', flex: 1 }}>
                  <input
                    value={search} onChange={e => setSearch(e.target.value)}
                    placeholder={tr('st.searchPh')}
                    style={{
                      width: '100%', padding: '12px 16px 12px 42px',
                      borderRadius: 14, border: `1px solid ${t.sep2}`,
                      fontSize: 16, color: t.text, background: t.surface,
                      fontFamily: 'inherit', outline: 'none', boxShadow: t.sh,
                      WebkitAppearance: 'none',
                    }}
                  />
                  <svg style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)' }} width="18" height="18" fill="none" stroke={t.text3} strokeWidth="2" viewBox="0 0 24 24">
                    <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
                  </svg>
                  {search && (
                    <button onClick={() => setSearch('')} style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: t.fill, border: 'none', borderRadius: '50%', width: 20, height: 20, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: t.text3, fontSize: 12 }}><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg></button>
                  )}
                </div>
                {lowItems.length > 0 && (
                  <button
                    onClick={() => { setShowLowOnly(!showLowOnly); setShowEmpty(false) }}
                    style={{
                      padding: '0 14px', borderRadius: 14, flexShrink: 0,
                      background: showLowOnly ? t.orange : `${t.orange}18`,
                      border: 'none', color: showLowOnly ? '#fff' : t.orange,
                      fontSize: 13, fontWeight: 600, cursor: 'pointer',
                      fontFamily: 'inherit', boxShadow: t.sh, whiteSpace: 'nowrap',
                    }}>
                    {tr('st.lowCount', { n: lowItems.length })}
                  </button>
                )}
                {emptyItems.length > 0 && (
                  <button
                    onClick={() => setShowEmpty(!showEmpty)}
                    style={{
                      padding: '0 16px', borderRadius: 14, flexShrink: 0,
                      background: showEmpty ? t.red : `${t.red}18`,
                      border: 'none', color: showEmpty ? '#fff' : t.red,
                      fontSize: 13, fontWeight: 600, cursor: 'pointer',
                      fontFamily: 'inherit', boxShadow: t.sh, whiteSpace: 'nowrap',
                    }}>
                    {tr('st.emptyCount', { n: emptyItems.length })}
                  </button>
                )}
              </div>

              {/* Stats */}
              <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
                <StatCard label={tr('st.statPositions')} value={String(stock.length)} color={t.text} t={t} />
                <StatCard label={tr('st.statInStock')} value={String(inStockItems.length)} color={t.green} t={t} />
                <StatCard label={tr('st.statLow')} value={String(lowItems.length)} color={t.orange} t={t} />
              </div>

              {/* Stock list */}
              {filteredStock.length === 0 ? (
                <div style={{ padding: '60px 20px', textAlign: 'center', color: t.text3 }}>
                  <div style={{ marginBottom: 12, opacity: 0.3 }}><svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg></div>
                  <div style={{ fontSize: 16, fontWeight: 600, color: t.text2, marginBottom: 6 }}>{search ? tr('st.notFound') : tr('st.stockEmpty')}</div>
                  <div style={{ fontSize: 14, color: t.text3 }}>{search ? tr('st.tryAnother') : tr('st.addFirstSupply')}</div>
                </div>
              ) : (() => {
                const grouped: Record<string, StockItem[]> = {}
                filteredStock.forEach(s => { if (!grouped[s.brand]) grouped[s.brand] = []; grouped[s.brand].push(s) })
                return Object.entries(grouped).map(([brand, items]) => (
                  <div key={brand}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 4px 8px' }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: t.text3, textTransform: 'uppercase', letterSpacing: 0.6 }}>{brand}</div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: t.orange }}>{fg(brandTotal(brand))}</div>
                    </div>
                    <div style={{ background: t.surface, borderRadius: 16, overflow: 'hidden', marginBottom: 8, boxShadow: t.sh }}>
                      {items.map((item, i) => {
                        const low = isLow(item)
                        const pct = Math.min(item.quantity_g / 1000 * 100, 100)
                        return (
                          <div key={item.id} style={{
                            padding: '14px 16px',
                            borderBottom: i < items.length - 1 ? `0.5px solid ${t.sep2}` : 'none',
                          }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                              <div style={{ fontSize: 16, color: t.text, fontWeight: 500 }}>{item.flavor}</div>
                              <div style={{ fontSize: 15, fontWeight: 700, color: low ? t.orange : t.green }}>{fg(item.quantity_g)}</div>
                            </div>
                            {/* Progress bar */}
                            <div style={{ height: 3, background: t.fill2, borderRadius: 2, overflow: 'hidden' }}>
                              <div style={{ height: '100%', width: `${pct}%`, background: low ? t.orange : t.green, borderRadius: 2, transition: 'width .6s ease' }} />
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ))
              })()}

              {/* Empty items */}
              {showEmpty && emptyItems.length > 0 && (
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: t.red, textTransform: 'uppercase', letterSpacing: 0.6, padding: '14px 4px 8px' }}>{tr('st.outOfStockSec')}</div>
                  <div style={{ background: t.surface, borderRadius: 16, overflow: 'hidden', boxShadow: t.sh }}>
                    {emptyItems.map((item, i) => (
                      <div key={item.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 16px', borderBottom: i < emptyItems.length - 1 ? `0.5px solid ${t.sep2}` : 'none' }}>
                        <div>
                          <div style={{ fontSize: 16, color: t.text3 }}>{item.flavor}</div>
                          <div style={{ fontSize: 12, color: t.text4, marginTop: 2 }}>{item.brand}</div>
                        </div>
                        <div style={{ fontSize: 13, color: t.red, fontWeight: 600, background: `${t.red}18`, padding: '4px 10px', borderRadius: 8 }}>{fg(0)}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ══ MOVEMENTS ══ */}
          {tab === 'movements' && (
            <div>
              <div style={{ marginBottom: 16 }}>
                <Segmented
                  options={[{ id: 'in', label: tr('st.movIn') }, { id: 'out', label: tr('st.movOut') }, { id: 'writeoff', label: tr('st.movWriteoff') }]}
                  value={movMode} onChange={v => setMovMode(v as any)} t={t}
                />
              </div>
              {batches.length === 0 ? (
                <div style={{ padding: '60px 20px', textAlign: 'center', color: t.text3 }}>
                  <div style={{ marginBottom: 12, opacity: 0.3 }}>{movMode === 'in' ? <svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/><path d="M12 7v4"/><path d="m9.5 9 2.5 2.5L14.5 9"/></svg> : movMode === 'out' ? <svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/><path d="M12 11V7"/><path d="m9.5 9 2.5-2.5L14.5 9"/></svg> : <svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>}</div>
                  <div style={{ fontSize: 16, fontWeight: 600, color: t.text2, marginBottom: 6 }}>{movMode === 'in' ? tr('st.suppliesEmpty') : movMode === 'out' ? tr('st.issuesEmpty') : tr('st.writeoffsEmpty')}</div>
                </div>
              ) : batches.map(([batchId, items], bi) => {
                const isExpanded = expandedBatch === batchId
                const total = items.reduce((s, i) => s + i.quantity_g, 0)
                const isFirst = bi === 0
                const color = movMode === 'in' ? t.green : movMode === 'out' ? t.orange : t.red
                return (
                  <div key={batchId} style={{ background: t.surface, borderRadius: 16, overflow: 'hidden', marginBottom: 10, boxShadow: t.sh }}>
                    <div
                      onClick={() => setExpandedBatch(isExpanded ? null : batchId)}
                      style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px', cursor: 'pointer', borderBottom: isExpanded ? `0.5px solid ${t.sep2}` : 'none' }}
                    >
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                          <div style={{ fontSize: 16, color: t.text, fontWeight: 600 }}>
                            {locale === 'ru' ? `${items.length} ${items.length === 1 ? 'позиция' : items.length < 5 ? 'позиции' : 'позиций'}` : tr('st.itemsCount', { n: items.length })}
                          </div>
                          {isFirst && (
                            <span style={{ fontSize: 11, color: t.blue, background: `${t.blue}18`, padding: '3px 8px', borderRadius: 8, fontWeight: 600 }}>{tr('st.last')}</span>
                          )}
                        </div>
                        <div style={{ fontSize: 13, color: t.text3 }}>{timeStr(items[0].created_at, locale)}</div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ fontSize: 17, fontWeight: 700, color }}>
                          {movMode === 'in' ? '+' : '−'}{fg(total)}
                        </div>
                        {isFirst && (
                          <button
                            onClick={e => { e.stopPropagation(); openEdit(batchId, items) }}
                            style={{ padding: '6px 12px', borderRadius: 10, background: t.fill, border: 'none', fontSize: 13, color: t.text, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>
                            {tr('st.changeBtn')}
                          </button>
                        )}
                        <svg width="16" height="16" fill="none" stroke={t.text3} strokeWidth="2" viewBox="0 0 24 24" style={{ transform: isExpanded ? 'rotate(180deg)' : 'none', transition: 'transform .2s', flexShrink: 0 }}>
                          <path d="M6 9l6 6 6-6" />
                        </svg>
                      </div>
                    </div>
                    {isExpanded && items.map((item, i) => (
                      <div key={item.id} style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '12px 16px 12px 28px',
                        borderBottom: i < items.length - 1 ? `0.5px solid ${t.sep2}` : 'none',
                        background: t.dark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.01)',
                      }}>
                        <div style={{ fontSize: 15, color: t.text2 }}>{!item.brand && !item.flavor ? tr('st.venueWriteoffLabel') : `${item.brand} · ${item.flavor}`}</div>
                        <div style={{ fontSize: 15, fontWeight: 600, color }}>{movMode === 'in' ? '+' : '−'}{fg(item.quantity_g)}</div>
                      </div>
                    ))}
                  </div>
                )
              })}
            </div>
          )}

          {/* ══ INVENTORY ══ */}
          {tab === 'inventory' && (
            <div>
              <div style={{ marginBottom: 16 }}>
                <Segmented
                  options={[{ id: 'warehouse', label: tr('st.invWarehouse') }, { id: 'venue', label: tr('st.invVenue') }]}
                  value={invType} onChange={v => setInvType(v as 'warehouse' | 'venue')} t={t}
                />
              </div>

              {invType === 'warehouse' && (
                <div>
                  <button
                    onClick={openInv}
                    style={{
                      width: '100%', padding: '16px', borderRadius: 16,
                      background: t.orange, color: '#fff', border: 'none',
                      fontFamily: 'inherit', fontSize: 16, fontWeight: 700,
                      cursor: 'pointer', marginBottom: 20,
                      boxShadow: `0 4px 16px ${t.orange}44`,
                    }}>
                    {tr('st.startInv')}
                  </button>

                  {inventories.filter(inv => inv.items && inv.items.length > 0).length === 0 ? (
                    <div style={{ padding: '40px 20px', textAlign: 'center', color: t.text3 }}>
                      <div style={{ fontSize: 14, color: t.text3 }}>{tr('st.invEmpty')}</div>
                    </div>
                  ) : inventories.filter(inv => inv.items && inv.items.length > 0).map((inv, bi) => {
                    const isExpanded = expandedInv === inv.id
                    const diffs = (inv.items || []).filter((it: any) => it.diff_g !== 0)
                    const totalDiff = diffs.reduce((s: number, it: any) => s + it.diff_g, 0)
                    const isFirst = bi === 0
                    return (
                      <div key={inv.id} style={{ background: t.surface, borderRadius: 16, overflow: 'hidden', marginBottom: 10, boxShadow: t.sh }}>
                        <div
                          onClick={() => setExpandedInv(isExpanded ? null : inv.id)}
                          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px', cursor: 'pointer', borderBottom: isExpanded ? `0.5px solid ${t.sep2}` : 'none' }}
                        >
                          <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                              <div style={{ fontSize: 16, color: t.text, fontWeight: 600 }}>{tr('st.discrepCount', { n: diffs.length })}</div>
                              {isFirst && <span style={{ fontSize: 11, color: t.blue, background: `${t.blue}18`, padding: '3px 8px', borderRadius: 8, fontWeight: 600 }}>{tr('st.last')}</span>}
                            </div>
                            <div style={{ fontSize: 13, color: t.text3 }}>{timeStr(inv.created_at, locale)}</div>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div style={{ fontSize: 16, fontWeight: 700, color: totalDiff >= 0 ? t.green : t.red }}>
                              {totalDiff >= 0 ? '+' : ''}{fg(Math.abs(totalDiff))}
                            </div>
                            <svg width="16" height="16" fill="none" stroke={t.text3} strokeWidth="2" viewBox="0 0 24 24" style={{ transform: isExpanded ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }}>
                              <path d="M6 9l6 6 6-6" />
                            </svg>
                          </div>
                        </div>
                        {isExpanded && diffs.map((it: any, i: number) => (
                          <div key={i} style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                            padding: '12px 16px 12px 28px',
                            borderBottom: i < diffs.length - 1 ? `0.5px solid ${t.sep2}` : 'none',
                            background: t.dark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.01)',
                          }}>
                            <div>
                              <div style={{ fontSize: 15, color: t.text2 }}>{it.brand} · {it.flavor}</div>
                              <div style={{ fontSize: 12, color: t.text3, marginTop: 2 }}>{fg(it.expected_g)} → {fg(it.actual_g)}</div>
                            </div>
                            <div style={{ fontSize: 15, fontWeight: 700, color: it.diff_g >= 0 ? t.green : t.red }}>
                              {it.diff_g >= 0 ? '+' : ''}{fg(Math.abs(it.diff_g))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )
                  })}
                </div>
              )}

              {invType === 'venue' && (
                <div>
                  <div style={{ background: `${t.blue}14`, borderRadius: 16, padding: '20px', textAlign: 'center', marginBottom: 14, border: `1px solid ${t.blue}22` }}>
                    <div style={{ fontSize: 16, fontWeight: 600, color: t.blue, marginBottom: 6 }}>{tr('st.venueInvTitle')}</div>
                    <div style={{ fontSize: 14, color: t.text3 }}>{tr('st.soon')}</div>
                  </div>
                  <div style={{ background: t.surface, borderRadius: 16, padding: '20px', boxShadow: t.sh }}>
                    <div style={{ fontSize: 12, color: t.text3, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>{tr('st.issuedTotal')}</div>
                    <div style={{ fontSize: 32, fontWeight: 700, color: t.text, letterSpacing: -0.5 }}>
                      {fg(movements.filter(m => m.type === 'out').reduce((s, m) => s + m.quantity_g, 0))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── NAV: standalone — фикс-бар снизу; embedded — сегмент-строка над контентом ── */}
      <div style={embedded ? {
        order: 1, display: 'flex', gap: 2, background: t.fill, borderRadius: 12, padding: 3, marginBottom: 16,
        maxWidth: contentMaxWidth, width: '100%', alignSelf: 'center', boxSizing: 'border-box' as const,
      } : {
        position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 300,
        height: 82, background: t.nbg,
        backdropFilter: 'saturate(200%) blur(24px)',
        WebkitBackdropFilter: 'saturate(200%) blur(24px)',
        borderTop: `0.5px solid ${t.sep2}`,
        display: 'flex', alignItems: 'flex-start', paddingTop: 10,
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
      }}>
        {NAV_TABS.map(navTab => {
          const active = tab === navTab.id
          if (embedded) return (
            <button key={navTab.id} onClick={() => setTab(navTab.id as any)} style={{ flex: 1, padding: '8px 0', borderRadius: 10, border: 'none', fontFamily: 'inherit', fontSize: 13, fontWeight: active ? 700 : 500, cursor: 'pointer', background: active ? t.surface : 'transparent', color: active ? t.orange : t.text3, boxShadow: active ? t.sh2 : 'none', transition: 'all .18s' }}>
              {navTab.label}
            </button>
          )
          return (
            <button
              key={navTab.id}
              onClick={() => setTab(navTab.id as any)}
              style={{
                flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
                cursor: 'pointer', color: active ? t.orange : t.text3,
                border: 'none', background: 'none', fontFamily: 'inherit',
                padding: 0, fontSize: 10, fontWeight: active ? 700 : 500,
                transition: 'color .18s',
              }}>
              <span style={{ transform: active ? 'scale(1.08)' : 'scale(1)', transition: 'transform .18s ease', display: 'flex' }}>
                {navTab.icon(active)}
              </span>
              {navTab.label}
            </button>
          )
        })}
      </div>

      {/* ── ADD/EDIT MOVEMENT MODAL ── */}
      {showAddMov && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 500, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
          onClick={() => { setShowAddMov(false); setEditBatch(null) }}
        >
          <div
            style={{ background: t.bg, borderRadius: '24px 24px 0 0', width: '100%', maxWidth: 480, maxHeight: '92vh', overflowY: 'auto' }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ width: 40, height: 4, background: t.fill, borderRadius: 2, margin: '14px auto 0' }} />
            <div style={{ fontSize: 18, fontWeight: 700, textAlign: 'center', padding: '14px 20px 0', color: t.text }}>
              {editBatch ? tr('st.edit') : tr('st.newRecord')}
            </div>

            <div style={{ padding: '12px 16px 4px' }}>
              <div style={{ marginBottom: 16 }}>
                <Segmented
                  options={[{ id: 'in', label: tr('st.movIn') }, { id: 'out', label: tr('st.movOut') }, { id: 'writeoff', label: tr('st.movWriteoff') }]}
                  value={movMode}
                  onChange={v => { setMovMode(v as any); if (!editBatch) setMovRows([newRow()]); if (v !== 'writeoff') setWriteoffVenue(false) }}
                  t={t}
                />
              </div>
              {/* Списание: со склада (бренд/вкус) или с заведения (только вес общего объёма зала) — паритет с iOS (H2). */}
              {movMode === 'writeoff' && (
                <div style={{ marginBottom: 16 }}>
                  <Segmented
                    options={[{ id: 'warehouse', label: tr('st.fromWarehouse') }, { id: 'venue', label: tr('st.fromVenue') }]}
                    value={writeoffVenue ? 'venue' : 'warehouse'}
                    onChange={v => setWriteoffVenue(v === 'venue')}
                    t={t}
                  />
                </div>
              )}
            </div>

            <div style={{ padding: '4px 16px 36px' }}>
              {movMode === 'writeoff' && (
                <input
                  value={movReason} onChange={e => setMovReason(e.target.value)}
                  placeholder={tr('st.writeoffReasonPh')}
                  style={{ width: '100%', padding: '12px 14px', borderRadius: 12, border: `1px solid ${movReason.trim() ? t.sep2 : t.red}`, fontSize: 16, color: t.text, background: t.surface, fontFamily: 'inherit', outline: 'none', marginBottom: 12 }}
                />
              )}
              {movMode === 'writeoff' && writeoffVenue ? (
                <div style={{ background: t.surface, borderRadius: 16, padding: '14px', boxShadow: t.sh2 }}>
                  <div style={{ fontSize: 12, color: t.text3, marginBottom: 8 }}>{tr('st.venueWriteoffHint')}</div>
                  <input
                    value={venueGrams}
                    onChange={e => setVenueGrams(e.target.value.replace(/[^\d]/g, ''))}
                    placeholder={tr('st.gramsPh')}
                    type="number" min={1} max={venueAvailable}
                    style={{ width: '100%', padding: '12px 14px', borderRadius: 12, border: `1px solid ${t.sep2}`, fontSize: 16, color: t.text, background: t.bg, fontFamily: 'inherit', outline: 'none', marginBottom: 10 }}
                  />
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 12, color: t.text3 }}>{tr('st.venueAvailable')}</span>
                    <span style={{ fontSize: 13, fontWeight: 600, color: t.text2 }}>{fg(Math.round(venueAvailable))}</span>
                  </div>
                </div>
              ) : movRows.map((row) => {
                const brandsForMode = movMode !== 'in' ? outBrands : allBrands
                const flavors = flavorsForBrand(row.brand, movMode !== 'in')
                const maxQty = movMode !== 'in' ? stock.find(s => s.brand === row.brand && s.flavor === row.flavor)?.quantity_g : undefined
                return (
                  <div key={row.id} style={{ background: t.surface, borderRadius: 16, padding: '14px', marginBottom: 10, boxShadow: t.sh2 }}>
                    <div style={{ display: 'flex', gap: 10, marginBottom: 10, alignItems: 'center' }}>
                      <AutoInput value={row.brand} onChange={v => updateMovRow(row.id, 'brand', v)} suggestions={brandsForMode} placeholder={tr('st.brandPh')} t={t} />
                      {movRows.length > 1 && (
                        <button onClick={() => removeMovRow(row.id)} style={{ width: 34, height: 34, borderRadius: '50%', background: `${t.red}18`, border: 'none', color: t.red, fontSize: 18, cursor: 'pointer', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 10 }}>
                      <AutoInput
                        value={row.flavor}
                        onChange={v => updateMovRow(row.id, 'flavor', v)}
                        suggestions={flavors.length > 0 ? flavors : (row.brand ? [] : allFlavors)}
                        placeholder={tr('st.flavorPh')}
                        disabled={movMode !== 'in' && !row.brand}
                        t={t}
                      />
                      <input
                        value={row.quantity_g}
                        onChange={e => updateMovRow(row.id, 'quantity_g', e.target.value)}
                        placeholder={tr('st.gramsPh')}
                        type="number" min={1} max={maxQty}
                        style={{
                          width: 80, padding: '12px 10px', borderRadius: 12,
                          border: `1px solid ${t.sep2}`, fontSize: 16,
                          color: t.text, background: t.surface,
                          fontFamily: 'inherit', outline: 'none', flexShrink: 0, textAlign: 'center',
                        }}
                      />
                    </div>
                    {maxQty !== undefined && row.flavor && (
                      <div style={{ fontSize: 12, color: t.text3, marginTop: 8 }}>{tr('st.available')}: {fg(maxQty)}</div>
                    )}
                  </div>
                )
              })}

              {!(movMode === 'writeoff' && writeoffVenue) && (
                <button
                  onClick={() => setMovRows(r => [...r, newRow()])}
                  style={{
                    width: '100%', padding: '13px', borderRadius: 14,
                    background: t.fill, border: 'none', fontFamily: 'inherit',
                    fontSize: 15, fontWeight: 600, cursor: 'pointer', color: t.text, marginBottom: 12,
                  }}>
                  {tr('st.addPosition')}
                </button>
              )}

              <button
                onClick={() => { if (movMode === 'writeoff' && writeoffVenue) saveVenueWriteoff(); else saveMov() }} disabled={saving}
                style={{
                  width: '100%', padding: '16px', borderRadius: 16,
                  background: saving ? t.fill : t.orange, color: saving ? t.text3 : '#fff',
                  border: 'none', fontFamily: 'inherit', fontSize: 16, fontWeight: 700, cursor: 'pointer',
                  boxShadow: saving ? 'none' : `0 4px 16px ${t.orange}44`,
                  transition: 'all .18s',
                }}>
                {saving ? tr('st.savingFull') : editBatch ? tr('st.saveChanges') : movMode === 'in' ? tr('st.saveSupply') : movMode === 'out' ? tr('st.saveIssue') : tr('st.writeoffBtn')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── INVENTORY MODAL ── */}
      {showInv && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 500, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
          onClick={() => setShowInv(false)}
        >
          <div
            style={{ background: t.bg, borderRadius: '24px 24px 0 0', width: '100%', maxWidth: 480, maxHeight: '92vh', overflowY: 'auto' }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ width: 40, height: 4, background: t.fill, borderRadius: 2, margin: '14px auto 0' }} />
            <div style={{ fontSize: 18, fontWeight: 700, textAlign: 'center', padding: '14px 20px 4px', color: t.text }}>{tr('st.invStockTitle')}</div>
            <div style={{ fontSize: 14, color: t.text3, textAlign: 'center', paddingBottom: 16 }}>{tr('st.enterActual')}</div>

            <div style={{ padding: '0 16px 36px' }}>
              {invRows.map((row, i) => {
                const actual = row.actual_g !== '' ? parseFloat(row.actual_g) : null
                const diff = actual !== null ? actual - row.expected_g : null
                const hasDiff = diff !== null && diff !== 0
                return (
                  <div key={i} style={{
                    background: t.surface, borderRadius: 16, padding: '14px', marginBottom: 10,
                    boxShadow: t.sh2,
                    border: hasDiff ? `1px solid ${diff! > 0 ? t.green : t.red}44` : `1px solid transparent`,
                    transition: 'border-color .2s',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                      <div>
                        <div style={{ fontSize: 16, color: t.text, fontWeight: 600 }}>{row.brand}</div>
                        <div style={{ fontSize: 13, color: t.text3, marginTop: 2 }}>{row.flavor}</div>
                      </div>
                      <div style={{ fontSize: 13, color: t.text3, background: t.fill2, padding: '4px 10px', borderRadius: 8 }}>
                        {fg(row.expected_g)}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                      <input
                        value={row.actual_g}
                        onChange={e => { const r = [...invRows]; r[i] = { ...r[i], actual_g: e.target.value }; setInvRows(r) }}
                        placeholder={tr('st.actualPh')}
                        type="number" min={0}
                        style={{
                          flex: 1, padding: '12px 14px', borderRadius: 12,
                          border: `1px solid ${hasDiff ? (diff! > 0 ? t.green : t.red) : t.sep2}`,
                          fontSize: 16, color: t.text, background: t.surface,
                          fontFamily: 'inherit', outline: 'none',
                          transition: 'border-color .2s',
                        }}
                      />
                      {hasDiff && (
                        <div style={{ fontSize: 15, fontWeight: 700, color: diff! > 0 ? t.green : t.red, minWidth: 60, textAlign: 'right' }}>
                          {diff! > 0 ? '+' : ''}{fg(Math.abs(diff!))}
                        </div>
                      )}
                      {diff === 0 && row.actual_g !== '' && (
                        <div style={{ color: t.green, minWidth: 60, textAlign: 'right' }}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg></div>
                      )}
                    </div>
                  </div>
                )
              })}

              <button
                onClick={saveInv} disabled={saving}
                style={{
                  width: '100%', padding: '16px', borderRadius: 16,
                  background: saving ? t.fill : t.orange, color: saving ? t.text3 : '#fff',
                  border: 'none', fontFamily: 'inherit', fontSize: 16, fontWeight: 700,
                  cursor: 'pointer', marginTop: 8,
                  boxShadow: saving ? 'none' : `0 4px 16px ${t.orange}44`,
                }}>
                {saving ? tr('st.savingFull') : tr('st.saveInv')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── TOAST ── */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 100, left: '50%',
          transform: 'translateX(-50%)',
          background: t.dark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.85)',
          backdropFilter: 'blur(16px)',
          color: '#fff', padding: '12px 22px', borderRadius: 22,
          fontSize: 14, fontWeight: 600, zIndex: 600,
          whiteSpace: 'nowrap', animation: 'toastIn .25s ease',
          border: `1px solid ${t.dark ? 'rgba(255,255,255,0.1)' : 'transparent'}`,
        }}>
          {toast}
        </div>
      )}
    </div>
  )
}
