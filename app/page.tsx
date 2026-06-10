'use client'
import { useEffect } from 'react'
import { supabase } from '@/lib/supabase'

export default function Home() {
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session?.user) {
        window.location.href = '/dashboard'
      }
    })
  }, [])

  return (
    <iframe src="/landing.html" style={{ width: '100%', height: '100vh', border: 'none', display: 'block' }} />
  )
}
