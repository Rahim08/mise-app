'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'

type Stats = { tables: number; orders_today: number; revenue_today: number; open_tables: number }
type Setup = { floors: boolean; menu: boolean; devices: boolean; session: boolean }

const STEPS = [
  { id: 'floors' as const,  label: 'Настроить залы и столы',  href: '/pos/floors',  icon: 'M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5z' },
  { id: 'menu' as const,    label: 'Создать меню',             href: '/pos/menu',    icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2' },
  { id: 'devices' as const, label: 'Подключить устройства',   href: '/pos/devices', icon: 'M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z' },
  { id: 'session' as const, label: 'Открыть первую смену',    href: '/pos/reports', icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2' },
]

export default function PosOverview() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [setup, setSetup] = useState<Setup>({ floors: false, menu: false, devices: false, session: false })

  useEffect(() => {
    fetch('/api/pos/stats').then(r => r.ok ? r.json() : null).then(d => {
      if (!d) return
      setStats(d)
      setSetup({
        floors: d.tables > 0,
        menu: d.menu_items > 0,
        devices: d.devices > 0,
        session: d.sessions > 0,
      })
    })
  }, [])

  const doneCount = Object.values(setup).filter(Boolean).length

  return (
    <div style={{ padding: 32, maxWidth: 900 }}>
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ color: '#fff', fontSize: 28, fontWeight: 800, margin: 0 }}>Mise POS</h1>
        <p style={{ color: '#555', marginTop: 6, fontSize: 15 }}>Панель управления кассовой системой</p>
      </div>

      {/* Stats */}
      {stats && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 16, marginBottom: 32 }}>
          {[
            { label: 'Столов', value: stats.tables },
            { label: 'Открыто сейчас', value: stats.open_tables },
            { label: 'Заказов сегодня', value: stats.orders_today },
            { label: 'Выручка сегодня', value: `€${stats.revenue_today.toFixed(2)}` },
          ].map(s => (
            <div key={s.label} style={{ background: '#111', border: '1px solid #1a1a1a', borderRadius: 12, padding: '20px 24px' }}>
              <div style={{ color: '#fff', fontSize: 26, fontWeight: 800 }}>{s.value}</div>
              <div style={{ color: '#555', fontSize: 13, marginTop: 4 }}>{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Setup checklist */}
      {doneCount < 4 && (
        <div style={{ background: '#111', border: '1px solid #1a1a1a', borderRadius: 16, padding: 24, marginBottom: 32 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
            <h2 style={{ color: '#fff', fontSize: 16, fontWeight: 700, margin: 0 }}>Настройка системы</h2>
            <span style={{ color: '#444', fontSize: 13 }}>{doneCount}/4</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {STEPS.map((step, i) => {
              const done = setup[step.id]
              return (
                <Link key={step.id} href={step.href} style={{
                  display: 'flex', alignItems: 'center', gap: 16,
                  padding: '13px 16px', background: '#161616', borderRadius: 12,
                  textDecoration: 'none', border: `1px solid ${done ? '#1a2a1a' : '#222'}`,
                }}>
                  <div style={{
                    width: 32, height: 32, borderRadius: 8,
                    background: done ? '#1a3a1a' : '#1e1e1e',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 13, fontWeight: 700, color: done ? '#4ade80' : '#555',
                  }}>
                    {done ? '✓' : i + 1}
                  </div>
                  <div style={{ flex: 1 }}>
                    <span style={{ color: done ? '#4ade80' : '#fff', fontSize: 14, fontWeight: 500, textDecoration: done ? 'line-through' : 'none', textDecorationColor: '#2a5a2a' }}>
                      {step.label}
                    </span>
                  </div>
                  <svg style={{ color: '#333' }} width={18} height={18} fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </Link>
              )
            })}
          </div>
        </div>
      )}

      {/* Quick links */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 14 }}>
        {[
          { label: 'Карта залов',    sub: 'Столы и расположение',        href: '/pos/floors',  icon: 'M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z' },
          { label: 'Меню',           sub: 'Блюда, цены, модификаторы',   href: '/pos/menu',    icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2' },
          { label: 'Устройства',     sub: 'Терминалы, PIN-доступ',       href: '/pos/devices', icon: 'M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z' },
          { label: 'Заказы',         sub: 'Мониторинг в реальном времени', href: '/pos/orders', icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z' },
          { label: 'Отчёты',         sub: 'Z-отчёты, выручка смен',      href: '/pos/reports', icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z' },
          { label: 'На дашборд',     sub: 'Вернуться в Mise',            href: '/dashboard',   icon: 'M10 19l-7-7m0 0l7-7m-7 7h18' },
        ].map(card => (
          <Link key={card.href} href={card.href} style={{
            display: 'flex', alignItems: 'center', gap: 14, padding: 18,
            background: '#111', border: '1px solid #1a1a1a', borderRadius: 14, textDecoration: 'none',
          }}>
            <div style={{ width: 40, height: 40, borderRadius: 9, background: '#1a1a1a', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <svg width={18} height={18} fill="none" stroke="#fff" strokeWidth={1.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d={card.icon} />
              </svg>
            </div>
            <div>
              <div style={{ color: '#fff', fontWeight: 600, fontSize: 14 }}>{card.label}</div>
              <div style={{ color: '#444', fontSize: 12, marginTop: 2 }}>{card.sub}</div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
