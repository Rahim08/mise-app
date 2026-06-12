'use client'
import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Wordmark } from '@/components/brand'

export default function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)

  const handleReset = async () => {
    if (!email.trim()) { setError('Введите email'); return }
    setLoading(true)
    setError('')
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/reset`,
    })
    if (error) setError(error.message)
    else setSent(true)
    setLoading(false)
  }

  if (sent) return (
    <div style={S.bg}>
      <div style={{ ...S.card, textAlign: 'center' }}>
        <div style={{ marginBottom: 24 }}><Wordmark size={34} color="#1c1c1e" /></div>
        <div style={{ fontSize: '2.5rem', marginBottom: 16 }}>📬</div>
        <div style={{ fontWeight: 700, fontSize: '1.1rem', color: '#1c1c1e', marginBottom: 8 }}>Проверьте email</div>
        <div style={{ color: '#6d6d72', fontSize: '.88rem', marginBottom: 24, lineHeight: 1.6 }}>
          Мы отправили ссылку для сброса пароля на<br/>
          <strong style={{ color: '#1c1c1e' }}>{email}</strong>
        </div>
        <a href="/auth/login" style={{ display: 'block', padding: '12px', borderRadius: 12, background: '#007aff', color: '#fff', textDecoration: 'none', fontSize: '.92rem', fontWeight: 700 }}>
          Вернуться ко входу
        </a>
      </div>
    </div>
  )

  return (
    <div style={S.bg}>
      <div style={S.card}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 28 }}>
          <Wordmark size={34} color="#1c1c1e" />
          <div style={{ color: '#6d6d72', fontSize: '.88rem', marginTop: 4 }}>Восстановление пароля</div>
        </div>

        {error && (
          <div style={{ background: 'rgba(255,59,48,.08)', border: '1px solid rgba(255,59,48,.2)', borderRadius: 10, padding: '10px 14px', marginBottom: 16, fontSize: '.82rem', color: '#ff3b30', fontWeight: 500 }}>
            {error}
          </div>
        )}

        <div style={{ marginBottom: 16 }}>
          <label style={S.label}>Email</label>
          <input
            type="email" value={email}
            onChange={e => setEmail(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleReset()}
            placeholder="you@example.com"
            style={S.input}
          />
        </div>

        <button onClick={handleReset} disabled={loading} style={{ ...S.primaryBtn, opacity: loading ? .7 : 1 }}>
          {loading ? 'Отправляем...' : 'Отправить ссылку'}
        </button>

        <div style={{ textAlign: 'center', marginTop: 20, fontSize: '.85rem', color: '#6d6d72' }}>
          Вспомнили пароль?{' '}
          <a href="/auth/login" style={{ color: '#007aff', textDecoration: 'none', fontWeight: 600 }}>Войти</a>
        </div>
      </div>
    </div>
  )
}

const S: any = {
  bg: {
    minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: '#f2f2f7', fontFamily: '-apple-system,BlinkMacSystemFont,sans-serif',
    WebkitFontSmoothing: 'antialiased', padding: '20px 16px',
  },
  card: {
    background: '#fff', borderRadius: 24, padding: '40px 36px', width: '100%', maxWidth: 400,
    boxShadow: '0 4px 40px rgba(0,0,0,.08)',
  },
  label: {
    display: 'block', fontSize: '.72rem', fontWeight: 600, color: '#6d6d72', marginBottom: 6,
    textTransform: 'uppercase', letterSpacing: '.04em',
  },
  input: {
    width: '100%', padding: '11px 14px', borderRadius: 10, border: '1px solid rgba(60,60,67,.2)',
    fontSize: '.92rem', outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit',
    color: '#1c1c1e', background: '#fff',
  },
  primaryBtn: {
    width: '100%', padding: '13px', borderRadius: 12, background: '#007aff', color: '#fff',
    border: 'none', fontSize: '.95rem', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
  },
}
