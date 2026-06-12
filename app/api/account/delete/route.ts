import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'

export async function POST(req: NextRequest) {
  const supabaseAnon = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => req.cookies.getAll(),
        setAll: () => {},
      },
    }
  )

  const { data: { user } } = await supabaseAnon.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data: restaurant } = await supabaseAdmin
    .from('restaurants')
    .select('id, subscription_id, stripe_customer_id')
    .eq('owner_id', user.id)
    .single()

  if (restaurant) {
    // Cancel any active Stripe subscription so billing stops after deletion
    if (restaurant.subscription_id && process.env.STRIPE_SECRET_KEY) {
      try {
        const Stripe = (await import('stripe')).default
        const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)
        await stripe.subscriptions.cancel(restaurant.subscription_id)
      } catch (err) {
        console.error('Stripe cancel on delete failed:', err)
      }
    }
    await supabaseAdmin.from('restaurants').delete().eq('id', restaurant.id)
  }

  const { error } = await supabaseAdmin.auth.admin.deleteUser(user.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}
