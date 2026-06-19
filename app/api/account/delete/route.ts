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
      }
    }

    const rid = restaurant.id

    // Explicit deletion order mirrors demo-seed.sql — not all tables have ON DELETE CASCADE
    const tables = [
      'hookah_sales', 'tobacco_movements', 'tobacco_stock',
      'shift_expenses', 'shift_absences', 'inkassations',
      'monthly_card_amounts', 'attendance_records', 'staff_schedules',
      'notifications', 'menu_orders', 'menu_items', 'menu_categories',
      'menu_settings', 'expense_categories', 'hookah_types',
      'shifts', 'staff', 'employees', 'restaurant_settings',
    ]
    for (const table of tables) {
      const { error } = await supabaseAdmin.from(table).delete().eq('restaurant_id', rid)
      if (error) return NextResponse.json({ error: `step:delete_${table}`, detail: error.message }, { status: 500 })
    }

    // profiles has no CASCADE on restaurant_id
    const { error: profilesError } = await supabaseAdmin
      .from('profiles')
      .delete()
      .or(`id.eq.${user.id},restaurant_id.eq.${rid}`)
    if (profilesError) {
      return NextResponse.json({ error: 'step:delete_profiles', detail: profilesError.message }, { status: 500 })
    }

    const { error: restaurantDeleteError } = await supabaseAdmin
      .from('restaurants')
      .delete()
      .eq('id', rid)
    if (restaurantDeleteError) {
      return NextResponse.json({ error: 'step:delete_restaurant', detail: restaurantDeleteError.message }, { status: 500 })
    }
  } else {
    await supabaseAdmin.from('profiles').delete().eq('id', user.id)
  }

  const { error } = await supabaseAdmin.auth.admin.deleteUser(user.id)
  if (error) return NextResponse.json({ error: 'step:delete_auth_user', detail: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}
