// DB-backed rate limiter for API routes (atomic UPSERT via rate_limit_hit RPC —
// see docs/migrations/rate-limit-atomic-2026-07.sql). In-memory Map doesn't work
// across Vercel serverless instances, which don't share memory.

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function checkRateLimit(key: string, max: number, windowMs: number): Promise<boolean> {
  const { data, error } = await supabase.rpc('rate_limit_hit', { p_key: key, p_max: max, p_window_ms: windowMs })
  if (error) {
    console.error('[rateLimit] rate_limit_hit failed:', error.message)
    return true // fail-open: a DB hiccup shouldn't lock out legitimate traffic
  }
  return data === true
}

// G8 (аудит 2026-08-15): подтверждено по docs (vercel.com/docs/headers/request-headers,
// раздел x-forwarded-for), 2026-08-15 — «we currently overwrite the X-Forwarded-For header
// and do not forward external IPs. This restriction is in place to prevent IP spoofing»
// (кроме Enterprise Trusted Proxy — этот проект на нём не сидит). Клиент не может подменить
// этот заголовок на Vercel — `.split(',')[0]` здесь берёт IP, который проставил сам Vercel,
// не что-то, что мог прислать запрос. x-vercel-forwarded-for предпочтителен и первым в
// цепочке: та же доступная в доке формулировка — «x-forwarded-for could be overwritten if
// you're using a proxy on top of Vercel», x-vercel-forwarded-for от этого не зависит.
export function rateLimitKey(req: Request, prefix: string): string {
  const raw = req.headers.get('x-vercel-forwarded-for') || req.headers.get('x-forwarded-for') || ''
  const ip = raw.split(',')[0].trim() || 'unknown'
  return `${prefix}:${ip}`
}
