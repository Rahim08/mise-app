'use client'
export const dynamic = 'force-dynamic'
import React from 'react'
import { AppIcon, Wordmark, APP_META, type BrandApp } from '@/components/brand'

// Внутренняя страница-превью фирменного стиля v2. Не линкуется из приложений.
// Источник решений: docs/mise-brand-v2.html (glow-иконки + W2 wordmark, серая «e»).

const APPS: { id: BrandApp; role: string }[] = [
  { id: 'manager',   role: 'Смены · Касса' },
  { id: 'analytics', role: 'Финансы · AI' },
  { id: 'stash',     role: 'Склад табака' },
  { id: 'people',    role: 'Команда' },
  { id: 'menu',      role: 'QR-меню' },
  { id: 'mise',      role: 'Дашборд владельца' },
]

function Label({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,.35)', letterSpacing: 2.5, textTransform: 'uppercase', textAlign: 'center', margin: '72px 0 28px' }}>{children}</div>
}

export default function BrandPage() {
  return (
    <div style={{
      minHeight: '100vh', background: '#070707', padding: '64px 24px 120px',
      fontFamily: "-apple-system,BlinkMacSystemFont,'SF Pro Display',sans-serif",
      WebkitFontSmoothing: 'antialiased', display: 'flex', flexDirection: 'column', alignItems: 'center',
    }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,.35)', letterSpacing: 3, textTransform: 'uppercase', marginBottom: 14 }}>Mise · Brand v2</div>
      <Wordmark size={56} color="#fff" />

      <Label>Иконки приложений · Glow</Label>
      <div style={{ display: 'flex', gap: 40, flexWrap: 'wrap', justifyContent: 'center' }}>
        {APPS.map(a => (
          <div key={a.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
            <AppIcon app={a.id} size={108} />
            <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,.85)' }}>{APP_META[a.id].name}</div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,.35)', marginTop: -8 }}>{a.role}</div>
          </div>
        ))}
      </div>

      <Label>Малые размеры</Label>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 18, flexWrap: 'wrap', justifyContent: 'center' }}>
        {[64, 44, 30].map(s => APPS.slice(0, 5).map(a => <AppIcon key={a.id + s} app={a.id} size={s} />))}
      </div>

      <Label>Wordmark на тёмном и светлом</Label>
      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', justifyContent: 'center' }}>
        <div style={{ background: '#0d0d0d', border: '1px solid rgba(255,255,255,.07)', borderRadius: 22, padding: '44px 56px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 22 }}>
          <Wordmark size={56} color="#fff" /><Wordmark size={28} color="#fff" /><Wordmark size={16} color="#fff" />
        </div>
        <div style={{ background: '#f2f2f7', borderRadius: 22, padding: '44px 56px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 22 }}>
          <Wordmark size={56} color="#1c1c1e" /><Wordmark size={28} color="#1c1c1e" /><Wordmark size={16} color="#1c1c1e" />
        </div>
      </div>
    </div>
  )
}
