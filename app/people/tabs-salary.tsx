'use client'
import React, { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { db } from '@/lib/db'
import { notify as pushNotify } from '@/lib/notifyClient'
import { renderNotify, renderCategory, renderSegments } from '@/lib/notifyStrings'
import { useTheme } from '@/hooks/useTheme'
import { AuthGate } from '@/components/AuthGate'
import { AppSwitchBrand } from '@/components/AppSwitchBrand'
import { useI18n } from '@/lib/i18n'
import { fmtDate } from '@/lib/format'
import { tCurrent } from '@/lib/i18n'
import { ScheduleTab } from '@/components/people/ScheduleTab'
import { btnB2, inp, lbl, clock, hoursOf, fmtHours, HistoryList } from './shared'
import { mondayOf, addDays, hhmm, timeRange, dayLabel, navBtn, roleLabel, getMe, Sheet, Placeholder, DOW_SHORT, DOW_FULL, MON } from '@/components/people/helpers'


// Зарплата, Уведомления, настройки уведомлений
// Распил page.tsx (Д2, 2026-07-18): секция вынесена без изменений логики.
// ── SALARY TAB ───────────────────────────────────────────────────────────────────
// Сотрудник видит свой расчёт; менеджер — фонд ЗП и разбивку по каждому.
// Источники: employees.salary/deduct_per_absence, shift_absences (даты пропусков),
// monthly_card_amounts (на карту), attendance_records (отработанные часы).
// Связь attendance(staff)↔employees — по имени (как в остальном коде; настоящий FK — в плане автоматизации).
const eur = (n: number) => `€${Math.round(n).toLocaleString('de-DE')}`
const absDate = (d: string) => new Date(d).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })

export function SalaryTab({ me, isManager, accent, t }: { me: any; isManager: boolean; accent: string; t: any }) {
  const { t: tr } = useI18n()
  const [viewDate, setViewDate] = useState(new Date())
  const ym = fmtDate(viewDate).slice(0, 7)
  const isCurrentMonth = ym === fmtDate(new Date()).slice(0, 7)
  const monthLabel = viewDate.toLocaleDateString(tr('dash.locale'), { month: 'long', year: 'numeric' })
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState<any[]>([])
  const [open, setOpen] = useState<string | null>(null)
  const [payFor, setPayFor] = useState<any | null>(null)
  const [debt, setDebt] = useState<{ total: number; byId: Record<string, number> }>({ total: 0, byId: {} })
  const [payoutDay, setPayoutDay] = useState<number | null>(null)

  // Расчёт зарплаты за произвольный месяц (targetYm) — канон = iOS (PeopleView.loadSalary,
  // решение 2026-07-17): авансы вычитаются, карта строго помесячная (БЕЗ fallback на
  // employees.card_amount), авто-прогулы (source='auto' — черновики крона) деньги не удерживают.
  // salary_payments — факт фактической выдачи (People→Зарплата, ЗП-долг 2026-07-28): уменьшает
  // остаток независимо от аванса; monthly_card_amounts не трогаем (юзер: сумма всегда ручная).
  const computeMonth = async (targetYm: string) => {
    const monthStart = `${targetYm}-01`
    const monthEnd = fmtDate(new Date(Number(targetYm.slice(0, 4)), Number(targetYm.slice(5, 7)), 0))
    const [{ data: emps }, { data: abs }, { data: cards }, { data: att }, { data: dir }, { data: advs }, { data: pays }] = await Promise.all([
      db.from('employees').select('id, name, salary, deduct_per_absence').eq('is_active', true).order('name'),
      db.from('shift_absences').select('employee_id, date, source').gte('date', monthStart).lte('date', monthEnd),
      db.from('monthly_card_amounts').select('employee_id, card_amount').eq('month', targetYm),
      db.from('attendance_records').select('staff_id, check_in_at, check_out_at, date').gte('date', monthStart).lte('date', monthEnd),
      db.from('staff_directory').select('id, name').eq('is_active', true),
      db.from('salary_advances').select('*').gte('date', monthStart).lte('date', monthEnd),
      db.from('salary_payments').select('*').eq('period', monthStart),
    ])
    const staffName: Record<string, string> = {}; (dir || []).forEach((s: any) => { staffName[s.id] = s.name })
    const hoursByName: Record<string, number> = {}
    ;(att || []).forEach((r: any) => { const n = staffName[r.staff_id]; if (n) hoursByName[n] = (hoursByName[n] || 0) + hoursOf(r) })
    const cardByEmp: Record<string, number> = {}; (cards || []).forEach((c: any) => { cardByEmp[c.employee_id] = Number(c.card_amount || 0) })
    const absByEmp: Record<string, string[]> = {}
    ;(abs || []).forEach((a: any) => { if (a.source !== 'auto') (absByEmp[a.employee_id] = absByEmp[a.employee_id] || []).push(a.date) })
    const advByEmp: Record<string, number> = {}
    ;(advs || []).forEach((a: any) => { advByEmp[a.employee_id] = (advByEmp[a.employee_id] || 0) + Number(a.amount || 0) })
    const paidByEmp: Record<string, number> = {}; const lastPaidByEmp: Record<string, string> = {}
    ;(pays || []).forEach((p: any) => {
      paidByEmp[p.employee_id] = (paidByEmp[p.employee_id] || 0) + Number(p.amount || 0)
      if (!lastPaidByEmp[p.employee_id] || p.paid_at > lastPaidByEmp[p.employee_id]) lastPaidByEmp[p.employee_id] = p.paid_at
    })
    return (emps || []).map((e: any) => {
      const salary = Number(e.salary || 0)
      const dates = (absByEmp[e.id] || []).sort()
      const deduct = dates.length * Number(e.deduct_per_absence || 0)
      const card = cardByEmp[e.id] ?? 0
      const advance = advByEmp[e.id] || 0
      const paid = paidByEmp[e.id] || 0
      const total = Math.max(0, salary - deduct)
      const cash = Math.max(0, total - advance - card)
      const remaining = Math.max(0, cash - paid)
      return { id: e.id, name: e.name, salary, dates, absences: dates.length, deduct, card, advance, paid, remaining, total, cash, lastPaidAt: lastPaidByEmp[e.id] || null, hours: hoursByName[e.name] || 0 }
    })
  }

  const load = async () => {
    setLoading(true)
    const list = await computeMonth(ym)
    setRows(isManager ? list : list.filter((r: any) => r.name === me.name))
    setLoading(false)
  }
  useEffect(() => { load() }, [ym])

  // Буфер до реального дня выплаты (salary_payout_day, ЗП-долг 2026-07-28): ЗП за месяц
  // выдаётся 10-15 числа СЛЕДУЮЩЕГО месяца, поэтому 100% начисления должно достигаться не
  // в конце текущего месяца, а на payout_day следующего — иначе владелец видит «нехватку»
  // инкассации задолго до реального срока выплаты.
  useEffect(() => {
    db.from('restaurant_settings').select('salary_payout_day').limit(1).then(({ data }: any) => {
      const r = Array.isArray(data) ? data[0] : data
      setPayoutDay(r?.salary_payout_day ?? null)
    })
  }, [])

  // Задолженность = сумма непокрытого остатка по всем ЗАКРЫТЫМ месяцам (строго раньше
  // текущего), окно 6 месяцев назад — дальше долг копить маловероятно, а пересчёт дороже
  // (7 запросов на каждый месяц).
  const loadDebt = async () => {
    if (!isManager) return
    const now = new Date()
    let total = 0; const byId: Record<string, number> = {}
    for (let i = 1; i <= 6; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const list = await computeMonth(fmtDate(d).slice(0, 7))
      list.forEach((r: any) => { if (r.remaining > 0) { total += r.remaining; byId[r.id] = (byId[r.id] || 0) + r.remaining } })
    }
    setDebt({ total, byId })
  }
  useEffect(() => { loadDebt() }, [isManager])

  const changeMonth = (dir: number) => { const d = new Date(viewDate); d.setDate(1); d.setMonth(d.getMonth() + dir); setViewDate(d) }

  const savePayment = async () => {
    if (!payFor) return
    const amount = Number(payFor.amount) || 0
    if (amount <= 0) return
    await db.from('salary_payments').insert({
      employee_id: payFor.id, period: `${ym}-01`, amount, method: payFor.method || 'cash',
      paid_at: new Date(payFor.date || fmtDate(new Date())).toISOString(),
      note: payFor.note || null, created_by: me.id || null,
    })
    setPayFor(null)
    await load(); await loadDebt()
  }

  // Статус выплаты для карточки сотрудника: только если начисление в этом месяце вообще есть.
  const payStatus = (r: any) => {
    if (r.total <= 0) return null
    if (r.remaining <= 0) return { label: r.lastPaidAt ? tr('pe.paidOn', { date: absDate(r.lastPaidAt) }) : tr('pe.paidStatus'), color: t.green }
    return { label: tr('pe.oweAmount', { amount: eur(r.remaining) }), color: t.orange }
  }
  const daysInMonth = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 0).getDate()
  const accruedToday = (total: number) => {
    if (!isCurrentMonth) return total
    const denom = payoutDay ? daysInMonth + payoutDay : daysInMonth
    return total * Math.min(new Date().getDate(), denom) / denom
  }

  const MonthNav = () => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
      <button onClick={() => changeMonth(-1)} style={{ width: 34, height: 34, borderRadius: '50%', background: t.fill, border: 'none', color: t.text, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <svg width="8" height="15" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" viewBox="0 0 10 18"><path d="M8 1L1 9l7 8" /></svg>
      </button>
      <div style={{ flex: 1, textAlign: 'center', fontSize: 13, fontWeight: 700, color: t.text3, textTransform: 'uppercase', letterSpacing: 0.5 }}>{monthLabel}</div>
      <button onClick={() => !isCurrentMonth && changeMonth(1)} disabled={isCurrentMonth} style={{ width: 34, height: 34, borderRadius: '50%', background: t.fill, border: 'none', color: isCurrentMonth ? t.text3 : t.text, opacity: isCurrentMonth ? 0.35 : 1, cursor: isCurrentMonth ? 'default' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <svg width="8" height="15" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" viewBox="0 0 10 18"><path d="M2 1l7 8-7 8" /></svg>
      </button>
    </div>
  )

  if (loading) return <div style={{ textAlign: 'center', padding: 40, color: t.text3 }}>{tr('pe.loading')}</div>
  if (rows.length === 0) return (
    <div style={{ textAlign: 'center', padding: '60px 20px', color: t.text3 }}>
      <div style={{ width: 72, height: 72, borderRadius: 20, background: `${accent}14`, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
        <svg width="34" height="34" fill="none" stroke={accent} strokeWidth="1.6" viewBox="0 0 24 24"><rect x="2" y="6" width="20" height="13" rx="2" /><path d="M2 10h20M6 15h4" /></svg>
      </div>
      <div style={{ fontWeight: 600, fontSize: 16, color: t.text2 }}>{tr('pe.noSalaryData')}</div>
      <div style={{ fontSize: 13, marginTop: 4 }}>{tr('pe.salarySetInDash')}</div>
    </div>
  )

  // Детальная разбивка одного сотрудника (используется и у сотрудника, и в раскрытой карточке менеджера).
  const Breakdown = ({ r }: { r: any }) => {
    const st = payStatus(r)
    return (
      <div style={{ background: t.surface, borderRadius: 16, overflow: 'hidden', boxShadow: t.sh, marginBottom: 8 }}>
        {[
          { _l: tr('pe.salaryBase'), v: eur(r.salary), c: t.text, hide: false },
          { _l: tr('pe.worked'), v: fmtHours(r.hours, tr), c: t.text2, hide: r.hours <= 0 },
          { _l: tr('pe.absencesN', { n: r.absences }), v: r.dates.map(absDate).join(', '), c: t.text2, small: true, hide: r.absences === 0 },
          { _l: tr('pe.absenceDeduct'), v: `−${eur(r.deduct)}`, c: t.red, hide: r.deduct === 0 },
          { _l: tr('pe.toCard'), v: eur(r.card), c: t.blue, hide: r.card === 0 },
          { _l: tr('pe.advances'), v: `−${eur(r.advance)}`, c: t.orange, hide: !r.advance },
          { _l: tr('pe.inCash'), v: eur(r.cash), c: t.green, hide: false },
        ].filter((x: any) => !x.hide).map((x: any, i, arr) => (
          <div key={x._l} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 16px', borderBottom: i < arr.length - 1 ? `0.5px solid ${t.sep2}` : 'none' }}>
            <span style={{ fontSize: 14, color: t.text2, flexShrink: 0 }}>{x._l}</span>
            <span style={{ fontSize: x.small ? 12 : 15, fontWeight: x.small ? 500 : 700, color: x.c, textAlign: 'right' }}>{x.v}</span>
          </div>
        ))}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 16px', background: `${accent}0d` }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: t.text }}>{tr('pe.totalPayout')}</span>
          <span style={{ fontSize: 18, fontWeight: 800, color: accent }}>{eur(r.total)}</span>
        </div>
        {st && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', borderTop: `0.5px solid ${t.sep2}` }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: st.color }}>{st.label}</span>
            {isManager && r.remaining > 0 && (
              <button onClick={() => setPayFor({ id: r.id, name: r.name, amount: String(Math.round(r.remaining)), method: 'cash', date: fmtDate(new Date()), note: '' })}
                style={{ padding: '6px 12px', borderRadius: 980, background: accent, color: '#fff', border: 'none', fontFamily: 'inherit', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                {tr('pe.markPaid')}
              </button>
            )}
          </div>
        )}
      </div>
    )
  }

  // ── Сотрудник: свой расчёт ──
  if (!isManager) {
    const r = rows[0]
    const st = payStatus(r)
    return (
      <div>
        <MonthNav />
        <div style={{ background: `linear-gradient(135deg, ${accent}, ${accent}cc)`, borderRadius: 20, padding: '22px 20px', marginBottom: 12, color: '#fff', boxShadow: `0 8px 28px ${accent}3a` }}>
          <div style={{ fontSize: 13, fontWeight: 600, opacity: 0.85 }}>{tr('pe.toPayout')}</div>
          <div style={{ fontSize: 38, fontWeight: 800, letterSpacing: -1, marginTop: 2 }}>{eur(r.total)}</div>
          <div style={{ display: 'flex', gap: 16, marginTop: 10, fontSize: 13, fontWeight: 600, opacity: 0.92 }}>
            {r.card > 0 && <span>{tr('pe.toCard')} {eur(r.card)}</span>}
            <span>{tr('pe.inCash')} {eur(r.cash)}</span>
          </div>
          {st && <div style={{ marginTop: 10, fontSize: 13, fontWeight: 700, opacity: 0.95 }}>{st.label}</div>}
        </div>
        <Breakdown r={r} />
        <div style={{ fontSize: 12, color: t.text4, textAlign: 'center', padding: '4px 16px' }}>{tr('pe.salaryCalcNote', { month: monthLabel })}</div>
      </div>
    )
  }

  // ── Менеджер: фонд ЗП + разбивка по каждому ──
  const fund = rows.reduce((s, r) => s + r.total, 0)
  const cardTotal = rows.reduce((s, r) => s + r.card, 0)
  return (
    <div>
      <MonthNav />
      {debt.total > 0 && (
        <div style={{ background: `${t.red}12`, borderRadius: 16, padding: '14px 16px', marginBottom: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: t.red, textTransform: 'uppercase', letterSpacing: 0.4 }}>{tr('pe.debtTitle')}</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: t.red, marginTop: 2 }}>{eur(debt.total)}</div>
          <div style={{ fontSize: 12, color: t.text3, marginTop: 3 }}>{tr('pe.debtHint')}</div>
        </div>
      )}
      <div style={{ background: `linear-gradient(135deg, ${accent}, ${accent}cc)`, borderRadius: 20, padding: '20px', marginBottom: 14, color: '#fff', boxShadow: `0 8px 28px ${accent}3a` }}>
        <div style={{ fontSize: 13, fontWeight: 600, opacity: 0.85 }}>{tr('pe.toPayoutTotal')}</div>
        <div style={{ fontSize: 34, fontWeight: 800, letterSpacing: -1, marginTop: 2 }}>{eur(fund)}</div>
        <div style={{ display: 'flex', gap: 16, marginTop: 8, fontSize: 13, fontWeight: 600, opacity: 0.92 }}>
          <span>{tr('pe.staffCountShort', { n: rows.length })}</span>
          {cardTotal > 0 && <span>{tr('pe.toCard')} {eur(cardTotal)}</span>}
          <span>{tr('pe.inCash')} {eur(fund - cardTotal)}</span>
        </div>
        {isCurrentMonth && (
          <div style={{ marginTop: 10, fontSize: 12, opacity: 0.85 }}>
            {tr('pe.accruedToday')} {eur(accruedToday(fund))} · {tr('pe.accruedTodayHint')}
          </div>
        )}
      </div>
      {rows.map(r => {
        const st = payStatus(r)
        return (
          <div key={r.id} style={{ marginBottom: 8 }}>
            <button onClick={() => setOpen(open === r.id ? null : r.id)} style={{ width: '100%', textAlign: 'left', background: t.surface, borderRadius: 16, padding: '14px 16px', boxShadow: t.sh, border: 'none', cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: t.text }}>{r.name}</div>
                <div style={{ fontSize: 12, color: t.text3, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {tr('pe.salaryBase')} {eur(r.salary)}{r.absences > 0 ? ` · −${r.absences} ${tr('pe.absShort')}` : ''}{r.card > 0 ? ` · ${tr('pe.cardWord')} ${eur(r.card)}` : ''}
                </div>
                {st && <div style={{ fontSize: 12, fontWeight: 600, color: st.color, marginTop: 3 }}>{st.label}</div>}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                <span style={{ fontSize: 16, fontWeight: 800, color: accent }}>{eur(r.total)}</span>
                <svg width="14" height="14" fill="none" stroke={t.text3} strokeWidth="2.2" viewBox="0 0 24 24" style={{ transform: open === r.id ? 'rotate(90deg)' : 'none', transition: 'transform .2s' }}><path d="M9 6l6 6-6 6" /></svg>
              </div>
            </button>
            {open === r.id && <div style={{ marginTop: 8, animation: 'fadeUp .18s ease' }}><Breakdown r={r} /></div>}
          </div>
        )
      })}
      {payFor && (
        <Sheet onClose={() => setPayFor(null)} t={t}>
          <div style={{ padding: '4px 20px 24px' }}>
            <div style={{ fontSize: 17, fontWeight: 700, color: t.text, marginBottom: 14 }}>{tr('pe.markPaid')} · {payFor.name}</div>
            <label style={lbl(t)}>{tr('pe.paymentAmount')}</label>
            <input type="number" inputMode="decimal" value={payFor.amount} onChange={e => setPayFor({ ...payFor, amount: e.target.value })} style={inp(t)} />
            <label style={{ ...lbl(t), marginTop: 12 }}>{tr('pe.paymentMethod')}</label>
            <div style={{ display: 'flex', gap: 8 }}>
              {(['cash', 'card'] as const).map(m => (
                <button key={m} onClick={() => setPayFor({ ...payFor, method: m })} style={{ flex: 1, padding: '10px 0', borderRadius: 12, border: 'none', fontFamily: 'inherit', fontSize: 14, fontWeight: payFor.method === m ? 700 : 500, cursor: 'pointer', background: payFor.method === m ? accent : t.fill, color: payFor.method === m ? '#fff' : t.text3 }}>
                  {tr(m === 'cash' ? 'pe.methodCash' : 'pe.methodCard')}
                </button>
              ))}
            </div>
            <label style={{ ...lbl(t), marginTop: 12 }}>{tr('pe.paymentDate')}</label>
            <input type="date" value={payFor.date} onChange={e => setPayFor({ ...payFor, date: e.target.value })} style={inp(t)} />
            <label style={{ ...lbl(t), marginTop: 12 }}>{tr('pe.paymentNote')}</label>
            <input type="text" value={payFor.note} onChange={e => setPayFor({ ...payFor, note: e.target.value })} style={inp(t)} />
            <button onClick={savePayment} style={{ width: '100%', marginTop: 18, padding: '14px', borderRadius: 14, background: accent, color: '#fff', border: 'none', fontFamily: 'inherit', fontSize: 15, fontWeight: 700, cursor: 'pointer', boxShadow: `0 4px 16px ${accent}44` }}>{tr('pe.savePayment')}</button>
          </div>
        </Sheet>
      )}
    </div>
  )
}

// ── NOTIFICATIONS TAB ────────────────────────────────────────────────────────────

export function NotificationsTab({ myId, accent, t }: { myId: string; accent: string; t: any }) {
  const { t: tr, locale } = useI18n()
  const [items, setItems] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  // Запись хранит title/body как EN-фолбэк + *_key/*_params — перерендериваем на языке
  // ЗРИТЕЛЯ (а не отправителя, каким текст был бы без ключей). См. AUDIT-2026-07-12.md #3.
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

  useEffect(() => {
    db.from('notifications').select('*').eq('staff_id', myId).order('created_at', { ascending: false }).limit(50)
      .then(async ({ data }: any) => {
        setItems(data || []); setLoading(false)
        const unread = (data || []).filter((n: any) => !n.read_at).map((n: any) => n.id)
        if (unread.length) await db.from('notifications').update({ read_at: new Date().toISOString() }).in('id', unread)
      })
  }, [myId])

  if (loading) return <div style={{ textAlign: 'center', padding: 40, color: t.text3 }}>{tr('pe.loading')}</div>
  if (items.length === 0) return (
    <div style={{ textAlign: 'center', padding: '60px 20px', color: t.text3 }}>
      <div style={{ width: 72, height: 72, borderRadius: 20, background: `${accent}14`, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
        <svg width="34" height="34" fill="none" stroke={accent} strokeWidth="1.6" viewBox="0 0 24 24"><path d="M18 8a6 6 0 00-12 0c0 7-3 9-3 9h18s-3-2-3-9" /></svg>
      </div>
      <div style={{ fontWeight: 600, fontSize: 16, color: t.text2 }}>{tr('pe.noNotifs')}</div>
      <div style={{ fontSize: 13, marginTop: 4 }}>{tr('pe.noNotifsHint')}</div>
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {items.map(n => (
        <div key={n.id} style={{ background: t.surface, borderRadius: 14, padding: '14px 16px', boxShadow: t.sh, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: n.read_at ? 'transparent' : accent, marginTop: 6, flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: t.text }}>{renderTitle(n)}</div>
            {n.body && <div style={{ fontSize: 13, color: t.text3, marginTop: 2 }}>{renderBody(n)}</div>}
            <div style={{ fontSize: 11, color: t.text4, marginTop: 4 }}>{new Date(n.created_at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</div>
          </div>
        </div>
      ))}
    </div>
  )
}

// ── NOTIFICATION SETTINGS (персональные тумблеры) ──────────────────────────────

export function Toggle({ on, onToggle, accent, t }: { on: boolean; onToggle: () => void; accent: string; t: any }) {
  return (
    <button onClick={onToggle} style={{ width: 50, height: 30, borderRadius: 15, border: 'none', cursor: 'pointer', background: on ? accent : t.fill, position: 'relative', transition: 'background .2s', flexShrink: 0 }}>
      <span style={{ position: 'absolute', top: 3, left: on ? 23 : 3, width: 24, height: 24, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.3)', transition: 'left .2s' }} />
    </button>
  )
}

export function NotificationSettings({ me, isManager, accent, t }: { me: any; isManager: boolean; accent: string; t: any }) {
  const { t: tr } = useI18n()
  const isOwner = !!me.is_owner
  const [prefs, setPrefs] = useState<Record<string, any> | null>(null)
  const [rowId, setRowId] = useState<string | null>(null)

  useEffect(() => {
    const q = isOwner
      ? db.from('notification_prefs').select('*').eq('to_owner', true)
      : db.from('notification_prefs').select('*').eq('staff_id', me.id)
    q.then(({ data }: any) => { const row = (data || [])[0]; setRowId(row?.id || null); setPrefs(row?.prefs || {}) })
  }, [])

  const persist = async (next: Record<string, any>) => {
    setPrefs(next)
    if (rowId) {
      await db.from('notification_prefs').update({ prefs: next, updated_at: new Date().toISOString() }).eq('id', rowId)
    } else {
      const { data } = await db.from('notification_prefs').insert(isOwner ? { to_owner: true, prefs: next } : { staff_id: me.id, prefs: next }).select().single()
      if (data?.id) setRowId(data.id)
    }
  }
  const toggle = (k: string) => persist({ ...(prefs || {}), [k]: !(prefs?.[k] !== false) })
  const setVal = (k: string, v: any) => persist({ ...(prefs || {}), [k]: v })
  const isOn = (k: string) => prefs?.[k] !== false   // нет ключа = включено

  if (!prefs) return <div style={{ textAlign: 'center', padding: 30, color: t.text3 }}>{tr('pe.loading')}</div>

  const Row = ({ k, label }: { k: string; label: string }) => (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 0', borderBottom: `0.5px solid ${t.sep2}` }}>
      <span style={{ fontSize: 15, color: t.text }}>{label}</span>
      <Toggle on={isOn(k)} onToggle={() => toggle(k)} accent={accent} t={t} />
    </div>
  )

  return (
    <div>
      <Row k="shift_reminder" label={tr('pe.nsShiftReminder')} />
      <Row k="task" label={tr('pe.nsTask')} />
      <Row k="swap" label={tr('pe.nsSwap')} />

      {isManager && (
        <>
          <div style={{ fontSize: 11, fontWeight: 700, color: t.text3, textTransform: 'uppercase', letterSpacing: .4, margin: '20px 0 4px' }}>{tr('pe.nsForManagers')}</div>
          <Row k="attendance" label={tr('pe.nsAttendance')} />
          <Row k="cash_open" label={tr('pe.nsCashOpen')} />
          <Row k="cash_close" label={tr('pe.nsCashClose')} />
          <Row k="salary_payout" label={tr('pe.nsSalaryPayout')} />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 0', borderBottom: `0.5px solid ${t.sep2}` }}>
            <span style={{ fontSize: 15, color: t.text }}>{tr('pe.nsShowAmount')}</span>
            <Toggle on={prefs.show_cash_amount === true} onToggle={() => setVal('show_cash_amount', !(prefs.show_cash_amount === true))} accent={accent} t={t} />
          </div>
          <Row k="purchase" label={tr('pe.nsPurchase')} />
          <div style={{ padding: '13px 0' }}>
            <div style={{ fontSize: 15, color: t.text, marginBottom: 10 }}>{tr('pe.nsPurchaseMode')}</div>
            <div style={{ display: 'flex', background: t.fill, borderRadius: 12, padding: 3, gap: 2 }}>
              {([['each', tr('pe.nsEach')], ['daily', tr('pe.nsDaily')]] as const).map(([id, label]) => {
                const cur = prefs.purchase_digest === 'daily' ? 'daily' : 'each'
                return <button key={id} onClick={() => setVal('purchase_digest', id)} style={{ flex: 1, padding: '8px 0', borderRadius: 10, border: 'none', fontFamily: 'inherit', fontSize: 13, fontWeight: cur === id ? 700 : 500, cursor: 'pointer', background: cur === id ? t.surface : 'transparent', color: cur === id ? accent : t.text3, boxShadow: cur === id ? t.sh2 : 'none' }}>{label}</button>
              })}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

