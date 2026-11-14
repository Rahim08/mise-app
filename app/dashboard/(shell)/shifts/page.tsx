'use client'
// Смены (owner-view): полноценный desktop-редактор кассы (та же модель, что
// app/manager/page.tsx — calc()/persistShift() намеренно продублированы, не вынесены
// в общий lib: конвенция этого репо, см. [[money-model-manager-analytics]] — трогать
// рабочий мобильный Manager нельзя) + история смен.
import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { db } from '@/lib/db'
import { notify as pushNotify } from '@/lib/notifyClient'
import { useI18n } from '@/lib/i18n'
import { fmtDate, fv, displayDate, dd } from '@/lib/format'
import { splitShiftExpenses, round2, SALPERIOD_PREFIX } from '@/lib/shiftForm'
import { prepareCustomExpenses, customExpenseTotal, parseExpenseCents, type CustomExpenseDraft } from '@/lib/customExpenses'
import { CustomExpenseFields } from '@/components/CustomExpenseFields'
import { Card, Btn, Badge, EmptyState, Spinner, SectionTitle, Container, Table, type TableColumn, inputStyle } from '@/components/ui'
import { useDash } from '@/components/dash/context'
import './shifts.css'

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
  const [customExpenses, setCustomExpenses] = useState<CustomExpenseDraft[]>([])
  const [loadedCustomExpenses, setLoadedCustomExpenses] = useState<CustomExpenseDraft[]>([])
  const [income, setIncome] = useState('')
  const [incomeCard, setIncomeCard] = useState('')
  const [inkSum, setInkSum] = useState('')
  const [inkExpense, setInkExpense] = useState('')
  const [inkReason, setInkReason] = useState('')
  // Снэпшот на момент loadDay — A2 (аудит 2026-08-09): на сохранении переносим только правку
  // менеджера (дельту), не затираем то, что параллельно записал addAdvance/settleDebt в Analytics.
  const [loadedInkExpense, setLoadedInkExpense] = useState('')
  const [loadedInkReason, setLoadedInkReason] = useState('')
  // Долги (веб-паритет A2, аудит 2026-08-13 — до этого фича существовала только в iOS и
  // мобильном app/manager/page.tsx). См. те же комментарии там для полного контекста.
  const [catUnpaid, setCatUnpaid] = useState<Record<string, boolean>>({})
  const [empUnpaid, setEmpUnpaid] = useState<Record<string, boolean>>({})
  const [openDebts, setOpenDebts] = useState<{ id: string; shiftId: string; date: string; categoryId: string | null; categoryName: string; employeeId: string | null; amount: number; note: string | null; isCustom: boolean }[]>([])
  const [selectedDebtIds, setSelectedDebtIds] = useState<Set<string>>(new Set())
  const [showDebts, setShowDebts] = useState(false)
  const eligibleDebts = openDebts.filter(debt => !(debt.isCustom && debt.shiftId === shift?.id))
  const [settledTodayTotal, setSettledTodayTotal] = useState(0)
  const [unmanagedPaidTotal, setUnmanagedPaidTotal] = useState(0) // см. lib/shiftForm.ts
  const [locked, setLocked] = useState(false)
  const [saving, setSaving] = useState(false)
  // Синхронные замки от двойного нажатия — см. app/manager/page.tsx (аудит дублей 2026-10-26).
  const savingRef = useRef(false)
  const persistInFlight = useRef<{ id: string; p: Promise<number | undefined> } | null>(null)
  const [loadingDay, setLoadingDay] = useState(true)
  const [closeConfirm, setCloseConfirm] = useState(false)
  const [closing, setClosing] = useState(false)
  const [err, setErr] = useState('')
  const [checklistWarn, setChecklistWarn] = useState(false)
  // C8 (юзер-фидбок 2026-08-15): паритет с app/manager/page.tsx / ManagerView.swift.
  const [debtNegativeWarn, setDebtNegativeWarn] = useState(false)

  const loadOpenDebts = async () => {
    const { data: unpaid } = await db.from('shift_expenses').select('id, shift_id, category_id, category_name, employee_id, amount, note, is_custom').eq('restaurant_id', restaurantId).eq('is_paid', false)
    if (!unpaid || unpaid.length === 0) { setOpenDebts([]); return }
    const shiftIds = Array.from(new Set(unpaid.map((e: any) => e.shift_id).filter(Boolean)))
    const { data: shiftDates } = await db.from('shifts').select('id, date').in('id', shiftIds)
    const dateById: Record<string, string> = {}
    ;(shiftDates || []).forEach((s: any) => { dateById[s.id] = s.date })
    const rows = unpaid
      .map((e: any) => ({ id: e.id, shiftId: e.shift_id, date: dateById[e.shift_id], categoryId: e.category_id, categoryName: e.category_name || '—', employeeId: e.employee_id, amount: Number(e.amount || 0), note: e.note || null, isCustom: e.is_custom === true }))
      .filter((d: any) => d.date)
      .sort((a: any, b: any) => a.date < b.date ? -1 : 1)
    setOpenDebts(rows)
  }

  const loadAbsencesByDate = async (dateStr: string) => {
    const { data: abs } = await db.from('shift_absences').select('*').eq('restaurant_id', restaurantId).eq('date', dateStr)
    setAbsences((abs || []).map((a: any) => a.employee_id))
    setAutoAbsences(new Set((abs || []).filter((a: any) => a.source === 'auto').map((a: any) => a.employee_id)))
  }

  const loadDay = async (date: Date, emps: Employee[] = employees, cats: Category[] = categories) => {
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
      const { data: exps } = await db.from('shift_expenses').select('*').eq('shift_id', sh.id).order('created_at').order('id')
      // Разбор строк смены — lib/shiftForm.ts (аудит 2026-09-27, общий с app/manager/page.tsx).
      const split = splitShiftExpenses(exps || [], sh.id, new Set(cats.map(c => c.id)), new Set(emps.map(e => e.id)), true)
      setSettledTodayTotal(split.settledTodayTotal); setUnmanagedPaidTotal(split.unmanagedPaidTotal)
      setCatAmounts(split.catAmounts); setCatNotes(split.catNotes); setEmpExtras(split.empExtras)
        setCustomExpenses(split.customExpenses); setLoadedCustomExpenses(split.customExpenses)
      setCatUnpaid(split.catUnpaid); setEmpUnpaid(split.empUnpaid)
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
      setCatUnpaid({}); setEmpUnpaid({}); setSettledTodayTotal(0); setUnmanagedPaidTotal(0); setCustomExpenses([]); setLoadedCustomExpenses([])
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
      await loadDay(currentDate, empsRes.data || [], catsRes.data || [])
      await loadOpenDebts()
    })()
  }, [restaurantId])

  const changeDate = async (dir: number) => {
    // При сбое автосейва не уходим с дня — иначе несохранённый ввод терялся (паритет с Manager).
    if (shift && !locked) { try { await persistShift() } catch (e: any) { setErr(tr('mg.autosaveErr') + ': ' + (e?.message || '')); return } }
    const d = new Date(currentDate); d.setDate(d.getDate() + dir)
    setCurrentDate(d)
    await loadDay(d)
  }

  const openShift = async () => {
    setSaving(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      // Последняя смена ДО этой даты, не строго «вчера» (аудит 2026-09-27, паритет с loadDay).
      const { data: prevList } = await db.from('shifts').select('closing_balance').eq('restaurant_id', restaurantId).lt('date', fmtDate(currentDate)).order('date', { ascending: false }).order('opened_at', { ascending: false }).limit(1)
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

  const debtSettleTotal = () => eligibleDebts.filter(d => selectedDebtIds.has(d.id)).reduce((s, d) => s + d.amount, 0)

  const calc = () => {
    const inc = parseFloat(income) || 0
    const card = parseFloat(incomeCard) || 0
    const ink = parseFloat(inkSum) || 0
    const catTotal = categories.reduce((s, c) => catUnpaid[c.id] ? s : s + (parseFloat(catAmounts[c.id] || '0') || 0), 0)
    const empExtraTotal = employees.reduce((s, e) => empUnpaid[e.id] ? s : s + (parseFloat(empExtras[e.id] || '0') || 0), 0)
    const debtTotal = debtSettleTotal() + settledTodayTotal
    const totalExp = round2(catTotal + empExtraTotal + customExpenseTotal(customExpenses) + debtTotal + unmanagedPaidTotal + ink)
    const opening = shift?.opening_balance || 0
    const balance = round2(opening + inc - totalExp)
    const inkNet = ink - (parseFloat(inkExpense) || 0)
    return { inc, card, ink, catTotal, empExtraTotal, debtTotal, totalExp, balance, opening, inkNet }
  }

  // Расходы/инкассация пересобираются целиком: insert-новых → delete-старых-по-id
  // (НЕ delete-then-insert). Раньше обрыв сети между delete и insert молча стирал все
  // расходы и инкассацию смены, а ошибки insert не проверялись вовсе — ввод исчезал без следа.
  // Тот же порядок, что в app/manager/page.tsx (коммит b34d583) и ManagerView.swift.
  // Если упадёт финальный delete — останутся видимые дубли, следующее успешное сохранение
  // их подчистит (старые id уже собраны).
  // Тот же атомарный RPC settle_debts, что в app/manager/page.tsx (аудит 2026-09-27): раньше
  // здесь были два независимых запроса (сбой между ними = рассинхрон), и ЗП-долг гасился без
  // записи в salary_payments — сотрудник оставался «не оплачен», можно было заплатить дважды.
  const persistDebtSettlements = async (shiftId: string, dateStr: string) => {
    const ids = Array.from(selectedDebtIds)
    if (ids.length === 0) return
    const selected = openDebts.filter(d => ids.includes(d.id))
    if (selected.length === 0) return
    const debts = selected.map(d => {
      const isSalary = !!(d.employeeId && d.note?.startsWith(SALPERIOD_PREFIX))
      return {
        id: d.id, amount: d.amount,
        category_id: d.categoryId || null, category_name: d.categoryName || null,
        employee_id: d.employeeId || null,
        is_salary: isSalary,
        salary_period: isSalary ? (d.note as string).slice(SALPERIOD_PREFIX.length) : null,
        salary_note: tr('an.debtSettleNote'),
        expense_note: `${tr('an.debtSettleNote')} (${d.date})`,
      }
    })
    const { error } = await db.rpc('settle_debts', { p_shift_id: shiftId, p_date_str: dateStr, p_debts: debts })
    if (error) throw new Error(error.message)
  }

  // Параллельный вызов для той же смены присоединяется к идущему сохранению (см. manager/page.tsx).
  const validateCustomExpenses = () => {
    let rows: ReturnType<typeof prepareCustomExpenses>
    try { rows = prepareCustomExpenses(customExpenses) }
    catch { throw new Error(tr('mg.customExpenseInvalid')) }
    if (openDebts.some(debt => selectedDebtIds.has(debt.id) && debt.isCustom && debt.shiftId === shift?.id)) {
      throw new Error(tr('mg.customDebtChanged'))
    }
    return rows
  }

  const persistShift = (sh = shift, dateForInk = currentDate): Promise<number | undefined> => {
    if (!sh) return Promise.resolve(undefined)
    const cur = persistInFlight.current
    if (cur && cur.id === sh.id) return cur.p
    setSaving(true)
    const p = persistShiftOnce(sh, dateForInk).finally(() => {
      if (persistInFlight.current?.p === p) persistInFlight.current = null
      setSaving(false)
    })
    persistInFlight.current = { id: sh.id, p }
    return p
  }

  const persistShiftOnce = async (sh: NonNullable<typeof shift>, dateForInk: Date) => {
    const preparedCustom = validateCustomExpenses()
    const customValues = preparedCustom.filter(row => !selectedDebtIds.has(row.id)).map(row => ({
      ...row, shift_id: sh.id, restaurant_id: restaurantId, category_id: null, employee_id: null,
    }))
    const keptCustomIds = new Set(customValues.map(row => row.id))
    // A stale draft must not reopen or overwrite a debt settled on another device.
    const loadedById = new Map(loadedCustomExpenses.map(row => [row.id.toLowerCase(), row]))
    const customIds = [...new Set([...loadedById.keys(), ...keptCustomIds])]
    const liveCustomIds = new Set<string>()
    {
      const { data: freshRows, error: freshError } = await db.from('shift_expenses')
        .select('id, shift_id, is_custom, paid_shift_id, is_paid, category_id, employee_id, category_name, amount, note')
        .eq('shift_id', sh.id).eq('is_custom', true)
      if (freshError) throw new Error(freshError.message)
      // A different device may have added a custom expense since this form loaded.
      // Preserve its ledger row and refuse to replace the shift total with a partial snapshot.
      const liveCustom = splitShiftExpenses(freshRows || [], sh.id, new Set(categories.map(row => row.id)), new Set(employees.map(row => row.id)), true).customExpenses
      if (liveCustom.some(row => !loadedById.has(row.id.toLowerCase()) && !keptCustomIds.has(row.id.toLowerCase()))) {
        throw new Error(tr('mg.customExpenseStale'))
      }
      const freshById = new Map((freshRows || []).map((row: { id: string }) => [row.id.toLowerCase(), row]))
      for (const id of customIds) {
        const original = loadedById.get(id)
        const fresh = freshById.get(id) as {
          shift_id: string; is_custom: boolean; paid_shift_id?: string | null; is_paid?: boolean | null;
          category_id?: string | null; employee_id?: string | null; category_name?: string; amount?: number; note?: string | null
        } | undefined
        if (!fresh) {
          if (original && keptCustomIds.has(id)) throw new Error(tr('mg.customExpenseStale'))
          continue // A previous deletion may have succeeded before its response was lost.
        }
        liveCustomIds.add(id)
        const desired = customValues.find(row => row.id === id)
        const matchesOriginal = original && (fresh.is_paid !== false) === !original.unpaid
          && Number(fresh.amount) === (parseExpenseCents(original.amount) || 0) / 100
          && fresh.category_name === original.name && (fresh.note || '') === (original.note || '')
        const matchesDesired = desired && (fresh.is_paid !== false) === desired.is_paid
          && Number(fresh.amount) === desired.amount && fresh.category_name === desired.category_name
          && (fresh.note || '') === desired.note
        if (fresh.shift_id !== sh.id || fresh.is_custom !== true || !!fresh.paid_shift_id || !!fresh.category_id || !!fresh.employee_id
          || (!matchesOriginal && !matchesDesired)) throw new Error(tr('mg.customExpenseStale'))
      }
    }
    // Keep stable IDs across retries. A rejected custom write must precede cash/settlement writes.
    if (customValues.length > 0) {
      const { error: customErr } = await db.from('shift_expenses').upsert(customValues, { onConflict: 'restaurant_id,id' })
      if (customErr) throw new Error(customErr.message)
    }
    const droppedCustomIds = [...loadedById.keys()].filter(id => !keptCustomIds.has(id) && liveCustomIds.has(id))
    if (droppedCustomIds.length > 0) {
      const { data: deleted, error: deleteError } = await db.from('shift_expenses').delete()
        .in('id', droppedCustomIds).eq('shift_id', sh.id).eq('is_custom', true).is('paid_shift_id', null).select('id')
      if (deleteError) throw new Error(deleteError.message)
      if ((deleted || []).length !== droppedCustomIds.length) throw new Error(tr('mg.customExpenseStale'))
    }
    setLoadedCustomExpenses(customValues.map(row => ({
      id: row.id, name: row.category_name, amount: String(row.amount), unpaid: !row.is_paid, note: row.note,
    })))
    const { inc, card, ink, totalExp, balance } = calc()

    // Погашение долгов — ПЕРВЫМ, до чтения/удаления старых расходов (C3, аудит 2026-08-13/15,
    // см. app/manager/page.tsx за полным объяснением): иначе долг, созданный СЕГОДНЯ же, попадал
    // под удаление ниже раньше, чем помечался оплаченным.
    await persistDebtSettlements(sh.id, fmtDate(dateForInk))

    // Параллельно, как в app/manager/page.tsx и iOS (аудит скорости 2026-10-26).
    const shiftP = db.from('shifts').update({ income: inc, income_card: card, inkassation: ink, total_expense: totalExp, closing_balance: balance }).eq('id', sh.id)
      .then(({ error: upErr }) => { if (upErr) throw new Error(upErr.message) })

    const expensesP = (async () => {

    // paid_shift_id != null — строка управляется экраном «Долги» (Analytics), не трогаем.
    // Удаляем только строки формы (lib/shiftForm.ts), по свежему чтению.
    const { data: oldExpensesAll, error: oldExpErr } = await db.from('shift_expenses').select('id, category_id, category_name, employee_id, amount, note, is_paid, paid_shift_id, is_custom').eq('shift_id', sh.id).order('created_at').order('id')
    if (oldExpErr) throw new Error(oldExpErr.message)
    const oldExpenses = splitShiftExpenses(oldExpensesAll || [], sh.id, new Set(categories.map(c => c.id)), new Set(employees.map(e => e.id))).ownedIds.map(id => ({ id }))
    const inserts: any[] = []
    categories.forEach(c => {
      const amt = parseFloat(catAmounts[c.id] || '0')
      if (amt > 0) inserts.push({ shift_id: sh.id, restaurant_id: restaurantId, category_id: c.id, category_name: c.name, amount: amt, note: catNotes[c.id] || '', is_paid: !catUnpaid[c.id] })
    })
    employees.forEach(emp => {
      const extra = parseFloat(empExtras[emp.id] || '0')
      if (extra > 0) inserts.push({ shift_id: sh.id, restaurant_id: restaurantId, employee_id: emp.id, category_name: emp.name + ' (экстра)', amount: extra, is_paid: !empUnpaid[emp.id] })
    })
    if (inserts.length > 0) {
      const { error: insErr } = await db.from('shift_expenses').insert(inserts)
      if (insErr) throw new Error(insErr.message)
    }
    if (oldExpenses.length > 0) {
      const { error: delErr } = await db.from('shift_expenses').delete().in('id', oldExpenses.map(e => e.id))
      if (delErr) throw new Error(delErr.message)
    }
    })()

    const inkP = (async () => {
    // UPDATE по id вместо delete+insert (A2, аудит 2026-08-09) — delta-merge поверх актуального
    // значения в БД, чтобы не затирать то, что параллельно записал addAdvance/settleDebt.
    const { data: curInkList, error: curInkErr } = await db.from('inkassations').select('id, expense, salary, reason').eq('shift_id', sh.id).limit(1)
    if (curInkErr) throw new Error(curInkErr.message)
    const curInk = Array.isArray(curInkList) ? curInkList[0] : curInkList
    const finalExpense = (curInk?.expense || 0) + ((parseFloat(inkExpense) || 0) - (parseFloat(loadedInkExpense) || 0))
    const curReason = curInk?.reason || ''
    const finalReason = (curReason === loadedInkReason || inkReason !== loadedInkReason) ? inkReason : curReason
    // См. app/manager/page.tsx: строка с одной выплатой ЗП (salary) не «пустая» — не удалять.
    const curSalary = curInk?.salary || 0
    const finalTotal = ink - finalExpense - curSalary
    if (ink > 0 || finalExpense !== 0 || finalReason || curSalary !== 0) {
      const values = { restaurant_id: restaurantId, date: fmtDate(dateForInk), amount: ink, expense: finalExpense, reason: finalReason, total: finalTotal }
      let { error: inkErr } = curInk
        ? await db.from('inkassations').update(values).eq('id', curInk.id)
        : await db.from('inkassations').insert({ shift_id: sh.id, ...values })
      if (inkErr && !curInk) {
        // unique(shift_id): строку создали параллельно — дельта поверх неё (см. manager/page.tsx).
        const { data: racedList } = await db.from('inkassations').select('id, expense, salary').eq('shift_id', sh.id).limit(1)
        const raced = Array.isArray(racedList) ? racedList[0] : racedList
        if (raced) {
          const exp2 = (raced.expense || 0) + ((parseFloat(inkExpense) || 0) - (parseFloat(loadedInkExpense) || 0))
          ;({ error: inkErr } = await db.from('inkassations').update({ ...values, expense: exp2, total: ink - exp2 - (raced.salary || 0) }).eq('id', raced.id))
        }
      }
      if (inkErr) throw new Error(inkErr.message)
    } else if (curInk) {
      await db.from('inkassations').delete().eq('id', curInk.id)
    }
    setLoadedInkExpense(inkExpense); setLoadedInkReason(inkReason)
    })()

    const absP = db.from('shift_absences').update({ shift_id: sh.id, source: 'manager' }).eq('restaurant_id', restaurantId).eq('date', fmtDate(dateForInk))

    await Promise.all([shiftP, expensesP, inkP, absP])
    setAutoAbsences(new Set())

    if (selectedDebtIds.size > 0) {
      const settledIds = selectedDebtIds
      setCustomExpenses(rows => rows.filter(row => !settledIds.has(row.id)))
      // Бамп ДО очистки выбора — иначе повторное «Редактировать → Сохранить» в той же сессии
      // писало кассу без уже погашенной суммы (аудит 2026-09-27, паритет с Manager A1).
      const settledAmt = debtSettleTotal()
      setOpenDebts(ds => ds.filter(d => !settledIds.has(d.id)))
      setSelectedDebtIds(new Set())
      setSettledTodayTotal(prev => prev + settledAmt)
    }

    setShift({ ...sh, income: inc, inkassation: ink, total_expense: totalExp, closing_balance: balance })
    // Refresh custom debts added/paid with the row toggle before navigating to another shift.
    await loadOpenDebts()
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
    if (!shift || savingRef.current) return
    savingRef.current = true
    try { await saveShiftLocked(force) } finally { savingRef.current = false }
  }

  const saveShiftLocked = async (force: boolean) => {
    if (!shift) return
    try { validateCustomExpenses() } catch (error) { setErr(tr('mg.err') + ': ' + (error as Error).message); return }
    setSaving(true)
    if (!force && await closeChecklistIncomplete()) { setChecklistWarn(true); setSaving(false); return }
    if (!force && debtSettleTotal() > 0 && calc().balance < 0) { setDebtNegativeWarn(true); setSaving(false); return }
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
  }

  const forceClose = async () => {
    if (!shift) return
    try { validateCustomExpenses() } catch (error) { setErr((error as Error).message); return }
    setClosing(true)
    await db.from('shifts').update({ status: 'closed' }).eq('id', shift.id)
    setShift({ ...shift, status: 'closed' })
    setCloseConfirm(false); setClosing(false)
    await loadHistory()
  }

  const { ink, catTotal, empExtraTotal, debtTotal, totalExp, balance } = calc()
  const netExpense = round2(totalExp - ink) // вкл. «прочие расходы дня» вне формы (lib/shiftForm.ts)
  const totalIncome = (parseFloat(income) || 0) + (parseFloat(incomeCard) || 0)
  const daysInMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0).getDate()
  const dowRaw = currentDate.toLocaleDateString(locale, { weekday: 'long' })
  const dowName = dowRaw.charAt(0).toUpperCase() + dowRaw.slice(1)

  const historyColumns: TableColumn<Shift>[] = [
    { key: 'date', label: tr('mg.sumDate'), sortable: true, render: s => displayDate(new Date(s.date + 'T00:00:00')) },
    { key: 'status', label: tr('mg.secRegister'), render: s => <Badge tone={s.status === 'open' ? 'ok' : 'neutral'}>{s.status === 'open' ? tr('mg.statusOpen') : tr('mg.statusClosed')}</Badge> },
    { key: 'income', label: tr('mg.cash'), align: 'right', sortable: true, sortValue: s => s.income || 0, render: s => `€${fv(s.income || 0)}` },
    { key: 'income_card', label: tr('mg.sumCard'), align: 'right', sortable: true, sortValue: s => s.income_card || 0, render: s => `€${fv(s.income_card || 0)}` },
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
      <Card style={{ marginBottom: 18, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
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

      {!loadingDay && shift && (
        <div className="shifts-summary" aria-label={tr('dash.navShifts')}>
          <Card style={{ minWidth: 0 }}>
            <div className="shifts-summary-label">{tr('mg.totalIncome')}</div>
            <div className="shifts-summary-value">€{fv(totalIncome)}</div>
            <div className="shifts-summary-note">{tr('mg.cash')} €{fv(parseFloat(income) || 0)} · {tr('mg.sumCard')} €{fv(parseFloat(incomeCard) || 0)}</div>
          </Card>
          <Card style={{ minWidth: 0 }}>
            <div className="shifts-summary-label">{tr('mg.registerEnd')}</div>
            <div className="shifts-summary-value" style={{ color: balance < 0 ? 'var(--danger)' : 'var(--tx)' }}>€{fv(balance)}</div>
            <div className="shifts-summary-note">{tr('mg.cellIn')} €{fv(shift.opening_balance || 0)} · {tr('mg.cardHint')}</div>
          </Card>
          <Card style={{ minWidth: 0 }}>
            <div className="shifts-summary-label">{tr('mg.sumTotalExpense')}</div>
            <div className="shifts-summary-value">€{fv(totalExp)}</div>
            <div className="shifts-summary-note">{tr('mg.expense')} €{fv(netExpense)} · {tr('mg.cellInk')} €{fv(ink)}</div>
          </Card>
        </div>
      )}

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
          <div className="shifts-editor" style={{ opacity: locked ? .7 : 1 }}>
            {/* ЛЕВАЯ КОЛОНКА: сотрудники + расходы */}
            <div className="shifts-editor-column">
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
                      <button onClick={() => setEmpUnpaid({ ...empUnpaid, [emp.id]: !empUnpaid[emp.id] })} disabled={locked} title={tr('mg.debtToggle')}
                        style={{ width: 24, height: 24, borderRadius: '50%', border: 'none', background: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: locked ? 'default' : 'pointer', flexShrink: 0 }}>
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={empUnpaid[emp.id] ? 'var(--warn)' : 'var(--tx3)'} strokeWidth="2" opacity={empUnpaid[emp.id] ? 1 : 0.4}><circle cx="12" cy="12" r="10" /><path d="M12 8v5M12 16h.01" strokeLinecap="round" /></svg>
                      </button>
                      <input type="number" value={empExtras[emp.id] || ''} disabled={locked}
                        onChange={e => setEmpExtras({ ...empExtras, [emp.id]: e.target.value })}
                        placeholder="€ 0" className="ui-input" style={{ ...numInput, background: empUnpaid[emp.id] ? 'var(--warn-soft)' : numInput.background }} />
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

              {eligibleDebts.length > 0 && (
                <Card>
                  <button onClick={() => setShowDebts(!showDebts)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>
                    <svg width="14" height="14" fill="var(--warn)" stroke="none" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><path d="M12 8v5M12 16h.01" stroke="var(--surface, #fff)" strokeWidth="2" strokeLinecap="round" /></svg>
                    <span style={{ fontWeight: 700, fontSize: '.85rem', color: 'var(--tx)' }}>{tr('an.debts')}</span>
                    <Badge tone="warn">{eligibleDebts.length}</Badge>
                    <div style={{ flex: 1 }} />
                    {debtSettleTotal() > 0 && <span style={{ fontSize: '.8rem', fontWeight: 700, color: 'var(--warn)' }}>−€{fv(debtSettleTotal())}</span>}
                    <svg width="10" height="10" fill="none" stroke="var(--tx3)" strokeWidth="2.2" viewBox="0 0 24 24" style={{ transform: showDebts ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }}><path d="M6 9l6 6 6-6" /></svg>
                  </button>
                  {showDebts && eligibleDebts.map(d => {
                    const sel = selectedDebtIds.has(d.id)
                    return (
                      <button key={d.id} onClick={() => setSelectedDebtIds(prev => { const n = new Set(prev); sel ? n.delete(d.id) : n.add(d.id); return n })}
                        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', borderTop: 'var(--hairline)', background: 'none', border: 'none', borderTopStyle: 'solid', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}>
                        <svg width="15" height="15" fill={sel ? 'var(--warn)' : 'none'} stroke={sel ? 'var(--warn)' : 'var(--tx3)'} strokeWidth="2" viewBox="0 0 24 24">{sel ? <path d="M9 12l2 2 4-4M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /> : <circle cx="12" cy="12" r="9" />}</svg>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: '.8rem', color: 'var(--tx)' }}>{d.categoryName}</div>
                          <div style={{ fontSize: '.7rem', color: 'var(--tx3)' }}>{d.date}</div>
                        </div>
                        <span style={{ fontSize: '.8rem', fontWeight: 700, color: 'var(--warn)' }}>€{fv(d.amount)}</span>
                      </button>
                    )
                  })}
                </Card>
              )}

              <Card>
                <div style={{ fontWeight: 700, fontSize: '.85rem', color: 'var(--tx)', marginBottom: 4 }}>{tr('mg.secExpenses')}</div>
                {categories.map(cat => {
                  const val = catAmounts[cat.id] || ''
                  const hasVal = parseFloat(val) > 0
                  return (
                    <div key={cat.id} style={{ padding: '8px 0', borderBottom: 'var(--hairline)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                        <div style={{ flex: 1, fontSize: '.85rem', color: 'var(--tx)' }}>{cat.name}</div>
                        <button onClick={() => setCatUnpaid({ ...catUnpaid, [cat.id]: !catUnpaid[cat.id] })} disabled={locked} title={tr('mg.debtToggle')}
                          style={{ width: 24, height: 24, borderRadius: '50%', border: 'none', background: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: locked ? 'default' : 'pointer', flexShrink: 0 }}>
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={catUnpaid[cat.id] ? 'var(--warn)' : 'var(--tx3)'} strokeWidth="2" opacity={catUnpaid[cat.id] ? 1 : 0.4}><circle cx="12" cy="12" r="10" /><path d="M12 8v5M12 16h.01" strokeLinecap="round" /></svg>
                        </button>
                        <input type="number" value={val} disabled={locked}
                          onChange={e => setCatAmounts({ ...catAmounts, [cat.id]: e.target.value })}
                          placeholder="€ 0" className="ui-input" style={{ ...numInput, background: catUnpaid[cat.id] ? 'var(--warn-soft)' : numInput.background }} />
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
                <CustomExpenseFields rows={customExpenses} onChange={setCustomExpenses} restaurantId={restaurantId}
                  contextKey={`${shift?.id || ''}:${fmtDate(currentDate)}`} disabled={locked || saving || loadingDay} />
              </Card>
            </div>

            {/* ПРАВАЯ КОЛОНКА: инкассация + касса */}
            <div className="shifts-editor-column">
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

              {debtNegativeWarn && (
                <Card>
                  <div style={{ fontSize: '.85rem', fontWeight: 700, color: 'var(--tx)', marginBottom: 4 }}>{tr('mg.debtNegativeWarnTitle')}</div>
                  <div style={{ fontSize: '.78rem', color: 'var(--tx2)', marginBottom: 10, lineHeight: 1.5 }}>{tr('mg.debtNegativeWarnBody', { amount: `€${fv(calc().balance)}` })}</div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <Btn small variant="danger" onClick={() => { setDebtNegativeWarn(false); saveShift(true) }}>{tr('mg.debtNegativeWarnAnyway')}</Btn>
                    <Btn small variant="ghost" onClick={() => setDebtNegativeWarn(false)}>{tr('mg.debtNegativeWarnBack')}</Btn>
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
      <h2 className="shifts-history-title">{tr('dash.shiftsHistory')}</h2>
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
