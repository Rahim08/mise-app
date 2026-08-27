'use client'
import React, { useEffect, useState } from 'react'
import { db } from '@/lib/db'
import { useI18n } from '@/lib/i18n'
import { fmtDate } from '@/lib/format'
import { computeAccruedToday } from '@/lib/analytics'
import { inp, lbl, fmtHours, hoursOf } from '@/app/people/shared'
import { Sheet } from '@/components/people/helpers'

// Manager → Зарплата (реструктура 2026-08-13, см. docs/MANAGER-PEOPLE-RESTRUCTURE-2026-08-13.md).
// Перенесено из app/people/tabs-salary.tsx (там остался только личный вид менеджера, как у
// сотрудника) — фонд ЗП, долг, список сотрудников и кнопка «Оплатить» теперь только здесь.
// Оплата пишет прямо в inkassations.salary/salary_note дня выплаты (паритет с iOS ManagerSalary.swift).

const eur = (n: number) => `€${Math.round(n).toLocaleString('de-DE')}`
const absDate = (d: string) => new Date(d).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })
// Тег с суммой (юзер-фидбок 2026-08-15): без неё в заметке инкассации было просто «Имя аванс»
// без числа. id-суффикс не отображается юзеру (см. displayReason, lib/format.ts) — нужен
// только чтобы deleteAdvance не стирал чужой аванс того же имени за тот же день (A4).
const advanceTag = (name: string, amount: number, id: string) => `${name} аванс ${eur(amount)}·${(id || '').slice(0, 8)}`

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
  // Отдельно от payError (текст ошибки) — специально помечает случай «не хватает налички»,
  // чтобы под ошибкой показать кнопку «Отметить как долг» (юзер-фидбок 2026-08-20).
  const [payInsufficient, setPayInsufficient] = useState(false)
  const [markingDebt, setMarkingDebt] = useState(false)
  const [paying, setPaying] = useState(false)
  const [debt, setDebt] = useState<{ total: number; byId: Record<string, number> }>({ total: 0, byId: {} })
  // Долг-леджер (2026-08-20): остаток за ПРОШЛЫЕ месяцы теперь материализуется как обычная
  // строка shift_expenses (is_paid=false, employee_id, note=SALPERIOD:<period>) — та же таблица,
  // тот же UI «Долги», что и расходные/экстра-долги в Manager→Смена (см. app/manager/page.tsx
  // openDebts). Здесь, в ЗП — только ЧТЕНИЕ (юзер-фидбок 2026-08-20: «взаимодействие — выплата —
  // он делает только благодаря открытию смены»); сама галочка/оплата — только там.
  const [ledgerRows, setLedgerRows] = useState<{ id: string; employeeId: string; employeeName: string; period: string; amount: number; date: string }[]>([])
  const [showDebtList, setShowDebtList] = useState(false)
  const [payoutDay, setPayoutDay] = useState<number | null>(null)
  const [prevCashTotal, setPrevCashTotal] = useState(0)
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
      // Фильтр по period (месяц ЗП), не по date (день списания из кассы) — юзер-фидбок
      // 2026-08-15: аванс, взятый в июле датой на август, должен остаться в зарплате июля.
      db.from('salary_advances').select('*').eq('period', monthStart),
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
    // A2 (аудит 2026-08-15): remaining должен уменьшаться только оплатами method='cash' —
    // `card` (monthly_card_amounts) уже вычтен из `cash` бюджетно; если ещё и salary_payments с
    // method='card' вычесть из remaining, одна и та же карточная часть спишется дважды и может
    // пометить сотрудника «оплачен полностью», хотя реальный нал ещё не выплачен.
    const paidByEmp: Record<string, number> = {}; const paidCashByEmp: Record<string, number> = {}; const lastPaidByEmp: Record<string, string> = {}
    ;(pays || []).forEach((p: any) => {
      paidByEmp[p.employee_id] = (paidByEmp[p.employee_id] || 0) + Number(p.amount || 0)
      if ((p.method || 'cash') === 'cash') paidCashByEmp[p.employee_id] = (paidCashByEmp[p.employee_id] || 0) + Number(p.amount || 0)
      if (!lastPaidByEmp[p.employee_id] || p.paid_at > lastPaidByEmp[p.employee_id]) lastPaidByEmp[p.employee_id] = p.paid_at
    })
    return (emps || []).map((e: any) => {
      const salary = Number(e.salary || 0)
      const dates = (absByEmp[e.id] || []).sort()
      const deduct = dates.length * Number(e.deduct_per_absence || 0)
      const card = cardByEmp[e.id] ?? 0
      const advance = advByEmp[e.id] || 0
      const paid = paidByEmp[e.id] || 0
      const paidCash = paidCashByEmp[e.id] || 0
      const total = Math.max(0, salary - deduct)
      const cash = Math.max(0, total - advance - card)
      const remaining = Math.max(0, cash - paidCash)
      return { id: e.id, name: e.name, salary, dates, absences: dates.length, deduct, card, advance, advanceRows: (advRowsByEmp[e.id] || []).sort((a, b) => a.date < b.date ? 1 : -1), paid, paidCash, remaining, total, cash, lastPaidAt: lastPaidByEmp[e.id] || null, hours: hoursByName[e.name] || 0 }
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
    // Собираем целевое состояние леджера (кто/за какой период/сколько ещё должны) по всем
    // прошлым месяцам одним проходом, ДО похода в базу — дальше один select всех существующих
    // SALPERIOD-строк ресторана и диффом решаем, что удалить/вставить (вместо N запросов на
    // каждую пару сотрудник×месяц — дорого при полугодовой истории и большом штате).
    const target: { empId: string; empName: string; period: string; monthEnd: string; amount: number }[] = []
    // Периоды, которые реально прошли ниже (после фильтра DEBT_TRACKING_START) — ТОЛЬКО для
    // них ниже разрешена очистка чужих строк. Иначе (баг 2026-08-20, найден при аудите): текущий
    // месяц (i=0) в цикл не попадает вообще, а пока не пройден первый полный месяц после
    // DEBT_TRACKING_START — цикл пуст целиком → syncLedger(target=[]) видел бы ЛЮБУЮ открытую
    // SALPERIOD-строку как «незнакомую» и удалял её, включая ту, что markAsDebt только что
    // создал для текущего месяца — долг стирался в том же действии, которым создавался.
    const scannedPeriods: string[] = []
    for (let i = 1; i <= 6; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      if (d < DEBT_TRACKING_START) continue
      const period = `${fmtDate(d).slice(0, 7)}-01`
      scannedPeriods.push(period)
      const monthEnd = fmtDate(new Date(d.getFullYear(), d.getMonth() + 1, 0))
      const list = await computeMonth(fmtDate(d).slice(0, 7))
      list.forEach((r: any) => {
        if (r.remaining > 0) {
          total += r.remaining; byId[r.id] = (byId[r.id] || 0) + r.remaining
          target.push({ empId: r.id, empName: r.name, period, monthEnd, amount: Math.round(r.remaining) })
        }
      })
    }
    setDebt({ total, byId })
    await syncLedger(target, scannedPeriods)
  }

  const syncLedger = async (target: { empId: string; empName: string; period: string; monthEnd: string; amount: number }[], scannedPeriods: string[]) => {
    const { data: existing } = await db.from('shift_expenses').select('id, employee_id, amount, note, shift_id').eq('restaurant_id', restaurantId).eq('is_paid', false).like('note', `${SALPERIOD_PREFIX}%`)
    const existingByKey = new Map<string, { id: string; amount: number }>()
    ;(existing || []).forEach((r: any) => existingByKey.set(`${r.employee_id}|${r.note}`, { id: r.id, amount: Number(r.amount || 0) }))
    const toDelete: string[] = []; const toInsert: typeof target = []
    const seenKeys = new Set<string>()
    target.forEach(row => {
      const key = `${row.empId}|${SALPERIOD_PREFIX}${row.period}`
      seenKeys.add(key)
      const cur = existingByKey.get(key)
      if (!cur) { toInsert.push(row); return }
      if (cur.amount !== row.amount) { toDelete.push(cur.id); toInsert.push(row) }
    })
    // Всё, что осталось в existingByKey, не встретилось в target, И относится к периоду, который
    // этот проход реально просканировал — долг погашен обычной выплатой из ЗП напрямую
    // (savePayment), леджер устарел, чистим. Строки за периоды ВНЕ scannedPeriods (текущий месяц,
    // markAsDebt) — не трогаем, этот проход про них ничего не знает.
    const scannedNotes = new Set(scannedPeriods.map(p => `${SALPERIOD_PREFIX}${p}`))
    existingByKey.forEach((v, key) => {
      if (seenKeys.has(key)) return
      const note = key.slice(key.indexOf('|') + 1)
      if (scannedNotes.has(note)) toDelete.push(v.id)
    })
    if (toDelete.length > 0) await db.from('shift_expenses').delete().in('id', toDelete)
    if (toInsert.length > 0) {
      const shiftByDate = new Map<string, string>()
      for (const row of toInsert) {
        if (!shiftByDate.has(row.monthEnd)) {
          const sh = await ensureShift(row.monthEnd)
          if (sh) shiftByDate.set(row.monthEnd, sh.id)
        }
      }
      const inserts = toInsert.filter(row => shiftByDate.has(row.monthEnd)).map(row => ({
        shift_id: shiftByDate.get(row.monthEnd), restaurant_id: restaurantId, employee_id: row.empId,
        category_name: `${tr('pe.salaryWord')} — ${periodLabel(row.period)}`,
        amount: row.amount, is_paid: false, note: `${SALPERIOD_PREFIX}${row.period}`,
      }))
      if (inserts.length > 0) await db.from('shift_expenses').insert(inserts)
    }
    setLedgerRows(target.map(row => ({ id: `${row.empId}|${row.period}`, employeeId: row.empId, employeeName: row.empName, period: row.period, amount: row.amount, date: row.monthEnd })))
  }
  useEffect(() => { loadDebt() }, [])

  const changeMonth = (dir: number) => { const d = new Date(viewDate); d.setDate(1); d.setMonth(d.getMonth() + dir); setViewDate(d) }

  useEffect(() => {
    db.from('restaurant_settings').select('salary_payout_day').limit(1).then(({ data }: any) => {
      const r = Array.isArray(data) ? data[0] : data
      setPayoutDay(r?.salary_payout_day ?? null)
    })
  }, [])

  // C3 (аудит 2026-08-15): для payout-day-цикла (см. computeAccruedToday) нужен кэш-нал
  // прошлого месяца, пока не наступил payout_day текущего — паритет с Analytics.
  useEffect(() => {
    if (!isCurrentMonth) return
    const now = new Date()
    const d = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    computeMonth(fmtDate(d).slice(0, 7)).then(prevRows => setPrevCashTotal(prevRows.reduce((s, r: any) => s + r.cash, 0)))
  }, [isCurrentMonth])

  // Смена/инкассация на дату оплаты может не существовать — создаём её тем же паттерном,
  // что openShift (opening = closing предыдущей смены, gap-tolerant .lt('date', ...)).
  const ensureShift = async (dateStr: string): Promise<{ id: string; inkassation: number } | null> => {
    const { data: existing } = await db.from('shifts').select('id, inkassation').eq('restaurant_id', restaurantId).eq('date', dateStr).order('opened_at').limit(1)
    const ex = Array.isArray(existing) ? existing[0] : existing
    if (ex?.id) return { id: ex.id, inkassation: ex.inkassation || 0 }
    const { data: prevList } = await db.from('shifts').select('closing_balance').eq('restaurant_id', restaurantId).lt('date', dateStr).order('date', { ascending: false }).order('opened_at', { ascending: false }).limit(1)
    const opening = (Array.isArray(prevList) ? prevList[0] : prevList)?.closing_balance || 0
    const { data: sh } = await db.from('shifts').insert({
      restaurant_id: restaurantId, date: dateStr,
      opening_balance: opening, income: 0, inkassation: 0,
      closing_balance: opening, status: 'open',
    }).select().single()
    return sh?.id ? { id: sh.id, inkassation: 0 } : null
  }

  const SALPERIOD_PREFIX = 'SALPERIOD:'
  const periodLabel = (period: string) => new Date(period).toLocaleDateString(tr('dash.locale'), { month: 'long', year: 'numeric' })

  // Долг-леджер (юзер-фидбок 2026-08-20): остаток по ЗП за месяц материализуется как обычная
  // строка shift_expenses (is_paid=false, employee_id, note=SALPERIOD:<period>) — та же таблица
  // и тот же UI «Долги», что уже показывает расходные/экстра-долги в Manager→Смена (openDebts,
  // app/manager/page.tsx). Здесь, в ЗП — только показываем; галочка/оплата — только там (юзер:
  // «взаимодействие — выплата — он делает только благодаря открытию смены»).
  // Идемпотентно: удаляем старую открытую запись за этот (сотрудник, период) и вставляем
  // свежую с текущим remaining — не накапливаем/не дрейфуем при частичных доплатах между
  // запусками (юзер-фидбок: «долг не делим по частям — платим/держим целиком»).
  const syncSalaryLedger = async (empId: string, period: string, dateStr: string, remaining: number) => {
    const noteTag = `${SALPERIOD_PREFIX}${period}`
    const { data: existing } = await db.from('shift_expenses').select('id').eq('restaurant_id', restaurantId).eq('employee_id', empId).eq('note', noteTag).eq('is_paid', false)
    const staleIds = (existing || []).map((r: any) => r.id)
    if (staleIds.length > 0) await db.from('shift_expenses').delete().in('id', staleIds)
    if (remaining <= 0) return
    const sh = await ensureShift(dateStr)
    if (!sh) return
    await db.from('shift_expenses').insert({
      shift_id: sh.id, restaurant_id: restaurantId, employee_id: empId,
      category_name: `${tr('pe.salaryWord')} — ${periodLabel(period)}`,
      amount: remaining, is_paid: false, note: noteTag,
    })
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
  // A3 (аудит 2026-08-15): addAdvance/deleteAdvance/savePayment читали inkassations и писали
  // обратно без защиты от гонки — persistShift для этой же таблицы уже был захардён (A2, аудит
  // 2026-08-09) после того, как именно параллельная правка ОТСЮДА теряла данные при перезаписи.
  // Здесь сам read-modify-write остался незащищённым: два аванса подряд (или аванс + выплата
  // одновременно) читают один снэпшот, вторая запись затирает первую. Compare-and-swap на поле,
  // которое эта операция меняет — если строка успела измениться между чтением и записью, update
  // не находит совпадения (0 строк), перечитываем и повторяем один раз.
  const casUpdateInk = async (shiftId: string, casField: 'expense' | 'salary', casValue: number, values: Record<string, unknown>) => {
    const { data } = await db.from('inkassations').update(values).eq('shift_id', shiftId).eq(casField, casValue).select()
    return Array.isArray(data) && data.length > 0
  }

  const addAdvance = async (empId: string, empName: string, amount: number, dateStr: string) => {
    // Аванс не может увести сотрудника в минус по ЗП (юзер-фидбок 2026-08-14) — row.remaining
    // уже = max(0, cash − paid), т.е. именно то, что ещё можно выдать до конца месяца.
    // fail-closed (паритет с iOS addAdvance, аудит 2026-08-15): если строка сотрудника почему-то
    // не найдена — блокируем целиком, а не пропускаем без проверки.
    // A6-ревизия (юзер-фидбок 2026-08-15): аванс относится к зарплате МЕСЯЦА ЭКРАНА (ym, тот, на
    // котором стоишь, когда жмёшь «добавить»), не к месяцу даты списания — dateStr это только
    // день, когда деньги физически уходят из кассы, можно указать и вне ym.
    const row = rows.find(r => r.id === empId)
    if (!row) { showToast(tr('pe.saveFailed', { err: 'row' })); return }
    if (amount > row.remaining) { showToast(tr('an.advanceExceedsRemaining', { avail: eur(row.remaining) })); return }
    const { data: advRow, error: insErr } = await db.from('salary_advances').insert({ restaurant_id: restaurantId, employee_id: empId, amount, date: dateStr, period: `${ym}-01`, note: `${empName} аванс` }).select().single()
    if (insErr) { showToast(tr('pe.saveFailed', { err: insErr.message })); return }
    // A4 (аудит 2026-08-15): тег с id аванса вместо голого «Имя аванс» — иначе deleteAdvance
    // ниже стирал бы фрагмент reason ЛЮБОГО аванса этого сотрудника за день, а не только удаляемый.
    const advTag = advanceTag(empName, amount, advRow?.id || '')
    const shift = await findShiftForDate(dateStr)
    if (shift) {
      let ink = await findInkassation(shift.id)
      const applyAdvance = (base: any) => {
        const baseAmount = base?.amount ?? shift.inkassation ?? 0
        const newExpense = (base?.expense || 0) + amount
        const newReason = [base?.reason || null, advTag].filter(Boolean).join(', ')
        const newTotal = baseAmount - newExpense - (base?.salary || 0)
        return { baseAmount, newExpense, newReason, newTotal }
      }
      if (ink) {
        let { newExpense, newReason, newTotal } = applyAdvance(ink)
        let ok = await casUpdateInk(shift.id, 'expense', ink.expense || 0, { expense: newExpense, reason: newReason, total: newTotal })
        if (!ok) {
          ink = await findInkassation(shift.id)
          if (ink) {
            ({ newExpense, newReason, newTotal } = applyAdvance(ink))
            ok = await casUpdateInk(shift.id, 'expense', ink.expense || 0, { expense: newExpense, reason: newReason, total: newTotal })
          }
        }
        if (!ok) showToast(tr('pe.saveFailed', { err: 'race' }))
      } else {
        const { baseAmount, newExpense, newReason, newTotal } = applyAdvance(ink)
        // Раньше результат insert не проверялся: salary_advances уже записан (аванс числится
        // у сотрудника), а инкассация — нет при сбое, деньги молча выпадают из кассы
        // (money-integrity, тот же класс багов, что A5 в deleteAdvance выше).
        const { error } = await db.from('inkassations').insert({ shift_id: shift.id, restaurant_id: restaurantId, date: dateStr, amount: baseAmount, expense: newExpense, reason: newReason, salary: 0, total: newTotal })
        if (error) showToast(tr('pe.saveFailed', { err: error.message }))
      }
    } else {
      showToast(tr('an.advanceInkassationMissing'))
    }
    await load(); await loadDebt()
  }

  const deleteAdvance = async (a: any, empName: string) => {
    // A5 (аудит 2026-08-16): раньше salary_advances удалялся ПЕРВЫМ безусловно, а компенсация
    // inkassations — best-effort в один retry; если CAS не проходил (гонка с автосейвом смены —
    // shift остаётся open и persistShift пишет в ту же строку), аванс исчезал из salary_advances,
    // а списанные деньги в кассе (inkassations.expense) оставались — реальный случай (Виталий,
    // SO, 2026-08-10: 200 удалён из salary_advances, expense/total в inkassations не откатились).
    // Теперь: компенсируем СНАЧАЛА, до 5 попыток; salary_advances удаляем только после
    // подтверждённой компенсации — деньги не теряются даже под затяжной гонкой.
    const shift = await findShiftForDate(a.date)
    if (shift) {
      let ink = await findInkassation(shift.id)
      const advTag = advanceTag(empName, Number(a.amount || 0), a.id || '')
      const applyRemoval = (base: any) => {
        const newExpense = Math.max(0, (base.expense || 0) - Number(a.amount || 0))
        // A4 (аудит 2026-08-15): точный тег по id (см. addAdvance) — с фолбэком на старый
        // startsWith-префикс для авансов, созданных до этого фикса (без тега в reason).
        const parts = (base.reason || '').split(', ')
        const newReason = (parts.includes(advTag) ? parts.filter((s: string) => s !== advTag) : parts.filter((s: string) => !s.startsWith(`${empName} аванс`))).join(', ')
        const newTotal = (base.amount ?? shift.inkassation ?? 0) - newExpense - (base.salary || 0)
        return { newExpense, newReason, newTotal }
      }
      if (ink) {
        let ok = false
        for (let i = 0; i < 5 && !ok; i++) {
          if (i > 0) ink = await findInkassation(shift.id)
          if (!ink) break
          const { newExpense, newReason, newTotal } = applyRemoval(ink)
          ok = await casUpdateInk(shift.id, 'expense', ink.expense || 0, { expense: newExpense, reason: newReason, total: newTotal })
        }
        if (!ok) { showToast(tr('pe.saveFailed', { err: 'race' })); return }
      }
    }
    const { error } = await db.from('salary_advances').delete().eq('id', a.id)
    if (error) { showToast(tr('pe.saveFailed', { err: error.message })); return }
    await load(); await loadDebt()
  }

  // Выплата ЗП «прямо из инкассации» — записывается на инкассацию дня оплаты
  // (inkassations.salary += amount, salary_note дописывается «Имя: Сумма»), но лимит «не уйти
  // в минус» сверяется с накопительным кошельком инкассации (см. ниже), не с суммой этого дня.
  // Карта — безнал, кассы не касается.
  const savePayment = async () => {
    if (!payFor) return
    const amount = Number(payFor.amount) || 0
    if (amount <= 0) return
    setPaying(true); setPayError(null); setPayInsufficient(false)
    const method = payFor.method || 'cash'
    const dateStr = payFor.date || fmtDate(new Date())

    if (method === 'cash') {
      const sh = await ensureShift(dateStr)
      if (!sh) { setPayError(tr('pe.saveFailed', { err: 'shift' })); setPaying(false); return }
      const shiftId = sh.id
      // Инкассация — накопительный кошелёк, не сумма конкретного дня (юзер-фидбок 2026-08-16):
      // доступно = вся инкассация по сменам минус всё уже списанное (расход+ЗП) за всё время
      // (те же cumulativeInkass, что в app/analytics/page.tsx). Раньше сверяли только с
      // инкассацией дня выплаты — ложно блокировало или пропускало мимо реального остатка.
      const [{ data: shAll }, { data: inkAll }, { data: inkList }] = await Promise.all([
        db.from('shifts').select('inkassation').eq('restaurant_id', restaurantId),
        db.from('inkassations').select('expense, salary').eq('restaurant_id', restaurantId),
        db.from('inkassations').select('id, amount, expense, salary, salary_note').eq('shift_id', shiftId).limit(1),
      ])
      const grossInk = (shAll || []).reduce((s: number, r: any) => s + (r.inkassation || 0), 0)
      const deducted = (inkAll || []).reduce((s: number, r: any) => s + (r.expense || 0) + (r.salary || 0), 0)
      const available = grossInk - deducted
      const cur = Array.isArray(inkList) ? inkList[0] : inkList
      if (amount > available) {
        setPayError(tr('pe.insufficientInkassationPool', { avail: eur(Math.max(0, available)) }))
        setPayInsufficient(true)
        setPaying(false); return
      }
      // A3 (аудит 2026-08-15): свой снэпшот cur.salary/expense мог устареть к моменту записи
      // (аванс или другая выплата успели пройти между чтением выше и update здесь) — те же
      // риски, что persistShift уже закрыл для этой таблицы (A2, аудит 2026-08-09).
      const applyPayment = (base: any) => {
        const mergedNote = [base?.salary_note, `${payFor.name}: ${eur(amount)}`].filter(Boolean).join('; ')
        const newSalary = (base?.salary || 0) + amount
        // C6 (юзер-фидбок 2026-08-15): total раньше не пересчитывался здесь — оставался от
        // последнего обычного закрытия смены, без учёта зарплаты, «остаток» в Кассе расходился
        // с реальностью после каждой выплаты.
        const newTotal = (base?.amount || 0) - (base?.expense || 0) - newSalary
        return { values: { restaurant_id: restaurantId, date: dateStr, salary: newSalary, salary_note: mergedNote, total: newTotal } }
      }

      // C2 (аудит 2026-08-15): раньше inkassations писалась первой, salary_payments —
      // второй. Если второй insert падал после успешного первого — касса уже списана, но
      // «оплачено» нигде не отмечено, менеджер платил второй раз реальными деньгами за уже
      // списанный долг. Теперь salary_payments — источник истины «оплачено» — пишется
      // первым; если следующая запись в inkassations падает, компенсируем откатом (удаляем
      // только что вставленную salary_payments), чтобы не остаться в состоянии
      // «оплачено, но касса не списана» либо «списано, но не оплачено» — только оба или ничего.
      const { data: payRow, error: payErr } = await db.from('salary_payments').insert({
        employee_id: payFor.id, period: `${ym}-01`, amount, method,
        paid_at: new Date(dateStr).toISOString(),
        note: payFor.note || null, created_by: null,
      }).select().single()
      if (payErr) { setPayError(tr('pe.saveFailed', { err: payErr.message })); setPaying(false); return }

      let ok: boolean
      let insertErrMsg = 'race'
      if (cur?.id) {
        let { values } = applyPayment(cur)
        ok = await casUpdateInk(shiftId, 'salary', cur.salary || 0, values)
        if (!ok) {
          const fresh = await findInkassation(shiftId)
          if (fresh) { ({ values } = applyPayment(fresh)); ok = await casUpdateInk(shiftId, 'salary', fresh.salary || 0, values) }
        }
      } else {
        // Свежая строка (для этой смены ещё не было ни расхода, ни инкассации) — в отличие
        // от CAS-ветки выше (partial update, amount/expense не трогает), insert обязан
        // указать amount/expense явно, иначе NOT NULL на amount валил insert, а ошибка
        // гасилась ниже под общим ярлыком «race», хотя это вообще не гонка (баг 2026-08-16,
        // реальный кейс юзера — платёж без существующей инкассации дня).
        const { values } = applyPayment({ ...cur, amount: sh.inkassation, expense: 0 })
        const { error } = await db.from('inkassations').insert({ shift_id: shiftId, amount: sh.inkassation, expense: 0, ...values })
        ok = !error
        if (error) insertErrMsg = error.message
      }
      if (!ok) {
        if (payRow?.id) await db.from('salary_payments').delete().eq('id', payRow.id)
        setPayError(tr('pe.saveFailed', { err: insertErrMsg })); setPaying(false); return
      }
      setPaying(false)
      setPayFor(null)
      await load(); await loadDebt()
      return
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

  // «Отметить как долг» (юзер-фидбок 2026-08-20): вместо жёсткого отказа при нехватке налички —
  // ручное действие менеджера, эксплицитно решившего «сегодня не платим, фиксируем как долг».
  // Пишет ЦЕЛИКОМ введённую сумму (без авто-разбивки на «часть сейчас + остаток в долг» —
  // юзер: «долг не делим по частям»); settlement (галочка в Manager→Смена) сам допишет
  // salary_payments, remaining в ЗП после этого сойдётся сам.
  const markAsDebt = async () => {
    if (!payFor) return
    const amount = Number(payFor.amount) || 0
    if (amount <= 0) return
    setMarkingDebt(true)
    await syncSalaryLedger(payFor.id, `${ym}-01`, payFor.date || fmtDate(new Date()), amount)
    setMarkingDebt(false)
    setPayFor(null); setPayError(null); setPayInsufficient(false)
    showToast(tr('pe.markedAsDebt'))
    await load(); await loadDebt()
  }

  const payStatus = (r: any) => {
    if (r.total <= 0) return null
    if (r.remaining <= 0) return { label: r.lastPaidAt ? tr('pe.paidOn', { date: absDate(r.lastPaidAt) }) : tr('pe.paidStatus'), color: t.green }
    if (r.remaining === r.total) return { label: tr('pe.notPaidYet'), color: t.orange }
    return { label: tr('pe.oweAmount', { amount: eur(r.remaining) }), color: t.orange }
  }
  const daysInMonth = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 0).getDate()
  // C3 (аудит 2026-08-15): раньше своя линейная рампа над daysInMonth+payoutDay, расходилась
  // с Analytics (payout-day-цикл) до ~17пп на один день. Теперь единая формула из lib/analytics —
  // и база теперь totalCash (нал к выплате, за вычетом аванса/карты), как в Analytics.salToday,
  // а не валовой fund (включавший уже отложенное на карту/аванс).
  const prevDaysInMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 0).getDate()

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
            <span style={{ fontSize: 13, color: t.text3 }}>{tr('pe.advances')} · {new Date(a.date).toLocaleDateString(tr('dash.locale'), { day: 'numeric', month: 'short' })}</span>
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
              <button onClick={() => { setPayError(null); setPayInsufficient(false); setPayFor({ id: r.id, name: r.name, amount: String(Math.round(r.remaining)), method: 'cash', date: fmtDate(new Date()), note: '' }) }}
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
  // Клампим advance/card по total сотрудника (юзер-фидбок 2026-08-15: «наличными» + «на карту»
  // не давали сумму фонда) — если аванс/карта суммарно превышают total (переавансирование, или
  // карта осталась настроена у сотрудника, чей total обнулился прогулами), излишек молча
  // выпадал из cash (Math.max(0, …) в computeMonth), но полностью оставался в cardTotal —
  // фонд наверху и блоки внизу расходились ровно на этот излишек. cash по каждой строке уже
  // верно, клампим только агрегаты, чтобы cash+card+advance ВСЕГДА равнялось fund.
  const advanceTotal = rows.reduce((s, r) => s + Math.min(r.advance, r.total), 0)
  const cardTotal = rows.reduce((s, r) => s + Math.min(r.card, Math.max(0, r.total - Math.min(r.advance, r.total))), 0)
  const cashTotal = rows.reduce((s, r) => s + r.cash, 0)
  const accrued = computeAccruedToday({ isCurrentMonth, totalCash: cashTotal, daysInMonth, payoutDay, prevTotalCash: prevCashTotal, prevDaysInMonth })
  return (
    <div>
      <MonthNav />
      {debt.total > 0 && (
        <button onClick={() => setShowDebtList(true)} style={{ width: '100%', textAlign: 'left', background: `${t.red}12`, borderRadius: 16, padding: '14px 16px', marginBottom: 12, border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: t.red, textTransform: 'uppercase', letterSpacing: 0.4 }}>{tr('pe.debtTitle')}</div>
            <svg width="7" height="13" fill="none" stroke={t.red} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 10 18"><path d="M2 1l7 8-7 8" /></svg>
          </div>
          <div style={{ fontSize: 22, fontWeight: 800, color: t.red, marginTop: 2 }}>{eur(debt.total)}</div>
          <div style={{ fontSize: 12, color: t.text3, marginTop: 3 }}>{tr('pe.debtHint')}</div>
        </button>
      )}
      <div style={{ background: `linear-gradient(135deg, ${accent}, ${accent}cc)`, borderRadius: 20, padding: '20px', marginBottom: 14, color: '#fff', boxShadow: `0 8px 28px ${accent}3a` }}>
        <div style={{ fontSize: 13, fontWeight: 600, opacity: 0.85 }}>{tr('pe.toPayoutTotal')}</div>
        <div style={{ fontSize: 34, fontWeight: 800, letterSpacing: -1, marginTop: 2 }}>{eur(fund)}</div>
        <div style={{ display: 'flex', gap: 16, marginTop: 8, fontSize: 13, fontWeight: 600, opacity: 0.92 }}>
          <span>{tr('pe.staffCountShort', { n: rows.length })}</span>
          {cardTotal > 0 && <span>{tr('pe.toCard')} {eur(cardTotal)}</span>}
          {advanceTotal > 0 && <span>{tr('pe.advances')} {eur(advanceTotal)}</span>}
          <span>{tr('pe.inCash')} {eur(cashTotal)}</span>
        </div>
        {isCurrentMonth && (
          <div style={{ marginTop: 10, fontSize: 12, opacity: 0.85 }}>
            {tr('pe.accruedToday')} {eur(accrued)} · {tr('pe.accruedTodayHint')}
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
        <Sheet onClose={() => { setPayFor(null); setPayError(null); setPayInsufficient(false) }} t={t}>
          <div style={{ padding: '4px 20px 24px' }}>
            <div style={{ fontSize: 17, fontWeight: 700, color: t.text, marginBottom: 14 }}>{tr('pe.markPaid')} · {payFor.name}</div>
            {payError && (
              <div style={{ background: `${t.red}14`, borderRadius: 12, padding: '10px 12px', marginBottom: 12 }}>
                <div style={{ color: t.red, fontSize: 13, fontWeight: 600 }}>{payError}</div>
                {payInsufficient && (
                  <button onClick={markAsDebt} disabled={markingDebt} style={{ width: '100%', marginTop: 10, padding: '10px', borderRadius: 10, border: 'none', background: t.orange, color: '#fff', fontFamily: 'inherit', fontSize: 13, fontWeight: 700, cursor: markingDebt ? 'default' : 'pointer', opacity: markingDebt ? 0.6 : 1 }}>
                    {tr('pe.markAsDebt')}
                  </button>
                )}
              </div>
            )}
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
      {showDebtList && (
        <Sheet onClose={() => setShowDebtList(false)} t={t}>
          <div style={{ padding: '4px 20px 24px' }}>
            <div style={{ fontSize: 17, fontWeight: 700, color: t.text, marginBottom: 4 }}>{tr('pe.debtTitle')}</div>
            <div style={{ fontSize: 13, color: t.text3, marginBottom: 14 }}>{tr('pe.debtListHint')}</div>
            {Object.entries(
              ledgerRows.reduce((acc: Record<string, typeof ledgerRows>, r) => { (acc[r.employeeName] = acc[r.employeeName] || []).push(r); return acc }, {})
            ).map(([name, items]) => (
              <div key={name} style={{ background: t.surface, borderRadius: 16, overflow: 'hidden', boxShadow: t.sh, marginBottom: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 16px', background: `${t.red}0d` }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: t.text }}>{name}</span>
                  <span style={{ fontSize: 14, fontWeight: 800, color: t.red }}>{eur(items.reduce((s, i) => s + i.amount, 0))}</span>
                </div>
                {items.sort((a, b) => a.period < b.period ? -1 : 1).map(i => (
                  <div key={i.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 16px', borderTop: `0.5px solid ${t.sep2}` }}>
                    <span style={{ fontSize: 13, color: t.text3, textTransform: 'capitalize' as const }}>{periodLabel(i.period)}</span>
                    <span style={{ fontSize: 13, fontWeight: 600, color: t.orange }}>{eur(i.amount)}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </Sheet>
      )}
      {toast && (
        <div style={{ position: 'fixed', bottom: 100, left: '50%', transform: 'translateX(-50%)', background: t.dark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.85)', backdropFilter: 'blur(16px)', color: '#fff', padding: '12px 22px', borderRadius: 22, fontSize: 14, fontWeight: 600, zIndex: 600, whiteSpace: 'nowrap' }}>{toast}</div>
      )}
    </div>
  )
}
