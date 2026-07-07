'use client'
import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { db } from '@/lib/db'
import { useI18n } from '@/lib/i18n'

// Нативный онбординг (только внутри Capacitor-оболочки): приветствие с анимированным
// логотипом → скан QR заведения → PIN → разрешения (Face ID / гео / уведомления).
// На сайте в браузере этот экран НЕ показывается — там остаётся маркетинговый лендинг.

const APP_PATHS: Record<string, string> = {
  manager: '/manager', analytics: '/analytics', stash: '/tobacco', people: '/people',
}

// Разбросанные позиции (в % от экрана) для фоновых фраз — фиксированы, чтобы не «прыгали».
const FEATURE_POS = [
  { top: '14%', left: '8%' }, { top: '22%', right: '6%' }, { top: '34%', left: '12%' },
  { top: '30%', right: '14%' }, { top: '60%', left: '6%' }, { top: '64%', right: '8%' },
  { top: '72%', left: '18%' }, { top: '50%', right: '4%' }, { top: '44%', left: '4%' },
]

const C = {
  bg: '#000000',
  text: '#ffffff',
  sub: 'rgba(235,235,245,0.55)',
  sub2: 'rgba(235,235,245,0.32)',
  surface: 'rgba(255,255,255,0.07)',
  surfaceBorder: 'rgba(255,255,255,0.10)',
  blue: '#0a84ff',
}
const FONT = "-apple-system,BlinkMacSystemFont,'SF Pro Display','SF Pro Text',sans-serif"
const APPS_GRADIENT = 'linear-gradient(90deg,#007aff,#34c759,#ff9500,#5856d6,#ff2d55,#007aff)'

type Phase = 'init' | 'welcome' | 'connect' | 'pin' | 'perm' | 'error'

// ── Анимированный логотип: «mis» белым, «e» — переливающийся градиент 5 приложений ──
function AnimatedWordmark({ size = 68 }: { size?: number }) {
  return (
    <span style={{ fontWeight: 800, fontSize: size, letterSpacing: '-0.05em', lineHeight: 1, fontFamily: FONT, color: C.text, whiteSpace: 'nowrap' }}>
      mis
      <span style={{
        background: APPS_GRADIENT, backgroundSize: '300% 100%',
        WebkitBackgroundClip: 'text', backgroundClip: 'text',
        WebkitTextFillColor: 'transparent', color: 'transparent',
        animation: 'miseFlow 4.5s linear infinite',
      }}>e</span>
    </span>
  )
}

// ── Камера-сканер QR (getUserMedia + jsQR) ──
function Scanner({ onResult, t }: { onResult: (data: string) => void; t: (k: string) => string }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const rafRef = useRef<number>(0)
  const [denied, setDenied] = useState(false)

  useEffect(() => {
    let cancelled = false
    const stop = () => {
      cancelAnimationFrame(rafRef.current)
      streamRef.current?.getTracks().forEach(t => t.stop())
    }
    const scan = () => {
      const video = videoRef.current, canvas = canvasRef.current
      if (!video || !canvas || video.readyState !== video.HAVE_ENOUGH_DATA) {
        rafRef.current = requestAnimationFrame(scan); return
      }
      canvas.width = video.videoWidth; canvas.height = video.videoHeight
      const ctx = canvas.getContext('2d')
      if (!ctx) { rafRef.current = requestAnimationFrame(scan); return }
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
      import('jsqr').then(({ default: jsQR }) => {
        const code = jsQR(img.data, img.width, img.height)
        if (code?.data) { stop(); onResult(code.data) }
        else rafRef.current = requestAnimationFrame(scan)
      })
    }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } } })
      .then(stream => {
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return }
        streamRef.current = stream
        if (videoRef.current) { videoRef.current.srcObject = stream; videoRef.current.play(); scan() }
      })
      .catch(() => setDenied(true))
    return () => { cancelled = true; stop() }
  }, [onResult])

  if (denied) return (
    <div style={{ textAlign: 'center', color: C.sub, fontSize: 14, lineHeight: 1.5, padding: '0 24px' }}>
      {t('onb.cameraDenied')}
    </div>
  )

  return (
    <div style={{ position: 'relative', width: '100%', maxWidth: 300, aspectRatio: '1', borderRadius: 28, overflow: 'hidden', background: '#0a0a0a' }}>
      <video ref={videoRef} style={{ width: '100%', height: '100%', objectFit: 'cover' }} playsInline muted />
      <canvas ref={canvasRef} style={{ display: 'none' }} />
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: '64%', height: '64%', position: 'relative' }}>
          {[
            { top: 0, left: 0, borderTop: '3px solid #fff', borderLeft: '3px solid #fff' },
            { top: 0, right: 0, borderTop: '3px solid #fff', borderRight: '3px solid #fff' },
            { bottom: 0, left: 0, borderBottom: '3px solid #fff', borderLeft: '3px solid #fff' },
            { bottom: 0, right: 0, borderBottom: '3px solid #fff', borderRight: '3px solid #fff' },
          ].map((s, i) => <div key={i} style={{ position: 'absolute', width: 30, height: 30, borderRadius: 4, ...s }} />)}
        </div>
      </div>
    </div>
  )
}

function getDeviceId(): string {
  const key = 'mise_device_id'
  let id = localStorage.getItem(key)
  if (!id) {
    id = 'dev_' + Math.random().toString(36).slice(2) + Date.now().toString(36)
    localStorage.setItem(key, id)
  }
  return id
}

export function NativeOnboarding() {
  const router = useRouter()
  const { t: tr } = useI18n()
  const [phase, setPhase] = useState<Phase>('init')
  const [restaurant, setRestaurant] = useState<any>(null)
  const [pin, setPin] = useState('')
  const [pinError, setPinError] = useState(false)
  const [shaking, setShaking] = useState(false)
  const [checking, setChecking] = useState(false)
  const [staff, setStaff] = useState<any>(null)
  const [errorMsg, setErrorMsg] = useState('')
  const [permStep, setPermStep] = useState(0)

  useEffect(() => { init() }, [])

  const goToApp = (apps: string[], rid: string) => {
    if (!apps || apps.length === 0) { setErrorMsg(tr('onb.noApps')); setPhase('error'); return }
    if (apps.length === 1 && APP_PATHS[apps[0]]) { router.replace(APP_PATHS[apps[0]]); return }
    router.replace('/join?restaurant=' + rid)
  }

  const tokenValid = () => {
    const m = document.cookie.match(/(?:^|; )mise_token_until=(\d+)/)
    return m ? parseInt(m[1], 10) > Math.floor(Date.now() / 1000) : false
  }

  const init = async () => {
    try {
      const rid = localStorage.getItem('mise_restaurant_id')
      if (rid && tokenValid()) {
        const raw = localStorage.getItem('mise_staff_' + rid)
        if (raw) { const s = JSON.parse(raw); goToApp(s.apps, rid); return }
      }
    } catch {}
    try {
      const withTimeout = <T,>(p: Promise<T>, ms: number) =>
        Promise.race([p, new Promise<null>(r => setTimeout(() => r(null), ms))])
      const got = await withTimeout(supabase.auth.getUser(), 2500)
      const user = (got as any)?.data?.user
      if (user) {
        const rest = await withTimeout(db.from('restaurants').select('id').eq('owner_id', user.id).single(), 2500)
        if ((rest as any)?.data?.id) { router.replace('/dashboard'); return }
      }
    } catch {}
    setPhase('welcome')
  }

  const getRestaurantInfo = async (rid: string) => {
    const res = await fetch('/api/auth/restaurant-info', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ restaurantId: rid }),
    })
    const json = await res.json()
    return res.ok ? json.restaurant : null
  }

  const handleScan = async (raw: string) => {
    let rid = raw
    try { const u = new URL(raw); const p = u.searchParams.get('restaurant'); if (p) rid = p } catch {}
    const info = await getRestaurantInfo(rid)
    if (!info) { setErrorMsg(tr('onb.venueNotFound')); setPhase('error'); return }
    localStorage.setItem('mise_restaurant_id', rid)
    document.cookie = `mise_restaurant_id=${rid}; path=/; max-age=2592000; SameSite=Lax`
    setRestaurant(info)
    setPin(''); setPinError(false)
    setPhase('pin')
  }

  const handleDigit = (d: string) => {
    if (pin.length >= 4 || checking) return
    const next = pin + d
    setPin(next); setPinError(false)
    if (next.length === 4) checkPin(next)
  }

  const checkPin = async (entered: string) => {
    if (!restaurant) return
    setChecking(true)
    try {
      const res = await fetch('/api/auth/pin/check', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ restaurantId: restaurant.id, pin: entered, deviceId: getDeviceId() }),
      })
      const result = await res.json()
      if (result.match) {
        const data = result.is_owner
          ? { id: 'owner', name: tr('onb.owner'), apps: ['manager', 'analytics', 'stash', 'people'], is_owner: true }
          : result.staff
        localStorage.setItem('mise_staff_' + restaurant.id, JSON.stringify(data))
        setStaff(data)
        setChecking(false)
        setPermStep(0)
        setPhase('perm')
      } else {
        setChecking(false); setPinError(true); setShaking(true)
        setTimeout(() => { setShaking(false); setPin('') }, 600)
      }
    } catch {
      setChecking(false); setPinError(true); setShaking(true)
      setTimeout(() => { setShaking(false); setPin('') }, 600)
    }
  }

  // ── Разрешения: Face ID → Уведомления → Геолокация ──
  const requestFaceId = async () => {
    try {
      if ((window as any).PublicKeyCredential) {
        await (navigator.credentials as any).get({
          publicKey: { challenge: new Uint8Array(32), timeout: 60000, userVerification: 'required' },
        })
      }
      if (restaurant) localStorage.setItem(`mise_bio_${restaurant.id}`, '1')
    } catch {
      if (restaurant) localStorage.setItem(`mise_bio_${restaurant.id}`, '0')
    }
    nextPerm()
  }

  const requestNotifications = async () => {
    try {
      const ln = (window as any).Capacitor?.Plugins?.LocalNotifications
      if (ln?.requestPermissions) await ln.requestPermissions()
    } catch {}
    nextPerm()
  }

  const requestLocation = async () => {
    try {
      await new Promise<void>((resolve) => {
        if (!navigator.geolocation) return resolve()
        navigator.geolocation.getCurrentPosition(() => resolve(), () => resolve(), { timeout: 8000 })
      })
    } catch {}
    finishPerms()
  }

  const FEATURES = [
    tr('onb.featShifts'), tr('onb.featRevenue'), tr('onb.featStock'), tr('onb.featSchedule'),
    tr('onb.featPayroll'), tr('onb.featMenu'), tr('onb.featInventory'), tr('onb.featHookah'), tr('onb.featGeo'),
  ]

  const PERMS = [
    {
      key: 'faceid', title: tr('onb.faceidTitle'), desc: tr('onb.faceidDesc'),
      cta: tr('onb.faceidCta'), onAllow: requestFaceId,
      icon: (
        <svg width="40" height="40" fill="none" stroke="#fff" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" /><path d="M9 10v1M15 10v1M9.5 15a3.5 3.5 0 0 0 5 0" /></svg>
      ),
    },
    {
      key: 'notif', title: tr('onb.notifTitle'), desc: tr('onb.notifDesc'),
      cta: tr('onb.notifCta'), onAllow: requestNotifications,
      icon: (
        <svg width="40" height="40" fill="none" stroke="#fff" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" /></svg>
      ),
    },
    {
      key: 'geo', title: tr('onb.geoTitle'), desc: tr('onb.geoDesc'),
      cta: tr('onb.geoCta'), onAllow: requestLocation,
      icon: (
        <svg width="40" height="40" fill="none" stroke="#fff" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M21 10c0 7-9 12-9 12s-9-5-9-12a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></svg>
      ),
    },
  ]

  const nextPerm = () => setPermStep(s => s + 1)
  const finishPerms = () => { if (restaurant && staff) goToApp(staff.apps, restaurant.id) }
  const skipPerm = () => { if (permStep >= PERMS.length - 1) finishPerms(); else nextPerm() }

  const screen: React.CSSProperties = {
    position: 'fixed', inset: 0, background: C.bg, color: C.text, fontFamily: FONT,
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    WebkitFontSmoothing: 'antialiased', userSelect: 'none', overflow: 'hidden',
    paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)',
  }
  const keyframes = `
    @keyframes miseFlow{0%{background-position:0% 50%}100%{background-position:300% 50%}}
    @keyframes featPulse{0%,100%{opacity:0}45%,55%{opacity:.5}}
    @keyframes upFade{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}
    @keyframes shake{0%,100%{transform:translateX(0)}20%{transform:translateX(-10px)}40%{transform:translateX(10px)}60%{transform:translateX(-7px)}80%{transform:translateX(7px)}}
    @keyframes spin{to{transform:rotate(360deg)}}
  `

  if (phase === 'init') return (
    <div style={screen}><style>{keyframes}</style>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <AnimatedWordmark size={56} />
      </div>
    </div>
  )

  if (phase === 'error') return (
    <div style={screen}><style>{keyframes}</style>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '0 32px', textAlign: 'center' }}>
        <div style={{ width: 64, height: 64, borderRadius: 18, background: 'rgba(255,69,58,.16)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 20 }}>
          <svg width="32" height="32" fill="none" stroke="#ff453a" strokeWidth="2.5" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" /></svg>
        </div>
        <div style={{ fontWeight: 700, fontSize: 19, marginBottom: 8 }}>{tr('onb.errorTitle')}</div>
        <div style={{ color: C.sub, fontSize: 14, lineHeight: 1.5, maxWidth: 280, marginBottom: 28 }}>{errorMsg}</div>
        <button onClick={() => { setErrorMsg(''); setPhase('connect') }} style={btnPrimary}>{tr('onb.scanAgain')}</button>
      </div>
    </div>
  )

  if (phase === 'welcome') return (
    <div style={screen}><style>{keyframes}</style>
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
        {FEATURES.map((f, i) => (
          <div key={f} style={{
            position: 'absolute', ...FEATURE_POS[i % FEATURE_POS.length],
            fontSize: 13, fontWeight: 500, color: C.sub2, whiteSpace: 'nowrap',
            opacity: 0, animation: `featPulse ${7 + (i % 4)}s ease-in-out ${i * 0.8}s infinite`,
          }}>{f}</div>
        ))}
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', position: 'relative', zIndex: 1 }}>
        <AnimatedWordmark size={72} />
        <div style={{ marginTop: 18, fontSize: 16, color: C.sub, fontWeight: 500, textAlign: 'center', maxWidth: 280, lineHeight: 1.45 }}>
          {tr('onb.tagline')}
        </div>
      </div>
      <div style={{ width: '100%', maxWidth: 420, padding: '0 24px 28px', position: 'relative', zIndex: 1 }}>
        <button onClick={() => setPhase('connect')} style={btnPrimary}>{tr('onb.signIn')}</button>
      </div>
    </div>
  )

  if (phase === 'connect') return (
    <div style={screen}><style>{keyframes}</style>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '0 24px', width: '100%', maxWidth: 420 }}>
        <div style={{ textAlign: 'center', marginBottom: 28, animation: 'upFade .4s ease' }}>
          <div style={{ fontWeight: 700, fontSize: 22, letterSpacing: -0.4, marginBottom: 10 }}>{tr('onb.scanQrTitle')}</div>
          <div style={{ color: C.sub, fontSize: 14, lineHeight: 1.5, maxWidth: 300, margin: '0 auto' }}>
            {tr('onb.scanQrHint')}
          </div>
        </div>
        <Scanner onResult={handleScan} t={tr} />
        <button onClick={() => setPhase('welcome')} style={{ ...btnGhost, marginTop: 28 }}>{tr('onb.back')}</button>
      </div>
    </div>
  )

  if (phase === 'pin') return (
    <div style={screen}><style>{keyframes}</style>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', width: '100%' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, marginBottom: 36 }}>
          {restaurant?.logo_url
            ? <img src={restaurant.logo_url} alt="" style={{ width: 64, height: 64, borderRadius: 16, objectFit: 'cover' }} />
            : <AnimatedWordmark size={40} />}
          <div style={{ fontWeight: 700, fontSize: 19 }}>{restaurant?.name}</div>
          <div style={{ fontSize: 13, color: C.sub }}>{tr('onb.enterPin')}</div>
        </div>
        <div style={{ display: 'flex', gap: 18, marginBottom: 36, animation: shaking ? 'shake .5s ease' : 'none' }}>
          {[0, 1, 2, 3].map(i => (
            <div key={i} style={{ width: 14, height: 14, borderRadius: '50%', background: pin.length > i ? (pinError ? '#ff453a' : C.blue) : 'rgba(255,255,255,0.2)', transition: 'background .15s, transform .15s', transform: pin.length > i ? 'scale(1.15)' : 'scale(1)' }} />
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 74px)', gap: 14 }}>
          {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'].map((k, i) => (
            <button key={i}
              onClick={() => k === '⌫' ? setPin(p => p.slice(0, -1)) : k ? handleDigit(k) : undefined}
              disabled={checking || k === ''}
              style={{ width: 74, height: 74, borderRadius: '50%', background: k === '' ? 'transparent' : C.surface, border: 'none', fontSize: k === '⌫' ? '1.3rem' : '1.5rem', fontWeight: 400, color: C.text, cursor: k === '' ? 'default' : 'pointer', fontFamily: 'inherit', opacity: checking ? 0.5 : 1, transition: 'transform .1s', WebkitTapHighlightColor: 'transparent' }}
              onPointerDown={e => { if (k) e.currentTarget.style.transform = 'scale(.9)' }}
              onPointerUp={e => { e.currentTarget.style.transform = 'scale(1)' }}
              onPointerLeave={e => { e.currentTarget.style.transform = 'scale(1)' }}
            >{k}</button>
          ))}
        </div>
        <button onClick={() => { localStorage.removeItem('mise_restaurant_id'); setPhase('connect') }} style={{ ...btnGhost, marginTop: 32 }}>{tr('auth.gate.changeVenue')}</button>
      </div>
    </div>
  )

  if (phase === 'perm') {
    const p = PERMS[permStep]
    if (!p) { finishPerms(); return <div style={screen}><style>{keyframes}</style></div> }
    return (
      <div style={screen}><style>{keyframes}</style>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '0 28px', width: '100%', maxWidth: 420 }}>
          <div key={p.key} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', animation: 'upFade .35s ease' }}>
            <div style={{ width: 88, height: 88, borderRadius: 24, background: C.surface, border: `1px solid ${C.surfaceBorder}`, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 24 }}>{p.icon}</div>
            <div style={{ fontWeight: 700, fontSize: 22, letterSpacing: -0.4, marginBottom: 10 }}>{p.title}</div>
            <div style={{ color: C.sub, fontSize: 14.5, lineHeight: 1.5, maxWidth: 300, marginBottom: 8 }}>{p.desc}</div>
          </div>
          <div style={{ display: 'flex', gap: 6, margin: '24px 0 8px' }}>
            {PERMS.map((_, i) => <div key={i} style={{ width: 7, height: 7, borderRadius: '50%', background: i === permStep ? C.text : 'rgba(255,255,255,0.22)' }} />)}
          </div>
        </div>
        <div style={{ width: '100%', maxWidth: 420, padding: '0 24px 28px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <button onClick={p.onAllow} style={btnPrimary}>{p.cta}</button>
          <button onClick={skipPerm} style={btnGhost}>{tr('onb.notNow')}</button>
        </div>
      </div>
    )
  }

  return null
}

const btnPrimary: React.CSSProperties = {
  width: '100%', padding: '17px', borderRadius: 16, background: '#fff', color: '#000',
  border: 'none', fontFamily: FONT, fontSize: 17, fontWeight: 600, cursor: 'pointer',
  WebkitTapHighlightColor: 'transparent',
}
const btnGhost: React.CSSProperties = {
  width: '100%', padding: '15px', borderRadius: 16, background: 'transparent', color: 'rgba(235,235,245,0.6)',
  border: 'none', fontFamily: FONT, fontSize: 15, fontWeight: 500, cursor: 'pointer',
  WebkitTapHighlightColor: 'transparent',
}
