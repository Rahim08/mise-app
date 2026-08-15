import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendPaymentReceiptEmail } from '@/lib/email'

// Stripe moved current_period_end onto subscription items in newer API versions.
// Read item-level first, fall back to the (legacy) top-level field, never crash on Invalid Date.
// Биллинг v2: аддоны/интервал живут в metadata подписки (пишется checkout-ом и
// /api/stripe/update). Из metadata → колонки restaurants.
function entitlementFields(md: any): Record<string, any> {
  if (!md) return {}
  return {
    ...(md.plan ? { subscription_plan: md.plan } : {}),
    ...('addon_modules' in md ? { addon_modules: String(md.addon_modules || '').split(',').filter(Boolean) } : {}),
    ...('extra_seats' in md ? { extra_seats: parseInt(md.extra_seats) || 0 } : {}),
    ...('addon_ai' in md ? { addon_ai: md.addon_ai === '1' } : {}),
    ...(md.interval ? { billing_interval: md.interval } : {}),
  }
}

function periodEndISO(sub: any): string | null {
  const ts = sub?.items?.data?.[0]?.current_period_end ?? sub?.current_period_end
  if (!ts || typeof ts !== 'number') return null
  return new Date(ts * 1000).toISOString()
}

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

    // Дедуп ретраев Stripe двухфазно: строка stripe_events — ЗАЯВКА на обработку (PK по event_id),
    // и она остаётся в таблице только если обработка дошла до конца.
    // Почему так: раньше строка вставлялась ДО обработки и никогда не снималась — любой сбой
    // (сеть, ошибка записи в БД) отвечал 500, Stripe ретраил, insert падал с 23505, и мы
    // возвращали received:true БЕЗ обработки. Оплаченный checkout.session.completed терялся
    // навсегда: клиент заплатил, а подписка в БД не появилась.
    // До применения миграции stripe-events-2026-07.sql таблицы нет — тогда работаем без дедупа, вебхук не роняем.
    const { error: dupErr } = await supabase.from('stripe_events').insert({ event_id: event.id })
    if (dupErr && dupErr.code === '23505') return NextResponse.json({ received: true, duplicate: true })
    const claimed = !dupErr
    if (dupErr) console.error('[stripe-webhook] stripe_events insert failed (no dedup):', dupErr.message)

    // Снимаем заявку при сбое: следующий ретрай Stripe реально повторит работу.
    // Повторная УСПЕШНАЯ доставка того же события по-прежнему отсекается (строка на месте).
    const releaseClaim = async () => {
      if (!claimed) return
      const { error } = await supabase.from('stripe_events').delete().eq('event_id', event.id)
      if (error) console.error('[stripe-webhook] release claim failed:', error.message)
    }

    try {
      return await handleEvent(stripe, supabase, event)
    } catch (err) {
      await releaseClaim()
      throw err
    }
  } catch (err: any) {
    console.error(err)
    // В app_errors — иначе ошибка видна только в Vercel-логах
    try {
      const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
      await admin.from('app_errors').insert({ source: 'server', message: `stripe/webhook: ${err.message}`, stack: err.stack?.slice(0, 4000) })
    } catch {}
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

// Вся обработка события отдельной функцией: любой её throw снимает заявку дедупа (см. выше).
//
// Осознанно синхронно, не "ack fast + очередь" (аудит 2026-08-15, block-F #4): без реальной
// очереди (Vercel Queues здесь не подключены) fire-and-forget после return 200 не гарантирует
// докрутку — платформа может заморозить функцию до завершения фоновой работы. Синхронно +
// claim-based дедуп (см. releaseClaim выше) — осознанный компромисс: событие либо полностью
// обработано, либо заявка снята и Stripe ретраит; независимые под-шаги внутри (см. Promise.all
// ниже) распараллелены там, где это безопасно.
async function handleEvent(stripe: any, supabase: any, event: any): Promise<NextResponse> {
  const obj = event.data.object as any

  // Ошибка записи = 500 → Stripe ретраит и показывает сбой в Webhooks-логе.
  // Раньше падение глоталось, а БД оставалась на дефолтах (active/business).
  const updateRestaurant = async (restaurantId: string, fields: Record<string, any>) => {
    const { error } = await supabase.from('restaurants').update(fields).eq('id', restaurantId)
    if (error) throw new Error(`restaurants update (${event.type}): ${error.message}`)
  }

  if (event.type === 'checkout.session.completed') {
    const sub = await stripe.subscriptions.retrieve(obj.subscription)
    const restaurantId = (sub as any).metadata?.restaurantId
    const plan = (sub as any).metadata?.plan
    if (!restaurantId) return NextResponse.json({ received: true })

    const endsAt = periodEndISO(sub)
    await updateRestaurant(restaurantId, {
      subscription_status: (sub as any).status,
      subscription_id: sub.id,
      ...entitlementFields((sub as any).metadata),
      ...(endsAt ? { subscription_ends_at: endsAt } : {}),
    })

    // Отправляем receipt email владельцу
    try {
      const { data: restaurant } = await supabase.from('restaurants').select('owner_id').eq('id', restaurantId).single()
      if (restaurant?.owner_id) {
        const { data: owner } = await supabase.auth.admin.getUserById(restaurant.owner_id)
        const ownerEmail = owner?.user?.email
        if (ownerEmail) {
          const price = obj.amount_total ? `${(obj.amount_total / 100).toFixed(0)} ${(obj.currency || 'usd').toUpperCase()}` : undefined
          await sendPaymentReceiptEmail(ownerEmail, plan || 'Pro', price)
        }
      }
    } catch (err) {
      console.error('[stripe-webhook] Failed to send receipt email:', err)
    }

    // Повторный чекаут (смена плана, дабл-клик, «не увидел подписку — оформил ещё раз»)
    // создаёт ВТОРУЮ подписку у того же customer → двойное списание.
    // Гасим все более старые живые подписки; «старые» — чтобы при ретраях/перестановке
    // событий старый checkout.completed не отменил новую подписку.
    // Независимые отмены — параллельно, а не по очереди (аудит 2026-08-15, block-F #4).
    const siblings = await stripe.subscriptions.list({ customer: (sub as any).customer, status: 'all', limit: 20 })
    const toCancel = siblings.data.filter(o => o.id !== sub.id && o.created < (sub as any).created && ['active', 'trialing', 'past_due'].includes(o.status))
    await Promise.all(toCancel.map(o => stripe.subscriptions.cancel(o.id)))
  }

  // Новые версии Stripe API убрали invoice.subscription с верхнего уровня —
  // он живёт в parent.subscription_details. Без fallback past_due никогда не ставился бы.
  const invoiceSubId = (o: any) => o?.subscription ?? o?.parent?.subscription_details?.subscription ?? null

  if (event.type === 'invoice.payment_succeeded') {
    const subId = invoiceSubId(obj)
    if (!subId) return NextResponse.json({ received: true })
    const sub = await stripe.subscriptions.retrieve(subId) as any
    const restaurantId = sub.metadata?.restaurantId
    if (!restaurantId) return NextResponse.json({ received: true })

    const endsAt = periodEndISO(sub)
    await updateRestaurant(restaurantId, {
      subscription_status: 'active',
      ...(endsAt ? { subscription_ends_at: endsAt } : {}),
    })
  }

  if (event.type === 'invoice.payment_failed') {
    const subId = invoiceSubId(obj)
    if (!subId) return NextResponse.json({ received: true })
    const sub = await stripe.subscriptions.retrieve(subId) as any
    const restaurantId = sub.metadata?.restaurantId
    if (!restaurantId) return NextResponse.json({ received: true })

    await updateRestaurant(restaurantId, { subscription_status: 'past_due' })
  }

  // События отменённого дубля не должны затирать статус текущей подписки ресторана.
  const isCurrentSub = async (restaurantId: string, subId: string) => {
    const { data } = await supabase.from('restaurants').select('subscription_id').eq('id', restaurantId).single()
    return !data?.subscription_id || data.subscription_id === subId
  }

  // Смена плана / окончание триала / реактивация в портале — синхронизируем статус и план.
  if (event.type === 'customer.subscription.updated') {
    const restaurantId = obj.metadata?.restaurantId
    if (!restaurantId) return NextResponse.json({ received: true })
    if (!(await isCurrentSub(restaurantId, obj.id))) return NextResponse.json({ received: true })

    const endsAt = periodEndISO(obj)
    await updateRestaurant(restaurantId, {
      subscription_status: obj.cancel_at_period_end ? 'canceling' : obj.status,
      ...entitlementFields(obj.metadata),
      ...(endsAt ? { subscription_ends_at: endsAt } : {}),
    })
  }

  if (event.type === 'customer.subscription.deleted') {
    const restaurantId = obj.metadata?.restaurantId
    if (!restaurantId) return NextResponse.json({ received: true })
    if (!(await isCurrentSub(restaurantId, obj.id))) return NextResponse.json({ received: true })

    await updateRestaurant(restaurantId, { subscription_status: 'canceled' })
  }

  return NextResponse.json({ received: true })
}
