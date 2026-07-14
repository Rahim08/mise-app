'use client'
// Модуль People внутри дашборд-shell: owner уже авторизован (Supabase),
// PIN не нужен — рендерим тот же PeopleApp в embedded-режиме.
import { PeopleApp } from '@/app/people/page'
import { useDash } from '@/components/dash/context'
import { Spinner } from '@/components/ui'

export default function DashPeoplePage() {
  const { restaurant } = useDash()
  if (!restaurant) return <div style={{ display: 'flex', justifyContent: 'center', padding: '80px 0' }}><Spinner /></div>
  return <PeopleApp restaurantId={restaurant.id} embedded />
}
