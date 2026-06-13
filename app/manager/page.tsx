'use client'
export const dynamic = 'force-dynamic'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { db } from '@/lib/db'
import { Segmented } from '@/components/Segmented'
import { useTheme } from '@/hooks/useTheme'
import { AuthGate } from '@/components/AuthGate'
import { AppLoading } from '@/components/AppLoading'

// ── HELPERS ───────────────────────────────────────────────────────────────────

function fv(v: number) { return v.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }
// Local calendar date (YYYY-MM-DD). Using toISOString() would shift the day in non-UTC timezones.
function fmtDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function displayDate(d: Date) {
  return String(d.getDate()).padStart(2, '0') + '.' + String(d.getMonth() + 1).padStart(2, '0') + '.' + d.getFullYear()
}
const DOW = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота']

// ── ICONS ─────────────────────────────────────────────────────────────────────

function IconManager({ color = 'currentColor', size = 28 }: { color?: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none">
      <rect width="64" height="64" rx="14" fill={color} />
      <rect x="11" y="16" width="42" height="9" rx="4.5" fill="white" />
      <rect x="11" y="28" width="32" height="9" rx="4.5" fill="white" opacity="0.72" />
      <rect x="11" y="40" width="21" height="9" rx="4.5" fill="white" opacity="0.44" />
    </svg>
  )
}

function IconQR({ color = 'currentColor' }: { color?: string }) {
  return (
    <svg width="64" height="64" viewBox="0 0 64 64" fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <rect x="8" y="8" width="20" height="20" rx="3" />
      <rect x="12" y="12" width="12" height="12" rx="1.5" fill={color} stroke="none" />
      <rect x="36" y="8" width="20" height="20" rx="3" />
      <rect x="40" y="12" width="12" height="12" rx="1.5" fill={color} stroke="none" />
      <rect x="8" y="36" width="20" height="20" rx="3" />
      <rect x="12" y="40" width="12" height="12" rx="1.5" fill={color} stroke="none" />
      <path d="M36 36h6v6h-6zM48 36h8M36 48v8M44 44h4v4h-4zM52 44h4v4h-4zM52 52h4v4h-4z" fill={color} stroke="none" />
    </svg>
  )
}

// ── SEGMENTED CONTROL ─────────────────────────────────────────────────────────

// ── TYPES ─────────────────────────────────────────────────────────────────────

type Employee = { id: string; name: string; deduct_per_absence: number }
type Category = { id: string; name: string }
type Shift = { id: string; date: string; status: string; opening_balance: number; income: number; total_expense: number; inkassation: number; closing_balance: number }

// ── SUMMARY ROW ───────────────────────────────────────────────────────────────

function SRow({ label, value, color, bold, t }: { label: string; value: string; color?: string; bold?: boolean; t: ReturnType<typeof useTheme> }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: `0.5px solid ${t.sep2}` }}>
      <span style={{ color: t.text3, fontSize: bold ? 14 : 13, fontWeight: bold ? 700 : 400 }}>{label}</span>
      <span style={{ color: color || t.text, fontWeight: bold ? 800 : 600, fontSize: bold ? 15 : 13 }}>{value}</span>
    </div>
  )
}

// ── MAIN APP ──────────────────────────────────────────────────────────────────

function ManagerApp({ restaurantId }: { restaurantId: string }) {
  const router = useRouter()
  const t = useTheme()
  const [currentDate, setCurrentDate] = useState(new Date())
  const [shift, setShift] = useState<Shift | null>(null)
  const [employees, setEmployees] = useState<Employee[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [absences, setAbsences] = useState<string[]>([])
  // employee_id'ы с авто-прогулом (source='auto') — черновик от геоконтроля, ещё не подтверждён менеджером
  const [autoAbsences, setAutoAbsences] = useState<Set<string>>(new Set())
  const [empExtras, setEmpExtras] = useState<Record<string, string>>({})
  const [catAmounts, setCatAmounts] = useState<Record<string, string>>({})
  const [catNotes, setCatNotes] = useState<Record<string, string>>({})
  const [income, setIncome] = useState('')          // наличные — касса считается от них
  const [incomeCard, setIncomeCard] = useState('')  // безнал — в кассу не входит
  const [inkSum, setInkSum] = useState('')
  const [inkExpense, setInkExpense] = useState('')
  const [inkReason, setInkReason] = useState('')
  const [inkSalary, setInkSalary] = useState('')    // выплата зарплаты — вычитается из итога инкассации
  const [inkSalaryNote, setInkSalaryNote] = useState('')
  const [showSummary, setShowSummary] = useState(false)
  const [locked, setLocked] = useState(false) // сохранённая смена закрыта «матовым стеклом» до Редактировать
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState('')
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    init()
  }, [])

  const init = async () => {
    const [empsRes, catsRes] = await Promise.all([
      db.from('employees').select('id,name,deduct_per_absence').eq('restaurant_id', restaurantId).eq('is_active', true).order('name'),
      db.from('expense_categories').select('id,name').eq('restaurant_id', restaurantId).order('name')
    ])
    setEmployees(empsRes.data || [])
    setCategories(catsRes.data || [])
    await loadDay(restaurantId, new Date(), empsRes.data || [], catsRes.data || [])
  }

  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(''), 2500) }

  // Прогулы грузим ПО ДАТЕ (а не по shift_id): авто-прогул от геоконтроля создаётся cron'ом
  // ещё до того, как менеджер открыл смену, поэтому shift_id у него может отсутствовать.
  const loadAbsencesByDate = async (rid: string, dateStr: string) => {
    const { data: abs } = await db.from('shift_absences').select('*').eq('restaurant_id', rid).eq('date', dateStr)
    setAbsences((abs || []).map((a: any) => a.employee_id))
    setAutoAbsences(new Set((abs || []).filter((a: any) => a.source === 'auto').map((a: any) => a.employee_id)))
  }

  const loadDay = async (rid: string, date: Date, emps: Employee[], cats: Category[]) => {
    setLoading(true)
    const dateStr = fmtDate(date)
    // Resilient to duplicate (restaurant_id, date) rows: take one instead of erroring on maybeSingle.
    const { data: shList } = await db.from('shifts').select('*').eq('restaurant_id', rid).eq('date', dateStr).order('created_at', { ascending: true }).limit(1)
    const sh = (Array.isArray(shList) ? shList[0] : shList) || null
    const yesterday = new Date(date); yesterday.setDate(yesterday.getDate() - 1)
    const { data: prevList } = await db.from('shifts').select('closing_balance').eq('restaurant_id', rid).eq('date', fmtDate(yesterday)).order('created_at', { ascending: false }).limit(1)
    const openingBalance = (Array.isArray(prevList) ? prevList[0] : prevList)?.closing_balance || 0

    if (sh) {
      setShift({ ...sh, opening_balance: openingBalance })
      // Уже сохранённая смена (есть цифры) открывается в режиме просмотра.
      setLocked(sh.income > 0 || sh.total_expense > 0 || sh.inkassation > 0)
      setIncome(sh.income > 0 ? String(sh.income) : '')
      setIncomeCard(sh.income_card > 0 ? String(sh.income_card) : '')
      setInkSum(sh.inkassation > 0 ? String(sh.inkassation) : '')
      const { data: exps } = await db.from('shift_expenses').select('*').eq('shift_id', sh.id)
      const amounts: Record<string, string> = {}; const notes: Record<string, string> = {}
      const extras: Record<string, string> = {}
      ;(exps || []).forEach((e: any) => {
        if (e.employee_id) { extras[e.employee_id] = String(e.amount) }
        else if (e.category_id) { amounts[e.category_id] = String(e.amount); if (e.note) notes[e.category_id] = e.note }
      })
      setCatAmounts(amounts); setCatNotes(notes); setEmpExtras(extras)
      await loadAbsencesByDate(rid, dateStr)
      const { data: inkList } = await db.from('inkassations').select('*').eq('shift_id', sh.id).limit(1)
      const ink = Array.isArray(inkList) ? inkList[0] : inkList
      if (ink) {
        setInkExpense(ink.expense > 0 ? String(ink.expense) : ''); setInkReason(ink.reason || '')
        setInkSalary(ink.salary > 0 ? String(ink.salary) : ''); setInkSalaryNote(ink.salary_note || '')
      } else { setInkExpense(''); setInkReason(''); setInkSalary(''); setInkSalaryNote('') }
    } else {
      setShift(null); setLocked(false); setIncome(''); setIncomeCard(''); setInkSum(''); setInkExpense(''); setInkReason(''); setInkSalary(''); setInkSalaryNote('')
      setCatAmounts({}); setCatNotes({}); setAbsences([]); setAutoAbsences(new Set()); setEmpExtras({})
    }
    setLoading(false)
  }

  const changeDate = async (dir: number) => {
    // Auto-save the current day before leaving so nothing entered is lost.
    if (shift && !locked) { try { await persistShift() } catch (e: any) { showToast('Ошибка автосохранения: ' + (e?.message || '')) } }
    const d = new Date(currentDate); d.setDate(d.getDate() + dir)
    setCurrentDate(d)
    await loadDay(restaurantId, d, employees, categories)
  }

  const openShift = async () => {
    setSaving(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()

      const yesterday = new Date(currentDate); yesterday.setDate(yesterday.getDate() - 1)
      const { data: prevList } = await db.from('shifts').select('closing_balance').eq('restaurant_id', restaurantId).eq('date', fmtDate(yesterday)).order('created_at', { ascending: false }).limit(1)
      const openingBalance = (Array.isArray(prevList) ? prevList[0] : prevList)?.closing_balance || 0
      const { data: sh, error } = await db.from('shifts').insert({
        restaurant_id: restaurantId, date: fmtDate(currentDate),
        opened_by: user?.id ?? null, manager_id: user?.id ?? null,
        opening_balance: openingBalance, income: 0, inkassation: 0,
        closing_balance: openingBalance, status: 'open'
      }).select().single()
      if (sh) {
        setShift({ ...sh, opening_balance: openingBalance })
        await loadAbsencesByDate(restaurantId, fmtDate(currentDate)) // подтянуть авто-прогулы дня
        showToast('Смена открыта')
      } else if (error?.code === '23505') {
        // Shift already exists — reload it
        await loadDay(restaurantId, currentDate, employees, categories)
      } else if (error) {
        showToast('Ошибка: ' + error.message)
      }
    } finally {
      setSaving(false)
    }
  }

  const toggleAbsence = async (empId: string) => {
    if (!shift) return
    const dateStr = fmtDate(currentDate)
    if (absences.includes(empId)) {
      // ключ по дате — чтобы можно было снять и авто-прогул (у него может не быть shift_id)
      await db.from('shift_absences').delete().eq('restaurant_id', restaurantId).eq('date', dateStr).eq('employee_id', empId)
      setAbsences(absences.filter(id => id !== empId))
    } else {
      // ручная отметка менеджера → source по умолчанию 'manager' (учитывается в ЗП сразу)
      await db.from('shift_absences').insert({ shift_id: shift.id, restaurant_id: restaurantId, employee_id: empId, date: dateStr })
      setAbsences([...absences, empId])
    }
    // явное действие менеджера снимает «черновик»-маркер
    if (autoAbsences.has(empId)) setAutoAbsences(prev => { const n = new Set(prev); n.delete(empId); return n })
  }

  const calc = () => {
    const inc = parseFloat(income) || 0          // наличные
    const card = parseFloat(incomeCard) || 0     // безнал — не участвует в кассе
    const ink = parseFloat(inkSum) || 0
    const catTotal = categories.reduce((s, c) => s + (parseFloat(catAmounts[c.id] || '0') || 0), 0)
    const empExtraTotal = employees.reduce((s, e) => s + (parseFloat(empExtras[e.id] || '0') || 0), 0)
    const totalExp = catTotal + empExtraTotal + ink
    const opening = shift?.opening_balance || 0
    const balance = opening + inc - totalExp
    const salary = parseFloat(inkSalary) || 0
    const inkNet = ink - (parseFloat(inkExpense) || 0) - salary // итог инкассации после расхода и зарплаты
    return { inc, card, ink, catTotal, empExtraTotal, totalExp, balance, opening, salary, inkNet }
  }

  // Core DB write — used by explicit save AND auto-save on day switch.
  // Rebuilds expense rows from scratch (delete+insert) so nothing duplicates and
  // everything reloads exactly as entered.
  const persistShift = async (sh = shift, dateForInk = currentDate) => {
    if (!sh) return
    const { inc, card, ink, totalExp, balance, salary } = calc()
    // db.from не бросает исключений — ошибку надо проверять явно, иначе ввод молча теряется
    // (например, если миграция features-2026-06 не применена и колонки income_card нет).
    const { error: upErr } = await db.from('shifts').update({ income: inc, income_card: card, inkassation: ink, total_expense: totalExp, closing_balance: balance }).eq('id', sh.id)
    if (upErr) throw new Error(upErr.message)
    // Replace ALL expense lines (categories + employee extras) for this shift.
    await db.from('shift_expenses').delete().eq('shift_id', sh.id)
    const inserts: any[] = []
    categories.forEach(c => {
      const amt = parseFloat(catAmounts[c.id] || '0')
      if (amt > 0) inserts.push({ shift_id: sh.id, restaurant_id: restaurantId, category_id: c.id, category_name: c.name, amount: amt, note: catNotes[c.id] || '' })
    })
    employees.forEach(emp => {
      const extra = parseFloat(empExtras[emp.id] || '0')
      if (extra > 0) inserts.push({ shift_id: sh.id, restaurant_id: restaurantId, employee_id: emp.id, category_name: emp.name + ' (экстра)', amount: extra })
    })
    if (inserts.length > 0) await db.from('shift_expenses').insert(inserts)
    // Inkassation extra/reason — single row per shift (delete+insert, no upsert constraint needed).
    await db.from('inkassations').delete().eq('shift_id', sh.id)
    if (ink > 0 || inkExpense || inkReason || salary > 0 || inkSalaryNote) {
      await db.from('inkassations').insert({
        shift_id: sh.id, restaurant_id: restaurantId, date: fmtDate(dateForInk),
        amount: ink, expense: parseFloat(inkExpense) || 0, reason: inkReason,
        salary, salary_note: inkSalaryNote || null, balance
      })
    }
    // Подтверждаем прогулы этого дня: привязываем к смене и снимаем «черновик» (source→manager),
    // только теперь авто-прогулы попадают в вычет ЗП в Аналитике. До миграции колонки source нет —
    // db.from вернёт ошибку молча (не бросит), что безвредно: авто-прогулов до миграции не бывает.
    await db.from('shift_absences').update({ shift_id: sh.id, source: 'manager' }).eq('restaurant_id', restaurantId).eq('date', fmtDate(dateForInk))
    setAutoAbsences(new Set())
    setShift({ ...sh, income: inc, inkassation: ink, total_expense: totalExp, closing_balance: balance })
    return balance
  }

  const saveShift = async () => {
    if (!shift) return
    setSaving(true)
    try { await persistShift() } catch (e: any) { showToast('Ошибка: ' + (e?.message || 'не сохранилось')); setSaving(false); return }
    setShowSummary(false)
    setLocked(true)
    showToast('Смена сохранена')
    setSaving(false)
  }

  const { inc, card, ink, totalExp, balance, opening, salary, inkNet } = calc()
  const daysInMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0).getDate()

  if (!mounted || (loading && employees.length === 0)) return <AppLoading app="manager" bg={t.bg} fill={t.fill} accent={t.blue} />

  return (
    <div style={{ height: '100vh', overflow: 'hidden', background: t.bg, fontFamily: "-apple-system,BlinkMacSystemFont,'SF Pro Text',sans-serif", WebkitFontSmoothing: 'antialiased' }}>
      <style>{`
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes fadeUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
        @keyframes toastIn{from{opacity:0;transform:translateX(-50%) translateY(10px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}
        * { box-sizing: border-box }
        input[type=number]::-webkit-inner-spin-button{-webkit-appearance:none}
      `}</style>

      {/* HEADER */}
      <div style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 300,
        height: 56, background: t.hbg,
        backdropFilter: 'saturate(200%) blur(24px)',
        WebkitBackdropFilter: 'saturate(200%) blur(24px)',
        borderBottom: `0.5px solid ${t.sep2}`,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
            <span style={{ fontWeight: 800, fontSize: 18, color: t.blue, letterSpacing: -0.8, fontFamily: '-apple-system,BlinkMacSystemFont,sans-serif' }}>mise</span>
            <span style={{ fontWeight: 400, fontSize: 17, color: t.text, letterSpacing: -0.3 }}>Manager</span>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {shift && (
            <span style={{
              fontSize: 11, padding: '4px 10px', borderRadius: 20,
              background: shift.status === 'open' ? `${t.green}22` : t.fill2,
              color: shift.status === 'open' ? t.green : t.text3, fontWeight: 600,
            }}>
              {shift.status === 'open' ? 'Открыта' : 'Закрыта'}
            </span>
          )}
          <button
            onClick={() => supabase.auth.signOut().then(() => { localStorage.removeItem('mise_restaurant_id'); router.replace('/auth/login') })}
            style={{ width: 34, height: 34, borderRadius: '50%', background: `${t.red}18`, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="16" height="16" fill="none" stroke={t.red} strokeWidth="2" viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" /></svg>
          </button>
        </div>
      </div>

      {/* CONTENT */}
      <div style={{ position: 'fixed', top: 56, left: 0, right: 0, bottom: 0, overflowY: 'auto', background: t.bg }}>
        <div style={{ padding: '16px 16px 100px', maxWidth: 600, margin: '0 auto', animation: 'fadeUp .22s ease' }}>

          {/* DATE ROW */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, background: t.surface, borderRadius: 16, padding: '14px 16px', marginBottom: 16, boxShadow: t.sh }}>
            <button onClick={() => changeDate(-1)} style={{ width: 40, height: 40, borderRadius: '50%', background: t.fill, border: 'none', fontSize: 20, color: t.text, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="10" height="18" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" viewBox="0 0 10 18"><path d="M8 1L1 9l7 8" /></svg>
            </button>
            <div style={{ flex: 1, textAlign: 'center' }}>
              <div style={{ fontWeight: 700, fontSize: 17, color: t.text }}>{displayDate(currentDate)}</div>
              <div style={{ fontSize: 13, color: t.blue, marginTop: 2, fontWeight: 500 }}>{DOW[currentDate.getDay()]} · День {currentDate.getDate()} из {daysInMonth}</div>
            </div>
            <button onClick={() => changeDate(1)} style={{ width: 40, height: 40, borderRadius: '50%', background: t.fill, border: 'none', fontSize: 20, color: t.text, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="10" height="18" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" viewBox="0 0 10 18"><path d="M2 1l7 8-7 8" /></svg>
            </button>
          </div>

          {!shift ? (
            <div style={{ textAlign: 'center', padding: '60px 0' }}>
              <div style={{ width: 80, height: 80, borderRadius: 22, background: `${t.blue}14`, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px' }}>
                <svg width="38" height="38" fill="none" stroke={t.blue} strokeWidth="1.8" viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="10" /><path d="M12 8v4l3 3" />
                </svg>
              </div>
              <div style={{ fontWeight: 700, fontSize: 20, marginBottom: 8, color: t.text }}>Смена не открыта</div>
              <div style={{ color: t.text3, fontSize: 14, marginBottom: 28 }}>Нажмите чтобы начать рабочий день</div>
              <button onClick={openShift} disabled={saving} style={{ padding: '16px 40px', borderRadius: 16, background: t.blue, color: '#fff', border: 'none', fontFamily: 'inherit', fontSize: 16, fontWeight: 700, cursor: 'pointer', boxShadow: `0 4px 16px ${t.blue}44` }}>
                Открыть смену
              </button>
            </div>
          ) : (
            <div style={{ position: 'relative' }}>
              {/* Матовое стекло: смена сохранена, ввод заблокирован до «Редактировать» */}
              {locked && (
                <div style={{ position: 'absolute', inset: -6, zIndex: 60, background: t.dark ? 'rgba(0,0,0,0.30)' : 'rgba(242,242,247,0.45)', backdropFilter: 'blur(2.5px)', WebkitBackdropFilter: 'blur(2.5px)', borderRadius: 18, display: 'flex', justifyContent: 'center', alignItems: 'flex-start', paddingTop: 18 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: t.surface, borderRadius: 980, padding: '9px 18px', boxShadow: '0 4px 20px rgba(0,0,0,0.18)' }}>
                    <svg width="14" height="14" fill="none" stroke={t.green} strokeWidth="2.2" viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0110 0v4" /></svg>
                    <span style={{ fontSize: 13, fontWeight: 700, color: t.text }}>Смена сохранена</span>
                  </div>
                </div>
              )}
              {/* СОТРУДНИКИ */}
              <div style={{ fontSize: 12, fontWeight: 600, color: t.text3, textTransform: 'uppercase', letterSpacing: 0.5, padding: '12px 4px 8px' }}>Сотрудники</div>
              <div style={{ background: t.surface, borderRadius: 16, overflow: 'hidden', marginBottom: 12, boxShadow: t.sh }}>
                {employees.map((emp, i) => {
                  const absent = absences.includes(emp.id)
                  const isAuto = autoAbsences.has(emp.id)
                  const extra = empExtras[emp.id] || ''
                  return (
                    <div key={emp.id} style={{ display: 'flex', alignItems: 'center', padding: '12px 16px', gap: 10, borderBottom: i < employees.length - 1 ? `0.5px solid ${t.sep2}` : 'none' }}>
                      <div style={{ flex: 1, fontSize: 15, color: absent ? t.text4 : t.text, textDecoration: absent ? 'line-through' : 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 7 }}>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{emp.name}</span>
                        {isAuto && absent && <span title="Авто-прогул по геоконтролю. Проверьте и сохраните смену." style={{ fontSize: 9, fontWeight: 800, color: t.orange, background: `${t.orange}1a`, padding: '2px 6px', borderRadius: 6, textTransform: 'uppercase', letterSpacing: 0.3, flexShrink: 0, textDecoration: 'none' }}>авто</span>}
                      </div>
                      <input type="number" value={extra}
                        onChange={e => setEmpExtras({ ...empExtras, [emp.id]: e.target.value })}
                        placeholder="€ 0"
                        style={{
                          width: 90, textAlign: 'right', padding: '8px 10px', border: 'none', borderRadius: 10,
                          fontSize: 14, fontFamily: 'inherit', outline: 'none',
                          background: parseFloat(extra) > 0 ? `${t.green}18` : t.fill,
                          color: parseFloat(extra) > 0 ? t.green : t.text,
                          fontWeight: parseFloat(extra) > 0 ? 600 : 400,
                        }}
                      />
                      <button onClick={() => toggleAbsence(emp.id)} style={{
                        width: 34, height: 34, borderRadius: '50%', border: `1.5px solid ${absent ? t.red : t.sep}`,
                        background: absent ? `${t.red}18` : 'none', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                      }}>
                        {absent && <svg width="12" height="12" fill="none" stroke={t.red} strokeWidth="2.5" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12" /></svg>}
                      </button>
                    </div>
                  )
                })}
              </div>

              {/* РАСХОДЫ */}
              <div style={{ fontSize: 12, fontWeight: 600, color: t.text3, textTransform: 'uppercase', letterSpacing: 0.5, padding: '12px 4px 8px' }}>Расходы дня</div>
              <div style={{ background: t.surface, borderRadius: 16, overflow: 'hidden', marginBottom: 12, boxShadow: t.sh }}>
                {categories.map((cat, i) => {
                  const val = catAmounts[cat.id] || ''
                  const hasVal = parseFloat(val) > 0
                  return (
                    <div key={cat.id}>
                      <div style={{ display: 'flex', alignItems: 'center', padding: '12px 16px', gap: 12, borderBottom: i < categories.length - 1 && !hasVal ? `0.5px solid ${t.sep2}` : 'none' }}>
                        <div style={{ flex: 1, fontSize: 15, color: t.text }}>{cat.name}</div>
                        <input type="number" value={val}
                          onChange={e => setCatAmounts({ ...catAmounts, [cat.id]: e.target.value })}
                          placeholder="€ 0"
                          style={{
                            width: 110, textAlign: 'right', padding: '8px 10px', border: 'none', borderRadius: 10,
                            fontSize: 14, fontFamily: 'inherit', outline: 'none',
                            background: hasVal ? `${t.blue}14` : t.fill,
                            color: hasVal ? t.blue : t.text, fontWeight: hasVal ? 600 : 400,
                          }}
                        />
                      </div>
                      {hasVal && (
                        <div style={{ padding: '4px 16px 10px', borderBottom: i < categories.length - 1 ? `0.5px solid ${t.sep2}` : 'none' }}>
                          <input value={catNotes[cat.id] || ''}
                            onChange={e => setCatNotes({ ...catNotes, [cat.id]: e.target.value })}
                            placeholder="Комментарий..."
                            style={{ width: '100%', padding: '8px 12px', borderRadius: 10, border: `1px solid ${t.sep2}`, fontSize: 13, color: t.text3, fontFamily: 'inherit', outline: 'none', background: t.fill2 }}
                          />
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>

              {/* ИНКАССАЦИЯ */}
              <div style={{ fontSize: 12, fontWeight: 600, color: t.text3, textTransform: 'uppercase', letterSpacing: 0.5, padding: '12px 4px 8px' }}>Инкассация</div>
              <div style={{ background: t.surface, borderRadius: 16, overflow: 'hidden', marginBottom: 12, boxShadow: t.sh }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: `0.5px solid ${t.sep2}` }}>
                  <div style={{ fontSize: 15, color: t.text }}>Сумма</div>
                  <input type="number" value={inkSum} onChange={e => setInkSum(e.target.value)} placeholder="€ 0"
                    style={{ width: 130, textAlign: 'right', padding: '8px 10px', border: 'none', borderRadius: 10, fontSize: 14, fontFamily: 'inherit', outline: 'none', background: parseFloat(inkSum) > 0 ? `${t.blue}14` : t.fill, color: parseFloat(inkSum) > 0 ? t.blue : t.text, fontWeight: parseFloat(inkSum) > 0 ? 600 : 400 }}
                  />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: `0.5px solid ${t.sep2}` }}>
                  <div style={{ fontSize: 15, color: t.text }}>Расход</div>
                  <input type="number" value={inkExpense} onChange={e => setInkExpense(e.target.value)} placeholder="€ 0"
                    style={{ width: 130, textAlign: 'right', padding: '8px 10px', border: 'none', borderRadius: 10, fontSize: 14, fontFamily: 'inherit', outline: 'none', background: parseFloat(inkExpense) > 0 ? `${t.red}14` : t.fill, color: parseFloat(inkExpense) > 0 ? t.red : t.text, fontWeight: parseFloat(inkExpense) > 0 ? 600 : 400 }}
                  />
                </div>
                <div style={{ padding: '10px 16px 12px', borderBottom: `0.5px solid ${t.sep2}` }}>
                  <div style={{ fontSize: 12, color: t.text3, fontWeight: 500, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.3 }}>Причина</div>
                  <input value={inkReason} onChange={e => setInkReason(e.target.value)} placeholder="Опишите назначение..."
                    style={{ width: '100%', padding: '10px 12px', borderRadius: 12, border: `1px solid ${t.sep2}`, fontSize: 14, color: t.text, fontFamily: 'inherit', outline: 'none', background: inkReason ? t.fill2 : t.fill2 }}
                  />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: `0.5px solid ${t.sep2}` }}>
                  <div>
                    <div style={{ fontSize: 15, color: t.text }}>Выплата зарплаты</div>
                    <div style={{ fontSize: 11, color: t.text3, marginTop: 2 }}>вычитается из инкассации</div>
                  </div>
                  <input type="number" value={inkSalary} onChange={e => setInkSalary(e.target.value)} placeholder="€ 0"
                    style={{ width: 130, textAlign: 'right', padding: '8px 10px', border: 'none', borderRadius: 10, fontSize: 14, fontFamily: 'inherit', outline: 'none', background: salary > 0 ? `${t.purple}14` : t.fill, color: salary > 0 ? t.purple : t.text, fontWeight: salary > 0 ? 600 : 400 }}
                  />
                </div>
                {salary > 0 && (
                  <div style={{ padding: '4px 16px 12px', borderBottom: `0.5px solid ${t.sep2}` }}>
                    <input value={inkSalaryNote} onChange={e => setInkSalaryNote(e.target.value)} placeholder="Кому выплачено..."
                      style={{ width: '100%', padding: '8px 12px', borderRadius: 10, border: `1px solid ${t.sep2}`, fontSize: 13, color: t.text3, fontFamily: 'inherit', outline: 'none', background: t.fill2 }}
                    />
                  </div>
                )}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', background: `${t.orange}12` }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: t.orange }}>Итог инкассации</div>
                    {(parseFloat(inkExpense) > 0 || salary > 0) && <div style={{ fontSize: 11, color: t.orange, opacity: 0.7, marginTop: 2 }}>после расхода и зарплаты</div>}
                  </div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: t.orange }}>€{fv(inkNet)}</div>
                </div>
              </div>

              {/* КАССА */}
              <div style={{ fontSize: 12, fontWeight: 600, color: t.text3, textTransform: 'uppercase', letterSpacing: 0.5, padding: '12px 4px 8px' }}>Касса</div>
              <div style={{ background: t.surface, borderRadius: 16, overflow: 'hidden', marginBottom: 12, boxShadow: t.sh }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: `0.5px solid ${t.sep2}` }}>
                  <div style={{ fontSize: 15, color: t.text }}>Наличные</div>
                  <input type="number" value={income} onChange={e => setIncome(e.target.value)} placeholder="€ 0"
                    style={{ width: 130, textAlign: 'right', padding: '8px 10px', border: 'none', borderRadius: 10, fontSize: 14, fontFamily: 'inherit', outline: 'none', background: parseFloat(income) > 0 ? `${t.green}14` : t.fill, color: parseFloat(income) > 0 ? t.green : t.text, fontWeight: parseFloat(income) > 0 ? 600 : 400 }}
                  />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: `0.5px solid ${t.sep2}` }}>
                  <div>
                    <div style={{ fontSize: 15, color: t.text }}>Безнал · карта</div>
                    <div style={{ fontSize: 11, color: t.text3, marginTop: 2 }}>в кассу не входит</div>
                  </div>
                  <input type="number" value={incomeCard} onChange={e => setIncomeCard(e.target.value)} placeholder="€ 0"
                    style={{ width: 130, textAlign: 'right', padding: '8px 10px', border: 'none', borderRadius: 10, fontSize: 14, fontFamily: 'inherit', outline: 'none', background: card > 0 ? `${t.purple}14` : t.fill, color: card > 0 ? t.purple : t.text, fontWeight: card > 0 ? 600 : 400 }}
                  />
                </div>
                {card > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', borderBottom: `0.5px solid ${t.sep2}`, background: `${t.green}08` }}>
                    <div style={{ fontSize: 13, color: t.text3 }}>Общий доход (нал + безнал)</div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: t.green }}>€{fv(inc + card)}</div>
                  </div>
                )}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5px', background: t.sep2 }}>
                  {[
                    { label: 'Вход', val: opening, color: t.blue },
                    { label: 'Наличные', val: inc, color: t.green },
                    { label: 'Расход', val: totalExp, color: t.red },
                    { label: 'Остаток', val: balance, color: t.blue },
                  ].map(cell => (
                    <div key={cell.label} style={{ background: t.surface, padding: '12px 14px' }}>
                      <div style={{ fontSize: 10, color: t.text3, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>{cell.label}</div>
                      <div style={{ fontSize: 16, fontWeight: 700, color: cell.color }}>€{fv(cell.val)}</div>
                    </div>
                  ))}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', background: `${t.blue}0a` }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: t.blue }}>Касса на конец смены</div>
                  <div style={{ fontSize: 22, fontWeight: 700, color: balance < 0 ? t.red : t.blue }}>€{fv(balance)}</div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* SAVE BAR */}
      {shift && (
        <div style={{
          position: 'fixed', bottom: 0, left: 0, right: 0,
          padding: '12px 16px', paddingBottom: 'calc(12px + env(safe-area-inset-bottom, 0px))',
          background: t.nbg, backdropFilter: 'saturate(200%) blur(24px)',
          WebkitBackdropFilter: 'saturate(200%) blur(24px)',
          borderTop: `0.5px solid ${t.sep2}`, zIndex: 100,
        }}>
          <button onClick={() => locked ? setLocked(false) : setShowSummary(true)} style={{
            width: '100%', padding: '16px', borderRadius: 16,
            background: locked ? t.fill : t.blue, color: locked ? t.blue : '#fff', border: 'none',
            fontFamily: 'inherit', fontSize: 16, fontWeight: 700,
            cursor: 'pointer', boxShadow: locked ? 'none' : `0 4px 16px ${t.blue}44`,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          }}>
            {locked
              ? <><svg width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>Редактировать</>
              : <><svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z" /><path d="M17 21v-8H7v8M7 3v5h8" /></svg>Сохранить смену</>}
          </button>
        </div>
      )}

      {/* SUMMARY MODAL */}
      {showSummary && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 500, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
          onClick={() => setShowSummary(false)}>
          <div style={{ background: t.bg, borderRadius: '24px 24px 0 0', width: '100%', maxWidth: 480, maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}
            onClick={(e: any) => e.stopPropagation()}>
            <div style={{ width: 40, height: 4, background: t.fill, borderRadius: 2, margin: '14px auto 0' }} />
            <div style={{ fontSize: 18, fontWeight: 700, textAlign: 'center', padding: '14px 20px 0', color: t.text }}>Сводка смены</div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '12px 20px' }}>
              <SRow label="Дата" value={displayDate(currentDate)} t={t} />
              <SRow label="Вход" value={`€${fv(opening)}`} color={t.blue} t={t} />
              <SRow label="Наличные" value={`€${fv(inc)}`} color={t.green} t={t} />
              {card > 0 && <SRow label="Безнал (карта)" value={`€${fv(card)}`} color={t.purple} t={t} />}
              {card > 0 && <SRow label="Общий доход" value={`€${fv(inc + card)}`} color={t.green} bold t={t} />}
              {employees.filter(e => parseFloat(empExtras[e.id] || '0') > 0).map(e => (
                <SRow key={e.id} label={`${e.name} (экстра)`} value={`€${fv(parseFloat(empExtras[e.id]))}`} color={t.orange} t={t} />
              ))}
              {categories.filter(c => parseFloat(catAmounts[c.id] || '0') > 0).map(c => (
                <SRow key={c.id} label={c.name + (catNotes[c.id] ? ` (${catNotes[c.id]})` : '')} value={`−€${fv(parseFloat(catAmounts[c.id]))}`} color={t.red} t={t} />
              ))}
              {parseFloat(inkSum) > 0 && <SRow label="Инкассация" value={`−€${fv(parseFloat(inkSum))}`} color={t.orange} t={t} />}
              {parseFloat(inkExpense) > 0 && <SRow label={`Расход из инкасс${inkReason ? ` (${inkReason})` : ''}`} value={`−€${fv(parseFloat(inkExpense))}`} color={t.red} t={t} />}
              {salary > 0 && <SRow label={`Зарплата из инкасс${inkSalaryNote ? ` (${inkSalaryNote})` : ''}`} value={`−€${fv(salary)}`} color={t.purple} t={t} />}
              {(parseFloat(inkExpense) > 0 || salary > 0) && parseFloat(inkSum) > 0 && <SRow label="Итог инкассации" value={`€${fv(inkNet)}`} color={t.orange} bold t={t} />}
              <div style={{ borderTop: `1.5px solid ${t.sep}`, marginTop: 10, paddingTop: 10 }}>
                <SRow label="Итого расход" value={`−€${fv(totalExp)}`} color={t.red} bold t={t} />
                <SRow label="Касса" value={`€${fv(balance)}`} color={balance < 0 ? t.red : t.blue} bold t={t} />
              </div>
              {absences.length > 0 && (
                <div style={{ marginTop: 12, padding: '12px 14px', background: `${t.red}0e`, borderRadius: 12 }}>
                  <div style={{ fontSize: 11, color: t.text3, fontWeight: 600, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>Отсутствовали</div>
                  {employees.filter(e => absences.includes(e.id)).map(e => (
                    <div key={e.id} style={{ fontSize: 14, color: t.red, padding: '2px 0', display: 'flex', alignItems: 'center', gap: 6 }}>
                      <svg width="12" height="12" fill="none" stroke={t.red} strokeWidth="2.5" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12" /></svg>
                      {e.name}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div style={{ padding: '10px 16px 20px', display: 'flex', gap: 10 }}>
              <button onClick={() => setShowSummary(false)} style={{ flex: 1, padding: '14px', borderRadius: 14, border: 'none', background: t.fill, color: t.text, fontFamily: 'inherit', fontSize: 15, fontWeight: 600, cursor: 'pointer' }}>Отмена</button>
              <button onClick={saveShift} disabled={saving} style={{ flex: 2, padding: '14px', borderRadius: 14, border: 'none', background: saving ? t.fill : t.blue, color: saving ? t.text3 : '#fff', fontFamily: 'inherit', fontSize: 15, fontWeight: 700, cursor: 'pointer', boxShadow: saving ? 'none' : `0 4px 16px ${t.blue}44` }}>
                {saving ? 'Сохраняем...' : 'Подтвердить'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TOAST */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 100, left: '50%', transform: 'translateX(-50%)',
          background: t.dark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.85)',
          backdropFilter: 'blur(16px)', color: '#fff', padding: '12px 22px',
          borderRadius: 22, fontSize: 14, fontWeight: 600, zIndex: 600,
          whiteSpace: 'nowrap', animation: 'toastIn .25s ease',
          border: `1px solid ${t.dark ? 'rgba(255,255,255,0.1)' : 'transparent'}`,
        }}>{toast}</div>
      )}
    </div>
  )
}

// ── ROOT ──────────────────────────────────────────────────────────────────────

export default function ManagerPage() {
  const [restaurantId, setRestaurantId] = useState<string | null>(null)

  if (!restaurantId) {
    return <AuthGate appId="manager" appName="Mise Manager" onAuth={setRestaurantId} />
  }
  return <ManagerApp restaurantId={restaurantId} />
}
