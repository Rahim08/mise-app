import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { verifyOwner } from '@/lib/stripeAuth'
import { PLANS, ALL_MODULES, stripeLookupKey, monthlyRevenue, type PlanId } from '@/lib/plans'
import { resolvePriceIds } from '@/lib/stripePrices'

// Self-serve изменение подписки (биллинг v2): план / интервал / модули / места / AI
// одним апдейтом существующей подписки с прорейтом — без нового checkout.
// preview=true — ничего не меняет, возвращает сумму доплаты и новую цену.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { restaurantId, preview } = body

    const auth = await verifyOwner(req, restaurantId)
    if (!auth.ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
    const { data: rest } = await supabase
      .from('restaurants')
      .select('subscription_id, stripe_customer_id, subscription_plan, billing_interval, addon_modules, extra_seats, addon_ai')
      .eq('id', restaurantId)
      .single()

    if (!rest?.subscription_id) {
      return NextResponse.json({ error: 'no_subscription', message: 'Нет активной подписки — оформите план через оплату' }, { status: 400 })
    }

    // Желаемое состояние = текущее + переданные изменения
    const plan = (body.plan ?? rest.subscription_plan ?? 'starter') as PlanId
    const planData = PLANS[plan]
    if (!planData) return NextResponse.json({ error: 'Invalid plan' }, { status: 400 })
    const interval: 'month' | 'year' = (body.interval ?? rest.billing_interval) === 'year' ? 'year' : 'month'
    const addonModules: string[] = [...new Set(((body.addonModules ?? rest.addon_modules ?? []) as any[])
      .filter((m: any) => ALL_MODULES.includes(m) && !planData.modules.includes(m)))]
    const extraSeats = Math.min(200, Math.max(0, parseInt(body.extraSeats ?? rest.extra_seats) || 0))
    const addonAI = !!(body.addonAI ?? rest.addon_ai) && !planData.ai

    const Stripe = (await import('stripe')).default
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)
    const sub: any = await stripe.subscriptions.retrieve(rest.subscription_id)
    if (!['active', 'trialing', 'past_due'].includes(sub.status)) {
      return NextResponse.json({ error: 'no_subscription', message: 'Подписка неактивна — оформите план заново' }, { status: 400 })
    }

    // Целевые позиции: lookup_key → quantity
    const target: Record<string, number> = { [stripeLookupKey(plan, interval)]: 1 }
    if (addonModules.length) target[stripeLookupKey('addon_module', interval)] = addonModules.length
    if (extraSeats > 0) target[stripeLookupKey('addon_seat', interval)] = extraSeats
    if (addonAI) target[stripeLookupKey('addon_ai', interval)] = 1
    const prices = await resolvePriceIds(stripe, Object.keys(target))

    // Diff с текущими items подписки
    const items: any[] = []
    const seen = new Set<string>()
    for (const it of sub.items.data) {
      const key = it.price?.lookup_key
      if (key && target[key] != null) {
        seen.add(key)
        if (it.quantity !== target[key]) items.push({ id: it.id, quantity: target[key] })
      } else {
        items.push({ id: it.id, deleted: true })
      }
    }
    for (const key of Object.keys(target)) {
      if (!seen.has(key)) items.push({ price: prices[key], quantity: target[key] })
    }

    const nextFields = {
      subscription_plan: plan,
      billing_interval: interval,
      addon_modules: addonModules,
      extra_seats: extraSeats,
      addon_ai: addonAI,
    }
    const monthly = monthlyRevenue({ ...nextFields, subscription_status: 'active' })

    // metadata — источник правды для вебхука (entitlementFields): именно из неё
    // customer.subscription.updated переливает состав модулей в restaurants.
    const metadata = {
      restaurantId, plan,
      addon_modules: addonModules.join(','),
      extra_seats: String(extraSeats),
      addon_ai: addonAI ? '1' : '0',
      interval,
    }
    // Замена одного аддон-модуля на другой (Stash → Bookings) не меняет ни одну позицию
    // по lookup_key+quantity — items выходил пустым, subscriptions.update не вызывался,
    // metadata оставалась старой, и ближайший вебхук откатывал состав модулей обратно.
    // Поэтому сравниваем ещё и metadata: если она разошлась — апдейтим подписку без items
    // (только метаданные, на суммы и прорейт это не влияет).
    const metaChanged = Object.entries(metadata).some(([k, v]) => String(sub.metadata?.[k] ?? '') !== String(v))

    if (preview) {
      let amountDue: number | null = null
      if (items.length) {
        const inv: any = await stripe.invoices.createPreview({
          customer: sub.customer,
          subscription: sub.id,
          subscription_details: { items, proration_behavior: 'create_prorations' },
        })
        amountDue = (inv.amount_due ?? 0) / 100
      }
      return NextResponse.json({ ok: true, preview: true, monthly, amountDue, changed: items.length > 0 || metaChanged })
    }

    if (items.length) {
      await stripe.subscriptions.update(sub.id, { items, proration_behavior: 'create_prorations', metadata })
    } else if (metaChanged) {
      await stripe.subscriptions.update(sub.id, { metadata })
    }

    // Пишем в БД сразу — вебхук customer.subscription.updated подтвердит те же значения.
    const { error: dbErr } = await supabase.from('restaurants').update(nextFields).eq('id', restaurantId)
    if (dbErr) throw new Error(`restaurants update: ${dbErr.message}`)

    return NextResponse.json({ ok: true, monthly })
  } catch (err: any) {
    console.error(err)
    try {
      const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
      await admin.from('app_errors').insert({ source: 'server', message: `stripe/update: ${err.message}`, stack: err.stack?.slice(0, 4000) })
    } catch {}
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
