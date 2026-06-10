'use client'
export const dynamic = 'force-dynamic'
import React, { useEffect, useState, useRef } from 'react'
import { supabase } from '@/lib/supabase'



function fg(g: number) {
  if (!g) return '0 г'
  return g >= 1000 ? `${(g/1000).toFixed(2).replace('.',',')} кг` : `${g} г`
}
function timeStr(iso: string) {
  return new Date(iso).toLocaleString('ru-RU', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }).replace(',',' ')
}

function AutoInput({ value, onChange, suggestions, placeholder, disabled }: {
  value: string; onChange: (v: string) => void; suggestions: string[]; placeholder: string; disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const filtered = [...new Set(suggestions)].filter(s => !value.trim() || s.toLowerCase().includes(value.toLowerCase())).slice(0,8)

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h)
  }, [])

  return (
    <div ref={ref} style={{ position:'relative', flex:1 }}>
      <input value={value} onChange={e => { onChange(e.target.value); setOpen(true) }} onFocus={() => setOpen(true)}
        placeholder={placeholder} disabled={disabled}
        style={{ width:'100%', padding:'11px 12px', borderRadius:10, border:'1px solid rgba(60,60,67,.2)', fontSize:15, color:'#1c1c1e', background:disabled?'rgba(60,60,67,.05)':'#fff', fontFamily:'inherit', outline:'none' }} />
      {open && filtered.length > 0 && (
        <div style={{ position:'absolute', top:'100%', left:0, right:0, background:'#fff', borderRadius:12, boxShadow:'0 4px 24px rgba(0,0,0,.18)', zIndex:300, marginTop:4, overflow:'hidden', maxHeight:220, overflowY:'auto' }}>
          {filtered.map(s => (
            <div key={s} onMouseDown={e => { e.preventDefault(); onChange(s); setOpen(false) }}
              style={{ padding:'12px 14px', fontSize:15, color:'#1c1c1e', borderBottom:'1px solid rgba(60,60,67,.07)', cursor:'pointer' }}>{s}</div>
          ))}
        </div>
      )}
    </div>
  )
}

interface StockItem { id: string; brand: string; flavor: string; quantity_g: number }
interface Movement { id: string; brand: string; flavor: string; quantity_g: number; type: string; batch_id: string; created_at: string }
interface Inventory { id: string; created_at: string; items: any[] }
interface MovRow { id: string; brand: string; flavor: string; quantity_g: string }
interface InvRow { brand: string; flavor: string; expected_g: number; actual_g: string }

const newRow = (): MovRow => ({ id: Math.random().toString(36).slice(2), brand:'', flavor:'', quantity_g:'' })

export default function StashApp() {
  const [restaurantId, setRestaurantId] = useState('')
  const [tab, setTab] = useState<'stock'|'movements'|'inventory'>('stock')
  const [movMode, setMovMode] = useState<'in'|'out'>('in')
  const [invType, setInvType] = useState<'warehouse'|'venue'>('warehouse')
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
  const [expandedBatch, setExpandedBatch] = useState<string|null>(null)
  const [expandedInv, setExpandedInv] = useState<string|null>(null)
  const [editBatch, setEditBatch] = useState<string|null>(null)

  useEffect(() => {
    setMounted(true)
    const storedRestaurantId = localStorage.getItem('mise_restaurant_id')
    supabase.auth.getUser().then(async ({ data }) => {
      let rid = ''
      if (data.user) {
        const { data: profile } = await supabase.from('profiles').select('restaurant_id').eq('id', data.user.id).single()
        rid = profile?.restaurant_id || storedRestaurantId || ''
      } else if (storedRestaurantId) {
        rid = storedRestaurantId
      } else {
        window.location.href = '/join?error=no_session'
        return
      }
      if (!rid) { window.location.href = '/join?error=no_session'; return }
      setRestaurantId(rid)

      // Subscription gate
      const { data: restData } = await supabase
        .from('restaurants').select('subscription_status').eq('id', rid).single()
      if (restData?.subscription_status !== 'active' && restData?.subscription_status !== 'trialing') {
        window.location.href = '/dashboard?tab=billing'; return
      }

      await loadAll(rid)
    })
  }, [])

  const loadAll = async (rid: string) => {
    setLoading(true)
    const [s1, s2, s3] = await Promise.all([
      supabase.from('tobacco_stock').select('*').eq('restaurant_id', rid).order('brand').order('flavor'),
      supabase.from('tobacco_movements').select('*').eq('restaurant_id', rid).order('created_at', { ascending: false }).limit(200),
      supabase.from('tobacco_inventories').select('*').eq('restaurant_id', rid).order('created_at', { ascending: false }).limit(50)
    ])
    setStock(s1.data || [])
    setMovements(s2.data || [])
    setInventories(s3.data || [])
    setLoading(false)
  }

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 2500) }

  // All brands/flavors including out-of-stock (for autocomplete)
  const allBrands = [...new Set(stock.map(s => s.brand))].filter(Boolean).sort()
  const allFlavors = [...new Set(stock.map(s => s.flavor))].filter(Boolean).sort()
  const outBrands = [...new Set(stock.filter(s=>s.quantity_g>0).map(s=>s.brand))].sort()

  const inStockItems = stock.filter(s => s.quantity_g > 0)
  const emptyItems = stock.filter(s => s.quantity_g <= 0)
  const filteredStock = inStockItems.filter(s => `${s.brand} ${s.flavor}`.toLowerCase().includes(search.toLowerCase()))

  // Brand total weight
  const brandTotal = (brand: string) => stock.filter(s=>s.brand===brand&&s.quantity_g>0).reduce((sum,s)=>sum+s.quantity_g,0)

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
    if (outOnly) return stock.filter(s=>s.brand===brand&&s.quantity_g>0).map(s=>s.flavor).sort()
    return stock.filter(s=>s.brand===brand).map(s=>s.flavor).sort()
  }

  const saveMov = async () => {
    const filled = movRows.filter(r => r.brand && r.flavor && parseFloat(r.quantity_g) > 0)
    if (!filled.length) { showToast('Добавьте хотя бы одну позицию'); return }
    for (const r of filled) {
      const qty = parseFloat(r.quantity_g)
      if (movMode === 'out') {
        const item = stock.find(s => s.brand === r.brand && s.flavor === r.flavor)
        if (!item) { showToast(`${r.brand} · ${r.flavor} не найден`); return }
        if (qty > item.quantity_g) { showToast(`${r.brand} · ${r.flavor}: только ${fg(item.quantity_g)}`); return }
      }
    }
    setSaving(true)
    const batchId = editBatch || crypto.randomUUID()
    if (editBatch) {
      // Revert old movements effect on stock
      const oldMovs = movements.filter(m => m.batch_id === editBatch)
      for (const m of oldMovs) {
        const item = stock.find(s => s.brand === m.brand && s.flavor === m.flavor)
        if (item) {
          const revert = m.type === 'in' ? -m.quantity_g : m.quantity_g
          await supabase.from('tobacco_stock').update({ quantity_g: item.quantity_g + revert }).eq('id', item.id)
        }
      }
      await supabase.from('tobacco_movements').delete().eq('batch_id', editBatch)
    }
    // Reload stock after revert
    const { data: freshStock } = await supabase.from('tobacco_stock').select('*').eq('restaurant_id', restaurantId)
    const currentStock: StockItem[] = freshStock || []

    for (const r of filled) {
      const qty = parseFloat(r.quantity_g)
      const existing = currentStock.find(s => s.brand === r.brand && s.flavor === r.flavor)
      await supabase.from('tobacco_movements').insert({ restaurant_id:restaurantId, brand:r.brand, flavor:r.flavor, quantity_g:qty, type:movMode, batch_id:batchId, reason:movMode==='in'?'Поставка':'Выдача в зал', flavor_id:existing?.id||null })
      if (existing) {
        const delta = movMode==='in' ? qty : -qty
        await supabase.from('tobacco_stock').update({ quantity_g: existing.quantity_g + delta, updated_at:new Date().toISOString() }).eq('id', existing.id)
      } else if (movMode === 'in') {
        await supabase.from('tobacco_stock').insert({ restaurant_id:restaurantId, brand:r.brand, flavor:r.flavor, quantity_g:qty, flavor_name:r.flavor, updated_at:new Date().toISOString() })
      }
    }
    await loadAll(restaurantId)
    setMovRows([newRow()]); setShowAddMov(false); setEditBatch(null); setSaving(false)
    showToast(`Сохранено (${filled.length} поз.)`)
  }

  const openEdit = (batchId: string, items: Movement[]) => {
    setEditBatch(batchId)
    setMovMode(items[0].type as 'in'|'out')
    setMovRows([...items.map(m => ({ id:m.id, brand:m.brand, flavor:m.flavor, quantity_g:String(m.quantity_g) }))])
    setShowAddMov(true)
  }

  const openInv = () => {
    setInvRows(stock.filter(s=>s.quantity_g>0).map(s => ({ brand:s.brand, flavor:s.flavor, expected_g:s.quantity_g, actual_g:'' })))
    setShowInv(true)
  }

  const saveInv = async () => {
    const filled = invRows.filter(r => r.actual_g !== '' && parseFloat(r.actual_g) !== r.expected_g)
    if (!filled.length) { showToast('Нет расхождений — всё совпадает'); return }
    setSaving(true)
    const items = filled.map(r => ({ brand:r.brand, flavor:r.flavor, expected_g:r.expected_g, actual_g:parseFloat(r.actual_g), diff_g:parseFloat(r.actual_g)-r.expected_g }))
    // Save inventory record
    await supabase.from('tobacco_inventories').insert({ restaurant_id:restaurantId, type:'warehouse', items })
    // Update stock to actual values
    for (const r of filled) {
      const item = stock.find(s => s.brand===r.brand && s.flavor===r.flavor)
      if (item) await supabase.from('tobacco_stock').update({ quantity_g:parseFloat(r.actual_g), updated_at:new Date().toISOString() }).eq('id', item.id)
    }
    await loadAll(restaurantId)
    setSaving(false); setShowInv(false)
    showToast(`Инвентаризация сохранена. Расхождений: ${filled.length}`)
  }

  const groupedMovements = () => {
    const filtered = movements.filter(m => m.type === movMode)
    const batches: Record<string, Movement[]> = {}
    filtered.forEach(m => { const key = m.batch_id||m.id; if (!batches[key]) batches[key]=[]; batches[key].push(m) })
    return Object.entries(batches).sort((a,b) => new Date(b[1][0].created_at).getTime() - new Date(a[1][0].created_at).getTime())
  }

  const bg='#f2f2f7', surface='#fff', text='#1c1c1e', t3='#6d6d72', t4='#aeaeb2'
  const border='rgba(60,60,67,.13)', b2='rgba(60,60,67,.07)', s2='rgba(118,118,128,.12)'
  const sh='0 1px 3px rgba(0,0,0,.08),0 4px 16px rgba(0,0,0,.05)'
  const hbg='rgba(242,242,247,.95)', nbg='rgba(248,248,252,.97)'

  if (!mounted||loading) return (
    <div style={{ minHeight:'100vh', background:bg, display:'flex', alignItems:'center', justifyContent:'center' }}>
      <div style={{ width:28, height:28, border:'2.5px solid rgba(118,118,128,.2)', borderTopColor:'#007aff', borderRadius:'50%', animation:'spin .7s linear infinite' }} />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )

  const batches = groupedMovements()

  return (
    <div style={{ height:'100vh', overflow:'hidden', background:bg, fontFamily:"-apple-system,BlinkMacSystemFont,'SF Pro Text',sans-serif", WebkitFontSmoothing:'antialiased' }}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}} @keyframes fadeUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}} @keyframes toastIn{from{opacity:0;transform:translateX(-50%) translateY(8px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}`}</style>

      {/* Header */}
      <div style={{ position:'fixed', top:0, left:0, right:0, zIndex:300, height:56, background:hbg, backdropFilter:'saturate(180%) blur(20px)', borderBottom:`1px solid ${border}`, display:'flex', alignItems:'center', justifyContent:'space-between', padding:'0 16px' }}>
        <div style={{ fontWeight:700, fontSize:'1rem', color:text }}>Mise Stash</div>
        <button onClick={() => { setEditBatch(null); setMovRows([newRow()]); setShowAddMov(true) }}
          style={{ display:'flex', alignItems:'center', gap:5, background:'rgba(0,122,255,.1)', borderRadius:20, padding:'7px 14px', cursor:'pointer', fontSize:15, fontWeight:600, color:'#007aff', border:'none', fontFamily:'inherit' }}>
          + Добавить
        </button>
      </div>

      {/* Content */}
      <div style={{ position:'fixed', top:56, left:0, right:0, bottom:80, overflowY:'auto', background:bg }}>
        <div style={{ padding:'16px 16px 28px', maxWidth:860, margin:'0 auto', animation:'fadeUp .22s ease' }}>

          {/* STOCK */}
          {tab==='stock' && (
            <div>
              {/* Search + empty button */}
              <div style={{ display:'flex', gap:8, marginBottom:16 }}>
                <div style={{ position:'relative', flex:1 }}>
                  <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Поиск..."
                    style={{ width:'100%', padding:'11px 14px 11px 40px', borderRadius:14, border:`1px solid ${border}`, fontSize:15, color:text, background:surface, fontFamily:'inherit', outline:'none', boxShadow:sh }} />
                  <svg style={{ position:'absolute', left:13, top:'50%', transform:'translateY(-50%)' }} width="18" height="18" fill="none" stroke={t4} strokeWidth="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
                </div>
                {emptyItems.length > 0 && (
                  <button onClick={()=>setShowEmpty(!showEmpty)}
                    style={{ padding:'0 14px', borderRadius:14, background:showEmpty?'#ff3b30':'rgba(255,59,48,.1)', border:'none', color:showEmpty?'#fff':'#ff3b30', fontSize:13, fontWeight:600, cursor:'pointer', fontFamily:'inherit', whiteSpace:'nowrap' as const, boxShadow:sh, flexShrink:0 }}>
                    {emptyItems.length} × 0
                  </button>
                )}
              </div>

              {/* Stats */}
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:10, marginBottom:16 }}>
                {[{l:'Позиций',v:String(stock.length),c:text},{l:'В наличии',v:String(inStockItems.length),c:'#34c759'},{l:'Заканчивается',v:String(inStockItems.filter(s=>s.quantity_g<=200).length),c:'#ff9500'}].map(item=>(
                  <div key={item.l} style={{ background:surface, borderRadius:14, padding:'12px', boxShadow:sh }}>
                    <div style={{ fontSize:10, color:t3, fontWeight:600, textTransform:'uppercase' as const, letterSpacing:.4, marginBottom:5 }}>{item.l}</div>
                    <div style={{ fontSize:22, fontWeight:700, color:item.c }}>{item.v}</div>
                  </div>
                ))}
              </div>

              {/* Stock list grouped by brand */}
              {filteredStock.length===0
                ? <div style={{ padding:'48px 20px', textAlign:'center' as const, color:t4 }}>{search?'Ничего не найдено':'Склад пуст — добавьте поставку'}</div>
                : (() => {
                    const grouped: Record<string,StockItem[]> = {}
                    filteredStock.forEach(s => { if (!grouped[s.brand]) grouped[s.brand]=[]; grouped[s.brand].push(s) })
                    return Object.entries(grouped).map(([brand,items]) => (
                      <div key={brand}>
                        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'12px 4px 8px' }}>
                          <div style={{ fontSize:12, fontWeight:600, color:t3, textTransform:'uppercase' as const, letterSpacing:.5 }}>{brand}</div>
                          <div style={{ fontSize:13, fontWeight:600, color:'#007aff' }}>{fg(brandTotal(brand))}</div>
                        </div>
                        <div style={{ background:surface, borderRadius:16, overflow:'hidden', marginBottom:12, boxShadow:sh }}>
                          {items.map((item,i) => {
                            const low=item.quantity_g<=200
                            return (
                              <div key={item.id} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'13px 16px', borderBottom:i<items.length-1?`1px solid ${b2}`:'none' }}>
                                <div style={{ fontSize:15, color:text }}>{item.flavor}</div>
                                <div style={{ fontSize:15, fontWeight:700, color:low?'#ff9500':'#007aff', paddingLeft:12 }}>{fg(item.quantity_g)}</div>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    ))
                  })()
              }

              {/* Empty items panel */}
              {showEmpty && emptyItems.length > 0 && (
                <div>
                  <div style={{ fontSize:12, fontWeight:600, color:'#ff3b30', textTransform:'uppercase' as const, letterSpacing:.5, padding:'4px 4px 8px' }}>Нет в наличии</div>
                  <div style={{ background:surface, borderRadius:16, overflow:'hidden', marginBottom:12, boxShadow:sh }}>
                    {emptyItems.map((item,i) => (
                      <div key={item.id} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'13px 16px', borderBottom:i<emptyItems.length-1?`1px solid ${b2}`:'none' }}>
                        <div>
                          <div style={{ fontSize:15, color:t4 }}>{item.flavor}</div>
                          <div style={{ fontSize:12, color:t4 }}>{item.brand}</div>
                        </div>
                        <div style={{ fontSize:14, color:'#ff3b30', fontWeight:600 }}>0 г</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* MOVEMENTS */}
          {tab==='movements' && (
            <div>
              <div style={{ display:'flex', background:s2, borderRadius:10, padding:2, marginBottom:16 }}>
                {(['in','out'] as const).map(m=>(
                  <button key={m} onClick={()=>setMovMode(m)} style={{ flex:1, padding:7, borderRadius:8, border:'none', fontFamily:'inherit', fontSize:13, fontWeight:movMode===m?600:500, cursor:'pointer', background:movMode===m?surface:'transparent', color:movMode===m?text:t3, boxShadow:movMode===m?'0 1px 3px rgba(0,0,0,.1)':'none', transition:'all .15s' }}>
                    {m==='in'?'Поставка':'Выдача в зал'}
                  </button>
                ))}
              </div>
              {batches.length===0
                ? <div style={{ padding:'48px 20px', textAlign:'center' as const, color:t4 }}>{movMode==='in'?'Поставок пока нет':'Выдач пока нет'}</div>
                : batches.map(([batchId,items],bi) => {
                    const isExpanded=expandedBatch===batchId
                    const total=items.reduce((s,i)=>s+i.quantity_g,0)
                    const isFirst=bi===0
                    return (
                      <div key={batchId} style={{ background:surface, borderRadius:16, overflow:'hidden', marginBottom:10, boxShadow:sh }}>
                        <div onClick={()=>setExpandedBatch(isExpanded?null:batchId)}
                          style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'14px 16px', cursor:'pointer', borderBottom:isExpanded?`1px solid ${b2}`:'none' }}>
                          <div>
                            <div style={{ fontSize:15, color:text, fontWeight:600, display:'flex', alignItems:'center', gap:8 }}>
                              {items.length} {items.length===1?'позиция':items.length<5?'позиции':'позиций'}
                              {isFirst&&<span style={{ fontSize:11, color:'#007aff', background:'rgba(0,122,255,.1)', padding:'2px 7px', borderRadius:8 }}>Последняя</span>}
                            </div>
                            <div style={{ fontSize:12, color:t4, marginTop:2 }}>{timeStr(items[0].created_at)}</div>
                          </div>
                          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                            <div style={{ fontSize:16, fontWeight:700, color:movMode==='in'?'#34c759':'#ff9500' }}>{movMode==='in'?'+':'-'}{fg(total)}</div>
                            {isFirst&&<button onClick={e=>{e.stopPropagation();openEdit(batchId,items)}} style={{ padding:'5px 10px', borderRadius:8, background:s2, border:'none', fontSize:12, color:text, cursor:'pointer', fontFamily:'inherit', fontWeight:600 }}>Изменить</button>}
                            <svg width="16" height="16" fill="none" stroke={t4} strokeWidth="2" viewBox="0 0 24 24" style={{ transform:isExpanded?'rotate(180deg)':'none', transition:'transform .2s' }}><path d="M6 9l6 6 6-6"/></svg>
                          </div>
                        </div>
                        {isExpanded&&items.map((item,i)=>(
                          <div key={item.id} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'11px 16px 11px 24px', borderBottom:i<items.length-1?`1px solid ${b2}`:'none', background:'rgba(0,0,0,.01)' }}>
                            <div style={{ fontSize:14, color:text }}>{item.brand} · {item.flavor}</div>
                            <div style={{ fontSize:14, fontWeight:600, color:movMode==='in'?'#34c759':'#ff9500' }}>{movMode==='in'?'+':'-'}{fg(item.quantity_g)}</div>
                          </div>
                        ))}
                      </div>
                    )
                  })
              }
            </div>
          )}

          {/* INVENTORY */}
          {tab==='inventory' && (
            <div>
              <div style={{ display:'flex', background:s2, borderRadius:10, padding:2, marginBottom:16 }}>
                {(['warehouse','venue'] as const).map(m=>(
                  <button key={m} onClick={()=>setInvType(m)} style={{ flex:1, padding:7, borderRadius:8, border:'none', fontFamily:'inherit', fontSize:13, fontWeight:invType===m?600:500, cursor:'pointer', background:invType===m?surface:'transparent', color:invType===m?text:t3, boxShadow:invType===m?'0 1px 3px rgba(0,0,0,.1)':'none', transition:'all .15s' }}>
                    {m==='warehouse'?'Склад':'Заведение'}
                  </button>
                ))}
              </div>

              {invType==='warehouse' && (
                <div>
                  <button onClick={openInv} style={{ width:'100%', padding:'14px', borderRadius:14, background:'#007aff', color:'#fff', border:'none', fontFamily:'inherit', fontSize:16, fontWeight:700, cursor:'pointer', marginBottom:16 }}>
                    Начать инвентаризацию
                  </button>

                  {/* Inventory history */}
                  {inventories.filter(inv=>inv.items&&inv.items.length>0).length===0
                    ? <div style={{ padding:'32px', textAlign:'center' as const, color:t4 }}>Инвентаризаций пока нет</div>
                    : inventories.filter(inv=>inv.items&&inv.items.length>0).map((inv,bi) => {
                        const isExpanded=expandedInv===inv.id
                        const diffs = (inv.items||[]).filter((it:any)=>it.diff_g!==0)
                        const totalDiff = diffs.reduce((s:number,it:any)=>s+it.diff_g,0)
                        const isFirst=bi===0
                        return (
                          <div key={inv.id} style={{ background:surface, borderRadius:16, overflow:'hidden', marginBottom:10, boxShadow:sh }}>
                            <div onClick={()=>setExpandedInv(isExpanded?null:inv.id)}
                              style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'14px 16px', cursor:'pointer', borderBottom:isExpanded?`1px solid ${b2}`:'none' }}>
                              <div>
                                <div style={{ fontSize:15, color:text, fontWeight:600, display:'flex', alignItems:'center', gap:8 }}>
                                  {diffs.length} расхождений
                                  {isFirst&&<span style={{ fontSize:11, color:'#007aff', background:'rgba(0,122,255,.1)', padding:'2px 7px', borderRadius:8 }}>Последняя</span>}
                                </div>
                                <div style={{ fontSize:12, color:t4, marginTop:2 }}>{timeStr(inv.created_at)}</div>
                              </div>
                              <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                                <div style={{ fontSize:15, fontWeight:700, color:totalDiff>=0?'#34c759':'#ff3b30' }}>
                                  {totalDiff>=0?'+':''}{fg(Math.abs(totalDiff))}
                                </div>
                                <svg width="16" height="16" fill="none" stroke={t4} strokeWidth="2" viewBox="0 0 24 24" style={{ transform:isExpanded?'rotate(180deg)':'none', transition:'transform .2s' }}><path d="M6 9l6 6 6-6"/></svg>
                              </div>
                            </div>
                            {isExpanded&&diffs.map((it:any,i:number)=>(
                              <div key={i} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'11px 16px 11px 24px', borderBottom:i<diffs.length-1?`1px solid ${b2}`:'none', background:'rgba(0,0,0,.01)' }}>
                                <div>
                                  <div style={{ fontSize:14, color:text }}>{it.brand} · {it.flavor}</div>
                                  <div style={{ fontSize:12, color:t4 }}>по учёту: {fg(it.expected_g)} → факт: {fg(it.actual_g)}</div>
                                </div>
                                <div style={{ fontSize:14, fontWeight:700, color:it.diff_g>=0?'#34c759':'#ff3b30' }}>
                                  {it.diff_g>=0?'+':''}{fg(Math.abs(it.diff_g))}
                                </div>
                              </div>
                            ))}
                          </div>
                        )
                      })
                  }
                </div>
              )}

              {invType==='venue' && (
                <div>
                  <div style={{ background:'rgba(0,122,255,.08)', borderRadius:14, padding:'16px', textAlign:'center' as const, marginBottom:12 }}>
                    <div style={{ fontSize:15, fontWeight:600, color:'#007aff', marginBottom:6 }}>Инвентаризация заведения</div>
                    <div style={{ fontSize:13, color:t3 }}>Будет доступно в следующих обновлениях</div>
                  </div>
                  <div style={{ background:surface, borderRadius:16, padding:'16px', boxShadow:sh }}>
                    <div style={{ fontSize:12, color:t3, fontWeight:600, textTransform:'uppercase' as const, marginBottom:8 }}>Выдано в зал всего</div>
                    <div style={{ fontSize:28, fontWeight:700, color:text }}>{fg(movements.filter(m=>m.type==='out').reduce((s,m)=>s+m.quantity_g,0))}</div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Bottom Nav */}
      <div style={{ position:'fixed', bottom:0, left:0, right:0, zIndex:300, height:80, background:nbg, backdropFilter:'saturate(180%) blur(20px)', borderTop:`1px solid ${border}`, display:'flex', alignItems:'flex-start', paddingTop:10 }}>
        {[
          {id:'stock',label:'Наличие',icon:<svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24" width="26" height="26"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>},
          {id:'movements',label:'Движения',icon:<svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24" width="26" height="26"><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 014-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 01-4 4H3"/></svg>},
          {id:'inventory',label:'Инвентарь',icon:<svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24" width="26" height="26"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>},
        ].map(t=>(
          <button key={t.id} onClick={()=>setTab(t.id as any)} style={{ flex:1, display:'flex', flexDirection:'column' as const, alignItems:'center', gap:3, cursor:'pointer', color:tab===t.id?'#007aff':t4, border:'none', background:'none', fontFamily:'inherit', padding:0, fontSize:10, fontWeight:600, transition:'color .18s' }}>
            <span style={{ transform:tab===t.id?'scale(1.1)':'scale(1)', transition:'transform .18s', display:'flex' }}>{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>

      {/* Add/Edit Movement Modal */}
      {showAddMov&&(
        <div style={{ position:'fixed', inset:0, zIndex:500, background:'rgba(0,0,0,.4)', backdropFilter:'blur(4px)', display:'flex', alignItems:'flex-end', justifyContent:'center' }} onClick={()=>{setShowAddMov(false);setEditBatch(null)}}>
          <div style={{ background:'#f2f2f7', borderRadius:'22px 22px 0 0', width:'100%', maxWidth:480, maxHeight:'90vh', overflowY:'auto' }} onClick={e=>e.stopPropagation()}>
            <div style={{ width:36, height:4, background:s2, borderRadius:2, margin:'12px auto 0' }} />
            <div style={{ fontSize:17, fontWeight:700, textAlign:'center' as const, padding:'12px 20px 0', color:text }}>{editBatch?'Редактировать':'Добавить'}</div>
            <div style={{ display:'flex', background:s2, borderRadius:10, padding:2, margin:'12px 16px 0' }}>
              {(['in','out'] as const).map(m=>(
                <button key={m} onClick={()=>{setMovMode(m);if(!editBatch)setMovRows([newRow()])}}
                  style={{ flex:1, padding:7, borderRadius:8, border:'none', fontFamily:'inherit', fontSize:13, fontWeight:movMode===m?600:500, cursor:'pointer', background:movMode===m?surface:'transparent', color:movMode===m?text:t3, transition:'all .15s' }}>
                  {m==='in'?'Поставка':'Выдача в зал'}
                </button>
              ))}
            </div>
            <div style={{ padding:'12px 16px 32px' }}>
              {movRows.map((row,i) => {
                const brandsForMode = movMode==='out' ? outBrands : allBrands
                const flavors = flavorsForBrand(row.brand, movMode==='out')
                const maxQty = movMode==='out' ? stock.find(s=>s.brand===row.brand&&s.flavor===row.flavor)?.quantity_g : undefined
                return (
                  <div key={row.id} style={{ background:surface, borderRadius:14, padding:'12px', marginBottom:8, boxShadow:'0 1px 3px rgba(0,0,0,.06)' }}>
                    <div style={{ display:'flex', gap:8, marginBottom:8, alignItems:'center' }}>
                      <AutoInput value={row.brand} onChange={v=>updateMovRow(row.id,'brand',v)} suggestions={brandsForMode} placeholder="Бренд" />
                      {movRows.length>1&&<button onClick={()=>removeMovRow(row.id)} style={{ width:32, height:32, borderRadius:'50%', background:'rgba(255,59,48,.1)', border:'none', color:'#ff3b30', fontSize:20, cursor:'pointer', flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center' }}>×</button>}
                    </div>
                    <div style={{ display:'flex', gap:8 }}>
                      <AutoInput value={row.flavor} onChange={v=>updateMovRow(row.id,'flavor',v)}
                        suggestions={flavors.length>0 ? flavors : (row.brand ? [] : allFlavors)}
                        placeholder="Вкус" disabled={movMode==='out'&&!row.brand} />
                      <input value={row.quantity_g} onChange={e=>updateMovRow(row.id,'quantity_g',e.target.value)}
                        placeholder="г" type="number" min={1} max={maxQty}
                        style={{ width:76, padding:'11px 10px', borderRadius:10, border:'1px solid rgba(60,60,67,.2)', fontSize:15, color:text, background:'#fff', fontFamily:'inherit', outline:'none', flexShrink:0 }} />
                    </div>
                    {maxQty!==undefined&&row.flavor&&<div style={{ fontSize:11, color:t3, marginTop:6 }}>Доступно: {fg(maxQty)}</div>}
                  </div>
                )
              })}
              <button onClick={()=>setMovRows(r=>[...r,newRow()])}
                style={{ width:'100%', padding:'11px', borderRadius:12, background:s2, border:'none', fontFamily:'inherit', fontSize:14, fontWeight:600, cursor:'pointer', color:text, marginBottom:10 }}>
                + Добавить позицию
              </button>
              <button onClick={saveMov} disabled={saving}
                style={{ width:'100%', padding:'14px', borderRadius:14, background:saving?'#aaa':'#007aff', color:'#fff', border:'none', fontFamily:'inherit', fontSize:16, fontWeight:700, cursor:'pointer' }}>
                {saving?'Сохранение...':editBatch?'Сохранить изменения':movMode==='in'?'Сохранить поставку':'Сохранить выдачу'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Inventory Modal */}
      {showInv&&(
        <div style={{ position:'fixed', inset:0, zIndex:500, background:'rgba(0,0,0,.4)', backdropFilter:'blur(4px)', display:'flex', alignItems:'flex-end', justifyContent:'center' }} onClick={()=>setShowInv(false)}>
          <div style={{ background:'#f2f2f7', borderRadius:'22px 22px 0 0', width:'100%', maxWidth:480, maxHeight:'90vh', overflowY:'auto' }} onClick={e=>e.stopPropagation()}>
            <div style={{ width:36, height:4, background:s2, borderRadius:2, margin:'12px auto 0' }} />
            <div style={{ fontSize:17, fontWeight:700, textAlign:'center' as const, padding:'13px 20px 4px', color:text }}>Инвентаризация склада</div>
            <div style={{ fontSize:13, color:t3, textAlign:'center' as const, paddingBottom:12 }}>Введите фактический вес — склад обновится автоматически</div>
            <div style={{ padding:'0 16px 32px' }}>
              {invRows.map((row,i) => {
                const actual = row.actual_g !== '' ? parseFloat(row.actual_g) : null
                const diff = actual !== null ? actual - row.expected_g : null
                return (
                  <div key={i} style={{ background:surface, borderRadius:14, padding:'12px 14px', marginBottom:8, boxShadow:'0 1px 3px rgba(0,0,0,.06)' }}>
                    <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:8 }}>
                      <div>
                        <div style={{ fontSize:15, color:text, fontWeight:500 }}>{row.brand}</div>
                        <div style={{ fontSize:12, color:t3 }}>{row.flavor}</div>
                      </div>
                      <div style={{ fontSize:13, color:t4 }}>по учёту: {fg(row.expected_g)}</div>
                    </div>
                    <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                      <input value={row.actual_g} onChange={e=>{const r=[...invRows];r[i]={...r[i],actual_g:e.target.value};setInvRows(r)}}
                        placeholder="Фактически (г)" type="number" min={0}
                        style={{ flex:1, padding:'10px 12px', borderRadius:10, border:'1px solid rgba(60,60,67,.2)', fontSize:15, color:text, background:'#fff', fontFamily:'inherit', outline:'none' }} />
                      {diff!==null&&diff!==0&&(
                        <div style={{ fontSize:14, fontWeight:700, color:diff>0?'#34c759':'#ff3b30', whiteSpace:'nowrap' as const, minWidth:64, textAlign:'right' as const }}>
                          {diff>0?'+':''}{fg(Math.abs(diff))}
                        </div>
                      )}
                      {diff===0&&<div style={{ fontSize:13, color:'#34c759', minWidth:64, textAlign:'right' as const }}>✓</div>}
                    </div>
                  </div>
                )
              })}
              <button onClick={saveInv} disabled={saving}
                style={{ width:'100%', padding:'14px', borderRadius:14, background:saving?'#aaa':'#007aff', color:'#fff', border:'none', fontFamily:'inherit', fontSize:16, fontWeight:700, cursor:'pointer', marginTop:8 }}>
                {saving?'Сохранение...':'Сохранить инвентаризацию'}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast&&(
        <div style={{ position:'fixed', bottom:100, left:'50%', transform:'translateX(-50%)', background:'rgba(30,30,30,.92)', color:'#fff', padding:'10px 20px', borderRadius:20, fontSize:14, fontWeight:500, zIndex:600, whiteSpace:'nowrap' as const, animation:'toastIn .25s ease' }}>
          {toast}
        </div>
      )}
    </div>
  )
}
