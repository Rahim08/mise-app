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
import { hoursOf, fmtHours } from './shared'
import { fetchMySalary } from '@/lib/peopleClient'


// Зарплата — личный вид (одинаковый у сотрудника и менеджера, реструктура 2026-08-13,
// см. docs/MANAGER-PEOPLE-RESTRUCTURE-2026-08-13.md). Фонд ЗП, долг и оплата всех
// сотрудников — Manager→Зарплата (app/manager/tabs-salary.tsx).
// Распил page.tsx (Д2, 2026-07-18): секция вынесена без изменений логики.
// Источники: employees.salary/deduct_per_absence, shift_absences (даты пропусков),
// monthly_card_amounts (на карту), attendance_records (отработанные часы).
// Связь attendance(staff)↔employees — по имени (как в остальном коде; настоящий FK — в плане автоматизации).
const eur = (n: number) => `€${Math.round(n).toLocaleString('de-DE')}`
const absDate = (d: string) => new Date(d).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })

export function SalaryTab({ me, accent, t }: { me: any; accent: string; t: any }) {
  const { t: tr } = useI18n()
  const [viewDate, setViewDate] = useState(new Date())
  const ym = fmtDate(viewDate).slice(0, 7)
  const isCurrentMonth = ym === fmtDate(new Date()).slice(0, 7)
  const monthLabel = viewDate.toLocaleDateString(tr('dash.locale'), { month: 'long', year: 'numeric' })
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [rows, setRows] = useState<any[]>([])

  // Расчёт делает сервер (/api/people/salary, аудит People 2026-11-14): только своя строка
  // по staff.employee_id (не по имени — однофамильцы видели чужую сумму), сбой любой
  // составляющей — ошибка, а не нули. reqSeq отбрасывает запоздавший ответ прошлого месяца
  // при быстром листании.
  const reqSeq = React.useRef(0)
  const load = async () => {
    const seq = ++reqSeq.current
    setLoading(true); setFailed(false)
    try {
      const row = await fetchMySalary(ym)
      if (seq !== reqSeq.current) return
      setRows(row ? [{ ...row, absences: row.absences, dates: row.dates }] : [])
    } catch {
      if (seq !== reqSeq.current) return
      setRows([]); setFailed(true)
    }
    setLoading(false)
  }
  useEffect(() => { load() }, [ym])

  const changeMonth = (dir: number) => { const d = new Date(viewDate); d.setDate(1); d.setMonth(d.getMonth() + dir); setViewDate(d) }

  // Статус выплаты: только если начисление в этом месяце вообще есть. Если
  // remaining === total (ничего не платили/не авансировали) — сумма уже видна в
  // заголовке, повторять её в статусе не надо (юзер-фидбок: «дублируется») — нейтральная
  // пометка «Не выплачено» вместо числа.
  const payStatus = (r: any) => {
    switch (r.status) {
      case 'none': return null
      case 'paid': return { label: r.lastPaidAt ? tr('pe.paidOn', { date: absDate(r.lastPaidAt) }) : tr('pe.paidStatus'), color: t.green }
      // Открытый ЗП-долг — обещание выплатить позже, не выплата.
      case 'debt': return { label: tr('pe.salaryDebtOwed', { amount: eur(r.openDebt) }), color: t.orange }
      case 'unpaid': return { label: tr('pe.notPaidYet'), color: t.orange }
      default: return { label: tr('pe.oweAmount', { amount: eur(r.remaining) }), color: t.orange }
    }
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
  if (failed) return (
    <div>
      <MonthNav />
      <div style={{ textAlign: 'center', padding: '40px 20px', color: t.text3 }}>
        <div style={{ fontSize: 14, marginBottom: 12 }}>{tr('pe.salaryLoadFailed')}</div>
        <button onClick={load} style={{ padding: '10px 18px', borderRadius: 12, border: 'none', background: accent, color: '#fff', fontFamily: 'inherit', fontWeight: 700, cursor: 'pointer' }}>{tr('bk.retry')}</button>
      </div>
    </div>
  )
  if (rows.length === 0) return (
    <div style={{ textAlign: 'center', padding: '60px 20px', color: t.text3 }}>
      <div style={{ width: 72, height: 72, borderRadius: 20, background: `${accent}14`, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
        <svg width="34" height="34" fill="none" stroke={accent} strokeWidth="1.6" viewBox="0 0 24 24"><rect x="2" y="6" width="20" height="13" rx="2" /><path d="M2 10h20M6 15h4" /></svg>
      </div>
      <div style={{ fontWeight: 600, fontSize: 16, color: t.text2 }}>{tr('pe.noSalaryData')}</div>
      <div style={{ fontSize: 13, marginTop: 4 }}>{tr('pe.salarySetInDash')}</div>
    </div>
  )

  // Детальная разбивка личного расчёта.
  const Breakdown = ({ r }: { r: any }) => {
    const st = payStatus(r)
    return (
      <div style={{ background: t.surface, borderRadius: 16, overflow: 'hidden', boxShadow: t.sh, marginBottom: 8 }}>
        {[
          { _l: tr('pe.salaryBase'), v: eur(r.salary), c: t.text, hide: false },
          { _l: tr('pe.worked'), v: fmtHours(r.hours, tr), c: t.text2, hide: r.hours <= 0 },
          { _l: tr('pe.absencesN', { n: r.absences }), v: r.dates.map(absDate).join(', '), c: t.text2, small: true, hide: r.absences === 0 },
          { _l: tr('pe.absenceDeduct'), v: `\u2212${eur(r.deduct)}`, c: t.red, hide: r.deduct === 0 },
          { _l: tr('pe.toCard'), v: eur(r.card), c: t.blue, hide: r.card === 0 },
          { _l: tr('pe.advances'), v: `\u2212${eur(r.advance)}`, c: t.orange, hide: !r.advance },
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
          </div>
        )}
      </div>
    )
  }

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

