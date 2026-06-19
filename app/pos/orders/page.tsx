'use client'
import { useEffect, useState, useCallback } from 'react'

type OrderItem = { id: string; menu_item_name: string; qty: number; unit_price: number; status: string; note: string | null; modifier_summary: string }
type Order = { id: string; table_number: string; table_label: string | null; floor_name: string; status: string; total: number; subtotal: number; discount_amount: number; items: OrderItem[]; opened_at: string; guests: number }

const STATUS_COLOR: Record<string, string> = {
  open: '#3b82f6', paid: '#22c55e', void: '#555',
}
const ITEM_STATUS_COLOR: Record<string, string> = {
  pending: '#f97316', sent: '#3b82f6', cooking: '#eab308', ready: '#22c55e', served: '#333',
}

function timeAgo(iso: string) {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return '<1м'
  if (mins < 60) return `${mins}м`
  return `${Math.floor(mins / 60)}ч${mins % 60}м`
}

export default function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>([])
  const [filter, setFilter] = useState<'open' | 'paid' | 'all'>('open')
  const [selected, setSelected] = useState<Order | null>(null)
  const [lastRefresh, setLastRefresh] = useState(new Date())

  const load = useCallback(() => {
    fetch('/api/pos/orders').then(r => r.json()).then(d => {
      setOrders(d.orders ?? [])
      setLastRefresh(new Date())
    })
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(load, 15000) // refresh every 15s
    return () => clearInterval(t)
  }, [load])

  const filtered = orders.filter(o => filter === 'all' || o.status === filter)
  const openCount = orders.filter(o => o.status === 'open').length
  const paidToday = orders.filter(o => o.status === 'paid').length
  const revenueToday = orders.filter(o => o.status === 'paid').reduce((s, o) => s + o.total, 0)

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      {/* Left: list */}
      <div style={{ width: 340, display: 'flex', flexDirection: 'column', borderRight: '1px solid #1a1a1a', background: '#0a0a0a' }}>
        {/* Stats */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', borderBottom: '1px solid #1a1a1a' }}>
          <StatMini label="Открыто" value={String(openCount)} accent="#3b82f6" />
          <StatMini label="Закрыто" value={String(paidToday)} accent="#22c55e" />
          <StatMini label="Выручка" value={`€${revenueToday.toFixed(0)}`} accent="#fff" />
        </div>

        {/* Filter tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid #1a1a1a' }}>
          {(['open', 'paid', 'all'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{
                flex: 1, padding: '10px 0', background: filter === f ? '#1a1a1a' : 'transparent',
                border: 'none', color: filter === f ? '#fff' : '#444', fontSize: 13, fontWeight: filter === f ? 700 : 400, cursor: 'pointer',
                borderBottom: filter === f ? '2px solid #fff' : '2px solid transparent',
              }}
            >
              {f === 'open' ? 'Открытые' : f === 'paid' ? 'Закрытые' : 'Все'}
            </button>
          ))}
        </div>

        {/* Refresh hint */}
        <div style={{ padding: '6px 14px', color: '#2a2a2a', fontSize: 11, borderBottom: '1px solid #111', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>Авто-обновление 15с</span>
          <button onClick={load} style={{ background: 'none', border: 'none', color: '#333', cursor: 'pointer', fontSize: 11 }}>
            Обновить · {lastRefresh.toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </button>
        </div>

        {/* Order list */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {filtered.length === 0 && (
            <div style={{ color: '#2a2a2a', fontSize: 13, textAlign: 'center', padding: '40px 0' }}>Нет заказов</div>
          )}
          {filtered.map(o => (
            <div
              key={o.id}
              onClick={() => setSelected(o)}
              style={{
                padding: '14px 16px', cursor: 'pointer', borderBottom: '1px solid #111',
                background: selected?.id === o.id ? '#161616' : 'transparent',
                borderLeft: `3px solid ${selected?.id === o.id ? '#fff' : 'transparent'}`,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <span style={{ color: '#fff', fontWeight: 700, fontSize: 14 }}>
                    {o.table_label ?? `Стол ${o.table_number}`}
                  </span>
                  <span style={{ color: '#444', fontSize: 12, marginLeft: 8 }}>{o.floor_name}</span>
                </div>
                <span style={{ color: '#fff', fontWeight: 700 }}>€{o.total.toFixed(2)}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 5 }}>
                <StatusDot color={STATUS_COLOR[o.status] ?? '#555'} />
                <span style={{ color: '#444', fontSize: 12 }}>{o.items.length} поз. · {timeAgo(o.opened_at)}</span>
                {/* Pending items alert */}
                {o.items.filter(i => i.status === 'pending').length > 0 && (
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#f97316', background: '#f9731622', padding: '1px 6px', borderRadius: 4 }}>
                    {o.items.filter(i => i.status === 'pending').length} не отправлено
                  </span>
                )}
                {o.items.filter(i => i.status === 'ready').length > 0 && (
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#22c55e', background: '#22c55e22', padding: '1px 6px', borderRadius: 4 }}>
                    {o.items.filter(i => i.status === 'ready').length} готово
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Right: detail */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 28, background: '#0a0a0a' }}>
        {selected ? (
          <div style={{ maxWidth: 520 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24 }}>
              <div>
                <h2 style={{ color: '#fff', fontSize: 22, fontWeight: 800, margin: 0 }}>
                  {selected.table_label ?? `Стол ${selected.table_number}`}
                </h2>
                <div style={{ color: '#444', fontSize: 13, marginTop: 4 }}>
                  {selected.floor_name} · {selected.guests} гост. · Открыт {timeAgo(selected.opened_at)} назад
                </div>
              </div>
              <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 8, background: (STATUS_COLOR[selected.status] ?? '#555') + '22', color: STATUS_COLOR[selected.status] ?? '#555', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {selected.status === 'open' ? 'Открыт' : selected.status === 'paid' ? 'Оплачен' : selected.status}
              </span>
            </div>

            {/* Items */}
            <div style={{ background: '#111', border: '1px solid #1a1a1a', borderRadius: 14, overflow: 'hidden', marginBottom: 20 }}>
              {selected.items.map((item, i) => (
                <div key={item.id} style={{ padding: '12px 16px', borderBottom: i < selected.items.length - 1 ? '1px solid #1a1a1a' : 'none', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                  <StatusDot color={ITEM_STATUS_COLOR[item.status] ?? '#333'} />
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: '#fff', fontSize: 14, fontWeight: 500 }}>
                        <span style={{ color: '#555', fontWeight: 700, marginRight: 6 }}>×{item.qty}</span>
                        {item.menu_item_name}
                      </span>
                      <span style={{ color: '#666', fontSize: 13 }}>€{(item.unit_price * item.qty).toFixed(2)}</span>
                    </div>
                    {item.modifier_summary && (
                      <div style={{ color: '#444', fontSize: 12, marginTop: 2 }}>{item.modifier_summary}</div>
                    )}
                    {item.note && (
                      <div style={{ color: '#f97316', fontSize: 12, marginTop: 2 }}>» {item.note}</div>
                    )}
                  </div>
                  <span style={{ fontSize: 10, fontWeight: 700, color: ITEM_STATUS_COLOR[item.status] ?? '#333', textTransform: 'uppercase', letterSpacing: '0.04em', paddingTop: 2 }}>
                    {item.status}
                  </span>
                </div>
              ))}
            </div>

            {/* Totals */}
            <div style={{ background: '#111', border: '1px solid #1a1a1a', borderRadius: 14, padding: '16px 20px' }}>
              <TotalRow label="Сумма" value={`€${selected.subtotal.toFixed(2)}`} />
              {selected.discount_amount > 0 && (
                <TotalRow label="Скидка" value={`-€${selected.discount_amount.toFixed(2)}`} accent="#f97316" />
              )}
              <div style={{ borderTop: '1px solid #1a1a1a', marginTop: 8, paddingTop: 8 }}>
                <TotalRow label="Итого" value={`€${selected.total.toFixed(2)}`} bold />
              </div>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#2a2a2a', fontSize: 14 }}>
            Выбери заказ
          </div>
        )}
      </div>
    </div>
  )
}

function StatMini({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div style={{ padding: '14px 16px', borderRight: '1px solid #111' }}>
      <div style={{ color: '#444', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 3 }}>{label}</div>
      <div style={{ color: accent, fontSize: 20, fontWeight: 800 }}>{value}</div>
    </div>
  )
}

function StatusDot({ color }: { color: string }) {
  return <div style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0, marginTop: 4 }} />
}

function TotalRow({ label, value, accent = '#666', bold = false }: { label: string; value: string; accent?: string; bold?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
      <span style={{ color: bold ? '#fff' : '#444', fontWeight: bold ? 700 : 400, fontSize: 14 }}>{label}</span>
      <span style={{ color: bold ? '#fff' : accent, fontWeight: bold ? 800 : 600, fontSize: bold ? 18 : 14 }}>{value}</span>
    </div>
  )
}
