'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'



const ADMIN_EMAIL = 'raxim98@gmail.com'

interface Restaurant {
  id: string; name: string; currency: string; owner_id: string
  subscription_status: string; subscription_plan: string
  subscription_ends_at: string | null; created_at: string
}
interface Profile { id: string; restaurant_id: string }
interface Stats {
  shifts: number; movements: number; employees: number; lastActive: string | null
}

function Card({ children, style = {}, onClick }: { children: any; style?: any; onClick?: () => void }) {
  return <div onClick={onClick} style={{ background:'#fff', borderRadius:16, padding:24, boxShadow:'0 1px 3px rgba(0,0,0,.06),0 4px 16px rgba(0,0,0,.04)', ...style }}>{children}</div>
}

function Badge({ children, color }: { children: any; color: string }) {
  return <span style={{ background:color+'18', color, fontSize:'.72rem', fontWeight:700, padding:'3px 10px', borderRadius:980 }}>{children}</span>
}

function Btn({ children, onClick, variant='primary', small=false, disabled=false }: any) {
  const s: any = { primary:{background:'#007aff',color:'#fff',border:'none'}, danger:{background:'#ff3b30',color:'#fff',border:'none'}, ghost:{background:'transparent',color:'#007aff',border:'1px solid rgba(0,122,255,.3)'}, gray:{background:'#f2f2f7',color:'#1c1c1e',border:'none'}, orange:{background:'#ff9500',color:'#fff',border:'none'} }
  return <button onClick={onClick} disabled={disabled} style={{ ...s[variant], padding:small?'6px 14px':'10px 20px', borderRadius:980, fontFamily:'inherit', fontSize:small?'.78rem':'.88rem', fontWeight:600, cursor:disabled?'not-allowed':'pointer', opacity:disabled?.5:1 }}>{children}</button>
}

function statusColor(s: string) {
  if (s === 'active') return '#34c759'
  if (s === 'trial') return '#007aff'
  if (s === 'expired') return '#ff3b30'
  if (s === 'frozen') return '#aeaeb2'
  return '#ff9500'
}

function statusLabel(s: string) {
  if (s === 'active') return 'Активна'
  if (s === 'trial') return 'Пробный'
  if (s === 'expired') return 'Истекла'
  if (s === 'frozen') return 'Заморожена'
  return s
}

function daysLeft(endsAt: string | null) {
  if (!endsAt) return null
  const diff = Math.ceil((new Date(endsAt).getTime() - Date.now()) / 86400000)
  return diff
}

function timeAgo(iso: string) {
  const d = new Date(iso)
  return d.toLocaleDateString('ru-RU', { day:'2-digit', month:'2-digit', year:'numeric' })
}

export default function AdminPage() {
  const [user, setUser] = useState<any>(null)
  const [authorized, setAuthorized] = useState(false)
  const [restaurants, setRestaurants] = useState<Restaurant[]>([])
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [ownerEmails, setOwnerEmails] = useState<Record<string,string>>({})
  const [stats, setStats] = useState<Record<string,Stats>>({})
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('all')
  const [selected, setSelected] = useState<Restaurant|null>(null)
  const [note, setNote] = useState('')
  const [notes, setNotes] = useState<any[]>([])
  const [savingNote, setSavingNote] = useState(false)
  const [editSub, setEditSub] = useState(false)
  const [subForm, setSubForm] = useState({ status:'', plan:'', ends_at:'' })

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) { window.location.href = '/auth/login'; return }
      if (data.user.email !== ADMIN_EMAIL) { window.location.href = '/dashboard'; return }
      setUser(data.user)
      setAuthorized(true)
      await loadAll()
    })
  }, [])

  const loadAll = async () => {
    setLoading(true)
    const { data: rests } = await supabase.from('restaurants').select('*').order('created_at', { ascending: false })
    setRestaurants(rests || [])

    // Load stats for each restaurant
    const statsMap: Record<string,Stats> = {}
    for (const r of rests || []) {
      const [s1, s2, s3] = await Promise.all([
        supabase.from('shifts').select('id,created_at').eq('restaurant_id', r.id).order('created_at', { ascending: false }).limit(1),
        supabase.from('tobacco_movements').select('id').eq('restaurant_id', r.id),
        supabase.from('employees').select('id').eq('restaurant_id', r.id).eq('is_active', true),
      ])
      const shiftsCount = await supabase.from('shifts').select('id', { count: 'exact' }).eq('restaurant_id', r.id)
      statsMap[r.id] = {
        shifts: shiftsCount.count || 0,
        movements: s2.data?.length || 0,
        employees: s3.data?.length || 0,
        lastActive: s1.data?.[0]?.created_at || null
      }
    }
    setStats(statsMap)
    setLoading(false)
  }

  const loadNotes = async (restaurantId: string) => {
    const { data } = await supabase.from('admin_notes').select('*').eq('restaurant_id', restaurantId).order('created_at', { ascending: false })
    setNotes(data || [])
  }

  const selectRestaurant = async (r: Restaurant) => {
    setSelected(r)
    setSubForm({ status: r.subscription_status || 'active', plan: r.subscription_plan || 'business', ends_at: r.subscription_ends_at ? r.subscription_ends_at.slice(0,10) : '' })
    setEditSub(false)
    await loadNotes(r.id)
  }

  const saveNote = async () => {
    if (!note.trim() || !selected) return
    setSavingNote(true)
    await supabase.from('admin_notes').insert({ restaurant_id: selected.id, note: note.trim() })
    setNote(''); await loadNotes(selected.id)
    setSavingNote(false)
  }

  const saveSub = async () => {
    if (!selected) return
    await supabase.from('restaurants').update({
      subscription_status: subForm.status,
      subscription_plan: subForm.plan,
      subscription_ends_at: subForm.ends_at || null
    }).eq('id', selected.id)
    setSelected({ ...selected, subscription_status: subForm.status, subscription_plan: subForm.plan, subscription_ends_at: subForm.ends_at || null })
    setEditSub(false)
    await loadAll()
  }

  const extendSub = async (days: number) => {
    if (!selected) return
    const base = selected.subscription_ends_at ? new Date(selected.subscription_ends_at) : new Date()
    base.setDate(base.getDate() + days)
    const newDate = base.toISOString()
    await supabase.from('restaurants').update({ subscription_ends_at: newDate, subscription_status: 'active' }).eq('id', selected.id)
    setSelected({ ...selected, subscription_ends_at: newDate, subscription_status: 'active' })
    await loadAll()
  }

  if (!authorized) return (
    <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', fontFamily:'-apple-system,sans-serif', color:'#6d6d72' }}>
      Проверка доступа...
    </div>
  )

  const filtered = restaurants.filter(r => {
    const matchSearch = `${r.name}`.toLowerCase().includes(search.toLowerCase())
    const matchStatus = filterStatus === 'all' || r.subscription_status === filterStatus
    return matchSearch && matchStatus
  })

  // Summary stats
  const totalActive = restaurants.filter(r=>r.subscription_status==='active').length
  const totalTrial = restaurants.filter(r=>r.subscription_status==='trial').length
  const totalExpired = restaurants.filter(r=>r.subscription_status==='expired').length
  const totalRevenue = totalActive * 24 + totalTrial * 0

  return (
    <div style={{ minHeight:'100vh', background:'#f2f2f7', fontFamily:"-apple-system,BlinkMacSystemFont,'SF Pro Text',sans-serif", WebkitFontSmoothing:'antialiased' }}>
      {/* Header */}
      <nav style={{ background:'rgba(255,255,255,.92)', backdropFilter:'blur(20px)', borderBottom:'1px solid rgba(60,60,67,.13)', padding:'0 24px', height:52, display:'flex', alignItems:'center', justifyContent:'space-between', position:'sticky' as const, top:0, zIndex:100 }}>
        <div style={{ display:'flex', alignItems:'center', gap:12 }}>
          <div style={{ fontWeight:700, fontSize:'1.1rem', color:'#1c1c1e' }}>Mise</div>
          <div style={{ background:'rgba(255,59,48,.1)', color:'#ff3b30', fontSize:'.72rem', fontWeight:700, padding:'3px 10px', borderRadius:980 }}>Super Admin</div>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:16 }}>
          <span style={{ fontSize:'.82rem', color:'#6d6d72' }}>{user?.email}</span>
          <button onClick={async()=>{await supabase.auth.signOut();window.location.href='/auth/login'}}
            style={{ background:'none', border:'none', color:'#ff3b30', cursor:'pointer', fontSize:'.82rem', fontFamily:'inherit', fontWeight:600 }}>Выйти</button>
        </div>
      </nav>

      <div style={{ maxWidth:1200, margin:'0 auto', padding:'28px 20px', display:'grid', gridTemplateColumns: selected ? '1fr 380px' : '1fr', gap:20 }}>
        <div>
          {/* Summary cards */}
          <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:12, marginBottom:20 }}>
            {[
              { l:'Всего клиентов', v:restaurants.length, c:'#1c1c1e' },
              { l:'Активных', v:totalActive, c:'#34c759' },
              { l:'Пробных', v:totalTrial, c:'#007aff' },
              { l:'Выручка / мес', v:`€${totalRevenue}`, c:'#ff9500' },
            ].map(item => (
              <Card key={item.l} style={{ padding:16 }}>
                <div style={{ fontSize:'.72rem', color:'#6d6d72', fontWeight:600, textTransform:'uppercase' as const, letterSpacing:.4, marginBottom:6 }}>{item.l}</div>
                <div style={{ fontSize:'1.6rem', fontWeight:700, color:item.c }}>{item.v}</div>
              </Card>
            ))}
          </div>

          {/* Filters */}
          <div style={{ display:'flex', gap:8, marginBottom:16, flexWrap:'wrap' as const }}>
            <div style={{ position:'relative', flex:1, minWidth:200 }}>
              <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Поиск по названию..."
                style={{ width:'100%', padding:'10px 14px 10px 38px', borderRadius:12, border:'1px solid rgba(60,60,67,.2)', fontSize:'.9rem', fontFamily:'inherit', outline:'none', color:'#1c1c1e', background:'#fff', boxSizing:'border-box' as const }} />
              <svg style={{ position:'absolute', left:12, top:'50%', transform:'translateY(-50%)' }} width="16" height="16" fill="none" stroke="#aeaeb2" strokeWidth="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
            </div>
            {['all','active','trial','expired','frozen'].map(s => (
              <button key={s} onClick={()=>setFilterStatus(s)} style={{ padding:'10px 16px', borderRadius:12, border:'none', fontFamily:'inherit', fontSize:'.82rem', fontWeight:600, cursor:'pointer', background:filterStatus===s?'#1c1c1e':'#fff', color:filterStatus===s?'#fff':'#6d6d72', boxShadow:'0 1px 3px rgba(0,0,0,.06)' }}>
                {s==='all'?'Все':statusLabel(s)}
              </button>
            ))}
          </div>

          {/* Restaurant list */}
          {loading ? <div style={{ textAlign:'center' as const, padding:60, color:'#6d6d72' }}>Загрузка...</div>
            : filtered.length === 0 ? <Card><div style={{ textAlign:'center' as const, padding:40, color:'#6d6d72' }}>Ничего не найдено</div></Card>
            : <div style={{ display:'flex', flexDirection:'column' as const, gap:10 }}>
                {filtered.map(r => {
                  const st = stats[r.id]
                  const days = daysLeft(r.subscription_ends_at)
                  const isSelected = selected?.id === r.id
                  return (
                    <Card key={r.id} style={{ cursor:'pointer', border: isSelected ? '1px solid #007aff' : '1px solid transparent', transition:'all .15s' }} onClick={()=>selectRestaurant(r)}>
                      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:16 }}>
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:6 }}>
                            <div style={{ fontWeight:700, fontSize:'1rem', color:'#1c1c1e', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' as const }}>{r.name || 'Без названия'}</div>
                            <Badge color={statusColor(r.subscription_status)}>{statusLabel(r.subscription_status)}</Badge>
                            {days !== null && days <= 7 && days > 0 && <Badge color="#ff9500">Осталось {days}д</Badge>}
                            {days !== null && days <= 0 && <Badge color="#ff3b30">Истекла</Badge>}
                          </div>
                          <div style={{ display:'flex', gap:16, fontSize:'.78rem', color:'#6d6d72', flexWrap:'wrap' as const }}>
                            <span>Смен: <strong style={{ color:'#1c1c1e' }}>{st?.shifts || 0}</strong></span>
                            <span>Табак: <strong style={{ color:'#1c1c1e' }}>{st?.movements || 0}</strong></span>
                            <span>Сотрудников: <strong style={{ color:'#1c1c1e' }}>{st?.employees || 0}</strong></span>
                            <span>С: <strong style={{ color:'#1c1c1e' }}>{timeAgo(r.created_at)}</strong></span>
                            {st?.lastActive && <span>Активен: <strong style={{ color:'#34c759' }}>{timeAgo(st.lastActive)}</strong></span>}
                          </div>
                        </div>
                        <svg width="16" height="16" fill="none" stroke="#aeaeb2" strokeWidth="2" viewBox="0 0 24 24"><path d="M9 18l6-6-6-6"/></svg>
                      </div>
                    </Card>
                  )
                })}
              </div>
          }
        </div>

        {/* Detail panel */}
        {selected && (
          <div style={{ position:'sticky' as const, top:72, height:'fit-content', display:'flex', flexDirection:'column' as const, gap:12 }}>
            <Card>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:16 }}>
                <div style={{ fontWeight:700, fontSize:'1.05rem', color:'#1c1c1e', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' as const, maxWidth:220 }}>{selected.name}</div>
                <button onClick={()=>setSelected(null)} style={{ background:'none', border:'none', color:'#aeaeb2', fontSize:20, cursor:'pointer', padding:0 }}>×</button>
              </div>

              {/* Subscription */}
              <div style={{ marginBottom:16 }}>
                <div style={{ fontSize:'.72rem', color:'#6d6d72', fontWeight:600, textTransform:'uppercase' as const, marginBottom:8 }}>Подписка</div>
                {!editSub ? (
                  <div>
                    <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:8 }}>
                      <Badge color={statusColor(selected.subscription_status)}>{statusLabel(selected.subscription_status)}</Badge>
                      <span style={{ fontSize:'.82rem', color:'#6d6d72' }}>{selected.subscription_plan || 'business'}</span>
                    </div>
                    {selected.subscription_ends_at && (
                      <div style={{ fontSize:'.82rem', color:'#6d6d72', marginBottom:8 }}>
                        До: <strong style={{ color:'#1c1c1e' }}>{timeAgo(selected.subscription_ends_at)}</strong>
                        {daysLeft(selected.subscription_ends_at) !== null && (
                          <span style={{ color: (daysLeft(selected.subscription_ends_at)||0) > 7 ? '#34c759' : '#ff3b30', marginLeft:6 }}>
                            ({daysLeft(selected.subscription_ends_at)}д)
                          </span>
                        )}
                      </div>
                    )}
                    <div style={{ display:'flex', gap:6, flexWrap:'wrap' as const }}>
                      <Btn small variant="ghost" onClick={()=>setEditSub(true)}>Изменить</Btn>
                      <Btn small variant="gray" onClick={()=>extendSub(30)}>+30 дней</Btn>
                      <Btn small variant="gray" onClick={()=>extendSub(7)}>+7 дней</Btn>
                    </div>
                  </div>
                ) : (
                  <div>
                    <div style={{ marginBottom:8 }}>
                      <label style={{ fontSize:'.72rem', color:'#6d6d72', fontWeight:600, textTransform:'uppercase' as const, display:'block', marginBottom:4 }}>Статус</label>
                      <select value={subForm.status} onChange={e=>setSubForm({...subForm,status:e.target.value})}
                        style={{ width:'100%', padding:'8px 10px', borderRadius:8, border:'1px solid rgba(60,60,67,.2)', fontFamily:'inherit', fontSize:'.88rem', color:'#1c1c1e' }}>
                        <option value="active">Активна</option>
                        <option value="trial">Пробный</option>
                        <option value="frozen">Заморожена</option>
                        <option value="expired">Истекла</option>
                      </select>
                    </div>
                    <div style={{ marginBottom:8 }}>
                      <label style={{ fontSize:'.72rem', color:'#6d6d72', fontWeight:600, textTransform:'uppercase' as const, display:'block', marginBottom:4 }}>Дата окончания</label>
                      <input type="date" value={subForm.ends_at} onChange={e=>setSubForm({...subForm,ends_at:e.target.value})}
                        style={{ width:'100%', padding:'8px 10px', borderRadius:8, border:'1px solid rgba(60,60,67,.2)', fontFamily:'inherit', fontSize:'.88rem', color:'#1c1c1e' }} />
                    </div>
                    <div style={{ display:'flex', gap:6 }}>
                      <Btn small onClick={saveSub}>Сохранить</Btn>
                      <Btn small variant="gray" onClick={()=>setEditSub(false)}>Отмена</Btn>
                    </div>
                  </div>
                )}
              </div>

              {/* Stats */}
              <div style={{ borderTop:'1px solid rgba(60,60,67,.08)', paddingTop:16, marginBottom:16 }}>
                <div style={{ fontSize:'.72rem', color:'#6d6d72', fontWeight:600, textTransform:'uppercase' as const, marginBottom:10 }}>Активность</div>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
                  {[
                    { l:'Смен', v:stats[selected.id]?.shifts || 0, c:'#007aff' },
                    { l:'Сотрудников', v:stats[selected.id]?.employees || 0, c:'#34c759' },
                    { l:'Движений табак', v:stats[selected.id]?.movements || 0, c:'#ff9500' },
                    { l:'Подключён', v:timeAgo(selected.created_at), c:'#6d6d72' },
                  ].map(item => (
                    <div key={item.l} style={{ background:'#f9f9f9', borderRadius:10, padding:'10px 12px' }}>
                      <div style={{ fontSize:'.68rem', color:'#6d6d72', fontWeight:600, textTransform:'uppercase' as const, marginBottom:3 }}>{item.l}</div>
                      <div style={{ fontSize:'1.1rem', fontWeight:700, color:item.c }}>{item.v}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Quick actions */}
              <div style={{ borderTop:'1px solid rgba(60,60,67,.08)', paddingTop:16, marginBottom:16 }}>
                <div style={{ fontSize:'.72rem', color:'#6d6d72', fontWeight:600, textTransform:'uppercase' as const, marginBottom:10 }}>Быстрые действия</div>
                <div style={{ display:'flex', flexDirection:'column' as const, gap:6 }}>
                  <Btn variant="ghost" small onClick={()=>window.open(`/dashboard?impersonate=${selected.owner_id}`)}>Войти как клиент</Btn>
                  <Btn variant="orange" small onClick={()=>extendSub(30)}>Продлить на 30 дней</Btn>
                  <Btn variant="danger" small onClick={async()=>{
                    await supabase.from('restaurants').update({subscription_status:'frozen'}).eq('id',selected.id)
                    setSelected({...selected,subscription_status:'frozen'})
                    loadAll()
                  }}>Заморозить</Btn>
                </div>
              </div>

              {/* Notes */}
              <div style={{ borderTop:'1px solid rgba(60,60,67,.08)', paddingTop:16 }}>
                <div style={{ fontSize:'.72rem', color:'#6d6d72', fontWeight:600, textTransform:'uppercase' as const, marginBottom:10 }}>Заметки</div>
                <div style={{ display:'flex', gap:6, marginBottom:10 }}>
                  <input value={note} onChange={e=>setNote(e.target.value)} onKeyDown={e=>e.key==='Enter'&&saveNote()} placeholder="Добавить заметку..."
                    style={{ flex:1, padding:'8px 10px', borderRadius:8, border:'1px solid rgba(60,60,67,.2)', fontFamily:'inherit', fontSize:'.85rem', color:'#1c1c1e', outline:'none' }} />
                  <Btn small onClick={saveNote} disabled={savingNote}>+</Btn>
                </div>
                <div style={{ maxHeight:200, overflowY:'auto' as const, display:'flex', flexDirection:'column' as const, gap:6 }}>
                  {notes.length===0 ? <div style={{ fontSize:'.82rem', color:'#aeaeb2' }}>Заметок нет</div>
                    : notes.map(n => (
                        <div key={n.id} style={{ background:'#f9f9f9', borderRadius:8, padding:'8px 10px' }}>
                          <div style={{ fontSize:'.82rem', color:'#1c1c1e', marginBottom:2 }}>{n.note}</div>
                          <div style={{ fontSize:'.68rem', color:'#aeaeb2' }}>{timeAgo(n.created_at)}</div>
                        </div>
                      ))
                  }
                </div>
              </div>
            </Card>
          </div>
        )}
      </div>
    </div>
  )
}
