'use client'
// Глобальный перехват клиентских ошибок → /api/log → app_errors.
// Дедуп по тексту и лимит 5 отправок за сессию, чтобы не зафлудить таблицу.
import { useEffect } from 'react'

const seen = new Set<string>()
let sent = 0

function report(message: string, stack?: string) {
  if (sent >= 5 || seen.has(message)) return
  seen.add(message); sent++
  try {
    fetch('/api/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, stack, url: window.location.href, source: 'client' }),
      keepalive: true,
    }).catch(() => {})
  } catch {}
}

export function ErrorReporter() {
  useEffect(() => {
    const onError = (e: ErrorEvent) => report(e.message || 'Unknown error', e.error?.stack)
    const onRejection = (e: PromiseRejectionEvent) => {
      const r: any = e.reason
      report(r?.message || String(r) || 'Unhandled rejection', r?.stack)
    }
    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)
    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onRejection)
    }
  }, [])
  return null
}
