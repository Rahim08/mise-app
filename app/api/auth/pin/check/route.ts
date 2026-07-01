import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import bcrypt from 'bcryptjs'
import { issueStaffToken, STAFF_COOKIE, STAFF_COOKIE_MAXAGE } from '@/lib/staffToken'

function withStaffCookie(body: any, token: string) {
  const res = NextResponse.json(body)
  res.cookies.set(STAFF_COOKIE, token, {
    httpOnly: true, sameSite: 'lax', secure: true, path: '/', maxAge: STAFF_COOKIE_MAXAGE,
  })
  // Readable companion: lets the client know the (httpOnly) token is still valid before
  // skipping PIN via Face ID. Holds only the expiry epoch — no secret.
  res.cookies.set('mise_token_until', String(Math.floor(Date.now() / 1000) + STAFF_COOKIE_MAXAGE), {
    httpOnly: false, sameSite: 'lax', secure: true, path: '/', maxAge: STAFF_COOKIE_MAXAGE,
  })
  return res
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const MAX_ATTEMPTS = 5
const BLOCK_MS = 15 * 60 * 1000

// Rate-limit живёт в БД (таблица pin_attempts): на Vercel инстансы функций не делят
// память, поэтому in-memory Map не ограничивал перебор между инстансами.
function rateLimitKey(req: NextRequest, restaurantId: string): string {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0] ?? req.headers.get('x-real-ip') ?? 'unknown'
  return `${ip}:${restaurantId}`
}

async function getAttempts(key: string): Promise<{ count: number; blockedUntil: number }> {
  const { data } = await supabase.from('pin_attempts').select('count, blocked_until, updated_at').eq('key', key).maybeSingle()
  if (!data) return { count: 0, blockedUntil: 0 }
  // Старые записи (без активной блокировки) сгорают через BLOCK_MS — счёт с нуля.
  if (Date.now() - new Date(data.updated_at).getTime() > BLOCK_MS && (!data.blocked_until || new Date(data.blocked_until).getTime() < Date.now())) {
    return { count: 0, blockedUntil: 0 }
  }
  return { count: data.count || 0, blockedUntil: data.blocked_until ? new Date(data.blocked_until).getTime() : 0 }
}

async function recordFailure(key: string, count: number) {
  await supabase.from('pin_attempts').upsert({
    key, count,
    blocked_until: count >= MAX_ATTEMPTS ? new Date(Date.now() + BLOCK_MS).toISOString() : null,
    updated_at: new Date().toISOString(),
  })
}

async function clearAttempts(key: string) {
  await supabase.from('pin_attempts').delete().eq('key', key)
}

export async function POST(req: NextRequest) {
  const { restaurantId, pin, deviceId } = await req.json()
  if (!restaurantId || !pin || !deviceId) return NextResponse.json({ error: 'Missing params (restaurantId, pin, deviceId required)' }, { status: 400 })

  const key = rateLimitKey(req, restaurantId)
  const entry = await getAttempts(key)
  if (Date.now() < entry.blockedUntil) {
    const retryAfter = Math.ceil((entry.blockedUntil - Date.now()) / 1000)
    return NextResponse.json({ error: 'Too many attempts' }, { status: 429, headers: { 'Retry-After': String(retryAfter) } })
  }

  // Check owner PIN
  const { data: restaurant } = await supabase
    .from('restaurants')
    .select('owner_pin')
    .eq('id', restaurantId)
    .single()

  if (restaurant?.owner_pin) {
    const ownerMatch = await bcrypt.compare(pin, restaurant.owner_pin)
    if (ownerMatch) {
      await clearAttempts(key)
      const apps = ['manager', 'analytics', 'stash']
      const token = issueStaffToken({ rid: restaurantId, sid: 'owner', owner: true, apps })
      return withStaffCookie({ match: true, is_owner: true, apps }, token)
    }
  }

  // Check staff PIN
  const { data: staffList } = await supabase
    .from('staff')
    .select('id, restaurant_id, name, role, apps, device_id, employee_id, is_active, pin_hash')
    .eq('restaurant_id', restaurantId)
    .eq('is_active', true)

  for (const staff of staffList || []) {
    if (!staff.pin_hash) continue
    const match = await bcrypt.compare(pin, staff.pin_hash)
    if (match) {
      await clearAttempts(key)
      // Enforce device binding: if staff already has a device_id and this request
      // comes from a different device, block login.
      if (staff.device_id && deviceId !== staff.device_id) {
        return NextResponse.json({ error: 'pin_device_mismatch' }, { status: 403 })
      }
      // Bind device on first login — check plan device limit first.
      if (deviceId && !staff.device_id) {
        const PLAN_LIMITS: Record<string, number> = { starter: 2, business: 5, pro: 10 }
        const { data: rest } = await supabase.from('restaurants').select('subscription_plan, device_limit').eq('id', restaurantId).single()
        const planLimit = PLAN_LIMITS[rest?.subscription_plan ?? 'business'] ?? 5
        const limit: number = rest?.device_limit ?? planLimit
        const { count } = await supabase.from('staff').select('id', { count: 'exact', head: true }).eq('restaurant_id', restaurantId).not('device_id', 'is', null)
        if ((count ?? 0) >= limit) {
          return NextResponse.json({ error: 'device_limit_reached' }, { status: 403 })
        }
        await supabase.from('staff').update({ device_id: deviceId }).eq('id', staff.id)
        staff.device_id = deviceId
      }
      const { pin_hash, ...safeStaff } = staff
      const token = issueStaffToken({ rid: restaurantId, sid: staff.id, owner: false, apps: staff.apps || [] })
      return withStaffCookie({ match: true, is_owner: false, staff: safeStaff }, token)
    }
  }

  await recordFailure(key, entry.count + 1)
  return NextResponse.json({ match: false })
}
