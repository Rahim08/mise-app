'use client'
// Честный индикатор отсутствия сети. Не притворяемся, что сохранили — предупреждаем,
// чтобы не было сюрприза «всё пропало». Короткие просадки гасит ретрай в lib/db;
// этот баннер — для реального продолжительного офлайна.
import { useEffect, useState } from 'react'
import { useI18n } from '@/lib/i18n'

export function OfflineBanner() {
  const { t: tr } = useI18n()
  const [offline, setOffline] = useState(false)

  useEffect(() => {
    const update = () => setOffline(typeof navigator !== 'undefined' && navigator.onLine === false)
    update()
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update) }
  }, [])

  if (!offline) return null

  return (
    <div
      role="status"
      style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 10000,
        background: '#ff9500', color: '#fff',
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        padding: 'calc(env(safe-area-inset-top, 0px) + 7px) 12px 7px',
        fontSize: '.8rem', fontWeight: 600,
        fontFamily: '-apple-system,BlinkMacSystemFont,system-ui,sans-serif',
        boxShadow: '0 2px 12px rgba(0,0,0,.18)',
        animation: 'miseOfflineDown .3s ease',
      }}
    >
      <style>{`@keyframes miseOfflineDown{from{transform:translateY(-100%)}to{transform:translateY(0)}}`}</style>
      <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" viewBox="0 0 24 24"><path d="M1 1l22 22M16.7 16.7A11 11 0 0 0 12 16M5 12.5a11 11 0 0 1 4-2.3M2 8.8a16 16 0 0 1 4.5-2.6M9 5.2A16 16 0 0 1 22 8.8M12 20h.01" /></svg>
      {tr('offline')}
    </div>
  )
}
