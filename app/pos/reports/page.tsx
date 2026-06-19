'use client'
import { useEffect, useState } from 'react'

type Session = {
  id: string
  opened_at: string
  closed_at: string | null
  opening_cash: number
  closing_cash_actual: number | null
  total_sales: number
  total_cash: number
  total_card: number
  total_discount: number
  total_comps: number
  status: string
  payins: { amount: number; note: string | null }[]
  payouts: { amount: number; note: string | null }[]
}

function fmt(n: number) { return `€${n.toFixed(2)}` }
function date(iso: string) { return new Date(iso).toLocaleDateString('ru', { day: '2-digit', month: 'short', year: 'numeric' }) }
function time(iso: string) { return new Date(iso).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' }) }
function dur(open: string, close: string | null) {
  if (!close) return 'Открыта'
  const mins = Math.floor((new Date(close).getTime() - new Date(open).getTime()) / 60000)
  return mins < 60 ? `${mins}м` : `${Math.floor(mins / 60)}ч ${mins % 60}м`
}

export default function ReportsPage() {
  const [sessions, setSessions] = useState<Session[]>([])
  const [selected, setSelected] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/pos/sessions?limit=30').then(r => r.json()).then(d => {
      setSessions(d.sessions ?? [])
      const closed = (d.sessions ?? []).find((s: Session) => s.status === 'closed')
      if (closed) setSelected(closed)
      setLoading(false)
    })
  }, [])

  const totalRevenue = sessions.filter(s => s.status === 'closed').reduce((s, x) => s + x.total_sales, 0)

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      {/* Sidebar — session list */}
      <div style={{ width: 260, background: '#0d0d0d', borderRight: '1px solid #1a1a1a', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '16px 16px 8px' }}>
          <div style={{ color: '#444', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Смены</div>
          <div style={{ color: '#fff', fontSize: 22, fontWeight: 800, marginTop: 6 }}>{fmt(totalRevenue)}</div>
          <div style={{ color: '#444', fontSize: 12 }}>последние 30 смен</div>
        </div>

        <div style={{ borderTop: '1px solid #1a1a1a', flex: 1, overflowY: 'auto' }}>
          {loading && <div style={{ color: '#333', fontSize: 13, padding: 20 }}>Загрузка...</div>}
          {sessions.map(s => (
            <div
              key={s.id}
              onClick={() => setSelected(s)}
              style={{
                padding: '12px 16px', cursor: 'pointer', borderBottom: '1px solid #111',
                background: selected?.id === s.id ? '#1a1a1a' : 'transparent',
                borderLeft: `2px solid ${selected?.id === s.id ? '#fff' : 'transparent'}`,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ color: '#fff', fontSize: 13, fontWeight: 600 }}>{date(s.opened_at)}</div>
                  <div style={{ color: '#444', fontSize: 11, marginTop: 2 }}>
                    {time(s.opened_at)} · {dur(s.opened_at, s.closed_at)}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ color: s.status === 'closed' ? '#fff' : '#22c55e', fontWeight: 700, fontSize: 13 }}>{fmt(s.total_sales)}</div>
                  {s.status === 'open' && (
                    <div style={{ fontSize: 10, color: '#22c55e', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Открыта</div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Z-Report */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 32, background: '#0a0a0a' }}>
        {selected ? (
          <div style={{ maxWidth: 540 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 }}>
              <div>
                <div style={{ color: '#fff', fontSize: 22, fontWeight: 800 }}>
                  {selected.status === 'closed' ? 'Z-Отчёт' : 'X-Отчёт (смена открыта)'}
                </div>
                <div style={{ color: '#444', fontSize: 13, marginTop: 4 }}>
                  {date(selected.opened_at)} · {time(selected.opened_at)}
                  {selected.closed_at ? ` — ${time(selected.closed_at)}` : ' — сейчас'}
                </div>
              </div>
              <button
                onClick={() => printReport(selected)}
                style={{ padding: '9px 18px', background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 10, color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
              >
                Экспорт
              </button>
            </div>

            {/* Duration card */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 20 }}>
              <ReportCard label="Длительность смены" value={dur(selected.opened_at, selected.closed_at)} />
              <ReportCard label="Нач. остаток кассы" value={fmt(selected.opening_cash)} />
            </div>

            {/* Revenue breakdown */}
            <Section title="Продажи">
              <ReportRow label="Итого продаж" value={fmt(selected.total_sales)} bold accent="#fff" />
              <ReportRow label="Наличными" value={fmt(selected.total_cash)} />
              <ReportRow label="Картой" value={fmt(selected.total_card)} />
              {selected.total_discount > 0 && <ReportRow label="Скидки" value={fmt(selected.total_discount)} accent="#f97316" />}
              {selected.total_comps > 0 && <ReportRow label="Комплименты" value={fmt(selected.total_comps)} accent="#a855f7" />}
            </Section>

            {/* Cash movements */}
            {(selected.payins.length > 0 || selected.payouts.length > 0) && (
              <Section title="Движение наличных">
                {selected.payins.map((p, i) => (
                  <ReportRow key={i} label={`Внесение: ${p.note ?? '—'}`} value={`+${fmt(p.amount)}`} accent="#22c55e" />
                ))}
                {selected.payouts.map((p, i) => (
                  <ReportRow key={i} label={`Изъятие: ${p.note ?? '—'}`} value={`-${fmt(p.amount)}`} accent="#f97316" />
                ))}
              </Section>
            )}

            {/* Cash reconciliation */}
            <Section title="Сверка кассы">
              {(() => {
                const expected = selected.opening_cash + selected.total_cash
                  + selected.payins.reduce((s, p) => s + p.amount, 0)
                  - selected.payouts.reduce((s, p) => s + p.amount, 0)
                const actual = selected.closing_cash_actual
                const diff = actual != null ? actual - expected : null
                return (
                  <>
                    <ReportRow label="Ожидаемый остаток" value={fmt(expected)} />
                    {actual != null ? (
                      <>
                        <ReportRow label="Фактический остаток" value={fmt(actual)} />
                        <ReportRow
                          label="Расхождение"
                          value={(diff! >= 0 ? '+' : '') + fmt(diff!)}
                          accent={Math.abs(diff!) < 1 ? '#22c55e' : '#ff4444'}
                          bold
                        />
                      </>
                    ) : (
                      <div style={{ color: '#333', fontSize: 13, padding: '8px 0' }}>Смена ещё не закрыта</div>
                    )}
                  </>
                )
              })()}
            </Section>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#2a2a2a', fontSize: 14 }}>
            Выбери смену слева
          </div>
        )}
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ color: '#444', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>{title}</div>
      <div style={{ background: '#111', border: '1px solid #1a1a1a', borderRadius: 12, overflow: 'hidden' }}>
        {children}
      </div>
    </div>
  )
}

function ReportCard({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: '#111', border: '1px solid #1a1a1a', borderRadius: 12, padding: '14px 16px' }}>
      <div style={{ color: '#444', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>{label}</div>
      <div style={{ color: '#fff', fontSize: 18, fontWeight: 800 }}>{value}</div>
    </div>
  )
}

function ReportRow({ label, value, bold = false, accent = '#555' }: { label: string; value: string; bold?: boolean; accent?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '11px 16px', borderBottom: '1px solid #1a1a1a' }}>
      <span style={{ color: bold ? '#fff' : '#666', fontSize: 14, fontWeight: bold ? 700 : 400 }}>{label}</span>
      <span style={{ color: bold ? '#fff' : accent, fontSize: 14, fontWeight: bold ? 800 : 600 }}>{value}</span>
    </div>
  )
}

function printReport(s: Session) {
  const lines = [
    `Z-ОТЧЁТ`,
    `${date(s.opened_at)} ${time(s.opened_at)}${s.closed_at ? ' — ' + time(s.closed_at) : ''}`,
    ``,
    `ПРОДАЖИ ИТОГО: ${fmt(s.total_sales)}`,
    `  Наличные: ${fmt(s.total_cash)}`,
    `  Карта: ${fmt(s.total_card)}`,
    s.total_discount > 0 ? `  Скидки: ${fmt(s.total_discount)}` : '',
    ``,
    `Нач. остаток: ${fmt(s.opening_cash)}`,
    s.closing_cash_actual != null ? `Факт. остаток: ${fmt(s.closing_cash_actual)}` : '',
  ].filter(l => l !== undefined)

  const blob = new Blob([lines.join('\n')], { type: 'text/plain' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `z-report-${s.opened_at.slice(0, 10)}.txt`
  a.click()
}
