'use client'
// @ts-nocheck
import { useState, useEffect } from 'react'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: true, storageKey: 'mise_auth' } }
)

function LogoMark({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none">
      <rect width="64" height="64" rx="14" fill="#007aff"/>
      <rect x="14" y="20" width="36" height="5" rx="2.5" fill="white"/>
      <rect x="14" y="30" width="26" height="5" rx="2.5" fill="white" opacity=".7"/>
      <rect x="14" y="40" width="18" height="5" rx="2.5" fill="white" opacity=".4"/>
    </svg>
  )
}

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(true)
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const [error, setError] = useState('')
  const [showPass, setShowPass] = useState(false)

  useEffect(() => {
    // If already logged in — redirect
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) window.location.href = '/dashboard'
    })
  }, [])

  const handleLogin = async () => {
    if (!email || !password) { setError('Заполните все поля'); return }
    setLoading(true)
    setError('')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      if (error.message.includes('Invalid login')) setError('Неверный email или пароль')
      else setError(error.message)
    } else {
      window.location.href = '/dashboard'
    }
    setLoading(false)
  }

  const handleGoogle = async () => {
    setGoogleLoading(true)
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/dashboard` }
    })
  }

  const handleKeyDown = (e: any) => {
    if (e.key === 'Enter') handleLogin()
  }

  return (
    <div style={S.bg}>
      <div style={S.card}>
        {/* Logo */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 32 }}>
          <LogoMark size={44} />
          <div style={{ fontSize: '1.6rem', fontWeight: 800, color: '#1c1c1e', letterSpacing: '-.04em', marginTop: 10 }}>mise</div>
          <div style={{ color: '#6d6d72', fontSize: '.88rem', marginTop: 4 }}>Войдите в свой аккаунт</div>
        </div>

        {/* Google */}
        <button onClick={handleGoogle} disabled={googleLoading} style={S.socialBtn}>
          <svg width="18" height="18" viewBox="0 0 18 18">
            <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
            <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"/>
            <path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
            <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 6.29C4.672 4.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
          </svg>
          <span>{googleLoading ? 'Перенаправление...' : 'Войти через Google'}</span>
        </button>

        {/* Apple — disabled until developer account */}
        <button disabled style={{ ...S.socialBtn, opacity: .45, cursor: 'not-allowed', marginTop: 10, background: '#1c1c1e', color: '#fff' }}>
          <svg width="17" height="17" viewBox="0 0 17 17" fill="none">
            <path d="M14.05 9.02c-.02-2.04 1.67-3.02 1.74-3.07-1.05-1.54-2.67-1.76-3.24-1.78-1.38-.14-2.7.81-3.4.81-.7 0-1.78-.79-2.93-.77-1.51.02-2.9.88-3.68 2.23-1.57 2.72-.4 6.74 1.13 8.94.75 1.08 1.64 2.29 2.81 2.25 1.13-.05 1.56-.73 2.93-.73 1.37 0 1.76.73 2.95.71 1.21-.02 1.98-1.1 2.73-2.18.86-1.25 1.21-2.46 1.23-2.52-.03-.01-2.35-.9-2.37-3.59z" fill="white"/>
            <path d="M11.62 2.67C12.23 1.93 12.64.93 12.52 0c-.87.04-1.92.58-2.54 1.31-.56.64-1.05 1.67-.92 2.65.97.07 1.96-.49 2.56-1.29z" fill="white"/>
          </svg>
          <span>Войти через Apple — скоро</span>
        </button>

        {/* Divider */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '20px 0' }}>
          <div style={{ flex: 1, height: 1, background: 'rgba(60,60,67,.12)' }} />
          <span style={{ fontSize: '.75rem', color: '#aeaeb2', fontWeight: 500 }}>или</span>
          <div style={{ flex: 1, height: 1, background: 'rgba(60,60,67,.12)' }} />
        </div>

        {/* Error */}
        {error && (
          <div style={{ background: 'rgba(255,59,48,.08)', border: '1px solid rgba(255,59,48,.2)', borderRadius: 10, padding: '10px 14px', marginBottom: 16, fontSize: '.82rem', color: '#ff3b30', fontWeight: 500 }}>
            {error}
          </div>
        )}

        {/* Email */}
        <div style={{ marginBottom: 12 }}>
          <label style={S.label}>Email</label>
          <input
            type="email" value={email}
            onChange={e => setEmail(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="you@example.com"
            style={S.input}
          />
        </div>

        {/* Password */}
        <div style={{ marginBottom: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <label style={S.label}>Пароль</label>
            <a href="/auth/forgot" style={{ fontSize: '.75rem', color: '#007aff', textDecoration: 'none' }}>Забыли пароль?</a>
          </div>
          <div style={{ position: 'relative' }}>
            <input
              type={showPass ? 'text' : 'password'}
              value={password}
              onChange={e => setPassword(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="••••••••"
              style={{ ...S.input, paddingRight: 44 }}
            />
            <button onClick={() => setShowPass(!showPass)} style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#aeaeb2', fontSize: '.82rem', fontFamily: 'inherit', padding: 4 }}>
              {showPass ? 'Скрыть' : 'Показать'}
            </button>
          </div>
        </div>

        {/* Remember me */}
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginBottom: 20, userSelect: 'none' }}>
          <div onClick={() => setRemember(!remember)} style={{ width: 20, height: 20, borderRadius: 6, border: `2px solid ${remember ? '#007aff' : 'rgba(60,60,67,.3)'}`, background: remember ? '#007aff' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'all .15s' }}>
            {remember && <svg width="10" height="8" viewBox="0 0 10 8" fill="none"><path d="M1 4l3 3 5-6" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>}
          </div>
          <span style={{ fontSize: '.85rem', color: '#3c3c43' }}>Запомнить меня</span>
        </label>

        {/* Submit */}
        <button onClick={handleLogin} disabled={loading} style={{ ...S.primaryBtn, opacity: loading ? .7 : 1 }}>
          {loading ? 'Входим...' : 'Войти'}
        </button>

        <div style={{ textAlign: 'center', marginTop: 20, fontSize: '.85rem', color: '#6d6d72' }}>
          Нет аккаунта?{' '}
          <a href="/auth/register" style={{ color: '#007aff', textDecoration: 'none', fontWeight: 600 }}>Зарегистрироваться</a>
        </div>
      </div>
    </div>
  )
}

const S: any = {
  bg: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#f2f2f7',
    fontFamily: '-apple-system,BlinkMacSystemFont,sans-serif',
    WebkitFontSmoothing: 'antialiased',
    padding: '20px 16px',
  },
  card: {
    background: '#fff',
    borderRadius: 24,
    padding: '40px 36px',
    width: '100%',
    maxWidth: 400,
    boxShadow: '0 4px 40px rgba(0,0,0,.08)',
  },
  label: {
    display: 'block',
    fontSize: '.72rem',
    fontWeight: 600,
    color: '#6d6d72',
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: '.04em',
  },
  input: {
    width: '100%',
    padding: '11px 14px',
    borderRadius: 10,
    border: '1px solid rgba(60,60,67,.2)',
    fontSize: '.92rem',
    outline: 'none',
    boxSizing: 'border-box',
    fontFamily: 'inherit',
    color: '#1c1c1e',
    background: '#fff',
    transition: 'border-color .15s',
  },
  socialBtn: {
    width: '100%',
    padding: '12px 16px',
    borderRadius: 12,
    border: '1px solid rgba(60,60,67,.15)',
    background: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    fontSize: '.88rem',
    fontWeight: 600,
    color: '#1c1c1e',
    cursor: 'pointer',
    fontFamily: 'inherit',
    transition: 'background .15s',
  },
  primaryBtn: {
    width: '100%',
    padding: '13px',
    borderRadius: 12,
    background: '#007aff',
    color: '#fff',
    border: 'none',
    fontSize: '.95rem',
    fontWeight: 700,
    cursor: 'pointer',
    fontFamily: 'inherit',
    transition: 'opacity .15s',
  },
}
