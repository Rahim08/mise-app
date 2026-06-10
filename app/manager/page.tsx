'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'



type Employee = { id: string; name: string; deduct_per_absence: number }
type Category = { id: string; name: string }
type Shift = { id: string; date: string; status: string; opening_balance: number; income: number; total_expense: number; inkassation: number; closing_balance: number }

function fv(v: number) { return v.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }
function fmtDate(d: Date) { return d.toISOString().split('T')[0] }
function displayDate(d: Date) {
  return String(d.getDate()).padStart(2,'0') + '.' + String(d.getMonth()+1).padStart(2,'0') + '.' + d.getFullYear()
}
const DOW = ['Воскресенье','Понедельник','Вторник','Среда','Четверг','Пятница','Суббота']

export default function ManagerApp() {
  const [user, setUser] = useState<any>(null)
  const [restaurantId, setRestaurantId] = useState('')
  const [currentDate, setCurrentDate] = useState(new Date())
  const [shift, setShift] = useState<Shift | null>(null)
  const [employees, setEmployees] = useState<Employee[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [absences, setAbsences] = useState<string[]>([])
  const [empExtras, setEmpExtras] = useState<Record<string, string>>({})
  const [catAmounts, setCatAmounts] = useState<Record<string, string>>({})
  const [catNotes, setCatNotes] = useState<Record<string, string>>({})
  const [income, setIncome] = useState('')
  const [inkSum, setInkSum] = useState('')
  const [inkExpense, setInkExpense] = useState('')
  const [inkReason, setInkReason] = useState('')
  const [showSummary, setShowSummary] = useState(false)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState('')

  const toast = (m: string) => { setMsg(m); setTimeout(() => setMsg(''), 2500) }

  useEffect(() => {
    const storedRestaurantId = localStorage.getItem('mise_restaurant_id')

    supabase.auth.getUser().then(async ({ data }) => {
      let rid = ''

      if (data.user) {
        // Владелец — Supabase auth
        setUser(data.user)
        const { data: profile } = await supabase.from('profiles').select('restaurant_id').eq('id', data.user.id).single()
        rid = profile?.restaurant_id || storedRestaurantId || ''
      } else if (storedRestaurantId) {
        // Сотрудник — PIN сессия
        setUser({ id: 'staff', email: 'staff' })
        rid = storedRestaurantId
      } else {
        window.location.href = '/join?error=no_session'
        return
      }

      if (!rid) { window.location.href = '/join?error=no_session'; return }
      setRestaurantId(rid)

      // Subscription gate
      const { data: restData } = await supabase
        .from('restaurants').select('subscription_status').eq('id', rid).single()
      if (restData?.subscription_status !== 'active' && restData?.subscription_status !== 'trialing') {
        window.location.href = '/dashboard?tab=billing'; return
      }

      const [empsRes, catsRes] = await Promise.all([
        supabase.from('employees').select('id,name,deduct_per_absence').eq('restaurant_id', rid).eq('is_active', true).order('name'),
        supabase.from('expense_categories').select('id,name').eq('restaurant_id', rid).order('name')
      ])
      setEmployees(empsRes.data || [])
      setCategories(catsRes.data || [])
      await loadDay(rid, new Date(), empsRes.data || [], catsRes.data || [])
    })
  }, [])

  const loadDay = async (rid: string, date: Date, emps: Employee[], cats: Category[]) => {
    setLoading(true)
    const dateStr = fmtDate(date)

    // Load shift
    const { data: sh } = await supabase.from('shifts').select('*').eq('restaurant_id', rid).eq('date', dateStr).maybeSingle()

    // Get opening balance from yesterday
    const yesterday = new Date(date)
    yesterday.setDate(yesterday.getDate() - 1)
    const { data: prevShift } = await supabase.from('shifts').select('closing_balance').eq('restaurant_id', rid).eq('date', fmtDate(yesterday)).maybeSingle()
    const openingBalance = prevShift?.closing_balance || 0

    if (sh) {
      setShift({ ...sh, opening_balance: openingBalance })
      setIncome(sh.income > 0 ? String(sh.income) : '')
      setInkSum(sh.inkassation > 0 ? String(sh.inkassation) : '')

      // Load expenses
      const { data: exps } = await supabase.from('shift_expenses').select('*').eq('shift_id', sh.id)
      const amounts: Record<string, string> = {}
      const notes: Record<string, string> = {}
      ;(exps || []).forEach((e: any) => {
        if (e.category_id) { amounts[e.category_id] = String(e.amount); if (e.note) notes[e.category_id] = e.note }
      })
      setCatAmounts(amounts)
      setCatNotes(notes)

      // Load absences
      const { data: abs } = await supabase.from('shift_absences').select('employee_id').eq('shift_id', sh.id)
      setAbsences(abs?.map((a: any) => a.employee_id) || [])

      // Load emp extras
      const extras: Record<string, string> = {}
      ;(exps || []).forEach((e: any) => {
        if (e.employee_id) extras[e.employee_id] = String(e.amount)
      })
      setEmpExtras(extras)

      // Load inkassation details
      const { data: ink } = await supabase.from('inkassations').select('*').eq('shift_id', sh.id).maybeSingle()
      if (ink) { setInkExpense(ink.expense > 0 ? String(ink.expense) : ''); setInkReason(ink.reason || '') }
    } else {
      setShift(null)
      setIncome(''); setInkSum(''); setInkExpense(''); setInkReason('')
      setCatAmounts({}); setCatNotes({}); setAbsences({}  as any)
      setAbsences([]); setEmpExtras({})
    }
    setLoading(false)
  }

  const changeDate = async (dir: number) => {
    const d = new Date(currentDate)
    d.setDate(d.getDate() + dir)
    setCurrentDate(d)
    await loadDay(restaurantId, d, employees, categories)
  }

  const openShift = async () => {
    setSaving(true)
    const yesterday = new Date(currentDate)
    yesterday.setDate(yesterday.getDate() - 1)
    const { data: prev } = await supabase.from('shifts').select('closing_balance').eq('restaurant_id', restaurantId).eq('date', fmtDate(yesterday)).maybeSingle()
    const openingBalance = prev?.closing_balance || 0

    const { data: sh } = await supabase.from('shifts').insert({
      restaurant_id: restaurantId,
      date: fmtDate(currentDate),
      opened_by: user.id,
      manager_id: user.id,
      opening_balance: openingBalance,
      income: 0,
      inkassation: 0,
      closing_balance: openingBalance,
      status: 'open'
    }).select().single()

    if (sh) { setShift({ ...sh, opening_balance: openingBalance }); toast('✓ Смена открыта') }
    setSaving(false)
  }

  const toggleAbsence = async (empId: string) => {
    if (!shift) return
    if (absences.includes(empId)) {
      await supabase.from('shift_absences').delete().eq('shift_id', shift.id).eq('employee_id', empId)
      setAbsences(absences.filter(id => id !== empId))
    } else {
      await supabase.from('shift_absences').insert({ shift_id: shift.id, restaurant_id: restaurantId, employee_id: empId, date: fmtDate(currentDate) })
      setAbsences([...absences, empId])
    }
  }

  const calc = () => {
    const inc = parseFloat(income) || 0
    const ink = parseFloat(inkSum) || 0
    const catTotal = categories.reduce((s, c) => s + (parseFloat(catAmounts[c.id] || '0') || 0), 0)
    const empExtraTotal = employees.reduce((s, e) => s + (parseFloat(empExtras[e.id] || '0') || 0), 0)
    const totalExp = catTotal + empExtraTotal + ink
    const opening = shift?.opening_balance || 0
    const balance = opening + inc - totalExp
    return { inc, ink, catTotal, empExtraTotal, totalExp, balance, opening }
  }

  const saveShift = async () => {
    if (!shift) return
    setSaving(true)
    const { inc, ink, totalExp, balance } = calc()

    await supabase.from('shifts').update({ income: inc, inkassation: ink, total_expense: totalExp, closing_balance: balance }).eq('id', shift.id)

    // Save category expenses
    await supabase.from('shift_expenses').delete().eq('shift_id', shift.id).is('employee_id', null)
    const catInserts = categories.filter(c => parseFloat(catAmounts[c.id] || '0') > 0).map(c => ({
      shift_id: shift.id, restaurant_id: restaurantId,
      category_id: c.id, category_name: c.name,
      amount: parseFloat(catAmounts[c.id]), note: catNotes[c.id] || ''
    }))
    if (catInserts.length > 0) await supabase.from('shift_expenses').insert(catInserts)

    // Save emp extras
    for (const emp of employees) {
      const extra = parseFloat(empExtras[emp.id] || '0')
      if (extra > 0) {
        await supabase.from('shift_expenses').upsert({ shift_id: shift.id, restaurant_id: restaurantId, employee_id: emp.id, category_name: emp.name + ' (экстра)', amount: extra }, { onConflict: 'shift_id,employee_id' })
      }
    }

    // Save inkassation
    if (ink > 0 || inkExpense || inkReason) {
      await supabase.from('inkassations').upsert({
        shift_id: shift.id, restaurant_id: restaurantId, date: fmtDate(currentDate),
        amount: ink, expense: parseFloat(inkExpense) || 0, reason: inkReason, balance
      }, { onConflict: 'shift_id' })
    }

    setShift({ ...shift, income: inc, inkassation: ink, total_expense: totalExp, closing_balance: balance })
    setShowSummary(false)
    toast('✓ Смена сохранена!')
    setSaving(false)
  }

  const { inc, ink, catTotal, empExtraTotal, totalExp, balance, opening } = calc()
  const daysInMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0).getDate()

  if (!user || (loading && !shift && employees.length === 0)) return <div style={S.center}>Загрузка...</div>

  return (
    <div style={S.wrap}>

      {/* HEADER */}
      <div style={S.header}>
        <div style={{ fontWeight: 700, fontSize: '1rem', color: '#1d1d1f' }}>Mise Manager</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {shift && <span style={{ fontSize: '.7rem', padding: '3px 9px', borderRadius: 980, background: shift.status === 'open' ? 'rgba(52,199,89,.15)' : 'rgba(142,142,147,.15)', color: shift.status === 'open' ? '#34c759' : '#8e8e93', fontWeight: 600 }}>● {shift.status === 'open' ? 'Открыта' : 'Закрыта'}</span>}
          <button onClick={() => supabase.auth.signOut().then(() => window.location.href = '/auth/login')} style={S.logoutBtn}>Выйти</button>
        </div>
      </div>

      <div style={S.scroll}>

        {/* DATE ROW */}
        <div style={S.dateRow}>
          <button style={S.dateNav} onClick={() => changeDate(-1)}>‹</button>
          <div style={{ flex: 1, textAlign: 'center' as const }}>
            <div style={{ fontWeight: 700, fontSize: '1.05rem', color: '#1d1d1f' }}>{displayDate(currentDate)}</div>
            <div style={{ fontSize: '.78rem', color: '#007aff', marginTop: 2 }}>{DOW[currentDate.getDay()]} · День {currentDate.getDate()} из {daysInMonth}</div>
          </div>
          <button style={S.dateNav} onClick={() => changeDate(1)}>›</button>
        </div>

        {!shift ? (
          <div style={S.centerBox}>
            <div style={{ fontSize: '3rem', marginBottom: 16 }}>☀️</div>
            <div style={{ fontWeight: 700, fontSize: '1.1rem', marginBottom: 8, color: '#1d1d1f' }}>Смена не открыта</div>
            <div style={{ color: '#6e6e73', fontSize: '.88rem', marginBottom: 24 }}>Нажмите чтобы начать рабочий день</div>
            <button onClick={openShift} disabled={saving} style={S.bigBtn}>Открыть смену</button>
          </div>
        ) : (
          <>
            {/* СОТРУДНИКИ */}
            <div style={S.secLabel}>Сотрудники</div>
            <div style={S.card}>
              {employees.map((emp, i) => {
                const absent = absences.includes(emp.id)
                const extra = empExtras[emp.id] || ''
                return (
                  <div key={emp.id} style={{ ...S.empRow, borderBottom: i < employees.length - 1 ? '0.5px solid rgba(0,0,0,.07)' : 'none' }}>
                    <div style={{ flex: 1, fontSize: '.9rem', color: absent ? '#aeaeb2' : '#1d1d1f', textDecoration: absent ? 'line-through' : 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{emp.name}</div>
                    <input
                      type="number" value={extra}
                      onChange={e => setEmpExtras({ ...empExtras, [emp.id]: e.target.value })}
                      placeholder="€ 0"
                      style={{ ...S.empInput, background: parseFloat(extra) > 0 ? 'rgba(52,199,89,.1)' : 'rgba(118,118,128,.12)', color: parseFloat(extra) > 0 ? '#34c759' : '#1d1d1f', fontWeight: parseFloat(extra) > 0 ? 600 : 400 }}
                    />
                    <button onClick={() => toggleAbsence(emp.id)} style={{ ...S.absBtn, ...(absent ? S.absBtnActive : {}) }}>✗</button>
                  </div>
                )
              })}
            </div>

            {/* РАСХОДЫ ДНЯ */}
            <div style={S.secLabel}>Расходы дня</div>
            <div style={S.card}>
              {categories.map((cat, i) => {
                const val = catAmounts[cat.id] || ''
                const hasVal = parseFloat(val) > 0
                return (
                  <div key={cat.id}>
                    <div style={{ ...S.expRow, borderBottom: i < categories.length - 1 && !hasVal ? '0.5px solid rgba(0,0,0,.07)' : 'none' }}>
                      <div style={{ flex: 1, fontSize: '.9rem', color: '#1d1d1f' }}>{cat.name}</div>
                      <input
                        type="number" value={val}
                        onChange={e => setCatAmounts({ ...catAmounts, [cat.id]: e.target.value })}
                        placeholder="€ 0"
                        style={{ ...S.expInput, background: hasVal ? 'rgba(0,122,255,.08)' : 'rgba(118,118,128,.12)', color: hasVal ? '#007aff' : '#1d1d1f', fontWeight: hasVal ? 600 : 400 }}
                      />
                    </div>
                    {hasVal && (
                      <div style={{ padding: '4px 16px 8px', borderBottom: i < categories.length - 1 ? '0.5px solid rgba(0,0,0,.07)' : 'none' }}>
                        <input
                          value={catNotes[cat.id] || ''}
                          onChange={e => setCatNotes({ ...catNotes, [cat.id]: e.target.value })}
                          placeholder="Комментарий..."
                          style={{ width: '100%', padding: '6px 10px', borderRadius: 8, border: '0.5px solid rgba(0,0,0,.1)', fontSize: '.8rem', color: '#6e6e73', fontFamily: 'inherit', outline: 'none' }}
                        />
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            {/* ИНКАССАЦИЯ */}
            <div style={S.secLabel}>Инкассация</div>
            <div style={S.card}>
              <div style={{ ...S.fieldRow, borderBottom: '0.5px solid rgba(0,0,0,.07)' }}>
                <div style={S.fieldLabel}>Сумма</div>
                <input type="number" value={inkSum} onChange={e => setInkSum(e.target.value)} placeholder="€ 0"
                  style={{ ...S.fieldInput, background: parseFloat(inkSum) > 0 ? 'rgba(0,122,255,.08)' : 'rgba(118,118,128,.12)', color: parseFloat(inkSum) > 0 ? '#007aff' : '#1d1d1f', fontWeight: parseFloat(inkSum) > 0 ? 600 : 400 }} />
              </div>
              <div style={{ ...S.fieldRow, borderBottom: '0.5px solid rgba(0,0,0,.07)' }}>
                <div style={S.fieldLabel}>Расход</div>
                <input type="number" value={inkExpense} onChange={e => setInkExpense(e.target.value)} placeholder="€ 0"
                  style={{ ...S.fieldInput, background: parseFloat(inkExpense) > 0 ? 'rgba(255,59,48,.08)' : 'rgba(118,118,128,.12)', color: parseFloat(inkExpense) > 0 ? '#ff3b30' : '#1d1d1f', fontWeight: parseFloat(inkExpense) > 0 ? 600 : 400 }} />
              </div>
              <div style={{ padding: '10px 16px 12px', borderBottom: '0.5px solid rgba(0,0,0,.07)' }}>
                <div style={{ fontSize: '.78rem', color: '#6e6e73', fontWeight: 500, marginBottom: 6 }}>Причина</div>
                <input value={inkReason} onChange={e => setInkReason(e.target.value)} placeholder="Опишите назначение..."
                  style={{ width: '100%', padding: '9px 12px', borderRadius: 10, border: '0.5px solid rgba(0,0,0,.12)', fontSize: '.88rem', color: inkReason ? '#1d1d1f' : '#aeaeb2', fontFamily: 'inherit', outline: 'none', background: inkReason ? 'rgba(0,122,255,.04)' : 'rgba(118,118,128,.08)' }} />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 16px', background: 'rgba(255,149,0,.08)' }}>
                <div style={{ fontSize: '.88rem', fontWeight: 600, color: '#ff9500' }}>Итог инкассации</div>
                <div style={{ fontSize: '1.2rem', fontWeight: 700, color: '#ff9500' }}>€{fv(parseFloat(inkSum) || 0)}</div>
              </div>
            </div>

            {/* КАССА */}
            <div style={S.secLabel}>Касса</div>
            <div style={S.card}>
              <div style={{ ...S.fieldRow, borderBottom: '0.5px solid rgba(0,0,0,.07)' }}>
                <div style={S.fieldLabel}>Доход за день</div>
                <input type="number" value={income} onChange={e => setIncome(e.target.value)} placeholder="€ 0"
                  style={{ ...S.fieldInput, background: parseFloat(income) > 0 ? 'rgba(52,199,89,.08)' : 'rgba(118,118,128,.12)', color: parseFloat(income) > 0 ? '#34c759' : '#1d1d1f', fontWeight: parseFloat(income) > 0 ? 600 : 400 }} />
              </div>
              {/* 2x2 grid */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5px', background: 'rgba(0,0,0,.07)', margin: '0' }}>
                {[
                  { label: 'Вход', val: opening, color: '#007aff' },
                  { label: 'Доход', val: inc, color: '#34c759' },
                  { label: 'Расход', val: totalExp, color: '#ff3b30' },
                  { label: 'Остаток', val: balance, color: '#007aff' },
                ].map(cell => (
                  <div key={cell.label} style={{ background: '#fff', padding: '12px 14px' }}>
                    <div style={{ fontSize: '.7rem', color: '#6e6e73', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '.04em', marginBottom: 4 }}>{cell.label}</div>
                    <div style={{ fontSize: '1rem', fontWeight: 700, color: cell.color }}>€{fv(cell.val)}</div>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', background: 'rgba(0,122,255,.06)', borderTop: '0.5px solid rgba(0,0,0,.07)' }}>
                <div style={{ fontSize: '.9rem', fontWeight: 600, color: '#007aff' }}>Касса на конец смены</div>
                <div style={{ fontSize: '1.3rem', fontWeight: 700, color: balance < 0 ? '#ff3b30' : '#007aff' }}>€{fv(balance)}</div>
              </div>
            </div>

            <div style={{ height: 16 }} />
          </>
        )}
      </div>

      {/* SAVE BAR */}
      {shift && (
        <div style={S.saveBar}>
          <button onClick={() => setShowSummary(true)} style={S.saveBtn}>💾 Сохранить смену</button>
        </div>
      )}

      {/* SUMMARY MODAL */}
      {showSummary && (
        <div style={S.overlay} onClick={() => setShowSummary(false)}>
          <div style={S.sheet} onClick={(e: any) => e.stopPropagation()}>
            <div style={S.handle} />
            <div style={{ padding: '14px 20px 0', fontWeight: 700, fontSize: '1.05rem', textAlign: 'center' as const, color: '#1d1d1f' }}>Сводка смены</div>
            <div style={{ padding: '12px 20px', overflowY: 'auto' as const, maxHeight: '60vh' }}>
              <SRow label="Дата" value={displayDate(currentDate)} />
              <SRow label="Вход" value={`€${fv(opening)}`} color="#007aff" />
              <SRow label="Доход" value={`€${fv(inc)}`} color="#34c759" />
              {employees.filter(e => parseFloat(empExtras[e.id] || '0') > 0).map(e => (
                <SRow key={e.id} label={`${e.name} (экстра)`} value={`€${fv(parseFloat(empExtras[e.id]))}`} color="#ff9500" />
              ))}
              {categories.filter(c => parseFloat(catAmounts[c.id] || '0') > 0).map(c => (
                <SRow key={c.id} label={c.name + (catNotes[c.id] ? ` (${catNotes[c.id]})` : '')} value={`−€${fv(parseFloat(catAmounts[c.id]))}`} color="#ff3b30" />
              ))}
              {parseFloat(inkSum) > 0 && <SRow label="Инкассация" value={`−€${fv(parseFloat(inkSum))}`} color="#ff9500" />}
              {parseFloat(inkExpense) > 0 && <SRow label={`Расход из инкасс${inkReason ? ` (${inkReason})` : ''}`} value={`−€${fv(parseFloat(inkExpense))}`} color="#ff3b30" />}
              <div style={{ borderTop: '1.5px solid rgba(0,0,0,.1)', marginTop: 10, paddingTop: 10 }}>
                <SRow label="Итого расход" value={`−€${fv(totalExp)}`} color="#ff3b30" bold />
                <SRow label="Касса" value={`€${fv(balance)}`} color={balance < 0 ? '#ff3b30' : '#007aff'} bold />
              </div>
              {absences.length > 0 && (
                <div style={{ marginTop: 12, padding: '10px 12px', background: 'rgba(255,59,48,.06)', borderRadius: 10 }}>
                  <div style={{ fontSize: '.75rem', color: '#6e6e73', fontWeight: 600, marginBottom: 6, textTransform: 'uppercase' as const }}>Отсутствовали</div>
                  {employees.filter(e => absences.includes(e.id)).map(e => (
                    <div key={e.id} style={{ fontSize: '.85rem', color: '#ff3b30', padding: '2px 0' }}>✗ {e.name}</div>
                  ))}
                </div>
              )}
            </div>
            <div style={{ padding: '10px 16px 20px', display: 'flex', gap: 10 }}>
              <button onClick={() => setShowSummary(false)} style={{ flex: 1, padding: '14px', borderRadius: 14, border: 'none', background: '#f5f5f7', color: '#1d1d1f', fontFamily: 'inherit', fontSize: '.9rem', fontWeight: 600, cursor: 'pointer' }}>Отмена</button>
              <button onClick={saveShift} disabled={saving} style={{ flex: 2, padding: '14px', borderRadius: 14, border: 'none', background: '#007aff', color: '#fff', fontFamily: 'inherit', fontSize: '.95rem', fontWeight: 700, cursor: 'pointer' }}>
                {saving ? 'Сохраняем...' : '✅ Подтвердить'}
              </button>
            </div>
          </div>
        </div>
      )}

      {msg && <div style={S.toast}>{msg}</div>}
    </div>
  )
}

function SRow({ label, value, color, bold }: { label: string; value: string; color?: string; bold?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: '0.5px solid rgba(0,0,0,.05)' }}>
      <span style={{ color: '#6e6e73', fontSize: bold ? '.9rem' : '.85rem', fontWeight: bold ? 700 : 400 }}>{label}</span>
      <span style={{ color: color || '#1d1d1f', fontWeight: bold ? 800 : 600, fontSize: bold ? '.95rem' : '.85rem' }}>{value}</span>
    </div>
  )
}

const S: Record<string, any> = {
  wrap: { minHeight: '100vh', background: '#f2f2f7', fontFamily: '-apple-system,BlinkMacSystemFont,sans-serif', WebkitFontSmoothing: 'antialiased', paddingBottom: 90 },
  header: { background: 'rgba(255,255,255,.92)', backdropFilter: 'blur(20px)', borderBottom: '0.5px solid rgba(0,0,0,.1)', padding: '0 16px', height: 52, display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky' as const, top: 0, zIndex: 100 },
  logoutBtn: { background: 'none', border: 'none', color: '#ff3b30', cursor: 'pointer', fontSize: '.8rem', fontFamily: 'inherit' },
  scroll: { maxWidth: 600, margin: '0 auto', padding: '16px 16px 16px' },
  center: { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: '-apple-system,sans-serif', color: '#6e6e73' },
  centerBox: { textAlign: 'center' as const, padding: '40px 0' },
  dateRow: { display: 'flex', alignItems: 'center', gap: 12, background: '#fff', borderRadius: 14, padding: '12px 16px', marginBottom: 16, boxShadow: '0 1px 4px rgba(0,0,0,.06)' },
  dateNav: { width: 38, height: 38, borderRadius: '50%', background: 'rgba(118,118,128,.12)', border: 'none', fontSize: '1.2rem', color: '#3a3a3c', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'inherit' },
  secLabel: { fontSize: '.75rem', fontWeight: 600, color: '#6d6d72', textTransform: 'uppercase' as const, letterSpacing: '.05em', padding: '12px 4px 6px' },
  card: { background: '#fff', borderRadius: 16, overflow: 'hidden', marginBottom: 12, boxShadow: '0 1px 4px rgba(0,0,0,.06)' },
  empRow: { display: 'flex', alignItems: 'center', padding: '10px 16px', gap: 10 },
  empInput: { width: 88, textAlign: 'right' as const, padding: '7px 10px', border: 'none', borderRadius: 10, fontSize: '.88rem', fontFamily: 'inherit', outline: 'none' },
  absBtn: { width: 34, height: 34, borderRadius: '50%', border: '2px solid rgba(118,118,128,.25)', background: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '.85rem', color: 'transparent', flexShrink: 0 },
  absBtnActive: { borderColor: '#ff3b30', background: 'rgba(255,59,48,.1)', color: '#ff3b30' },
  expRow: { display: 'flex', alignItems: 'center', padding: '11px 16px', gap: 12 },
  expInput: { width: 110, textAlign: 'right' as const, padding: '8px 10px', border: 'none', borderRadius: 10, fontSize: '.9rem', fontFamily: 'inherit', outline: 'none' },
  fieldRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px' },
  fieldLabel: { fontSize: '.9rem', color: '#1d1d1f' },
  fieldInput: { width: 130, textAlign: 'right' as const, padding: '8px 10px', border: 'none', borderRadius: 10, fontSize: '.9rem', fontFamily: 'inherit', outline: 'none' },
  saveBar: { position: 'fixed' as const, bottom: 0, left: 0, right: 0, padding: '12px 16px', paddingBottom: 'calc(12px + env(safe-area-inset-bottom, 0px))', background: 'rgba(255,255,255,.92)', backdropFilter: 'blur(20px)', borderTop: '0.5px solid rgba(0,0,0,.1)', zIndex: 100 },
  saveBtn: { width: '100%', padding: '15px', borderRadius: 14, background: '#007aff', color: '#fff', border: 'none', fontSize: '1rem', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' },
  bigBtn: { width: '100%', padding: '15px', borderRadius: 14, background: '#007aff', color: '#fff', border: 'none', fontSize: '1rem', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' },
  overlay: { position: 'fixed' as const, inset: 0, background: 'rgba(0,0,0,.4)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 500 },
  sheet: { background: '#fff', borderRadius: '22px 22px 0 0', width: '100%', maxWidth: 480, paddingBottom: 8 },
  handle: { width: 36, height: 4, background: 'rgba(0,0,0,.15)', borderRadius: 2, margin: '12px auto 0' },
  toast: { position: 'fixed' as const, bottom: 100, left: '50%', transform: 'translateX(-50%)', background: '#1d1d1f', color: '#fff', padding: '11px 22px', borderRadius: 980, fontSize: '.85rem', fontWeight: 500, zIndex: 999, whiteSpace: 'nowrap' as const },
}
