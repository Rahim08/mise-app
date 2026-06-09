'use client'
export const dynamic = 'force-dynamic'
import React, { useEffect, useState, useRef } from 'react'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

function fg(g: number) { return g >= 1000 ? `${(g/1000).toFixed(2).replace('.',',')} кг` : `${g} г` }

// AutoInput with suggestions dropdown
function AutoInput({ value, onChange, suggestions, placeholder, disabled }: {
  value: string; onChange: (v: string) => void; suggestions: string[]; placeholder: string; disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [filtered, setFiltered] = useState<string[]>([])
  const ref = useRef<HTMLDivElement>(null)
  const text = '#1c1c1e'
  const t3 = '#6d6d72'
  const b2 = 'rgba(60,60,67,.07)'

  useEffect(() => {
    if (!value) { setFiltered([]); setOpen(false); return }
    const f = [...new Set(suggestions)].filter(s => s.toLowerCase().includes(value.toLowerCase()) && s.toLowerCase() !== value.toLowerCase())
    setFiltered(f.slice(0, 8)); setOpen(f.length > 0)
  }, [value, suggestions])

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h)
  }, [])

  return (
    <div ref={ref} style={{ position: 'relative', flex: 1 }}>
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid rgba(60,60,67,.2)', fontSize: 15, color: text, background: disabled ? 'rgba(60,60,67,.05)' : '#fff', fontFamily: 'inherit', outline: 'none' }}
      />
      {open && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff', borderRadius: 12, boxShadow: '0 4px 20px rgba(0,0,0,.15)', zIndex: 100, marginTop: 4, overflow: 'hidden' }}>
          {filtered.map(s => (
            <div key={s} onMouseDown={() => { onChange(s); setOpen(false) }}
              style={{ padding: '11px 14px', fontSize: 15, color: text, borderBottom: `1px solid ${b2}`, cursor: 'pointer' }}>
              {s}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

interface StockItem { id: string; brand: string; flavor: string; quantity_g: number }
interface Movement { id: string; brand: string; flavor: string; quantity_g: number; type: string; reason: string; created_at: string }
interface MovRow { brand: string; flavor: string; quantity_g: string }

export default function TobaccoApp() {
  const [restaurantId, setRestaurantId] = useState('')
  const [tab, setTab] = useState<'stock'|'movements'|'inventory'>('stock')
  const [movMode, setMovMode] = useState<'in'|'out'>('in')
  const [stock, setStock] = useState<StockItem[]>([])
  const [movements, setMovements] = useState<Movement[]>([])
  const [loading, setLoading] = useState(true)
  const [mounted, setMounted] = useState(false)
  const [search, setSearch] = useState('')
  const [showAddMov, setShowAddMov] = useState(false)
  const [movRows, setMovRows] = useState<MovRow[]>([{ brand:'', flavor:'', quantity_g:'' }])
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState('')
  const [invInput, setInvInput] = useState<Record<string, string>>({})

  useEffect(() => {
    setMounted(true)
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) { window.location.href = '/auth/login'; return }
      const { data: profile } = await supabase.from('profiles').select('restaurant_id').eq('id', data.user.id).single()
      if (!profile) return
      setRestaurantId(profile.restaurant_id)
      await loadAll(profile.restaurant_id)
    })
  }, [])

  const loadAll = async (rid: string) => {
    setLoading(true)
    const [s1, s2] = await Promise.all([
      supabase.from('tobacco_stock').select('*').eq('restaurant_id', rid).order('brand').order('flavor'),
      supabase.from('tobacco_movements').select('*').eq('restaurant_id', rid).order('created_at', { ascending: false }).limit(100)
    ])
    setStock(s1.data || [])
    setMovements(s2.data || [])
    setLoading(false)
  }

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 2500) }

  const allBrands = [...new Set(stock.map(s => s.brand))].sort()
  const flavorsForBrand = (brand: string) => stock.filter(s => s.brand === brand).map(s => s.flavor).sort()

  const filteredStock = stock.filter(s =>
    `${s.brand} ${s.flavor}`.toLowerCase().includes(search.toLowerCase())
  )

  const updateMovRow = (i: number, field: keyof MovRow, val: string) => {
    const rows = [...movRows]
    rows[i] = { ...rows[i], [field]: val }
    if (field === 'brand') rows[i].flavor = ''
    // auto-add new row when last row has brand+flavor+qty filled
    if (i === rows.length - 1 && rows[i].brand && rows[i].flavor && rows[i].quantity_g) {
      rows.push({ brand: '', flavor: '', quantity_g: '' })
    }
    setMovRows(rows)
  }

  const removeMovRow = (i: number) => {
    if (movRows.length === 1) return
    setMovRows(movRows.filter((_, idx) => idx !== i))
  }

  const validateMovRows = () => {
    const filled = movRows.filter(r => r.brand || r.flavor || r.quantity_g)
    if (!filled.length) return 'Добавьте хотя бы одну позицию'
    for (const r of filled) {
      if (!r.brand) return 'Укажите бренд'
      if (!r.flavor) return 'Укажите вкус'
      const qty = parseFloat(r.quantity_g)
      if (!qty || qty <= 0) return 'Укажите количество > 0'
      if (movMode === 'out') {
        const item = stock.find(s => s.brand === r.brand && s.flavor === r.flavor)
        if (!item) return `${r.brand} ${r.flavor} не найден на складе`
        if (qty > item.quantity_g) return `${r.brand} ${r.flavor}: недостаточно (есть ${fg(item.quantity_g)})`
      }
    }
    return null
  }

  const saveMov = async () => {
    const err = validateMovRows()
    if (err) { showToast(err); return }
    setSaving(true)
    const filled = movRows.filter(r => r.brand && r.flavor && parseFloat(r.quantity_g) > 0)
    for (const r of filled) {
      const qty = parseFloat(r.quantity_g)
      const existing = stock.find(s => s.brand === r.brand && s.flavor === r.flavor)
      // save movement
      await supabase.from('tobacco_movements').insert({
        restaurant_id: restaurantId,
        brand: r.brand,
        flavor: r.flavor,
        quantity_g: qty,
        type: movMode,
        reason: movMode === 'in' ? 'Поставка' : 'Выдача в заведение',
        flavor_id: existing?.id || null
      })
      // update stock
      if (existing) {
        const newQty = movMode === 'in' ? existing.quantity_g + qty : existing.quantity_g - qty
        await supabase.from('tobacco_stock').update({ quantity_g: newQty, updated_at: new Date().toISOString() }).eq('id', existing.id)
      } else if (movMode === 'in') {
        await supabase.from('tobacco_stock').insert({
          restaurant_id: restaurantId,
          brand: r.brand,
          flavor: r.flavor,
          quantity_g: qty,
          updated_at: new Date().toISOString()
        })
      }
    }
    await loadAll(restaurantId)
    setMovRows([{ brand:'', flavor:'', quantity_g:'' }])
    setShowAddMov(false)
    setSaving(false)
    showToast(movMode === 'in' ? '✓ Поставка сохранена' : '✓ Выдача сохранена')
  }

  const bg = '#f2f2f7'
  const surface = '#fff'
  const text = '#1c1c1e'
  const t3 = '#6d6d72'
  const t4 = '#aeaeb2'
  const border = 'rgba(60,60,67,.13)'
  const b2 = 'rgba(60,60,67,.07)'
  const s2 = 'rgba(118,118,128,.12)'
  const sh = '0 1px 3px rgba(0,0,0,.08),0 4px 16px rgba(0,0,0,.05)'
  const hbg = 'rgba(242,242,247,.95)'
  const nbg = 'rgba(248,248,252,.97)'

  if (!mounted || loading) return (
    <div style={{ minHeight:'100vh', background:bg, display:'flex', alignItems:'center', justifyContent:'center' }}>
      <div style={{ width:28, height:28, border:'2.5px solid rgba(118,118,128,.2)', borderTopColor:'#007aff', borderRadius:'50%', animation:'spin .7s linear infinite' }} />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )

  const filtMovements = movements.filter(m => m.type === movMode)

  return (
    <div style={{ height:'100vh', overflow:'hidden', background:bg, fontFamily:"-apple-system,BlinkMacSystemFont,'SF Pro Text',sans-serif", WebkitFontSmoothing:'antialiased' }}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}} @keyframes fadeUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}} @keyframes toastIn{from{opacity:0;transform:translateX(-50%) translateY(8px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}`}</style>

      {/* Header */}
      <div style={{ position:'fixed', top:0, left:0, right:0, zIndex:300, height:56, background:hbg, backdropFilter:'saturate(180%) blur(20px)', borderBottom:`1px solid ${border}`, display:'flex', alignItems:'center', justifyContent:'space-between', padding:'0 16px' }}>
        <div style={{ fontWeight:700, fontSize:'1rem', color:text }}>SO Tobacco</div>
        {tab === 'movements' && (
          <button onClick={() => setShowAddMov(true)} style={{ display:'flex', alignItems:'center', gap:5, background:'rgba(0,122,255,.1)', borderRadius:20, padding:'7px 14px', cursor:'pointer', fontSize:15, fontWeight:600, color:'#007aff', border:'none', fontFamily:'inherit' }}>
            + Добавить
          </button>
        )}
      </div>

      {/* Content */}
      <div style={{ position:'fixed', top:56, left:0, right:0, bottom:80, overflowY:'auto', background:bg }}>
        <div style={{ padding:'16px 16px 28px', maxWidth:860, margin:'0 auto', animation:'fadeUp .22s ease' }}>

          {/* STOCK TAB */}
          {tab === 'stock' && (
            <div>
              {/* Search */}
              <div style={{ position:'relative', marginBottom:16 }}>
                <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Поиск по бренду или вкусу..."
                  style={{ width:'100%', padding:'11px 14px 11px 40px', borderRadius:14, border:`1px solid ${border}`, fontSize:15, color:text, background:surface, fontFamily:'inherit', outline:'none', boxShadow:sh }} />
                <svg style={{ position:'absolute', left:13, top:'50%', transform:'translateY(-50%)' }} width="18" height="18" fill="none" stroke={t4} strokeWidth="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
              </div>

              {/* Stats */}
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:10, marginBottom:16 }}>
                {[
                  { l:'Позиций', v:String(stock.length), c:text },
                  { l:'В наличии', v:String(stock.filter(s=>s.quantity_g>0).length), c:'#34c759' },
                  { l:'Заканчивается', v:String(stock.filter(s=>s.quantity_g>0&&s.quantity_g<=200).length), c:'#ff9500' },
                ].map(item => (
                  <div key={item.l} style={{ background:surface, borderRadius:14, padding:'12px', boxShadow:sh }}>
                    <div style={{ fontSize:10, color:t3, fontWeight:600, textTransform:'uppercase' as const, letterSpacing:.4, marginBottom:5 }}>{item.l}</div>
                    <div style={{ fontSize:22, fontWeight:700, color:item.c }}>{item.v}</div>
                  </div>
                ))}
              </div>

              {/* Stock list grouped by brand */}
              {filteredStock.length === 0
                ? <div style={{ padding:'48px 20px', textAlign:'center' as const, color:t4 }}>
                    {search ? 'Ничего не найдено' : 'Склад пуст — добавьте поставку'}
                  </div>
                : (() => {
                    const grouped: Record<string, StockItem[]> = {}
                    filteredStock.forEach(s => { if (!grouped[s.brand]) grouped[s.brand] = []; grouped[s.brand].push(s) })
                    return Object.entries(grouped).map(([brand, items]) => (
                      <div key={brand}>
                        <div style={{ fontSize:12, fontWeight:600, color:t3, textTransform:'uppercase' as const, letterSpacing:.5, padding:'12px 4px 8px' }}>{brand}</div>
                        <div style={{ background:surface, borderRadius:16, overflow:'hidden', marginBottom:12, boxShadow:sh }}>
                          {items.map((item, i) => {
                            const low = item.quantity_g > 0 && item.quantity_g <= 200
                            const empty = item.quantity_g <= 0
                            return (
                              <div key={item.id} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'13px 16px', borderBottom:i<items.length-1?`1px solid ${b2}`:'none' }}>
                                <div style={{ flex:1, minWidth:0 }}>
                                  <div style={{ fontSize:15, color:empty?t4:text, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' as const }}>{item.flavor}</div>
                                  {low && !empty && <div style={{ fontSize:11, color:'#ff9500', marginTop:2, fontWeight:500 }}>⚠ Заканчивается</div>}
                                  {empty && <div style={{ fontSize:11, color:'#ff3b30', marginTop:2, fontWeight:500 }}>✗ Нет в наличии</div>}
                                </div>
                                <div style={{ fontSize:16, fontWeight:700, color:empty?t4:low?'#ff9500':'#007aff', paddingLeft:12, whiteSpace:'nowrap' as const }}>
                                  {fg(item.quantity_g)}
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    ))
                  })()
              }
            </div>
          )}

          {/* MOVEMENTS TAB */}
          {tab === 'movements' && (
            <div>
              {/* Toggle in/out */}
              <div style={{ display:'flex', background:s2, borderRadius:10, padding:2, marginBottom:16 }}>
                {(['in','out'] as const).map(m => (
                  <button key={m} onClick={() => setMovMode(m)} style={{ flex:1, padding:7, borderRadius:8, border:'none', fontFamily:'inherit', fontSize:13, fontWeight:movMode===m?600:500, cursor:'pointer', background:movMode===m?surface:'transparent', color:movMode===m?text:t3, boxShadow:movMode===m?'0 1px 3px rgba(0,0,0,.1)':'none', transition:'all .15s' }}>
                    {m==='in' ? '📦 Поставка' : '🏪 Выдача в зал'}
                  </button>
                ))}
              </div>

              {filtMovements.length === 0
                ? <div style={{ padding:'48px 20px', textAlign:'center' as const, color:t4 }}>
                    {movMode==='in' ? 'Поставок пока нет' : 'Выдач пока нет'}
                  </div>
                : <div style={{ background:surface, borderRadius:16, overflow:'hidden', boxShadow:sh }}>
                    {filtMovements.map((m, i) => (
                      <div key={m.id} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'12px 16px', borderBottom:i<filtMovements.length-1?`1px solid ${b2}`:'none' }}>
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ fontSize:15, color:text, fontWeight:500 }}>{m.brand} · {m.flavor}</div>
                          <div style={{ fontSize:11, color:t4, marginTop:2 }}>
                            {new Date(m.created_at).toLocaleString('ru-RU', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }).replace(',',' ')}
                          </div>
                        </div>
                        <div style={{ fontSize:16, fontWeight:700, color:movMode==='in'?'#34c759':'#ff9500', paddingLeft:12, whiteSpace:'nowrap' as const }}>
                          {movMode==='in'?'+':'-'}{fg(m.quantity_g)}
                        </div>
                      </div>
                    ))}
                  </div>
              }
            </div>
          )}

          {/* INVENTORY TAB */}
          {tab === 'inventory' && (
            <div>
              <div style={{ background:'rgba(0,122,255,.08)', borderRadius:14, padding:'12px 16px', marginBottom:16 }}>
                <div style={{ fontSize:13, color:'#007aff', fontWeight:500 }}>Общий вес рассчитывается автоматически по движениям (поставки минус выдачи)</div>
              </div>
              <div style={{ background:surface, borderRadius:16, overflow:'hidden', boxShadow:sh }}>
                {stock.filter(s=>s.quantity_g>0).length === 0
                  ? <div style={{ padding:'32px', textAlign:'center' as const, color:t4 }}>Нет данных</div>
                  : stock.filter(s=>s.quantity_g>0).map((item, i, arr) => (
                      <div key={item.id} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'13px 16px', borderBottom:i<arr.length-1?`1px solid ${b2}`:'none' }}>
                        <div>
                          <div style={{ fontSize:15, color:text }}>{item.brand} · {item.flavor}</div>
                        </div>
                        <div style={{ fontSize:16, fontWeight:700, color:'#007aff' }}>{fg(item.quantity_g)}</div>
                      </div>
                    ))
                }
              </div>
              {stock.filter(s=>s.quantity_g>0).length > 0 && (
                <div style={{ background:surface, borderRadius:14, padding:'14px 16px', marginTop:12, boxShadow:sh, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                  <div style={{ fontSize:13, color:t3, fontWeight:600, textTransform:'uppercase' as const }}>Итого</div>
                  <div style={{ fontSize:20, fontWeight:700, color:text }}>{fg(stock.reduce((s,i)=>s+i.quantity_g, 0))}</div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Bottom Nav */}
      <div style={{ position:'fixed', bottom:0, left:0, right:0, zIndex:300, height:80, background:nbg, backdropFilter:'saturate(180%) blur(20px)', borderTop:`1px solid ${border}`, display:'flex', alignItems:'flex-start', paddingTop:10 }}>
        {[
          { id:'stock', label:'Наличие', icon:<svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24" width="26" height="26"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg> },
          { id:'movements', label:'Движения', icon:<svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24" width="26" height="26"><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 014-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 01-4 4H3"/></svg> },
          { id:'inventory', label:'Инвентарь', icon:<svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24" width="26" height="26"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg> },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id as any)} style={{ flex:1, display:'flex', flexDirection:'column' as const, alignItems:'center', gap:3, cursor:'pointer', color:tab===t.id?'#007aff':t4, border:'none', background:'none', fontFamily:'inherit', padding:0, fontSize:10, fontWeight:600, transition:'color .18s' }}>
            <span style={{ transform:tab===t.id?'scale(1.1)':'scale(1)', transition:'transform .18s', display:'flex' }}>{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>

      {/* Add Movement Modal */}
      {showAddMov && (
        <div style={{ position:'fixed', inset:0, zIndex:500, background:'rgba(0,0,0,.4)', backdropFilter:'blur(4px)', display:'flex', alignItems:'flex-end', justifyContent:'center' }} onClick={() => setShowAddMov(false)}>
          <div style={{ background:'#f2f2f7', borderRadius:'22px 22px 0 0', width:'100%', maxWidth:480, maxHeight:'90vh', overflowY:'auto' }} onClick={e=>e.stopPropagation()}>
            <div style={{ width:36, height:4, background:s2, borderRadius:2, margin:'12px auto 0' }} />
            <div style={{ fontSize:17, fontWeight:700, textAlign:'center' as const, padding:'13px 20px 0', color:text }}>
              {movMode==='in' ? 'Поставка табака' : 'Выдача в зал'}
            </div>

            {/* Mode toggle inside modal */}
            <div style={{ display:'flex', background:s2, borderRadius:10, padding:2, margin:'12px 16px 0' }}>
              {(['in','out'] as const).map(m => (
                <button key={m} onClick={() => { setMovMode(m); setMovRows([{ brand:'', flavor:'', quantity_g:'' }]) }} style={{ flex:1, padding:7, borderRadius:8, border:'none', fontFamily:'inherit', fontSize:13, fontWeight:movMode===m?600:500, cursor:'pointer', background:movMode===m?surface:'transparent', color:movMode===m?text:t3, transition:'all .15s' }}>
                  {m==='in' ? 'Поставка' : 'Выдача в зал'}
                </button>
              ))}
            </div>

            <div style={{ padding:'12px 16px 32px' }}>
              {movRows.map((row, i) => {
                const isLast = i === movRows.length - 1
                const brandFlavors = movMode === 'out'
                  ? stock.filter(s => s.brand === row.brand && s.quantity_g > 0).map(s => s.flavor)
                  : flavorsForBrand(row.brand)
                const maxQty = movMode === 'out' ? stock.find(s => s.brand === row.brand && s.flavor === row.flavor)?.quantity_g : undefined

                return (
                  <div key={i} style={{ background:surface, borderRadius:14, padding:'12px', marginBottom:8, boxShadow:'0 1px 3px rgba(0,0,0,.06)' }}>
                    <div style={{ display:'flex', gap:8, marginBottom:8 }}>
                      <AutoInput
                        value={row.brand}
                        onChange={v => updateMovRow(i, 'brand', v)}
                        suggestions={movMode==='out' ? allBrands.filter(b => stock.some(s=>s.brand===b&&s.quantity_g>0)) : allBrands}
                        placeholder="Бренд"
                      />
                      {movRows.length > 1 && (
                        <button onClick={() => removeMovRow(i)} style={{ width:36, height:36, borderRadius:'50%', background:'rgba(255,59,48,.1)', border:'none', color:'#ff3b30', fontSize:18, cursor:'pointer', flexShrink:0, alignSelf:'center' }}>×</button>
                      )}
                    </div>
                    <div style={{ display:'flex', gap:8 }}>
                      <AutoInput
                        value={row.flavor}
                        onChange={v => updateMovRow(i, 'flavor', v)}
                        suggestions={brandFlavors}
                        placeholder="Вкус"
                        disabled={movMode==='out' && !row.brand}
                      />
                      <input
                        value={row.quantity_g}
                        onChange={e => updateMovRow(i, 'quantity_g', e.target.value)}
                        placeholder="г"
                        type="number"
                        min={1}
                        max={maxQty}
                        style={{ width:80, padding:'10px 12px', borderRadius:10, border:'1px solid rgba(60,60,67,.2)', fontSize:15, color:text, background:'#fff', fontFamily:'inherit', outline:'none', flexShrink:0 }}
                      />
                    </div>
                    {maxQty !== undefined && row.flavor && (
                      <div style={{ fontSize:11, color:t3, marginTop:6 }}>Доступно: {fg(maxQty)}</div>
                    )}
                  </div>
                )
              })}

              <button onClick={saveMov} disabled={saving} style={{ width:'100%', padding:'14px', borderRadius:14, background:'#007aff', color:'#fff', border:'none', fontFamily:'inherit', fontSize:16, fontWeight:700, cursor:'pointer', marginTop:8 }}>
                {saving ? 'Сохранение...' : movMode==='in' ? 'Сохранить поставку' : 'Сохранить выдачу'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div style={{ position:'fixed', bottom:100, left:'50%', transform:'translateX(-50%)', background:'rgba(30,30,30,.92)', color:'#fff', padding:'10px 20px', borderRadius:20, fontSize:14, fontWeight:500, zIndex:600, whiteSpace:'nowrap' as const, animation:'toastIn .25s ease' }}>
          {toast}
        </div>
      )}
    </div>
  )
}
