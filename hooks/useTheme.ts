'use client'
import { useState, useEffect } from 'react'

// Тема: три режима — 'system' (как в iPhone/браузере, живо реагирует), 'light', 'dark'.
// В IPA по умолчанию 'system'; пользователь может переопределить и вернуться к системной.
// Обратная совместимость: старые сохранённые значения '1'/'0' читаются как dark/light.
export type ThemeMode = 'system' | 'light' | 'dark'

const DARK = {
  bg: '#000000', bg2: '#1c1c1e', bg3: '#2c2c2e',
  surface: '#1c1c1e', surface2: '#2c2c2e',
  text: '#ffffff',
  text2: 'rgba(235,235,245,0.75)',
  text3: 'rgba(235,235,245,0.45)',
  text4: 'rgba(235,235,245,0.20)',
  sep: 'rgba(84,84,88,0.65)', sep2: 'rgba(84,84,88,0.36)',
  fill: 'rgba(120,120,128,0.36)', fill2: 'rgba(120,120,128,0.20)',
  blue: '#0a84ff', green: '#32d74b', orange: '#ff9f0a', red: '#ff453a', purple: '#bf5af2',
  hbg: 'rgba(28,28,30,0.92)', nbg: 'rgba(28,28,30,0.95)',
  sh: '0 2px 12px rgba(0,0,0,0.6)', sh2: '0 1px 3px rgba(0,0,0,0.4)',
}
const LIGHT = {
  bg: '#f2f2f7', bg2: '#ffffff', bg3: '#f2f2f7',
  surface: '#ffffff', surface2: '#f2f2f7',
  text: '#000000',
  text2: 'rgba(60,60,67,0.75)',
  text3: 'rgba(60,60,67,0.45)',
  text4: 'rgba(60,60,67,0.20)',
  sep: 'rgba(60,60,67,0.29)', sep2: 'rgba(60,60,67,0.12)',
  fill: 'rgba(120,120,128,0.16)', fill2: 'rgba(120,120,128,0.08)',
  blue: '#007aff', green: '#34c759', orange: '#ff9500', red: '#ff3b30', purple: '#af52de',
  hbg: 'rgba(242,242,247,0.92)', nbg: 'rgba(249,249,249,0.95)',
  sh: '0 1px 3px rgba(0,0,0,0.08),0 4px 16px rgba(0,0,0,0.05)', sh2: '0 1px 2px rgba(0,0,0,0.06)',
}

export function useTheme(storageKey?: string) {
  const [mode, setModeState] = useState<ThemeMode>('system')
  const [sysDark, setSysDark] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    setSysDark(mq.matches)
    const h = (e: MediaQueryListEvent) => setSysDark(e.matches)
    mq.addEventListener('change', h)
    if (storageKey) {
      const saved = localStorage.getItem(storageKey)
      if (saved === 'dark' || saved === '1') setModeState('dark')
      else if (saved === 'light' || saved === '0') setModeState('light')
      else setModeState('system')
    }
    return () => mq.removeEventListener('change', h)
  }, [])

  const setMode = (m: ThemeMode) => {
    setModeState(m)
    if (!storageKey) return
    if (m === 'system') localStorage.removeItem(storageKey)
    else localStorage.setItem(storageKey, m)
  }

  const dark = mode === 'dark' || (mode === 'system' && sysDark)
  // Бинарный toggle для существующих кнопок солнце/луна — пинит светлую/тёмную.
  const toggle = () => setMode(dark ? 'light' : 'dark')

  const palette = dark && mounted ? DARK : LIGHT
  return { dark: dark && mounted, mounted, mode, setMode, toggle, ...palette }
}
