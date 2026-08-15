// Super-admin data endpoint. Cross-restaurant by design, so it cannot use the tenant-scoped
// /api/db gateway. Authorizes the single admin account, then uses the service-role key.
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { checkRateLimit, rateLimitKey } from '@/lib/rateLimit'
import { issueAdminViewToken, ADMIN_VIEW_COOKIE_NAME, ADMIN_VIEW_COOKIE_MAXAGE } from '@/lib/staffToken'
import { ALL_MODULES } from '@/lib/plans'

const ADMIN_EMAIL = process.env.ADMIN_EMAIL
if (!ADMIN_EMAIL) console.warn('[admin] ADMIN_EMAIL not set — admin route will be inaccessible')

// Возвращает email админа при успешной проверке (нужен для audit-лога импersонации), иначе null.
async function getAdminEmail(req: NextRequest): Promise<string | null> {
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => req.cookies.getAll(), setAll: () => {} } }
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (user && user.email === ADMIN_EMAIL) return user.email ?? null
  return null
}

export async function POST(req: NextRequest) {
  const rlKey = rateLimitKey(req, 'admin')
  if (!await checkRateLimit(rlKey, 30, 60_000)) return NextResponse.json({ error: 'Rate limit' }, { status: 429 })
  const adminEmail = await getAdminEmail(req)
  if (!adminEmail) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { action, restaurantId, note, status, plan, ends_at, endsAt, compApps, discountPct, staffLimit, aiEnabled, addonModules, extraSeats, addonAI, billingInterval, trialEndsAt } = await req.json()
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  switch (action) {
    case 'list': {
      const { data: rests } = await admin.from('restaurants').select('*').order('created_at', { ascending: false })
      const stats: Record<string, any> = {}
      // Раньше — сериализованный for-loop, O(4N) round-trips один за другим (аудит-находка
      // E8). Гоняем все рестораны параллельно, каждый всё равно ждёт свои 4 запроса.
      await Promise.all((rests || []).map(async r => {
        const [lastShift, shiftsCount, movCount, empCount] = await Promise.all([
          admin.from('shifts').select('opened_at').eq('restaurant_id', r.id).order('opened_at', { ascending: false }).limit(1),
          admin.from('shifts').select('id', { count: 'exact', head: true }).eq('restaurant_id', r.id),
          admin.from('tobacco_movements').select('id', { count: 'exact', head: true }).eq('restaurant_id', r.id),
          admin.from('employees').select('id', { count: 'exact', head: true }).eq('restaurant_id', r.id).eq('is_active', true),
        ])
        stats[r.id] = {
          shifts: shiftsCount.count || 0,
          movements: movCount.count || 0,
          employees: empCount.count || 0,
          lastActive: lastShift.data?.[0]?.opened_at || null,
        }
      }))
      // Owner emails (to identify/contact clients)
      const emails: Record<string, string> = {}
      try {
        const { data: usersData } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
        for (const u of usersData?.users || []) if (u.email) emails[u.id] = u.email
      } catch { /* ignore */ }
      return NextResponse.json({ restaurants: rests || [], stats, emails })
    }
    case 'notes': {
      const { data } = await admin.from('admin_notes').select('*').eq('restaurant_id', restaurantId).order('created_at', { ascending: false })
      return NextResponse.json({ notes: data || [] })
    }
    case 'addNote': {
      if (!note?.trim()) return NextResponse.json({ error: 'Empty note' }, { status: 400 })
      await admin.from('admin_notes').insert({ restaurant_id: restaurantId, note: note.trim() })
      return NextResponse.json({ ok: true })
    }
    case 'updateSub': {
      const { error } = await admin.from('restaurants').update({
        subscription_status: status, subscription_plan: plan, subscription_ends_at: ends_at || null,
      }).eq('id', restaurantId)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ ok: true })
    }
    case 'extendSub': {
      const { error } = await admin.from('restaurants').update({ subscription_ends_at: endsAt, subscription_status: 'active' }).eq('id', restaurantId)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ ok: true })
    }
    case 'perks': {
      // Ручной доступ к приложениям поверх тарифа + скидка (admin-perks-2026-06.sql)
      const { error } = await admin.from('restaurants').update({
        comp_apps: Array.isArray(compApps) ? compApps.filter((a: string) => (ALL_MODULES as string[]).includes(a)) : [],
        discount_pct: Math.max(0, Math.min(100, parseInt(discountPct) || 0)),
      }).eq('id', restaurantId)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ ok: true })
    }
    case 'freeze': {
      const { error } = await admin.from('restaurants').update({ subscription_status: 'frozen' }).eq('id', restaurantId)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ ok: true })
    }
    case 'setStaffLimit': {
      // Лимит сотрудников с реальным доступом к приложениям (staff.apps непустой) —
      // проверяется в /api/db checkStaffPlanLimit. Отдельно от setDeviceLimit выше
      // (тот про привязку устройств, этот — про billable-доступ).
      const sl = staffLimit != null && staffLimit !== '' ? Math.max(1, parseInt(staffLimit) || 1) : null
      const { error } = await admin.from('restaurants').update({ staff_limit: sl }).eq('id', restaurantId)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ ok: true })
    }
    case 'setAddons': {
      // Ручная правка аддонов (биллинг v2). Stripe НЕ трогаем: для платящих клиентов
      // менять состав через дашборд клиента (/api/stripe/update), это — для комп/ручных.
      const { error } = await admin.from('restaurants').update({
        addon_modules: Array.isArray(addonModules) ? addonModules.filter((a: string) => (ALL_MODULES as string[]).includes(a)) : [],
        extra_seats: Math.max(0, Math.min(200, parseInt(extraSeats) || 0)),
        addon_ai: !!addonAI,
        ...(billingInterval === 'month' || billingInterval === 'year' ? { billing_interval: billingInterval } : {}),
      }).eq('id', restaurantId)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ ok: true })
    }
    case 'extendTrial': {
      // Продление DB-триала: двигаем trial_ends_at и subscription_ends_at, статус trialing.
      if (!trialEndsAt) return NextResponse.json({ error: 'Missing trialEndsAt' }, { status: 400 })
      const { error } = await admin.from('restaurants').update({
        trial_ends_at: trialEndsAt, subscription_ends_at: trialEndsAt, subscription_status: 'trialing',
      }).eq('id', restaurantId)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ ok: true })
    }
    case 'setAI': {
      const { error } = await admin.from('restaurants').update({ ai_enabled: !!aiEnabled }).eq('id', restaurantId)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ ok: true })
    }
    case 'impersonate': {
      if (!restaurantId) return NextResponse.json({ error: 'Missing restaurantId' }, { status: 400 })
      const { data: rest } = await admin.from('restaurants').select('id, name').eq('id', restaurantId).single()
      if (!rest) return NextResponse.json({ error: 'Not found' }, { status: 404 })
      // Audit-лог имперсонации (аудит-находка E3/F6: full owner-доступ выдавался без следа,
      // кто и когда). admin_notes без своей колонки under действие/автора — кладём
      // структурированной строкой, читаемо и в существующем UI заметок.
      await admin.from('admin_notes').insert({
        restaurant_id: restaurantId,
        note: `[система] ${adminEmail} открыл дашборд клиента (имперсонация) — ${new Date().toISOString()}`,
      })
      const res = NextResponse.json({ ok: true, name: rest.name })
      res.cookies.set(ADMIN_VIEW_COOKIE_NAME, issueAdminViewToken(restaurantId), {
        httpOnly: true, sameSite: 'lax', secure: true, path: '/', maxAge: ADMIN_VIEW_COOKIE_MAXAGE,
      })
      // Readable companion (mirrors mise_token_until pattern): lets client JS show a
      // "viewing as <client>" banner without exposing the signed token itself.
      res.cookies.set('mise_admin_view_label', rest.name, {
        httpOnly: false, sameSite: 'lax', secure: true, path: '/', maxAge: ADMIN_VIEW_COOKIE_MAXAGE,
      })
      return res
    }
    case 'stopImpersonating': {
      const res = NextResponse.json({ ok: true })
      res.cookies.delete(ADMIN_VIEW_COOKIE_NAME)
      res.cookies.delete('mise_admin_view_label')
      return res
    }
    default:
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  }
}
