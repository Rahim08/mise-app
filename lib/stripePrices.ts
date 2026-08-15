// Резолв Stripe price id по lookup_key (цены создаёт scripts/stripe-setup.mjs).
// Кэш на инстанс функции — Fluid Compute переиспользует процесс между запросами.

import type Stripe from 'stripe'

const TTL_MS = 10 * 60 * 1000 // re-fetch periodically so a Dashboard price recreate
// (same lookup_key, new price id — e.g. a price correction) doesn't leave a warm
// instance serving a stale, now-archived price id until it happens to cold-start
// (аудит 2026-08-15, block-F #3).

const cache = new Map<string, { priceId: string; cachedAt: number }>()

export async function resolvePriceIds(stripe: Stripe, lookupKeys: string[]): Promise<Record<string, string>> {
  const now = Date.now()
  const missing = lookupKeys.filter(k => {
    const entry = cache.get(k)
    return !entry || now - entry.cachedAt > TTL_MS
  })
  if (missing.length) {
    const res = await stripe.prices.list({ lookup_keys: missing, limit: 100 })
    for (const p of res.data) if (p.lookup_key) cache.set(p.lookup_key, { priceId: p.id, cachedAt: now })
    const still = missing.filter(k => !cache.has(k))
    if (still.length) throw new Error(`Stripe prices не найдены: ${still.join(', ')} — запусти scripts/stripe-setup.mjs`)
  }
  return Object.fromEntries(lookupKeys.map(k => [k, cache.get(k)!.priceId]))
}
