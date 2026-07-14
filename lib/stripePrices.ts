// Резолв Stripe price id по lookup_key (цены создаёт scripts/stripe-setup.mjs).
// Кэш на инстанс функции — Fluid Compute переиспользует процесс между запросами.

import type Stripe from 'stripe'

const cache = new Map<string, string>()

export async function resolvePriceIds(stripe: Stripe, lookupKeys: string[]): Promise<Record<string, string>> {
  const missing = lookupKeys.filter(k => !cache.has(k))
  if (missing.length) {
    const res = await stripe.prices.list({ lookup_keys: missing, limit: 100 })
    for (const p of res.data) if (p.lookup_key) cache.set(p.lookup_key, p.id)
    const still = missing.filter(k => !cache.has(k))
    if (still.length) throw new Error(`Stripe prices не найдены: ${still.join(', ')} — запусти scripts/stripe-setup.mjs`)
  }
  return Object.fromEntries(lookupKeys.map(k => [k, cache.get(k)!]))
}
