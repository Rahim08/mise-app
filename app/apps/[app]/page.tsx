'use client'
import { use } from 'react'

// Шеринговые URL под каждое приложение: /apps/manager, /apps/menu и т.д.
// Переиспользуем утверждённый лендинг (iframe), открывая его на нужной секции по якорю —
// без дублирования дизайна. Неизвестный slug → лендинг с начала.
const VALID = ['manager', 'analytics', 'stash', 'people', 'menu']

export default function AppPage({ params }: { params: Promise<{ app: string }> }) {
  const { app } = use(params)
  const id = VALID.includes(app) ? app : ''
  return (
    <iframe src={'/landing.html' + (id ? '#' + id : '')} style={{ width: '100%', height: '100vh', border: 'none', display: 'block' }} />
  )
}
