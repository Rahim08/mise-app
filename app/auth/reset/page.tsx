'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { Wordmark } from '@/components/brand'
import { useI18n, LanguageSwitcher } from '@/lib/i18n'

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
  const { t } = useI18n()
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
    if (!passwordOk) { setError(t('auth.register.errPassword')); return }
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
        <div style={{ marginBottom: 24 }}><Wordmark size={34} color="#1c1c1e" /></div>
        <div style={{ marginBottom: 16 }}><svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#34c759" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><path d="m8.5 12 2.5 2.5 4.5-5"/></svg></div>
        <div style={{ fontWeight: 700, fontSize: '1.1rem', color: '#1c1c1e', marginBottom: 8 }}>{t('auth.reset.doneTitle')}</div>
        <a href="/dashboard" style={{ display: 'block', padding: '12px', borderRadius: 12, background: '#007aff', color: '#fff', textDecoration: 'none', fontSize: '.92rem', fontWeight: 700, marginTop: 16 }}>
          {t('auth.reset.toDashboard')}
        </a>
      </div>
    </div>
  )

  return (
    <div style={S.bg}>
      <div style={S.card}>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: -8 }}><LanguageSwitcher /></div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 28 }}>
          <Wordmark size={34} color="#1c1c1e" />
          <div style={{ color: '#6d6d72', fontSize: '.88rem', marginTop: 4 }}>{t('auth.reset.subtitle')}</div>
        </div>

        {!ready && (
          <div style={{ background: 'rgba(255,149,0,.08)', border: '1px solid rgba(255,149,0,.2)', borderRadius: 10, padding: '10px 14px', marginBottom: 16, fontSize: '.82rem', color: '#ff9500', fontWeight: 500 }}>
            {t('auth.reset.openFromEmail')}
          </div>
        )}

        {error && (
          <div style={{ background: 'rgba(255,59,48,.08)', border: '1px solid rgba(255,59,48,.2)', borderRadius: 10, padding: '10px 14px', marginBottom: 16, fontSize: '.82rem', color: '#ff3b30', fontWeight: 500 }}>
            {error}
          </div>
        )}

        <div style={{ marginBottom: 12 }}>
          <label style={S.label}>{t('auth.login.password')}</label>
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

        {password.length > 0 && (
          <div style={{ background: '#f9f9f9', borderRadius: 10, padding: '10px 14px', marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <PasswordRule ok={rules.length} text={t('auth.register.ruleLength')} />
            <PasswordRule ok={rules.upper} text={t('auth.register.ruleUpper')} />
            <PasswordRule ok={rules.number} text={t('auth.register.ruleNumber')} />
          </div>
        )}

        <button onClick={handleUpdate} disabled={loading || !ready} style={{ ...S.primaryBtn, opacity: loading || !ready ? .7 : 1 }}>
          {loading ? t('auth.reset.submitting') : t('auth.reset.submit')}
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
