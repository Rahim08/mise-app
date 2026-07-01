import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { verifyOwner } from '@/lib/stripeAuth'

// Stripe Billing Portal — пользователь управляет картой, инвойсами и подпиской
// без прямого доступа к Stripe Dashboard.
export async function POST(req: NextRequest) {
  try {
    const { restaurantId } = await req.json()
    const auth = await verifyOwner(req, restaurantId)
    if (!auth.ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
    const { data } = await supabase
      .from('restaurants')
      .select('stripe_customer_id')
      .eq('id', restaurantId)
      .single()

    if (!data?.stripe_customer_id) {
      return NextResponse.json({ error: 'Нет платёжного профиля — сначала оформите подписку' }, { status: 400 })
    }

    const Stripe = (await import('stripe')).default
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)

    const session = await stripe.billingPortal.sessions.create({
      customer: data.stripe_customer_id,
      return_url: `${req.nextUrl.origin}/dashboard?tab=billing`,
    })

    return NextResponse.json({ url: session.url })
  } catch (err: any) {
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
