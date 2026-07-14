'use client'
// Модуль Stash внутри дашборд-shell: owner уже авторизован (Supabase),
// PIN не нужен — рендерим тот же StashApp в embedded-режиме (rid).
import StashApp from '@/app/tobacco/page'
import { useDash } from '@/components/dash/context'
import { Spinner } from '@/components/ui'

export default function DashStashPage() {
  const { restaurant } = useDash()
  if (!restaurant) return <div style={{ display: 'flex', justifyContent: 'center', padding: '80px 0' }}><Spinner /></div>
  return <StashApp rid={restaurant.id} />
}
