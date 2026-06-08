'use client'
import { useEffect, useState, useRef } from 'react'
import { createClient } from '@supabase/supabase-js'
import { Chart, registerables } from 'chart.js'
Chart.register(...registerables)

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

function fv(v: number) { return v.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }
function fmtDate(d: Date) { return d.toISOString().split('T')[0] }
function displayDate(d: Date) { return String(d.getDate()).padStart(2,'0')+'.'+String(d.getMonth()+1).padStart(2,'0')+'.'+d.getFullYear() }
const MRU = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь']
const DOW = ['Вс','Пн','Вт','Ср','Чт','Пт','Сб']

type Shift = { id: string; date: string; opening_balance: number; income: number; total_expense: number; inkassation: number; closing_balance: number; status: string }
type Expense = { id: string; shift_id: string; category_name: string; amount: number; note: string; employee_id: string | null }
type Inkassation = { id: string; shift_id: string; date: string; amount: number; expense: number; reason: string; balance: number }
type Employee = { id: string; name: string; salary: number; deduct_per_absence: number }
type CardAmount = { employee_id: string; card_amount: number }
type Absence = { employee_id: string; date: string }
type ChatMsg = { role: 'user' | 'ai'; text: string }

export default function AnalyticsApp() {
  const [user, setUser] = useState<any>(null)
  const [restaurantId, setRestaurantId] = useState('')
  const [currency, setCurrency] = useState('€')
  const [geminiKey, setGeminiKey] = useState('')
  const [tab, setTab] = useState<'period'|'kassa'|'sales'|'salary'|'hookah'>('period')
  const [periodMode, setPeriodMode] = useState<'day'|'week'|'month'>('day')
  const [kassaMode, setKassaMode] = useState<'kassa'|'inkass'>('kassa')
  const [currentDate, setCurrentDate] = useState(new Date())
  const [shifts, setShifts] = useState<Shift[]>([])
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [inkassations, setInkassations] = useState<Inkassation[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [cardAmounts, setCardAmounts] = useState<CardAmount[]>([])
  const [absences, setAbsences] = useState<Absence[]>([])
  const [loading, setLoading] = useState(true)
  const [showAI, setShowAI] = useState(false)
  const [chatMsgs, setChatMsgs] = useState<ChatMsg[]>([])
  const [chatInput, setChatInput] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const chartRef1 = useRef<any>(null)
  const chartRef2 = useRef<any>(null)
  const chartInst1 = useRef<any>(null)
  const chartInst2 = useRef<any>(null)

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) { window.location.href = '/auth/login'; return }
      setUser(data.user)
      const { data: profile } = await supabase.from('profiles').select('restaurant_id').eq('id', data.user.id).single()
      if (!profile) return
      setRestaurantId(profile.restaurant_id)
      await loadAll(profile.restaurant_id)
    })
  }, [])

  const loadAll = async (rid: string) => {
    setLoading(true)
    const now = new Date()
    const monthStart = fmtDate(new Date(now.getFullYear(), now.getMonth(), 1))
    const monthEnd = fmtDate(new Date(now.getFullYear(), now.getMonth() + 1, 0))

    const [shiftsRes, settingsRes, empsRes, cardsRes, absRes] = await Promise.all([
      supabase.from('shifts').select('*').eq('restaurant_id', rid).gte('date', monthStart).lte('date', monthEnd).order('date'),
      supabase.from('restaurant_settings').select('currency,gemini_api_key').eq('restaurant_id', rid).single(),
      supabase.from('employees').select('id,name,salary,deduct_per_absence').eq('restaurant_id', rid).eq('is_active', true).order('name'),
      supabase.from('monthly_card_amounts').select('employee_id,card_amount').eq('restaurant_id', rid).eq('month', fmtDate(now).slice(0,7)),
      supabase.from('shift_absences').select('employee_id,date').eq('restaurant_id', rid).gte('date', monthStart).lte('date', monthEnd)
    ])

    const shiftList = shiftsRes.data || []
    setShifts(shiftList)
    if (settingsRes.data) { setCurrency(settingsRes.data.currency || '€'); setGeminiKey(settingsRes.data.gemini_api_key || '') }
    setEmployees(empsRes.data || [])
    setCardAmounts(cardsRes.data || [])
    setAbsences(absRes.data || [])

    // Load expenses and inkassations for these shifts
    if (shiftList.length > 0) {
      const shiftIds = shiftList.map(s => s.id)
      const [expsRes, inkRes] = await Promise.all([
        supabase.from('shift_expenses').select('*').in('shift_id', shiftIds),
        supabase.from('inkassations').select('*').in('shift_id', shiftIds).order('date')
      ])
      setExpenses(expsRes.data || [])
      setInkassations(inkRes.data || [])
    }
    setLoading(false)
  }

  // ── DATA HELPERS ──
  const getShiftByDate = (dateStr: string) => shifts.find(s => s.date === dateStr)
  const getExpensesByShift = (shiftId: string) => expenses.filter(e => e.shift_id === shiftId && !e.employee_id)
  const getInkByShift = (shiftId: string) => inkassations.find(i => i.shift_id === shiftId)

  const getDayData = (date: Date) => {
    const dateStr = fmtDate(date)
    const shift = getShiftByDate(dateStr)
    if (!shift) return null
    const exps = getExpensesByShift(shift.id)
    const ink = getInkByShift(shift.id)
    return { shift, exps, ink }
  }

  const getWeekData = () => {
    const start = new Date(currentDate)
    start.setDate(start.getDate() - start.getDay() + 1)
    const days = []
    for (let i = 0; i < 7; i++) {
      const d = new Date(start)
      d.setDate(start.getDate() + i)
      const data = getDayData(d)
      if (data) days.push({ date: d, ...data })
    }
    return days
  }

  const getMonthData = () => shifts

  const totalIncome = shifts.reduce((s, sh) => s + (sh.income || 0), 0)
  const totalExpense = shifts.reduce((s, sh) => s + (sh.total_expense || 0), 0)
  const totalInkass = inkassations.reduce((s, i) => s + (i.amount || 0), 0)
  const lastShift = shifts[shifts.length - 1]

  // ── AI CHAT ──
  const sendMessage = async () => {
    if (!chatInput.trim() || !geminiKey) return
    const userMsg = chatInput.trim()
    setChatInput('')
    setChatMsgs(prev => [...prev, { role: 'user', text: userMsg }])
    setChatLoading(true)

    // Build context
    const context = `Ты AI-ассистент ресторана. Данные за текущий месяц:
- Доход: ${currency}${fv(totalIncome)}
- Расходы: ${currency}${fv(totalExpense)}
- Инкассации: ${currency}${fv(totalInkass)}
- Баланс кассы: ${currency}${fv(lastShift?.closing_balance || 0)}
- Смен проведено: ${shifts.length}
- Сотрудников: ${employees.length}
Категории расходов: ${[...new Set(expenses.map(e => e.category_name))].join(', ')}
Отвечай кратко и по делу на русском языке.`

    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: context + '\n\nВопрос: ' + userMsg }] }] })
      })
      const data = await res.json()
      const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || 'Не удалось получить ответ'
      setChatMsgs(prev => [...prev, { role: 'ai', text: reply }])
    } catch (e) {
      setChatMsgs(prev => [...prev, { role: 'ai', text: 'Ошибка подключения к AI' }])
    }
    setChatLoading(false)
  }

  if (loading) return <div style={S.center}>Загрузка...</div>

  return (
    <div style={S.wrap}>
      {/* HEADER */}
      <div style={S.header}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ fontWeight: 700, fontSize: '1rem', color: '#1d1d1f' }}>SO Analytics</div>
          <div style={{ fontSize: '.75rem', color: '#6e6e73' }}>{MRU[currentDate.getMonth()]} {currentDate.getFullYear()}</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setShowAI(true)} style={S.aiBtn}>🤖 AI</button>
          <button onClick={() => supabase.auth.signOut().then(() => window.location.href = '/auth/login')} style={S.logoutBtn}>Выйти</button>
        </div>
      </div>

      {/* SCROLL */}
      <div style={S.scroll}>

        {/* PERIOD TAB */}
        {tab === 'period' && (
          <div>
            {/* Period switcher */}
            <div style={S.segControl}>
              {(['day','week','month'] as const).map(m => (
                <button key={m} onClick={() => setPeriodMode(m)} style={{ ...S.segBtn, ...(periodMode === m ? S.segActive : {}) }}>
                  {m === 'day' ? 'День' : m === 'week' ? 'Неделя' : 'Месяц'}
                </button>
              ))}
            </div>

            {/* Date nav (day/week only) */}
            {periodMode !== 'month' && (
              <div style={S.dateRow}>
                <button style={S.dateNav} onClick={() => { const d = new Date(currentDate); d.setDate(d.getDate() - (periodMode === 'week' ? 7 : 1)); setCurrentDate(d) }}>‹</button>
                <div style={{ flex: 1, textAlign: 'center' as const }}>
                  <div style={{ fontWeight: 700, color: '#1d1d1f' }}>{periodMode === 'day' ? displayDate(currentDate) : `Неделя ${currentDate.getDate()} ${MRU[currentDate.getMonth()]}`}</div>
                  <div style={{ fontSize: '.75rem', color: '#007aff' }}>{periodMode === 'day' ? DOW[currentDate.getDay()] : ''}</div>
                </div>
                <button style={S.dateNav} onClick={() => { const d = new Date(currentDate); d.setDate(d.getDate() + (periodMode === 'week' ? 7 : 1)); setCurrentDate(d) }}>›</button>
              </div>
            )}

            {/* DAY VIEW */}
            {periodMode === 'day' && (() => {
              const dayData = getDayData(currentDate)
              if (!dayData) return <div style={S.empty}><div style={{ fontSize: '2rem', marginBottom: 8 }}>📭</div>Нет данных за {displayDate(currentDate)}</div>
              const { shift, exps, ink } = dayData
              return (
                <div>
                  <div style={S.grid2}>
                    <StatCard label="Расход дня" value={`${currency}${fv(shift.total_expense)}`} color="#ff3b30" />
                    <StatCard label="Доход" value={`${currency}${fv(shift.income)}`} color="#34c759" />
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, marginBottom: 12 }}>
                    <StatCard label="Вход" value={`${currency}${fv(shift.opening_balance)}`} color="#007aff" small />
                    <StatCard label="Доход" value={`${currency}${fv(shift.income)}`} color="#34c759" small />
                    <StatCard label="Расход" value={`${currency}${fv(shift.total_expense)}`} color="#ff3b30" small />
                    <StatCard label="Касса" value={`${currency}${fv(shift.closing_balance)}`} color="#007aff" small />
                  </div>
                  {exps.length > 0 && (
                    <>
                      <div style={S.secLabel}>Расходы</div>
                      <div style={S.card}>
                        {exps.map((e, i) => (
                          <div key={e.id} style={{ ...S.lrow, borderBottom: i < exps.length-1 ? '0.5px solid rgba(0,0,0,.07)' : 'none' }}>
                            <div style={S.lname}>{e.category_name}{e.note ? ` · ${e.note}` : ''}</div>
                            <div style={{ ...S.lval, color: '#ff3b30' }}>−{currency}{fv(e.amount)}</div>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                  {ink && (
                    <>
                      <div style={S.secLabel}>Инкассация</div>
                      <div style={S.card}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5px', background: 'rgba(0,0,0,.07)' }}>
                          <div style={{ background: '#fff', padding: '10px 14px' }}><div style={S.cellLabel}>Приход</div><div style={{ fontWeight: 700, color: '#34c759' }}>{ink.amount > 0 ? `${currency}${fv(ink.amount)}` : '—'}</div></div>
                          <div style={{ background: '#fff', padding: '10px 14px' }}><div style={S.cellLabel}>Расход</div><div style={{ fontWeight: 700, color: '#ff3b30' }}>{ink.expense > 0 ? `${currency}${fv(ink.expense)}` : '—'}</div></div>
                        </div>
                        {ink.reason && <div style={{ padding: '10px 14px', fontSize: '.82rem', color: '#6e6e73' }}>Причина: {ink.reason}</div>}
                        <div style={{ padding: '12px 14px', background: 'rgba(255,149,0,.08)', display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ color: '#ff9500', fontWeight: 600 }}>Итог</span>
                          <span style={{ color: '#ff9500', fontWeight: 700 }}>{currency}{fv(ink.balance)}</span>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )
            })()}

            {/* WEEK VIEW */}
            {periodMode === 'week' && (() => {
              const days = getWeekData()
              if (!days.length) return <div style={S.empty}>Нет данных за эту неделю</div>
              const weekIncome = days.reduce((s, d) => s + d.shift.income, 0)
              const weekExpense = days.reduce((s, d) => s + d.shift.total_expense, 0)
              return (
                <div>
                  <div style={S.grid2}>
                    <StatCard label="Доход за неделю" value={`${currency}${fv(weekIncome)}`} color="#34c759" />
                    <StatCard label="Расходы" value={`${currency}${fv(weekExpense)}`} color="#ff3b30" />
                  </div>
                  <div style={S.secLabel}>По дням</div>
                  <div style={S.card}>
                    {days.map((d, i) => (
                      <div key={d.date.toISOString()} style={{ ...S.lrow, borderBottom: i < days.length-1 ? '0.5px solid rgba(0,0,0,.07)' : 'none' }}>
                        <div><div style={S.lname}>{displayDate(d.date)}</div><div style={{ fontSize: '.75rem', color: '#6e6e73' }}>{DOW[d.date.getDay()]}</div></div>
                        <div style={{ textAlign: 'right' as const }}>
                          <div style={{ color: '#34c759', fontWeight: 600, fontSize: '.88rem' }}>{currency}{fv(d.shift.income)}</div>
                          <div style={{ color: '#ff3b30', fontSize: '.78rem' }}>−{currency}{fv(d.shift.total_expense)}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })()}

            {/* MONTH VIEW */}
            {periodMode === 'month' && (
              <div>
                <div style={S.grid2}>
                  <StatCard label="Доход за месяц" value={`${currency}${fv(totalIncome)}`} color="#34c759" />
                  <StatCard label="Расходы" value={`${currency}${fv(totalExpense)}`} color="#ff3b30" />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginBottom: 12 }}>
                  <StatCard label="Инкасс" value={`${currency}${fv(totalInkass)}`} color="#ff9500" small />
                  <StatCard label="Смен" value={String(shifts.length)} small />
                  <StatCard label="Касса" value={`${currency}${fv(lastShift?.closing_balance || 0)}`} color="#007aff" small />
                </div>
                {/* Expense breakdown */}
                {(() => {
                  const catMap: Record<string, number> = {}
                  expenses.filter(e => !e.employee_id).forEach(e => { catMap[e.category_name] = (catMap[e.category_name] || 0) + e.amount })
                  const sorted = Object.entries(catMap).sort((a, b) => b[1] - a[1])
                  const maxVal = sorted[0]?.[1] || 1
                  if (!sorted.length) return null
                  return (
                    <>
                      <div style={S.secLabel}>Структура расходов</div>
                      <div style={S.card}>
                        {sorted.map(([name, amt]) => (
                          <div key={name} style={{ padding: '10px 16px', borderBottom: '0.5px solid rgba(0,0,0,.07)' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                              <span style={{ fontSize: '.88rem', color: '#1d1d1f' }}>{name}</span>
                              <span style={{ fontSize: '.88rem', fontWeight: 600, color: '#1d1d1f' }}>{currency}{fv(amt)}</span>
                            </div>
                            <div style={{ height: 4, background: 'rgba(0,0,0,.07)', borderRadius: 2, overflow: 'hidden' }}>
                              <div style={{ height: '100%', width: `${(amt/maxVal*100).toFixed(1)}%`, background: '#007aff', borderRadius: 2, transition: 'width 1s' }} />
                            </div>
                          </div>
                        ))}
                      </div>
                    </>
                  )
                })()}
              </div>
            )}
          </div>
        )}

        {/* KASSA TAB */}
        {tab === 'kassa' && (
          <div>
            <div style={S.segControl}>
              <button onClick={() => setKassaMode('kassa')} style={{ ...S.segBtn, ...(kassaMode === 'kassa' ? S.segActive : {}) }}>Касса</button>
              <button onClick={() => setKassaMode('inkass')} style={{ ...S.segBtn, ...(kassaMode === 'inkass' ? S.segActive : {}) }}>Инкасс</button>
            </div>

            {kassaMode === 'kassa' && (
              <div>
                <div style={S.grid2}>
                  <StatCard label="Остаток" value={`${currency}${fv(lastShift?.closing_balance || 0)}`} color="#007aff" />
                  <StatCard label="Доход посл." value={`${currency}${fv(lastShift?.income || 0)}`} color="#34c759" />
                </div>
                <div style={S.secLabel}>По дням</div>
                <div style={S.card}>
                  <div style={{ display: 'grid', gridTemplateColumns: '50px 1fr 1fr 1fr 1fr', background: 'rgba(0,0,0,.04)', padding: '7px 14px', gap: 4 }}>
                    {['Дата','Вход','Доход','Расход','Касса'].map(h => <div key={h} style={{ fontSize: '.68rem', color: '#6e6e73', fontWeight: 600, textTransform: 'uppercase' as const }}>{h}</div>)}
                  </div>
                  {shifts.filter(s => s.income > 0 || s.total_expense > 0).map(s => (
                    <div key={s.id} style={{ display: 'grid', gridTemplateColumns: '50px 1fr 1fr 1fr 1fr', padding: '10px 14px', gap: 4, borderBottom: '0.5px solid rgba(0,0,0,.06)', fontSize: '.82rem' }}>
                      <span style={{ color: '#6e6e73' }}>{s.date.slice(5).replace('-','.')}</span>
                      <span style={{ color: '#007aff' }}>{s.opening_balance > 0 ? `${currency}${fv(s.opening_balance)}` : '—'}</span>
                      <span style={{ color: '#34c759', fontWeight: 600 }}>{s.income > 0 ? `${currency}${fv(s.income)}` : '—'}</span>
                      <span style={{ color: '#ff3b30' }}>{s.total_expense > 0 ? `${currency}${fv(s.total_expense)}` : '—'}</span>
                      <span style={{ color: '#007aff', fontWeight: 700 }}>{currency}{fv(s.closing_balance)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {kassaMode === 'inkass' && (
              <div>
                {(() => {
                  const now = new Date()
                  const dIM = new Date(now.getFullYear(), now.getMonth()+1, 0).getDate()
                  const dom = now.getDate()
                  const lastInk = inkassations[inkassations.length-1]
                  const inkBalance = lastInk?.balance || 0
                  const totalSalary = employees.reduce((s, e) => s + e.salary, 0)
                  const salToday = Math.round(totalSalary / dIM * dom)
                  const diff = inkBalance - salToday
                  return (
                    <>
                      <div style={S.grid2}>
                        <StatCard label="Баланс" value={`${currency}${fv(inkBalance)}`} color="#ff9500" />
                        <StatCard label="ЗП на сегодня" value={`${currency}${fv(salToday)}`} color={diff >= 0 ? '#34c759' : '#ff3b30'} sub={diff >= 0 ? `Опережаем +${currency}${fv(diff)}` : `Отстаём −${currency}${fv(Math.abs(diff))}`} />
                      </div>
                      <div style={S.secLabel}>История</div>
                      <div style={S.card}>
                        {inkassations.length === 0 ? <div style={S.empty}>Нет инкассаций</div> : (
                          <>
                            <div style={{ display: 'grid', gridTemplateColumns: '44px 1fr 1fr 1fr 1fr', background: 'rgba(0,0,0,.04)', padding: '7px 14px', gap: 4 }}>
                              {['Дата','Сумма','Расход','Причина','Итог'].map(h => <div key={h} style={{ fontSize: '.68rem', color: '#6e6e73', fontWeight: 600, textTransform: 'uppercase' as const }}>{h}</div>)}
                            </div>
                            {inkassations.map(ink => (
                              <div key={ink.id} style={{ display: 'grid', gridTemplateColumns: '44px 1fr 1fr 1fr 1fr', padding: '10px 14px', gap: 4, borderBottom: '0.5px solid rgba(0,0,0,.06)', fontSize: '.82rem' }}>
                                <span style={{ color: '#6e6e73' }}>{ink.date.slice(5).replace('-','.')}</span>
                                <span style={{ color: '#34c759', fontWeight: 600 }}>{ink.amount > 0 ? `${currency}${fv(ink.amount)}` : '—'}</span>
                                <span style={{ color: '#ff3b30' }}>{ink.expense > 0 ? `${currency}${fv(ink.expense)}` : '—'}</span>
                                <span style={{ color: '#6e6e73', fontSize: '.75rem' }}>{ink.reason || '—'}</span>
                                <span style={{ color: '#ff9500', fontWeight: 600 }}>{currency}{fv(ink.balance)}</span>
                              </div>
                            ))}
                          </>
                        )}
                      </div>
                    </>
                  )
                })()}
              </div>
            )}
          </div>
        )}

        {/* SALES TAB */}
        {tab === 'sales' && (
          <div style={S.comingSoon}>
            <div style={{ fontSize: '3rem', marginBottom: 16 }}>🛒</div>
            <div style={{ fontWeight: 700, fontSize: '1.1rem', marginBottom: 8, color: '#1d1d1f' }}>Продажи</div>
            <div style={{ color: '#6e6e73', fontSize: '.88rem', maxWidth: 260, textAlign: 'center' as const }}>Скоро здесь появится статистика продаж из Syrve — чеки, товары, выручка по позициям</div>
          </div>
        )}

        {/* SALARY TAB */}
        {tab === 'salary' && (
          <div>
            {(() => {
              const now = new Date()
              const monthStr = fmtDate(now).slice(0,7)
              const totalFOT = employees.reduce((s, e) => s + e.salary, 0)
              const totalCard = cardAmounts.reduce((s, c) => s + c.card_amount, 0)
              const totalCash = employees.reduce((s, emp) => {
                const absCount = absences.filter(a => a.employee_id === emp.id).length
                const deduct = absCount * emp.deduct_per_absence
                const card = cardAmounts.find(c => c.employee_id === emp.id)?.card_amount || 0
                return s + (emp.salary - deduct - card)
              }, 0)
              return (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginBottom: 12 }}>
                    <StatCard label="ФОТ" value={`${currency}${fv(totalFOT)}`} color="#007aff" small />
                    <StatCard label="Нал" value={`${currency}${fv(totalCash)}`} color="#ff9500" small />
                    <StatCard label="Карта" value={`${currency}${fv(totalCard)}`} color="#af52de" small />
                  </div>
                  <div style={S.secLabel}>Сотрудники</div>
                  <div style={S.card}>
                    {employees.map((emp, i) => {
                      const absCount = absences.filter(a => a.employee_id === emp.id).length
                      const deduct = absCount * emp.deduct_per_absence
                      const card = cardAmounts.find(c => c.employee_id === emp.id)?.card_amount || 0
                      const cash = emp.salary - deduct - card
                      const pct = Math.min(absCount / 22 * 100, 100)
                      return (
                        <div key={emp.id} style={{ padding: '12px 16px', borderBottom: i < employees.length-1 ? '0.5px solid rgba(0,0,0,.07)' : 'none' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontWeight: 600, fontSize: '.9rem', color: '#1d1d1f', marginBottom: 2 }}>{emp.name}</div>
                              <div style={{ fontSize: '.75rem', color: '#6e6e73' }}>
                                ЗП: {currency}{fv(emp.salary)}{deduct > 0 ? ` · −${currency}${fv(deduct)}` : ''}{absCount > 0 ? ` · Пропусков: ${absCount}` : ''}
                              </div>
                              {absCount > 0 && (
                                <div style={{ marginTop: 5, height: 3, background: 'rgba(0,0,0,.07)', borderRadius: 2, overflow: 'hidden' }}>
                                  <div style={{ height: '100%', width: `${pct.toFixed(1)}%`, background: '#ff3b30', borderRadius: 2 }} />
                                </div>
                              )}
                            </div>
                            <div style={{ textAlign: 'right' as const, paddingLeft: 12 }}>
                              <div style={{ fontSize: '1rem', fontWeight: 700, color: '#007aff' }}>{currency}{fv(cash)}</div>
                              {card > 0 && <div style={{ fontSize: '.72rem', color: '#6e6e73', marginTop: 2 }}>карта: {currency}{fv(card)}</div>}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </>
              )
            })()}
          </div>
        )}

        {/* HOOKAH TAB */}
        {tab === 'hookah' && (
          <div style={S.comingSoon}>
            <div style={{ fontSize: '3rem', marginBottom: 16 }}>💨</div>
            <div style={{ fontWeight: 700, fontSize: '1.1rem', marginBottom: 8, color: '#1d1d1f' }}>SO Tobacco</div>
            <div style={{ color: '#6e6e73', fontSize: '.88rem', maxWidth: 260, textAlign: 'center' as const }}>Скоро здесь появится аналитика кальянных продаж и остатки склада табака из Syrve</div>
          </div>
        )}

      </div>

      {/* BOTTOM NAV */}
      <div style={S.bnav}>
        {([
          { id: 'period', icon: '📅', label: 'Период' },
          { id: 'kassa', icon: '🏧', label: 'Касса' },
          { id: 'sales', icon: '🛒', label: 'Продажи' },
          { id: 'salary', icon: '👥', label: 'Смены' },
          { id: 'hookah', icon: '💨', label: 'Кальян' },
        ] as const).map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{ ...S.bnavBtn, ...(tab === t.id ? S.bnavActive : {}) }}>
            <span style={{ fontSize: '1.3rem' }}>{t.icon}</span>
            <span style={{ fontSize: '.6rem', fontWeight: 600 }}>{t.label}</span>
          </button>
        ))}
      </div>

      {/* AI MODAL */}
      {showAI && (
        <div style={S.overlay} onClick={() => setShowAI(false)}>
          <div style={{ ...S.sheet, height: '80vh', display: 'flex', flexDirection: 'column' as const }} onClick={(e: any) => e.stopPropagation()}>
            <div style={S.handle} />
            <div style={{ padding: '12px 20px 0', fontWeight: 700, fontSize: '1rem', textAlign: 'center' as const, color: '#1d1d1f' }}>🤖 AI Ассистент</div>
            {!geminiKey ? (
              <div style={{ padding: 24, textAlign: 'center' as const, color: '#6e6e73' }}>
                <div style={{ fontSize: '2rem', marginBottom: 12 }}>🔑</div>
                <div style={{ marginBottom: 8 }}>Добавьте Gemini API ключ в Dashboard → Настройки</div>
                <div style={{ fontSize: '.8rem' }}>Получите бесплатно на aistudio.google.com</div>
              </div>
            ) : (
              <>
                <div style={{ flex: 1, overflowY: 'auto' as const, padding: '12px 16px', display: 'flex', flexDirection: 'column' as const, gap: 10 }}>
                  {chatMsgs.length === 0 && (
                    <div style={{ textAlign: 'center' as const, color: '#6e6e73', padding: '20px 0' }}>
                      <div style={{ fontSize: '1.5rem', marginBottom: 8 }}>💬</div>
                      <div style={{ fontSize: '.85rem' }}>Спросите что угодно о вашем бизнесе</div>
                      <div style={{ fontSize: '.78rem', color: '#aeaeb2', marginTop: 4 }}>«Где больше всего расходов?» «Как дела в этом месяце?»</div>
                    </div>
                  )}
                  {chatMsgs.map((m, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
                      <div style={{ maxWidth: '80%', padding: '10px 14px', borderRadius: m.role === 'user' ? '16px 16px 4px 16px' : '16px 16px 16px 4px', background: m.role === 'user' ? '#007aff' : '#f5f5f7', color: m.role === 'user' ? '#fff' : '#1d1d1f', fontSize: '.85rem', lineHeight: 1.5 }}>
                        {m.text}
                      </div>
                    </div>
                  ))}
                  {chatLoading && (
                    <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                      <div style={{ padding: '10px 14px', borderRadius: '16px 16px 16px 4px', background: '#f5f5f7', color: '#6e6e73', fontSize: '.85rem' }}>Думаю...</div>
                    </div>
                  )}
                </div>
                <div style={{ padding: '10px 16px 20px', display: 'flex', gap: 8 }}>
                  <input value={chatInput} onChange={e => setChatInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && sendMessage()} placeholder="Спросите о бизнесе..." style={{ flex: 1, padding: '11px 14px', borderRadius: 12, border: '0.5px solid rgba(0,0,0,.15)', fontSize: '.88rem', fontFamily: 'inherit', outline: 'none', color: '#1d1d1f' }} />
                  <button onClick={sendMessage} disabled={chatLoading} style={{ padding: '11px 18px', borderRadius: 12, background: '#007aff', color: '#fff', border: 'none', fontFamily: 'inherit', fontSize: '.88rem', fontWeight: 600, cursor: 'pointer' }}>→</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function StatCard({ label, value, color, small, sub }: { label: string; value: string; color?: string; small?: boolean; sub?: string }) {
  return (
    <div style={{ background: '#fff', borderRadius: 14, padding: small ? '12px 14px' : '14px 16px', boxShadow: '0 1px 4px rgba(0,0,0,.06)' }}>
      <div style={{ fontSize: '.7rem', color: '#6e6e73', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '.04em', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: small ? '.95rem' : '1.3rem', fontWeight: 700, color: color || '#1d1d1f' }}>{value}</div>
      {sub && <div style={{ fontSize: '.7rem', color: color || '#6e6e73', marginTop: 3 }}>{sub}</div>}
    </div>
  )
}

const S: Record<string, any> = {
  wrap: { minHeight: '100vh', background: '#f2f2f7', fontFamily: '-apple-system,BlinkMacSystemFont,sans-serif', WebkitFontSmoothing: 'antialiased', paddingBottom: 80 },
  header: { background: 'rgba(255,255,255,.92)', backdropFilter: 'blur(20px)', borderBottom: '0.5px solid rgba(0,0,0,.1)', padding: '0 16px', height: 52, display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky' as const, top: 0, zIndex: 100 },
  aiBtn: { padding: '6px 14px', borderRadius: 980, background: 'rgba(0,122,255,.1)', color: '#007aff', border: 'none', fontFamily: 'inherit', fontSize: '.8rem', fontWeight: 600, cursor: 'pointer' },
  logoutBtn: { background: 'none', border: 'none', color: '#ff3b30', cursor: 'pointer', fontSize: '.8rem', fontFamily: 'inherit' },
  scroll: { maxWidth: 600, margin: '0 auto', padding: '16px 16px 16px' },
  center: { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: '-apple-system,sans-serif', color: '#6e6e73' },
  segControl: { display: 'flex', background: 'rgba(118,118,128,.12)', borderRadius: 10, padding: 2, marginBottom: 16 },
  segBtn: { flex: 1, padding: '7px', borderRadius: 8, border: 'none', fontFamily: 'inherit', fontSize: '.82rem', fontWeight: 500, cursor: 'pointer', background: 'transparent', color: '#6e6e73', transition: 'all .15s' },
  segActive: { background: '#fff', color: '#1d1d1f', fontWeight: 600, boxShadow: '0 1px 3px rgba(0,0,0,.1)' },
  dateRow: { display: 'flex', alignItems: 'center', gap: 12, background: '#fff', borderRadius: 14, padding: '12px 16px', marginBottom: 16, boxShadow: '0 1px 4px rgba(0,0,0,.06)' },
  dateNav: { width: 38, height: 38, borderRadius: '50%', background: 'rgba(118,118,128,.12)', border: 'none', fontSize: '1.2rem', color: '#3a3a3c', cursor: 'pointer', fontFamily: 'inherit' },
  grid2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 },
  secLabel: { fontSize: '.75rem', fontWeight: 600, color: '#6d6d72', textTransform: 'uppercase' as const, letterSpacing: '.05em', padding: '12px 4px 6px' },
  card: { background: '#fff', borderRadius: 16, overflow: 'hidden', marginBottom: 12, boxShadow: '0 1px 4px rgba(0,0,0,.06)' },
  lrow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 16px' },
  lname: { fontSize: '.88rem', color: '#1d1d1f', flex: 1, paddingRight: 8 },
  lval: { fontSize: '.88rem', fontWeight: 600 },
  cellLabel: { fontSize: '.68rem', color: '#6e6e73', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '.04em', marginBottom: 4 },
  empty: { textAlign: 'center' as const, padding: '48px 20px', color: '#aeaeb2', fontSize: '.88rem' },
  comingSoon: { textAlign: 'center' as const, padding: '80px 20px', color: '#aeaeb2' },
  bnav: { position: 'fixed' as const, bottom: 0, left: 0, right: 0, background: 'rgba(248,248,252,.97)', backdropFilter: 'blur(20px)', borderTop: '0.5px solid rgba(0,0,0,.1)', display: 'flex', alignItems: 'flex-start', paddingTop: 10, paddingBottom: 'env(safe-area-inset-bottom, 10px)', zIndex: 100 },
  bnavBtn: { flex: 1, display: 'flex', flexDirection: 'column' as const, alignItems: 'center', gap: 3, cursor: 'pointer', color: '#aeaeb2', border: 'none', background: 'none', fontFamily: 'inherit', padding: 0 },
  bnavActive: { color: '#007aff' },
  overlay: { position: 'fixed' as const, inset: 0, background: 'rgba(0,0,0,.4)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 500 },
  sheet: { background: '#fff', borderRadius: '22px 22px 0 0', width: '100%', maxWidth: 480, paddingBottom: 8 },
  handle: { width: 36, height: 4, background: 'rgba(0,0,0,.15)', borderRadius: 2, margin: '12px auto 0' },
}
