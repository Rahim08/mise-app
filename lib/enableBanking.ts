// Enable Banking (enablebanking.com) — Open Banking клиент для вкладки «Банк» в
// Analytics. GoCardless Bank Account Data закрыл новые регистрации (2026-08-16) —
// Enable Banking даёт то же самое бесплатно в режиме «Restricted Production»: реальные
// данные, но только для счетов, которые сам явно привязал через /auth-флоу (ровно наш
// случай — сначала свой Revolut). Коммерческий тариф (все клиенты) — отдельный вопрос
// на будущее, не блокирует MVP.
//
// Требует ENABLEBANKING_APP_ID + ENABLEBANKING_PRIVATE_KEY (содержимое .pem, полученного
// при регистрации приложения в их Control Panel; \n в env экранированы, как APNS_AUTH_KEY
// в lib/apns.ts). Аутентификация — самоподписанный JWT (RS256), без сетевого token-запроса.
//
// Важно на этапе имплементации: проверить точные поля /auth, /sessions, /accounts/*/
// (balances|transactions) по их актуальному API reference при первом реальном тесте —
// эта версия собрана по документации, не по рабочему прогону.

import crypto from 'crypto'

const BASE_URL = 'https://api.enablebanking.com'

function base64url(input: Buffer | string): string {
  return (Buffer.isBuffer(input) ? input : Buffer.from(input))
    .toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function signJwt(appId: string, privateKeyPem: string): string {
  const header = { typ: 'JWT', alg: 'RS256', kid: appId }
  const now = Math.floor(Date.now() / 1000)
  const payload = { iss: 'enablebanking.com', aud: 'api.enablebanking.com', iat: now, exp: now + 3600 }
  const data = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`
  const signature = crypto.sign('RSA-SHA256', Buffer.from(data), privateKeyPem)
  return `${data}.${base64url(signature)}`
}

function credentials(): { appId: string; privateKey: string } {
  const appId = process.env.ENABLEBANKING_APP_ID
  const privateKey = process.env.ENABLEBANKING_PRIVATE_KEY?.replace(/\\n/g, '\n')
  if (!appId || !privateKey) throw new Error('Enable Banking не настроен (нет ENABLEBANKING_APP_ID/ENABLEBANKING_PRIVATE_KEY)')
  return { appId, privateKey }
}

async function ebFetch(path: string, init?: RequestInit): Promise<any> {
  const { appId, privateKey } = credentials()
  const jwt = signJwt(appId, privateKey)
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: { ...(init?.headers || {}), Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new Error(data?.message || data?.error || `Enable Banking ${path}: ${res.status}`)
  return data
}

export type Institution = { name: string; country: string }

export async function findInstitutions(country: string, query: string): Promise<Institution[]> {
  const data = await ebFetch(`/aspsps?country=${encodeURIComponent(country)}`)
  const q = query.toLowerCase()
  return (Array.isArray(data?.aspsps) ? data.aspsps : []).filter((a: any) => String(a.name || '').toLowerCase().includes(q))
    .map((a: any) => ({ name: a.name, country: a.country || country }))
}

// state = наш bank_connections.id — привязывает redirect обратно к нужной строке.
export async function createAuth(
  institution: Institution, redirectUrl: string, state: string,
): Promise<{ link: string }> {
  const validUntil = new Date(Date.now() + 90 * 86400000).toISOString()
  const data = await ebFetch('/auth', {
    method: 'POST',
    body: JSON.stringify({
      access: { valid_until: validUntil },
      aspsp: { name: institution.name, country: institution.country },
      state, redirect_url: redirectUrl, psu_type: 'business',
    }),
  })
  return { link: data.url || data.link }
}

// Обмен authorization code (из redirect ?code=) на session_id + список привязанных счетов.
export async function createSession(code: string): Promise<{ sessionId: string; accountIds: string[] }> {
  const data = await ebFetch('/sessions', { method: 'POST', body: JSON.stringify({ code }) })
  const accounts = Array.isArray(data?.accounts) ? data.accounts : []
  return {
    sessionId: data.session_id || data.id,
    accountIds: accounts.map((a: any) => a.uid || a.account_id || a.id).filter(Boolean),
  }
}

export type SyncResult = { ok: boolean; transactionsSynced?: number; error?: string }

// Апсерт по (connection_id, external_id) — банк может отдавать частично перекрывающуюся
// историю на каждый sync, дубли гасит UNIQUE-констрейнт в БД.
export async function syncConnection(admin: any, connection: any): Promise<SyncResult> {
  try {
    const accountId = connection.account_id
    if (!accountId) throw new Error('Счёт не привязан')

    const balData = await ebFetch(`/accounts/${accountId}/balances`)
    const balances = Array.isArray(balData?.balances) ? balData.balances : []
    const primary = balances.find((b: any) => /interim|avail|expected/i.test(b.balance_type || b.balanceType || '')) || balances[0]
    const amountField = primary?.balance_amount || primary?.balanceAmount
    const balance = amountField ? Number(amountField.amount) : null
    const balanceCurrency = amountField?.currency || null

    const txData = await ebFetch(`/accounts/${accountId}/transactions`)
    const booked = Array.isArray(txData?.transactions) ? txData.transactions : (txData?.booked || [])
    const rows = booked.map((tItem: any, i: number) => {
      const amt = tItem.transaction_amount || tItem.transactionAmount || {}
      return {
        restaurant_id: connection.restaurant_id,
        connection_id: connection.id,
        external_id: tItem.entry_reference || tItem.transaction_id || tItem.transactionId
          || `${tItem.booking_date || tItem.bookingDate}-${amt.amount}-${i}`,
        booking_date: tItem.booking_date || tItem.bookingDate || null,
        amount: Number(amt.amount || 0),
        currency: amt.currency || balanceCurrency,
        description: tItem.remittance_information?.[0] || tItem.remittanceInformationUnstructured
          || tItem.creditor?.name || tItem.debtor?.name || null,
        counterparty: tItem.creditor?.name || tItem.debtor?.name || null,
        raw: tItem,
      }
    })

    if (rows.length > 0) {
      const { error: txErr } = await admin.from('bank_transactions')
        .upsert(rows, { onConflict: 'connection_id,external_id' })
      if (txErr) throw new Error(txErr.message)
    }

    const now = new Date().toISOString()
    await admin.from('bank_connections').update({
      balance, balance_currency: balanceCurrency, balance_synced_at: now,
      last_synced_at: now, status: 'linked', error_message: null,
    }).eq('id', connection.id)

    return { ok: true, transactionsSynced: rows.length }
  } catch (err: any) {
    const message = err?.message || 'Sync failed'
    await admin.from('bank_connections').update({
      status: 'error', error_message: message, last_synced_at: new Date().toISOString(),
    }).eq('id', connection.id)
    return { ok: false, error: message }
  }
}
