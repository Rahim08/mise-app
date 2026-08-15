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

  const { data: restaurant, error: restaurantError } = await supabaseAdmin
    .from('restaurants')
    .select('id, subscription_id, stripe_customer_id')
    .eq('owner_id', user.id)
    .single()

  if (restaurantError && restaurantError.code !== 'PGRST116') {
    return NextResponse.json({ error: 'step:fetch_restaurant', detail: restaurantError.message }, { status: 500 })
  }

  if (restaurant) {
    // Cancel Stripe subscription immediately so billing stops
    if (restaurant.subscription_id && process.env.STRIPE_SECRET_KEY) {
      try {
        const Stripe = (await import('stripe')).default
        const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)
        await stripe.subscriptions.cancel(restaurant.subscription_id)
      } catch (err: any) {
        console.error('Stripe cancel on delete failed:', err)
        // Deletion proceeds regardless (owner asked to delete their account, don't block
        // on a Stripe hiccup) — but without this, the subscription+customer id is only
        // in Vercel logs and nothing surfaces it for manual reconciliation/refund once
        // the restaurants row is gone (аудит 2026-08-15, block-F #5).
        try {
          await supabaseAdmin.from('app_errors').insert({
            source: 'server',
            message: `account/delete: orphaned Stripe subscription ${restaurant.subscription_id} (customer ${restaurant.stripe_customer_id ?? 'unknown'}) for restaurant ${restaurant.id} — cancel failed: ${err.message}`,
            stack: err.stack?.slice(0, 4000),
          })
        } catch {}
      }
    }

    const rid = restaurant.id

    // Single Postgres function call = one implicit transaction (atomic rollback on any
    // failure). See docs/migrations/account-delete-atomic-2026-07.sql for the table list.
    const { error: deleteError } = await supabaseAdmin.rpc('delete_restaurant_account', {
      p_restaurant_id: rid, p_user_id: user.id,
    })
    if (deleteError) {
      return NextResponse.json({ error: 'step:delete_restaurant_account', detail: deleteError.message }, { status: 500 })
    }
  } else {
    await supabaseAdmin.from('profiles').delete().eq('id', user.id)
  }

  const { error } = await supabaseAdmin.auth.admin.deleteUser(user.id)
  if (error) return NextResponse.json({ error: 'step:delete_auth_user', detail: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}
