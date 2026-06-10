// @ts-nocheck
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

const PLANS: Record<string, { priceId: string }> = {
  starter:  { priceId: 'price_1TgTbgQ50dEzENhL18edUbx7' },
  business: { priceId: 'price_1TgTbyQ50dEzENhLp5BWqzIr' },
  pro:      { priceId: 'price_1TgTcJQ50dEzENhLsmEHWwvL' },
}

export async function POST(req: NextRequest) {
  try {
    const { plan, restaurantId, userId, email } = await req.json()
    const planData = PLANS[plan]
    if (!planData) return NextResponse.json({ error: 'Invalid plan' }, { status: 400 })

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
      await supabase.from('restaurants').update({ stripe_customer_id: customerId }).eq('id', restaurantId)
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      mode: 'subscription',
      line_items: [{ price: planData.priceId, quantity: 1 }],
      subscription_data: {
        trial_period_days: 7,
        metadata: { restaurantId, plan },
      },
      success_url: "https://mise-app-omega.vercel.app/dashboard?tab=billing&success=1",
      cancel_url: "https://mise-app-omega.vercel.app/dashboard?tab=billing",
    })

    return NextResponse.json({ url: session.url })
  } catch (err: any) {
    console.error(err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
