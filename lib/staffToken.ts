// Server-only signed token for PIN-authenticated staff sessions.
// Compact JWT-like token (HMAC-SHA256) — no external dependency.
//
// Purpose: once a staff member enters the correct PIN, the server issues a signed,
// httpOnly cookie binding them to a restaurant + allowed apps. Server data endpoints
// trust this token instead of a client-supplied restaurant_id, so RLS can deny anon.

import crypto from 'crypto'

const COOKIE_NAME = 'mise_staff_token'
// Сессия живёт, пока сотрудник сам не нажмёт «Выйти» — как в банковских/Instagram-подобных
// приложениях, без принудительного релогина по таймеру. 10 лет — практически бессрочно,
// не буквальный «forever» (exp должен быть конечным числом), юзер-фидбэк 2026-07-31: раньше
// было 7 дней, сессия дропалась даже при ежедневном использовании (TTL не продлевался).
const TTL_SECONDS = 60 * 60 * 24 * 365 * 10 // 10 years

export interface StaffTokenPayload {
  typ?: 'staff'         // absent on tokens issued before 2026-08-05 — treated as 'staff'
  rid: string          // restaurant_id
  sid: string          // staff id, or 'owner'
  owner: boolean
  apps: string[]
  iat: number
  exp: number
}

function secret(): string {
  const s = process.env.MISE_TOKEN_SECRET
  if (!s) throw new Error('MISE_TOKEN_SECRET is required. Set it in Vercel environment variables.')
  return s
}

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function sign(data: string, key: string): string {
  return b64url(crypto.createHmac('sha256', key).update(data).digest())
}

export function issueStaffToken(input: { rid: string; sid: string; owner: boolean; apps: string[] }): string {
  const now = Math.floor(Date.now() / 1000)
  const payload: StaffTokenPayload = {
    typ: 'staff', rid: input.rid, sid: input.sid, owner: input.owner, apps: input.apps,
    iat: now, exp: now + TTL_SECONDS,
  }
  const body = b64url(JSON.stringify(payload))
  return `${body}.${sign(body, secret())}`
}

export function verifyStaffToken(token: string | undefined | null): StaffTokenPayload | null {
  if (!token) return null
  const [body, sig] = token.split('.')
  if (!body || !sig) return null
  // Constant-time comparison. Legacy SUPABASE_SERVICE_ROLE_KEY fallback removed 2026-07-17:
  // the 7-day TTL window after the 2026-07-07 secret rotation has closed.
  const expected = sign(body, secret())
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null
  try {
    const payload = JSON.parse(Buffer.from(body.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString()) as StaffTokenPayload
    if (!payload.rid || typeof payload.exp !== 'number') return null
    // typ absent = legacy token issued before 2026-08-05, still valid as staff.
    // typ present must be 'staff' — rejects an admin-view token copied into this cookie.
    if (payload.typ !== undefined && payload.typ !== 'staff') return null
    if (Math.floor(Date.now() / 1000) > payload.exp) return null
    return payload
  } catch {
    return null
  }
}

export const STAFF_COOKIE = COOKIE_NAME
export const STAFF_COOKIE_MAXAGE = TTL_SECONDS

// Super-admin "view as client" token — lets the single ADMIN_EMAIL account (see
// app/api/admin/route.ts) open any restaurant's web dashboard for support, without a PIN
// or owner Supabase session. Separate cookie/short TTL so it never collides with a real
// staff/owner session and can't be replayed long after the admin closes the tab.
const ADMIN_VIEW_COOKIE = 'mise_admin_view'
const ADMIN_VIEW_TTL_SECONDS = 60 * 60 // 1 hour

export interface AdminViewPayload { typ: 'admin_view'; rid: string; iat: number; exp: number }

export function issueAdminViewToken(rid: string): string {
  const now = Math.floor(Date.now() / 1000)
  const payload: AdminViewPayload = { typ: 'admin_view', rid, iat: now, exp: now + ADMIN_VIEW_TTL_SECONDS }
  const body = b64url(JSON.stringify(payload))
  return `${body}.${sign(body, secret())}`
}

export function verifyAdminViewToken(token: string | undefined | null): AdminViewPayload | null {
  if (!token) return null
  const [body, sig] = token.split('.')
  if (!body || !sig) return null
  const expected = sign(body, secret())
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null
  try {
    const payload = JSON.parse(Buffer.from(body.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString()) as AdminViewPayload
    if (!payload.rid || typeof payload.exp !== 'number') return null
    // Strict — 1h TTL means no legacy tokens outlive a deploy, unlike the staff cookie.
    // Rejects a staff token (typ 'staff' or absent) copied into this cookie to escalate to owner.
    if (payload.typ !== 'admin_view') return null
    if (Math.floor(Date.now() / 1000) > payload.exp) return null
    return payload
  } catch {
    return null
  }
}

export const ADMIN_VIEW_COOKIE_NAME = ADMIN_VIEW_COOKIE
export const ADMIN_VIEW_COOKIE_MAXAGE = ADMIN_VIEW_TTL_SECONDS
