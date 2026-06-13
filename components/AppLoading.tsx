'use client'
import { AppIcon, type BrandApp } from '@/components/brand'

// Единая загрузочная заставка для всех приложений. Используется и в AuthGate, и в
// самих экранах — поэтому переход «вход → загрузка → контент» бесшовный (один и тот
// же бренд-значок, без прыжка «новый лого → старый» / «значок → надпись»).
export function AppLoading({ app, bg, fill, accent }: {
  app: BrandApp
  bg: string
  fill: string
  accent: string
}) {
  // Вместо крутящегося кружка — «дышащий» бренд-значок: мягкий пульс масштаба и
  // свечения (по-эппловски). fill больше не нужен, но оставлен в сигнатуре для совместимости.
  void fill
  return (
    <div style={{ minHeight: '100vh', background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ animation: 'brandBreathe 1.7s cubic-bezier(.4,0,.6,1) infinite', willChange: 'transform, filter' }}>
        <AppIcon app={app} size={68} />
      </div>
      <style>{`@keyframes brandBreathe{0%,100%{transform:scale(1);filter:drop-shadow(0 0 5px ${accent}33)}50%{transform:scale(1.08);filter:drop-shadow(0 0 18px ${accent}88)}}`}</style>
    </div>
  )
}
