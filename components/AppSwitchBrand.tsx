'use client'
import { useRouter } from 'next/navigation'
import { Wordmark } from '@/components/brand'

// Бренд-знак в шапке приложения, который ПЕРЕКЛЮЧАЕТ приложение: тап → хаб (/join).
// «e» горит цветом приложения (вариант 3). Рядом — имя приложения и намёк-шеврон.
// Для пользователя с одним приложением тап просто вернёт его же — безвредно.
export function AppSwitchBrand({ name, accent, color, muted, size = 19 }: {
  name: string
  accent: string            // цвет приложения → цвет «e» и имени
  color?: string            // цвет «mis» (текст темы: чёрный/белый)
  muted?: string            // приглушённый цвет для шеврона
  size?: number
}) {
  const router = useRouter()
  const go = () => {
    const rid = typeof window !== 'undefined' ? localStorage.getItem('mise_restaurant_id') : null
    router.push(rid ? `/join?restaurant=${rid}` : '/join')
  }
  return (
    <button onClick={go} title="Сменить приложение" style={{
      display: 'inline-flex', alignItems: 'center', gap: 7,
      background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit', padding: 0,
    }}>
      <Wordmark size={size} color={color} accent={accent} />
      <span style={{ fontSize: size * 0.92, fontWeight: 600, color: accent, letterSpacing: '-.02em', whiteSpace: 'nowrap' }}>{name}</span>
      <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke={muted || accent} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.7, marginLeft: 1 }}>
        <path d="M2.5 4L5 6.5L7.5 4" />
      </svg>
    </button>
  )
}
