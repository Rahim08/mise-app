'use client'
// Уведомления: одна лента — заказы, вызовы официанта, события подписки, остатки табака.
// Перенесено из NotificationsTab старого dashboard/page.tsx.
import { useEffect, useState } from 'react'
import { db } from '@/lib/db'
import { useI18n } from '@/lib/i18n'
import { Card, Container, SectionTitle } from '@/components/ui'
import { useDash } from '@/components/dash/context'
import { timeAgo } from '@/components/dash/shared'

export default function NotificationsPage() {
  const { t: tr } = useI18n()
  const { restaurant } = useDash()
  const [rows, setRows] = useState<any[]>([])
  const [lowStock, setLowStock] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const status = restaurant?.subscription_status || ''

  useEffect(() => {
    if (!restaurant?.id) return
    const from = new Date(Date.now() - 2 * 864e5).toISOString()
    Promise.all([
      db.from('menu_orders').select('*').gte('created_at', from).order('created_at', { ascending: false }).limit(50),
      db.from('tobacco_stock').select('flavor_name, brand, flavor, quantity_g, min_quantity_g'),
    ]).then(([ord, stock]: any) => {
      setRows(ord.data || [])
      const low = (stock.data || [])
        .filter((s: any) => Number(s.quantity_g || 0) <= Number(s.min_quantity_g ?? 100))
        .sort((a: any, b: any) => Number(a.quantity_g || 0) - Number(b.quantity_g || 0))
      setLowStock(low)
      setLoading(false)
    })
  }, [restaurant?.id])

  const stockName = (s: any) => s.flavor_name || [s.brand, s.flavor].filter(Boolean).join(' ') || tr('dash.tobacco')

  const orderStatus: Record<string, { label: string; color: string }> = {
    new: { label: 'pe.osNew', color: 'var(--warn)' }, in_progress: { label: 'pe.osInProgress', color: 'var(--accent)' },
    done: { label: 'pe.osDone', color: 'var(--ok)' }, cancelled: { label: 'pe.osCancelled', color: 'var(--tx3)' },
  }

  return (
    <Container size="normal">
      <SectionTitle title={tr('dash.navNotifications')} sub={tr('dash.notifsSub')} />

      {status === 'past_due' && (
        <Card style={{ marginBottom: 10, padding: '12px 16px', borderLeft: '3px solid var(--danger)' }}>
          <div style={{ fontWeight: 600, fontSize: '.88rem', color: 'var(--tx)' }}>{tr('dash.subPaymentFailed')}</div>
          <div style={{ fontSize: '.78rem', color: 'var(--tx2)', marginTop: 1 }}>{tr('dash.stripeRetry')}</div>
        </Card>
      )}

      {/* Проактивно: заканчивающийся табак (Stash) */}
      {lowStock.slice(0, 5).map((s, i) => {
        const out = Number(s.quantity_g || 0) <= 0
        const c = out ? 'var(--danger)' : 'var(--warn)'
        const soft = out ? 'var(--danger-soft)' : 'var(--warn-soft)'
        return (
          <Card key={`low-${i}`} style={{ marginBottom: 10, padding: '12px 16px', borderLeft: `3px solid ${c}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 34, height: 34, borderRadius: 10, background: soft, color: c, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" viewBox="0 0 24 24"><path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /></svg>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: '.88rem', color: 'var(--tx)' }}>{out ? tr('dash.tobaccoOut') : tr('dash.tobaccoLow')}</div>
                <div style={{ fontSize: '.78rem', color: 'var(--tx2)', marginTop: 1 }}>{stockName(s)} · {Math.round(Number(s.quantity_g || 0))} г</div>
              </div>
            </div>
          </Card>
        )
      })}

      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[0, 1, 2].map(i => <div key={i} style={{ height: 64, borderRadius: 16, background: 'var(--fill)', animation: 'dashPulse 1.2s ease-in-out infinite' }} />)}
        </div>
      ) : rows.length === 0 && lowStock.length === 0 ? (
        <Card><div style={{ textAlign: 'center', padding: '28px 0', color: 'var(--tx2)', fontSize: '.88rem' }}>{tr('dash.quietNoNotifs')}</div></Card>
      ) : rows.length === 0 ? null : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {rows.map(o => {
            const isCall = Array.isArray(o.items) && o.items[0]?.call === 'waiter'
            const st = orderStatus[o.status] || orderStatus.new
            const count = isCall ? 0 : (Array.isArray(o.items) ? o.items.reduce((s: number, i: any) => s + (i.qty || 1), 0) : 0)
            return (
              <Card key={o.id} style={{ padding: '12px 16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ width: 34, height: 34, borderRadius: 10, background: isCall ? 'var(--warn-soft)' : 'rgba(255,45,85,.12)', color: isCall ? 'var(--warn)' : 'var(--pink)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    {isCall
                      ? <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" viewBox="0 0 24 24"><path d="M18 8.4a6 6 0 10-12 0c0 6.6-2.7 8.6-2.7 8.6h17.4S18 15 18 8.4"/><path d="M13.7 21a2 2 0 01-3.4 0"/></svg>
                      : <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: '.88rem', color: 'var(--tx)' }}>
                      {isCall ? tr('dash.waiterCall') : tr('dash.orderNItems', { n: count })}{o.table_number ? ` · ${tr('dash.tableWord')} ${o.table_number}` : ''}
                    </div>
                    <div style={{ fontSize: '.75rem', color: 'var(--tx2)', marginTop: 1 }}>{timeAgo(o.created_at)}</div>
                  </div>
                  <span style={{ fontSize: '.7rem', fontWeight: 700, color: st.color, background: 'var(--fill)', padding: '3px 10px', borderRadius: 980, flexShrink: 0 }}>{tr(st.label)}</span>
                </div>
              </Card>
            )
          })}
        </div>
      )}
    </Container>
  )
}
