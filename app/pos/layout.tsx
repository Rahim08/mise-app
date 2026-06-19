'use client'
import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import Link from 'next/link'

const NAV = [
  { href: '/pos', label: 'Обзор',    icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6' },
  { href: '/pos/floors', label: 'Залы',    icon: 'M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z' },
  { href: '/pos/menu',   label: 'Меню',    icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2' },
  { href: '/pos/orders', label: 'Заказы',  icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z' },
  { href: '/pos/reports',label: 'Отчёты', icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z' },
  { href: '/pos/devices',label: 'Устройства', icon: 'M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z' },
]

export default function PosLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [restaurantName, setRestaurantName] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) { router.replace('/auth/login'); return }
      const { data } = await supabase.from('restaurants').select('name').eq('owner_id', user.id).single()
      setRestaurantName(data?.name ?? '')
      setLoading(false)
    })
  }, [router])

  if (loading) return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100vh', background:'#000' }}>
      <div style={{ color:'#555', fontFamily:'monospace' }}>mise pos...</div>
    </div>
  )

  return (
    <div style={{ display:'flex', height:'100vh', background:'#0a0a0a', fontFamily:'-apple-system,BlinkMacSystemFont,sans-serif' }}>
      {/* Sidebar */}
      <aside style={{ width:220, background:'#111', borderRight:'1px solid #1a1a1a', display:'flex', flexDirection:'column', flexShrink:0 }}>
        {/* Logo */}
        <div style={{ padding:'24px 20px 20px', borderBottom:'1px solid #1a1a1a' }}>
          <div style={{ fontSize:20, fontWeight:900, color:'#fff', letterSpacing:'-0.5px' }}>
            mise <span style={{ color:'#555' }}>pos</span>
          </div>
          <div style={{ fontSize:11, color:'#444', marginTop:4, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
            {restaurantName}
          </div>
        </div>

        {/* Nav */}
        <nav style={{ flex:1, padding:'12px 0' }}>
          {NAV.map(item => {
            const active = pathname === item.href || (item.href !== '/pos' && pathname.startsWith(item.href))
            return (
              <Link key={item.href} href={item.href} style={{
                display:'flex', alignItems:'center', gap:10,
                padding:'10px 20px', textDecoration:'none',
                color: active ? '#fff' : '#555',
                background: active ? '#1a1a1a' : 'transparent',
                borderLeft: active ? '2px solid #fff' : '2px solid transparent',
                fontSize:14, fontWeight: active ? 600 : 400,
                transition:'all .15s',
              }}>
                <svg width={18} height={18} fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d={item.icon} />
                </svg>
                {item.label}
              </Link>
            )
          })}
        </nav>

        {/* Back to dashboard */}
        <div style={{ padding:'16px 20px', borderTop:'1px solid #1a1a1a' }}>
          <Link href="/dashboard" style={{ display:'flex', alignItems:'center', gap:8, textDecoration:'none', color:'#444', fontSize:13 }}>
            <svg width={16} height={16} fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            Назад в дашборд
          </Link>
        </div>
      </aside>

      {/* Main */}
      <main style={{ flex:1, overflow:'auto' }}>
        {children}
      </main>
    </div>
  )
}
