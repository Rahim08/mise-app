'use client'
// Модуль People внутри дашборд-shell: owner уже авторизован (Supabase),
// PIN не нужен — рендерим тот же PeopleApp в embedded-режиме.
import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { PeopleApp } from '@/app/people/PeopleApp'
import { useDash } from '@/components/dash/context'
import { Spinner } from '@/components/ui'

function DashPeopleContent() {
  const { restaurant } = useDash()
  const params = useSearchParams()
  const section = params.get('tab')
  const initialSection = section === 'orders' || section === 'audits' ? section : undefined
  if (!restaurant) return <div style={{ display: 'flex', justifyContent: 'center', padding: '80px 0' }}><Spinner /></div>
  return <PeopleApp key={initialSection || 'default'} restaurantId={restaurant.id} embedded initialSection={initialSection} />
}

export default function DashPeoplePage() {
  return <Suspense fallback={<div style={{ display: 'flex', justifyContent: 'center', padding: '80px 0' }}><Spinner /></div>}><DashPeopleContent /></Suspense>
}
