'use client'
import React, { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { db } from '@/lib/db'
import { notify as pushNotify } from '@/lib/notifyClient'
import { renderNotify, renderCategory, renderSegments } from '@/lib/notifyStrings'
import { useTheme } from '@/hooks/useTheme'
import { AuthGate } from '@/components/AuthGate'
import { AppSwitchBrand } from '@/components/AppSwitchBrand'
import { useI18n } from '@/lib/i18n'
import { fmtDate } from '@/lib/format'
import { tCurrent } from '@/lib/i18n'
import { ScheduleTab } from '@/components/people/ScheduleTab'
import { AuditsView } from './audits'
import { btnB2, inp, lbl, clock, hoursOf, fmtHours, HistoryList } from './shared'
import { mondayOf, addDays, hhmm, timeRange, dayLabel, navBtn, roleLabel, getMe, Sheet, Placeholder, DOW_SHORT, DOW_FULL, MON } from '@/components/people/helpers'


// Зал: стоп-лист, заказы, техкарты, закуп, OpsTab
// Распил page.tsx (Д2, 2026-07-18): секция вынесена без изменений логики.
// ── STOP-LIST TAB ────────────────────────────────────────────────────────────────

export function StopListTab({ canEdit, currency, accent, t, toast }: { canEdit: boolean; currency: string; accent: string; t: any; toast: (m: string) => void }) {
  const { t: tr } = useI18n()
  const [cats, setCats] = useState<any[]>([])
  const [items, setItems] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  const load = async () => {
    setLoading(true)
    const [{ data: c }, { data: i }] = await Promise.all([
      db.from('menu_categories').select('*').eq('is_visible', true).order('position'),
      db.from('menu_items').select('*').eq('is_visible', true).order('position'),
    ])
    setCats(c || []); setItems(i || []); setLoading(false)
  }
  useEffect(() => { load() }, [])

  // Стоп ставят кухня и менеджер; остальные видят список (в гостевом меню — автоматически).
  const toggle = async (item: any) => {
    if (!canEdit) return
    const next = !item.is_available
    setItems(its => its.map(x => x.id === item.id ? { ...x, is_available: next } : x))
    await db.from('menu_items').update({ is_available: next }).eq('id', item.id)
    toast(next ? tr('pe.backToMenu') : tr('pe.toStopList'))
  }

  if (loading) return <div style={{ textAlign: 'center', padding: 40, color: t.text3 }}>{tr('pe.loading')}</div>

  const itemsFor = (catId: string) => items.filter(i => i.category_id === catId && (!search || i.name.toLowerCase().includes(search.toLowerCase())))
  const stopCount = items.filter(i => !i.is_available).length

  if (items.length === 0) return (
    <div style={{ textAlign: 'center', padding: '60px 20px', color: t.text3 }}>
      <div style={{ fontWeight: 600, fontSize: 16, color: t.text2 }}>{tr('pe.menuEmpty')}</div>
      <div style={{ fontSize: 13, marginTop: 4 }}>{tr('pe.itemsAddedInDash')}</div>
    </div>
  )

  return (
    <div>
      <div style={{ position: 'relative', marginBottom: 16 }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder={tr('pe.searchItem')}
          style={{ width: '100%', padding: '12px 14px 12px 42px', borderRadius: 14, border: `1px solid ${t.sep2}`, fontSize: 16, color: t.text, background: t.surface, fontFamily: 'inherit', outline: 'none', boxShadow: t.sh }} />
        <svg style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)' }} width="18" height="18" fill="none" stroke={t.text3} strokeWidth="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></svg>
      </div>
      {stopCount > 0 && (
        <div style={{ background: `${t.red}14`, borderRadius: 12, padding: '10px 14px', marginBottom: 14, fontSize: 13, color: t.red, fontWeight: 600 }}>{tr('pe.stopListInfo', { n: stopCount })}</div>
      )}
      {cats.map(cat => {
        const list = itemsFor(cat.id)
        if (list.length === 0) return null
        return (
          <div key={cat.id} style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: t.text3, textTransform: 'uppercase', letterSpacing: 0.6, padding: '4px 4px 8px' }}>{cat.name}</div>
            <div style={{ background: t.surface, borderRadius: 16, overflow: 'hidden', boxShadow: t.sh }}>
              {list.map((item, i) => (
                <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 16px', borderBottom: i < list.length - 1 ? `0.5px solid ${t.sep2}` : 'none', opacity: item.is_available ? 1 : 0.6 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 15, color: t.text, fontWeight: 500 }}>{item.name}</div>
                    {item.price != null && <div style={{ fontSize: 12, color: t.text3, marginTop: 2 }}>{item.price} {currency}</div>}
                  </div>
                  <button onClick={() => toggle(item)} style={{ padding: '7px 14px', borderRadius: 980, border: 'none', cursor: canEdit ? 'pointer' : 'default', fontFamily: 'inherit', fontSize: 13, fontWeight: 700, background: item.is_available ? `${t.green}1a` : t.red, color: item.is_available ? t.green : '#fff' }}>
                    {item.is_available ? tr('pe.available') : tr('pe.stop')}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── ORDERS INBOX (заказы из гостевого меню) ─────────────────────────────────────

const ORDER_STATUS: Record<string, { label: string; next?: string; nextLabel?: string; color: (t: any) => string }> = {
  new: { label: 'pe.osNew', next: 'in_progress', nextLabel: 'pe.osNewNext', color: t => t.orange },
  in_progress: { label: 'pe.osInProgress', next: 'done', nextLabel: 'pe.osInProgressNext', color: t => t.blue },
  done: { label: 'pe.osDone', color: t => t.green },
  cancelled: { label: 'pe.osCancelled', color: t => t.text3 },
}

export function OrdersInbox({ currency, accent, t, toast }: { currency: string; accent: string; t: any; toast: (m: string) => void }) {
  const { t: tr } = useI18n()
  const [orders, setOrders] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [seg, setSeg] = useState<'active' | 'done'>('active')

  const load = async () => {
    const from = fmtDate(addDays(new Date(), -2))
    const { data } = await db.from('menu_orders').select('*').gte('created_at', from).order('created_at', { ascending: false }).limit(100)
    setOrders(data || []); setLoading(false)
  }
  useEffect(() => {
    load()
    const iv = setInterval(load, 30000) // новые заказы подтягиваются сами
    return () => clearInterval(iv)
  }, [])

  const setStatus = async (o: any, status: string) => {
    setOrders(os => os.map(x => x.id === o.id ? { ...x, status } : x))
    await db.from('menu_orders').update({ status }).eq('id', o.id)
    toast(tr(ORDER_STATUS[status]?.label || 'pe.updated'))
  }

  if (loading) return <div style={{ textAlign: 'center', padding: 40, color: t.text3 }}>{tr('pe.loading')}</div>

  const active = orders.filter(o => o.status === 'new' || o.status === 'in_progress')
  const finished = orders.filter(o => o.status === 'done' || o.status === 'cancelled')
  const list = seg === 'active' ? active : finished

  return (
    <div>
      <div style={{ display: 'flex', background: t.fill, borderRadius: 12, padding: 3, marginBottom: 16, gap: 2 }}>
        {([['active', `${tr('pe.activeOrders')}${active.length ? ` · ${active.length}` : ''}`], ['done', tr('pe.finishedOrders')]] as const).map(([id, label]) => (
          <button key={id} onClick={() => setSeg(id)} style={{ flex: 1, padding: '8px 0', borderRadius: 10, border: 'none', fontFamily: 'inherit', fontSize: 13, fontWeight: seg === id ? 700 : 500, cursor: 'pointer', background: seg === id ? t.surface : 'transparent', color: seg === id ? accent : t.text3, boxShadow: seg === id ? t.sh2 : 'none' }}>{label}</button>
        ))}
      </div>

      {list.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '50px 20px', color: t.text3 }}>
          <div style={{ fontWeight: 600, fontSize: 16, color: t.text2 }}>{seg === 'active' ? tr('pe.noActiveOrders') : tr('pe.emptyYet')}</div>
          <div style={{ fontSize: 13, marginTop: 4 }}>{tr('pe.ordersAppearHere')}</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {list.map(o => {
            const st = ORDER_STATUS[o.status] || ORDER_STATUS.new
            const isCall = Array.isArray(o.items) && o.items[0]?.call === 'waiter' // вызов официанта (цифровой счёт)
            if (isCall) return (
              <div key={o.id} style={{ background: t.surface, borderRadius: 16, padding: '14px 16px', boxShadow: t.sh, borderLeft: `3px solid ${t.orange}` }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 15, fontWeight: 700, color: t.text }}>{tr('pe.callingWaiter')}</span>
                    {o.table_number && <span style={{ fontSize: 13, fontWeight: 800, color: '#fff', background: t.orange, padding: '3px 10px', borderRadius: 8 }}>{tr('pe.table', { n: o.table_number })}</span>}
                    <span style={{ fontSize: 12, color: t.text3 }}>{new Date(o.created_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                  {(o.status === 'new' || o.status === 'in_progress')
                    ? <button onClick={() => setStatus(o, 'done')} style={{ ...btnB2(t), background: accent, color: '#fff' }}>{tr('pe.coming')}</button>
                    : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={t.green} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>}
                </div>
              </div>
            )
            return (
              <div key={o.id} style={{ background: t.surface, borderRadius: 16, padding: '14px 16px', boxShadow: t.sh }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {o.table_number && <span style={{ fontSize: 13, fontWeight: 800, color: '#fff', background: accent, padding: '3px 10px', borderRadius: 8 }}>{tr('pe.table', { n: o.table_number })}</span>}
                    <span style={{ fontSize: 12, color: t.text3 }}>{new Date(o.created_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 700, color: st.color(t), background: `${st.color(t)}1a`, padding: '3px 9px', borderRadius: 8 }}>{tr(st.label)}</span>
                </div>
                {(Array.isArray(o.items) ? o.items : []).map((it: any, i: number) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, color: t.text, padding: '3px 0' }}>
                    <span>{it.name}{Array.isArray(it.opts) && it.opts.length > 0 ? <span style={{ color: t.text3 }}> · {it.opts.join(', ')}</span> : null} × {it.qty}</span>
                    {it.price != null && <span style={{ color: t.text3 }}>{(it.price * it.qty).toFixed(2)} {currency}</span>}
                  </div>
                ))}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, paddingTop: 8, borderTop: `0.5px solid ${t.sep2}` }}>
                  <span style={{ fontSize: 15, fontWeight: 800, color: t.text }}>{Number(o.total || 0).toFixed(2)} {currency}</span>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {o.status === 'new' && <button onClick={() => setStatus(o, 'cancelled')} style={btnB2(t)}>{tr('pe.cancel')}</button>}
                    {st.next && <button onClick={() => setStatus(o, st.next!)} style={{ ...btnB2(t), background: accent, color: '#fff' }}>{tr(st.nextLabel ?? '')}</button>}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── TECH CARDS (технологички) ────────────────────────────────────────────────────

const TC_CAT: Record<string, string> = { dish: 'pe.tcDish', prep: 'pe.tcPrep', stoplist: 'pe.tcOther' }

export function TechCardsView({ isManager, accent, t, toast }: { isManager: boolean; accent: string; t: any; toast: (m: string) => void }) {
  const { t: tr } = useI18n()
  const [cards, setCards] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState<string | null>(null)
  const [edit, setEdit] = useState<{ id?: string; name: string; category: string; items: string[] } | null>(null)
  const [saving, setSaving] = useState(false)

  const load = async () => {
    const { data } = await db.from('tech_cards').select('*').eq('is_active', true).order('name')
    setCards(data || []); setLoading(false)
  }
  useEffect(() => { load() }, [])

  const save = async () => {
    if (!edit || !edit.name.trim()) { toast(tr('pe.enterName')); return }
    const clean = edit.items.map(s => s.trim()).filter(Boolean)
    setSaving(true)
    if (edit.id) await db.from('tech_cards').update({ name: edit.name.trim(), category: edit.category, items: clean }).eq('id', edit.id)
    else await db.from('tech_cards').insert({ name: edit.name.trim(), category: edit.category, items: clean })
    setSaving(false); setEdit(null); toast(tr('pe.saved')); await load()
  }
  const remove = async (id: string) => {
    setCards(cs => cs.filter(c => c.id !== id))
    await db.from('tech_cards').update({ is_active: false }).eq('id', id)
  }

  if (loading) return <div style={{ textAlign: 'center', padding: 40, color: t.text3 }}>{tr('pe.loading')}</div>

  return (
    <div>
      {isManager && (
        <button onClick={() => setEdit({ name: '', category: 'dish', items: [''] })} style={{ width: '100%', padding: '14px', borderRadius: 14, background: accent, color: '#fff', border: 'none', fontFamily: 'inherit', fontSize: 15, fontWeight: 700, cursor: 'pointer', marginBottom: 16, boxShadow: `0 4px 16px ${accent}44` }}>
          {tr('pe.newTechCard')}
        </button>
      )}

      {cards.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '50px 20px', color: t.text3 }}>
          <div style={{ fontWeight: 600, fontSize: 16, color: t.text2 }}>{tr('pe.noTechCards')}</div>
          <div style={{ fontSize: 13, marginTop: 4 }}>{isManager ? tr('pe.techCardManagerHint') : tr('pe.techCardStaffHint')}</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {cards.map(c => {
            const items: string[] = Array.isArray(c.items) ? c.items : []
            const opened = open === c.id
            return (
              <div key={c.id} style={{ background: t.surface, borderRadius: 16, boxShadow: t.sh, overflow: 'hidden' }}>
                <button onClick={() => setOpen(opened ? null : c.id)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 15, fontWeight: 600, color: t.text }}>{c.name}</div>
                    <div style={{ fontSize: 12, color: t.text3, marginTop: 2 }}>{TC_CAT[c.category] ? tr(TC_CAT[c.category]) : c.category} · {items.length} {tr('pe.stepsWord')}</div>
                  </div>
                  <svg width="14" height="14" fill="none" stroke={t.text3} strokeWidth="2.5" strokeLinecap="round" viewBox="0 0 24 24" style={{ transform: opened ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }}><path d="M6 9l6 6 6-6" /></svg>
                </button>
                {opened && (
                  <div style={{ padding: '0 16px 14px' }}>
                    {items.map((it, i) => (
                      <div key={i} style={{ display: 'flex', gap: 10, padding: '7px 0', borderTop: i === 0 ? `0.5px solid ${t.sep2}` : 'none', alignItems: 'baseline' }}>
                        <span style={{ fontSize: 12, fontWeight: 800, color: accent, minWidth: 18 }}>{i + 1}</span>
                        <span style={{ fontSize: 14, color: t.text2, lineHeight: 1.45 }}>{it}</span>
                      </div>
                    ))}
                    {isManager && (
                      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                        <button onClick={() => setEdit({ id: c.id, name: c.name, category: c.category, items: items.length ? [...items] : [''] })} style={btnB2(t)}>{tr('pe.edit')}</button>
                        <button onClick={() => remove(c.id)} style={{ ...btnB2(t), color: t.red, background: `${t.red}14` }}>{tr('pe.delete')}</button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {edit && (
        <Sheet onClose={() => setEdit(null)} t={t}>
          <div style={{ padding: '14px 20px 32px' }}>
            <div style={{ fontSize: 18, fontWeight: 700, textAlign: 'center', color: t.text, marginBottom: 18 }}>{edit.id ? tr('pe.editTechCard') : tr('pe.newTechCardTitle')}</div>
            <input value={edit.name} onChange={e => setEdit({ ...edit, name: e.target.value })} placeholder={tr('pe.techNamePh')} autoFocus style={inp(t)} />
            <label style={lbl(t)}>{tr('pe.type')}</label>
            <select value={edit.category} onChange={e => setEdit({ ...edit, category: e.target.value })} style={inp(t)}>
              {Object.entries(TC_CAT).map(([k, v]) => <option key={k} value={k}>{tr(v)}</option>)}
            </select>
            <label style={lbl(t)}>{tr('pe.stepsLabel')}</label>
            {edit.items.map((v, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                <input value={v} onChange={e => setEdit(ed => ({ ...ed!, items: ed!.items.map((x, j) => j === i ? e.target.value : x) }))} placeholder={tr('pe.stepN', { n: i + 1 })} style={{ ...inp(t), marginBottom: 0, flex: 1 }} />
                <button onClick={() => setEdit(ed => ({ ...ed!, items: ed!.items.filter((_, j) => j !== i) }))} style={{ width: 44, borderRadius: 12, border: 'none', background: `${t.red}14`, color: t.red, cursor: 'pointer', fontSize: 18, fontFamily: 'inherit' }}>−</button>
              </div>
            ))}
            <button onClick={() => setEdit(ed => ({ ...ed!, items: [...ed!.items, ''] }))} style={{ width: '100%', padding: '11px', borderRadius: 12, border: `1.5px dashed ${t.sep}`, background: 'transparent', color: t.text3, fontFamily: 'inherit', fontSize: 14, cursor: 'pointer', marginBottom: 14 }}>{tr('pe.addStep')}</button>
            <button onClick={save} disabled={saving} style={{ width: '100%', padding: '15px', borderRadius: 14, background: accent, color: '#fff', border: 'none', fontFamily: 'inherit', fontSize: 15, fontWeight: 700, cursor: 'pointer', boxShadow: `0 4px 16px ${accent}44` }}>
              {saving ? '...' : tr('pe.save')}
            </button>
          </div>
        </Sheet>
      )}
    </div>
  )
}

// ── OPS TAB («Зал»: стоп-лист / заказы / чек-листы / техкарты) ──────────────────

// ── PURCHASE TAB (закуп) ─────────────────────────────────────────────────────────

const PURCHASE_CATS = [
  { id: 'kitchen', label: 'pe.catKitchen' },
  { id: 'bar', label: 'pe.catBar' },
  { id: 'hookah', label: 'pe.catHookah' },
  { id: 'household', label: 'pe.catHousehold' },
  { id: 'general', label: 'pe.catGeneral' },
] as const

export function PurchaseTab({ me, isManager, accent, t, toast }: { me: any; isManager: boolean; accent: string; t: any; toast: (m: string) => void }) {
  const { t: tr } = useI18n()
  const [items, setItems] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [seg, setSeg] = useState<'todo' | 'done'>('todo')
  const [showForm, setShowForm] = useState(false)
  const [cat, setCat] = useState<string>('kitchen')
  const [rows, setRows] = useState<{ name: string; qty: string; unit: string }[]>([{ name: '', qty: '', unit: '' }])
  const [saving, setSaving] = useState(false)

  const load = async () => {
    const { data } = await db.from('purchase_items').select('*').order('created_at', { ascending: false }).limit(300)
    setItems(data || []); setLoading(false)
  }
  useEffect(() => { load(); const iv = setInterval(load, 30000); return () => clearInterval(iv) }, [])

  const catLabel = (id: string) => { const c = PURCHASE_CATS.find(x => x.id === id); return c ? tr(c.label) : id }

  const setRow = (i: number, patch: Partial<{ name: string; qty: string; unit: string }>) =>
    setRows(rs => rs.map((r, j) => j === i ? { ...r, ...patch } : r))

  const submit = async () => {
    const valid = rows.map(r => ({ ...r, name: r.name.trim() })).filter(r => r.name)
    if (!valid.length) return
    setSaving(true)
    const payload = valid.map(r => ({
      category: cat,
      name: r.name,
      qty: r.qty.trim() ? (Number(r.qty.replace(',', '.')) || null) : null,
      unit: r.unit.trim() || null,
      status: 'todo',
      created_by: (me.id && me.id !== 'owner') ? me.id : null,
      created_by_name: me.name || (me.is_owner ? tr('role.owner') : ''),
    }))
    const { error } = await db.from('purchase_items').insert(payload)
    setSaving(false)
    if (error) { toast(error.message); return }
    // Push владельцу/менеджерам (с учётом их персональных настроек и режима дайджеста).
    const who = me.name || (me.is_owner ? tr('role.owner') : '')
    const whoPrefix = who ? who + ': ' : ''
    const summary = valid.length === 1
      ? `${whoPrefix}${valid[0].name}`
      : `${whoPrefix}${valid.length} ${tr('pe.pTab').toLowerCase()}`
    pushNotify({
      type: 'purchase', title: `${catLabel(cat)} · ${tr('pe.pTab')}`, body: summary,
      titleKey: 'notify.purchaseTitle', titleParams: { category: cat },
      ...(valid.length > 1 ? { bodyKey: 'notify.purchasePositionsBody', bodyParams: { who: whoPrefix, n: valid.length } } : {}),
      audience: { managers: true }, data: { category: cat },
    })
    setShowForm(false); setRows([{ name: '', qty: '', unit: '' }]); setCat('kitchen')
    load()
  }

  const setStatus = async (it: any, status: string) => {
    const now = new Date().toISOString()
    const bought = status === 'bought'
    setItems(xs => xs.map(x => x.id === it.id ? { ...x, status, bought_at: bought ? now : null } : x))
    await db.from('purchase_items').update({
      status,
      bought_by: bought ? ((me.id && me.id !== 'owner') ? me.id : null) : null,
      bought_at: bought ? now : null,
    }).eq('id', it.id)
  }

  const remove = async (it: any) => {
    setItems(xs => xs.filter(x => x.id !== it.id))
    await db.from('purchase_items').delete().eq('id', it.id)
  }

  const clearDone = async () => {
    const ids = items.filter(x => x.status !== 'todo').map(x => x.id)
    if (!ids.length) return
    setItems(xs => xs.filter(x => x.status === 'todo'))
    await db.from('purchase_items').delete().in('id', ids)
    toast(tr('pe.pClearDone'))
  }

  const buildText = () => {
    const todo = items.filter(x => x.status === 'todo')
    const cats = [...new Set(todo.map(x => x.category))]
    const lines: string[] = []
    cats.forEach(cid => {
      const arr = todo.filter(x => x.category === cid)
      if (!arr.length) return
      lines.push(`${catLabel(cid)}:`)
      arr.forEach(x => {
        const amt = x.qty != null ? ` — ${x.qty}${x.unit ? ' ' + x.unit : ''}` : (x.unit ? ` — ${x.unit}` : '')
        lines.push(`• ${x.name}${amt}`)
      })
      lines.push('')
    })
    return lines.join('\n').trim()
  }
  const copyList = async () => { try { await navigator.clipboard.writeText(buildText()); toast(tr('pe.pCopied')) } catch { toast(buildText()) } }
  const waList = () => { window.open(`https://wa.me/?text=${encodeURIComponent(buildText())}`, '_blank') }

  if (loading) return <div style={{ textAlign: 'center', padding: 40, color: t.text3 }}>{tr('pe.loading')}</div>

  const todo = items.filter(x => x.status === 'todo')
  const done = items.filter(x => x.status !== 'todo')
  const list = seg === 'todo' ? todo : done
  const catsInList = [...new Set(list.map(x => x.category))]

  return (
    <div>
      {/* add button */}
      <button onClick={() => setShowForm(true)} style={{ width: '100%', padding: '13px 0', borderRadius: 14, border: 'none', background: accent, color: '#fff', fontFamily: 'inherit', fontSize: 15, fontWeight: 700, cursor: 'pointer', marginBottom: 14 }}>{tr('pe.pAddItems')}</button>

      {/* segments */}
      <div style={{ display: 'flex', background: t.fill, borderRadius: 12, padding: 3, marginBottom: 16, gap: 2 }}>
        {([['todo', `${tr('pe.pToBuy')}${todo.length ? ` · ${todo.length}` : ''}`], ['done', tr('pe.pDone')]] as const).map(([id, label]) => (
          <button key={id} onClick={() => setSeg(id)} style={{ flex: 1, padding: '8px 0', borderRadius: 10, border: 'none', fontFamily: 'inherit', fontSize: 13, fontWeight: seg === id ? 700 : 500, cursor: 'pointer', background: seg === id ? t.surface : 'transparent', color: seg === id ? accent : t.text3, boxShadow: seg === id ? t.sh2 : 'none' }}>{label}</button>
        ))}
      </div>

      {/* copy / whatsapp (manager, todo view) */}
      {seg === 'todo' && isManager && todo.length > 0 && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          <button onClick={copyList} style={{ ...btnB2(t), flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" /></svg>
            {tr('pe.pCopy')}
          </button>
          <button onClick={waList} style={{ ...btnB2(t), flex: 1, background: '#25D36618', color: '#1faa52', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            <svg width="16" height="16" fill="currentColor" viewBox="0 0 24 24"><path d="M.057 24l1.687-6.163a11.867 11.867 0 01-1.587-5.946C.16 5.335 5.495 0 12.05 0a11.817 11.817 0 018.413 3.488 11.824 11.824 0 013.48 8.414c-.003 6.557-5.338 11.892-11.893 11.892a11.9 11.9 0 01-5.688-1.448L.057 24zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884a9.86 9.86 0 001.59 5.318l-.999 3.648 3.908-1.235zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z" /></svg>
            WhatsApp
          </button>
        </div>
      )}

      {list.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '50px 20px', color: t.text3 }}>
          <div style={{ fontWeight: 600, fontSize: 16, color: t.text2 }}>{seg === 'todo' ? tr('pe.pEmpty') : tr('pe.emptyYet')}</div>
          {seg === 'todo' && <div style={{ fontSize: 13, marginTop: 4 }}>{tr('pe.pEmptyHint')}</div>}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {catsInList.map(cid => (
            <div key={cid}>
              <div style={{ fontSize: 12, fontWeight: 700, color: t.text3, textTransform: 'uppercase', letterSpacing: .4, marginBottom: 8 }}>{catLabel(cid)}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {list.filter(x => x.category === cid).map(it => (
                  <div key={it.id} style={{ background: t.surface, borderRadius: 14, padding: '12px 14px', boxShadow: t.sh, display: 'flex', alignItems: 'center', gap: 12, opacity: it.status === 'todo' ? 1 : 0.6 }}>
                    {seg === 'todo' && isManager && (
                      <button onClick={() => setStatus(it, 'bought')} style={{ width: 26, height: 26, borderRadius: '50%', border: `2px solid ${t.sep}`, background: 'transparent', cursor: 'pointer', flexShrink: 0 }} aria-label={tr('pe.pBought')} />
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 15, fontWeight: 600, color: t.text, textDecoration: it.status === 'bought' ? 'line-through' : 'none' }}>
                        {it.name}{it.qty != null && <span style={{ color: t.text3, fontWeight: 500 }}> · {it.qty}{it.unit ? ` ${it.unit}` : ''}</span>}{it.qty == null && it.unit && <span style={{ color: t.text3, fontWeight: 500 }}> · {it.unit}</span>}
                      </div>
                      <div style={{ fontSize: 11.5, color: t.text3, marginTop: 2 }}>
                        {it.created_by_name ? `${tr('pe.pBy')} ${it.created_by_name}` : ''}{it.status === 'unavailable' ? ` · ${tr('pe.pUnavail')}` : ''}
                      </div>
                    </div>
                    {seg === 'todo' && isManager && (
                      <button onClick={() => setStatus(it, 'unavailable')} style={{ ...btnB2(t), padding: '6px 10px', fontSize: 12 }}>{tr('pe.pUnavail')}</button>
                    )}
                    {(isManager || it.created_by === me.id) && (
                      <button onClick={() => remove(it)} style={{ width: 28, height: 28, borderRadius: 8, border: 'none', background: 'transparent', color: t.text3, cursor: 'pointer', flexShrink: 0 }} aria-label="×">
                        <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12" /></svg>
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
          {seg === 'done' && isManager && done.length > 0 && (
            <button onClick={clearDone} style={{ ...btnB2(t), color: t.red, alignSelf: 'center' }}>{tr('pe.pClearDone')}</button>
          )}
        </div>
      )}

      {/* ADD FORM */}
      {showForm && (
        <Sheet onClose={() => setShowForm(false)} t={t}>
          <div style={{ padding: '14px 16px 32px' }}>
            <div style={{ fontSize: 18, fontWeight: 700, textAlign: 'center', color: t.text, marginBottom: 16 }}>{tr('pe.pNew')}</div>

            {/* category chips */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
              {PURCHASE_CATS.map(c => (
                <button key={c.id} onClick={() => setCat(c.id)} style={{ padding: '8px 14px', borderRadius: 10, border: 'none', fontFamily: 'inherit', fontSize: 13, fontWeight: cat === c.id ? 700 : 500, cursor: 'pointer', background: cat === c.id ? accent : t.fill, color: cat === c.id ? '#fff' : t.text }}>{tr(c.label)}</button>
              ))}
            </div>

            {/* rows */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 12 }}>
              {rows.map((r, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input value={r.name} onChange={e => setRow(i, { name: e.target.value })} placeholder={tr('pe.pNamePh')} style={{ ...inp(t), marginBottom: 0, flex: 1 }} />
                  <input value={r.qty} onChange={e => setRow(i, { qty: e.target.value })} placeholder={tr('pe.pQtyEx')} inputMode="decimal" style={{ ...inp(t), marginBottom: 0, width: 64, padding: '12px 8px', textAlign: 'center' }} />
                  <input value={r.unit} onChange={e => setRow(i, { unit: e.target.value })} placeholder={tr('pe.pUnitEx')} style={{ ...inp(t), marginBottom: 0, width: 64, padding: '12px 8px', textAlign: 'center' }} />
                  {rows.length > 1 && (
                    <button onClick={() => setRows(rs => rs.filter((_, j) => j !== i))} style={{ width: 30, height: 30, borderRadius: 8, border: 'none', background: 'transparent', color: t.text3, cursor: 'pointer', flexShrink: 0 }}>
                      <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12" /></svg>
                    </button>
                  )}
                </div>
              ))}
            </div>

            <button onClick={() => setRows(rs => [...rs, { name: '', qty: '', unit: '' }])} style={{ ...btnB2(t), width: '100%', marginBottom: 16 }}>{tr('pe.pAddRow')}</button>

            <button onClick={submit} disabled={saving || !rows.some(r => r.name.trim())} style={{ width: '100%', padding: '14px 0', borderRadius: 14, border: 'none', background: accent, color: '#fff', fontFamily: 'inherit', fontSize: 16, fontWeight: 700, cursor: 'pointer', opacity: (saving || !rows.some(r => r.name.trim())) ? 0.5 : 1 }}>{tr('pe.pSubmit')}</button>
          </div>
        </Sheet>
      )}
    </div>
  )
}

export function OpsTab({ me, isManager, restaurantId, accent, t, toast }: { me: any; isManager: boolean; restaurantId: string; accent: string; t: any; toast: (m: string) => void }) {
  const { t: tr } = useI18n()
  const [view, setView] = useState<'stop' | 'orders' | 'check' | 'tech'>('stop')
  const [currency, setCurrency] = useState('€')
  const [ordersEnabled, setOrdersEnabled] = useState(false)

  useEffect(() => {
    db.from('restaurants').select('currency').limit(1).then(({ data }: any) => {
      const r = Array.isArray(data) ? data[0] : data
      if (r?.currency) setCurrency(r.currency)
    })
    db.from('menu_settings').select('allow_orders').limit(1).then(({ data }: any) => {
      const r = Array.isArray(data) ? data[0] : data
      setOrdersEnabled(!!r?.allow_orders)
    })
  }, [])

  const canStop = isManager || me.role === 'kitchen' // стоп ставят кухня и менеджер
  const canTech = isManager || me.role === 'kitchen' || me.role === 'bar' // техкарты — кухне/бару (не официанту/кальянщику)
  const VIEWS = [
    { id: 'stop', label: tr('pe.vStop') },
    ...(ordersEnabled ? [{ id: 'orders', label: tr('pe.vOrders') }] : []),
    { id: 'check', label: tr('pe.vChecklists') },
    ...(canTech ? [{ id: 'tech', label: tr('pe.vTech') }] : []),
  ] as const

  return (
    <div>
      <div style={{ display: 'flex', background: t.fill, borderRadius: 12, padding: 3, marginBottom: 16, gap: 2 }}>
        {VIEWS.map(v => (
          <button key={v.id} onClick={() => setView(v.id as any)} style={{ flex: 1, padding: '8px 0', borderRadius: 10, border: 'none', fontFamily: 'inherit', fontSize: 12.5, fontWeight: view === v.id ? 700 : 500, cursor: 'pointer', background: view === v.id ? t.surface : 'transparent', color: view === v.id ? accent : t.text3, boxShadow: view === v.id ? t.sh2 : 'none' }}>{v.label}</button>
        ))}
      </div>
      {view === 'stop' && <StopListTab canEdit={canStop} currency={currency} accent={accent} t={t} toast={toast} />}
      {view === 'orders' && ordersEnabled && <OrdersInbox currency={currency} accent={accent} t={t} toast={toast} />}
      {view === 'check' && <AuditsView me={me} isManager={isManager} restaurantId={restaurantId} accent={accent} t={t} toast={toast} />}
      {view === 'tech' && canTech && <TechCardsView isManager={isManager} accent={accent} t={t} toast={toast} />}
    </div>
  )
}

