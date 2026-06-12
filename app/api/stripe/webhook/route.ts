import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

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

    if (event.type === 'checkout.session.completed') {
      const sub = await stripe.subscriptions.retrieve(obj.subscription)
      const restaurantId = (sub as any).metadata?.restaurantId
      const plan = (sub as any).metadata?.plan
      if (!restaurantId) return NextResponse.json({ received: true })

      const endsAt = periodEndISO(sub)
      await supabase.from('restaurants').update({
        subscription_status: (sub as any).status,
        subscription_plan: plan,
        subscription_id: sub.id,
        ...(endsAt ? { subscription_ends_at: endsAt } : {}),
      }).eq('id', restaurantId)
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
      await supabase.from('restaurants').update({
        subscription_status: 'active',
        ...(endsAt ? { subscription_ends_at: endsAt } : {}),
      }).eq('id', restaurantId)
    }

    if (event.type === 'invoice.payment_failed') {
      const subId = invoiceSubId(obj)
      if (!subId) return NextResponse.json({ received: true })
      const sub = await stripe.subscriptions.retrieve(subId) as any
      const restaurantId = sub.metadata?.restaurantId
      if (!restaurantId) return NextResponse.json({ received: true })

      await supabase.from('restaurants').update({
        subscription_status: 'past_due',
      }).eq('id', restaurantId)
    }

    // Смена плана / окончание триала / реактивация в портале — синхронизируем статус и план.
    if (event.type === 'customer.subscription.updated') {
      const restaurantId = obj.metadata?.restaurantId
      if (!restaurantId) return NextResponse.json({ received: true })

      const endsAt = periodEndISO(obj)
      await supabase.from('restaurants').update({
        subscription_status: obj.cancel_at_period_end ? 'canceling' : obj.status,
        ...(obj.metadata?.plan ? { subscription_plan: obj.metadata.plan } : {}),
        ...(endsAt ? { subscription_ends_at: endsAt } : {}),
      }).eq('id', restaurantId)
    }

    if (event.type === 'customer.subscription.deleted') {
      const restaurantId = obj.metadata?.restaurantId
      if (!restaurantId) return NextResponse.json({ received: true })

      await supabase.from('restaurants').update({
        subscription_status: 'canceled',
      }).eq('id', restaurantId)
    }

    return NextResponse.json({ received: true })
  } catch (err: any) {
    console.error(err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
