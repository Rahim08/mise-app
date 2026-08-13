'use client'
import React, { useEffect, useState } from 'react'
import { db } from '@/lib/db'
import { useI18n } from '@/lib/i18n'
import { fmtDate } from '@/lib/format'
import { inp, lbl, fmtHours, hoursOf } from '@/app/people/shared'
import { Sheet } from '@/components/people/helpers'

// Manager → Зарплата (реструктура 2026-08-13, см. docs/MANAGER-PEOPLE-RESTRUCTURE-2026-08-13.md).
// Перенесено из app/people/tabs-salary.tsx (там остался только личный вид менеджера, как у
// сотрудника) — фонд ЗП, долг, список сотрудников и кнопка «Оплатить» теперь только здесь.
// Оплата пишет прямо в inkassations.salary/salary_note дня выплаты (паритет с iOS ManagerSalary.swift).

const eur = (n: number) => `€${Math.round(n).toLocaleString('de-DE')}`
const absDate = (d: string) => new Date(d).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })

export function ManagerSalaryTab({ restaurantId, accent, t }: { restaurantId: string; accent: string; t: any }) {
  const { t: tr } = useI18n()
  const [viewDate, setViewDate] = useState(new Date())
  const ym = fmtDate(viewDate).slice(0, 7)
  const isCurrentMonth = ym === fmtDate(new Date()).slice(0, 7)
  const monthLabel = viewDate.toLocaleDateString(tr('dash.locale'), { month: 'long', year: 'numeric' })
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState<any[]>([])
  const [open, setOpen] = useState<string | null>(null)
  const [payFor, setPayFor] = useState<any | null>(null)
  const [payError, setPayError] = useState<string | null>(null)
  const [paying, setPaying] = useState(false)
  const [debt, setDebt] = useState<{ total: number; byId: Record<string, number> }>({ total: 0, byId: {} })
  const [payoutDay, setPayoutDay] = useState<number | null>(null)
  const [toast, setToast] = useState('')
  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(''), 2500) }
  const [advFor, setAdvFor] = useState<{ id: string; name: string } | null>(null)
  const [advAmount, setAdvAmount] = useState('')
  const [advDate, setAdvDate] = useState(fmtDate(new Date()))

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
    const advRowsByEmp: Record<string, any[]> = {}
    ;(advs || []).forEach((a: any) => {
      advByEmp[a.employee_id] = (advByEmp[a.employee_id] || 0) + Number(a.amount || 0)
      ;(advRowsByEmp[a.employee_id] = advRowsByEmp[a.employee_id] || []).push(a)
    })
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
      return { id: e.id, name: e.name, salary, dates, absences: dates.length, deduct, card, advance, advanceRows: (advRowsByEmp[e.id] || []).sort((a, b) => a.date < b.date ? 1 : -1), paid, remaining, total, cash, lastPaidAt: lastPaidByEmp[e.id] || null, hours: hoursByName[e.name] || 0 }
    })
  }

  const load = async () => {
    setLoading(true)
    setRows(await computeMonth(ym))
    setLoading(false)
  }
  useEffect(() => { load() }, [ym])

  const DEBT_TRACKING_START = new Date(2026, 7, 1) // 2026-08-01
  const loadDebt = async () => {
    const now = new Date()
    let total = 0; const byId: Record<string, number> = {}
    for (let i = 1; i <= 6; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      if (d < DEBT_TRACKING_START) continue
      const list = await computeMonth(fmtDate(d).slice(0, 7))
      list.forEach((r: any) => { if (r.remaining > 0) { total += r.remaining; byId[r.id] = (byId[r.id] || 0) + r.remaining } })
    }
    setDebt({ total, byId })
  }
  useEffect(() => { loadDebt() }, [])

  const changeMonth = (dir: number) => { const d = new Date(viewDate); d.setDate(1); d.setMonth(d.getMonth() + dir); setViewDate(d) }

  useEffect(() => {
    db.from('restaurant_settings').select('salary_payout_day').limit(1).then(({ data }: any) => {
      const r = Array.isArray(data) ? data[0] : data
      setPayoutDay(r?.salary_payout_day ?? null)
    })
  }, [])

  // Смена/инкассация на дату оплаты может не существовать — создаём её тем же паттерном,
  // что openShift (opening = closing предыдущей смены, gap-tolerant .lt('date', ...)).
  const ensureShift = async (dateStr: string): Promise<string | null> => {
    const { data: existing } = await db.from('shifts').select('id').eq('restaurant_id', restaurantId).eq('date', dateStr).order('opened_at').limit(1)
    const ex = Array.isArray(existing) ? existing[0] : existing
    if (ex?.id) return ex.id
    const { data: prevList } = await db.from('shifts').select('closing_balance').eq('restaurant_id', restaurantId).lt('date', dateStr).order('date', { ascending: false }).order('opened_at', { ascending: false }).limit(1)
    const opening = (Array.isArray(prevList) ? prevList[0] : prevList)?.closing_balance || 0
    const { data: sh } = await db.from('shifts').insert({
      restaurant_id: restaurantId, date: dateStr,
      opening_balance: opening, income: 0, inkassation: 0,
      closing_balance: opening, status: 'open',
    }).select().single()
    return sh?.id ?? null
  }

  // «На карту» / авансы (2026-08-14, аудит A3/A4 — веб раньше вообще не имел этой
  // функциональности, редактирование жило в app/analytics/page.tsx и было ошибочно ЖИВЫМ,
  // хотя доки называли Analytics read-only; см. docs/MANAGER-RESTRUCTURE-AUDIT-2026-08-13.md).
  // Паритет с iOS ManagerSalary.swift saveMonthlyCard/addAdvance/deleteAdvance — 1:1 логика.
  const saveCard = async (empId: string, value: string) => {
    const amt = Math.max(0, parseFloat(value) || 0)
    const row = rows.find(r => r.id === empId)
    if (row && amt === row.card) return
    const { data: existing } = await db.from('monthly_card_amounts').select('id').eq('employee_id', empId).eq('month', ym).limit(1)
    const ex = Array.isArray(existing) ? existing[0] : existing
    const { error } = ex?.id
      ? await db.from('monthly_card_amounts').update({ card_amount: amt }).eq('id', ex.id)
      : await db.from('monthly_card_amounts').insert({ restaurant_id: restaurantId, employee_id: empId, month: ym, card_amount: amt })
    if (error) { showToast(tr('pe.saveFailed', { err: error.message })); return }
    await load()
  }

  const findShiftForDate = async (dateStr: string) => {
    const { data } = await db.from('shifts').select('id, date, inkassation').eq('restaurant_id', restaurantId).eq('date', dateStr).order('opened_at', { ascending: false }).limit(1)
    return Array.isArray(data) ? data[0] : data
  }
  const findInkassation = async (shiftId: string) => {
    const { data } = await db.from('inkassations').select('shift_id, amount, expense, reason, total, salary').eq('shift_id', shiftId).limit(1)
    return Array.isArray(data) ? data[0] : data
  }

  const addAdvance = async (empId: string, empName: string, amount: number, dateStr: string) => {
    const { error: insErr } = await db.from('salary_advances').insert({ restaurant_id: restaurantId, employee_id: empId, amount, date: dateStr, note: `${empName} аванс` })
    if (insErr) { showToast(tr('pe.saveFailed', { err: insErr.message })); return }
    const shift = await findShiftForDate(dateStr)
    if (shift) {
      const ink = await findInkassation(shift.id)
      const baseAmount = ink?.amount ?? shift.inkassation ?? 0
      const newExpense = (ink?.expense || 0) + amount
      const reasonParts = [ink?.reason || null, `${empName} аванс`].filter(Boolean)
      const newReason = reasonParts.join(', ')
      const newTotal = baseAmount - newExpense - (ink?.salary || 0)
      if (ink) {
        await db.from('inkassations').update({ expense: newExpense, reason: newReason, total: newTotal }).eq('shift_id', shift.id)
      } else {
        await db.from('inkassations').insert({ shift_id: shift.id, restaurant_id: restaurantId, date: dateStr, amount: baseAmount, expense: newExpense, reason: newReason, salary: 0, total: newTotal })
      }
    } else {
      showToast(tr('an.advanceInkassationMissing'))
    }
    await load(); await loadDebt()
  }

  const deleteAdvance = async (a: any, empName: string) => {
    const { error } = await db.from('salary_advances').delete().eq('id', a.id)
    if (error) { showToast(tr('pe.saveFailed', { err: error.message })); return }
    const shift = await findShiftForDate(a.date)
    if (shift) {
      const ink = await findInkassation(shift.id)
      if (ink) {
        const newExpense = Math.max(0, (ink.expense || 0) - Number(a.amount || 0))
        const newReason = (ink.reason || '').split(', ').filter((s: string) => !s.startsWith(`${empName} аванс`)).join(', ')
        const newTotal = (ink.amount ?? shift.inkassation ?? 0) - newExpense - (ink.salary || 0)
        await db.from('inkassations').update({ expense: newExpense, reason: newReason, total: newTotal }).eq('shift_id', shift.id)
      }
    }
    await load(); await loadDebt()
  }

  // Выплата ЗП «прямо из инкассации» — списывает сумму с инкассации дня оплаты
  // (inkassations.salary += amount, salary_note дописывается «Имя: Сумма»). Карта — безнал,
  // кассы не касается. Уход в минус запрещён.
  const savePayment = async () => {
    if (!payFor) return
    const amount = Number(payFor.amount) || 0
    if (amount <= 0) return
    setPaying(true); setPayError(null)
    const method = payFor.method || 'cash'
    const dateStr = payFor.date || fmtDate(new Date())

    if (method === 'cash') {
      const shiftId = await ensureShift(dateStr)
      if (!shiftId) { setPayError(tr('pe.saveFailed', { err: 'shift' })); setPaying(false); return }
      const { data: inkList } = await db.from('inkassations').select('id, amount, expense, salary, salary_note').eq('shift_id', shiftId).limit(1)
      const cur = Array.isArray(inkList) ? inkList[0] : inkList
      const available = (cur?.amount || 0) - (cur?.expense || 0) - (cur?.salary || 0)
      if (amount > available) {
        setPayError(tr('pe.insufficientInkassation', { date: dateStr, avail: eur(Math.max(0, available)) }))
        setPaying(false); return
      }
      const noteEntry = `${payFor.name}: ${eur(amount)}`
      const mergedNote = [cur?.salary_note, noteEntry].filter(Boolean).join('; ')
      const values = { restaurant_id: restaurantId, date: dateStr, salary: (cur?.salary || 0) + amount, salary_note: mergedNote }
      const { error } = cur?.id
        ? await db.from('inkassations').update(values).eq('id', cur.id)
        : await db.from('inkassations').insert({ shift_id: shiftId, ...values })
      if (error) { setPayError(tr('pe.saveFailed', { err: error.message })); setPaying(false); return }
    }

    const { error: payErr } = await db.from('salary_payments').insert({
      employee_id: payFor.id, period: `${ym}-01`, amount, method,
      paid_at: new Date(dateStr).toISOString(),
      note: payFor.note || null, created_by: null,
    })
    setPaying(false)
    if (payErr) { setPayError(tr('pe.saveFailed', { err: payErr.message })); return }
    setPayFor(null)
    await load(); await loadDebt()
  }

  const payStatus = (r: any) => {
    if (r.total <= 0) return null
    if (r.remaining <= 0) return { label: r.lastPaidAt ? tr('pe.paidOn', { date: absDate(r.lastPaidAt) }) : tr('pe.paidStatus'), color: t.green }
    if (r.remaining === r.total) return { label: tr('pe.notPaidYet'), color: t.orange }
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

  const Breakdown = ({ r }: { r: any }) => {
    const st = payStatus(r)
    return (
      <div style={{ background: t.surface, borderRadius: 16, overflow: 'hidden', boxShadow: t.sh, marginBottom: 8 }}>
        {[
          { _l: tr('pe.salaryBase'), v: eur(r.salary), c: t.text, hide: false },
          { _l: tr('pe.worked'), v: fmtHours(r.hours, tr), c: t.text2, hide: r.hours <= 0 },
          { _l: tr('pe.absencesN', { n: r.absences }), v: r.dates.map(absDate).join(', '), c: t.text2, small: true, hide: r.absences === 0 },
          { _l: tr('pe.absenceDeduct'), v: `−${eur(r.deduct)}`, c: t.red, hide: r.deduct === 0 },
          { _l: tr('pe.inCash'), v: eur(r.cash), c: t.green, hide: false },
        ].filter((x: any) => !x.hide).map((x: any, i, arr) => (
          <div key={x._l} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 16px', borderBottom: i < arr.length - 1 ? `0.5px solid ${t.sep2}` : 'none' }}>
            <span style={{ fontSize: 14, color: t.text2, flexShrink: 0 }}>{x._l}</span>
            <span style={{ fontSize: x.small ? 12 : 15, fontWeight: x.small ? 500 : 700, color: x.c, textAlign: 'right' }}>{x.v}</span>
          </div>
        ))}
        {/* «На карту» — редактируемо только здесь (Manager), Analytics read-only (A3, аудит 2026-08-13) */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 16px', borderBottom: `0.5px solid ${t.sep2}` }}>
          <span style={{ fontSize: 14, color: t.text2 }}>{tr('pe.toCard')}</span>
          <input
            key={`card-${r.id}-${ym}`} type="number" inputMode="decimal"
            defaultValue={r.card || ''} placeholder="0"
            onBlur={e => saveCard(r.id, e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
            style={{ width: 84, textAlign: 'right', padding: '7px 10px', borderRadius: 9, border: `1px solid ${t.sep2}`, background: t.fill, color: t.blue, fontWeight: 700, fontSize: 14, fontFamily: 'inherit', outline: 'none' }}
          />
        </div>
        {r.advanceRows.map((a: any) => (
          <div key={a.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '10px 16px', borderBottom: `0.5px solid ${t.sep2}` }}>
            <span style={{ fontSize: 13, color: t.text3 }}>{tr('pe.advances')} · {absDate(a.date)}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: t.orange }}>−{eur(Number(a.amount || 0))}</span>
              <button onClick={() => deleteAdvance(a, r.name)} style={{ width: 22, height: 22, borderRadius: '50%', background: `${t.red}14`, border: 'none', color: t.red, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12" /></svg>
              </button>
            </div>
          </div>
        ))}
        <button onClick={() => { setAdvFor({ id: r.id, name: r.name }); setAdvAmount(''); setAdvDate(fmtDate(new Date())) }} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 6, padding: '10px 16px', background: 'transparent', border: 'none', borderBottom: `0.5px solid ${t.sep2}`, color: accent, fontFamily: 'inherit', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
          <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>
          {tr('an.addAdvance')}
        </button>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 16px', background: `${accent}0d` }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: t.text }}>{tr('pe.totalPayout')}</span>
          <span style={{ fontSize: 18, fontWeight: 800, color: accent }}>{eur(r.total)}</span>
        </div>
        {st && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', borderTop: `0.5px solid ${t.sep2}` }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: st.color }}>{st.label}</span>
            {r.remaining > 0 && (
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
        <Sheet onClose={() => { setPayFor(null); setPayError(null) }} t={t}>
          <div style={{ padding: '4px 20px 24px' }}>
            <div style={{ fontSize: 17, fontWeight: 700, color: t.text, marginBottom: 14 }}>{tr('pe.markPaid')} · {payFor.name}</div>
            {payError && <div style={{ background: `${t.red}14`, color: t.red, borderRadius: 12, padding: '10px 12px', fontSize: 13, fontWeight: 600, marginBottom: 12 }}>{payError}</div>}
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
            <button onClick={savePayment} disabled={paying} style={{ width: '100%', marginTop: 18, padding: '14px', borderRadius: 14, background: accent, color: '#fff', border: 'none', fontFamily: 'inherit', fontSize: 15, fontWeight: 700, cursor: paying ? 'default' : 'pointer', opacity: paying ? 0.6 : 1, boxShadow: `0 4px 16px ${accent}44` }}>{tr('pe.savePayment')}</button>
          </div>
        </Sheet>
      )}
      {advFor && (
        <Sheet onClose={() => setAdvFor(null)} t={t}>
          <div style={{ padding: '4px 20px 24px' }}>
            <div style={{ fontSize: 17, fontWeight: 700, color: t.text, marginBottom: 14 }}>{tr('an.addAdvance')} · {advFor.name}</div>
            <label style={lbl(t)}>{tr('pe.paymentAmount')}</label>
            <input type="number" inputMode="decimal" value={advAmount} onChange={e => setAdvAmount(e.target.value)} style={inp(t)} />
            <label style={{ ...lbl(t), marginTop: 12 }}>{tr('pe.paymentDate')}</label>
            <input type="date" value={advDate} onChange={e => setAdvDate(e.target.value)} style={inp(t)} />
            <button
              onClick={async () => {
                const amt = Math.max(0, parseFloat(advAmount) || 0)
                if (amt <= 0 || !advFor) return
                await addAdvance(advFor.id, advFor.name, amt, advDate)
                setAdvFor(null)
              }}
              disabled={(parseFloat(advAmount) || 0) <= 0}
              style={{ width: '100%', marginTop: 18, padding: '14px', borderRadius: 14, background: accent, color: '#fff', border: 'none', fontFamily: 'inherit', fontSize: 15, fontWeight: 700, cursor: 'pointer', opacity: (parseFloat(advAmount) || 0) <= 0 ? 0.5 : 1, boxShadow: `0 4px 16px ${accent}44` }}>
              {tr('pe.save')}
            </button>
          </div>
        </Sheet>
      )}
      {toast && (
        <div style={{ position: 'fixed', bottom: 100, left: '50%', transform: 'translateX(-50%)', background: t.dark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.85)', backdropFilter: 'blur(16px)', color: '#fff', padding: '12px 22px', borderRadius: 22, fontSize: 14, fontWeight: 600, zIndex: 600, whiteSpace: 'nowrap' }}>{toast}</div>
      )}
    </div>
  )
}
