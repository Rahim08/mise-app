// Guest order creation. Resolves the restaurant from the slug server-side (never trusts a
// client-supplied restaurant_id) and only allows orders on a published, orders-enabled menu.
//
// Returns the created order id and accepts tip / order_type — this is the stable contract
// that a future Mise POS sync will consume (see docs/integrations/mise-pos.md).
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { checkRateLimit, rateLimitKey } from '@/lib/rateLimit'
import { itemAvailableNow } from '@/lib/menu'
import { createHash } from 'crypto'

type Admin = any

// Номер стола приходит из публичной QR-ссылки — чистим и режем так же, как в
// /api/menu/event, иначе в инбокс персонала прилетает произвольная строка гостя.
function cleanTable(v: unknown): string | null {
  if (v == null) return null
  const s = String(v).replace(/[^0-9a-zA-Zа-яА-Я-]/g, '').slice(0, 10)
  return s || null
}

function money(v: number) { return Math.round(v * 100) / 100 }

// Списание остатка (стоп-лист по количеству). Пишем через compare-and-swap: обновляем
// строку, только если в БД всё ещё лежит прочитанное значение — два гостя за одним столом
// не уведут остаток в минус. Возврат false = остатка не хватило.
async function decStock(admin: Admin, id: string, qty: number): Promise<boolean> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data: row } = await admin.from('menu_items').select('stock_left').eq('id', id).maybeSingle()
    const left = (row as any)?.stock_left
    if (left == null) return true            // остаток по этой позиции не ведётся
    if (left < qty) return false
    const { data: upd } = await admin.from('menu_items')
      .update({ stock_left: left - qty }).eq('id', id).eq('stock_left', left).select('id')
    if (upd && upd.length > 0) return true   // 0 строк = кто-то успел раньше, перечитываем
  }
  return false
}

// Возврат остатка, если заказ в итоге не записался. Best-effort: если и это не удалось,
// хуже всего — позиция раньше времени уйдёт в стоп-лист (деньги не затронуты).
async function incStock(admin: Admin, id: string, qty: number) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data: row } = await admin.from('menu_items').select('stock_left').eq('id', id).maybeSingle()
    const left = (row as any)?.stock_left
    if (left == null) return
    const { data: upd } = await admin.from('menu_items')
      .update({ stock_left: left + qty }).eq('id', id).eq('stock_left', left).select('id')
    if (upd && upd.length > 0) return
  }
}

export async function POST(req: NextRequest) {
  const rlKey = rateLimitKey(req, 'menu-order')
  if (!await checkRateLimit(rlKey, 30, 60_000)) return NextResponse.json({ error: 'Rate limit' }, { status: 429 })
  const { slug, items, tip, order_type, table_number, type } = await req.json()
  // Быстрые действия — вызов без позиций заказа, кодируются маркером в items
  // (см. комментарий у menu_orders.insert ниже). 'waiter_call' — старое имя типа
  // 'waiter', оставлено для обратной совместимости со старыми клиентами меню.
  const CALL_TYPES: Record<string, string> = { waiter_call: 'waiter', coal_call: 'coal', water_call: 'water' }
  const callKind = CALL_TYPES[type as string]
  const isCall = !!callKind
  if (!slug || (!isCall && (!Array.isArray(items) || items.length === 0))) {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 })
  }

  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  // Resolve the menu (multi-menu first, legacy menu_settings fallback).
  let restaurantId: string | null = null
  let menuId: string | null = null
  let published = false
  let allowOrders = false
  const { data: menu } = await admin
    .from('menus').select('id, restaurant_id, is_published, allow_orders').eq('slug', slug).maybeSingle()
  if (menu) {
    restaurantId = menu.restaurant_id; menuId = menu.id
    published = menu.is_published; allowOrders = menu.allow_orders
  } else {
    const { data: legacy } = await admin
      .from('menu_settings').select('restaurant_id, is_published, allow_orders').eq('slug', slug).maybeSingle()
    if (legacy) { restaurantId = legacy.restaurant_id; published = legacy.is_published; allowOrders = legacy.allow_orders }
  }

  if (!restaurantId || !published || !allowOrders) {
    return NextResponse.json({ error: 'Orders not available' }, { status: 403 })
  }

  // QR-меню — с тарифа Business (или comp_apps от супер-админа) + активная подписка
  const { data: rest } = await admin.from('restaurants').select('subscription_plan, subscription_status, comp_apps').eq('id', restaurantId).single()
  const subActive = ['active', 'trialing', 'canceling'].includes(rest?.subscription_status)
  if (!subActive || (!['business', 'pro'].includes(rest?.subscription_plan) && !(rest?.comp_apps || []).includes('menu'))) {
    return NextResponse.json({ error: 'Orders not available' }, { status: 403 })
  }

  // Дедупликация: гость дважды тапнул «Заказать» на медленной сети, или клиент
  // ретраит после таймаута — без client-generated id ловим это по хешу содержимого
  // заказа в узком окне; не идеально против всех паттернов ретраев, но закрывает
  // реалистичный кейс двойного тапа (аудит-находка E4) без миграции схемы.
  const dedupeSeed = isCall
    ? `call:${callKind}:${cleanTable(table_number) || ''}`
    : `items:${(Array.isArray(items) ? items : []).map((r: any) => `${r?.id}:${Math.floor(Number(r?.qty)) || 0}:${JSON.stringify(r?.opts || [])}`).sort().join(',')}:${cleanTable(table_number) || ''}:${Number(tip) || 0}`
  const dedupeBucket = Math.floor(Date.now() / 8000)
  const dedupeKey = 'menu-order-dedupe:' + createHash('sha1').update(`${restaurantId}:${dedupeSeed}:${dedupeBucket}`).digest('hex')
  if (!await checkRateLimit(dedupeKey, 1, 8_000)) {
    return NextResponse.json({ error: 'Duplicate order — already submitted' }, { status: 429 })
  }

  // ── Пересчёт заказа НА СЕРВЕРЕ ───────────────────────────────────────────────
  // Гость аноним, поэтому его price/total/tip доверять нельзя: подделанный запрос
  // ({name:"Dom Pérignon", price:0} или tip:-500) уходил персоналу как настоящий заказ.
  // Цены, названия и состав берём из menu_items этого меню, клиентский total игнорируем.
  const safeItems: { id: string; name: string; price: number; qty: number; opts?: string[] }[] = []
  let subtotal = 0
  let safeTip = 0
  const decremented: { id: string; qty: number }[] = []

  if (!isCall) {
    const rows = (items as any[]).slice(0, 100)
    const ids = [...new Set(rows.map(r => String(r?.id || '')).filter(Boolean))]
    if (ids.length === 0) return NextResponse.json({ error: 'Bad request' }, { status: 400 })

    const q = admin.from('menu_items')
      .select('id, name, price, modifiers, is_visible, is_available, stock_left, schedule').in('id', ids)
    // Фильтр тот же, что в /api/menu/[slug]: позиция обязана принадлежать этому меню
    // (или ресторану — для легаси-меню без menus-строки).
    const { data: dbItems, error: itemsErr } = menuId ? await q.eq('menu_id', menuId) : await q.eq('restaurant_id', restaurantId)
    if (itemsErr) return NextResponse.json({ error: itemsErr.message }, { status: 400 })
    const byId = new Map<string, any>((dbItems || []).map((i: any) => [i.id, i]))

    // Складываем количества по (позиция + модификаторы): дубли строк в запросе не должны
    // обходить проверку остатка.
    const merged = new Map<string, { db: any; qty: number; opts: string[]; unit: number }>()
    for (const r of rows) {
      const dbItem = byId.get(String(r?.id || ''))
      // Позиция не из этого меню / скрыта / недоступна / вне расписания (dayparting) —
      // отклоняем заказ целиком, чтобы гость не получил молча урезанный счёт. Расписание
      // проверялось только на клиенте (аудит-находка E1) — прямой POST мог обойти его.
      // `new Date()` тут — то же серверное "сейчас" по локальным часам, что клиент уже
      // использует в app/menu/[slug]/page.tsx (itemAvailableNow не завязан на TZ ресторана).
      if (!dbItem || !dbItem.is_visible || !dbItem.is_available || !itemAvailableNow(dbItem.schedule, new Date())) {
        return NextResponse.json({ error: 'Item unavailable' }, { status: 400 })
      }
      const qty = Math.floor(Number(r?.qty))
      if (!Number.isFinite(qty) || qty < 1 || qty > 99) {
        return NextResponse.json({ error: 'Bad quantity' }, { status: 400 })
      }
      // Модификаторы сверяем по имени с карточкой позиции, цену опции берём из БД.
      const rawOpts: unknown[] = Array.isArray(r?.opts) ? r.opts.slice(0, 10) : []
      const opts: string[] = []
      let optsPrice = 0
      for (const o of rawOpts) {
        const name = typeof o === 'string' ? o : (o as any)?.name
        if (typeof name !== 'string') return NextResponse.json({ error: 'Bad modifier' }, { status: 400 })
        const found = ((dbItem.modifiers || []) as any[])
          .flatMap(g => (g?.options || []) as any[]).find(x => x?.name === name)
        if (!found) return NextResponse.json({ error: 'Bad modifier' }, { status: 400 })
        optsPrice += Number(found.price) || 0
        opts.push(name)
      }
      const unit = money((Number(dbItem.price) || 0) + optsPrice)
      const key = dbItem.id + '|' + opts.join(',')
      const prev = merged.get(key)
      if (prev) prev.qty += qty
      else merged.set(key, { db: dbItem, qty, opts, unit })
    }

    for (const e of merged.values()) {
      if (e.db.stock_left != null && e.db.stock_left < e.qty) {
        return NextResponse.json({ error: 'Item unavailable' }, { status: 409 })
      }
      subtotal += e.unit * e.qty
      safeItems.push({ id: e.db.id, name: e.db.name, price: e.unit, qty: e.qty, ...(e.opts.length ? { opts: e.opts } : {}) })
    }
    subtotal = money(subtotal)

    // Чаевые: только неотрицательные. Гость может тайпнуть больше суммы счёта (обычное
    // дело на маленьких чеках) — капим только разумным потолком против опечаток, не
    // суммой заказа (аудит-находка E10: капа по subtotal обрезала легитимные чаевые).
    const tipNum = Number(tip)
    safeTip = Number.isFinite(tipNum) && tipNum > 0 ? money(Math.min(tipNum, subtotal * 5 + 500)) : 0

    // Остаток списываем ДО записи заказа — иначе стоп-лист можно обойти параллельными
    // запросами. Если списать не удалось, возвращаем уже списанное обратно.
    for (const e of merged.values()) {
      const ok = await decStock(admin, e.db.id, e.qty)
      if (!ok) {
        for (const d of decremented) await incStock(admin, d.id, d.qty)
        return NextResponse.json({ error: 'Item unavailable' }, { status: 409 })
      }
      decremented.push({ id: e.db.id, qty: e.qty })
    }
  }

  // Быстрые действия кодируются маркером в items — без изменения схемы menu_orders.
  const { data, error } = await admin.from('menu_orders').insert({
    restaurant_id: restaurantId,
    menu_id: menuId,
    items: isCall ? [{ call: callKind }] : safeItems,
    total: isCall ? 0 : subtotal,
    tip: isCall ? 0 : safeTip,
    order_type: order_type === 'pickup' ? 'pickup' : 'dine_in',
    source: 'qr',
    table_number: cleanTable(table_number),
    status: 'new',
  }).select('id').single()
  if (error) {
    for (const d of decremented) await incStock(admin, d.id, d.qty)
    return NextResponse.json({ error: error.message }, { status: 400 })
  }
  return NextResponse.json({ ok: true, id: data?.id, total: subtotal, tip: safeTip })
}
