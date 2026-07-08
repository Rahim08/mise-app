'use client'
// Виден только когда суперадмин открыл дашборд клиента через /admin ("mise_admin_view_label"
// cookie — readable companion к httpOnly mise_admin_view, см. app/api/admin/route.ts).
// Без этого баннера легко забыть, что действия применяются к чужому ресторану.
import { useEffect, useState } from 'react'

function readCookie(name: string): string | null {
  const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'))
  return m ? decodeURIComponent(m[1]) : null
}

export function ImpersonationBanner() {
  const [label, setLabel] = useState<string | null>(null)

  useEffect(() => { setLabel(readCookie('mise_admin_view_label')) }, [])

  if (!label) return null

  const exit = async () => {
    await fetch('/api/admin', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'stopImpersonating' }),
    })
    window.location.href = '/admin'
  }

  return (
    <div
      role="status"
      style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 10000,
        background: '#5856d6', color: '#fff',
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
        padding: 'calc(env(safe-area-inset-top, 0px) + 7px) 12px 7px',
        fontSize: '.8rem', fontWeight: 600,
        fontFamily: '-apple-system,BlinkMacSystemFont,system-ui,sans-serif',
        boxShadow: '0 2px 12px rgba(0,0,0,.18)',
      }}
    >
      <span>Режим просмотра: {label}</span>
      <button
        onClick={exit}
        style={{
          background: 'rgba(255,255,255,.2)', color: '#fff', border: 'none',
          borderRadius: 980, padding: '3px 12px', fontSize: '.76rem', fontWeight: 700, cursor: 'pointer',
        }}
      >
        Выйти
      </button>
    </div>
  )
}
