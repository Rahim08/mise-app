import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { verifyOwner } from '@/lib/stripeAuth'
import { PLANS, ALL_MODULES, stripeLookupKey, type PlanId } from '@/lib/plans'
import { resolvePriceIds } from '@/lib/stripePrices'

// Биллинг v2: одна подписка = план + аддоны (модули/места/AI) одним набором items.
// Какие ИМЕННО модули куплены, Stripe не знает — это хранит restaurants.addon_modules
// (пишется вебхуком из metadata); Stripe только считает деньги по количествам.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { restaurantId } = body
    const plan = String(body.plan || '') as PlanId
    const interval: 'month' | 'year' = body.interval === 'year' ? 'year' : 'month'
    const planData = PLANS[plan]
    if (!planData) return NextResponse.json({ error: 'Invalid plan' }, { status: 400 })

    // Аддоны валидируем против тарифа: нельзя купить модуль, который уже включён.
    const addonModules = [...new Set<string>((Array.isArray(body.addonModules) ? body.addonModules : [])
      .filter((m: any) => ALL_MODULES.includes(m) && !planData.modules.includes(m)))]
    const extraSeats = Math.min(200, Math.max(0, parseInt(body.extraSeats) || 0))
    const addonAI = !!body.addonAI && !planData.ai

    // userId/email — из проверенной сессии владельца, а не из тела запроса.
    const auth = await verifyOwner(req, restaurantId)
    if (!auth.ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const userId = auth.userId!
    const email = auth.email

    const Stripe = (await import('stripe')).default
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    const { data: restaurant } = await supabase
      .from('restaurants')
      .select('stripe_customer_id')
      .eq('id', restaurantId)
      .single()

    let customerId = restaurant?.stripe_customer_id

    if (!customerId) {
      const customer = await stripe.customers.create({ email, metadata: { restaurantId, userId } })
      customerId = customer.id
      // Молчаливое падение здесь плодит дубли Stripe-customers на каждый чекаут
      const { error: custErr } = await supabase.from('restaurants').update({ stripe_customer_id: customerId }).eq('id', restaurantId)
      if (custErr) throw new Error(`save stripe_customer_id: ${custErr.message}`)
    }

    const lookupKeys = [
      stripeLookupKey(plan, interval),
      ...(addonModules.length ? [stripeLookupKey('addon_module', interval)] : []),
      ...(extraSeats > 0 ? [stripeLookupKey('addon_seat', interval)] : []),
      ...(addonAI ? [stripeLookupKey('addon_ai', interval)] : []),
    ]
    const prices = await resolvePriceIds(stripe, lookupKeys)

    const line_items = [
      { price: prices[stripeLookupKey(plan, interval)], quantity: 1 },
      ...(addonModules.length ? [{ price: prices[stripeLookupKey('addon_module', interval)], quantity: addonModules.length }] : []),
      ...(extraSeats > 0 ? [{ price: prices[stripeLookupKey('addon_seat', interval)], quantity: extraSeats }] : []),
      ...(addonAI ? [{ price: prices[stripeLookupKey('addon_ai', interval)], quantity: 1 }] : []),
    ]

    // Триала в checkout больше нет: 14 дней Pro клиент получил при регистрации (в БД).
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      mode: 'subscription',
      line_items,
      subscription_data: {
        metadata: {
          restaurantId, plan,
          addon_modules: addonModules.join(','),
          extra_seats: String(extraSeats),
          addon_ai: addonAI ? '1' : '0',
          interval,
        },
      },
      success_url: `${req.nextUrl.origin}/dashboard?tab=billing&success=1`,
      cancel_url: `${req.nextUrl.origin}/dashboard?tab=billing`,
    })

    return NextResponse.json({ url: session.url })
  } catch (err: any) {
    console.error(err)
    // В app_errors — иначе ошибка видна только в Vercel-логах
    try {
      const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
      await admin.from('app_errors').insert({ source: 'server', message: `stripe/checkout: ${err.message}`, stack: err.stack?.slice(0, 4000) })
    } catch {}
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
