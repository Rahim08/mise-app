import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { verifyOwner } from '@/lib/stripeAuth'

export async function POST(req: NextRequest) {
  try {
    const { restaurantId } = await req.json()
    const auth = await verifyOwner(req, restaurantId)
    if (!auth.ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const Stripe = (await import('stripe')).default
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)

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
    // Ошибку записи проверяем явно: иначе в Stripe отмена оформлена, а в БД статус остаётся
    // active — владелец видит «подписка активна» и повторно жмёт «Отменить».
    const { error: dbErr } = await supabase.from('restaurants').update({ subscription_status: 'canceling' }).eq('id', restaurantId)
    if (dbErr) throw new Error(`restaurants update: ${dbErr.message}`)
    return NextResponse.json({ success: true })
  } catch (err: any) {
    console.error(err)
    // В app_errors — иначе ошибка видна только в Vercel-логах (как в checkout/update)
    try {
      const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
      await admin.from('app_errors').insert({ source: 'server', message: `stripe/cancel: ${err.message}`, stack: err.stack?.slice(0, 4000) })
    } catch {}
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
