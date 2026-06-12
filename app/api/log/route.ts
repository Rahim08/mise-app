// Лёгкий приёмник клиентских ошибок → таблица app_errors (см. docs/OPS.md).
// Без внешнего сервиса: смотреть в Supabase Table Editor. Заменится на Sentry позже.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export async function POST(req: NextRequest) {
  try {
    const { message, stack, url, source } = await req.json()
    if (!message || typeof message !== 'string') return NextResponse.json({ ok: false }, { status: 400 })

    const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
    await admin.from('app_errors').insert({
      source: source === 'server' ? 'server' : 'client',
      message: String(message).slice(0, 1000),
      stack: stack ? String(stack).slice(0, 4000) : null,
      url: url ? String(url).slice(0, 500) : null,
      user_agent: req.headers.get('user-agent')?.slice(0, 300) ?? null,
    })
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}
