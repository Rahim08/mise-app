'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export default function Dashboard() {
  const [user, setUser] = useState<any>(null)
  const [restaurant, setRestaurant] = useState<any>(null)
  const [tab, setTab] = useState('apps')

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) { window.location.href = '/auth/login'; return; }
      setUser(data.user)
      const { data: rest } = await supabase
        .from('restaurants').select('*')
        .eq('owner_id', data.user.id).single()
      setRestaurant(rest)
    })
  }, [])

  const handleLogout = async () => {
    await supabase.auth.signOut()
    window.location.href = '/auth/login'
  }

  if (!user) return null

  const s: any = {
    page: { minHeight:'100vh', background:'#f5f5f7', fontFamily:'-apple-system,BlinkMacSystemFont,sans-serif' },
    nav: { background:'rgba(255,255,255,0.92)', backdropFilter:'blur(20px)', borderBottom:'0.5px solid rgba(0,0,0,0.1)', padding:'0 24px', height:52, display:'flex', alignItems:'center', justifyContent:'space-between', position:'sticky' as const, top:0, zIndex:100 },
    logo: { fontSize:'1.1rem', fontWeight:700, letterSpacing:'-.02em' },
    logout: { background:'none', border:'none', color:'#ff3b30', cursor:'pointer', fontSize:'.82rem', fontFamily:'inherit' },
    body: { maxWidth:900, margin:'0 auto', padding:'32px 24px' },
    welcome: { fontSize:'1.8rem', fontWeight:700, letterSpacing:'-.03em', marginBottom:4 },
    email: { fontSize:'.85rem', color:'#6e6e73', marginBottom:32 },
    tabs: { display:'flex', gap:0, marginBottom:28, background:'#e5e5ea', borderRadius:10, padding:2 },
    tab: (active: boolean) => ({ flex:1, padding:'8px 0', border:'none', borderRadius:8, fontFamily:'inherit', fontSize:'.82rem', fontWeight:500, cursor:'pointer', background: active ? '#fff' : 'transparent', color: active ? '#1d1d1f' : '#6e6e73', boxShadow: active ? '0 1px 4px rgba(0,0,0,0.1)' : 'none', transition:'all .2s' }),
    grid: { display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(260px,1fr))', gap:16 },
    card: { background:'#fff', borderRadius:20, padding:28, boxShadow:'0 2px 12px rgba(0,0,0,0.06)', cursor:'pointer', transition:'transform .2s, box-shadow .2s' },
    cardTitle: { fontWeight:600, fontSize:'1.05rem', marginBottom:8, marginTop:16 },
    cardDesc: { color:'#6e6e73', fontSize:'.85rem', lineHeight:1.6 },
    cardLink: { marginTop:16, color:'#0071e3', fontSize:'.82rem', display:'block' },
  }

  return (
    <div style={s.page}>
      <nav style={s.nav}>
        <div style={s.logo}>Mise</div>
        <button style={s.logout} onClick={handleLogout}>Выйти</button>
      </nav>
      <div style={s.body}>
        <h1 style={s.welcome}>Добро пожаловать 👋</h1>
        <p style={s.email}>{restaurant?.name || 'Мой ресторан'} · {user.email}</p>

        <div style={s.tabs}>
          <button style={s.tab(tab==='apps')} onClick={()=>setTab('apps')}>Приложения</button>
          <button style={s.tab(tab==='team')} onClick={()=>setTab('team')}>Команда</button>
          <button style={s.tab(tab==='settings')} onClick={()=>setTab('settings')}>Настройки</button>
          <button style={s.tab(tab==='billing')} onClick={()=>setTab('billing')}>Подписка</button>
        </div>

        {tab === 'apps' && (
          <div style={s.grid}>
            <div style={s.card}
              onMouseEnter={e=>{(e.currentTarget as HTMLDivElement).style.transform='translateY(-4px)';(e.currentTarget as HTMLDivElement).style.boxShadow='0 8px 28px rgba(0,0,0,0.1)'}}
              onMouseLeave={e=>{(e.currentTarget as HTMLDivElement).style.transform='translateY(0)';(e.currentTarget as HTMLDivElement).style.boxShadow='0 2px 12px rgba(0,0,0,0.06)'}}>
              <div style={{fontSize:'2rem'}}>📋</div>
              <div style={s.cardTitle}>SO Manager</div>
              <div style={s.cardDesc}>Управление сменами, доходами и расходами</div>
              <a href="#" style={s.cardLink}>Открыть →</a>
            </div>
            <div style={s.card}
              onMouseEnter={e=>{(e.currentTarget as HTMLDivElement).style.transform='translateY(-4px)';(e.currentTarget as HTMLDivElement).style.boxShadow='0 8px 28px rgba(0,0,0,0.1)'}}
              onMouseLeave={e=>{(e.currentTarget as HTMLDivElement).style.transform='translateY(0)';(e.currentTarget as HTMLDivElement).style.boxShadow='0 2px 12px rgba(0,0,0,0.06)'}}>
              <div style={{fontSize:'2rem'}}>📊</div>
              <div style={s.cardTitle}>SO Analytics</div>
              <div style={s.cardDesc}>Аналитика бизнеса, зарплаты и тренды</div>
              <a href="#" style={s.cardLink}>Открыть →</a>
            </div>
            <div style={s.card}
              onMouseEnter={e=>{(e.currentTarget as HTMLDivElement).style.transform='translateY(-4px)';(e.currentTarget as HTMLDivElement).style.boxShadow='0 8px 28px rgba(0,0,0,0.1)'}}
              onMouseLeave={e=>{(e.currentTarget as HTMLDivElement).style.transform='translateY(0)';(e.currentTarget as HTMLDivElement).style.boxShadow='0 2px 12px rgba(0,0,0,0.06)'}}>
              <div style={{fontSize:'2rem'}}>💨</div>
              <div style={s.cardTitle}>SO Tobacco</div>
              <div style={s.cardDesc}>Склад табака, продажи и инвентаризация</div>
              <a href="#" style={s.cardLink}>Открыть →</a>
            </div>
          </div>
        )}

        {tab === 'team' && (
          <div style={{background:'#fff',borderRadius:20,padding:32,boxShadow:'0 2px 12px rgba(0,0,0,0.06)',textAlign:'center' as const}}>
            <div style={{fontSize:'2rem',marginBottom:16}}>👥</div>
            <div style={{fontWeight:600,marginBottom:8}}>Управление командой</div>
            <div style={{color:'#6e6e73',fontSize:'.9rem'}}>Скоро — добавление сотрудников и выдача доступов</div>
          </div>
        )}

        {tab === 'settings' && (
          <div style={{background:'#fff',borderRadius:20,padding:32,boxShadow:'0 2px 12px rgba(0,0,0,0.06)'}}>
            <div style={{fontWeight:600,fontSize:'1.1rem',marginBottom:24}}>Настройки ресторана</div>
            <div style={{marginBottom:16}}>
              <label style={{display:'block',fontSize:'.8rem',fontWeight:500,marginBottom:6}}>Название ресторана</label>
              <input defaultValue={restaurant?.name} style={{width:'100%',padding:'11px 14px',borderRadius:10,border:'0.5px solid rgba(0,0,0,0.15)',fontSize:'.9rem',fontFamily:'inherit',outline:'none'}}/>
            </div>
            <div style={{marginBottom:24}}>
              <label style={{display:'block',fontSize:'.8rem',fontWeight:500,marginBottom:6}}>Валюта</label>
              <input defaultValue={restaurant?.currency || '€'} style={{width:'100%',padding:'11px 14px',borderRadius:10,border:'0.5px solid rgba(0,0,0,0.15)',fontSize:'.9rem',fontFamily:'inherit',outline:'none'}}/>
            </div>
            <button style={{background:'#0071e3',color:'#fff',border:'none',padding:'12px 28px',borderRadius:980,fontFamily:'inherit',fontSize:'.88rem',fontWeight:500,cursor:'pointer'}}>Сохранить</button>
          </div>
        )}

        {tab === 'billing' && (
          <div style={{background:'#fff',borderRadius:20,padding:32,boxShadow:'0 2px 12px rgba(0,0,0,0.06)',textAlign:'center' as const}}>
            <div style={{fontSize:'2rem',marginBottom:16}}>💳</div>
            <div style={{fontWeight:600,marginBottom:8}}>Подписка</div>
            <div style={{color:'#6e6e73',fontSize:'.9rem',marginBottom:24}}>Управление подпиской через Stripe</div>
            <button style={{background:'#0071e3',color:'#fff',border:'none',padding:'12px 28px',borderRadius:980,fontFamily:'inherit',fontSize:'.88rem',cursor:'pointer'}}>Управить подпиской</button>
          </div>
        )}
      </div>
    </div>
  )
}
