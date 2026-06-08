'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export default function Dashboard() {
  const [user, setUser] = useState<any>(null)

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) window.location.href = '/auth/login'
      else setUser(data.user)
    })
  }, [])

  const handleLogout = async () => {
    await supabase.auth.signOut()
    window.location.href = '/auth/login'
  }

  if (!user) return null

  return (
    <div style={{minHeight:'100vh',background:'#f5f5f7',fontFamily:'-apple-system,BlinkMacSystemFont,sans-serif'}}>
      <nav style={{background:'rgba(255,255,255,0.85)',backdropFilter:'blur(20px)',borderBottom:'0.5px solid rgba(0,0,0,0.1)',padding:'0 32px',height:52,display:'flex',alignItems:'center',justifyContent:'space-between',position:'sticky',top:0}}>
        <div style={{fontWeight:700,fontSize:'1.1rem',letterSpacing:'-.02em'}}>Mise</div>
        <button onClick={handleLogout} style={{background:'none',border:'none',color:'#0071e3',cursor:'pointer',fontSize:'.85rem'}}>Выйти</button>
      </nav>
      <div style={{maxWidth:900,margin:'0 auto',padding:'48px 24px'}}>
        <h1 style={{fontSize:'2rem',fontWeight:700,letterSpacing:'-.03em',marginBottom:8}}>
          Добро пожаловать 👋
        </h1>
        <p style={{color:'#6e6e73',marginBottom:48}}>{user.email}</p>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(260px,1fr))',gap:16}}>
          <div style={{background:'#fff',borderRadius:20,padding:32,boxShadow:'0 2px 16px rgba(0,0,0,0.06)',cursor:'pointer',transition:'transform .2s'}}
            onMouseEnter={e=>(e.currentTarget.style.transform='translateY(-4px)')}
            onMouseLeave={e=>(e.currentTarget.style.transform='translateY(0)')}>
            <div style={{fontSize:'2rem',marginBottom:16}}>📋</div>
            <div style={{fontWeight:600,fontSize:'1.1rem',marginBottom:8}}>SO Manager</div>
            <div style={{color:'#6e6e73',fontSize:'.85rem',lineHeight:1.6}}>Управление сменами, доходами и расходами</div>
            <div style={{marginTop:20,color:'#0071e3',fontSize:'.85rem'}}>Открыть →</div>
          </div>
          <div style={{background:'#fff',borderRadius:20,padding:32,boxShadow:'0 2px 16px rgba(0,0,0,0.06)',cursor:'pointer'}}
            onMouseEnter={e=>(e.currentTarget.style.transform='translateY(-4px)')}
            onMouseLeave={e=>(e.currentTarget.style.transform='translateY(0)')}>
            <div style={{fontSize:'2rem',marginBottom:16}}>📊</div>
            <div style={{fontWeight:600,fontSize:'1.1rem',marginBottom:8}}>SO Analytics</div>
            <div style={{color:'#6e6e73',fontSize:'.85rem',lineHeight:1.6}}>Аналитика бизнеса, зарплаты и тренды</div>
            <div style={{marginTop:20,color:'#0071e3',fontSize:'.85rem'}}>Открыть →</div>
          </div>
          <div style={{background:'#fff',borderRadius:20,padding:32,boxShadow:'0 2px 16px rgba(0,0,0,0.06)',cursor:'pointer'}}
            onMouseEnter={e=>(e.currentTarget.style.transform='translateY(-4px)')}
            onMouseLeave={e=>(e.currentTarget.style.transform='translateY(0)')}>
            <div style={{fontSize:'2rem',marginBottom:16}}>💨</div>
            <div style={{fontWeight:600,fontSize:'1.1rem',marginBottom:8}}>SO Tobacco</div>
            <div style={{color:'#6e6e73',fontSize:'.85rem',lineHeight:1.6}}>Склад табака, продажи и инвентаризация</div>
            <div style={{marginTop:20,color:'#30d158',fontSize:'.85rem'}}>Открыть →</div>
          </div>
        </div>
      </div>
    </div>
  )
}
