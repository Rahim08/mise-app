'use client'
export const dynamic = 'force-dynamic'
import React, { useEffect, useState, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { db } from '@/lib/db'
import { Segmented } from '@/components/Segmented'
import { useTheme } from '@/hooks/useTheme'
import { AuthGate } from '@/components/AuthGate'

// ── HELPERS ───────────────────────────────────────────────────────────────────

function fg(g: number) {
  if (!g) return '0 г'
  return g >= 1000 ? `${(g / 1000).toFixed(2).replace('.', ',')} кг` : `${g} г`
}
function timeStr(iso: string) {
  return new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(',', ' ')
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
// Кальянщик отмечает, сколько кальянов каждого вкуса сделано за день.
// Хранится в hookah_sales (строка = вкус × количество за дату), цена/порция —
// в restaurant_settings (дашборд → Настройки → Кальян).

function fmtDay(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function HookahShiftTab({ restaurantId, stock, t, toast }: { restaurantId: string; stock: StockItem[]; t: ReturnType<typeof useTheme>; toast: (m: string) => void }) {
  const today = fmtDay(new Date())
  const [counts, setCounts] = useState<Record<string, number>>({}) // stock.id → кол-во кальянов
  const [settings, setSettings] = useState<{ hookah_price: number; hookah_portion_g: number } | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')

  useEffect(() => {
    Promise.all([
      db.from('hookah_sales').select('*').eq('date', today),
      db.from('restaurant_settings').select('*').limit(1),
    ]).then(([{ data: rows }, { data: rs }]: any[]) => {
      const c: Record<string, number> = {}
      ;(rows || []).forEach((r: any) => {
        const item = stock.find(s => s.id === r.flavor_id) || stock.find(s => s.brand === r.brand && s.flavor === r.flavor)
        if (item) c[item.id] = (c[item.id] || 0) + (r.quantity || 0)
      })
      setCounts(c)
      const row = Array.isArray(rs) ? rs[0] : rs
      setSettings({ hookah_price: Number(row?.hookah_price || 0), hookah_portion_g: Number(row?.hookah_portion_g || 20) })
      setLoading(false)
    })
  }, [])

  const inc = (id: string, d: number) => setCounts(c => ({ ...c, [id]: Math.max(0, (c[id] || 0) + d) }))

  const totalCount = Object.values(counts).reduce((s, n) => s + n, 0)
  const price = settings?.hookah_price || 0
  const portion = settings?.hookah_portion_g || 20

  const save = async () => {
    setSaving(true)
    // Перезаписываем день целиком: удалить сегодняшние строки, вставить актуальные.
    await db.from('hookah_sales').delete().eq('date', today)
    const rows = stock.filter(s => (counts[s.id] || 0) > 0).map(s => ({
      flavor_id: s.id, brand: s.brand, flavor: s.flavor,
      quantity: counts[s.id], price, date: today,
    }))
    if (rows.length) {
      const { error } = await db.from('hookah_sales').insert(rows)
      if (error) { toast('Ошибка: ' + error.message); setSaving(false); return }
    }
    setSaving(false)
    toast(`Смена сохранена · ${totalCount} кальянов`)
  }

  if (loading) return <div style={{ textAlign: 'center', padding: 40, color: t.text3 }}>Загрузка...</div>

  const list = stock.filter(s => `${s.brand} ${s.flavor}`.toLowerCase().includes(search.toLowerCase()))

  return (
    <div>
      {/* Итог дня */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 14 }}>
        {[
          { l: 'Кальянов', v: String(totalCount), c: t.orange },
          { l: 'Выручка', v: `€${(totalCount * price).toLocaleString('de-DE')}`, c: t.green },
          { l: 'Табака', v: `${(totalCount * portion).toLocaleString('de-DE')} г`, c: t.blue },
        ].map(it => (
          <div key={it.l} style={{ background: t.surface, borderRadius: 14, padding: '12px 10px', boxShadow: t.sh, textAlign: 'center' }}>
            <div style={{ fontSize: 17, fontWeight: 800, color: it.c }}>{it.v}</div>
            <div style={{ fontSize: 10, color: t.text3, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4, marginTop: 3 }}>{it.l}</div>
          </div>
        ))}
      </div>
      {price === 0 && (
        <div style={{ background: `${t.orange}14`, borderRadius: 12, padding: '10px 14px', marginBottom: 12, fontSize: 13, color: t.orange }}>
          Цена кальяна не задана — владелец указывает её в дашборде → Настройки → Кальян
        </div>
      )}

      <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Поиск вкуса..."
        style={{ width: '100%', padding: '12px 14px', borderRadius: 14, border: `1px solid ${t.sep2}`, fontSize: 16, color: t.text, background: t.surface, fontFamily: 'inherit', outline: 'none', marginBottom: 12, boxShadow: t.sh }} />

      {list.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px 20px', color: t.text3 }}>Нет вкусов — добавьте приход на склад</div>
      ) : (
        <div style={{ background: t.surface, borderRadius: 16, overflow: 'hidden', boxShadow: t.sh, marginBottom: 14 }}>
          {list.map((s, i) => {
            const n = counts[s.id] || 0
            return (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px', borderBottom: i < list.length - 1 ? `0.5px solid ${t.sep2}` : 'none', background: n > 0 ? `${t.orange}0a` : 'transparent' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: t.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.flavor}</div>
                  <div style={{ fontSize: 11, color: t.text3, marginTop: 1 }}>{s.brand}</div>
                </div>
                <button onClick={() => inc(s.id, -1)} disabled={n === 0} style={{ width: 32, height: 32, borderRadius: '50%', border: 'none', background: t.fill, color: n === 0 ? t.text4 : t.text, cursor: n === 0 ? 'default' : 'pointer', fontSize: 18, fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>−</button>
                <span style={{ minWidth: 26, textAlign: 'center', fontSize: 16, fontWeight: 800, color: n > 0 ? t.orange : t.text4 }}>{n}</span>
                <button onClick={() => inc(s.id, 1)} style={{ width: 32, height: 32, borderRadius: '50%', border: 'none', background: t.orange, color: '#fff', cursor: 'pointer', fontSize: 18, fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>+</button>
              </div>
            )
          })}
        </div>
      )}

      <button onClick={save} disabled={saving} style={{ width: '100%', padding: '15px', borderRadius: 16, background: t.orange, color: '#fff', border: 'none', fontFamily: 'inherit', fontSize: 15, fontWeight: 700, cursor: 'pointer', boxShadow: `0 4px 16px ${t.orange}44` }}>
        {saving ? 'Сохраняем...' : 'Сохранить смену'}
      </button>
    </div>
  )
}

export default function StashApp() {
  const t = useTheme()

  const [restaurantId, setRestaurantId] = useState('')
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
  const [showAddMov, setShowAddMov] = useState(false)
  const [showInv, setShowInv] = useState(false)
  const [movRows, setMovRows] = useState<MovRow[]>([newRow()])
  const [invRows, setInvRows] = useState<InvRow[]>([])
  const [saving, setSaving] = useState(false)
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
  }, [restaurantId])

  const loadAll = async (rid: string) => {
    setLoading(true)
    const [s1, s2, s3] = await Promise.all([
      db.from('tobacco_stock').select('*').eq('restaurant_id', rid).order('brand').order('flavor'),
      db.from('tobacco_movements').select('*').eq('restaurant_id', rid).order('created_at', { ascending: false }).limit(200),
      db.from('tobacco_inventories').select('*').eq('restaurant_id', rid).order('created_at', { ascending: false }).limit(50),
    ])
    setStock(s1.data || [])
    setMovements(s2.data || [])
    setInventories(s3.data || [])
    setLoading(false)
  }

  const showToastMsg = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 2500) }

  const allBrands = [...new Set(stock.map(s => s.brand))].filter(Boolean).sort()
  const allFlavors = [...new Set(stock.map(s => s.flavor))].filter(Boolean).sort()
  const outBrands = [...new Set(stock.filter(s => s.quantity_g > 0).map(s => s.brand))].sort()
  const inStockItems = stock.filter(s => s.quantity_g > 0)
  const emptyItems = stock.filter(s => s.quantity_g <= 0)
  const filteredStock = inStockItems.filter(s => `${s.brand} ${s.flavor}`.toLowerCase().includes(search.toLowerCase()))
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
    const filled = movRows.filter(r => r.brand && r.flavor && parseFloat(r.quantity_g) > 0)
    if (!filled.length) { showToastMsg('Добавьте хотя бы одну позицию'); return }
    for (const r of filled) {
      const qty = parseFloat(r.quantity_g)
      if (movMode !== 'in') {
        const item = stock.find(s => s.brand === r.brand && s.flavor === r.flavor)
        if (!item) { showToastMsg(`${r.brand} · ${r.flavor} не найден`); return }
        if (qty > item.quantity_g) { showToastMsg(`${r.brand} · ${r.flavor}: только ${fg(item.quantity_g)}`); return }
      }
    }
    if (movMode === 'writeoff' && !movReason.trim()) { showToastMsg('Укажите причину списания'); return }
    setSaving(true)
    const batchId = editBatch || crypto.randomUUID()
    if (editBatch) {
      const oldMovs = movements.filter(m => m.batch_id === editBatch)
      for (const m of oldMovs) {
        const item = stock.find(s => s.brand === m.brand && s.flavor === m.flavor)
        if (item) {
          const revert = m.type === 'in' ? -m.quantity_g : m.quantity_g
          await db.from('tobacco_stock').update({ quantity_g: item.quantity_g + revert }).eq('id', item.id)
        }
      }
      await db.from('tobacco_movements').delete().eq('batch_id', editBatch)
    }
    const { data: freshStock } = await db.from('tobacco_stock').select('*').eq('restaurant_id', restaurantId)
    const currentStock: StockItem[] = freshStock || []
    for (const r of filled) {
      const qty = parseFloat(r.quantity_g)
      const existing = currentStock.find(s => s.brand === r.brand && s.flavor === r.flavor)
      const reason = movReason.trim() || (movMode === 'in' ? 'Поставка' : movMode === 'out' ? 'Выдача в зал' : 'Списание')
      await db.from('tobacco_movements').insert({ restaurant_id: restaurantId, brand: r.brand, flavor: r.flavor, quantity_g: qty, type: movMode, batch_id: batchId, reason, flavor_id: existing?.id || null })
      if (existing) {
        const delta = movMode === 'in' ? qty : -qty
        await db.from('tobacco_stock').update({ quantity_g: existing.quantity_g + delta, updated_at: new Date().toISOString() }).eq('id', existing.id)
      } else if (movMode === 'in') {
        await db.from('tobacco_stock').insert({ restaurant_id: restaurantId, brand: r.brand, flavor: r.flavor, quantity_g: qty, flavor_name: r.flavor, updated_at: new Date().toISOString() })
      }
    }
    await loadAll(restaurantId)
    setMovRows([newRow()]); setMovReason(''); setShowAddMov(false); setEditBatch(null); setSaving(false)
    showToastMsg(`Сохранено (${filled.length} поз.)`)
  }

  const openEdit = (batchId: string, items: Movement[]) => {
    setEditBatch(batchId)
    setMovMode(items[0].type as any)
    setMovReason((items[0] as any).reason && items[0].type === 'writeoff' ? (items[0] as any).reason : '')
    setMovRows([...items.map(m => ({ id: m.id, brand: m.brand, flavor: m.flavor, quantity_g: String(m.quantity_g) }))])
    setShowAddMov(true)
  }

  const openInv = () => {
    setInvRows(stock.filter(s => s.quantity_g > 0).map(s => ({ brand: s.brand, flavor: s.flavor, expected_g: s.quantity_g, actual_g: '' })))
    setShowInv(true)
  }

  const saveInv = async () => {
    const filled = invRows.filter(r => r.actual_g !== '' && parseFloat(r.actual_g) !== r.expected_g)
    if (!filled.length) { showToastMsg('Нет расхождений — всё совпадает'); return }
    setSaving(true)
    const items = filled.map(r => ({ brand: r.brand, flavor: r.flavor, expected_g: r.expected_g, actual_g: parseFloat(r.actual_g), diff_g: parseFloat(r.actual_g) - r.expected_g }))
    await db.from('tobacco_inventories').insert({ restaurant_id: restaurantId, type: 'warehouse', items })
    for (const r of filled) {
      const item = stock.find(s => s.brand === r.brand && s.flavor === r.flavor)
      if (item) await db.from('tobacco_stock').update({ quantity_g: parseFloat(r.actual_g), updated_at: new Date().toISOString() }).eq('id', item.id)
    }
    await loadAll(restaurantId)
    setSaving(false); setShowInv(false)
    showToastMsg(`Инвентаризация сохранена. Расхождений: ${filled.length}`)
  }

  const groupedMovements = () => {
    const filtered = movements.filter(m => m.type === movMode)
    const batches: Record<string, Movement[]> = {}
    filtered.forEach(m => { const key = m.batch_id || m.id; if (!batches[key]) batches[key] = []; batches[key].push(m) })
    return Object.entries(batches).sort((a, b) => new Date(b[1][0].created_at).getTime() - new Date(a[1][0].created_at).getTime())
  }

  if (!restaurantId) return <AuthGate appId="stash" appName="Mise Stash" onAuth={setRestaurantId} />

  if (!mounted || loading) return (
    <div style={{ minHeight: '100vh', background: t.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 16 }}>
      <IconStash color={t.orange} />
      <div style={{ width: 24, height: 24, border: `2.5px solid ${t.fill}`, borderTopColor: t.orange, borderRadius: '50%', animation: 'spin .7s linear infinite' }} />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}} @keyframes fadeUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}} @keyframes toastIn{from{opacity:0;transform:translateX(-50%) translateY(10px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}`}</style>
    </div>
  )

  const batches = groupedMovements()

  const NAV_TABS = [
    {
      id: 'shift', label: 'Смена',
      icon: (active: boolean) => (
        <svg fill="none" stroke="currentColor" strokeWidth={active ? 2.2 : 1.8} viewBox="0 0 24 24" width="26" height="26">
          <path d="M8 8c0-2.5 3-4 3-6" strokeLinecap="round" /><path d="M12 8c0-2.5 3-4 3-6" strokeLinecap="round" /><path d="M16 8c0-2.5 3-4 3-6" strokeLinecap="round" />
          <path d="M5 14h14" strokeLinecap="round" /><path d="M5 17c1 1.5 2 2 3.5 2s2.5-1 4-1 2.5 1 4 1 2.5-.5 3.5-2" strokeLinecap="round" />
        </svg>
      )
    },
    {
      id: 'stock', label: 'Наличие',
      icon: (active: boolean) => (
        <svg fill="none" stroke="currentColor" strokeWidth={active ? 2.2 : 1.8} viewBox="0 0 24 24" width="26" height="26">
          <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
          <polyline points="9 22 9 12 15 12 15 22" />
        </svg>
      )
    },
    {
      id: 'movements', label: 'Движения',
      icon: (active: boolean) => (
        <svg fill="none" stroke="currentColor" strokeWidth={active ? 2.2 : 1.8} viewBox="0 0 24 24" width="26" height="26">
          <path d="M17 1l4 4-4 4" /><path d="M3 11V9a4 4 0 014-4h14" />
          <path d="M7 23l-4-4 4-4" /><path d="M21 13v2a4 4 0 01-4 4H3" />
        </svg>
      )
    },
    {
      id: 'inventory', label: 'Инвентарь',
      icon: (active: boolean) => (
        <svg fill="none" stroke="currentColor" strokeWidth={active ? 2.2 : 1.8} viewBox="0 0 24 24" width="26" height="26">
          <path d="M9 11l3 3L22 4" />
          <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
        </svg>
      )
    },
  ]

  return (
    <div style={{ height: '100vh', overflow: 'hidden', background: t.bg, fontFamily: "-apple-system,BlinkMacSystemFont,'SF Pro Text',sans-serif", WebkitFontSmoothing: 'antialiased' }}>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg) } }
        @keyframes fadeUp { from { opacity:0; transform:translateY(10px) } to { opacity:1; transform:translateY(0) } }
        @keyframes toastIn { from { opacity:0; transform:translateX(-50%) translateY(10px) } to { opacity:1; transform:translateX(-50%) translateY(0) } }
        * { box-sizing: border-box }
        input[type=number]::-webkit-inner-spin-button { -webkit-appearance:none }
      `}</style>

      {/* ── HEADER ── */}
      <div style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 300,
        height: 56, background: t.hbg,
        backdropFilter: 'saturate(200%) blur(24px)',
        WebkitBackdropFilter: 'saturate(200%) blur(24px)',
        borderBottom: `0.5px solid ${t.sep2}`,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
            <span style={{ fontWeight: 800, fontSize: 18, color: t.orange, letterSpacing: -0.8, fontFamily: '-apple-system,BlinkMacSystemFont,sans-serif' }}>mise</span>
            <span style={{ fontWeight: 400, fontSize: 17, color: t.text, letterSpacing: -0.3 }}>Stash</span>
          </div>
        </div>
        <button
          onClick={() => { setEditBatch(null); setMovRows([newRow()]); setMovReason(''); setShowAddMov(true) }}
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
          Добавить
        </button>
      </div>

      {/* ── CONTENT ── */}
      <div style={{ position: 'fixed', top: 56, left: 0, right: 0, bottom: 82, overflowY: 'auto', background: t.bg }}>
        <div style={{ padding: '16px 16px 28px', maxWidth: 860, margin: '0 auto', animation: 'fadeUp .22s ease' }}>

          {/* ══ HOOKAH SHIFT ══ */}
          {tab === 'shift' && !loading && (
            <HookahShiftTab restaurantId={restaurantId} stock={inStockItems} t={t} toast={showToastMsg} />
          )}

          {/* ══ STOCK ══ */}
          {tab === 'stock' && (
            <div>
              {/* Search row */}
              <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
                <div style={{ position: 'relative', flex: 1 }}>
                  <input
                    value={search} onChange={e => setSearch(e.target.value)}
                    placeholder="Поиск бренда или вкуса..."
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
                    <button onClick={() => setSearch('')} style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: t.fill, border: 'none', borderRadius: '50%', width: 20, height: 20, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: t.text3, fontSize: 12 }}>✕</button>
                  )}
                </div>
                {emptyItems.length > 0 && (
                  <button
                    onClick={() => setShowEmpty(!showEmpty)}
                    style={{
                      padding: '0 16px', borderRadius: 14, flexShrink: 0,
                      background: showEmpty ? t.red : `${t.red}18`,
                      border: 'none', color: showEmpty ? '#fff' : t.red,
                      fontSize: 13, fontWeight: 600, cursor: 'pointer',
                      fontFamily: 'inherit', boxShadow: t.sh,
                    }}>
                    {emptyItems.length} пусто
                  </button>
                )}
              </div>

              {/* Stats */}
              <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
                <StatCard label="Позиций" value={String(stock.length)} color={t.text} t={t} />
                <StatCard label="В наличии" value={String(inStockItems.length)} color={t.green} t={t} />
                <StatCard label="Мало" value={String(inStockItems.filter(s => s.quantity_g <= 200).length)} color={t.orange} t={t} />
              </div>

              {/* Stock list */}
              {filteredStock.length === 0 ? (
                <div style={{ padding: '60px 20px', textAlign: 'center', color: t.text3 }}>
                  <div style={{ fontSize: 44, marginBottom: 12, opacity: 0.3 }}>📦</div>
                  <div style={{ fontSize: 16, fontWeight: 600, color: t.text2, marginBottom: 6 }}>{search ? 'Ничего не найдено' : 'Склад пуст'}</div>
                  <div style={{ fontSize: 14, color: t.text3 }}>{search ? 'Попробуйте другой запрос' : 'Добавьте первую поставку'}</div>
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
                        const low = item.quantity_g <= 200
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
                  <div style={{ fontSize: 13, fontWeight: 700, color: t.red, textTransform: 'uppercase', letterSpacing: 0.6, padding: '14px 4px 8px' }}>Нет в наличии</div>
                  <div style={{ background: t.surface, borderRadius: 16, overflow: 'hidden', boxShadow: t.sh }}>
                    {emptyItems.map((item, i) => (
                      <div key={item.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 16px', borderBottom: i < emptyItems.length - 1 ? `0.5px solid ${t.sep2}` : 'none' }}>
                        <div>
                          <div style={{ fontSize: 16, color: t.text3 }}>{item.flavor}</div>
                          <div style={{ fontSize: 12, color: t.text4, marginTop: 2 }}>{item.brand}</div>
                        </div>
                        <div style={{ fontSize: 13, color: t.red, fontWeight: 600, background: `${t.red}18`, padding: '4px 10px', borderRadius: 8 }}>0 г</div>
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
                  options={[{ id: 'in', label: 'Поставка' }, { id: 'out', label: 'Выдача' }, { id: 'writeoff', label: 'Списание' }]}
                  value={movMode} onChange={v => setMovMode(v as any)} t={t}
                />
              </div>
              {batches.length === 0 ? (
                <div style={{ padding: '60px 20px', textAlign: 'center', color: t.text3 }}>
                  <div style={{ fontSize: 44, marginBottom: 12, opacity: 0.3 }}>{movMode === 'in' ? '📥' : movMode === 'out' ? '📤' : '🗑️'}</div>
                  <div style={{ fontSize: 16, fontWeight: 600, color: t.text2, marginBottom: 6 }}>{movMode === 'in' ? 'Поставок пока нет' : movMode === 'out' ? 'Выдач пока нет' : 'Списаний пока нет'}</div>
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
                            {items.length} {items.length === 1 ? 'позиция' : items.length < 5 ? 'позиции' : 'позиций'}
                          </div>
                          {isFirst && (
                            <span style={{ fontSize: 11, color: t.blue, background: `${t.blue}18`, padding: '3px 8px', borderRadius: 8, fontWeight: 600 }}>Последняя</span>
                          )}
                        </div>
                        <div style={{ fontSize: 13, color: t.text3 }}>{timeStr(items[0].created_at)}</div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ fontSize: 17, fontWeight: 700, color }}>
                          {movMode === 'in' ? '+' : '−'}{fg(total)}
                        </div>
                        {isFirst && (
                          <button
                            onClick={e => { e.stopPropagation(); openEdit(batchId, items) }}
                            style={{ padding: '6px 12px', borderRadius: 10, background: t.fill, border: 'none', fontSize: 13, color: t.text, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>
                            Изменить
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
                        <div style={{ fontSize: 15, color: t.text2 }}>{item.brand} · {item.flavor}</div>
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
                  options={[{ id: 'warehouse', label: 'Склад' }, { id: 'venue', label: 'Заведение' }]}
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
                    Начать инвентаризацию
                  </button>

                  {inventories.filter(inv => inv.items && inv.items.length > 0).length === 0 ? (
                    <div style={{ padding: '40px 20px', textAlign: 'center', color: t.text3 }}>
                      <div style={{ fontSize: 14, color: t.text3 }}>Инвентаризаций пока нет</div>
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
                              <div style={{ fontSize: 16, color: t.text, fontWeight: 600 }}>{diffs.length} расхождений</div>
                              {isFirst && <span style={{ fontSize: 11, color: t.blue, background: `${t.blue}18`, padding: '3px 8px', borderRadius: 8, fontWeight: 600 }}>Последняя</span>}
                            </div>
                            <div style={{ fontSize: 13, color: t.text3 }}>{timeStr(inv.created_at)}</div>
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
                    <div style={{ fontSize: 16, fontWeight: 600, color: t.blue, marginBottom: 6 }}>Инвентаризация заведения</div>
                    <div style={{ fontSize: 14, color: t.text3 }}>Будет доступно в следующих обновлениях</div>
                  </div>
                  <div style={{ background: t.surface, borderRadius: 16, padding: '20px', boxShadow: t.sh }}>
                    <div style={{ fontSize: 12, color: t.text3, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>Выдано в зал всего</div>
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

      {/* ── BOTTOM NAV ── */}
      <div style={{
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
              {editBatch ? 'Редактировать' : 'Новая запись'}
            </div>

            <div style={{ padding: '12px 16px 4px' }}>
              <div style={{ marginBottom: 16 }}>
                <Segmented
                  options={[{ id: 'in', label: 'Поставка' }, { id: 'out', label: 'Выдача' }, { id: 'writeoff', label: 'Списание' }]}
                  value={movMode}
                  onChange={v => { setMovMode(v as any); if (!editBatch) setMovRows([newRow()]) }}
                  t={t}
                />
              </div>
            </div>

            <div style={{ padding: '4px 16px 36px' }}>
              {movMode === 'writeoff' && (
                <input
                  value={movReason} onChange={e => setMovReason(e.target.value)}
                  placeholder="Причина списания (бой, просрочка, брак...)"
                  style={{ width: '100%', padding: '12px 14px', borderRadius: 12, border: `1px solid ${movReason.trim() ? t.sep2 : t.red}`, fontSize: 16, color: t.text, background: t.surface, fontFamily: 'inherit', outline: 'none', marginBottom: 12 }}
                />
              )}
              {movRows.map((row) => {
                const brandsForMode = movMode !== 'in' ? outBrands : allBrands
                const flavors = flavorsForBrand(row.brand, movMode !== 'in')
                const maxQty = movMode !== 'in' ? stock.find(s => s.brand === row.brand && s.flavor === row.flavor)?.quantity_g : undefined
                return (
                  <div key={row.id} style={{ background: t.surface, borderRadius: 16, padding: '14px', marginBottom: 10, boxShadow: t.sh2 }}>
                    <div style={{ display: 'flex', gap: 10, marginBottom: 10, alignItems: 'center' }}>
                      <AutoInput value={row.brand} onChange={v => updateMovRow(row.id, 'brand', v)} suggestions={brandsForMode} placeholder="Бренд" t={t} />
                      {movRows.length > 1 && (
                        <button onClick={() => removeMovRow(row.id)} style={{ width: 34, height: 34, borderRadius: '50%', background: `${t.red}18`, border: 'none', color: t.red, fontSize: 18, cursor: 'pointer', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 10 }}>
                      <AutoInput
                        value={row.flavor}
                        onChange={v => updateMovRow(row.id, 'flavor', v)}
                        suggestions={flavors.length > 0 ? flavors : (row.brand ? [] : allFlavors)}
                        placeholder="Вкус"
                        disabled={movMode !== 'in' && !row.brand}
                        t={t}
                      />
                      <input
                        value={row.quantity_g}
                        onChange={e => updateMovRow(row.id, 'quantity_g', e.target.value)}
                        placeholder="г"
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
                      <div style={{ fontSize: 12, color: t.text3, marginTop: 8 }}>Доступно: {fg(maxQty)}</div>
                    )}
                  </div>
                )
              })}

              <button
                onClick={() => setMovRows(r => [...r, newRow()])}
                style={{
                  width: '100%', padding: '13px', borderRadius: 14,
                  background: t.fill, border: 'none', fontFamily: 'inherit',
                  fontSize: 15, fontWeight: 600, cursor: 'pointer', color: t.text, marginBottom: 12,
                }}>
                + Добавить позицию
              </button>

              <button
                onClick={saveMov} disabled={saving}
                style={{
                  width: '100%', padding: '16px', borderRadius: 16,
                  background: saving ? t.fill : t.orange, color: saving ? t.text3 : '#fff',
                  border: 'none', fontFamily: 'inherit', fontSize: 16, fontWeight: 700, cursor: 'pointer',
                  boxShadow: saving ? 'none' : `0 4px 16px ${t.orange}44`,
                  transition: 'all .18s',
                }}>
                {saving ? 'Сохранение...' : editBatch ? 'Сохранить изменения' : movMode === 'in' ? 'Сохранить поставку' : movMode === 'out' ? 'Сохранить выдачу' : 'Списать'}
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
            <div style={{ fontSize: 18, fontWeight: 700, textAlign: 'center', padding: '14px 20px 4px', color: t.text }}>Инвентаризация склада</div>
            <div style={{ fontSize: 14, color: t.text3, textAlign: 'center', paddingBottom: 16 }}>Введите фактический вес</div>

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
                        placeholder="Фактически (г)"
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
                        <div style={{ fontSize: 20, color: t.green, minWidth: 60, textAlign: 'right' }}>✓</div>
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
                {saving ? 'Сохранение...' : 'Сохранить инвентаризацию'}
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
