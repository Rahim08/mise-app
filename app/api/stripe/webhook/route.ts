// @ts-nocheck
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

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

      const endsAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
      await supabase.from('restaurants').update({
        subscription_status: (sub as any).status,
        subscription_plan: plan,
        subscription_id: sub.id,
        subscription_ends_at: endsAt,
      }).eq('id', restaurantId)
    }

    if (event.type === 'invoice.payment_succeeded') {
      const subId = obj.subscription
      if (!subId) return NextResponse.json({ received: true })
      const sub = await stripe.subscriptions.retrieve(subId) as any
      const restaurantId = sub.metadata?.restaurantId
      if (!restaurantId) return NextResponse.json({ received: true })

      const endsAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
      await supabase.from('restaurants').update({
        subscription_status: 'active',
        subscription_ends_at: endsAt,
      }).eq('id', restaurantId)
    }

    if (event.type === 'invoice.payment_failed') {
      const subId = obj.subscription
      if (!subId) return NextResponse.json({ received: true })
      const sub = await stripe.subscriptions.retrieve(subId) as any
      const restaurantId = sub.metadata?.restaurantId
      if (!restaurantId) return NextResponse.json({ received: true })

      await supabase.from('restaurants').update({
        subscription_status: 'past_due',
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
