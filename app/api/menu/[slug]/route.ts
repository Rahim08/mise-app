// Public guest menu — assembled server-side so the browser never touches the DB with the
// anon key. Returns only published data and safe restaurant fields (no owner_pin / stripe).
//
// Resolves the menu from the `menus` table (multi-menu). Falls back to the legacy
// single `menu_settings` row when no `menus` row exists yet (pre-migration / old data).
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { checkRateLimit, rateLimitKey } from '@/lib/rateLimit'

export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  // Публичный анонимный эндпоинт с несколькими Supabase-запросами на service-role ключе
  // (включая скан menu_events до 3000 строк) — лимит нужен так же, как у соседних
  // event/order/import (аудит-находка E5: этот единственный был без лимита).
  const rlKey = rateLimitKey(req, 'menu-get')
  if (!await checkRateLimit(rlKey, 60, 60_000)) return NextResponse.json({ error: 'Rate limit' }, { status: 429 })

  const { slug } = await params
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  // 1. Prefer the multi-menu model.
  let menuId: string | null = null
  let settings: any = null
  const { data: menu } = await admin
    .from('menus').select('*').eq('slug', slug).eq('is_published', true).maybeSingle()
  if (menu) {
    settings = menu
    menuId = menu.id
  } else {
    // 2. Legacy fallback — single menu_settings row keyed by slug.
    const { data: legacy } = await admin
      .from('menu_settings').select('*').eq('slug', slug).eq('is_published', true).maybeSingle()
    if (!legacy) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    settings = legacy
  }

  const restaurantId = settings.restaurant_id
  const catQ = admin.from('menu_categories').select('*').eq('is_visible', true).order('position')
  const itemQ = admin.from('menu_items').select('*').eq('is_visible', true).order('position')
  // Trending badge: items with the most add_to_cart/order events today. Aggregated in JS
  // (Supabase JS client has no GROUP BY) — row count is bounded, fine for this volume.
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)
  const trendQ = admin.from('menu_events').select('item_id')
    .eq('restaurant_id', restaurantId).in('type', ['order', 'add_to_cart'])
    .not('item_id', 'is', null).gte('created_at', todayStart.toISOString()).limit(3000)
  const [rest, cats, items, trend] = await Promise.all([
    admin.from('restaurants').select('id, name, logo_url, currency, subscription_plan, subscription_status, comp_apps').eq('id', restaurantId).single(),
    menuId ? catQ.eq('menu_id', menuId) : catQ.eq('restaurant_id', restaurantId),
    menuId ? itemQ.eq('menu_id', menuId) : itemQ.eq('restaurant_id', restaurantId),
    menuId ? trendQ.eq('menu_id', menuId) : trendQ,
  ])
  const trendCounts = new Map<string, number>()
  for (const row of trend.data || []) {
    const id = (row as any).item_id as string
    trendCounts.set(id, (trendCounts.get(id) || 0) + 1)
  }
  // Только реально заметные всплески — не шумим бейджем на 1-2 случайных клика.
  const trendingIds = [...trendCounts.entries()].filter(([, n]) => n >= 3).map(([id]) => id)

  // QR-меню — с тарифа Business (или выдано супер-админом через comp_apps) + активная подписка
  const r: any = rest.data
  const subActive = ['active', 'trialing', 'canceling'].includes(r?.subscription_status)
  const menuAllowed = subActive && (['business', 'pro'].includes(r?.subscription_plan) || (r?.comp_apps || []).includes('menu'))
  if (!menuAllowed) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { subscription_plan, subscription_status, comp_apps, ...safeRest } = r || {}
  return NextResponse.json({
    settings,
    menu_id: menuId,
    restaurant: safeRest,
    categories: cats.data || [],
    items: items.data || [],
    trending_ids: trendingIds,
  })
}
