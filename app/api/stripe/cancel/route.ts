import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { createClient } from '@supabase/supabase-js'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)

export async function POST(req: NextRequest) {
  const { restaurantId } = await req.json()

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data } = await supabase
    .from('restaurants')
    .select('subscription_id')
    .eq('id', restaurantId)
    .single()

  if (!data?.subscription_id) {
    return NextResponse.json({ error: 'No subscription' }, { status: 400 })
  }

  await stripe.subscriptions.update(data.subscription_id, { cancel_at_period_end: true })

  return NextResponse.json({ success: true })
}
