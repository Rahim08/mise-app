import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { createClient } from '@supabase/supabase-js'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-06-20' })
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!

const PLAN_BY_PRICE: Record<string, string> = {
  'price_1TgTbgQ50dEzENhL18edUbx7': 'starter',
  'price_1TgTbyQ50dEzENhLp5BWqzIr': 'business',
  'price_1TgTcJQ50dEzENhLsmEHWwvL': 'pro',
}

export async function POST(req: NextRequest) {
  const body = await req.text()
  const sig = req.headers.get('stripe-signature')!

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(body, sig, webhookSecret)
  } catch (err: any) {
    return NextResponse.json({ error: `Webhook error: ${err.message}` }, { status: 400 })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session
      const sub = await stripe.subscriptions.retrieve(session.subscription as string)
      const restaurantId = sub.metadata?.restaurantId
      const plan = sub.metadata?.plan
      if (!restaurantId) break

      await supabase.from('restaurants').update({
        subscription_status: sub.status,
        subscription_plan: plan,
        subscription_id: sub.id,
        subscription_ends_at: new Date((sub.current_period_end) * 1000).toISOString(),
      }).eq('id', restaurantId)
      break
    }

    case 'invoice.payment_succeeded': {
      const invoice = event.data.object as Stripe.Invoice
      const subId = invoice.subscription as string
      if (!subId) break
      const sub = await stripe.subscriptions.retrieve(subId)
      const restaurantId = sub.metadata?.restaurantId
      if (!restaurantId) break

      await supabase.from('restaurants').update({
        subscription_status: 'active',
        subscription_ends_at: new Date(sub.current_period_end * 1000).toISOString(),
      }).eq('id', restaurantId)
      break
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object as Stripe.Invoice
      const subId = invoice.subscription as string
      if (!subId) break
      const sub = await stripe.subscriptions.retrieve(subId)
      const restaurantId = sub.metadata?.restaurantId
      if (!restaurantId) break

      await supabase.from('restaurants').update({
        subscription_status: 'past_due',
      }).eq('id', restaurantId)
      break
    }

    case 'customer.subscription.deleted': {
      const sub = event.data.object as Stripe.Subscription
      const restaurantId = sub.metadata?.restaurantId
      if (!restaurantId) break

      await supabase.from('restaurants').update({
        subscription_status: 'canceled',
      }).eq('id', restaurantId)
      break
    }
  }

  return NextResponse.json({ received: true })
}
