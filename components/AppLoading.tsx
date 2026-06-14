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
  // Вместо крутящегося кружка — сам бренд-значок плавно парит (вверх-вниз + лёгкий
  // наклон), как живой объект. Без пульса масштаба. fill оставлен для совместимости.
  void fill
  return (
    <div style={{ minHeight: '100vh', background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center', perspective: 600 }}>
      <div style={{ animation: 'brandFloat 2.4s cubic-bezier(.45,0,.55,1) infinite', willChange: 'transform' }}>
        <AppIcon app={app} size={70} />
      </div>
      <style>{`@keyframes brandFloat{0%{transform:translateY(6px) rotate(-2.5deg)}50%{transform:translateY(-8px) rotate(2.5deg)}100%{transform:translateY(6px) rotate(-2.5deg)}}`}</style>
    </div>
  )
}
