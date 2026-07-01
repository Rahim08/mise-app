import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendPaymentReceiptEmail } from '@/lib/email'

// Stripe moved current_period_end onto subscription items in newer API versions.
// Read item-level first, fall back to the (legacy) top-level field, never crash on Invalid Date.
function periodEndISO(sub: any): string | null {
  const ts = sub?.items?.data?.[0]?.current_period_end ?? sub?.current_period_end
  if (!ts || typeof ts !== 'number') return null
  return new Date(ts * 1000).toISOString()
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.text()
    const sig = req.headers.get('stripe-signature')!

    const Stripe = (await import('stripe')).default
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)

    let event: any
    try {
      event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET!)
    } catch (err: any) {
      return NextResponse.json({ error: `Webhook error: ${err.message}` }, { status: 400 })
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    const obj = event.data.object as any

    // Ошибка записи = 500 → Stripe ретраит и показывает сбой в Webhooks-логе.
    // Раньше падение глоталось, а БД оставалась на дефолтах (active/business).
    const updateRestaurant = async (restaurantId: string, fields: Record<string, any>) => {
      const { error } = await supabase.from('restaurants').update(fields).eq('id', restaurantId)
      if (error) throw new Error(`restaurants update (${event.type}): ${error.message}`)
    }

    if (event.type === 'checkout.session.completed') {
      const sub = await stripe.subscriptions.retrieve(obj.subscription)
      const restaurantId = (sub as any).metadata?.restaurantId
      const plan = (sub as any).metadata?.plan
      if (!restaurantId) return NextResponse.json({ received: true })

      const endsAt = periodEndISO(sub)
      await updateRestaurant(restaurantId, {
        subscription_status: (sub as any).status,
        subscription_plan: plan,
        subscription_id: sub.id,
        ...(endsAt ? { subscription_ends_at: endsAt } : {}),
      })

      // Отправляем receipt email владельцу
      try {
        const { data: owner } = await supabase.auth.admin.getUserById(restaurantId)
        const ownerEmail = owner?.user?.email
        if (ownerEmail) {
          const price = obj.amount_total ? `${(obj.amount_total / 100).toFixed(0)} ${(obj.currency || 'usd').toUpperCase()}` : undefined
          await sendPaymentReceiptEmail(ownerEmail, plan || 'Pro', price)
        }
      } catch {}

      // Повторный чекаут (смена плана, дабл-клик, «не увидел подписку — оформил ещё раз»)
      // создаёт ВТОРУЮ подписку у того же customer → двойное списание.
      // Гасим все более старые живые подписки; «старые» — чтобы при ретраях/перестановке
      // событий старый checkout.completed не отменил новую подписку.
      const siblings = await stripe.subscriptions.list({ customer: (sub as any).customer, status: 'all', limit: 20 })
      for (const o of siblings.data) {
        if (o.id !== sub.id && o.created < (sub as any).created && ['active', 'trialing', 'past_due'].includes(o.status)) {
          await stripe.subscriptions.cancel(o.id)
        }
      }
    }

    // Новые версии Stripe API убрали invoice.subscription с верхнего уровня —
    // он живёт в parent.subscription_details. Без fallback past_due никогда не ставился бы.
    const invoiceSubId = (o: any) => o?.subscription ?? o?.parent?.subscription_details?.subscription ?? null

    if (event.type === 'invoice.payment_succeeded') {
      const subId = invoiceSubId(obj)
      if (!subId) return NextResponse.json({ received: true })
      const sub = await stripe.subscriptions.retrieve(subId) as any
      const restaurantId = sub.metadata?.restaurantId
      if (!restaurantId) return NextResponse.json({ received: true })

      const endsAt = periodEndISO(sub)
      await updateRestaurant(restaurantId, {
        subscription_status: 'active',
        ...(endsAt ? { subscription_ends_at: endsAt } : {}),
      })
    }

    if (event.type === 'invoice.payment_failed') {
      const subId = invoiceSubId(obj)
      if (!subId) return NextResponse.json({ received: true })
      const sub = await stripe.subscriptions.retrieve(subId) as any
      const restaurantId = sub.metadata?.restaurantId
      if (!restaurantId) return NextResponse.json({ received: true })

      await updateRestaurant(restaurantId, { subscription_status: 'past_due' })
    }

    // События отменённого дубля не должны затирать статус текущей подписки ресторана.
    const isCurrentSub = async (restaurantId: string, subId: string) => {
      const { data } = await supabase.from('restaurants').select('subscription_id').eq('id', restaurantId).single()
      return !data?.subscription_id || data.subscription_id === subId
    }

    // Смена плана / окончание триала / реактивация в портале — синхронизируем статус и план.
    if (event.type === 'customer.subscription.updated') {
      const restaurantId = obj.metadata?.restaurantId
      if (!restaurantId) return NextResponse.json({ received: true })
      if (!(await isCurrentSub(restaurantId, obj.id))) return NextResponse.json({ received: true })

      const endsAt = periodEndISO(obj)
      await updateRestaurant(restaurantId, {
        subscription_status: obj.cancel_at_period_end ? 'canceling' : obj.status,
        ...(obj.metadata?.plan ? { subscription_plan: obj.metadata.plan } : {}),
        ...(endsAt ? { subscription_ends_at: endsAt } : {}),
      })
    }

    if (event.type === 'customer.subscription.deleted') {
      const restaurantId = obj.metadata?.restaurantId
      if (!restaurantId) return NextResponse.json({ received: true })
      if (!(await isCurrentSub(restaurantId, obj.id))) return NextResponse.json({ received: true })

      await updateRestaurant(restaurantId, { subscription_status: 'canceled' })
    }

    return NextResponse.json({ received: true })
  } catch (err: any) {
    console.error(err)
    // В app_errors — иначе ошибка видна только в Vercel-логах
    try {
      const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
      await admin.from('app_errors').insert({ source: 'server', message: `stripe/webhook: ${err.message}`, stack: err.stack?.slice(0, 4000) })
    } catch {}
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
