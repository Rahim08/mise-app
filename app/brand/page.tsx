'use client'
export const dynamic = 'force-dynamic'
import React from 'react'
import { AppIcon, Wordmark, BRAND_COLORS, type BrandApp } from '@/components/brand'

// Внутренняя страница-превью фирменного стиля. Не линкуется из приложений.

const APPS: { id: BrandApp; name: string; role: string }[] = [
  { id: 'manager',   name: 'Manager',   role: 'Смены · Касса' },
  { id: 'analytics', name: 'Analytics', role: 'Финансы · AI' },
  { id: 'stash',     name: 'Stash',     role: 'Склад табака' },
  { id: 'people',    name: 'People',    role: 'Команда' },
  { id: 'menu',      name: 'Menu',      role: 'QR-меню' },
]

function Panel({ dark, children }: { dark?: boolean; children: React.ReactNode }) {
  return (
    <div style={{
      flex: 1, minWidth: 300, borderRadius: 20, padding: '28px 26px',
      background: dark ? '#000' : '#fff',
      border: `1px solid ${dark ? 'rgba(255,255,255,.1)' : 'rgba(0,0,0,.08)'}`,
    }}>{children}</div>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 12, fontWeight: 600, color: '#86868b', textTransform: 'uppercase', letterSpacing: 1, margin: '36px 0 14px' }}>{children}</div>
}

export default function BrandPage() {
  return (
    <div style={{ minHeight: '100vh', background: '#f5f5f7', fontFamily: "-apple-system,BlinkMacSystemFont,'SF Pro Text',sans-serif", WebkitFontSmoothing: 'antialiased', color: '#1d1d1f' }}>
      <div style={{ maxWidth: 980, margin: '0 auto', padding: '52px 24px 96px' }}>

        <Wordmark size={34} />
        <div style={{ fontSize: 15, color: '#6e6e73', marginTop: 6 }}>Фирменный стиль · знак, иконки приложений, цвета</div>

        {/* ── БРЕНД-ЗНАК ── */}
        <Label>Бренд-знак — нейтральный графит</Label>
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
          <Panel>
            <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
              <AppIcon app="mise" size={84} />
              <div>
                <Wordmark size={30} />
                <div style={{ fontSize: 13, color: '#6e6e73', marginTop: 4 }}>mise en place — всё на своих местах</div>
              </div>
            </div>
          </Panel>
          <Panel dark>
            <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
              <AppIcon app="mise" size={84} />
              <div>
                <Wordmark size={30} dark />
                <div style={{ fontSize: 13, color: 'rgba(245,245,247,.55)', marginTop: 4 }}>тот же знак на тёмном</div>
              </div>
            </div>
          </Panel>
        </div>

        {/* ── ИКОНКИ ПРИЛОЖЕНИЙ ── */}
        <Label>Приложения — каждый в своём цвете</Label>
        <Panel>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 26 }}>
            {APPS.map(a => (
              <div key={a.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 10 }}>
                <AppIcon app={a.id} size={88} />
                <div>
                  <Wordmark app={a.name} size={16} />
                  <div style={{ fontSize: 12, color: '#86868b', marginTop: 2 }}>{a.role}</div>
                  <div style={{ fontSize: 11, color: '#aaa', marginTop: 4, fontFamily: 'ui-monospace,monospace' }}>{BRAND_COLORS[a.id].base}</div>
                </div>
              </div>
            ))}
          </div>
        </Panel>

        {/* ── ЛОКАПЫ ── */}
        <Label>Локапы — иконка + имя</Label>
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
          <Panel>
            {APPS.map(a => (
              <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 0' }}>
                <AppIcon app={a.id} size={34} />
                <Wordmark app={a.name} size={18} />
              </div>
            ))}
          </Panel>
          <Panel dark>
            {APPS.map(a => (
              <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 0' }}>
                <AppIcon app={a.id} size={34} />
                <Wordmark app={a.name} size={18} dark />
              </div>
            ))}
          </Panel>
        </div>

        {/* ── МАСШТАБ ── */}
        <Label>Масштаб — глиф читается от 24 px</Label>
        <Panel>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 22, flexWrap: 'wrap' }}>
            {[120, 88, 64, 44, 32, 24].map(s => <AppIcon key={s} app="stash" size={s} />)}
          </div>
        </Panel>

        {/* ── ПРИНЦИПЫ ── */}
        <Label>Принципы</Label>
        <Panel>
          <ul style={{ margin: 0, padding: '0 0 0 18px', fontSize: 14, lineHeight: 2, color: '#424245' }}>
            <li>Один глиф на иконку, белый, штрих 7/100 — без деталей, которые умирают в 24 px.</li>
            <li>Суперэллипс и вертикальный градиент (светлее сверху) — у всех одинаковые.</li>
            <li>«mise» в словесном знаке всегда жирный и нейтральный; имя приложения — обычным весом.</li>
            <li>Цвет принадлежит приложению: Manager синий, Analytics зелёный, Stash оранжевый, People индиго, Menu розовый. Бренд — графит.</li>
          </ul>
        </Panel>

      </div>
    </div>
  )
}
