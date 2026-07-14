// Создаёт продукты и цены Stripe для биллинга v2 (идемпотентно, по lookup_key).
// Запуск:  STRIPE_SECRET_KEY=sk_test_... node scripts/stripe-setup.mjs
//          (или ключ подтянется из .env.local)
// Сначала прогнать с sk_test_, проверить checkout, потом отдельно с sk_live_.
//
// Роуты НЕ используют env STRIPE_PRICE_* для новых цен — они резолвят price id
// по lookup_key в рантайме (lib/stripePrices.ts), так что после этого скрипта
// ничего в Vercel добавлять не нужно.

import { readFileSync } from 'node:fs'
import Stripe from 'stripe'

// Цены дублируем из lib/plans.ts (скрипт — .mjs без TS-импорта; при изменении цен
// менять в обоих местах, скрипт перепроверяет суммы и падает при расхождении с уже
// созданной ценой).
const YEARLY_DISCOUNT = 0.2
const yearly = m => Math.round(m * 12 * (1 - YEARLY_DISCOUNT))

const ITEMS = [
  { key: 'starter',      name: 'Mise Starter',            monthly: 14 },
  { key: 'business',     name: 'Mise Business',           monthly: 24 },
  { key: 'pro',          name: 'Mise Pro',                monthly: 39 },
  { key: 'addon_module', name: 'Mise — доп. модуль',      monthly: 3 },
  { key: 'addon_seat',   name: 'Mise — доп. место',       monthly: 2 },
  { key: 'addon_ai',     name: 'Mise — AI-аналитика',     monthly: 5 },
]

function loadKey() {
  if (process.env.STRIPE_SECRET_KEY) return process.env.STRIPE_SECRET_KEY
  try {
    const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    const m = env.match(/^STRIPE_SECRET_KEY=(.+)$/m)
    if (m) return m[1].trim()
  } catch {}
  console.error('Нет STRIPE_SECRET_KEY (env или .env.local)')
  process.exit(1)
}

const stripe = new Stripe(loadKey())

async function ensurePrice(product, item, interval) {
  const lookupKey = `mise_${item.key}_${interval}`
  const amount = (interval === 'month' ? item.monthly : yearly(item.monthly)) * 100
  const existing = await stripe.prices.list({ lookup_keys: [lookupKey], limit: 1 })
  if (existing.data[0]) {
    const p = existing.data[0]
    if (p.unit_amount !== amount) {
      console.error(`РАСХОЖДЕНИЕ: ${lookupKey} в Stripe €${p.unit_amount / 100}, в коде €${amount / 100}. Цены в Stripe неизменяемы — создай новую цену и перенеси lookup_key вручную.`)
      process.exitCode = 1
    } else {
      console.log(`ok      ${lookupKey} → ${p.id} (€${amount / 100}/${interval})`)
    }
    return p
  }
  const p = await stripe.prices.create({
    product: product.id,
    currency: 'eur',
    unit_amount: amount,
    recurring: { interval },
    lookup_key: lookupKey,
    nickname: `${item.name} / ${interval}`,
  })
  console.log(`created ${lookupKey} → ${p.id} (€${amount / 100}/${interval})`)
  return p
}

async function ensureProduct(item) {
  // Продукт ищем по metadata.mise_key (search недоступен в test-режиме мгновенно —
  // используем list+filter, продуктов немного).
  const all = await stripe.products.list({ limit: 100, active: true })
  let product = all.data.find(p => p.metadata?.mise_key === item.key)
  if (!product) {
    product = await stripe.products.create({ name: item.name, metadata: { mise_key: item.key } })
    console.log(`created product ${item.key} → ${product.id}`)
  }
  return product
}

const mode = (await stripe.balance.retrieve().then(() => loadKey())).startsWith('sk_live') ? 'LIVE' : 'TEST'
console.log(`Stripe mode: ${mode}\n`)

for (const item of ITEMS) {
  const product = await ensureProduct(item)
  await ensurePrice(product, item, 'month')
  await ensurePrice(product, item, 'year')
}

console.log('\nГотово. Роуты найдут цены по lookup_key автоматически.')
