'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useTheme } from '@/hooks/useTheme'

const ADMIN_EMAIL = 'raxim98@gmail.com'
const PLAN_PRICE: Record<string, number> = { starter: 14, business: 24, pro: 39 }

interface Restaurant {
  id: string; name: string; currency: string; owner_id: string
  subscription_status: string; subscription_plan: string
  subscription_ends_at: string | null; created_at: string
}
interface Stats { shifts: number; movements: number; employees: number; lastActive: string | null }

const STATUS: Record<string, { label: string; key: keyof ReturnType<typeof useTheme> }> = {
  active:    { label: 'Активна',     key: 'green' },
  trialing:  { label: 'Пробный',     key: 'blue' },
  past_due:  { label: 'Просрочена',  key: 'orange' },
  canceling: { label: 'Отменяется',  key: 'orange' },
  canceled:  { label: 'Отменена',    key: 'red' },
  frozen:    { label: 'Заморожена',  key: 'text3' },
  inactive:  { label: 'Неактивна',   key: 'text3' },
}

function daysLeft(endsAt: string | null) {
  if (!endsAt) return null
  return Math.ceil((new Date(endsAt).getTime() - Date.now()) / 86400000)
}
function dmy(iso: string) { return new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }) }

export default function AdminPage() {
  const router = useRouter()
  const t = useTheme('mise_admin_dark')
  const [user, setUser] = useState<any>(null)
  const [authorized, setAuthorized] = useState(false)
  const [restaurants, setRestaurants] = useState<Restaurant[]>([])
  const [emails, setEmails] = useState<Record<string, string>>({})
  const [stats, setStats] = useState<Record<string, Stats>>({})
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('all')
  const [selected, setSelected] = useState<Restaurant | null>(null)
  const [note, setNote] = useState('')
  const [notes, setNotes] = useState<any[]>([])
  const [savingNote, setSavingNote] = useState(false)
  const [editSub, setEditSub] = useState(false)
  const [subForm, setSubForm] = useState({ status: '', plan: '', ends_at: '' })

  const adminApi = (body: any) =>
    fetch('/api/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json())

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) { router.replace('/auth/login'); return }
      if (data.user.email !== ADMIN_EMAIL) { router.replace('/dashboard'); return }
      setUser(data.user); setAuthorized(true); await loadAll()
    })
  }, [])

  const loadAll = async () => {
    setLoading(true)
    const json = await adminApi({ action: 'list' })
    setRestaurants(json.restaurants || []); setStats(json.stats || {}); setEmails(json.emails || {})
    setLoading(false)
  }
  const loadNotes = async (restaurantId: string) => {
    const json = await adminApi({ action: 'notes', restaurantId }); setNotes(json.notes || [])
  }
  const selectRestaurant = async (r: Restaurant) => {
    setSelected(r)
    setSubForm({ status: r.subscription_status || 'active', plan: r.subscription_plan || 'business', ends_at: r.subscription_ends_at ? r.subscription_ends_at.slice(0, 10) : '' })
    setEditSub(false); await loadNotes(r.id)
  }
  const saveNote = async () => {
    if (!note.trim() || !selected) return
    setSavingNote(true)
    await adminApi({ action: 'addNote', restaurantId: selected.id, note: note.trim() })
    setNote(''); await loadNotes(selected.id); setSavingNote(false)
  }
  const saveSub = async () => {
    if (!selected) return
    await adminApi({ action: 'updateSub', restaurantId: selected.id, status: subForm.status, plan: subForm.plan, ends_at: subForm.ends_at || null })
    setSelected({ ...selected, subscription_status: subForm.status, subscription_plan: subForm.plan, subscription_ends_at: subForm.ends_at || null })
    setEditSub(false); await loadAll()
  }
  const extendSub = async (days: number) => {
    if (!selected) return
    const base = selected.subscription_ends_at ? new Date(selected.subscription_ends_at) : new Date()
    base.setDate(base.getDate() + days)
    const newDate = base.toISOString()
    await adminApi({ action: 'extendSub', restaurantId: selected.id, endsAt: newDate })
    setSelected({ ...selected, subscription_ends_at: newDate, subscription_status: 'active' }); await loadAll()
  }
  const freeze = async () => {
    if (!selected) return
    await adminApi({ action: 'freeze', restaurantId: selected.id })
    setSelected({ ...selected, subscription_status: 'frozen' }); await loadAll()
  }

  const statusColor = (s: string) => (t as any)[STATUS[s]?.key || 'text3'] as string
  const statusLabel = (s: string) => STATUS[s]?.label || s

  if (!authorized || !t.mounted) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: '-apple-system,sans-serif', color: t.text3, background: t.bg }}>
      Проверка доступа...
    </div>
  )

  const filtered = restaurants.filter(r => {
    const matchSearch = `${r.name} ${emails[r.owner_id] || ''}`.toLowerCase().includes(search.toLowerCase())
    const matchStatus = filterStatus === 'all' || r.subscription_status === filterStatus
    return matchSearch && matchStatus
  })

  const totalActive = restaurants.filter(r => r.subscription_status === 'active').length
  const totalTrial = restaurants.filter(r => r.subscription_status === 'trialing').length
  const mrr = restaurants.filter(r => r.subscription_status === 'active').reduce((s, r) => s + (PLAN_PRICE[r.subscription_plan] || 0), 0)

  const card: React.CSSProperties = { background: t.surface, borderRadius: 16, boxShadow: t.sh }
  const chip = (active: boolean): React.CSSProperties => ({ padding: '9px 15px', borderRadius: 12, border: 'none', fontFamily: 'inherit', fontSize: '.82rem', fontWeight: 600, cursor: 'pointer', background: active ? t.text : t.surface, color: active ? t.bg : t.text3, boxShadow: active ? 'none' : t.sh2 })

  return (
    <div style={{ minHeight: '100vh', background: t.bg, fontFamily: "-apple-system,BlinkMacSystemFont,'SF Pro Text',sans-serif", WebkitFontSmoothing: 'antialiased', color: t.text }}>
      {/* NAV */}
      <nav style={{ background: t.hbg, backdropFilter: 'blur(20px)', borderBottom: `0.5px solid ${t.sep2}`, padding: '0 24px', height: 54, display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 100 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ fontWeight: 800, fontSize: '1.1rem', color: t.text, letterSpacing: '-.02em' }}>mise</div>
          <div style={{ background: `${t.red}1a`, color: t.red, fontSize: '.7rem', fontWeight: 700, padding: '3px 10px', borderRadius: 980 }}>Super Admin</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <span style={{ fontSize: '.82rem', color: t.text3 }}>{user?.email}</span>
          <button onClick={t.toggle} style={{ width: 34, height: 34, borderRadius: '50%', background: t.fill, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: t.text }}>
            {t.dark
              ? <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="5" /><path d="M12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" /></svg>
              : <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M21 12.8A9 9 0 1111.2 3 7 7 0 0021 12.8z" /></svg>}
          </button>
          <button onClick={async () => { await supabase.auth.signOut(); router.replace('/auth/login') }} style={{ background: 'none', border: 'none', color: t.red, cursor: 'pointer', fontSize: '.82rem', fontFamily: 'inherit', fontWeight: 600 }}>Выйти</button>
        </div>
      </nav>

      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '24px 20px', display: 'grid', gridTemplateColumns: selected ? '1fr 380px' : '1fr', gap: 20 }}>
        <div>
          {/* Summary */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 20 }}>
            {[
              { l: 'Всего клиентов', v: String(restaurants.length), c: t.text },
              { l: 'Активных', v: String(totalActive), c: t.green },
              { l: 'Пробных', v: String(totalTrial), c: t.blue },
              { l: 'MRR / мес', v: `€${mrr}`, c: t.orange },
            ].map(item => (
              <div key={item.l} style={{ ...card, padding: 16 }}>
                <div style={{ fontSize: '.72rem', color: t.text3, fontWeight: 600, textTransform: 'uppercase', letterSpacing: .4, marginBottom: 6 }}>{item.l}</div>
                <div style={{ fontSize: '1.6rem', fontWeight: 700, color: item.c }}>{item.v}</div>
              </div>
            ))}
          </div>

          {/* Filters */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
            <div style={{ position: 'relative', flex: 1, minWidth: 220 }}>
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Поиск по названию или email..."
                style={{ width: '100%', padding: '10px 14px 10px 38px', borderRadius: 12, border: `1px solid ${t.sep2}`, fontSize: '.9rem', fontFamily: 'inherit', outline: 'none', color: t.text, background: t.surface, boxSizing: 'border-box' }} />
              <svg style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }} width="16" height="16" fill="none" stroke={t.text3} strokeWidth="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></svg>
            </div>
            {['all', 'active', 'trialing', 'past_due', 'canceled', 'frozen'].map(s => (
              <button key={s} onClick={() => setFilterStatus(s)} style={chip(filterStatus === s)}>{s === 'all' ? 'Все' : statusLabel(s)}</button>
            ))}
          </div>

          {/* List */}
          {loading ? <div style={{ textAlign: 'center', padding: 60, color: t.text3 }}>Загрузка...</div>
            : filtered.length === 0 ? <div style={{ ...card, padding: 40, textAlign: 'center', color: t.text3 }}>Ничего не найдено</div>
              : <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {filtered.map(r => {
                  const st = stats[r.id]; const days = daysLeft(r.subscription_ends_at); const isSel = selected?.id === r.id
                  const sc = statusColor(r.subscription_status)
                  return (
                    <div key={r.id} onClick={() => selectRestaurant(r)} style={{ ...card, padding: 18, cursor: 'pointer', border: `1px solid ${isSel ? t.blue : 'transparent'}` }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4, flexWrap: 'wrap' }}>
                            <div style={{ fontWeight: 700, fontSize: '1rem', color: t.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name || 'Без названия'}</div>
                            <span style={{ background: `${sc}1a`, color: sc, fontSize: '.72rem', fontWeight: 700, padding: '3px 10px', borderRadius: 980 }}>{statusLabel(r.subscription_status)}</span>
                            {days !== null && days <= 7 && days > 0 && <span style={{ background: `${t.orange}1a`, color: t.orange, fontSize: '.72rem', fontWeight: 700, padding: '3px 10px', borderRadius: 980 }}>Осталось {days}д</span>}
                            {days !== null && days <= 0 && <span style={{ background: `${t.red}1a`, color: t.red, fontSize: '.72rem', fontWeight: 700, padding: '3px 10px', borderRadius: 980 }}>Истекла</span>}
                          </div>
                          <div style={{ fontSize: '.78rem', color: t.text3, marginBottom: 6 }}>{emails[r.owner_id] || '—'} · {r.subscription_plan || '—'}</div>
                          <div style={{ display: 'flex', gap: 16, fontSize: '.76rem', color: t.text3, flexWrap: 'wrap' }}>
                            <span>Смен: <strong style={{ color: t.text }}>{st?.shifts || 0}</strong></span>
                            <span>Табак: <strong style={{ color: t.text }}>{st?.movements || 0}</strong></span>
                            <span>Сотрудников: <strong style={{ color: t.text }}>{st?.employees || 0}</strong></span>
                            <span>С: <strong style={{ color: t.text }}>{dmy(r.created_at)}</strong></span>
                            {st?.lastActive && <span>Активен: <strong style={{ color: t.green }}>{dmy(st.lastActive)}</strong></span>}
                          </div>
                        </div>
                        <svg width="16" height="16" fill="none" stroke={t.text3} strokeWidth="2" viewBox="0 0 24 24"><path d="M9 18l6-6-6-6" /></svg>
                      </div>
                    </div>
                  )
                })}
              </div>}
        </div>

        {/* Detail */}
        {selected && (
          <div style={{ position: 'sticky', top: 74, height: 'fit-content' }}>
            <div style={{ ...card, padding: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                <div style={{ fontWeight: 700, fontSize: '1.05rem', color: t.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 240 }}>{selected.name}</div>
                <button onClick={() => setSelected(null)} style={{ background: 'none', border: 'none', color: t.text3, fontSize: 22, cursor: 'pointer', padding: 0, lineHeight: 1 }}>×</button>
              </div>
              <div style={{ fontSize: '.8rem', color: t.text3, marginBottom: 16 }}>{emails[selected.owner_id] || '—'}</div>

              {/* Subscription */}
              <div style={{ fontSize: '.72rem', color: t.text3, fontWeight: 600, textTransform: 'uppercase', marginBottom: 8 }}>Подписка</div>
              {!editSub ? (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <span style={{ background: `${statusColor(selected.subscription_status)}1a`, color: statusColor(selected.subscription_status), fontSize: '.72rem', fontWeight: 700, padding: '3px 10px', borderRadius: 980 }}>{statusLabel(selected.subscription_status)}</span>
                    <span style={{ fontSize: '.82rem', color: t.text3 }}>{selected.subscription_plan || 'business'} · €{PLAN_PRICE[selected.subscription_plan] || 0}/мес</span>
                  </div>
                  {selected.subscription_ends_at && (
                    <div style={{ fontSize: '.82rem', color: t.text3, marginBottom: 8 }}>
                      До: <strong style={{ color: t.text }}>{dmy(selected.subscription_ends_at)}</strong>
                      {daysLeft(selected.subscription_ends_at) !== null && <span style={{ color: (daysLeft(selected.subscription_ends_at) || 0) > 7 ? t.green : t.red, marginLeft: 6 }}>({daysLeft(selected.subscription_ends_at)}д)</span>}
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <button onClick={() => setEditSub(true)} style={btn(t, 'ghost')}>Изменить</button>
                    <button onClick={() => extendSub(30)} style={btn(t, 'gray')}>+30 дней</button>
                    <button onClick={() => extendSub(7)} style={btn(t, 'gray')}>+7 дней</button>
                  </div>
                </div>
              ) : (
                <div style={{ marginBottom: 16 }}>
                  <label style={lbl(t)}>Статус</label>
                  <select value={subForm.status} onChange={e => setSubForm({ ...subForm, status: e.target.value })} style={sel(t)}>
                    {['active', 'trialing', 'past_due', 'canceling', 'canceled', 'frozen'].map(s => <option key={s} value={s}>{statusLabel(s)}</option>)}
                  </select>
                  <label style={lbl(t)}>Тариф</label>
                  <select value={subForm.plan} onChange={e => setSubForm({ ...subForm, plan: e.target.value })} style={sel(t)}>
                    {['starter', 'business', 'pro'].map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                  <label style={lbl(t)}>Дата окончания</label>
                  <input type="date" value={subForm.ends_at} onChange={e => setSubForm({ ...subForm, ends_at: e.target.value })} style={sel(t)} />
                  <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                    <button onClick={saveSub} style={btn(t, 'primary')}>Сохранить</button>
                    <button onClick={() => setEditSub(false)} style={btn(t, 'gray')}>Отмена</button>
                  </div>
                </div>
              )}

              {/* Stats */}
              <div style={{ borderTop: `1px solid ${t.sep2}`, paddingTop: 16, marginBottom: 16 }}>
                <div style={{ fontSize: '.72rem', color: t.text3, fontWeight: 600, textTransform: 'uppercase', marginBottom: 10 }}>Активность</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  {[
                    { l: 'Смен', v: stats[selected.id]?.shifts || 0, c: t.blue },
                    { l: 'Сотрудников', v: stats[selected.id]?.employees || 0, c: t.green },
                    { l: 'Движений табак', v: stats[selected.id]?.movements || 0, c: t.orange },
                    { l: 'Подключён', v: dmy(selected.created_at), c: t.text3 },
                  ].map(item => (
                    <div key={item.l} style={{ background: t.fill2, borderRadius: 10, padding: '10px 12px' }}>
                      <div style={{ fontSize: '.66rem', color: t.text3, fontWeight: 600, textTransform: 'uppercase', marginBottom: 3 }}>{item.l}</div>
                      <div style={{ fontSize: '1.05rem', fontWeight: 700, color: item.c }}>{item.v}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Quick actions */}
              <div style={{ borderTop: `1px solid ${t.sep2}`, paddingTop: 16, marginBottom: 16 }}>
                <div style={{ fontSize: '.72rem', color: t.text3, fontWeight: 600, textTransform: 'uppercase', marginBottom: 10 }}>Действия</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <button onClick={() => extendSub(30)} style={btn(t, 'orange')}>Продлить на 30 дней</button>
                  <button onClick={freeze} style={btn(t, 'danger')}>Заморозить</button>
                </div>
              </div>

              {/* Notes */}
              <div style={{ borderTop: `1px solid ${t.sep2}`, paddingTop: 16 }}>
                <div style={{ fontSize: '.72rem', color: t.text3, fontWeight: 600, textTransform: 'uppercase', marginBottom: 10 }}>Заметки</div>
                <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
                  <input value={note} onChange={e => setNote(e.target.value)} onKeyDown={e => e.key === 'Enter' && saveNote()} placeholder="Добавить заметку..."
                    style={{ flex: 1, padding: '8px 10px', borderRadius: 8, border: `1px solid ${t.sep2}`, fontFamily: 'inherit', fontSize: '.85rem', color: t.text, background: t.surface, outline: 'none' }} />
                  <button onClick={saveNote} disabled={savingNote} style={btn(t, 'primary')}>+</button>
                </div>
                <div style={{ maxHeight: 200, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {notes.length === 0 ? <div style={{ fontSize: '.82rem', color: t.text4 }}>Заметок нет</div>
                    : notes.map(n => (
                      <div key={n.id} style={{ background: t.fill2, borderRadius: 8, padding: '8px 10px' }}>
                        <div style={{ fontSize: '.82rem', color: t.text, marginBottom: 2 }}>{n.note}</div>
                        <div style={{ fontSize: '.66rem', color: t.text4 }}>{dmy(n.created_at)}</div>
                      </div>
                    ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function btn(t: any, v: 'primary' | 'ghost' | 'gray' | 'danger' | 'orange'): React.CSSProperties {
  const m: Record<string, React.CSSProperties> = {
    primary: { background: t.blue, color: '#fff', border: 'none' },
    ghost: { background: 'transparent', color: t.blue, border: `1px solid ${t.blue}55` },
    gray: { background: t.fill, color: t.text, border: 'none' },
    danger: { background: `${t.red}1a`, color: t.red, border: 'none' },
    orange: { background: `${t.orange}1a`, color: t.orange, border: 'none' },
  }
  return { ...m[v], padding: '8px 14px', borderRadius: 10, fontFamily: 'inherit', fontSize: '.82rem', fontWeight: 600, cursor: 'pointer' }
}
function lbl(t: any): React.CSSProperties { return { display: 'block', fontSize: '.68rem', color: t.text3, fontWeight: 600, textTransform: 'uppercase', marginBottom: 4, marginTop: 8 } }
function sel(t: any): React.CSSProperties { return { width: '100%', padding: '8px 10px', borderRadius: 8, border: `1px solid ${t.sep2}`, fontFamily: 'inherit', fontSize: '.88rem', color: t.text, background: t.surface, outline: 'none', boxSizing: 'border-box' } }
