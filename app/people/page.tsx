'use client'
import { useState } from 'react'
import { AuthGate } from '@/components/AuthGate'
import { PeopleApp } from './PeopleApp'

export const dynamic = 'force-dynamic'

export default function PeoplePage() {
  const [restaurantId, setRestaurantId] = useState<string | null>(null)
  if (!restaurantId) return <AuthGate appId="people" appName="Mise People" onAuth={setRestaurantId} />
  return <PeopleApp restaurantId={restaurantId} />
}
