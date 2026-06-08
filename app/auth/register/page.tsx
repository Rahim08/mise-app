'use client'
import { useState } from 'react'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export default function Register() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [restaurant, setRestaurant] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  const handleRegister = async () => {
    setLoading(true)
    setError('')
    const { error } = await supabase.auth.signUp({
      email, password,
      options: { data: { full_name: name, restaurant_name: restaurant } }
    })
    if (error) setError(error.message)
    else setSuccess(true)
    setLoading(false)
  }

  if (success) return (
    <div style={{minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',background:'#f5f5f7',fontFamily:'-apple-system,BlinkMacSystemFont,sans-serif'}}>
      <div style={{background:'#fff',borderRadius:24,padding:'48px 40px',width:'100%',maxWidth:400,boxShadow:'0 4px 40px rgba(0,0,0,0.08)',textAlign:'center'}}>
        <div style={{fontSize:'1.8rem',fontWeight:700,letterSpacing:'-.04em',marginBottom:24}}>Mise</div>
        <div style={{fontSize:'2rem',marginBottom:16}}>✅</div>
        <div style={{fontWeight:600,marginBottom:8}}>Проверьте email!</div>
        <div style={{color:'#6e6e73',fontSize:'.9rem',marginBottom:24}}>Мы отправили ссылку для подтверждения на {email}</div>
        <a href="/auth/login" style={{color:'#0071e3',fontSize:'.9rem'}}>Войти</a>
      </div>
    </div>
  )

  return (
    <div style={{minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',background:'#f5f5f7',fontFamily:'-apple-system,BlinkMacSystemFont,sans-serif'}}>
      <div style={{background:'#fff',borderRadius:24,padding:'48px 40px',width:'100%',maxWidth:400,boxShadow:'0 4px 40px rgba(0,0,0,0.08)'}}>
        <div style={{fontSize:'1.8rem',fontWeight:700,letterSpacing:'-.04em',textAlign:'center',marginBottom:8}}>Mise</div>
        <div style={{textAlign:'center',color:'#6e6e73',fontSize:'.9rem',marginBottom:36}}>Создайте аккаунт</div>
        {error && <div style={{color:'#ff3b30',fontSize:'.83rem',marginBottom:12,textAlign:'center'}}>{error}</div>}
        <label style={{display:'block',fontSize:'.8rem',marginBottom:6,fontWeight:500}}>Ваше имя</label>
        <input style={{width:'100%',padding:'12px 16px',borderRadius:12,border:'1px solid #d2d2d7',fontSize:'1rem',outline:'none',boxSizing:'border-box',marginBottom:16}} value={name} onChange={e=>setName(e.target.value)} placeholder="Имя Фамилия"/>
        <label style={{display:'block',fontSize:'.8rem',marginBottom:6,fontWeight:500}}>Название ресторана</label>
        <input style={{width:'100%',padding:'12px 16px',borderRadius:12,border:'1px solid #d2d2d7',fontSize:'1rem',outline:'none',boxSizing:'border-box',marginBottom:16}} value={restaurant} onChange={e=>setRestaurant(e.target.value)} placeholder="Мой ресторан"/>
        <label style={{display:'block',fontSize:'.8rem',marginBottom:6,fontWeight:500}}>Email</label>
        <input style={{width:'100%',padding:'12px 16px',borderRadius:12,border:'1px solid #d2d2d7',fontSize:'1rem',outline:'none',boxSizing:'border-box',marginBottom:16}} type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com"/>
        <label style={{display:'block',fontSize:'.8rem',marginBottom:6,fontWeight:500}}>Пароль</label>
        <input style={{width:'100%',padding:'12px 16px',borderRadius:12,border:'1px solid #d2d2d7',fontSize:'1rem',outline:'none',boxSizing:'border-box',marginBottom:24}} type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="Минимум 6 символов"/>
        <button style={{width:'100%',padding:14,borderRadius:12,background:'#0071e3',color:'#fff',border:'none',fontSize:'1rem',cursor:'pointer',fontWeight:500}} onClick={handleRegister} disabled={loading}>
          {loading ? 'Создаём...' : 'Создать аккаунт →'}
        </button>
        <div style={{textAlign:'center',marginTop:20,fontSize:'.85rem',color:'#6e6e73'}}>
          Уже есть аккаунт? <a href="/auth/login" style={{color:'#0071e3'}}>Войти</a>
        </div>
      </div>
    </div>
  )
}
