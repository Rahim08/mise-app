// Next 16: file convention `middleware` переименован в `proxy` (deprecation fix).
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'

// Страна (Vercel гео-IP) → язык по умолчанию. Неизвестная страна → English.
function countryToLocale(c: string | null): string {
  switch ((c || '').toUpperCase()) {
    case 'RU': case 'BY': return 'ru'
    case 'UA': return 'uk'
    case 'KZ': return 'kk'
    case 'IT': return 'it'
    case 'FR': case 'BE': case 'MC': case 'LU': return 'fr'
    case 'AZ': return 'az'
    case 'TR': return 'tr'
    default: return 'en'
  }
}

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname
  const isAppRoute = path.startsWith('/analytics') || path.startsWith('/tobacco')

  let response = NextResponse.next({ request })

  // Гео-язык: один раз ставим cookie по стране, если язык ещё не выбран вручную.
  // Читают и лендинг (public/landing.html), и lib/i18n (дашборд/приложения).
  if (!request.cookies.has('mise_geo') && !request.cookies.has('mise_lang')) {
    response.cookies.set('mise_geo', countryToLocale(request.headers.get('x-vercel-ip-country')),
                         { path: '/', maxAge: 60 * 60 * 24 * 30, sameSite: 'lax' })
  }

  // Авторизация — только для приложений (лендинг и прочее не трогаем).
  if (!isAppRoute) return response

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll() },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  if (!user && !request.cookies.has('mise_restaurant_id')) {
    return NextResponse.redirect(new URL('/join?error=no_session', request.url))
  }

  return response
}

export const config = {
  // '/' — для гео-cookie на лендинге; app-роуты — для гео + auth.
  // /manager excluded: AuthGate handles its own PIN auth
  matcher: ['/', '/analytics/:path*', '/tobacco/:path*'],
}
