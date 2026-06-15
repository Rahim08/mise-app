'use client'
import { useState, useEffect } from 'react'

// Запущены ли мы внутри нативной iOS-оболочки (Capacitor)?
export function isNativeApp(): boolean {
  if (typeof window === 'undefined') return false
  // 1) штатный признак Capacitor (может быть не готов мгновенно при загрузке внешнего URL);
  // 2) надёжная метка в User-Agent (capacitor.config → appendUserAgent), доступна с первого байта.
  if ((window as any).Capacitor?.isNativePlatform?.()) return true
  if (typeof navigator !== 'undefined' && /MiseApp/i.test(navigator.userAgent)) return true
  return false
}

// Хук с защитой от hydration mismatch: на сервере и первом рендере → false,
// после монтирования обновляется до реального значения.
export function useIsNative(): boolean {
  const [n, setN] = useState(false)
  useEffect(() => { setN(isNativeApp()) }, [])
  return n
}
