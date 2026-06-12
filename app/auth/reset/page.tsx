'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { LogoMark } from '@/components/LogoMark'

function PasswordRule({ ok, text }: { ok: boolean; text: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '.75rem', color: ok ? '#34c759' : '#aeaeb2', transition: 'color .2s' }}>
      <div style={{ width: 14, height: 14, borderRadius: '50%', background: ok ? '#34c759' : 'rgba(60,60,67,.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'background .2s' }}>
        {ok && <svg width="8" height="6" viewBox="0 0 8 6" fill="none"><path d="M1 3l2 2 4-4" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
      </div>
      {text}
    </div>
  )
}

export default function ResetPassword() {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const [ready, setReady] = useState(false)

  // The recovery link puts the user into a PASSWORD_RECOVERY session.
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') setReady(true)
    })
    supabase.auth.getSession().then(({ data }) => { if (data.session) setReady(true) })
    return () => sub.subscription.unsubscribe()
  }, [])

  const rules = {
    length: password.length >= 8,
    upper: /[A-Z]/.test(password),
    number: /[0-9]/.test(password),
  }
  const passwordOk = rules.length && rules.upper && rules.number

  const handleUpdate = async () => {
    if (!passwordOk) { setError('Пароль не соответствует требованиям'); return }
    setLoading(true)
    setError('')
    const { error } = await supabase.auth.updateUser({ password })
    if (error) setError(error.message)
    else setDone(true)
    setLoading(false)
  }

  if (done) return (
    <div style={S.bg}>
      <div style={{ ...S.card, textAlign: 'center' }}>
        <LogoMark size={44} />
        <div style={{ fontSize: '1.6rem', fontWeight: 800, color: '#1c1c1e', letterSpacing: '-.04em', marginTop: 10, marginBottom: 24 }}>mise</div>
        <div style={{ fontSize: '2.5rem', marginBottom: 16 }}>✅</div>
        <div style={{ fontWeight: 700, fontSize: '1.1rem', color: '#1c1c1e', marginBottom: 8 }}>Пароль изменён</div>
        <a href="/dashboard" style={{ display: 'block', padding: '12px', borderRadius: 12, background: '#007aff', color: '#fff', textDecoration: 'none', fontSize: '.92rem', fontWeight: 700, marginTop: 16 }}>
          В личный кабинет
        </a>
      </div>
    </div>
  )

  return (
    <div style={S.bg}>
      <div style={S.card}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 28 }}>
          <LogoMark size={44} />
          <div style={{ fontSize: '1.6rem', fontWeight: 800, color: '#1c1c1e', letterSpacing: '-.04em', marginTop: 10 }}>mise</div>
          <div style={{ color: '#6d6d72', fontSize: '.88rem', marginTop: 4 }}>Новый пароль</div>
        </div>

        {!ready && (
          <div style={{ background: 'rgba(255,149,0,.08)', border: '1px solid rgba(255,149,0,.2)', borderRadius: 10, padding: '10px 14px', marginBottom: 16, fontSize: '.82rem', color: '#ff9500', fontWeight: 500 }}>
            Откройте эту страницу по ссылке из письма для сброса пароля.
          </div>
        )}

        {error && (
          <div style={{ background: 'rgba(255,59,48,.08)', border: '1px solid rgba(255,59,48,.2)', borderRadius: 10, padding: '10px 14px', marginBottom: 16, fontSize: '.82rem', color: '#ff3b30', fontWeight: 500 }}>
            {error}
          </div>
        )}

        <div style={{ marginBottom: 12 }}>
          <label style={S.label}>Пароль</label>
          <div style={{ position: 'relative' }}>
            <input
              type={showPass ? 'text' : 'password'}
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Минимум 8 символов"
              style={{ ...S.input, paddingRight: 44 }}
            />
            <button onClick={() => setShowPass(!showPass)} style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#aeaeb2', fontSize: '.82rem', fontFamily: 'inherit', padding: 4 }}>
              {showPass ? 'Скрыть' : 'Показать'}
            </button>
          </div>
        </div>

        {password.length > 0 && (
          <div style={{ background: '#f9f9f9', borderRadius: 10, padding: '10px 14px', marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <PasswordRule ok={rules.length} text="Минимум 8 символов" />
            <PasswordRule ok={rules.upper} text="Хотя бы одна заглавная буква" />
            <PasswordRule ok={rules.number} text="Хотя бы одна цифра" />
          </div>
        )}

        <button onClick={handleUpdate} disabled={loading || !ready} style={{ ...S.primaryBtn, opacity: loading || !ready ? .7 : 1 }}>
          {loading ? 'Сохраняем...' : 'Сохранить пароль'}
        </button>
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
