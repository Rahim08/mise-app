// Simple in-memory rate limiter for API routes.
// Per-IP sliding window. Fine for serverless — each instance has its own map,
// but Vercel's routing distributes requests fairly evenly across instances.

const windows = new Map<string, { count: number; resetAt: number }>()

export function checkRateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now()
  const entry = windows.get(key)
  if (!entry || now > entry.resetAt) {
    windows.set(key, { count: 1, resetAt: now + windowMs })
    return true
  }
  if (entry.count >= max) return false
  entry.count++
  return true
}

export function rateLimitKey(req: Request, prefix: string): string {
  const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown'
  return `${prefix}:${ip}`
}
