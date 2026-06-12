'use client'
import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { db } from '@/lib/db'
import { useTheme } from '@/hooks/useTheme'
import { AppIcon, Wordmark, type BrandApp } from '@/components/brand'

function QRScanner({ onResult, onClose, t }: { onResult: (data: string) => void; onClose: () => void; t: any }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const rafRef = useRef<number>(0)
  const [error, setError] = useState('')

  useEffect(() => {
    startCamera()
    return () => { stopCamera() }
  }, [])

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        videoRef.current.play()
        scan()
      }
    } catch {
      setError('Нет доступа к камере. Разрешите доступ в настройках браузера.')
    }
  }

  const stopCamera = () => {
    cancelAnimationFrame(rafRef.current)
    streamRef.current?.getTracks().forEach(t => t.stop())
  }

  const scan = () => {
    if (!videoRef.current || !canvasRef.current) { rafRef.current = requestAnimationFrame(scan); return }
    const video = videoRef.current
    if (video.readyState !== video.HAVE_ENOUGH_DATA) { rafRef.current = requestAnimationFrame(scan); return }
    const canvas = canvasRef.current
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) { rafRef.current = requestAnimationFrame(scan); return }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
    import('jsqr').then(({ default: jsQR }) => {
      const code = jsQR(imageData.data, imageData.width, imageData.height)
      if (code?.data) { stopCamera(); onResult(code.data) }
      else { rafRef.current = requestAnimationFrame(scan) }
    })
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 600, background: '#000', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ position: 'absolute', top: 16, left: 0, right: 0, display: 'flex', justifyContent: 'flex-end', padding: '0 16px', zIndex: 10 }}>
        <button onClick={() => { stopCamera(); onClose() }} style={{ width: 36, height: 36, borderRadius: '50%', background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12" /></svg>
        </button>
      </div>
      {error ? (
        <div style={{ textAlign: 'center', padding: '0 32px' }}>
          <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.6)', marginBottom: 20, lineHeight: 1.5 }}>{error}</div>
          <button onClick={() => { stopCamera(); onClose() }} style={{ padding: '12px 28px', borderRadius: 14, background: '#fff', color: '#000', border: 'none', fontFamily: 'inherit', fontSize: 15, fontWeight: 600, cursor: 'pointer' }}>Закрыть</button>
        </div>
      ) : (
        <>
          <div style={{ position: 'relative', width: '100%', maxWidth: 400, aspectRatio: '1' }}>
            <video ref={videoRef} style={{ width: '100%', height: '100%', objectFit: 'cover' }} playsInline muted />
            <canvas ref={canvasRef} style={{ display: 'none' }} />
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ width: 220, height: 220, position: 'relative' }}>
                {[
                  { top: 0, left: 0, borderTop: '3px solid #fff', borderLeft: '3px solid #fff' },
                  { top: 0, right: 0, borderTop: '3px solid #fff', borderRight: '3px solid #fff' },
                  { bottom: 0, left: 0, borderBottom: '3px solid #fff', borderLeft: '3px solid #fff' },
                  { bottom: 0, right: 0, borderBottom: '3px solid #fff', borderRight: '3px solid #fff' },
                ].map((s, i) => (
                  <div key={i} style={{ position: 'absolute', width: 32, height: 32, borderRadius: 3, ...s }} />
                ))}
              </div>
            </div>
          </div>
          <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: 14, marginTop: 24, textAlign: 'center', padding: '0 32px' }}>
            Наведите камеру на QR-код заведения
          </div>
        </>
      )}
    </div>
  )
}

type AuthPhase = 'loading' | 'qr' | 'pin' | 'biometric_offer' | 'error'

// Is the (httpOnly) staff data-token still valid? Read the readable companion cookie.
function staffTokenValid(): boolean {
  if (typeof document === 'undefined') return false
  const m = document.cookie.match(/(?:^|; )mise_token_until=(\d+)/)
  return m ? parseInt(m[1], 10) > Math.floor(Date.now() / 1000) : false
}

export function AuthGate({ appId, appName, onAuth }: {
  appId: string
  appName: string
  onAuth: (restaurantId: string) => void
}) {
  const t = useTheme()
  const router = useRouter()
  const [phase, setPhase] = useState<AuthPhase>('loading')
  const [showQRScanner, setShowQRScanner] = useState(false)
  const [restaurant, setRestaurant] = useState<any>(null)
  const [pin, setPin] = useState('')
  const [pinError, setPinError] = useState(false)
  const [shaking, setShaking] = useState(false)
  const [checking, setChecking] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  useEffect(() => { initAuth() }, [])

  const initAuth = async () => {
    const { data } = await supabase.auth.getUser()
    if (data.user) {
      // Owner has a Supabase session → resolve their restaurant via the gateway.
      const { data: rest } = await db.from('restaurants').select('id').eq('owner_id', data.user.id).single()
      if (rest?.id) {
        localStorage.setItem('mise_restaurant_id', rest.id)
        document.cookie = `mise_restaurant_id=${rest.id}; path=/; max-age=2592000; SameSite=Lax`
        // If an owner PIN is set, require it on app entry (token caches it for 30 days).
        const info = await getRestaurantInfo(rest.id)
        if (info?.has_owner_pin && !staffTokenValid()) {
          setRestaurant(info); setPhase('pin'); return
        }
        onAuth(rest.id)
        return
      }
    }

    const storedRid = localStorage.getItem('mise_restaurant_id')

    if (storedRid) {
      const staffRaw = localStorage.getItem('mise_staff_' + storedRid)
      if (staffRaw) {
        try {
          const staff = JSON.parse(staffRaw)
          if (!staff.is_owner && !staff.apps?.includes(appId)) {
            router.replace('/join?error=no_access')
            return
          }
          // Skip PIN via Face ID only if the data-token is still valid; otherwise re-enter PIN.
          const bioKey = `mise_bio_${storedRid}`
          if (localStorage.getItem(bioKey) === '1' && window.PublicKeyCredential && staffTokenValid()) {
            const bioOk = await tryBiometric(storedRid)
            if (bioOk) { onAuth(storedRid); return }
          }
        } catch {}
      }
      await loadRestaurant(storedRid)
      return
    }

    setPhase('qr')
  }

  const getRestaurantInfo = async (rid: string) => {
    const res = await fetch('/api/auth/restaurant-info', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ restaurantId: rid }),
    })
    const json = await res.json()
    return res.ok ? json.restaurant : null
  }

  const loadRestaurant = async (rid: string) => {
    const info = await getRestaurantInfo(rid)
    if (!info) { setErrorMsg('Заведение не найдено'); setPhase('error'); return }
    setRestaurant(info)
    setPhase('pin')
  }

  const tryBiometric = async (rid: string): Promise<boolean> => {
    try {
      const result = await (navigator.credentials as any).get({
        publicKey: { challenge: new Uint8Array(32), timeout: 60000, userVerification: 'required' }
      })
      return !!result
    } catch { return false }
  }

  const handleQRResult = async (raw: string) => {
    let restaurantId = raw
    try {
      const url = new URL(raw)
      const param = url.searchParams.get('restaurant')
      if (param) restaurantId = param
    } catch {}
    localStorage.setItem('mise_restaurant_id', restaurantId)
    document.cookie = `mise_restaurant_id=${restaurantId}; path=/; max-age=2592000; SameSite=Lax`
    await loadRestaurant(restaurantId)
  }

  const handlePinDigit = (digit: string) => {
    if (pin.length >= 4 || checking) return
    const newPin = pin + digit
    setPin(newPin)
    setPinError(false)
    if (newPin.length === 4) checkPin(newPin)
  }

  const checkPin = async (enteredPin: string) => {
    if (!restaurant) return
    setChecking(true)
    const res = await fetch('/api/auth/pin/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ restaurantId: restaurant.id, pin: enteredPin }),
    })
    const result = await res.json()

    if (result.match) {
      const staffData = result.is_owner
        ? { id: 'owner', name: 'Владелец', apps: ['manager', 'analytics', 'stash'], is_owner: true }
        : result.staff
      if (!result.is_owner && !staffData?.apps?.includes(appId)) {
        setChecking(false)
        setErrorMsg('У вас нет доступа к этому приложению')
        setPhase('error')
        return
      }
      localStorage.setItem('mise_staff_' + restaurant.id, JSON.stringify(staffData))
      setChecking(false)
      const bioKey = `mise_bio_${restaurant.id}`
      if (!localStorage.getItem(bioKey) && window.PublicKeyCredential) {
        setPhase('biometric_offer')
      } else {
        onAuth(restaurant.id)
      }
    } else {
      setChecking(false)
      setPinError(true)
      setShaking(true)
      setTimeout(() => { setShaking(false); setPin('') }, 600)
    }
  }

  const screenStyle: React.CSSProperties = {
    minHeight: '100vh', background: t.bg,
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    fontFamily: "-apple-system,BlinkMacSystemFont,'SF Pro Text',sans-serif",
    WebkitFontSmoothing: 'antialiased', position: 'relative', userSelect: 'none',
  }

  if (phase === 'loading') return (
    <div style={screenStyle}>
      <AppIcon app={appId as BrandApp} size={64} />
      <div style={{ width: 24, height: 24, border: `2.5px solid ${t.fill}`, borderTopColor: t.blue, borderRadius: '50%', animation: 'spin .7s linear infinite', marginTop: 20 }} />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )

  if (phase === 'error') return (
    <div style={screenStyle}>
      <div style={{ width: 64, height: 64, borderRadius: 16, background: `${t.red}18`, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 20 }}>
        <svg width="32" height="32" fill="none" stroke={t.red} strokeWidth="2.5" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" /></svg>
      </div>
      <div style={{ fontWeight: 700, fontSize: 18, color: t.text, marginBottom: 8 }}>Ошибка</div>
      <div style={{ color: t.text3, fontSize: 14, textAlign: 'center', maxWidth: 260 }}>{errorMsg}</div>
    </div>
  )

  if (phase === 'qr') return (
    <>
      <div style={screenStyle}>
        <style>{`@keyframes spin{to{transform:rotate(360deg)}} @keyframes fadeUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}`}</style>
        <div style={{ marginBottom: 40, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
          <AppIcon app={appId as BrandApp} size={72} />
          <div style={{ fontWeight: 700, fontSize: 22, color: t.text, letterSpacing: -0.5 }}>{appName}</div>
          <div style={{ fontSize: 14, color: t.text3, textAlign: 'center', maxWidth: 260 }}>Для начала работы отсканируйте QR-код в разделе Доступ на дашборде заведения</div>
        </div>
        <div style={{ width: 220, height: 220, borderRadius: 24, background: t.surface, boxShadow: t.sh, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 40, position: 'relative' }}>
          <svg width="80" height="80" viewBox="0 0 80 80" fill="none" opacity={0.2}>
            <rect x="4" y="4" width="30" height="30" rx="4" stroke={t.text} strokeWidth="3" fill="none"/>
            <rect x="12" y="12" width="14" height="14" rx="2" fill={t.text}/>
            <rect x="46" y="4" width="30" height="30" rx="4" stroke={t.text} strokeWidth="3" fill="none"/>
            <rect x="54" y="12" width="14" height="14" rx="2" fill={t.text}/>
            <rect x="4" y="46" width="30" height="30" rx="4" stroke={t.text} strokeWidth="3" fill="none"/>
            <rect x="12" y="54" width="14" height="14" rx="2" fill={t.text}/>
            <rect x="46" y="46" width="8" height="8" rx="1" fill={t.text}/>
            <rect x="60" y="46" width="8" height="8" rx="1" fill={t.text}/>
            <rect x="46" y="60" width="8" height="8" rx="1" fill={t.text}/>
            <rect x="60" y="60" width="16" height="16" rx="2" fill={t.text}/>
          </svg>
          {[
            { top: 16, left: 16, borderTop: `3px solid ${t.blue}`, borderLeft: `3px solid ${t.blue}` },
            { top: 16, right: 16, borderTop: `3px solid ${t.blue}`, borderRight: `3px solid ${t.blue}` },
            { bottom: 16, left: 16, borderBottom: `3px solid ${t.blue}`, borderLeft: `3px solid ${t.blue}` },
            { bottom: 16, right: 16, borderBottom: `3px solid ${t.blue}`, borderRight: `3px solid ${t.blue}` },
          ].map((s, i) => (
            <div key={i} style={{ position: 'absolute', width: 28, height: 28, borderRadius: 3, ...s }} />
          ))}
        </div>
        <button onClick={() => setShowQRScanner(true)} style={{ padding: '16px 40px', borderRadius: 16, background: t.blue, color: '#fff', border: 'none', fontFamily: 'inherit', fontSize: 16, fontWeight: 700, cursor: 'pointer', boxShadow: `0 4px 16px ${t.blue}44` }}>
          Сканировать QR
        </button>
        <div style={{ position: 'absolute', bottom: 32, display: 'flex', alignItems: 'center', gap: 8, opacity: 0.35 }}>
          <Wordmark size={16} color={t.text} />
        </div>
      </div>
      {showQRScanner && (
        <QRScanner
          onResult={(data) => { setShowQRScanner(false); handleQRResult(data) }}
          onClose={() => setShowQRScanner(false)}
          t={t}
        />
      )}
    </>
  )

  if (phase === 'pin') return (
    <div style={screenStyle}>
      <style>{`@keyframes shake{0%,100%{transform:translateX(0)}20%{transform:translateX(-10px)}40%{transform:translateX(10px)}60%{transform:translateX(-7px)}80%{transform:translateX(7px)}} @keyframes spin{to{transform:rotate(360deg)}}`}</style>
      <div style={{ marginBottom: 36, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
        {restaurant?.logo_url ? (
          <img src={restaurant.logo_url} alt="logo" style={{ width: 72, height: 72, borderRadius: 18, objectFit: 'cover', boxShadow: '0 4px 16px rgba(0,0,0,.12)' }} />
        ) : (
          <AppIcon app={appId as BrandApp} size={72} />
        )}
        <div style={{ fontWeight: 700, fontSize: 20, color: t.text }}>{restaurant?.name}</div>
        <div style={{ fontSize: 13, color: t.text3 }}>Введите PIN для входа</div>
      </div>
      <div style={{ display: 'flex', gap: 18, marginBottom: 44, animation: shaking ? 'shake .5s ease' : 'none' }}>
        {[0, 1, 2, 3].map(i => (
          <div key={i} style={{ width: 14, height: 14, borderRadius: '50%', background: pin.length > i ? (pinError ? t.red : t.blue) : t.fill, transition: 'background .15s, transform .15s', transform: pin.length > i ? 'scale(1.15)' : 'scale(1)' }} />
        ))}
      </div>
      {pinError && (
        <div style={{ color: t.red, fontSize: 13, fontWeight: 500, marginBottom: -28, marginTop: -36 }}>Неверный PIN</div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 76px)', gap: 14 }}>
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'].map((k, i) => (
          <button key={i}
            onClick={() => k === '⌫' ? setPin(p => p.slice(0, -1)) : k ? handlePinDigit(k) : undefined}
            disabled={checking || k === ''}
            style={{ width: 76, height: 76, borderRadius: '50%', background: k === '' ? 'transparent' : t.surface, border: 'none', boxShadow: k === '' ? 'none' : t.sh, fontSize: k === '⌫' ? '1.3rem' : '1.5rem', fontWeight: 400, color: t.text, cursor: k === '' ? 'default' : 'pointer', fontFamily: 'inherit', opacity: checking ? 0.5 : 1, transition: 'transform .1s', WebkitTapHighlightColor: 'transparent' }}
            onPointerDown={e => { if (k) e.currentTarget.style.transform = 'scale(.9)' }}
            onPointerUp={e => { e.currentTarget.style.transform = 'scale(1)' }}
            onPointerLeave={e => { e.currentTarget.style.transform = 'scale(1)' }}
          >{k}</button>
        ))}
      </div>
      <button onClick={() => { localStorage.removeItem('mise_restaurant_id'); setPhase('qr') }} style={{ marginTop: 36, background: 'none', border: 'none', color: t.text3, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', padding: '8px 20px' }}>
        Сменить заведение
      </button>
      <div style={{ position: 'absolute', bottom: 32, display: 'flex', alignItems: 'center', gap: 8, opacity: 0.35 }}>
        <Wordmark size={16} color={t.text} />
      </div>
    </div>
  )

  if (phase === 'biometric_offer') return (
    <div style={screenStyle}>
      <div style={{ marginBottom: 32, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
        <div style={{ width: 88, height: 88, borderRadius: 24, background: `${t.blue}18`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="44" height="44" fill="none" stroke={t.blue} strokeWidth="1.8" viewBox="0 0 24 24"><path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" /><path d="M19 10v2a7 7 0 01-14 0v-2" /><path d="M12 19v4M8 23h8" /></svg>
        </div>
        <div style={{ fontWeight: 700, fontSize: 22, color: t.text, letterSpacing: -0.5 }}>Включить Face ID?</div>
        <div style={{ fontSize: 14, color: t.text3, textAlign: 'center', maxWidth: 260 }}>Следующий вход будет быстрее — без ввода PIN</div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: '100%', maxWidth: 320, padding: '0 24px' }}>
        <button onClick={() => { if (restaurant) { localStorage.setItem(`mise_bio_${restaurant.id}`, '1'); onAuth(restaurant.id) } }} style={{ padding: '16px', borderRadius: 16, background: t.blue, color: '#fff', border: 'none', fontFamily: 'inherit', fontSize: 16, fontWeight: 700, cursor: 'pointer', boxShadow: `0 4px 16px ${t.blue}44` }}>Включить Face ID</button>
        <button onClick={() => { if (restaurant) { localStorage.setItem(`mise_bio_${restaurant.id}`, '0'); onAuth(restaurant.id) } }} style={{ padding: '16px', borderRadius: 16, background: t.fill, color: t.text, border: 'none', fontFamily: 'inherit', fontSize: 16, fontWeight: 600, cursor: 'pointer' }}>Не сейчас</button>
      </div>
    </div>
  )

  return null
}
