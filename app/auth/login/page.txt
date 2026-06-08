'use client'
import { useState } from 'react'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleLogin = async () => {
    setLoading(true)
    setError('')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setError(error.message)
    else window.location.href = '/dashboard'
    setLoading(false)
  }

  return (
    <div style={{minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',background:'#f5f5f7',fontFamily:'-apple-system,BlinkMacSystemFont,sans-serif'}}>
      <div style={{background:'#fff',borderRadius:24,padding:'48px 40px',width:'100%',maxWidth:400,boxShadow:'0 4px 40px rgba(0,0,0,0.08)'}}>
        <div style={{fontSize:'1.8rem',fontWeight:700,letterSpacing:'-.04em',textAlign:'center',marginBottom:8}}>Mise</div>
        <div style={{textAlign:'center',color:'#6e6e73',fontSize:'.9rem',marginBottom:36}}>Войдите в свой аккаунт</div>
        {error && <div style={{color:'#ff3b30',fontSize:'.83rem',marginBottom:12,textAlign:'center'}}>{error}</div>}
        <label style={{display:'block',fontSize:'.8rem',marginBottom:6,fontWeight:500}}>Email</label>
        <input style={{width:'100%',padding:'12px 16px',borderRadius:12,border:'1px solid #d2d2d7',fontSize:'1rem',outline:'none',boxSizing:'border-box',marginBottom:16}} type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com"/>
        <label style={{display:'block',fontSize:'.8rem',marginBottom:6,fontWeight:500}}>Пароль</label>
        <input style={{width:'100%',padding:'12px 16px',borderRadius:12,border:'1px solid #d2d2d7',fontSize:'1rem',outline:'none',boxSizing:'border-box',marginBottom:24}} type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="••••••••"/>
        <button style={{width:'100%',padding:14,borderRadius:12,background:'#0071e3',color:'#fff',border:'none',fontSize:'1rem',cursor:'pointer',fontWeight:500}} onClick={handleLogin} disabled={loading}>
          {loading ? 'Входим...' : 'Войти →'}
        </button>
        <div style={{textAlign:'center',marginTop:20,fontSize:'.85rem',color:'#6e6e73'}}>
          Нет аккаунта? <a href="/auth/register" style={{color:'#0071e3'}}>Зарегистрироваться</a>
        </div>
      </div>
    </div>
  )
}
