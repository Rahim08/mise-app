// APNs sender (HTTP/2 + ES256 token auth), zero external dependencies.
//
// undici/fetch не умеет HTTP/2, а APNs его требует → используем встроенный node:http2.
// Ключ берём из env APNS_AUTH_KEY (содержимое .p8) или из файла AuthKey_<KEY_ID>.p8 в корне.
//
// ВАЖНО: ключ AuthKey_W6HCZSDZ6W сейчас используется и для Sign in with Apple. Для работы
// push у этого ключа в Apple Developer должна быть включена услуга Apple Push Notifications.
// Пока этого нет — sendPush просто вернёт {sent:0} и ничего не сломает.

import crypto from 'node:crypto'
import http2 from 'node:http2'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const KEY_ID = process.env.APNS_KEY_ID || 'W6HCZSDZ6W'
const TEAM_ID = process.env.APNS_TEAM_ID || 'J6TW52VHQQ'
const TOPIC = process.env.APNS_TOPIC || 'com.rahim.mise'

function loadKey(): string | null {
  if (process.env.APNS_AUTH_KEY) return process.env.APNS_AUTH_KEY.replace(/\\n/g, '\n')
  try { return readFileSync(join(process.cwd(), `AuthKey_${KEY_ID}.p8`), 'utf8') } catch { return null }
}

function b64url(s: string) { return Buffer.from(s).toString('base64url') }

// JWT переиспользуем (APNs требует обновление < 60 мин, рекомендует > 20 мин).
let cached: { token: string; iat: number } | null = null
function jwt(): string | null {
  const key = loadKey()
  if (!key) return null
  const now = Math.floor(Date.now() / 1000)
  if (cached && now - cached.iat < 3000) return cached.token
  try {
    const signingInput = `${b64url(JSON.stringify({ alg: 'ES256', kid: KEY_ID }))}.${b64url(JSON.stringify({ iss: TEAM_ID, iat: now }))}`
    const sig = crypto.sign('SHA256', Buffer.from(signingInput), { key, dsaEncoding: 'ieee-p1363' })
    const token = `${signingInput}.${sig.toString('base64url')}`
    cached = { token, iat: now }
    return token
  } catch { return null }
}

export interface PushMsg { title: string; body: string; data?: Record<string, unknown>; badge?: number; threadId?: string }

const APNS_REQUEST_TIMEOUT_MS = 10_000

function sendOne(host: string, jwtToken: string, deviceToken: string, msg: PushMsg): Promise<{ ok: boolean; status: number; reason?: string }> {
  return new Promise((resolve) => {
    let settled = false
    let client: http2.ClientHttp2Session | undefined
    const done = (r: { ok: boolean; status: number; reason?: string }) => { if (!settled) { settled = true; clearTimeout(timer); resolve(r) } }
    // A connection that's accepted but never answers would otherwise hang this promise
    // forever, stalling dispatchNotification's loop over every remaining recipient
    // (audit 2026-08-15, block-G #9).
    const timer = setTimeout(() => { try { client?.destroy() } catch { /* noop */ }; done({ ok: false, status: 0, reason: 'timeout' }) }, APNS_REQUEST_TIMEOUT_MS)
    try { client = http2.connect(`https://${host}`) } catch { return done({ ok: false, status: 0, reason: 'connect_error' }) }
    client.on('error', () => done({ ok: false, status: 0, reason: 'connect_error' }))

    const aps: Record<string, unknown> = { alert: { title: msg.title, body: msg.body }, sound: 'default' }
    if (msg.badge != null) aps.badge = msg.badge
    if (msg.threadId) aps['thread-id'] = msg.threadId
    const payload = JSON.stringify({ aps, ...(msg.data || {}) })

    const req = client.request({
      ':method': 'POST',
      ':path': `/3/device/${deviceToken}`,
      authorization: `bearer ${jwtToken}`,
      'apns-topic': TOPIC,
      'apns-push-type': 'alert',
      'content-type': 'application/json',
    })
    let status = 0
    let respBody = ''
    req.on('response', (h) => { status = Number(h[':status']) })
    req.setEncoding('utf8')
    req.on('data', (d) => { respBody += d })
    req.on('end', () => {
      try { client.close() } catch { /* noop */ }
      let reason: string | undefined
      try { reason = JSON.parse(respBody)?.reason } catch { /* noop */ }
      done({ ok: status === 200, status, reason })
    })
    req.on('error', () => { try { client.close() } catch { /* noop */ }; done({ ok: false, status: 0, reason: 'req_error' }) })
    req.end(payload)
  })
}

/**
 * Шлёт push на список device-токенов. Возвращает кол-во доставленных и список «мёртвых»
 * токенов (BadDeviceToken/Unregistered) — их можно удалить из push_subscriptions.
 * Dev-сборки (Xcode) дают sandbox-токены; на проде токены production. Пробуем основной
 * хост, при несовпадении окружения — повторяем на втором.
 */
export async function sendPush(deviceTokens: string[], msg: PushMsg): Promise<{ sent: number; invalid: string[] }> {
  const token = jwt()
  if (!token || !deviceTokens.length) return { sent: 0, invalid: [] }
  const prod = process.env.APNS_PRODUCTION !== 'false'
  const primary = prod ? 'api.push.apple.com' : 'api.sandbox.push.apple.com'
  const secondary = prod ? 'api.sandbox.push.apple.com' : 'api.push.apple.com'
  let sent = 0
  const invalid: string[] = []
  for (const dt of deviceTokens) {
    let r = await sendOne(primary, token, dt, msg)
    if (!r.ok && (r.reason === 'BadDeviceToken' || r.reason === 'DeviceTokenNotForTopic')) {
      r = await sendOne(secondary, token, dt, msg)
    }
    if (r.ok) sent++
    else if (r.reason === 'BadDeviceToken' || r.reason === 'Unregistered') invalid.push(dt)
  }
  return { sent, invalid }
}

export function apnsConfigured(): boolean { return !!loadKey() }
