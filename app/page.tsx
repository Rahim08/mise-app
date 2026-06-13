'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

export default function Home() {
  const router = useRouter()
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session?.user) { router.replace('/dashboard'); return }
      // Возвращающийся сотрудник с живым токеном → сразу на свой хаб приложений (/join),
      // а не на маркетинговый лендинг. /join сам откроет единственное приложение или покажет сетку.
      try {
        const rid = localStorage.getItem('mise_restaurant_id')
        const hasStaff = rid && localStorage.getItem('mise_staff_' + rid)
        const m = document.cookie.match(/(?:^|; )mise_token_until=(\d+)/)
        const tokenValid = m ? parseInt(m[1], 10) > Math.floor(Date.now() / 1000) : false
        if (rid && hasStaff && tokenValid) router.replace('/join?restaurant=' + rid)
      } catch {}
    })
  }, [])

  return (
    <iframe src="/landing.html" style={{ width: '100%', height: '100vh', border: 'none', display: 'block' }} />
  )
}
