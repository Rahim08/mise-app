'use client'
// Уведомления: одна лента — заказы, вызовы официанта, события подписки, остатки табака.
// Перенесено из NotificationsTab старого dashboard/page.tsx.
import { useEffect, useState, type ReactElement } from 'react'
import { useRouter } from 'next/navigation'
import { db } from '@/lib/db'
import { useI18n } from '@/lib/i18n'
import { renderNotify, renderCategory, renderSegments } from '@/lib/notifyStrings'
import { Card, Container } from '@/components/ui'
import { useDash } from '@/components/dash/context'
import { timeAgo } from '@/components/dash/shared'
import './notifications.css'

export default function NotificationsPage() {
  const { t: tr, locale } = useI18n()
  const router = useRouter()
  const { restaurant } = useDash()
  const [rows, setRows] = useState<any[]>([])
  const [lowStock, setLowStock] = useState<any[]>([])
  const [journal, setJournal] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const status = restaurant?.subscription_status || ''

  useEffect(() => {
    if (!restaurant?.id) return
    const from = new Date(Date.now() - 2 * 864e5).toISOString()
    Promise.all([
      db.from('menu_orders').select('*').gte('created_at', from).order('created_at', { ascending: false }).limit(50),
      db.from('tobacco_stock').select('flavor_name, brand, flavor, quantity_g, min_quantity_g'),
      // Журнал уведомлений владельца (явка, аудиты, кассы, закуп…) — раньше был виден
      // только в пушах и staff-колокольчике (ревью A4).
      db.from('notifications').select('*').eq('to_owner', true).order('created_at', { ascending: false }).limit(50),
    ]).then(([ord, stock, notif]: any) => {
      setRows(ord.data || [])
      const low = (stock.data || [])
        .filter((s: any) => Number(s.quantity_g || 0) <= Number(s.min_quantity_g ?? 100))
        .sort((a: any, b: any) => Number(a.quantity_g || 0) - Number(b.quantity_g || 0))
      setLowStock(low)
      setJournal(notif.data || [])
      setLoading(false)
    })
  }, [restaurant?.id])

  // Запись хранит EN-фолбэк + *_key/*_params — перерендериваем на языке зрителя
  // (тот же механизм, что в staff-колокольчике people/page.tsx NotificationsTab).
  const renderTitle = (n: any) => {
    if (!n.title_key) return n.title
    const params = n.title_key === 'notify.purchaseTitle' && n.title_params?.category
      ? { ...n.title_params, category: renderCategory(locale, String(n.title_params.category)) }
      : n.title_params
    return renderNotify(locale, n.title_key, params || undefined)
  }
  // '_segments' — составное тело (в т.ч. секьюрный дайджест кассы, ревью Г3):
  // лейблы переводятся, суммы — готовые строки.
  const renderBody = (n: any) => n.body_key === '_segments' && Array.isArray(n.body_params?.segments)
    ? renderSegments(locale, n.body_params.segments)
    : n.body_key ? renderNotify(locale, n.body_key, n.body_params || undefined) : n.body

  const stockName = (s: any) => s.flavor_name || [s.brand, s.flavor].filter(Boolean).join(' ') || tr('dash.tobacco')

  const orderStatus: Record<string, { label: string; color: string }> = {
    new: { label: 'pe.osNew', color: 'var(--warn)' }, in_progress: { label: 'pe.osInProgress', color: 'var(--accent)' },
    done: { label: 'pe.osDone', color: 'var(--ok)' }, cancelled: { label: 'pe.osCancelled', color: 'var(--tx3)' },
  }
  const pendingOrders = rows.filter(o => o.status === 'new').length
  const attentionCount = pendingOrders + lowStock.length + (status === 'past_due' ? 1 : 0)
  const hasActivity = rows.length > 0 || journal.length > 0

  return (
    <Container size="normal">
      <div className="notifications-head">
        <h1>{tr('dash.navNotifications')}</h1>
        <p>{tr('dash.notifsSub')}</p>
      </div>

      {!loading && <section className="notifications-section" aria-label={tr('dash.notifAttention')}>
        <div className="notifications-section-head">
          <h2>{tr('dash.notifAttention')}</h2>
          {attentionCount > 0 && <span className="notifications-count">{attentionCount}</span>}
        </div>
        {attentionCount === 0 ? (
          <Card><div className="notifications-calm">{tr('dash.allGood')}</div></Card>
        ) : (
          <div className="notifications-attention">
            {pendingOrders > 0 && <Card onClick={() => router.push('/dashboard/people?tab=orders')} style={{ minWidth: 0, borderLeft: '3px solid var(--warn)' }}>
              <div className="notifications-attention-label">{tr('dash.notifPendingOrders')}</div>
              <div className="notifications-attention-value">{pendingOrders}</div>
              <div className="notifications-action">{tr('dash.notifOpenOrders')} <span aria-hidden="true">→</span></div>
            </Card>}
            {lowStock.length > 0 && <Card onClick={() => router.push('/dashboard/stash')} style={{ minWidth: 0, borderLeft: '3px solid var(--warn)' }}>
              <div className="notifications-attention-label">{Number(lowStock[0].quantity_g || 0) <= 0 ? tr('dash.tobaccoOut') : tr('dash.tobaccoLow')}</div>
              <div className="notifications-attention-value">{lowStock.length}</div>
              <div className="notifications-attention-sub">{stockName(lowStock[0])} · {Math.round(Number(lowStock[0].quantity_g || 0))} {tr('dash.grams')}</div>
              <div className="notifications-action">{tr('dash.notifOpenStock')} <span aria-hidden="true">→</span></div>
            </Card>}
            {status === 'past_due' && <Card onClick={() => router.push('/dashboard/billing')} style={{ minWidth: 0, borderLeft: '3px solid var(--danger)' }}>
              <div className="notifications-attention-label">{tr('dash.subPaymentFailed')}</div>
              <div className="notifications-attention-sub">{tr('dash.stripeRetry')}</div>
              <div className="notifications-action">{tr('dash.notifOpenBilling')} <span aria-hidden="true">→</span></div>
            </Card>}
          </div>
        )}
      </section>}

      <section className="notifications-section" aria-label={tr('dash.notifRecent')}>
        <div className="notifications-section-head"><h2>{tr('dash.notifRecent')}</h2></div>

      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[0, 1, 2].map(i => <div key={i} style={{ height: 64, borderRadius: 16, background: 'var(--fill)', animation: 'dashPulse 1.2s ease-in-out infinite' }} />)}
        </div>
      ) : !hasActivity ? (
        <Card><div style={{ textAlign: 'center', padding: '28px 0', color: 'var(--tx2)', fontSize: '.88rem' }}>{tr('dash.notifNoRecent')}</div></Card>
      ) : rows.length === 0 ? null : (
        <>
        <h3 className="notifications-list-title">{tr('dash.notifOrdersAndCalls')}</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {rows.map(o => {
            const callKind: string | null = Array.isArray(o.items) ? (o.items[0]?.call ?? null) : null
            const isCall = !!callKind
            const st = orderStatus[o.status] || orderStatus.new
            const count = isCall ? 0 : (Array.isArray(o.items) ? o.items.reduce((s: number, i: any) => s + (i.qty || 1), 0) : 0)
            const CALL_ICON: Record<string, ReactElement> = {
              waiter: <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" viewBox="0 0 24 24"><path d="M18 8.4a6 6 0 10-12 0c0 6.6-2.7 8.6-2.7 8.6h17.4S18 15 18 8.4"/><path d="M13.7 21a2 2 0 01-3.4 0"/></svg>,
              coal: <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" viewBox="0 0 24 24"><circle cx="8" cy="9" r="3"/><circle cx="16" cy="9" r="3"/><circle cx="12" cy="16" r="3"/></svg>,
              water: <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" viewBox="0 0 24 24"><path d="M12 3s6 7 6 11a6 6 0 01-12 0c0-4 6-11 6-11z"/></svg>,
            }
            const CALL_LABEL: Record<string, string> = { waiter: tr('dash.waiterCall'), coal: tr('dash.coalCall'), water: tr('dash.waterCall') }
            return (
              <Card key={o.id} onClick={() => router.push('/dashboard/people?tab=orders')} style={{ padding: '12px 16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ width: 34, height: 34, borderRadius: 10, background: isCall ? 'var(--warn-soft)' : 'rgba(255,45,85,.12)', color: isCall ? 'var(--warn)' : 'var(--pink)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    {isCall
                      ? (CALL_ICON[callKind!] ?? CALL_ICON.waiter)
                      : <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: '.88rem', color: 'var(--tx)' }}>
                      {isCall ? (CALL_LABEL[callKind!] ?? tr('dash.waiterCall')) : tr('dash.orderNItems', { n: count })}{o.table_number ? ` · ${tr('dash.tableWord')} ${o.table_number}` : ''}
                    </div>
                    <div style={{ fontSize: '.75rem', color: 'var(--tx2)', marginTop: 1 }}>{timeAgo(o.created_at)}</div>
                  </div>
                  <span style={{ fontSize: '.7rem', fontWeight: 700, color: st.color, background: 'var(--fill)', padding: '3px 10px', borderRadius: 980, flexShrink: 0 }}>{tr(st.label)}</span>
                </div>
              </Card>
            )
          })}
        </div>
        </>
      )}

      {/* Журнал уведомлений владельца (notifications, to_owner) — явка, аудиты, кассы, закуп. */}
      {journal.length > 0 && (
        <>
          <h3 className="notifications-list-title">{tr('dash.notifJournal')}</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {journal.map(n => (
              <Card key={n.id} style={{ padding: '12px 16px' }}>
                <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                  <div style={{ width: 34, height: 34, borderRadius: 10, background: 'var(--fill)', color: 'var(--tx2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" viewBox="0 0 24 24"><path d="M18 8.4a6 6 0 10-12 0c0 6.6-2.7 8.6-2.7 8.6h17.4S18 15 18 8.4" /><path d="M13.7 21a2 2 0 01-3.4 0" /></svg>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: '.88rem', color: 'var(--tx)' }}>{renderTitle(n)}</div>
                    {renderBody(n) && <div style={{ fontSize: '.78rem', color: 'var(--tx2)', marginTop: 1 }}>{renderBody(n)}</div>}
                  </div>
                  <span style={{ fontSize: '.72rem', color: 'var(--tx3)', flexShrink: 0 }}>{timeAgo(n.created_at)}</span>
                </div>
              </Card>
            ))}
          </div>
        </>
      )}
      </section>
    </Container>
  )
}
