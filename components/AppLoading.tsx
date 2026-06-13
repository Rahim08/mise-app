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
  return (
    <div style={{ minHeight: '100vh', background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
      <AppIcon app={app} size={64} />
      <div style={{ width: 24, height: 24, border: `2.5px solid ${fill}`, borderTopColor: accent, borderRadius: '50%', animation: 'spin .7s linear infinite', marginTop: 20 }} />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )
}
