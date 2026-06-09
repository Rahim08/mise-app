import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const PUBLIC_PATHS = [
  '/auth',
  '/api/stripe',
  '/billing',
  '/_next',
  '/favicon',
]

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Публичные пути — пропускаем
  if (PUBLIC_PATHS.some(p => pathname.startsWith(p))) {
    return NextResponse.next()
  }

  // Dashboard всегда доступен
  if (pathname === '/dashboard') {
    return NextResponse.next()
  }

  // Проверяем только приложения
  const PROTECTED = ['/manager', '/analytics', '/tobacco']
  if (!PROTECTED.some(p => pathname.startsWith(p))) {
    return NextResponse.next()
  }

  // Проверяем сессию
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const authHeader = request.cookies.get('sb-access-token')?.value
  if (!authHeader) {
    return NextResponse.redirect(new URL('/auth/login', request.url))
  }

  const { data: { user } } = await supabase.auth.getUser(authHeader)
  if (!user) {
    return NextResponse.redirect(new URL('/auth/login', request.url))
  }

  const { data: restaurant } = await supabase
    .from('restaurants')
    .select('subscription_status, subscription_ends_at, subscription_plan')
    .eq('owner_id', user.id)
    .single()

  if (!restaurant) return NextResponse.next()

  const now = new Date()
  const endsAt = restaurant.subscription_ends_at ? new Date(restaurant.subscription_ends_at) : null
  const status = restaurant.subscription_status

  // trial или active и не истёк
  if ((status === 'trialing' || status === 'active') && endsAt && endsAt > now) {
    return NextResponse.next()
  }

  // grace period — 7 дней после истечения
  if (status === 'past_due' && endsAt) {
    const gracePeriod = new Date(endsAt.getTime() + 7 * 24 * 60 * 60 * 1000)
    if (gracePeriod > now) return NextResponse.next()
  }

  // Блокировка
  return NextResponse.redirect(new URL('/dashboard?tab=billing&blocked=1', request.url))
}

export const config = {
  matcher: ['/manager/:path*', '/analytics/:path*', '/tobacco/:path*'],
}
