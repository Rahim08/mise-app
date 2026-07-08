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

export function rateLimitKey(req: Request, prefix: string): string {
  const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown'
  return `${prefix}:${ip}`
}
