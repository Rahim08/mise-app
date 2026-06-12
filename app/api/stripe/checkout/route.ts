import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { verifyOwner } from '@/lib/stripeAuth'

const PLANS: Record<string, { priceId: string }> = {
  starter:  { priceId: 'price_1TgTbgQ50dEzENhL18edUbx7' },
  business: { priceId: 'price_1TgTbyQ50dEzENhLp5BWqzIr' },
  pro:      { priceId: 'price_1TgTcJQ50dEzENhLsmEHWwvL' },
}

export async function POST(req: NextRequest) {
  try {
    const { plan, restaurantId } = await req.json()
    const planData = PLANS[plan]
    if (!planData) return NextResponse.json({ error: 'Invalid plan' }, { status: 400 })

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
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
