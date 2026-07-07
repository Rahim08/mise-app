// Server-only signed token for PIN-authenticated staff sessions.
// Compact JWT-like token (HMAC-SHA256) — no external dependency.
//
// Purpose: once a staff member enters the correct PIN, the server issues a signed,
// httpOnly cookie binding them to a restaurant + allowed apps. Server data endpoints
// trust this token instead of a client-supplied restaurant_id, so RLS can deny anon.

import crypto from 'crypto'

const COOKIE_NAME = 'mise_staff_token'
const TTL_SECONDS = 60 * 60 * 24 * 7 // 7 days (reduced from 30 for security)

export interface StaffTokenPayload {
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

function sign(data: string): string {
  return b64url(crypto.createHmac('sha256', secret()).update(data).digest())
}

export function issueStaffToken(input: { rid: string; sid: string; owner: boolean; apps: string[] }): string {
  const now = Math.floor(Date.now() / 1000)
  const payload: StaffTokenPayload = {
    rid: input.rid, sid: input.sid, owner: input.owner, apps: input.apps,
    iat: now, exp: now + TTL_SECONDS,
  }
  const body = b64url(JSON.stringify(payload))
  return `${body}.${sign(body)}`
}

export function verifyStaffToken(token: string | undefined | null): StaffTokenPayload | null {
  if (!token) return null
  const [body, sig] = token.split('.')
  if (!body || !sig) return null
  // Constant-time comparison
  const expected = sign(body)
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null
  try {
    const payload = JSON.parse(Buffer.from(body.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString()) as StaffTokenPayload
    if (!payload.rid || typeof payload.exp !== 'number') return null
    if (Math.floor(Date.now() / 1000) > payload.exp) return null
    return payload
  } catch {
    return null
  }
}

export const STAFF_COOKIE = COOKIE_NAME
export const STAFF_COOKIE_MAXAGE = TTL_SECONDS
