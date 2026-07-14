'use client'
// Оплата (биллинг v2, self-serve): тумблер месяц/год, карточки тарифов, аддон-модули,
// степпер мест, AI-тоггл. Изменения → POST /api/stripe/update {preview:true} →
// «Доплата сейчас €X, новая цена €Y/мес» → подтверждение → POST без preview.
// Без subscription_id (триал) → checkout с выбранным составом.
// App Store (Guideline 3.1.1): в нативной iOS-сборке цен/оплаты нет — только статус.
import { useEffect, useState } from 'react'
import { useI18n } from '@/lib/i18n'
import { useIsNative } from '@/lib/native'
import { track } from '@/lib/analytics'
import { PLANS as PLAN_DEFS, ADDON_PRICES, ALL_MODULES, YEARLY_DISCOUNT, yearly, isActiveStatus, type PlanId, type ModuleId } from '@/lib/plans'
import { Card, Btn, Badge, Toggle, Segmented, Stepper, SectionTitle, Spinner, Container } from '@/components/ui'
import { useDash } from '@/components/dash/context'
import { PLANS } from '@/components/dash/shared'

// Брендовые имена модулей — не переводятся.
const MODULE_NAMES: Record<ModuleId, string> = {
  manager: 'Manager', analytics: 'Analytics', stash: 'Stash', people: 'People',
  menu: 'Menu', bookings: 'Bookings', news: 'News',
}

export default function BillingPage() {
  const { t: tr, locale } = useI18n()
  const native = useIsNative()
  const { restaurant, reload } = useDash()

  const status = restaurant?.subscription_status
  const endsAt = restaurant?.subscription_ends_at ? new Date(restaurant.subscription_ends_at) : null
  const isActive = isActiveStatus(status)
  const hasSub = !!restaurant?.subscription_id
  const currentPlan = PLANS.find(p => p.id === restaurant?.subscription_plan)

  // ── Желаемый состав подписки (init от текущего состояния ресторана) ──
  const [plan, setPlan] = useState<PlanId>('business')
  const [interval, setInterval_] = useState<'month' | 'year'>('month')
  const [mods, setMods] = useState<ModuleId[]>([])
  const [seats, setSeats] = useState(0)
  const [ai, setAi] = useState(false)
  useEffect(() => {
    if (!restaurant) return
    setPlan((PLAN_DEFS[restaurant.subscription_plan as PlanId] ? restaurant.subscription_plan : 'business') as PlanId)
    setInterval_(restaurant.billing_interval === 'year' ? 'year' : 'month')
    setMods(((restaurant.addon_modules || []) as ModuleId[]).filter(m => ALL_MODULES.includes(m)))
    setSeats(restaurant.extra_seats || 0)
    setAi(!!restaurant.addon_ai)
  }, [restaurant?.id])

  const planData = PLAN_DEFS[plan]
  // Аддон-модули валидны только сверх тарифа
  const effMods = mods.filter(m => !planData.modules.includes(m))
  const effAi = ai && !planData.ai
  const dirty = !!restaurant && (
    plan !== restaurant.subscription_plan ||
    interval !== (restaurant.billing_interval === 'year' ? 'year' : 'month') ||
    JSON.stringify([...effMods].sort()) !== JSON.stringify([...((restaurant.addon_modules || []) as string[])].sort()) ||
    seats !== (restaurant.extra_seats || 0) ||
    effAi !== !!restaurant.addon_ai
  )

  // Локальная цена — мгновенная обратная связь; точную считает Stripe в preview.
  const monthlyLocal = planData.price + effMods.length * ADDON_PRICES.module + seats * ADDON_PRICES.seat + (effAi ? ADDON_PRICES.ai : 0)
  const priceLabel = interval === 'year'
    ? `€${Math.round(monthlyLocal * 12 * (1 - YEARLY_DISCOUNT))}${tr('dash.perYear')}`
    : `€${monthlyLocal}${tr('dash.perMo')}`

  // ── Действия ──
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<{ amountDue: number | null; monthly: number } | null>(null)
  const [cancelConfirm, setCancelConfirm] = useState(false)
  const [portalLoading, setPortalLoading] = useState(false)

  const payload = {
    restaurantId: restaurant?.id, plan, interval,
    addonModules: effMods, extraSeats: seats, addonAI: effAi,
  }

  const apply = async () => {
    if (!restaurant || busy) return
    setBusy(true)
    try {
      if (!hasSub) {
        // Триал/нет подписки → checkout с выбранным составом
        track('checkout_started', { plan })
        const res = await fetch('/api/stripe/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
        const data = await res.json().catch(() => ({}))
        if (!res.ok || data.error) { alert(`${tr('dash.checkoutFailed')} (${res.status}): ${data.error || tr('dash.tryRelogin')}`); return }
        if (data.url) window.location.href = data.url
        else alert(tr('dash.noStripeUrl'))
        return
      }
      const res = await fetch('/api/stripe/update', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, preview: true }) })
      const data = await res.json().catch(() => ({}))
      if (data.error === 'no_subscription') {
        // Подписка умерла в Stripe — идём через checkout
        const r2 = await fetch('/api/stripe/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
        const d2 = await r2.json().catch(() => ({}))
        if (d2.url) window.location.href = d2.url
        else alert(d2.error || tr('dash.error'))
        return
      }
      if (!res.ok || data.error) { alert(`${tr('dash.error')}${data.message || data.error || res.status}`); return }
      if (!data.changed) { alert(tr('dash.noChanges')); return }
      setPreview({ amountDue: data.amountDue, monthly: data.monthly })
    } catch (e: any) {
      alert(tr('dash.error') + (e?.message || e))
    } finally { setBusy(false) }
  }

  const confirm = async () => {
    if (!restaurant || busy) return
    setBusy(true)
    try {
      const res = await fetch('/api/stripe/update', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data.error) { alert(`${tr('dash.error')}${data.message || data.error || res.status}`); return }
      setPreview(null)
      track('subscription_updated', { plan, interval, modules: effMods.length, seats, ai: effAi })
      await reload()
    } catch (e: any) {
      alert(tr('dash.error') + (e?.message || e))
    } finally { setBusy(false) }
  }

  const cancel = async () => {
    if (!restaurant) return
    setBusy(true)
    try {
      const res = await fetch('/api/stripe/cancel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ restaurantId: restaurant.id }) })
      const data = await res.json()
      if (data.error) { alert(data.error); return }
      setCancelConfirm(false)
      reload()
    } finally { setBusy(false) }
  }

  const openPortal = async () => {
    if (!restaurant) return
    setPortalLoading(true)
    try {
      const res = await fetch('/api/stripe/portal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ restaurantId: restaurant.id }) })
      const data = await res.json()
      if (data.error) { alert(data.error); return }
      if (data.url) window.location.href = data.url
    } catch (e: any) {
      alert(tr('dash.error') + e?.message)
    } finally { setPortalLoading(false) }
  }

  // После оплаты Stripe редиректит раньше вебхука — дотягиваем статус ~20 секунд.
  // justPaid — в state (чтение window.location на рендере ломает гидрацию).
  const [justPaid, setJustPaid] = useState(false)
  useEffect(() => { setJustPaid(new URLSearchParams(window.location.search).get('success') === '1') }, [])
  useEffect(() => {
    if (!justPaid || !restaurant?.id) return
    let stop = false
    ;(async () => {
      for (let i = 0; i < 8 && !stop; i++) {
        await new Promise(r => setTimeout(r, 2500))
        const rest = await reload()
        if (rest && (rest.subscription_status === 'active' || rest.subscription_status === 'trialing')) break
      }
    })()
    return () => { stop = true }
  }, [justPaid, restaurant?.id])

  // Дней до конца триала (баннер при ≤ 3 дня)
  const trialDaysLeft = status === 'trialing' && endsAt ? Math.ceil((endsAt.getTime() - Date.now()) / 86400000) : null

  const statusBadge: Record<string, { label: string; tone: 'accent' | 'ok' | 'warn' | 'danger' | 'neutral' }> = {
    trialing: { label: 'dash.stTrialing', tone: 'accent' },
    active: { label: 'dash.stActive', tone: 'ok' },
    past_due: { label: 'dash.stPastDue', tone: 'warn' },
    canceling: { label: 'dash.stCanceling', tone: 'warn' },
    canceled: { label: 'dash.stCanceled', tone: 'danger' },
    inactive: { label: 'dash.stInactive', tone: 'neutral' },
  }
  const badge = statusBadge[status || 'inactive'] || statusBadge.inactive

  if (!restaurant) return <Spinner />

  return (
    <Container size="normal">
      <SectionTitle title={tr('dash.navBilling')} sub={tr('dash.billingSub')} />

      {justPaid && !isActive && (
        <Card style={{ marginBottom: 16, border: '1px solid rgba(0,122,255,.25)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: '.85rem', color: 'var(--tx2)' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)', flexShrink: 0 }} />
            {tr('dash.paymentReceived')}
          </div>
        </Card>
      )}

      {/* App Store: подписка управляется в вебе (нативная сборка) */}
      {native && (
        <Card style={{ marginBottom: 16, background: 'var(--fill2)', boxShadow: 'none' }}>
          <div style={{ fontWeight: 600, fontSize: '.88rem', color: 'var(--tx)', marginBottom: 4 }}>{tr('dash.manageSub')}</div>
          <div style={{ fontSize: '.82rem', color: 'var(--tx2)', lineHeight: 1.5 }}>{tr('dash.manageSubNative')}</div>
        </Card>
      )}

      {/* Баннер: триал заканчивается */}
      {!native && trialDaysLeft !== null && trialDaysLeft <= 3 && (
        <Card style={{ marginBottom: 16, border: '1px solid rgba(255,149,0,.35)', background: 'var(--warn-soft)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: '.92rem', color: 'var(--tx)', marginBottom: 2 }}>
                {trialDaysLeft <= 0 ? tr('dash.trialEndsToday') : locale === 'ru' ? `Пробный период заканчивается через ${trialDaysLeft} ${trialDaysLeft === 1 ? 'день' : 'дня'}` : tr('dash.trialEndsIn', { n: trialDaysLeft })}
              </div>
              <div style={{ fontSize: '.8rem', color: 'var(--tx2)' }}>{tr('dash.choosePlanKeepAccess')}</div>
            </div>
            <svg width="20" height="20" fill="none" stroke="var(--warn)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" /></svg>
          </div>
        </Card>
      )}

      {/* Текущая подписка */}
      {currentPlan && (
        <Card style={{ marginBottom: 16, border: `1px solid ${currentPlan.color}25` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <div style={{ marginBottom: 10 }}><Badge tone={badge.tone}>{tr(badge.label)}</Badge></div>
              <div style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--tx)', marginBottom: 2 }}>{currentPlan.name}</div>
              {endsAt && (
                <div style={{ fontSize: '.8rem', color: 'var(--tx2)' }}>
                  {isActive && status !== 'canceling' ? tr('dash.nextPayment') : tr('dash.accessUntil')}: {endsAt.toLocaleDateString(locale)}
                </div>
              )}
            </div>
            {hasSub && (
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '1.8rem', fontWeight: 700, color: 'var(--tx)', fontVariantNumeric: 'tabular-nums' }}>
                  €{(() => {
                    const m = currentPlan.price
                      + ((restaurant.addon_modules?.length || 0) * ADDON_PRICES.module)
                      + ((restaurant.extra_seats || 0) * ADDON_PRICES.seat)
                      + (restaurant.addon_ai ? ADDON_PRICES.ai : 0)
                    return restaurant.billing_interval === 'year' ? Math.round(m * 12 * (1 - YEARLY_DISCOUNT)) : m
                  })()}
                </div>
                <div style={{ color: 'var(--tx2)', fontSize: '.78rem' }}>{restaurant.billing_interval === 'year' ? tr('dash.perYear') : tr('dash.perMonth')}</div>
              </div>
            )}
          </div>
          {!native && isActive && status !== 'canceling' && hasSub && (
            <div style={{ marginTop: 14, paddingTop: 14, borderTop: 'var(--hairline)' }}>
              {!cancelConfirm ? (
                <button onClick={() => setCancelConfirm(true)} style={{ background: 'none', border: 'none', color: 'var(--danger)', fontSize: '.82rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>
                  {tr('dash.cancelSub')}
                </button>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '.82rem', color: 'var(--tx2)' }}>{tr('dash.confirmCancel')}</span>
                  <Btn small variant="danger" onClick={cancel} disabled={busy}>{tr('dash.yesCancel')}</Btn>
                  <Btn small variant="gray" onClick={() => setCancelConfirm(false)}>{tr('dash.no')}</Btn>
                </div>
              )}
            </div>
          )}
        </Card>
      )}

      {/* Stripe Customer Portal: обновить карту, посмотреть инвойсы */}
      {!native && isActive && restaurant.stripe_customer_id && (
        <Card style={{ marginBottom: 16, background: 'var(--fill2)', boxShadow: 'none' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: '.88rem', color: 'var(--tx)', marginBottom: 2 }}>{tr('dash.manageCard')}</div>
              <div style={{ fontSize: '.78rem', color: 'var(--tx2)' }}>{tr('dash.manageCardSub')}</div>
            </div>
            <Btn small variant="gray" onClick={openPortal} disabled={portalLoading}>{portalLoading ? '...' : tr('dash.openPortal')}</Btn>
          </div>
        </Card>
      )}

      {!native && <>
        {/* Тумблер месяц/год */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
          <div style={{ fontWeight: 600, fontSize: '.78rem', color: 'var(--tx2)', textTransform: 'uppercase', letterSpacing: '.06em' }}>
            {currentPlan && hasSub ? tr('dash.changePlan') : tr('dash.choosePlan')}
          </div>
          <div style={{ minWidth: 220 }}>
            <Segmented small value={interval} onChange={v => setInterval_(v as 'month' | 'year')}
              options={[{ value: 'month', label: tr('dash.intMonth') }, { value: 'year', label: tr('dash.intYear') }]} />
          </div>
        </div>

        {/* Карточки тарифов */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 12, marginBottom: 16 }}>
          {PLANS.map(p => {
            const def = PLAN_DEFS[p.id as PlanId]
            const selected = plan === p.id
            const isCurrent = restaurant.subscription_plan === p.id && hasSub
            const price = interval === 'year' ? `€${yearly(def.price)}` : `€${def.price}`
            const per = interval === 'year' ? tr('dash.perYear') : tr('dash.perMo')
            return (
              <Card key={p.id} onClick={() => setPlan(p.id as PlanId)} style={{ border: `2px solid ${selected ? p.color : p.popular ? p.color + '40' : 'var(--sep-c)'}`, position: 'relative', padding: 16 }}>
                {(isCurrent || (p.popular && !isCurrent)) && (
                  <div style={{ position: 'absolute', top: -10, left: '50%', transform: 'translateX(-50%)', background: p.color, color: '#fff', fontSize: '.65rem', fontWeight: 700, padding: '3px 10px', borderRadius: 980, whiteSpace: 'nowrap' }}>
                    {isCurrent ? tr('dash.current') : tr('dash.popular')}
                  </div>
                )}
                <div style={{ marginBottom: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                    <span style={{ width: 16, height: 16, borderRadius: '50%', border: `2px solid ${selected ? p.color : 'rgba(var(--seprgb),.3)'}`, background: selected ? p.color : 'transparent', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      {selected && <svg width="8" height="7" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 12 10"><path d="M1 5l3.5 3.5L11 1" /></svg>}
                    </span>
                    <span style={{ fontWeight: 700, fontSize: '1.05rem', color: 'var(--tx)' }}>{p.name}</span>
                  </div>
                  <div style={{ fontSize: '1.5rem', fontWeight: 700, color: p.color, fontVariantNumeric: 'tabular-nums' }}>{price}<span style={{ fontSize: '.75rem', color: 'var(--tx2)', fontWeight: 400 }}>{per}</span></div>
                </div>
                <div>
                  {p.features.map(f => (
                    <div key={f} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '.8rem', color: 'var(--tx2)', marginBottom: 4 }}>
                      <svg width="11" height="9" fill="none" stroke={p.color} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 12 10" style={{ flexShrink: 0 }}><path d="M1 5l3.5 3.5L11 1" /></svg>
                      {f.startsWith('dash.') ? tr(f) : f}
                    </div>
                  ))}
                </div>
              </Card>
            )
          })}
        </div>

        {/* Аддоны */}
        <Card style={{ marginBottom: 16 }}>
          <div style={{ fontWeight: 700, fontSize: '.95rem', color: 'var(--tx)' }}>{tr('dash.addonsTitle')}</div>
          <div style={{ fontSize: '.78rem', color: 'var(--tx2)', margin: '2px 0 14px' }}>{tr('dash.addonModulesSub')}</div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {ALL_MODULES.filter(m => m !== 'manager' && m !== 'analytics').map(m => {
              const included = planData.modules.includes(m)
              const on = included || mods.includes(m)
              return (
                <div key={m} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '8px 0', borderBottom: 'var(--hairline)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: '.88rem', fontWeight: 600, color: 'var(--tx)' }}>{MODULE_NAMES[m]}</span>
                    {included && <Badge tone="ok">{tr('dash.included')}</Badge>}
                    {!included && <span style={{ fontSize: '.74rem', color: 'var(--tx3)' }}>+€{ADDON_PRICES.module}{tr('dash.perMo')}</span>}
                  </div>
                  <Toggle value={on} disabled={included}
                    onChange={v => setMods(prev => v ? [...prev, m] : prev.filter(x => x !== m))}
                    tone="accent" label={MODULE_NAMES[m]} />
                </div>
              )
            })}
          </div>

          {/* Места */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 0', borderBottom: 'var(--hairline)' }}>
            <div>
              <div style={{ fontSize: '.88rem', fontWeight: 600, color: 'var(--tx)' }}>{tr('dash.extraSeats')}</div>
              <div style={{ fontSize: '.74rem', color: 'var(--tx2)', marginTop: 1 }}>{tr('dash.extraSeatsSub')} · {planData.seats} + {seats}</div>
            </div>
            <Stepper value={seats} onChange={setSeats} min={0} max={200} />
          </div>

          {/* AI */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 0 4px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div>
                <div style={{ fontSize: '.88rem', fontWeight: 600, color: 'var(--tx)' }}>{tr('dash.aiAddon')}</div>
                <div style={{ fontSize: '.74rem', color: 'var(--tx2)', marginTop: 1 }}>{tr('dash.aiAddonSub')}</div>
              </div>
              {planData.ai && <Badge tone="ok">{tr('dash.included')}</Badge>}
            </div>
            <Toggle value={planData.ai || ai} disabled={planData.ai} onChange={setAi} tone="violet" label={tr('dash.aiAddon')} />
          </div>
        </Card>

        {/* Итог + применить */}
        <Card style={{ marginBottom: 16 }}>
          {preview ? (
            <div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, marginBottom: 14 }}>
                {preview.amountDue != null && (
                  <div>
                    <div style={{ fontSize: '.72rem', fontWeight: 600, color: 'var(--tx2)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 2 }}>{tr('dash.dueNow')}</div>
                    <div style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--tx)', fontVariantNumeric: 'tabular-nums' }}>€{preview.amountDue.toFixed(2)}</div>
                  </div>
                )}
                <div>
                  <div style={{ fontSize: '.72rem', fontWeight: 600, color: 'var(--tx2)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 2 }}>{tr('dash.newMonthly')}</div>
                  <div style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--accent)', fontVariantNumeric: 'tabular-nums' }}>€{preview.monthly}{tr('dash.perMo')}</div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <Btn onClick={confirm} disabled={busy}>{busy ? tr('dash.saving') : tr('dash.confirmPay')}</Btn>
                <Btn variant="gray" onClick={() => setPreview(null)} disabled={busy}>{tr('dash.cancel')}</Btn>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: '.72rem', fontWeight: 600, color: 'var(--tx2)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 2 }}>{planData.name} {interval === 'year' ? `· ${tr('dash.intYear')}` : ''}</div>
                <div style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--tx)', fontVariantNumeric: 'tabular-nums' }}>{priceLabel}</div>
              </div>
              <Btn onClick={apply} disabled={busy || (hasSub && !dirty)}>
                {busy ? tr('dash.calculating') : hasSub ? tr('dash.applyChanges') : tr('dash.checkoutBtn')}
              </Btn>
            </div>
          )}
        </Card>

        <div style={{ textAlign: 'center', fontSize: '.75rem', color: 'var(--tx3)' }}>
          {tr('dash.stripeNote')}
        </div>
      </>}
    </Container>
  )
}
