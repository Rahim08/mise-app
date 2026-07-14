'use client'
// Дашборд v2: общий контекст shell-а — auth, ресторан, тема.
// Логика перенесена из старого app/dashboard/page.tsx (Dashboard main).
import { createContext, useContext, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { db } from '@/lib/db'
import { useTheme } from '@/hooks/useTheme'

export type Restaurant = {
  id: string; name: string; currency: string
  subscription_status: string; subscription_plan: string
  subscription_ends_at: string; stripe_customer_id?: string
  subscription_id?: string | null
  logo_url?: string; owner_pin?: string
  staff_limit?: number | null
  comp_apps?: string[] | null
  addon_modules?: string[] | null
  extra_seats?: number | null
  addon_ai?: boolean | null
  billing_interval?: string | null
  trial_ends_at?: string | null
}

type ThemeCtl = { dark: boolean; toggle: () => void; mode: 'system' | 'light' | 'dark'; setMode: (m: 'system' | 'light' | 'dark') => void }

type DashCtx = {
  user: any
  restaurant: Restaurant | null
  authChecked: boolean
  isAdminView: boolean
  reload: () => Promise<Restaurant | null>
  theme: ThemeCtl
}

const Ctx = createContext<DashCtx | null>(null)

export function useDash(): DashCtx {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useDash outside DashboardProvider')
  return ctx
}

export function DashboardProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  // Тёмная тема: цвета дашборда — CSS-переменные (globals.css), класс mise-dark на <html>
  const theme = useTheme('mise_dash_dark')
  useEffect(() => {
    document.documentElement.classList.toggle('mise-dark', !!theme.dark)
    return () => { document.documentElement.classList.remove('mise-dark') }
  }, [theme.dark])

  const [user, setUser] = useState<any>(null)
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null)
  const [authChecked, setAuthChecked] = useState(false)
  const [isAdminView, setIsAdminView] = useState(false)

  // Admin-view (супер-админ «смотрит как клиент») живёт без owner-сессии:
  // сервер уже ограничил scope рестораном, фильтр по owner_id дал бы пусто.
  const reload = async (): Promise<Restaurant | null> => {
    const q = db.from('restaurants').select('*')
    const { data } = isAdminView || !user?.id || user.id === 'admin-view'
      ? await q.single()
      : await q.eq('owner_id', user.id).single()
    setRestaurant(data)
    return data
  }

  useEffect(() => {
    // Super-admin "view as client" (set from /admin) — bypasses owner Supabase session
    fetch('/api/auth/admin-view').then(async res => {
      if (!res.ok) return false
      const { restaurantId } = await res.json()
      if (!restaurantId) return false
      const { data: rest } = await db.from('restaurants').select('*').single()
      setRestaurant(rest)
      setUser({ id: 'admin-view' })
      setIsAdminView(true)
      setAuthChecked(true)
      return true
    }).then(handled => {
      if (handled) return
      supabase.auth.getSession().then(async ({ data }) => {
        if (!data.session?.user) {
          setAuthChecked(true)
          router.replace('/auth/login')
          return
        }
        setUser(data.session.user)
        const { data: rest } = await db.from('restaurants').select('*').eq('owner_id', data.session.user.id).single()
        setRestaurant(rest)
        setAuthChecked(true)
      })
    })
  }, [])

  return (
    <Ctx.Provider value={{ user, restaurant, authChecked, isAdminView, reload, theme }}>
      {children}
    </Ctx.Provider>
  )
}
