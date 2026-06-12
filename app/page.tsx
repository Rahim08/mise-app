'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

export default function Home() {
  const router = useRouter()
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session?.user) {
        router.replace('/dashboard')
      }
    })
  }, [])

  return (
    <iframe src="/landing.html" style={{ width: '100%', height: '100vh', border: 'none', display: 'block' }} />
  )
}
