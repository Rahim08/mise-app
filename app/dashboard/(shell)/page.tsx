'use client'
// Обзор — один вопрос экрана: «как дела сегодня?» — касса, кальяны, заказы + максимум 2 аномалии.
// Также редиректит старые ссылки /dashboard?tab=... на новые роуты (categories → settings),
// пронося success=1 (Stripe success_url остаётся /dashboard?tab=billing&success=1).
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { db } from '@/lib/db'
import { useI18n } from '@/lib/i18n'
import { fmtDate as fmtDay } from '@/lib/format'
import { entitlements, isActiveStatus, type ModuleId } from '@/lib/plans'
import { Card, Container, SectionTitle, StatTile, type Tone } from '@/components/ui'
import { useDash } from '@/components/dash/context'

const TAB_ROUTES = ['team', 'notifications', 'settings', 'billing', 'account']

export default function OverviewPage() {
  const { t: tr, locale } = useI18n()
  const router = useRouter()
  const { restaurant } = useDash()

  const [redirecting, setRedirecting] = useState(false)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const t = params.get('tab')
    if (!t) return
    const dest = t === 'categories' ? 'settings' : TAB_ROUTES.includes(t) ? t : ''
    const qs = params.get('success') === '1' ? '?success=1' : ''
    if (dest) { setRedirecting(true); router.replace(`/dashboard/${dest}${qs}`) }
    else history.replaceState(null, '', '/dashboard')
  }, [])

  const cur = restaurant?.currency || '€'
  const status = restaurant?.subscription_status || ''
  const isActive = isActiveStatus(status)
  const ent = entitlements(restaurant)
  const appOk = (id: ModuleId) => isActive && ent.modules.includes(id)

  const [loading, setLoading] = useState(true)
  const [shift, setShift] = useState<any>(null)
  const [hookah, setHookah] = useState({ qty: 0, revenue: 0 })
  const [orders, setOrders] = useState({ total: 0, fresh: 0 })
  const [setup, setSetup] = useState({ hasStaff: false, hasShift: false })
  const [trends, setTrends] = useState<{ cash: number[]; card: number[]; hookah: number[] }>({ cash: [], card: [], hookah: [] })

  useEffect(() => {
    if (!restaurant?.id) return
    let gone = false
    ;(async () => {
      const today = fmtDay(new Date())
      const dayStartISO = new Date(new Date().setHours(0, 0, 0, 0)).toISOString()
      // 14-дневное окно для sparkline-трендов в StatTile (glance-виджет, не полноценная аналитика — та живёт в Analytics).
      const days14 = Array.from({ length: 14 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - (13 - i)); return fmtDay(d) })
      const rangeStart = days14[0]
      const [shiftRes, hookahRes, ordersRes, staffRes, anyShiftRes, histShiftsRes, histHookahRes] = await Promise.all([
        db.from('shifts').select('*').eq('restaurant_id', restaurant.id).eq('date', today).order('opened_at', { ascending: false }).limit(1),
        appOk('stash') ? db.from('hookah_sales').select('quantity, price, is_free, date').eq('date', today) : Promise.resolve({ data: [] }),
        appOk('menu') ? db.from('menu_orders').select('id, status, created_at').gte('created_at', dayStartISO) : Promise.resolve({ data: [] }),
        db.from('employees').select('id').eq('restaurant_id', restaurant.id).eq('is_active', true).limit(1),
        db.from('shifts').select('id').eq('restaurant_id', restaurant.id).limit(1),
        db.from('shifts').select('date, income, income_card').eq('restaurant_id', restaurant.id).gte('date', rangeStart).lte('date', today),
        appOk('stash') ? db.from('hookah_sales').select('date, quantity, price, is_free').gte('date', rangeStart).lte('date', today) : Promise.resolve({ data: [] }),
      ])
      if (gone) return
      setSetup({ hasStaff: (staffRes.data || []).length > 0, hasShift: (anyShiftRes.data || []).length > 0 })
      setShift((shiftRes.data || [])[0] || null)
      const hs = hookahRes.data || []
      setHookah({
        qty: hs.reduce((s: number, r: any) => s + (r.quantity || 0), 0),
        revenue: hs.reduce((s: number, r: any) => s + (r.is_free ? 0 : (r.price || 0) * (r.quantity || 0)), 0),
      })
      const os = ordersRes.data || []
      setOrders({ total: os.length, fresh: os.filter((o: any) => o.status === 'new').length })

      const cashByDate: Record<string, number> = {}; const cardByDate: Record<string, number> = {}
      ;(histShiftsRes.data || []).forEach((s: any) => {
        cashByDate[s.date] = (cashByDate[s.date] || 0) + (s.income || 0)
        cardByDate[s.date] = (cardByDate[s.date] || 0) + (s.income_card || 0)
      })
      const hookahByDate: Record<string, number> = {}
      ;(histHookahRes.data || []).forEach((r: any) => {
        if (r.is_free) return
        hookahByDate[r.date] = (hookahByDate[r.date] || 0) + (r.price || 0) * (r.quantity || 0)
      })
      setTrends({
        cash: days14.map(d => cashByDate[d] || 0),
        card: days14.map(d => cardByDate[d] || 0),
        hookah: days14.map(d => hookahByDate[d] || 0),
      })
      setLoading(false)
    })()
    return () => { gone = true }
  }, [restaurant?.id])

  if (redirecting) return null

  // Аномалии: показываем максимум две, по убыванию важности
  const issues: { key: string; title: string; sub: string; color: string; href?: string }[] = []
  if (status === 'past_due') issues.push({ key: 'pd', title: tr('dash.paymentFailed'), sub: tr('dash.updateCardElseLock'), color: 'var(--danger)', href: '/dashboard/billing' })
  if (!loading && (!shift || shift.status !== 'open')) issues.push({ key: 'sh', title: tr('dash.shiftNotOpen'), sub: tr('dash.managerNotOpenedShift'), color: 'var(--warn)' })
  if (orders.fresh > 0) issues.push({ key: 'or', title: tr('dash.newOrdersN', { n: orders.fresh }), sub: tr('dash.waitingAcceptance'), color: 'var(--accent)', href: '/dashboard/notifications' })
  if (status === 'canceling' && restaurant?.subscription_ends_at) issues.push({ key: 'cn', title: tr('dash.subCancelled'), sub: tr('dash.accessUntilD', { date: new Date(restaurant.subscription_ends_at).toLocaleDateString(locale) }), color: 'var(--warn)', href: '/dashboard/billing' })

  const stats: { key: string; l: string; v: string; tone: Tone; trend?: number[] }[] = [
    { key: 'cash', l: tr('dash.cash'), v: `${cur}${(shift?.income || 0).toLocaleString()}`, tone: 'accent', trend: trends.cash },
    { key: 'card', l: tr('dash.card'), v: `${cur}${(shift?.income_card || 0).toLocaleString()}`, tone: 'ok', trend: trends.card },
    ...(appOk('stash') ? [{ key: 'hookah', l: tr('dash.hookahs'), v: `${hookah.qty} · ${cur}${hookah.revenue.toLocaleString()}`, tone: 'warn' as Tone, trend: trends.hookah }] : []),
    ...(appOk('menu') ? [{ key: 'orders', l: tr('dash.menuOrders'), v: String(orders.total), tone: 'pink' as Tone }] : []),
  ]

  // Шаги настройки: data-driven, ведём до полной активации. Скрываем, когда всё готово.
  const allSteps = [
    { done: true,           label: tr('dash.stepAccount'),     sub: null,                 href: null as string | null },
    { done: isActive,       label: tr('dash.stepActivateSub'), sub: tr('dash.days7free'), href: '/dashboard/billing' },
    { done: setup.hasStaff, label: tr('dash.stepAddStaff'),    sub: tr('dash.givePins'),  href: '/dashboard/team' },
    { done: setup.hasShift, label: tr('dash.stepFirstShift'),  sub: tr('dash.viaManager'), href: '/manager' },
  ]
  const setupDone = allSteps.every(s => s.done)
  const nextStepIdx = allSteps.findIndex(s => !s.done)
  const setupSteps = !loading && !setupDone ? allSteps : null

  return (
    <Container size="normal">
      <SectionTitle title={tr('dash.navOverview')} sub={new Date().toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' })} />

      {/* Onboarding: показывается пока нет активной подписки */}
      {setupSteps && (
        <Card style={{ marginBottom: 16, border: '1px solid var(--accent-soft)', background: 'linear-gradient(135deg,rgba(0,122,255,.05) 0%,rgba(88,86,214,.05) 100%)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <div style={{ fontWeight: 700, fontSize: '.95rem', color: 'var(--tx)' }}>{tr('dash.whereToStart')}</div>
            <div style={{ fontSize: '.72rem', fontWeight: 700, color: 'var(--accent)', background: 'var(--accent-soft)', padding: '3px 10px', borderRadius: 980 }}>
              {allSteps.filter(s => s.done).length} {tr('dash.ofWord')} {allSteps.length}
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {setupSteps.map((step, i) => (
              <button key={i} onClick={step.href && !step.done ? () => router.push(step.href!) : undefined}
                style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderRadius: 12, border: 'none', background: step.done ? 'var(--ok-soft)' : 'var(--surface)', cursor: step.href && !step.done ? 'pointer' : 'default', textAlign: 'left', width: '100%', fontFamily: 'inherit' }}>
                <div style={{ width: 28, height: 28, borderRadius: '50%', background: step.done ? 'var(--ok)' : i === nextStepIdx ? 'var(--accent)' : 'var(--fill)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  {step.done
                    ? <svg width="12" height="10" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 12 10"><path d="M1 5l3.5 3.5L11 1" /></svg>
                    : <span style={{ fontSize: '.72rem', fontWeight: 700, color: i === nextStepIdx ? '#fff' : 'var(--tx3)' }}>{i + 1}</span>}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '.88rem', fontWeight: 600, color: step.done ? 'var(--ok)' : 'var(--tx)' }}>{step.label}</div>
                  {step.sub && <div style={{ fontSize: '.74rem', color: 'var(--tx2)', marginTop: 1 }}>{step.sub}</div>}
                </div>
                {step.href && !step.done && <svg width="7" height="12" fill="none" stroke="var(--tx3)" strokeWidth="2.2" strokeLinecap="round" viewBox="0 0 8 14"><path d="M2 1l6 6-6 6" /></svg>}
              </button>
            ))}
          </div>
        </Card>
      )}

      {loading ? (
        // Скелетоны той же геометрии, что и контент — данные «проявляются», а не грузятся
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10 }}>
          {[0, 1, 2, 3].map(i => <div key={i} style={{ height: 76, borderRadius: 16, background: 'var(--fill)', animation: 'dashPulse 1.2s ease-in-out infinite' }} />)}
        </div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 10, marginBottom: 16 }}>
            {stats.map(it => (
              <StatTile key={it.key} label={it.l} value={it.v} tone={it.tone} trend={it.trend}
                trendFormat={v => `${cur}${Math.round(v).toLocaleString()}`} />
            ))}
          </div>

          {shift?.status === 'open' && (
            <Card style={{ marginBottom: 10, padding: '12px 16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: '.85rem', color: 'var(--tx2)' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--ok)', flexShrink: 0 }} />
                {tr('dash.shiftOpenLine', { v: `${cur}${(shift.closing_balance || 0).toLocaleString()}` })}
              </div>
            </Card>
          )}

          {issues.slice(0, 2).map(it => (
            <Card key={it.key} onClick={it.href ? () => router.push(it.href!) : undefined}
              style={{ marginBottom: 10, padding: '12px 16px', borderLeft: `3px solid ${it.color}` }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: '.88rem', color: 'var(--tx)' }}>{it.title}</div>
                  <div style={{ fontSize: '.78rem', color: 'var(--tx2)', marginTop: 1 }}>{it.sub}</div>
                </div>
                {it.href && <svg width="8" height="14" fill="none" stroke="var(--tx3)" strokeWidth="2.2" strokeLinecap="round" viewBox="0 0 10 18"><path d="M2 1l7 8-7 8" /></svg>}
              </div>
            </Card>
          ))}

          {issues.length === 0 && (
            <Card style={{ padding: '12px 16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: '.85rem', color: 'var(--tx2)' }}>
                <svg width="14" height="12" fill="none" stroke="var(--ok)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 12 10"><path d="M1 5l3.5 3.5L11 1" /></svg>
                {tr('dash.allGood')}
              </div>
            </Card>
          )}
        </>
      )}
    </Container>
  )
}
