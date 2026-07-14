'use client'
// Модуль Analytics внутри дашборд-shell: owner уже авторизован (Supabase),
// PIN не нужен — рендерим тот же AnalyticsApp в embedded-режиме (rid).
import AnalyticsApp from '@/app/analytics/page'
import { useDash } from '@/components/dash/context'
import { Spinner } from '@/components/ui'

export default function DashAnalyticsPage() {
  const { restaurant } = useDash()
  if (!restaurant) return <div style={{ display: 'flex', justifyContent: 'center', padding: '80px 0' }}><Spinner /></div>
  return <AnalyticsApp rid={restaurant.id} />
}
