'use client'
import { useState, useEffect } from 'react'

// Запущены ли мы внутри нативной iOS-оболочки (Capacitor)?
export function isNativeApp(): boolean {
  if (typeof window === 'undefined') return false
  return !!(window as any).Capacitor?.isNativePlatform?.()
}

// Хук с защитой от hydration mismatch: на сервере и первом рендере → false,
// после монтирования обновляется до реального значения.
export function useIsNative(): boolean {
  const [n, setN] = useState(false)
  useEffect(() => { setN(isNativeApp()) }, [])
  return n
}
