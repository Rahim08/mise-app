'use client'

import { useEffect, useSyncExternalStore } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { db } from '@/lib/db'
import { isNativeApp } from '@/lib/native'
import { NativeOnboarding } from '@/components/NativeOnboarding'

declare global {
  interface Window { __MISE_ACCOUNT?: string }
}

export function HomeBehavior() {
  const router = useRouter()
  const native = useSyncExternalStore(() => () => {}, isNativeApp, () => false)

  useEffect(() => {
    if (native) return
    let cancelled = false
    supabase.auth.getSession().then(async ({ data }) => {
      if (cancelled) return
      if (data.session?.user) {
        try {
          const { data: rest } = await db.from('restaurants').select('name').limit(1)
          if (cancelled) return
          const name = Array.isArray(rest) ? rest[0]?.name : (rest as { name?: string } | null)?.name
          if (name) {
            window.__MISE_ACCOUNT = name
            const cta = document.querySelector<HTMLAnchorElement>('.landing-root .nav-cta')
            if (cta) { cta.textContent = name; cta.href = '/dashboard' }
          }
        } catch {}
        return
      }
      try {
        const rid = localStorage.getItem('mise_restaurant_id')
        const hasStaff = rid && localStorage.getItem('mise_staff_' + rid)
        const match = document.cookie.match(/(?:^|; )mise_token_until=(\d+)/)
        const tokenValid = match ? parseInt(match[1], 10) > Math.floor(Date.now() / 1000) : false
        if (rid && hasStaff && tokenValid) router.replace('/join?restaurant=' + rid)
      } catch {}
    })
    return () => { cancelled = true }
  }, [native, router])

  return native ? <NativeOnboarding /> : null
}
