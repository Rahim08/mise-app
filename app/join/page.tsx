'use client'
// @ts-nocheck
import { useEffect, useState } from 'react'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

const APPS = [
  { id: 'manager',   name: 'Mise Manager',   color: '#007aff', path: '/manager' },
  { id: 'analytics', name: 'Mise Analytics', color: '#34c759', path: '/analytics' },
  { id: 'stash',     name: 'Mise Stash',     color: '#ff9500', path: '/tobacco' },
]

function LogoMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none">
      <rect width="64" height="64" rx="14" fill="#007aff"/>
      <rect x="14" y="20" width="36" height="5" rx="2.5" fill="white"/>
      <rect x="14" y="30" width="26" height="5" rx="2.5" fill="white" opacity=".7"/>
      <rect x="14" y="40" width="18" height="5" rx="2.5" fill="white" opacity=".4"/>
    </svg>
  )
}

// Генерируем device fingerprint
function getDeviceId(): string {
  const key = 'mise_device_id'
  let id = localStorage.getItem(key)
  if (!id) {
    id = 'dev_' + Math.random().toString(36).slice(2) + Date.now().toString(36)
    localStorage.setItem(key, id)
  }
  return id
}

type Phase = 'loading' | 'pin' | 'app_select' | 'error'

export default function JoinPage() {
  const [phase, setPhase] = useState<Phase>('loading')
  const [restaurant, setRestaurant] = useState<any>(null)
  const [staffMember, setStaffMember] = useState<any>(null)
  const [pin, setPin] = useState('')
  const [pinError, setPinError] = useState(false)
  const [shaking, setShaking] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [checking, setChecking] = useState(false)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const restaurantId = params.get('restaurant')
    if (!restaurantId) { setErrorMsg('Неверная ссылка'); setPhase('error'); return }

    // Check if already logged in on this device
    const deviceId = getDeviceId()
    const savedStaff = localStorage.getItem('mise_staff_' + restaurantId)
    
    supabase.from('restaurants').select('id,name,logo_url,subscription_status,subscription_plan').eq('id', restaurantId).single()
      .then(({ data, error }) => {
        if (error || !data) { setErrorMsg('Заведение не найдено'); setPhase('error'); return }
        setRestaurant(data)

        // If saved staff — verify still active
        if (savedStaff) {
          const parsed = JSON.parse(savedStaff)
          supabase.from('staff').select('*').eq('id', parsed.id).eq('is_active', true).single()
            .then(({ data: s }) => {
              if (s) { setStaffMember(s); setPhase('app_select') }
              else { localStorage.removeItem('mise_staff_' + restaurantId); setPhase('pin') }
            })
        } else {
          setPhase('pin')
        }
      })
  }, [])

  const handlePinDigit = (digit: string) => {
    if (pin.length >= 4) return
    const newPin = pin + digit
    setPin(newPin)
    setPinError(false)
    if (newPin.length === 4) checkPin(newPin)
  }

  const handlePinDelete = () => {
    setPin(p => p.slice(0, -1))
    setPinError(false)
  }

  const checkPin = async (enteredPin: string) => {
    if (!restaurant) return
    setChecking(true)
    const deviceId = getDeviceId()

    // Check owner PIN first
    if (restaurant.owner_pin && enteredPin === restaurant.owner_pin) {
      // Owner — access to all apps
      const ownerStaff = { id: 'owner', name: 'Владелец', apps: ['manager', 'analytics', 'stash'], is_owner: true }
      setStaffMember(ownerStaff)
      setChecking(false)
      setPhase('app_select')
      return
    }

    // Check staff PIN
    const { data: staffList } = await supabase
      .from('staff')
      .select('*')
      .eq('restaurant_id', restaurant.id)
      .eq('is_active', true)

    const matched = (staffList || []).find((s: any) => s.pin_hash === enteredPin)

    if (matched) {
      // Bind device if not bound
      if (!matched.device_id) {
        await supabase.from('staff').update({ device_id: deviceId }).eq('id', matched.id)
      }
      localStorage.setItem('mise_staff_' + restaurant.id, JSON.stringify({ id: matched.id, name: matched.name }))
      localStorage.setItem('mise_restaurant_id', restaurant.id)
      setStaffMember(matched)
      setChecking(false)
      setPhase('app_select')
    } else {
      setChecking(false)
      setPinError(true)
      setShaking(true)
      setTimeout(() => { setShaking(false); setPin('') }, 600)
    }
  }

  const openApp = (path: string) => {
    localStorage.setItem('mise_restaurant_id', restaurant?.id || '')
    window.location.href = path
  }

  const logout = () => {
    if (!restaurant) return
    localStorage.removeItem('mise_staff_' + restaurant.id)
    setStaffMember(null)
    setPin('')
    setPhase('pin')
  }

  // ── LOADING ──
  if (phase === 'loading') return (
    <div style={S.screen}>
      <LogoMark size={48} />
      <div style={{ color: '#aeaeb2', fontSize: '.85rem', marginTop: 16 }}>Загрузка...</div>
    </div>
  )

  // ── ERROR ──
  if (phase === 'error') return (
    <div style={S.screen}>
      <div style={{ fontSize: '2.5rem', marginBottom: 16 }}>⚠️</div>
      <div style={{ fontWeight: 700, fontSize: '1.1rem', color: '#1c1c1e', marginBottom: 8 }}>Ошибка</div>
      <div style={{ color: '#6d6d72', fontSize: '.88rem', textAlign: 'center', maxWidth: 260 }}>{errorMsg}</div>
    </div>
  )

  // ── PIN ENTRY ──
  if (phase === 'pin') return (
    <div style={S.screen}>
      {/* Restaurant branding */}
      <div style={{ marginBottom: 32, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
        {restaurant?.logo_url ? (
          <img src={restaurant.logo_url} alt="logo" style={{ width: 72, height: 72, borderRadius: 18, objectFit: 'cover', boxShadow: '0 4px 16px rgba(0,0,0,.12)' }} />
        ) : (
          <div style={{ width: 72, height: 72, borderRadius: 18, background: '#f2f2f7', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '2rem' }}>🍽️</div>
        )}
        <div style={{ fontWeight: 700, fontSize: '1.15rem', color: '#1c1c1e' }}>{restaurant?.name}</div>
        <div style={{ fontSize: '.8rem', color: '#aeaeb2' }}>Введите PIN для входа</div>
      </div>

      {/* PIN dots */}
      <div style={{
        display: 'flex', gap: 16, marginBottom: 40,
        animation: shaking ? 'shake .5s ease' : 'none',
      }}>
        {[0,1,2,3].map(i => (
          <div key={i} style={{
            width: 16, height: 16, borderRadius: '50%',
            background: pin.length > i ? (pinError ? '#ff3b30' : '#007aff') : 'rgba(60,60,67,.2)',
            transition: 'background .15s',
            transform: pin.length > i ? 'scale(1.1)' : 'scale(1)',
          }} />
        ))}
      </div>

      {pinError && (
        <div style={{ color: '#ff3b30', fontSize: '.82rem', fontWeight: 500, marginBottom: 20, marginTop: -28 }}>
          Неверный PIN
        </div>
      )}

      {/* Keypad */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, width: 240 }}>
        {['1','2','3','4','5','6','7','8','9','','0','⌫'].map((k, i) => (
          <button key={i} onClick={() => k === '⌫' ? handlePinDelete() : k ? handlePinDigit(k) : null}
            disabled={checking || k === ''}
            style={{
              width: 72, height: 72, borderRadius: '50%',
              background: k === '' ? 'transparent' : k === '⌫' ? 'transparent' : 'rgba(255,255,255,.9)',
              border: 'none',
              boxShadow: k === '' || k === '⌫' ? 'none' : '0 2px 8px rgba(0,0,0,.08)',
              fontSize: k === '⌫' ? '1.3rem' : '1.4rem',
              fontWeight: 500,
              color: k === '⌫' ? '#6d6d72' : '#1c1c1e',
              cursor: k === '' ? 'default' : 'pointer',
              fontFamily: '-apple-system,sans-serif',
              transition: 'transform .1s, background .1s',
              opacity: checking ? .5 : 1,
            }}
            onMouseDown={e => { if (k && k !== '') (e.target as any).style.transform = 'scale(.92)' }}
            onMouseUp={e => { (e.target as any).style.transform = 'scale(1)' }}
            onTouchStart={e => { if (k && k !== '') (e.target as any).style.transform = 'scale(.92)' }}
            onTouchEnd={e => { (e.target as any).style.transform = 'scale(1)' }}
          >
            {k}
          </button>
        ))}
      </div>

      <style>{`
        @keyframes shake {
          0%, 100% { transform: translateX(0) }
          20% { transform: translateX(-8px) }
          40% { transform: translateX(8px) }
          60% { transform: translateX(-6px) }
          80% { transform: translateX(6px) }
        }
      `}</style>
    </div>
  )

  // ── APP SELECT ──
  if (phase === 'app_select') {
    const apps = APPS.filter(a => (staffMember?.apps || []).includes(a.id))
    return (
      <div style={{ ...S.screen, justifyContent: 'flex-start', paddingTop: 60 }}>
        {/* Header */}
        <div style={{ marginBottom: 40, textAlign: 'center' }}>
          {restaurant?.logo_url ? (
            <img src={restaurant.logo_url} alt="logo" style={{ width: 56, height: 56, borderRadius: 14, objectFit: 'cover', marginBottom: 12 }} />
          ) : (
            <div style={{ width: 56, height: 56, borderRadius: 14, background: '#f2f2f7', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.6rem', margin: '0 auto 12px' }}>🍽️</div>
          )}
          <div style={{ fontWeight: 700, fontSize: '1.1rem', color: '#1c1c1e', marginBottom: 4 }}>{restaurant?.name}</div>
          <div style={{ fontSize: '.82rem', color: '#6d6d72' }}>
            {staffMember?.is_owner ? '👑 Владелец' : staffMember?.name}
          </div>
        </div>

        {/* App tiles */}
        <div style={{ width: '100%', maxWidth: 320, display: 'flex', flexDirection: 'column', gap: 12, padding: '0 20px' }}>
          {apps.map(app => (
            <button key={app.id} onClick={() => openApp(app.path)} style={{
              width: '100%', padding: '18px 20px',
              borderRadius: 16, border: 'none',
              background: '#fff',
              boxShadow: '0 2px 12px rgba(0,0,0,.07)',
              display: 'flex', alignItems: 'center', gap: 14,
              cursor: 'pointer', fontFamily: 'inherit',
              transition: 'transform .15s, box-shadow .15s',
            }}
            onMouseDown={e => { (e.currentTarget as any).style.transform = 'scale(.97)'; (e.currentTarget as any).style.boxShadow = '0 1px 6px rgba(0,0,0,.06)' }}
            onMouseUp={e => { (e.currentTarget as any).style.transform = 'scale(1)'; (e.currentTarget as any).style.boxShadow = '0 2px 12px rgba(0,0,0,.07)' }}
            onTouchStart={e => { (e.currentTarget as any).style.transform = 'scale(.97)' }}
            onTouchEnd={e => { (e.currentTarget as any).style.transform = 'scale(1)' }}
            >
              <div style={{ width: 44, height: 44, borderRadius: 12, background: app.color + '15', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <div style={{ width: 20, height: 20, borderRadius: 4, background: app.color }} />
              </div>
              <div style={{ textAlign: 'left', flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: '.95rem', color: '#1c1c1e' }}>{app.name}</div>
              </div>
              <div style={{ color: '#aeaeb2', fontSize: '1.1rem' }}>›</div>
            </button>
          ))}
        </div>

        {/* Logout */}
        <button onClick={logout} style={{ marginTop: 32, background: 'none', border: 'none', color: '#aeaeb2', fontSize: '.8rem', cursor: 'pointer', fontFamily: 'inherit', padding: '8px 16px' }}>
          Сменить пользователя
        </button>

        {/* Mise branding */}
        <div style={{ position: 'absolute', bottom: 32, display: 'flex', alignItems: 'center', gap: 8, opacity: .4 }}>
          <LogoMark size={18} />
          <span style={{ fontSize: '.75rem', fontWeight: 700, color: '#1c1c1e', letterSpacing: '-.01em' }}>mise</span>
        </div>
      </div>
    )
  }

  return null
}

const S: Record<string, any> = {
  screen: {
    minHeight: '100vh',
    background: '#f2f2f7',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: '-apple-system,BlinkMacSystemFont,sans-serif',
    WebkitFontSmoothing: 'antialiased',
    position: 'relative',
  }
}
