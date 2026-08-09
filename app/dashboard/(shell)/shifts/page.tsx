'use client'
// Смены (owner-view): полноценный desktop-редактор кассы (та же модель, что
// app/manager/page.tsx — calc()/persistShift() намеренно продублированы, не вынесены
// в общий lib: конвенция этого репо, см. [[money-model-manager-analytics]] — трогать
// рабочий мобильный Manager нельзя) + история смен.
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { db } from '@/lib/db'
import { notify as pushNotify } from '@/lib/notifyClient'
import { useI18n } from '@/lib/i18n'
import { fmtDate, fv, displayDate, dd } from '@/lib/format'
import { Card, Btn, Badge, EmptyState, Spinner, SectionTitle, Container, Table, type TableColumn, inputStyle } from '@/components/ui'
import { useDash } from '@/components/dash/context'

type Shift = {
  id: string; date: string; status: string
  opening_balance: number; income: number; income_card: number
  total_expense: number; inkassation: number; closing_balance: number
  opened_at?: string | null
}
type Employee = { id: string; name: string; deduct_per_absence: number }
type Category = { id: string; name: string }

const PAGE = 14
const numInput: React.CSSProperties = { ...inputStyle, minHeight: 36, padding: '6px 10px', textAlign: 'right', width: 110 }

export default function ShiftsPage() {
  const { t: tr, locale } = useI18n()
  const { restaurant } = useDash()
  const restaurantId = restaurant?.id || ''

  // ── История (список последних смен, независим от редактора) ──
  const [history, setHistory] = useState<Shift[]>([])
  const [loadingHistory, setLoadingHistory] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)

  const loadHistory = async () => {
    setLoadingHistory(true)
    const { data } = await db.from('shifts').select('*').eq('restaurant_id', restaurantId)
      .order('date', { ascending: false }).order('opened_at', { ascending: false }).limit(PAGE)
    const hist = data || []
    setHistory(hist)
    setHasMore(hist.length === PAGE)
    setLoadingHistory(false)
  }
  const loadMore = async () => {
    setLoadingMore(true)
    const last = history[history.length - 1]
    const { data } = await db.from('shifts').select('*').eq('restaurant_id', restaurantId)
      .order('date', { ascending: false }).order('opened_at', { ascending: false }).lt('date', last.date).limit(PAGE)
    const more = data || []
    setHistory(h => [...h, ...more])
    setHasMore(more.length === PAGE)
    setLoadingMore(false)
  }
  useEffect(() => { if (restaurantId) loadHistory() }, [restaurantId])

  // ── Редактор смены (порт app/manager/page.tsx) ──
  const [currentDate, setCurrentDate] = useState(new Date())
  const [shift, setShift] = useState<Shift | null>(null)
  const [employees, setEmployees] = useState<Employee[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [absences, setAbsences] = useState<string[]>([])
  const [autoAbsences, setAutoAbsences] = useState<Set<string>>(new Set())
  const [empExtras, setEmpExtras] = useState<Record<string, string>>({})
  const [catAmounts, setCatAmounts] = useState<Record<string, string>>({})
  const [catNotes, setCatNotes] = useState<Record<string, string>>({})
  const [income, setIncome] = useState('')
  const [incomeCard, setIncomeCard] = useState('')
  const [inkSum, setInkSum] = useState('')
  const [inkExpense, setInkExpense] = useState('')
  const [inkReason, setInkReason] = useState('')
  // Снэпшот на момент loadDay — A2 (аудит 2026-08-09): на сохранении переносим только правку
  // менеджера (дельту), не затираем то, что параллельно записал addAdvance/settleDebt в Analytics.
  const [loadedInkExpense, setLoadedInkExpense] = useState('')
  const [loadedInkReason, setLoadedInkReason] = useState('')
  const [locked, setLocked] = useState(false)
  const [saving, setSaving] = useState(false)
  const [loadingDay, setLoadingDay] = useState(true)
  const [closeConfirm, setCloseConfirm] = useState(false)
  const [closing, setClosing] = useState(false)
  const [err, setErr] = useState('')
  const [inkReserve, setInkReserve] = useState<number | null>(null)
  const [checklistWarn, setChecklistWarn] = useState(false)

  // Остаток инкассации (ЗП-долг 2026-07-28): сумма (инкассация − расход − зарплата) по ВСЕМ
  // дням с начала учёта — что физически должно лежать в загашнике/сейфе. Списания «увезли
  // в банк» и т.п. — через уже существующее поле «Расход по инкассации».
  const loadInkReserve = async () => {
    const { data } = await db.from('inkassations').select('total').eq('restaurant_id', restaurantId)
    setInkReserve((data || []).reduce((s: number, r: any) => s + (r.total || 0), 0))
  }

  const loadAbsencesByDate = async (dateStr: string) => {
    const { data: abs } = await db.from('shift_absences').select('*').eq('restaurant_id', restaurantId).eq('date', dateStr)
    setAbsences((abs || []).map((a: any) => a.employee_id))
    setAutoAbsences(new Set((abs || []).filter((a: any) => a.source === 'auto').map((a: any) => a.employee_id)))
  }

  const loadDay = async (date: Date) => {
    setLoadingDay(true); setErr('')
    const dateStr = fmtDate(date)
    const { data: shList } = await db.from('shifts').select('*').eq('restaurant_id', restaurantId).eq('date', dateStr).order('opened_at', { ascending: true }).limit(1)
    const sh = (Array.isArray(shList) ? shList[0] : shList) || null
    const { data: prevList } = await db.from('shifts').select('closing_balance').eq('restaurant_id', restaurantId).lt('date', dateStr).order('date', { ascending: false }).order('opened_at', { ascending: false }).limit(1)
    const openingBalance = (Array.isArray(prevList) ? prevList[0] : prevList)?.closing_balance || 0

    if (sh) {
      setShift({ ...sh, opening_balance: openingBalance })
      setLocked(sh.income > 0 || sh.total_expense > 0 || sh.inkassation > 0)
      setIncome(sh.income > 0 ? String(sh.income) : '')
      setIncomeCard(sh.income_card > 0 ? String(sh.income_card) : '')
      setInkSum(sh.inkassation > 0 ? String(sh.inkassation) : '')
      const { data: exps } = await db.from('shift_expenses').select('*').eq('shift_id', sh.id)
      const amounts: Record<string, string> = {}; const notes: Record<string, string> = {}; const extras: Record<string, string> = {}
      // paid_shift_id != null — строка управляется экраном «Долги» (Analytics), не форма смены.
      ;(exps || []).filter((e: any) => !e.paid_shift_id).forEach((e: any) => {
        if (e.employee_id) extras[e.employee_id] = String(e.amount)
        else if (e.category_id) { amounts[e.category_id] = String(e.amount); if (e.note) notes[e.category_id] = e.note }
      })
      setCatAmounts(amounts); setCatNotes(notes); setEmpExtras(extras)
      await loadAbsencesByDate(dateStr)
      const { data: inkList } = await db.from('inkassations').select('*').eq('shift_id', sh.id).limit(1)
      const ink = Array.isArray(inkList) ? inkList[0] : inkList
      const nextExpense = ink && ink.expense > 0 ? String(ink.expense) : ''
      const nextReason = ink?.reason || ''
      setInkExpense(nextExpense); setInkReason(nextReason)
      setLoadedInkExpense(nextExpense); setLoadedInkReason(nextReason)
    } else {
      setShift(null); setLocked(false); setIncome(''); setIncomeCard(''); setInkSum(''); setInkExpense(''); setInkReason('')
      setLoadedInkExpense(''); setLoadedInkReason('')
      setCatAmounts({}); setCatNotes({}); setAbsences([]); setAutoAbsences(new Set()); setEmpExtras({})
    }
    setLoadingDay(false)
  }

  useEffect(() => {
    if (!restaurantId) return
    ;(async () => {
      const [empsRes, catsRes] = await Promise.all([
        db.from('employees').select('id,name,deduct_per_absence').eq('restaurant_id', restaurantId).eq('is_active', true).order('name'),
        db.from('expense_categories').select('id,name').eq('restaurant_id', restaurantId).eq('is_active', true).order('name'),
      ])
      setEmployees(empsRes.data || []); setCategories(catsRes.data || [])
      await loadDay(currentDate)
      await loadInkReserve()
    })()
  }, [restaurantId])

  const changeDate = async (dir: number) => {
    if (shift && !locked) { try { await persistShift() } catch (e: any) { setErr(tr('mg.autosaveErr') + ': ' + (e?.message || '')) } }
    const d = new Date(currentDate); d.setDate(d.getDate() + dir)
    setCurrentDate(d)
    await loadDay(d)
  }

  const openShift = async () => {
    setSaving(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      const yesterday = new Date(currentDate); yesterday.setDate(yesterday.getDate() - 1)
      const { data: prevList } = await db.from('shifts').select('closing_balance').eq('restaurant_id', restaurantId).eq('date', fmtDate(yesterday)).order('opened_at', { ascending: false }).limit(1)
      const openingBalance = (Array.isArray(prevList) ? prevList[0] : prevList)?.closing_balance || 0
      const { data: sh, error } = await db.from('shifts').insert({
        restaurant_id: restaurantId, date: fmtDate(currentDate),
        opened_by: user?.id ?? null, manager_id: user?.id ?? null,
        opening_balance: openingBalance, income: 0, inkassation: 0,
        closing_balance: openingBalance, status: 'open',
      }).select().single()
      if (sh) {
        setShift({ ...sh, opening_balance: openingBalance })
        await loadAbsencesByDate(fmtDate(currentDate))
        // Пуш «смена открыта» отключён по запросу — низкая ценность, шумит (юзер-фидбек 2026-07-22).
        await loadHistory()
      } else if (error?.code === '23505') {
        await loadDay(currentDate)
      } else if (error) {
        setErr(tr('mg.err') + ': ' + error.message)
      }
    } finally { setSaving(false) }
  }

  const toggleAbsence = async (empId: string) => {
    if (!shift) return
    const dateStr = fmtDate(currentDate)
    if (absences.includes(empId)) {
      await db.from('shift_absences').delete().eq('restaurant_id', restaurantId).eq('date', dateStr).eq('employee_id', empId)
      setAbsences(absences.filter(id => id !== empId))
    } else {
      await db.from('shift_absences').insert({ shift_id: shift.id, restaurant_id: restaurantId, employee_id: empId, date: dateStr })
      setAbsences([...absences, empId])
    }
    if (autoAbsences.has(empId)) setAutoAbsences(prev => { const n = new Set(prev); n.delete(empId); return n })
  }

  const calc = () => {
    const inc = parseFloat(income) || 0
    const card = parseFloat(incomeCard) || 0
    const ink = parseFloat(inkSum) || 0
    const catTotal = categories.reduce((s, c) => s + (parseFloat(catAmounts[c.id] || '0') || 0), 0)
    const empExtraTotal = employees.reduce((s, e) => s + (parseFloat(empExtras[e.id] || '0') || 0), 0)
    const totalExp = catTotal + empExtraTotal + ink
    const opening = shift?.opening_balance || 0
    const balance = opening + inc - totalExp
    const inkNet = ink - (parseFloat(inkExpense) || 0)
    return { inc, card, ink, catTotal, empExtraTotal, totalExp, balance, opening, inkNet }
  }

  // Расходы/инкассация пересобираются целиком: insert-новых → delete-старых-по-id
  // (НЕ delete-then-insert). Раньше обрыв сети между delete и insert молча стирал все
  // расходы и инкассацию смены, а ошибки insert не проверялись вовсе — ввод исчезал без следа.
  // Тот же порядок, что в app/manager/page.tsx (коммит b34d583) и ManagerView.swift.
  // Если упадёт финальный delete — останутся видимые дубли, следующее успешное сохранение
  // их подчистит (старые id уже собраны).
  const persistShift = async (sh = shift, dateForInk = currentDate) => {
    if (!sh) return
    const { inc, card, ink, totalExp, balance } = calc()
    const { error: upErr } = await db.from('shifts').update({ income: inc, income_card: card, inkassation: ink, total_expense: totalExp, closing_balance: balance }).eq('id', sh.id)
    if (upErr) throw new Error(upErr.message)

    // paid_shift_id != null — строка управляется экраном «Долги» (Analytics), не трогаем.
    const { data: oldExpensesAll, error: oldExpErr } = await db.from('shift_expenses').select('id, paid_shift_id').eq('shift_id', sh.id)
    if (oldExpErr) throw new Error(oldExpErr.message)
    const oldExpenses = (oldExpensesAll || []).filter((e: any) => !e.paid_shift_id)
    const inserts: any[] = []
    categories.forEach(c => {
      const amt = parseFloat(catAmounts[c.id] || '0')
      if (amt > 0) inserts.push({ shift_id: sh.id, restaurant_id: restaurantId, category_id: c.id, category_name: c.name, amount: amt, note: catNotes[c.id] || '' })
    })
    employees.forEach(emp => {
      const extra = parseFloat(empExtras[emp.id] || '0')
      if (extra > 0) inserts.push({ shift_id: sh.id, restaurant_id: restaurantId, employee_id: emp.id, category_name: emp.name + ' (экстра)', amount: extra })
    })
    if (inserts.length > 0) {
      const { error: insErr } = await db.from('shift_expenses').insert(inserts)
      if (insErr) throw new Error(insErr.message)
    }
    if ((oldExpenses || []).length > 0) await db.from('shift_expenses').delete().in('id', (oldExpenses || []).map((e: any) => e.id))

    // UPDATE по id вместо delete+insert (A2, аудит 2026-08-09) — delta-merge поверх актуального
    // значения в БД, чтобы не затирать то, что параллельно записал addAdvance/settleDebt.
    const { data: curInkList, error: curInkErr } = await db.from('inkassations').select('id, expense, reason').eq('shift_id', sh.id).limit(1)
    if (curInkErr) throw new Error(curInkErr.message)
    const curInk = Array.isArray(curInkList) ? curInkList[0] : curInkList
    const finalExpense = (curInk?.expense || 0) + ((parseFloat(inkExpense) || 0) - (parseFloat(loadedInkExpense) || 0))
    const curReason = curInk?.reason || ''
    const finalReason = (curReason === loadedInkReason || inkReason !== loadedInkReason) ? inkReason : curReason
    const finalTotal = ink - finalExpense
    if (ink > 0 || finalExpense !== 0 || finalReason) {
      const values = { restaurant_id: restaurantId, date: fmtDate(dateForInk), amount: ink, expense: finalExpense, reason: finalReason, total: finalTotal }
      const { error: inkErr } = curInk
        ? await db.from('inkassations').update(values).eq('id', curInk.id)
        : await db.from('inkassations').insert({ shift_id: sh.id, ...values })
      if (inkErr) throw new Error(inkErr.message)
    } else if (curInk) {
      await db.from('inkassations').delete().eq('id', curInk.id)
    }
    setLoadedInkExpense(inkExpense); setLoadedInkReason(inkReason)

    await db.from('shift_absences').update({ shift_id: sh.id, source: 'manager' }).eq('restaurant_id', restaurantId).eq('date', fmtDate(dateForInk))
    setAutoAbsences(new Set())
    setShift({ ...sh, income: inc, inkassation: ink, total_expense: totalExp, closing_balance: balance })
    return balance
  }

  // Мягкий гейт (не блокирует): если чек-лист закрытия смены на сегодня не пройден целиком,
  // спрашиваем подтверждение вместо тихого закрытия кассы (юзер-фидбек 2026-07-28).
  const closeChecklistIncomplete = async (): Promise<boolean> => {
    const { data: lists } = await db.from('shift_checklists').select('id').eq('kind', 'shift').eq('type', 'close')
    const ids = (lists || []).map((l: any) => l.id)
    if (!ids.length) return false
    const dateStr = fmtDate(currentDate)
    const { data: completions } = await db.from('shift_checklist_completions').select('checklist_id, status').eq('date', dateStr).in('checklist_id', ids)
    return !ids.every((id: string) => completions?.some((c: any) => c.checklist_id === id && c.status === 'done'))
  }

  const saveShift = async (force = false) => {
    if (!shift) return
    if (!force && await closeChecklistIncomplete()) { setChecklistWarn(true); return }
    setSaving(true); setErr('')
    try { await persistShift() } catch (e: any) { setErr(tr('mg.err') + ': ' + (e?.message || tr('mg.notSaved'))); setSaving(false); return }
    setLocked(true)
    const c = calc()
    pushNotify({
      type: 'cash_close', title: tr('mg.pushCashClosed'), body: tr('mg.pushShiftClosed'),
      titleKey: 'notify.cashCloseTitle', bodyKey: 'notify.cashCloseBody', bodyParams: { date: dd(fmtDate(currentDate)) },
      secureBody: `${tr('mg.sumRevenue')} €${fv(c.inc)} · ${tr('mg.cellBalance')} €${fv(c.balance)}`,
      secureBodySegments: [{ key: 'notify.dRevenue', value: `€${fv(c.inc)}` }, { key: 'notify.dBalance', value: `€${fv(c.balance)}` }],
      audience: { managers: true },
    })
    setSaving(false)
    await loadHistory()
    await loadInkReserve()
  }

  const forceClose = async () => {
    if (!shift) return
    setClosing(true)
    await db.from('shifts').update({ status: 'closed' }).eq('id', shift.id)
    setShift({ ...shift, status: 'closed' })
    setCloseConfirm(false); setClosing(false)
    await loadHistory()
  }

  const { ink, catTotal, empExtraTotal, balance } = calc()
  const netExpense = catTotal + empExtraTotal
  const daysInMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0).getDate()
  const dowRaw = currentDate.toLocaleDateString(locale, { weekday: 'long' })
  const dowName = dowRaw.charAt(0).toUpperCase() + dowRaw.slice(1)

  const historyColumns: TableColumn<Shift>[] = [
    { key: 'date', label: tr('mg.sumDate'), sortable: true, render: s => displayDate(new Date(s.date + 'T00:00:00')) },
    { key: 'status', label: tr('mg.secRegister'), render: s => <Badge tone={s.status === 'open' ? 'ok' : 'neutral'}>{s.status === 'open' ? tr('mg.statusOpen') : tr('mg.statusClosed')}</Badge> },
    { key: 'income', label: tr('mg.cash'), align: 'right', sortable: true, sortValue: s => s.income || 0, render: s => `€${fv(s.income || 0)}` },
    { key: 'total_expense', label: tr('mg.expense'), align: 'right', sortable: true, sortValue: s => s.total_expense || 0, render: s => `€${fv(s.total_expense || 0)}` },
    {
      key: 'closing_balance', label: tr('mg.cellBalance'), align: 'right', sortable: true, sortValue: s => s.closing_balance || 0,
      render: s => <span style={{ fontWeight: 700, color: (s.closing_balance || 0) < 0 ? 'var(--danger)' : 'var(--tx)' }}>€{fv(s.closing_balance || 0)}</span>,
    },
  ]

  const fieldLabel: React.CSSProperties = { fontSize: '.68rem', fontWeight: 600, color: 'var(--tx2)', textTransform: 'uppercase', letterSpacing: '.03em' }
  const row: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '8px 0', borderBottom: 'var(--hairline)' }

  return (
    <Container size="wide">
      <SectionTitle title={tr('dash.navShifts')} sub={tr('dash.shiftsSub')} />

      {/* ── ДАТА + СТАТУС ── */}
      <Card style={{ marginBottom: 14, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button onClick={() => changeDate(-1)} className="ui-press" style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--fill)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--tx)' }}>
            <svg width="8" height="14" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" viewBox="0 0 8 14"><path d="M7 1L1 7l6 6" /></svg>
          </button>
          <div style={{ minWidth: 160, textAlign: 'center' }}>
            <div style={{ fontWeight: 700, fontSize: '.95rem', color: 'var(--tx)' }}>{displayDate(currentDate)}</div>
            <div style={{ fontSize: '.74rem', color: 'var(--accent)', fontWeight: 500 }}>{dowName} · {tr('mg.dayOf', { n: currentDate.getDate(), m: daysInMonth })}</div>
          </div>
          <button onClick={() => changeDate(1)} className="ui-press" style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--fill)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--tx)' }}>
            <svg width="8" height="14" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" viewBox="0 0 8 14"><path d="M1 1l6 6-6 6" /></svg>
          </button>
        </div>
        {shift && <Badge tone={shift.status === 'open' ? 'ok' : 'neutral'}>{shift.status === 'open' ? tr('mg.statusOpen') : tr('mg.statusClosed')}</Badge>}
      </Card>

      {err && <div style={{ background: 'var(--danger-soft)', color: 'var(--danger)', borderRadius: 12, padding: '10px 14px', marginBottom: 14, fontSize: '.85rem' }}>{err}</div>}

      {loadingDay ? <Spinner /> : !shift ? (
        <Card style={{ marginBottom: 18 }}>
          <EmptyState
            icon={<svg width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><path d="M12 8v4l3 3" /></svg>}
            title={tr('mg.emptyTitle')} sub={tr('mg.emptySub')}
            action={<Btn onClick={openShift} disabled={saving}>{tr('mg.openShift')}</Btn>}
          />
        </Card>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.4fr) minmax(300px,1fr)', gap: 14, marginBottom: 14, opacity: locked ? .7 : 1 }}>
            {/* ЛЕВАЯ КОЛОНКА: сотрудники + расходы */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <Card>
                <div style={{ fontWeight: 700, fontSize: '.85rem', color: 'var(--tx)', marginBottom: 4 }}>{tr('mg.secStaff')}</div>
                {employees.map(emp => {
                  const absent = absences.includes(emp.id)
                  const isAuto = autoAbsences.has(emp.id)
                  return (
                    <div key={emp.id} style={row}>
                      <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 6, fontSize: '.85rem', color: absent ? 'var(--tx3)' : 'var(--tx)', textDecoration: absent ? 'line-through' : 'none' }}>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{emp.name}</span>
                        {isAuto && absent && <Badge tone="warn">{tr('mg.auto')}</Badge>}
                      </div>
                      <input type="number" value={empExtras[emp.id] || ''} disabled={locked}
                        onChange={e => setEmpExtras({ ...empExtras, [emp.id]: e.target.value })}
                        placeholder="€ 0" className="ui-input" style={numInput} />
                      <button onClick={() => toggleAbsence(emp.id)} disabled={locked} className="ui-press" style={{
                        width: 28, height: 28, borderRadius: '50%', border: `1.5px solid ${absent ? 'var(--danger)' : 'rgba(var(--seprgb),.3)'}`,
                        background: absent ? 'var(--danger-soft)' : 'none', cursor: locked ? 'default' : 'pointer', flexShrink: 0,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        {absent && <svg width="10" height="10" fill="none" stroke="var(--danger)" strokeWidth="2.6" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12" /></svg>}
                      </button>
                    </div>
                  )
                })}
              </Card>

              <Card>
                <div style={{ fontWeight: 700, fontSize: '.85rem', color: 'var(--tx)', marginBottom: 4 }}>{tr('mg.secExpenses')}</div>
                {categories.map(cat => {
                  const val = catAmounts[cat.id] || ''
                  const hasVal = parseFloat(val) > 0
                  return (
                    <div key={cat.id} style={{ padding: '8px 0', borderBottom: 'var(--hairline)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                        <div style={{ flex: 1, fontSize: '.85rem', color: 'var(--tx)' }}>{cat.name}</div>
                        <input type="number" value={val} disabled={locked}
                          onChange={e => setCatAmounts({ ...catAmounts, [cat.id]: e.target.value })}
                          placeholder="€ 0" className="ui-input" style={numInput} />
                      </div>
                      {hasVal && (
                        <input value={catNotes[cat.id] || ''} disabled={locked}
                          onChange={e => setCatNotes({ ...catNotes, [cat.id]: e.target.value })}
                          placeholder={tr('mg.phComment')} className="ui-input"
                          style={{ ...inputStyle, minHeight: 30, padding: '4px 10px', fontSize: '.78rem', marginTop: 6 }} />
                      )}
                    </div>
                  )
                })}
              </Card>
            </div>

            {/* ПРАВАЯ КОЛОНКА: инкассация + касса */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <Card>
                <div style={{ fontWeight: 700, fontSize: '.85rem', color: 'var(--tx)', marginBottom: 4 }}>{tr('mg.secCollection')}</div>
                <div style={row}>
                  <span style={fieldLabel}>{tr('mg.inkSum')}</span>
                  <input type="number" value={inkSum} disabled={locked} onChange={e => setInkSum(e.target.value)} placeholder="€ 0" className="ui-input" style={numInput} />
                </div>
                <div style={row}>
                  <span style={fieldLabel}>{tr('mg.expense')}</span>
                  <input type="number" value={inkExpense} disabled={locked} onChange={e => setInkExpense(e.target.value)} placeholder="€ 0" className="ui-input" style={numInput} />
                </div>
                <div style={{ padding: '8px 0', borderBottom: 'var(--hairline)' }}>
                  <div style={{ ...fieldLabel, marginBottom: 5 }}>{tr('mg.inkReason')}</div>
                  <input value={inkReason} disabled={locked} onChange={e => setInkReason(e.target.value)} placeholder={tr('mg.phPurpose')} className="ui-input" style={{ ...inputStyle, minHeight: 34 }} />
                </div>
                {inkReserve !== null && (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 8, borderTop: 'var(--hairline)', marginTop: 8 }}>
                    <div>
                      <div style={{ fontSize: '.8rem', fontWeight: 600, color: 'var(--tx2)' }}>{tr('mg.inkReserve')}</div>
                      <div style={{ fontSize: '.68rem', color: 'var(--tx3)', marginTop: 1 }}>{tr('mg.inkReserveHint')}</div>
                    </div>
                    <span style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--tx)' }}>€{fv(inkReserve)}</span>
                  </div>
                )}
              </Card>

              <Card>
                <div style={{ fontWeight: 700, fontSize: '.85rem', color: 'var(--tx)', marginBottom: 4 }}>{tr('mg.secRegister')}</div>
                <div style={row}>
                  <span style={fieldLabel}>{tr('mg.cash')}</span>
                  <input type="number" value={income} disabled={locked} onChange={e => setIncome(e.target.value)} placeholder="€ 0" className="ui-input" style={numInput} />
                </div>
                <div style={row}>
                  <span style={fieldLabel}>{tr('mg.cardLine')}</span>
                  <input type="number" value={incomeCard} disabled={locked} onChange={e => setIncomeCard(e.target.value)} placeholder="€ 0" className="ui-input" style={numInput} />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, margin: '12px 0' }}>
                  {[
                    { label: tr('mg.expense'), val: netExpense, tone: 'danger' },
                    { label: tr('mg.cellInk'), val: ink, tone: 'accent' },
                  ].map(cell => (
                    <div key={cell.label} style={{ background: 'var(--fill)', borderRadius: 10, padding: '8px 12px' }}>
                      <div style={{ ...fieldLabel, marginBottom: 3 }}>{cell.label}</div>
                      <div style={{ fontSize: '.92rem', fontWeight: 700, color: cell.tone === 'danger' ? 'var(--danger)' : 'var(--accent)' }}>€{fv(cell.val)}</div>
                    </div>
                  ))}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 4 }}>
                  <span style={{ fontSize: '.85rem', fontWeight: 700, color: 'var(--accent)' }}>{tr('mg.registerEnd')}</span>
                  <span style={{ fontSize: '1.25rem', fontWeight: 700, color: balance < 0 ? 'var(--danger)' : 'var(--accent)' }}>€{fv(balance)}</span>
                </div>
              </Card>

              <div style={{ display: 'flex', gap: 8 }}>
                {locked ? (
                  <Btn full variant="gray" onClick={() => setLocked(false)}>{tr('mg.edit')}</Btn>
                ) : (
                  <Btn full onClick={() => saveShift()} disabled={saving}>{saving ? tr('mg.saving') : tr('mg.save')}</Btn>
                )}
              </div>

              {checklistWarn && (
                <Card>
                  <div style={{ fontSize: '.85rem', fontWeight: 700, color: 'var(--tx)', marginBottom: 4 }}>{tr('mg.closeChecklistWarnTitle')}</div>
                  <div style={{ fontSize: '.78rem', color: 'var(--tx2)', marginBottom: 10, lineHeight: 1.5 }}>{tr('mg.closeChecklistWarnBody')}</div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <Btn small variant="danger" onClick={() => { setChecklistWarn(false); saveShift(true) }}>{tr('mg.closeChecklistWarnAnyway')}</Btn>
                    <Btn small variant="ghost" onClick={() => setChecklistWarn(false)}>{tr('mg.closeChecklistWarnBack')}</Btn>
                  </div>
                </Card>
              )}

              {shift.status === 'open' && (
                closeConfirm ? (
                  <Card>
                    <div style={{ fontSize: '.8rem', fontWeight: 600, color: 'var(--danger)', marginBottom: 6 }}>{tr('dash.forceCloseTitle')}</div>
                    <div style={{ fontSize: '.76rem', color: 'var(--tx2)', marginBottom: 10, lineHeight: 1.5 }}>{tr('dash.forceCloseBody')}</div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <Btn small variant="danger" onClick={forceClose} disabled={closing}>{closing ? tr('dash.saving') : tr('dash.forceCloseConfirm')}</Btn>
                      <Btn small variant="ghost" onClick={() => setCloseConfirm(false)}>{tr('dash.cancel')}</Btn>
                    </div>
                  </Card>
                ) : (
                  <Btn small variant="danger" onClick={() => setCloseConfirm(true)}>{tr('dash.forceClose')}</Btn>
                )
              )}
            </div>
          </div>
        </>
      )}

      {/* ── ИСТОРИЯ ── */}
      <div style={{ fontWeight: 700, fontSize: '.95rem', color: 'var(--tx)', margin: '18px 0 10px' }}>{tr('dash.shiftsHistory')}</div>
      {loadingHistory ? <Spinner compact /> : history.filter(s => s.id !== shift?.id).length === 0 ? (
        <Card><div style={{ textAlign: 'center', padding: '20px 0', color: 'var(--tx2)', fontSize: '.88rem' }}>{tr('dash.shiftsNoHistory')}</div></Card>
      ) : (
        <Table columns={historyColumns} rows={history.filter(s => s.id !== shift?.id)} searchable searchPlaceholder={tr('mg.sumDate')} searchText={s => s.date} />
      )}

      {hasMore && history.length > 0 && (
        <div style={{ textAlign: 'center', marginTop: 14 }}>
          <Btn variant="gray" small onClick={loadMore} disabled={loadingMore}>{loadingMore ? '…' : tr('dash.shiftsLoadMore')}</Btn>
        </div>
      )}
    </Container>
  )
}
