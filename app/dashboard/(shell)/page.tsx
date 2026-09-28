'use client'
// Обзор владельца: выручка и смена, операции сегодня, затем действия и проверки.
// Также редиректит старые ссылки /dashboard?tab=... на новые роуты (categories → settings),
// пронося success=1 (Stripe success_url остаётся /dashboard?tab=billing&success=1).
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { db } from '@/lib/db'
import { useI18n } from '@/lib/i18n'
import { fmtDate as fmtDay } from '@/lib/format'
import { entitlements, isActiveStatus, type ModuleId } from '@/lib/plans'
import { Card, Container, Sparkline } from '@/components/ui'
import { useDash } from '@/components/dash/context'
import './overview.css'

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
  const [orders, setOrders] = useState({ total: 0, fresh: 0, oldestNew: '' })
  const [ordersEnabled, setOrdersEnabled] = useState(false)
  const [bookings, setBookings] = useState({ total: 0, waiting: 0 })
  const [lowStock, setLowStock] = useState<{ name: string; quantity: number } | null>(null)
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null)
  const [dataError, setDataError] = useState(false)
  const [showAllIssues, setShowAllIssues] = useState(false)
  const [setup, setSetup] = useState({ hasStaff: false, hasShift: false })
  const [revenueTrend, setRevenueTrend] = useState<number[]>([])
  // Аудиты за 30 дней (ревью В3): владелец видит % выполнения и топ нарушений
  // прямо в Обзоре, не заходя в People → Смены → Проверки.
  const [audits, setAudits] = useState<{ rate: number; top: [string, number][] } | null>(null)

  useEffect(() => {
    if (!restaurant?.id) return
    let gone = false
    ;(async () => {
      try {
      const today = fmtDay(new Date())
      const dayStartISO = new Date(new Date().setHours(0, 0, 0, 0)).toISOString()
      // 14-дневное окно для sparkline-трендов в StatTile (glance-виджет, не полноценная аналитика — та живёт в Analytics).
      const days14 = Array.from({ length: 14 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - (13 - i)); return fmtDay(d) })
      const rangeStart = days14[0]
      const auditsSince = fmtDay(new Date(Date.now() - 30 * 86400000))
      const [shiftRes, hookahRes, ordersRes, menusRes, menuSettingsRes, bookingsRes, stockRes, staffRes, anyShiftRes, histShiftsRes, clRes, cmRes] = await Promise.all([
        db.from('shifts').select('*').eq('restaurant_id', restaurant.id).eq('date', today).order('opened_at', { ascending: false }).limit(1),
        appOk('stash') ? db.from('hookah_sales').select('quantity, price, is_free, date').eq('date', today) : Promise.resolve({ data: [] }),
        appOk('menu') ? db.from('menu_orders').select('id, status, created_at, items').gte('created_at', dayStartISO) : Promise.resolve({ data: [] }),
        appOk('menu') ? db.from('menus').select('allow_orders, is_published') : Promise.resolve({ data: [] }),
        appOk('menu') ? db.from('menu_settings').select('allow_orders').limit(1) : Promise.resolve({ data: [] }),
        appOk('bookings') ? db.from('bookings').select('id, status').eq('booking_date', today) : Promise.resolve({ data: [] }),
        appOk('stash') ? db.from('tobacco_stock').select('flavor_name, brand, flavor, quantity_g, min_quantity_g') : Promise.resolve({ data: [] }),
        db.from('employees').select('id').eq('restaurant_id', restaurant.id).eq('is_active', true).limit(1),
        db.from('shifts').select('id').eq('restaurant_id', restaurant.id).limit(1),
        db.from('shifts').select('date, income, income_card').eq('restaurant_id', restaurant.id).gte('date', rangeStart).lte('date', today),
        appOk('people') ? db.from('shift_checklists').select('id, items') : Promise.resolve({ data: [] }),
        appOk('people') ? db.from('shift_checklist_completions').select('checklist_id, items_state, status, date').gte('date', auditsSince) : Promise.resolve({ data: [] }),
      ])
      if (gone) return
      setDataError([shiftRes, hookahRes, ordersRes, menusRes, menuSettingsRes, bookingsRes, stockRes, staffRes, anyShiftRes, histShiftsRes, clRes, cmRes].some(r => 'error' in r && !!r.error))
      setSetup({ hasStaff: (staffRes.data || []).length > 0, hasShift: (anyShiftRes.data || []).length > 0 })
      setShift((shiftRes.data || [])[0] || null)
      const hs = hookahRes.data || []
      setHookah({
        qty: hs.reduce((s: number, r: any) => s + (r.quantity || 0), 0),
        revenue: hs.reduce((s: number, r: any) => s + (r.is_free ? 0 : (r.price || 0) * (r.quantity || 0)), 0),
      })
      const os = (ordersRes.data || []).filter((o: any) => !Array.isArray(o.items) || !o.items[0]?.call)
      const fresh = os.filter((o: any) => o.status === 'new')
      setOrdersEnabled(appOk('menu') && ((menusRes.data || []).some((m: any) => m.is_published && m.allow_orders) || !!menuSettingsRes.data?.[0]?.allow_orders || fresh.length > 0))
      setOrders({ total: os.length, fresh: fresh.length, oldestNew: fresh.reduce((oldest: string, o: any) => !oldest || o.created_at < oldest ? o.created_at : oldest, '') })
      const bs = (bookingsRes.data || []).filter((b: any) => b.status !== 'cancelled' && b.status !== 'no_show')
      setBookings({ total: bs.length, waiting: bs.filter((b: any) => b.status !== 'arrived').length })
      const low = (stockRes.data || []).filter((s: any) => Number(s.quantity_g || 0) <= Number(s.min_quantity_g ?? 100)).sort((a: any, b: any) => Number(a.quantity_g || 0) - Number(b.quantity_g || 0))[0]
      setLowStock(low ? { name: low.flavor_name || [low.brand, low.flavor].filter(Boolean).join(' ') || tr('dash.tobacco'), quantity: Number(low.quantity_g || 0) } : null)

      const cashByDate: Record<string, number> = {}; const cardByDate: Record<string, number> = {}
      ;(histShiftsRes.data || []).forEach((s: any) => {
        cashByDate[s.date] = (cashByDate[s.date] || 0) + (s.income || 0)
        cardByDate[s.date] = (cardByDate[s.date] || 0) + (s.income_card || 0)
      })
      setRevenueTrend(days14.map(d => (cashByDate[d] || 0) + (cardByDate[d] || 0)))

      // Аудиты (В3): та же логика, что AuditStatsView в People — считаем только
      // завершённые прогоны (done + начатые за прошлые дни), N/A вне знаменателя,
      // fail = нарушение, legacy done = pass. Карточка не показывается, пока данных нет.
      const listItems = new Map<string, any[]>((clRes.data || []).map((l: any) => [
        l.id,
        (Array.isArray(l.items) ? l.items : []).map((x: any) => typeof x === 'string' ? { label: x } : { label: x?.label ?? '' }),
      ]))
      let auTotal = 0, auPass = 0
      const auViolations = new Map<string, number>()
      const finished = (cmRes.data || []).filter((c: any) => c.status === 'done' || (c.status === 'in_progress' && c.date < today))
      for (const c of finished) {
        const items = listItems.get(c.checklist_id)
        if (!items) continue
        const state = Array.isArray(c.items_state) ? c.items_state : []
        items.forEach((it: any, i: number) => {
          const s = typeof state[i] === 'boolean' ? { done: state[i] } : (state[i] || {})
          const eff = s.result ?? (s.done ? 'pass' : null)
          if (eff === 'na') return
          auTotal++
          if (eff === 'pass') auPass++
          else auViolations.set(it.label, (auViolations.get(it.label) || 0) + 1)
        })
      }
      setAudits(auTotal > 0 ? {
        rate: Math.round((auPass / auTotal) * 100),
        top: Array.from(auViolations.entries()).sort((a, b) => b[1] - a[1]).slice(0, 3),
      } : null)
      setUpdatedAt(new Date())
      setLoading(false)
      } catch {
        if (!gone) { setDataError(true); setLoading(false) }
      }
    })()
    return () => { gone = true }
  }, [restaurant?.id])

  if (redirecting) return null

  const money = (value: number) => `${cur}${value.toLocaleString(locale, { maximumFractionDigits: 2 })}`
  const shiftIsOpen = shift?.status === 'open'
  const revenue = Number(shift?.income || 0) + Number(shift?.income_card || 0)
  const orderHref = appOk('people') ? '/dashboard/people?tab=orders' : '/dashboard/notifications'
  const issues: { key: string; title: string; sub: string; href: string; color: string; action: string }[] = []
  if (status === 'past_due') issues.push({ key: 'payment', title: tr('dash.paymentFailed'), sub: tr('dash.updateCardElseLock'), href: '/dashboard/billing', color: 'var(--danger)', action: tr('dash.navBilling') })
  if (!loading && !dataError && !shift) issues.push({ key: 'shift', title: tr('dash.shiftNotOpen'), sub: tr('dash.managerNotOpenedShift'), href: '/dashboard/shifts', color: 'var(--warn)', action: tr('dash.openShift') })
  if (ordersEnabled && orders.fresh > 0) issues.push({ key: 'orders', title: tr('dash.qrOrdersNew', { n: orders.fresh }), sub: orders.oldestNew ? tr('dash.oldestOrderAt', { time: new Date(orders.oldestNew).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }) }) : tr('dash.waitingAcceptance'), href: orderHref, color: 'var(--accent)', action: tr('dash.viewOrders') })
  if (lowStock) issues.push({ key: 'stock', title: tr('dash.tobaccoLow'), sub: `${lowStock.name} · ${Math.round(lowStock.quantity)} ${tr('dash.grams')}`, href: '/dashboard/stash', color: 'var(--warn)', action: tr('dash.viewStock') })
  if (status === 'canceling' && restaurant?.subscription_ends_at) issues.push({ key: 'subscription', title: tr('dash.subCancelled'), sub: tr('dash.accessUntilD', { date: new Date(restaurant.subscription_ends_at).toLocaleDateString(locale) }), href: '/dashboard/billing', color: 'var(--warn)', action: tr('dash.navBilling') })

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
      <div className="overview">
      <header className="overview-head">
        <div>
          <h1>{tr('dash.todayAtRestaurant')}</h1>
          <p>{new Date().toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' })} · {tr('dash.currentShiftAmounts')}</p>
        </div>
      </header>

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

      {dataError && !loading && <Card style={{ marginBottom: 20, borderLeft: '3px solid var(--warn)', color: 'var(--tx2)', fontSize: '.85rem' }}>{tr('dash.overviewDataError')}</Card>}

      <section className="overview-section" aria-labelledby="overview-now">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <h2 id="overview-now" className="overview-section-title">{tr('dash.situationNow')}</h2>
          {updatedAt && <span className="overview-chip" style={{ marginBottom: 12 }}>{tr('dash.updatedAt', { time: updatedAt.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }) })}</span>}
        </div>
        {loading ? <div className="overview-current"><div className="overview-loading"/><div className="overview-loading"/></div> : (
          <div className="overview-current">
            <Card style={{ minHeight: 215 }}>
              <div className="overview-label">{tr('dash.revenueToday')}</div>
              <div className="overview-revenue-value">{money(revenue)}</div>
              <div className="overview-sub">{tr('dash.cash')} {money(Number(shift?.income || 0))} · {tr('dash.card')} {money(Number(shift?.income_card || 0))}</div>
              <div className="overview-divider" />
              <div style={{ display: 'flex', alignItems: 'center', gap: 22 }}>
                <span className="overview-sub" style={{ fontSize: '.75rem', whiteSpace: 'nowrap' }}>{tr('dash.last14Days')}</span>
                <div style={{ flex: 1, minWidth: 60 }}>{revenueTrend.length > 1 && <Sparkline values={revenueTrend} tone="accent" height={42} formatValue={money} />}</div>
              </div>
            </Card>
            <Card style={{ minHeight: 215 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <div className="overview-label">{tr('dash.navShifts')}</div>
                <span className="overview-chip" style={!shiftIsOpen ? { background: 'var(--warn-soft)', color: 'var(--warn)' } : undefined}>{shiftIsOpen ? tr('dash.shiftOpen') : shift ? tr('dash.shiftFinished') : tr('dash.shiftClosed')}</span>
              </div>
              <div className="overview-shift-value">{money(Number(shift?.closing_balance || 0))}</div>
              <div className="overview-sub">{tr('dash.tillBalance')}</div>
              <div className="overview-divider" />
              <button className="overview-link ui-press" onClick={() => router.push('/dashboard/shifts')}>{tr('dash.openShift')} <span aria-hidden>›</span></button>
            </Card>
          </div>
        )}
      </section>

      {!loading && (ordersEnabled || appOk('bookings') || appOk('stash')) && <section className="overview-section" aria-labelledby="overview-operations">
        <h2 id="overview-operations" className="overview-section-title">{tr('dash.operations')}</h2>
        <div className="overview-operations">
          {ordersEnabled && <Card style={{ minHeight: 152 }}><div className="overview-label">{tr('dash.menuOrders')}</div><div className="overview-operation-value">{orders.fresh ? tr('dash.newCount', { n: orders.fresh }) : orders.total}</div><div className="overview-sub">{tr('dash.totalToday', { n: orders.total })}</div><button className="overview-link ui-press" onClick={() => router.push(orderHref)}>{tr('dash.viewOrders')} <span aria-hidden>›</span></button></Card>}
          {appOk('bookings') && <Card style={{ minHeight: 152 }}><div className="overview-label">{tr('dash.navBookings')}</div><div className="overview-operation-value">{tr('dash.bookingsToday', { n: bookings.total })}</div><div className="overview-sub">{tr('dash.awaitingArrival', { n: bookings.waiting })}</div><button className="overview-link ui-press" onClick={() => router.push('/dashboard/bookings')}>{tr('dash.viewBookings')} <span aria-hidden>›</span></button></Card>}
          {appOk('stash') && <Card style={{ minHeight: 152 }}><div className="overview-label">{tr('dash.hookahs')}</div><div className="overview-operation-value">{hookah.qty}</div><div className="overview-sub">{tr('dash.revenue')} {money(hookah.revenue)}</div><button className="overview-link ui-press" onClick={() => router.push('/dashboard/stash')}>{tr('dash.viewStash')} <span aria-hidden>›</span></button></Card>}
        </div>
      </section>}

      {!loading && <section className="overview-section" aria-labelledby="overview-attention">
        <h2 id="overview-attention" className="overview-section-title">{tr('dash.needsAttention')}</h2>
        <div className={`overview-attention${audits ? '' : ' overview-attention--single'}`}>
          <Card style={{ minHeight: 145, borderLeft: issues.length ? `3px solid ${issues[0].color}` : undefined }}>
            {issues.length ? issues.slice(0, showAllIssues ? issues.length : 3).map(issue => <div className="overview-issue" key={issue.key}>
              <div style={{ minWidth: 0 }}><div className="overview-issue-title">{issue.title}</div><div className="overview-issue-sub">{issue.sub}</div></div>
              <button className="overview-link ui-press" style={{ flexShrink: 0 }} onClick={() => router.push(issue.href)}>{issue.action} <span aria-hidden>›</span></button>
            </div>) : <div className="overview-sub">{dataError ? tr('dash.overviewDataError') : tr('dash.allGood')}</div>}
            {issues.length > 3 && !showAllIssues && <button className="overview-link ui-press" onClick={() => setShowAllIssues(true)}>{tr('dash.moreIssues', { n: issues.length - 3 })}</button>}
          </Card>
          {audits && <Card style={{ minHeight: 145 }}>
            <div className="overview-audit-head"><div className="overview-issue-title">{tr('dash.audits')} · {tr('pe.last30Days')}</div><div className="overview-audit-value" style={{ color: audits.rate >= 80 ? 'var(--ok)' : audits.rate >= 50 ? 'var(--warn)' : 'var(--danger)' }}>{audits.rate}%</div></div>
            <div className="overview-sub" style={{ marginTop: 12 }}>{tr('dash.violationsCount', { n: audits.top.reduce((sum, [, count]) => sum + count, 0) })}</div>
            <div className="overview-divider" />
            <button className="overview-link ui-press" onClick={() => router.push('/dashboard/people?tab=audits')}>{tr('dash.viewAudits')} <span aria-hidden>›</span></button>
          </Card>}
        </div>
      </section>}
      </div>
    </Container>
  )
}
