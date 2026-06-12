'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { QRCodeSVG as QRCode } from 'qrcode.react'
import { Wordmark, AppIcon } from '@/components/brand'

const APPS = [
  { id: 'manager',   name: 'Mise Manager',   color: '#007aff', path: '/manager' },
  { id: 'analytics', name: 'Mise Analytics', color: '#34c759', path: '/analytics' },
  { id: 'stash',     name: 'Mise Stash',     color: '#ff9500', path: '/tobacco' },
  { id: 'people',    name: 'Mise People',    color: '#5856d6', path: '/people' },
]


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
  const router = useRouter()
  const [phase, setPhase] = useState<Phase>('loading')
  const [restaurant, setRestaurant] = useState<any>(null)
  const [staffMember, setStaffMember] = useState<any>(null)
  const [pin, setPin] = useState('')
  const [pinError, setPinError] = useState(false)
  const [shaking, setShaking] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [checking, setChecking] = useState(false)

  useEffect(() => { initJoin() }, [])

  const initJoin = async () => {
    const params = new URLSearchParams(window.location.search)
    const restaurantId = params.get('restaurant')
    if (!restaurantId) { setErrorMsg('Неверная ссылка'); setPhase('error'); return }

    getDeviceId() // ensure a device id exists for binding
    const savedStaff = localStorage.getItem('mise_staff_' + restaurantId)

    const res = await fetch('/api/auth/restaurant-info', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ restaurantId }),
    })
    const json = await res.json()
    if (!res.ok || !json.restaurant) { setErrorMsg('Заведение не найдено'); setPhase('error'); return }
    setRestaurant(json.restaurant)
    localStorage.setItem('mise_restaurant_id', restaurantId)
    document.cookie = `mise_restaurant_id=${restaurantId}; path=/; max-age=2592000; SameSite=Lax`

    // Returning user: skip PIN only while the server data-token is still valid.
    const m = document.cookie.match(/(?:^|; )mise_token_until=(\d+)/)
    const tokenValid = m ? parseInt(m[1], 10) > Math.floor(Date.now() / 1000) : false
    if (savedStaff && tokenValid) {
      try {
        const parsed = JSON.parse(savedStaff)
        setStaffMember(parsed)
        goToApp(parsed.apps)
        return
      } catch {}
    }
    setPhase('pin')
  }

  const goToApp = (apps: string[]) => {
    if (!apps || apps.length === 0) { setPhase('error'); setErrorMsg('Нет доступных приложений'); return }
    if (apps.length === 1) {
      const app = APPS.find(a => a.id === apps[0])
      if (app) { router.push(app.path); return }
    }
    setPhase('app_select')
  }

  const handlePinDigit = (digit: string) => {
    if (pin.length >= 4 || checking) return
    const newPin = pin + digit
    setPin(newPin)
    setPinError(false)
    if (newPin.length === 4) checkPin(newPin)
  }

  const handlePinDelete = () => {
    if (checking) return
    setPin(p => p.slice(0, -1))
    setPinError(false)
  }

  const checkPin = async (enteredPin: string) => {
    if (!restaurant) return
    setChecking(true)

    const res = await fetch('/api/auth/pin/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ restaurantId: restaurant.id, pin: enteredPin, deviceId: getDeviceId() }),
    })
    const result = await res.json()

    if (result.match) {
      if (result.is_owner) {
        const ownerData = { id: 'owner', name: 'Владелец', apps: ['manager', 'analytics', 'stash'], is_owner: true }
        localStorage.setItem('mise_staff_' + restaurant.id, JSON.stringify(ownerData))
        setStaffMember(ownerData)
        setChecking(false)
        goToApp(ownerData.apps)
      } else {
        const matched = result.staff
        // Device binding now happens server-side in /api/auth/pin/check.
        localStorage.setItem('mise_staff_' + restaurant.id, JSON.stringify({ id: matched.id, name: matched.name, apps: matched.apps, role: matched.role }))
        setStaffMember(matched)
        setChecking(false)
        goToApp(matched.apps)
      }
    } else {
      setChecking(false)
      setPinError(true)
      setShaking(true)
      setTimeout(() => { setShaking(false); setPin('') }, 600)
    }
  }

  const openApp = (path: string) => {
    router.push(path)
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
      <Wordmark size={32} color="#1c1c1e" />
      <div style={{ color: '#aeaeb2', fontSize: '.85rem', marginTop: 16 }}>Загрузка...</div>
    </div>
  )

  // ── ERROR ──
  if (phase === 'error') return (
    <div style={S.screen}>
      <div style={{ width: 64, height: 64, borderRadius: 16, background: 'rgba(255,59,48,.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
        <svg width="30" height="30" fill="none" stroke="#ff3b30" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
      </div>
      <div style={{ fontWeight: 700, fontSize: '1.1rem', color: '#1c1c1e', marginBottom: 8 }}>Ошибка</div>
      <div style={{ color: '#6d6d72', fontSize: '.88rem', textAlign: 'center', maxWidth: 260 }}>{errorMsg}</div>
    </div>
  )

  // ── PIN ENTRY ──
  if (phase === 'pin') return (
    <div style={S.screen}>
      <div style={{ marginBottom: 36, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
        {restaurant?.logo_url ? (
          <img src={restaurant.logo_url} alt="logo" style={{ width: 72, height: 72, borderRadius: 18, objectFit: 'cover', boxShadow: '0 4px 16px rgba(0,0,0,.12)' }} />
        ) : (
          <AppIcon app="mise" size={72} />
        )}
        <div style={{ fontWeight: 700, fontSize: '1.2rem', color: '#1c1c1e' }}>{restaurant?.name}</div>
        <div style={{ fontSize: '.82rem', color: '#aeaeb2' }}>Введите PIN для входа</div>
      </div>

      {/* PIN dots */}
      <div style={{
        display: 'flex', gap: 18, marginBottom: 44,
        animation: shaking ? 'shake .5s ease' : 'none',
      }}>
        {[0,1,2,3].map(i => (
          <div key={i} style={{
            width: 14, height: 14, borderRadius: '50%',
            background: pin.length > i
              ? (pinError ? '#ff3b30' : '#007aff')
              : 'rgba(60,60,67,.2)',
            transition: 'background .15s, transform .15s',
            transform: pin.length > i ? 'scale(1.15)' : 'scale(1)',
          }} />
        ))}
      </div>

      {pinError && (
        <div style={{ color: '#ff3b30', fontSize: '.82rem', fontWeight: 500, marginBottom: -28, marginTop: -36 }}>
          Неверный PIN
        </div>
      )}

      {/* Keypad */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 76px)', gap: 14 }}>
        {['1','2','3','4','5','6','7','8','9','','0','⌫'].map((k, i) => (
          <button key={i}
            onClick={() => k === '⌫' ? handlePinDelete() : k ? handlePinDigit(k) : null}
            disabled={checking || k === ''}
            style={{
              width: 76, height: 76, borderRadius: '50%',
              background: k === '' ? 'transparent' : k === '⌫' ? 'rgba(0,0,0,.04)' : '#fff',
              border: 'none',
              boxShadow: k === '' ? 'none' : k === '⌫' ? 'none' : '0 2px 8px rgba(0,0,0,.07)',
              fontSize: k === '⌫' ? '1.4rem' : '1.5rem',
              fontWeight: 400,
              color: k === '⌫' ? '#6d6d72' : '#1c1c1e',
              cursor: k === '' ? 'default' : 'pointer',
              fontFamily: '-apple-system,sans-serif',
              opacity: checking ? .5 : 1,
              transition: 'transform .1s',
              WebkitTapHighlightColor: 'transparent',
            }}
            onPointerDown={e => { if (k) (e.currentTarget.style.transform = 'scale(.9)') }}
            onPointerUp={e => { (e.currentTarget.style.transform = 'scale(1)') }}
            onPointerLeave={e => { (e.currentTarget.style.transform = 'scale(1)') }}
          >
            {k}
          </button>
        ))}
      </div>

      <div style={{ position: 'absolute', bottom: 32, display: 'flex', alignItems: 'center', gap: 8, opacity: .35 }}>
        <Wordmark size={16} color="#1c1c1e" />
      </div>

      <style>{`
        @keyframes shake {
          0%,100% { transform: translateX(0) }
          20% { transform: translateX(-10px) }
          40% { transform: translateX(10px) }
          60% { transform: translateX(-7px) }
          80% { transform: translateX(7px) }
        }
      `}</style>
    </div>
  )

  // ── APP SELECT (только если несколько приложений) ──
  if (phase === 'app_select') {
    const apps = APPS.filter(a => (staffMember?.apps || []).includes(a.id))
    return (
      <div style={{ ...S.screen, justifyContent: 'flex-start', paddingTop: 72 }}>
        <div style={{ marginBottom: 40, textAlign: 'center' }}>
          {restaurant?.logo_url ? (
            <img src={restaurant.logo_url} alt="logo" style={{ width: 60, height: 60, borderRadius: 15, objectFit: 'cover', marginBottom: 14, boxShadow: '0 4px 14px rgba(0,0,0,.1)' }} />
          ) : (
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 14 }}><AppIcon app="mise" size={60} /></div>
          )}
          <div style={{ fontWeight: 700, fontSize: '1.1rem', color: '#1c1c1e', marginBottom: 4 }}>{restaurant?.name}</div>
          <div style={{ fontSize: '.82rem', color: '#6d6d72' }}>
            {staffMember?.is_owner ? 'Владелец' : staffMember?.name}
          </div>
        </div>

        <div style={{ width: '100%', maxWidth: 320, display: 'flex', flexDirection: 'column', gap: 12, padding: '0 24px' }}>
          {apps.map(app => (
            <button key={app.id} onClick={() => openApp(app.path)} style={{
              width: '100%', padding: '18px 20px',
              borderRadius: 16, border: 'none',
              background: '#fff',
              boxShadow: '0 2px 12px rgba(0,0,0,.07)',
              display: 'flex', alignItems: 'center', gap: 14,
              cursor: 'pointer', fontFamily: 'inherit',
              WebkitTapHighlightColor: 'transparent',
            }}
            onPointerDown={e => { e.currentTarget.style.transform = 'scale(.97)' }}
            onPointerUp={e => { e.currentTarget.style.transform = 'scale(1)' }}
            onPointerLeave={e => { e.currentTarget.style.transform = 'scale(1)' }}
            >
              <div style={{ width: 44, height: 44, borderRadius: 12, background: app.color + '18', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <div style={{ width: 22, height: 22, borderRadius: 6, background: app.color }} />
              </div>
              <div style={{ textAlign: 'left', flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: '.95rem', color: '#1c1c1e' }}>{app.name}</div>
              </div>
              <div style={{ color: '#c7c7cc', fontSize: '1.2rem', fontWeight: 300 }}>›</div>
            </button>
          ))}
        </div>

        <button onClick={logout} style={{ marginTop: 36, background: 'none', border: 'none', color: '#aeaeb2', fontSize: '.8rem', cursor: 'pointer', fontFamily: 'inherit', padding: '8px 20px', WebkitTapHighlightColor: 'transparent' }}>
          Сменить пользователя
        </button>

        <div style={{ position: 'absolute', bottom: 32, display: 'flex', alignItems: 'center', gap: 8, opacity: .35 }}>
          <Wordmark size={16} color="#1c1c1e" />
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
    userSelect: 'none',
  }
}
