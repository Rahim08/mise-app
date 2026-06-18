'use client'
import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Wordmark } from '@/components/brand'
import { useI18n, LanguageSwitcher } from '@/lib/i18n'
import { track } from '@/lib/analytics'

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

export default function Register() {
  const { t } = useI18n()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [restaurant, setRestaurant] = useState('')
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const [appleLoading, setAppleLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [showPass, setShowPass] = useState(false)

  const rules = {
    length: password.length >= 8,
    upper: /[A-Z]/.test(password),
    number: /[0-9]/.test(password),
  }
  const passwordOk = rules.length && rules.upper && rules.number

  const handleRegister = async () => {
    if (!name.trim()) { setError(t('auth.register.errName')); return }
    if (!restaurant.trim()) { setError(t('auth.register.errRestaurant')); return }
    if (!email.trim()) { setError(t('auth.register.errEmail')); return }
    if (!passwordOk) { setError(t('auth.register.errPassword')); return }

    setLoading(true)
    setError('')
    const { error } = await supabase.auth.signUp({
      email, password,
      options: { data: { full_name: name, restaurant_name: restaurant } }
    })
    if (error) { setError(error.message) }
    else {
      setSuccess(true)
      track('signup_completed')
      fetch('/api/auth/welcome', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, name }) }).catch(() => {})
    }
    setLoading(false)
  }

  const handleGoogle = async () => {
    setGoogleLoading(true)
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback` }
    })
  }

  const handleApple = async () => {
    setAppleLoading(true)
    await supabase.auth.signInWithOAuth({
      provider: 'apple',
      options: { redirectTo: `${window.location.origin}/auth/callback` }
    })
  }

  if (success) return (
    <div style={S.bg}>
      <div style={{ ...S.card, textAlign: 'center' }}>
        <div style={{ marginBottom: 24 }}><Wordmark size={34} color="#1c1c1e" /></div>
        <div style={{ width: 64, height: 64, borderRadius: 18, background: 'rgba(0,122,255,.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
          <svg width="28" height="28" fill="none" stroke="#007aff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><rect x="2" y="4" width="20" height="16" rx="3" /><path d="m2 7 10 7L22 7" /></svg>
        </div>
        <div style={{ fontWeight: 700, fontSize: '1.1rem', color: '#1c1c1e', marginBottom: 8 }}>{t('auth.register.checkEmail')}</div>
        <div style={{ color: '#6d6d72', fontSize: '.88rem', marginBottom: 24, lineHeight: 1.6 }}>
          {t('auth.register.sentLink')}<br/>
          <strong style={{ color: '#1c1c1e' }}>{email}</strong>
        </div>
        <a href="/auth/login" style={{ display: 'block', padding: '12px', borderRadius: 12, background: '#007aff', color: '#fff', textDecoration: 'none', fontSize: '.92rem', fontWeight: 700 }}>
          {t('auth.register.toLogin')}
        </a>
      </div>
    </div>
  )

  return (
    <div style={S.bg}>
      <div style={S.card}>
        {/* Language switcher */}
        <div style={{ position: 'absolute', top: 16, right: 16 }}><LanguageSwitcher /></div>

        {/* Logo */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 28 }}>
          <Wordmark size={34} color="#1c1c1e" />
          <div style={{ color: '#6d6d72', fontSize: '.88rem', marginTop: 4 }}>{t('auth.register.subtitle')}</div>
        </div>

        {/* Google */}
        <button onClick={handleGoogle} disabled={googleLoading} style={S.socialBtn}>
          <svg width="18" height="18" viewBox="0 0 18 18">
            <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
            <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"/>
            <path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
            <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 6.29C4.672 4.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
          </svg>
          <span>{googleLoading ? t('auth.login.googleLoading') : t('auth.register.google')}</span>
        </button>

        <button onClick={handleApple} disabled={appleLoading} style={{ ...S.socialBtn, opacity: appleLoading ? .7 : 1, marginTop: 10, background: '#1c1c1e', color: '#fff' }}>
          <svg width="17" height="17" viewBox="0 0 17 17" fill="none">
            <path d="M14.05 9.02c-.02-2.04 1.67-3.02 1.74-3.07-1.05-1.54-2.67-1.76-3.24-1.78-1.38-.14-2.7.81-3.4.81-.7 0-1.78-.79-2.93-.77-1.51.02-2.9.88-3.68 2.23-1.57 2.72-.4 6.74 1.13 8.94.75 1.08 1.64 2.29 2.81 2.25 1.13-.05 1.56-.73 2.93-.73 1.37 0 1.76.73 2.95.71 1.21-.02 1.98-1.1 2.73-2.18.86-1.25 1.21-2.46 1.23-2.52-.03-.01-2.35-.9-2.37-3.59z" fill="white"/>
            <path d="M11.62 2.67C12.23 1.93 12.64.93 12.52 0c-.87.04-1.92.58-2.54 1.31-.56.64-1.05 1.67-.92 2.65.97.07 1.96-.49 2.56-1.29z" fill="white"/>
          </svg>
          <span>{appleLoading ? t('auth.login.googleLoading') : 'Continue with Apple'}</span>
        </button>

        {/* Divider */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '20px 0' }}>
          <div style={{ flex: 1, height: 1, background: 'rgba(60,60,67,.12)' }} />
          <span style={{ fontSize: '.75rem', color: '#aeaeb2', fontWeight: 500 }}>{t('common.or')}</span>
          <div style={{ flex: 1, height: 1, background: 'rgba(60,60,67,.12)' }} />
        </div>

        {error && (
          <div style={{ background: 'rgba(255,59,48,.08)', border: '1px solid rgba(255,59,48,.2)', borderRadius: 10, padding: '10px 14px', marginBottom: 16, fontSize: '.82rem', color: '#ff3b30', fontWeight: 500 }}>
            {error}
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
          <div style={{ gridColumn: '1/-1' }}>
            <label style={S.label}>{t('auth.register.name')}</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Иван Иванов" style={S.input} />
          </div>
          <div style={{ gridColumn: '1/-1' }}>
            <label style={S.label}>{t('auth.register.restaurant')}</label>
            <input value={restaurant} onChange={e => setRestaurant(e.target.value)} placeholder="Мой ресторан" style={S.input} />
          </div>
          <div style={{ gridColumn: '1/-1' }}>
            <label style={S.label}>{t('auth.register.email')}</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" style={S.input} />
          </div>
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={S.label}>{t('auth.register.password')}</label>
          <div style={{ position: 'relative' }}>
            <input
              type={showPass ? 'text' : 'password'}
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder={t('auth.register.ruleLength')}
              style={{ ...S.input, paddingRight: 44 }}
            />
            <button onClick={() => setShowPass(!showPass)} style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#aeaeb2', fontSize: '.82rem', fontFamily: 'inherit', padding: 4 }}>
              {showPass ? t('common.hide') : t('common.show')}
            </button>
          </div>
        </div>

        {/* Password rules */}
        {password.length > 0 && (
          <div style={{ background: '#f9f9f9', borderRadius: 10, padding: '10px 14px', marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <PasswordRule ok={rules.length} text={t('auth.register.ruleLength')} />
            <PasswordRule ok={rules.upper} text={t('auth.register.ruleUpper')} />
            <PasswordRule ok={rules.number} text={t('auth.register.ruleNumber')} />
          </div>
        )}

        <button onClick={handleRegister} disabled={loading} style={{ ...S.primaryBtn, opacity: loading ? .7 : 1, marginBottom: 16 }}>
          {loading ? t('auth.register.submitting') : t('auth.register.submit')}
        </button>

        <div style={{ textAlign: 'center', fontSize: '.85rem', color: '#6d6d72' }}>
          {t('auth.register.haveAccount')}{' '}
          <a href="/auth/login" style={{ color: '#007aff', textDecoration: 'none', fontWeight: 600 }}>{t('auth.register.login')}</a>
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
    position: 'relative',
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
  },
}
