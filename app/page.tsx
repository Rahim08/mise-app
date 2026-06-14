'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { db } from '@/lib/db'

export default function Home() {
  const router = useRouter()
  const [src, setSrc] = useState('/landing.html')
  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      if (data.session?.user) {
        // НЕ редиректим владельца на дашборд — показываем лендинг. В навбаре вместо
        // «Войти» подставим имя ресторана (тап → дашборд). Имя передаём в iframe параметром.
        try {
          const { data: rest } = await db.from('restaurants').select('name').limit(1)
          const name = Array.isArray(rest) ? rest[0]?.name : (rest as any)?.name
          if (name) setSrc('/landing.html?account=' + encodeURIComponent(name))
        } catch {}
        return
      }
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
    <iframe src={src} style={{ width: '100%', height: '100vh', border: 'none', display: 'block' }} />
  )
}
