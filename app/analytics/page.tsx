'use client'
import { useEffect, useState, useRef } from 'react'

let Chart: any = null
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

function fv(v: number) { return v.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }
function fmtDate(d: Date) { return d.toISOString().split('T')[0] }
function dd(s: string) { return s.slice(8,10)+'.'+s.slice(5,7) }
const MRU = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь']
const DOW = ['Вс','Пн','Вт','Ср','Чт','Пт','Сб']
const COLORS = ['#007aff','#ff3b30','#34c759','#ff9500','#af52de','#00c7be','#ff6b35','#5856d6']

type Shift = { id:string; date:string; opening_balance:number; income:number; total_expense:number; inkassation:number; closing_balance:number }
type Expense = { id:string; shift_id:string; category_name:string; amount:number; note:string; employee_id:string|null }
type Inkassation = { id:string; shift_id:string; date:string; amount:number; expense:number; reason:string; balance:number }
type Employee = { id:string; name:string; salary:number; deduct_per_absence:number }
type CardAmount = { employee_id:string; card_amount:number }
type Absence = { employee_id:string; date:string }
type ChatMsg = { role:'user'|'ai'; text:string }

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
  const [prevShifts, setPrevShifts] = useState<Shift[]>([])
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [inkassations, setInkassations] = useState<Inkassation[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [cardAmounts, setCardAmounts] = useState<CardAmount[]>([])
  const [absences, setAbsences] = useState<Absence[]>([])
  const [loading, setLoading] = useState(true)
  const [showAI, setShowAI] = useState(false)
  const [showMonthPicker, setShowMonthPicker] = useState(false)
  const [chatMsgs, setChatMsgs] = useState<ChatMsg[]>([])
  const [chatInput, setChatInput] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const [isDark, setIsDark] = useState(false)
  const kassaChartRef = useRef<any>(null)
  const kassaChartInst = useRef<any>(null)
  const inkChartRef = useRef<any>(null)
  const inkChartInst = useRef<any>(null)
  const donutRef = useRef<any>(null)
  const donutInst = useRef<any>(null)

  useEffect(() => {
    import('chart.js').then(m => {
      Chart = m.Chart
      m.Chart.register(...m.registerables)
    })
    const dark = localStorage.getItem('so_ana_dark') === '1'
    setIsDark(dark)
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) { window.location.href = '/auth/login'; return }
      setUser(data.user)
      const { data: profile } = await supabase.from('profiles').select('restaurant_id').eq('id', data.user.id).single()
      if (!profile) return
      setRestaurantId(profile.restaurant_id)
      await loadAll(profile.restaurant_id, new Date())
    })
  }, [])

  const loadAll = async (rid: string, date: Date) => {
    setLoading(true)
    const monthStart = fmtDate(new Date(date.getFullYear(), date.getMonth(), 1))
    const monthEnd = fmtDate(new Date(date.getFullYear(), date.getMonth()+1, 0))
    const prevMonthStart = fmtDate(new Date(date.getFullYear(), date.getMonth()-1, 1))
    const prevMonthEnd = fmtDate(new Date(date.getFullYear(), date.getMonth(), 0))

    const [shiftsRes, prevShiftsRes, settingsRes, empsRes, cardsRes, absRes] = await Promise.all([
      supabase.from('shifts').select('*').eq('restaurant_id', rid).gte('date', monthStart).lte('date', monthEnd).order('date'),
      supabase.from('shifts').select('*').eq('restaurant_id', rid).gte('date', prevMonthStart).lte('date', prevMonthEnd).order('date'),
      supabase.from('restaurant_settings').select('currency,gemini_api_key').eq('restaurant_id', rid).maybeSingle(),
      supabase.from('employees').select('id,name,salary,deduct_per_absence').eq('restaurant_id', rid).eq('is_active', true).order('name'),
      supabase.from('monthly_card_amounts').select('employee_id,card_amount').eq('restaurant_id', rid).eq('month', fmtDate(date).slice(0,7)),
      supabase.from('shift_absences').select('employee_id,date').eq('restaurant_id', rid).gte('date', monthStart).lte('date', monthEnd)
    ])

    const shiftList = shiftsRes.data || []
    setShifts(shiftList)
    setPrevShifts(prevShiftsRes.data || [])
    if (settingsRes.data) { setCurrency(settingsRes.data.currency || '€'); setGeminiKey(settingsRes.data.gemini_api_key || '') }
    setEmployees(empsRes.data || [])
    setCardAmounts(cardsRes.data || [])
    setAbsences(absRes.data || [])

    if (shiftList.length > 0) {
      const shiftIds = shiftList.map((s:any) => s.id)
      const [expsRes, inkRes] = await Promise.all([
        supabase.from('shift_expenses').select('*').in('shift_id', shiftIds),
        supabase.from('inkassations').select('*').in('shift_id', shiftIds).order('date')
      ])
      setExpenses(expsRes.data || [])
      setInkassations(inkRes.data || [])
    }
    setLoading(false)
  }

  const toggleDark = () => {
    const d = !isDark
    setIsDark(d)
    localStorage.setItem('so_ana_dark', d ? '1' : '0')
  }

  const getShiftByDate = (dateStr: string) => shifts.find(s => s.date === dateStr)
  const getExpsByShift = (shiftId: string) => expenses.filter(e => e.shift_id === shiftId && !e.employee_id)
  const getInkByShift = (shiftId: string) => inkassations.find(i => i.shift_id === shiftId)

  const totalIncome = shifts.reduce((s, sh) => s + (sh.income||0), 0)
  const totalExpense = shifts.reduce((s, sh) => s + (sh.total_expense||0), 0)
  const totalInkass = inkassations.reduce((s, i) => s + (i.amount||0), 0)
  const lastShift = shifts[shifts.length-1]
  const prevIncome = prevShifts.reduce((s, sh) => s + (sh.income||0), 0)
  const prevExpense = prevShifts.reduce((s, sh) => s + (sh.total_expense||0), 0)

  const pctChange = (cur: number, prev: number) => {
    if (!prev) return null
    const p = ((cur - prev) / prev * 100)
    return p
  }

  // Week helpers
  const getWeekRange = (d: Date) => {
    const start = new Date(d)
    const day = start.getDay()
    start.setDate(start.getDate() - (day === 0 ? 6 : day - 1))
    const end = new Date(start)
    end.setDate(start.getDate() + 6)
    return { start, end }
  }
  const getWeekShifts = (d: Date) => {
    const { start, end } = getWeekRange(d)
    return shifts.filter(s => s.date >= fmtDate(start) && s.date <= fmtDate(end))
  }
  const getPrevWeekShifts = (d: Date) => {
    const { start } = getWeekRange(d)
    const prevEnd = new Date(start); prevEnd.setDate(prevEnd.getDate()-1)
    const prevStart = new Date(prevEnd); prevStart.setDate(prevStart.getDate()-6)
    return [...shifts, ...prevShifts].filter(s => s.date >= fmtDate(prevStart) && s.date <= fmtDate(prevEnd))
  }

  const sendMessage = async () => {
    if (!chatInput.trim() || !geminiKey) return
    const userMsg = chatInput.trim()
    setChatInput('')
    setChatMsgs(prev => [...prev, { role: 'user', text: userMsg }])
    setChatLoading(true)
    const catMap: Record<string,number> = {}
    expenses.filter(e => !e.employee_id).forEach(e => { catMap[e.category_name] = (catMap[e.category_name]||0) + e.amount })
    const context = `Ты AI-ассистент ресторана. Данные за ${MRU[currentDate.getMonth()]} ${currentDate.getFullYear()}:
Доход: ${currency}${fv(totalIncome)}, Расходы: ${currency}${fv(totalExpense)}, Инкассации: ${currency}${fv(totalInkass)}, Касса: ${currency}${fv(lastShift?.closing_balance||0)}, Смен: ${shifts.length}
Топ расходов: ${Object.entries(catMap).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([n,v])=>`${n}: ${currency}${fv(v)}`).join(', ')}
Отвечай кратко на русском.`
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: context + '\nВопрос: ' + userMsg }] }] })
      })
      const data = await res.json()
      setChatMsgs(prev => [...prev, { role: 'ai', text: data.candidates?.[0]?.content?.parts?.[0]?.text || 'Нет ответа' }])
    } catch { setChatMsgs(prev => [...prev, { role: 'ai', text: 'Ошибка подключения' }]) }
    setChatLoading(false)
  }

  const bg = isDark ? '#1c1c1e' : '#f2f2f7'
  const surface = isDark ? '#2c2c2e' : '#fff'
  const text = isDark ? '#f2f2f7' : '#1c1c1e'
  const t3 = isDark ? '#aeaeb2' : '#6d6d72'
  const t4 = isDark ? '#636366' : '#aeaeb2'
  const border = isDark ? 'rgba(255,255,255,.15)' : 'rgba(60,60,67,.13)'
  const b2 = isDark ? 'rgba(255,255,255,.08)' : 'rgba(60,60,67,.07)'
  const s2 = isDark ? 'rgba(255,255,255,.1)' : 'rgba(118,118,128,.12)'
  const sh = isDark ? '0 1px 3px rgba(0,0,0,.3),0 4px 16px rgba(0,0,0,.2)' : '0 1px 3px rgba(0,0,0,.08),0 4px 16px rgba(0,0,0,.05)'
  const hbg = isDark ? 'rgba(28,28,30,.96)' : 'rgba(242,242,247,.95)'
  const nbg = isDark ? 'rgba(28,28,30,.97)' : 'rgba(248,248,252,.97)'

  if (loading) return (
    <div style={{ minHeight:'100vh', background: bg, display:'flex', alignItems:'center', justifyContent:'center', flexDirection:'column', gap:14 }}>
      <div style={{ width:28, height:28, border:`2.5px solid ${s2}`, borderTopColor:'#007aff', borderRadius:'50%', animation:'spin .7s linear infinite' }} />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )

  const Stat = ({ label, val, color, sub, sm }: { label:string; val:string; color?:string; sub?:string; sm?:boolean }) => (
    <div style={{ background:surface, borderRadius:14, padding:'14px 12px', boxShadow:sh }}>
      <div style={{ fontSize:10, color:t3, fontWeight:600, textTransform:'uppercase' as const, letterSpacing:.4, marginBottom:5, whiteSpace:'nowrap' as const, overflow:'hidden', textOverflow:'ellipsis' }}>{label}</div>
      <div style={{ fontSize:sm?16:22, fontWeight:700, letterSpacing:'-.5px', lineHeight:1, color:color||text }}>{val}</div>
      {sub && <div style={{ fontSize:11, color:t4, marginTop:4 }}>{sub}</div>}
    </div>
  )

  const SecLabel = ({ children }: any) => (
    <div style={{ fontSize:12, fontWeight:600, color:t3, textTransform:'uppercase' as const, letterSpacing:.5, padding:'16px 4px 8px' }}>{children}</div>
  )

  const Card = ({ children, style={} }: any) => (
    <div style={{ background:surface, borderRadius:16, overflow:'hidden', marginBottom:12, boxShadow:sh, ...style }}>{children}</div>
  )

  const LRow = ({ name, val, color }: { name:string; val:string; color?:string }) => (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'12px 16px', borderBottom:`1px solid ${b2}` }}>
      <div style={{ fontSize:15, color:text, flex:1, paddingRight:8, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' as const }}>{name}</div>
      <div style={{ fontSize:15, fontWeight:600, letterSpacing:'-.3px', color:color||text }}>{val}</div>
    </div>
  )

  const ProgItem = ({ name, val, max, color }: { name:string; val:number; max:number; color:string }) => (
    <div style={{ padding:'10px 16px', borderBottom:`1px solid ${b2}` }}>
      <div style={{ display:'flex', justifyContent:'space-between', marginBottom:6 }}>
        <div style={{ fontSize:15, color:text, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' as const, maxWidth:'65%' }}>{name}</div>
        <div style={{ fontSize:15, fontWeight:600, color:text }}>{currency}{fv(val)}</div>
      </div>
      <div style={{ height:4, background:s2, borderRadius:2, overflow:'hidden' }}>
        <div style={{ height:'100%', width:`${Math.min(val/max*100,100).toFixed(1)}%`, background:color, borderRadius:2, transition:'width 1s cubic-bezier(.16,1,.3,1)' }} />
      </div>
    </div>
  )

  const renderPeriod = () => {
    if (periodMode === 'day') {
      const dateStr = fmtDate(currentDate)
      const shift = getShiftByDate(dateStr)
      if (!shift) return <div style={{ padding:'48px 20px', textAlign:'center' as const, color:t4, fontSize:15 }}>Нет данных за {dd(dateStr)}</div>
      const exps = getExpsByShift(shift.id)
      const ink = getInkByShift(shift.id)
      const dayExp = exps.reduce((s,e)=>s+e.amount, 0)
      return (
        <div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:12 }}>
            <Stat label="Расход дня" val={`${currency}${fv(dayExp)}`} color="#ff3b30" />
            <Stat label="Отсутствуют" val={String(absences.filter(a=>a.date===dateStr).length)} color="#ff3b30" />
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:10, marginBottom:12 }}>
            <Stat label="Вход" val={`${currency}${fv(shift.opening_balance)}`} color="#007aff" sm />
            <Stat label="Доход" val={`${currency}${fv(shift.income)}`} color="#34c759" sm />
            <Stat label="Расход" val={`${currency}${fv(shift.total_expense)}`} color="#ff3b30" sm />
            <Stat label="Касса" val={`${currency}${fv(shift.closing_balance)}`} color="#007aff" sm />
          </div>
          {exps.length > 0 && (<>
            <SecLabel>Расходы</SecLabel>
            <Card>
              {exps.map((e,i) => (
                <div key={e.id} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'12px 16px', borderBottom: i<exps.length-1?`1px solid ${b2}`:'none' }}>
                  <div style={{ fontSize:15, color:text, flex:1 }}>{e.category_name}{e.note?` · ${e.note}`:''}</div>
                  <div style={{ fontSize:15, fontWeight:600, color:'#ff3b30' }}>−{currency}{fv(e.amount)}</div>
                </div>
              ))}
            </Card>
          </>)}
          {ink && (<>
            <SecLabel>Инкассация</SecLabel>
            <Card>
              <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:'1px', background:b2 }}>
                {[
                  { l:'Приход', v:ink.amount>0?`${currency}${fv(ink.amount)}`:'—', c:'#34c759' },
                  { l:'Расход', v:ink.expense>0?`${currency}${fv(ink.expense)}`:'—', c:'#ff3b30' },
                  { l:'Причина', v:ink.reason||'—', c:t3, small:true },
                  { l:'Итог', v:`${currency}${fv(ink.balance)}`, c:'#ff9500' },
                ].map(cell => (
                  <div key={cell.l} style={{ background:surface, padding:'10px 8px' }}>
                    <div style={{ fontSize:9, color:t3, textTransform:'uppercase' as const, letterSpacing:.3, marginBottom:4, fontWeight:600 }}>{cell.l}</div>
                    <div style={{ fontSize:cell.small?12:15, fontWeight:700, color:cell.c, lineHeight:1.3 }}>{cell.v}</div>
                  </div>
                ))}
              </div>
            </Card>
          </>)}
        </div>
      )
    }

    if (periodMode === 'week') {
      const weekShifts = getWeekShifts(currentDate)
      const prevWeekShifts = getPrevWeekShifts(currentDate)
      const wIncome = weekShifts.reduce((s,sh)=>s+sh.income,0)
      const wExpense = weekShifts.reduce((s,sh)=>s+sh.total_expense,0)
      const pwIncome = prevWeekShifts.reduce((s,sh)=>s+sh.income,0)
      const pwExpense = prevWeekShifts.reduce((s,sh)=>s+sh.total_expense,0)
      const incPct = pctChange(wIncome, pwIncome)
      const expPct = pctChange(wExpense, pwExpense)
      const { start, end } = getWeekRange(currentDate)

      // Expense breakdown for week
      const wExpIds = weekShifts.map(s=>s.id)
      const wExps = expenses.filter(e => wExpIds.includes(e.shift_id) && !e.employee_id)
      const catMap: Record<string,number> = {}
      wExps.forEach(e => { catMap[e.category_name] = (catMap[e.category_name]||0) + e.amount })
      const sorted = Object.entries(catMap).sort((a,b)=>b[1]-a[1])
      const maxVal = sorted[0]?.[1] || 1

      return (
        <div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:12 }}>
            <Stat label={`Итог за неделю`} val={`${currency}${fv(wIncome)}`} color="#34c759"
              sub={incPct !== null ? `${incPct >= 0 ? '↑' : '↓'} ${Math.abs(incPct).toFixed(1)}% vs пред.` : undefined} />
            <Stat label="Расходы" val={`${currency}${fv(wExpense)}`} color="#ff3b30"
              sub={expPct !== null ? `${expPct >= 0 ? '↑' : '↓'} ${Math.abs(expPct).toFixed(1)}% vs пред.` : undefined} />
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:10, marginBottom:12 }}>
            <Stat label="Смен" val={String(weekShifts.length)} sm />
            <Stat label="Касса" val={`${currency}${fv(weekShifts[weekShifts.length-1]?.closing_balance||0)}`} color="#007aff" sm />
            <Stat label="Инкасс" val={`${currency}${fv(inkassations.filter(i=>weekShifts.map(s=>s.id).includes(i.shift_id)).reduce((s,i)=>s+i.amount,0))}`} color="#ff9500" sm />
          </div>

          {sorted.length > 0 && (<>
            <SecLabel>Структура расходов</SecLabel>
            <Card>
              {sorted.map(([name,amt],i) => (
                <ProgItem key={name} name={name} val={amt} max={maxVal} color={COLORS[i%COLORS.length]} />
              ))}
            </Card>
          </>)}

          <SecLabel>По дням</SecLabel>
          <Card>
            <div style={{ display:'grid', gridTemplateColumns:'50px 1fr 1fr 1fr 1fr', background:isDark?'rgba(255,255,255,.06)':'rgba(0,0,0,.04)', padding:'7px 14px', gap:4 }}>
              {['Дата','Вход','Доход','Расход','Касса'].map(h=><div key={h} style={{ fontSize:10, color:t4, fontWeight:600, textTransform:'uppercase' as const }}>{h}</div>)}
            </div>
            {weekShifts.length === 0 ? <div style={{ padding:'24px', textAlign:'center' as const, color:t4 }}>Нет данных</div> :
              weekShifts.map(s => (
                <div key={s.id} style={{ display:'grid', gridTemplateColumns:'50px 1fr 1fr 1fr 1fr', padding:'10px 14px', gap:4, borderBottom:`1px solid ${b2}`, fontSize:13, color:text }}>
                  <span style={{ color:t3 }}>{dd(s.date)}</span>
                  <span style={{ color:'#007aff' }}>{s.opening_balance>0?`${currency}${fv(s.opening_balance)}`:'—'}</span>
                  <span style={{ color:'#34c759', fontWeight:600 }}>{s.income>0?`${currency}${fv(s.income)}`:'—'}</span>
                  <span style={{ color:'#ff3b30' }}>{s.total_expense>0?`${currency}${fv(s.total_expense)}`:'—'}</span>
                  <span style={{ color:'#007aff', fontWeight:700 }}>{currency}{fv(s.closing_balance)}</span>
                </div>
              ))
            }
          </Card>
        </div>
      )
    }

    if (periodMode === 'month') {
      const incPct = pctChange(totalIncome, prevIncome)
      const expPct = pctChange(totalExpense, prevExpense)
      const catMap: Record<string,number> = {}
      expenses.filter(e=>!e.employee_id).forEach(e=>{ catMap[e.category_name]=(catMap[e.category_name]||0)+e.amount })
      const sorted = Object.entries(catMap).sort((a,b)=>b[1]-a[1])
      const top5 = sorted.slice(0,5)
      const maxVal = sorted[0]?.[1]||1
      return (
        <div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:12 }}>
            <Stat label="Итого за месяц" val={`${currency}${fv(totalIncome)}`} color="#34c759"
              sub={incPct!==null?`${incPct>=0?'↑':'↓'} ${Math.abs(incPct).toFixed(1)}% vs пред.`:undefined} />
            <Stat label="Расходы" val={`${currency}${fv(totalExpense)}`} color="#ff3b30"
              sub={expPct!==null?`${expPct>=0?'↑':'↓'} ${Math.abs(expPct).toFixed(1)}% vs пред.`:undefined} />
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:10, marginBottom:12 }}>
            <Stat label="Смен" val={String(shifts.length)} sm />
            <Stat label="Инкасс" val={`${currency}${fv(totalInkass)}`} color="#ff9500" sm />
            <Stat label="Касса" val={`${currency}${fv(lastShift?.closing_balance||0)}`} color="#007aff" sm />
          </div>
          {sorted.length > 0 && (<>
            <SecLabel>Структура</SecLabel>
            <Card>
              <div style={{ display:'flex', alignItems:'center', gap:16, padding:16 }}>
                <canvas ref={donutRef} width={120} height={120} />
                <div style={{ flex:1, display:'flex', flexDirection:'column' as const, gap:7 }}>
                  {top5.map(([name,amt],i) => (
                    <div key={name} style={{ display:'flex', alignItems:'center', gap:8 }}>
                      <div style={{ width:9, height:9, borderRadius:'50%', background:COLORS[i], flexShrink:0 }} />
                      <div style={{ fontSize:12, color:text, flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' as const }}>{name}</div>
                      <div style={{ fontSize:12, fontWeight:600, color:text }}>{currency}{fv(amt)}</div>
                    </div>
                  ))}
                </div>
              </div>
            </Card>
            <SecLabel>Топ расходов</SecLabel>
            <Card>
              {top5.map(([name,amt],i) => (
                <ProgItem key={name} name={name} val={amt} max={maxVal} color={COLORS[i%COLORS.length]} />
              ))}
            </Card>
            <SecLabel>Все категории</SecLabel>
            <Card>
              {sorted.map(([ name,amt],i) => (
                <div key={name} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'12px 16px', borderBottom:i<sorted.length-1?`1px solid ${b2}`:'none' }}>
                  <div style={{ fontSize:15, color:text }}>{name}</div>
                  <div style={{ fontSize:15, fontWeight:600, color:'#ff3b30' }}>{currency}{fv(amt)}</div>
                </div>
              ))}
            </Card>
          </>)}
        </div>
      )
    }
    return null
  }

  const renderKassa = () => {
    if (kassaMode === 'kassa') {
      const lastBal = lastShift?.closing_balance || 0
      const lastInc = [...shifts].reverse().find(s=>s.income>0)
      return (
        <div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:12 }}>
            <Stat label="Остаток" val={`${currency}${fv(lastBal)}`} color="#007aff" />
            <Stat label="Доход посл." val={`${currency}${fv(lastInc?.income||0)}`} color="#34c759"
              sub={lastInc?dd(lastInc.date):undefined} />
          </div>
          <SecLabel>Баланс кассы</SecLabel>
          <Card>
            <div style={{ padding:'12px 14px 14px' }}>
              <canvas ref={kassaChartRef} style={{ maxHeight:140 }} />
            </div>
          </Card>
          <SecLabel>По дням</SecLabel>
          <Card>
            <div style={{ display:'grid', gridTemplateColumns:'50px 1fr 1fr 1fr 1fr', background:isDark?'rgba(255,255,255,.06)':'rgba(0,0,0,.04)', padding:'7px 14px', gap:4 }}>
              {['Дата','Вход','Доход','Расход','Касса'].map(h=><div key={h} style={{ fontSize:10, color:t4, fontWeight:600, textTransform:'uppercase' as const }}>{h}</div>)}
            </div>
            {shifts.filter(s=>s.income>0||s.total_expense>0).map(s=>(
              <div key={s.id} style={{ display:'grid', gridTemplateColumns:'50px 1fr 1fr 1fr 1fr', padding:'11px 14px', gap:4, borderBottom:`1px solid ${b2}`, fontSize:13, color:text }}>
                <span style={{ color:t3 }}>{dd(s.date)}</span>
                <span style={{ color:'#007aff' }}>{s.opening_balance>0?`${currency}${fv(s.opening_balance)}`:'—'}</span>
                <span style={{ color:'#34c759', fontWeight:600 }}>{s.income>0?`${currency}${fv(s.income)}`:'—'}</span>
                <span style={{ color:'#ff3b30' }}>{s.total_expense>0?`${currency}${fv(s.total_expense)}`:'—'}</span>
                <span style={{ color:'#007aff', fontWeight:700 }}>{currency}{fv(s.closing_balance)}</span>
              </div>
            ))}
          </Card>
        </div>
      )
    }

    // INKASS
    const now = new Date()
    const dIM = new Date(now.getFullYear(), now.getMonth()+1, 0).getDate()
    const dom = now.getDate()
    const lastInk = inkassations[inkassations.length-1]
    const inkBalance = lastInk?.balance || 0
    const totalSalary = employees.reduce((s,e)=>s+e.salary, 0)
    const salToday = Math.round(totalSalary/dIM*dom)
    const diff = inkBalance - salToday

    return (
      <div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:12 }}>
          <Stat label="Баланс" val={`${currency}${fv(inkBalance)}`} color="#ff9500" />
          <Stat label="ЗП на сегодня" val={`${currency}${fv(salToday)}`} color={diff>=0?'#34c759':'#ff3b30'}
            sub={`${diff>=0?'Опережаем':'Отстаём'} ${currency}${fv(Math.abs(diff))}`} />
        </div>
        <SecLabel>Динамика</SecLabel>
        <Card>
          <div style={{ padding:'12px 14px 14px' }}>
            <canvas ref={inkChartRef} style={{ maxHeight:140 }} />
          </div>
        </Card>
        <SecLabel>История</SecLabel>
        <Card>
          {inkassations.length===0
            ? <div style={{ padding:'32px 20px', textAlign:'center' as const, color:t4 }}>Нет инкассаций</div>
            : (<>
              <div style={{ display:'grid', gridTemplateColumns:'44px 1fr 1fr 1fr 1fr', background:isDark?'rgba(255,255,255,.06)':'rgba(0,0,0,.04)', padding:'7px 14px', gap:4 }}>
                {['Дата','Сумма','Расход','Причина','Итог'].map(h=><div key={h} style={{ fontSize:10, color:t4, fontWeight:600, textTransform:'uppercase' as const }}>{h}</div>)}
              </div>
              {inkassations.map(ink=>(
                <div key={ink.id} style={{ display:'grid', gridTemplateColumns:'44px 1fr 1fr 1fr 1fr', padding:'11px 14px', gap:4, borderBottom:`1px solid ${b2}`, fontSize:13, color:text }}>
                  <span style={{ color:t3 }}>{dd(ink.date)}</span>
                  <span style={{ color:'#34c759', fontWeight:600 }}>{ink.amount>0?`${currency}${fv(ink.amount)}`:'—'}</span>
                  <span style={{ color:'#ff3b30' }}>{ink.expense>0?`${currency}${fv(ink.expense)}`:'—'}</span>
                  <span style={{ color:t4, fontSize:11 }}>{ink.reason||'—'}</span>
                  <span style={{ color:'#ff9500', fontWeight:600 }}>{currency}{fv(ink.balance)}</span>
                </div>
              ))}
            </>)
          }
        </Card>
      </div>
    )
  }

  const renderSalary = () => {
    const totalFOT = employees.reduce((s,e)=>s+e.salary,0)
    const totalCard = cardAmounts.reduce((s,c)=>s+c.card_amount,0)
    const totalCash = employees.reduce((s,emp)=>{
      const absCount = absences.filter(a=>a.employee_id===emp.id).length
      const card = cardAmounts.find(c=>c.employee_id===emp.id)?.card_amount||0
      return s+(emp.salary-absCount*emp.deduct_per_absence-card)
    },0)
    return (
      <div>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:10, marginBottom:12 }}>
          <Stat label="ФОТ" val={`${currency}${fv(totalFOT)}`} color="#007aff" sm />
          <Stat label="Нал" val={`${currency}${fv(totalCash)}`} color="#ff9500" sm />
          <Stat label="Карта" val={`${currency}${fv(totalCard)}`} color="#af52de" sm />
        </div>
        <SecLabel>Сотрудники</SecLabel>
        <Card>
          {employees.map((emp,i)=>{
            const absCount = absences.filter(a=>a.employee_id===emp.id).length
            const deduct = absCount*emp.deduct_per_absence
            const card = cardAmounts.find(c=>c.employee_id===emp.id)?.card_amount||0
            const cash = emp.salary-deduct-card
            const pct = Math.min(absCount/22*100,100)
            return (
              <div key={emp.id} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'10px 16px', borderBottom:i<employees.length-1?`1px solid ${b2}`:'none' }}>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:15, color:text, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' as const }}>{emp.name}</div>
                  <div style={{ fontSize:11, color:t3, marginTop:1 }}>ЗП: {currency}{fv(emp.salary)}{deduct>0?` · −${currency}${fv(deduct)}`:''}{absCount>0?` · Пропусков: ${absCount}`:''}</div>
                  {absCount>0&&<div style={{ marginTop:5, height:3, background:s2, borderRadius:2, overflow:'hidden' }}><div style={{ height:'100%', width:`${pct.toFixed(1)}%`, background:'#ff3b30', borderRadius:2, transition:'width 1s' }} /></div>}
                </div>
                <div style={{ textAlign:'right' as const, flexShrink:0, paddingLeft:12 }}>
                  <div style={{ fontSize:17, fontWeight:700, color:'#007aff', letterSpacing:'-.4px' }}>{currency}{fv(cash)}</div>
                  {card>0&&<div style={{ fontSize:11, color:t4, marginTop:1 }}>карта: {currency}{fv(card)}</div>}
                </div>
              </div>
            )
          })}
        </Card>
      </div>
    )
  }

  // Draw kassa chart
  useEffect(() => {
    if (tab !== 'kassa' || kassaMode !== 'kassa') return
    const filled = shifts.filter(s => s.income > 0 || s.total_expense > 0)
    if (!filled.length || !kassaChartRef.current || !Chart) return
    setTimeout(() => {
      if (kassaChartInst.current) kassaChartInst.current.destroy()
      kassaChartInst.current = new Chart(kassaChartRef.current, {
        type: 'line',
        data: {
          labels: filled.map(s => dd(s.date)),
          datasets: [{
            data: filled.map(s => s.closing_balance),
            borderColor: '#007aff', backgroundColor: 'rgba(0,122,255,.07)',
            borderWidth: 2, pointRadius: 2, fill: true, tension: .4
          }]
        },
        options: { responsive: true, plugins: { legend: { display: false } },
          scales: {
            x: { ticks: { color: '#aeaeb2', font: { size: 9 }, maxTicksLimit: 8 }, grid: { color: 'rgba(60,60,67,.05)' } },
            y: { ticks: { color: '#aeaeb2', font: { size: 9 }, callback: (v: any) => currency + Math.round(v) }, grid: { color: 'rgba(60,60,67,.05)' } }
          }
        }
      })
    }, 100)
  }, [tab, kassaMode, shifts])

  // Draw inkass chart
  useEffect(() => {
    if (tab !== 'kassa' || kassaMode !== 'inkass') return
    if (!inkassations.length || !inkChartRef.current || !Chart) return
    setTimeout(() => {
      if (inkChartInst.current) inkChartInst.current.destroy()
      const filled = inkassations.filter(i => i.amount > 0 || i.balance > 0)
      const maxT = Math.max(...filled.map(i => i.balance).filter(v => v > 0), 1)
      inkChartInst.current = new Chart(inkChartRef.current, {
        type: 'line',
        data: {
          labels: filled.map(i => dd(i.date)),
          datasets: [{
            data: filled.map(i => i.balance),
            borderColor: '#ff9500', backgroundColor: 'rgba(255,149,0,.08)',
            borderWidth: 2, pointRadius: 3, fill: true, tension: .4
          }]
        },
        options: { responsive: true, plugins: { legend: { display: false } },
          scales: {
            x: { ticks: { color: '#aeaeb2', font: { size: 9 }, maxTicksLimit: 8 }, grid: { color: 'rgba(60,60,67,.05)' } },
            y: { min: 0, suggestedMax: maxT * 1.15, ticks: { color: '#aeaeb2', font: { size: 9 }, callback: (v: any) => currency + Math.round(v) }, grid: { color: 'rgba(60,60,67,.05)' } }
          }
        }
      })
    }, 100)
  }, [tab, kassaMode, inkassations])

  // Draw donut chart for month
  useEffect(() => {
    if (tab !== 'period' || periodMode !== 'month') return
    if (!donutRef.current || !Chart) return
    const catMap: Record<string,number> = {}
    expenses.filter(e => !e.employee_id).forEach(e => { catMap[e.category_name] = (catMap[e.category_name]||0) + e.amount })
    const top5 = Object.entries(catMap).sort((a,b) => b[1]-a[1]).slice(0,5)
    if (!top5.length) return
    setTimeout(() => {
      if (donutInst.current) donutInst.current.destroy()
      donutInst.current = new Chart(donutRef.current, {
        type: 'doughnut',
        data: {
          labels: top5.map(i => i[0]),
          datasets: [{ data: top5.map(i => i[1]), backgroundColor: COLORS.slice(0,5), borderWidth: 0, hoverOffset: 4 }]
        },
        options: { responsive: false, cutout: '68%', plugins: { legend: { display: false } } }
      })
    }, 100)
  }, [tab, periodMode, expenses])

  const TABS = [
    { id:'period', label:'Период', icon:<svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24" width="26" height="26"><rect x="3" y="4" width="18" height="18" rx="3"/><path d="M16 2v4M8 2v4M3 10h18"/></svg> },
    { id:'kassa', label:'Касса', icon:<svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24" width="26" height="26"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 3H8L2 7h20z"/></svg> },
    { id:'sales', label:'Продажи', icon:<svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24" width="26" height="26"><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 01-8 0"/></svg> },
    { id:'salary', label:'Смены', icon:<svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24" width="26" height="26"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg> },
    { id:'hookah', label:'Кальян', icon:<svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24" width="26" height="26"><path d="M12 2c-1 0-2 1-2 3 0 1 1 2 2 2s2-1 2-2c0-2-1-3-2-3z"/><path d="M10 7c-2 0-3 2-3 4h10c0-2-1-4-3-4h-4z"/><path d="M7 11l-2 4h14l-2-4"/><path d="M5 15c-2 2-2 4 0 5h14c2-1 2-3 0-5"/><line x1="9" y1="15" x2="9" y2="20"/><line x1="15" y1="15" x2="15" y2="20"/></svg> },
  ] as const

  return (
    <div style={{ height:'100vh', overflow:'hidden', background:bg, fontFamily:"-apple-system,BlinkMacSystemFont,'SF Pro Text',sans-serif", WebkitFontSmoothing:'antialiased' }}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}} @keyframes fadeUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}`}</style>

      {/* HEADER */}
      <div style={{ position:'fixed', top:0, left:0, right:0, zIndex:300, height:56, background:hbg, backdropFilter:'saturate(180%) blur(20px)', borderBottom:`1px solid ${border}`, display:'flex', alignItems:'center', justifyContent:'space-between', padding:'0 16px' }}>
        <div style={{ width:30, height:30 }}>
          <svg viewBox="0 0 100 100" width="30" height="30"><rect width="100" height="100" rx="22" fill="#007aff"/><text x="50" y="68" textAnchor="middle" fill="white" fontSize="52" fontWeight="700" fontFamily="-apple-system,sans-serif">M</text></svg>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <button onClick={toggleDark} style={{ width:36, height:36, borderRadius:'50%', background:s2, border:'none', fontSize:18, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}>
            {isDark?'☀️':'🌙'}
          </button>
          <button onClick={() => setShowMonthPicker(true)} style={{ display:'flex', alignItems:'center', gap:5, background:'rgba(0,122,255,.1)', borderRadius:20, padding:'7px 14px', cursor:'pointer', fontSize:15, fontWeight:600, color:'#007aff', border:'none', fontFamily:'inherit' }}>
            {MRU[currentDate.getMonth()].slice(0,3)} {currentDate.getFullYear()}
            <span style={{ display:'inline-block', width:8, height:8, borderRight:'2px solid currentColor', borderBottom:'2px solid currentColor', transform:'rotate(45deg)', marginTop:-3 }} />
          </button>
          <button onClick={()=>setShowAI(true)} style={{ width:36, height:36, borderRadius:'50%', background:'rgba(0,122,255,.1)', border:'none', fontSize:18, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}>🤖</button>
        </div>
      </div>

      {/* SCROLL */}
      <div style={{ position:'fixed', top:56, left:0, right:0, bottom:80, overflowY:'auto', background:bg, WebkitOverflowScrolling:'touch' as any }}>
        <div style={{ padding:'16px 16px 28px', maxWidth:860, margin:'0 auto', animation:'fadeUp .22s ease' }}>

          {/* Period sub-nav */}
          {tab === 'period' && (
            <>
              <div style={{ display:'flex', background:s2, borderRadius:10, padding:2, marginBottom:16 }}>
                {(['day','week','month'] as const).map(m=>(
                  <button key={m} onClick={()=>setPeriodMode(m)} style={{ flex:1, padding:'7px', borderRadius:8, border:'none', fontFamily:'inherit', fontSize:13, fontWeight:periodMode===m?600:500, cursor:'pointer', background:periodMode===m?surface:'transparent', color:periodMode===m?text:t3, boxShadow:periodMode===m?'0 1px 3px rgba(0,0,0,.1)':'none', transition:'all .15s' }}>
                    {m==='day'?'День':m==='week'?'Неделя':'Месяц'}
                  </button>
                ))}
              </div>
              {periodMode !== 'month' && (
                <div style={{ display:'flex', alignItems:'center', gap:12, background:surface, borderRadius:14, padding:'12px 16px', marginBottom:16, boxShadow:sh }}>
                  <button onClick={()=>{ const d=new Date(currentDate); d.setDate(d.getDate()-(periodMode==='week'?7:1)); setCurrentDate(d) }} style={{ width:40, height:40, borderRadius:'50%', background:s2, border:'none', fontSize:20, color:text, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', fontFamily:'inherit' }}>‹</button>
                  <div style={{ flex:1, textAlign:'center' as const }}>
                    <div style={{ fontSize:16, fontWeight:700, color:text }}>
                      {periodMode==='day' ? `${currentDate.getDate()} ${MRU[currentDate.getMonth()].slice(0,3)}` :
                        (() => { const {start,end} = getWeekRange(currentDate); return `${start.getDate()} ${MRU[start.getMonth()].slice(0,3)} — ${end.getDate()} ${MRU[end.getMonth()].slice(0,3)}` })()}
                    </div>
                    <div style={{ fontSize:12, color:'#007aff', marginTop:1, fontWeight:500 }}>
                      {periodMode==='day' ? `${DOW[currentDate.getDay()]} · день ${currentDate.getDate()}` : 'выбрать ↑'}
                    </div>
                  </div>
                  <button onClick={()=>{ const d=new Date(currentDate); d.setDate(d.getDate()+(periodMode==='week'?7:1)); setCurrentDate(d) }} style={{ width:40, height:40, borderRadius:'50%', background:s2, border:'none', fontSize:20, color:text, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', fontFamily:'inherit' }}>›</button>
                </div>
              )}
            </>
          )}

          {/* Kassa sub-nav */}
          {tab === 'kassa' && (
            <div style={{ display:'flex', background:s2, borderRadius:10, padding:2, marginBottom:16 }}>
              {(['kassa','inkass'] as const).map(m=>(
                <button key={m} onClick={()=>setKassaMode(m)} style={{ flex:1, padding:'7px', borderRadius:8, border:'none', fontFamily:'inherit', fontSize:13, fontWeight:kassaMode===m?600:500, cursor:'pointer', background:kassaMode===m?surface:'transparent', color:kassaMode===m?text:t3, boxShadow:kassaMode===m?'0 1px 3px rgba(0,0,0,.1)':'none', transition:'all .15s' }}>
                  {m==='kassa'?'Касса':'Инкасс'}
                </button>
              ))}
            </div>
          )}

          {tab==='period' && renderPeriod()}
          {tab==='kassa' && renderKassa()}
          {tab==='sales' && (
            <div style={{ padding:'60px 20px', textAlign:'center' as const, color:t4 }}>
              <div style={{ fontSize:'3rem', marginBottom:16 }}>🛒</div>
              <div style={{ fontWeight:700, fontSize:17, color:text, marginBottom:8 }}>Продажи</div>
              <div style={{ fontSize:14, maxWidth:260, margin:'0 auto', lineHeight:1.6 }}>Скоро — статистика продаж из Syrve: чеки, товары, выручка по позициям</div>
            </div>
          )}
          {tab==='salary' && renderSalary()}
          {tab==='hookah' && (
            <div style={{ padding:'60px 20px', textAlign:'center' as const, color:t4 }}>
              <div style={{ fontSize:'3rem', marginBottom:16 }}>💨</div>
              <div style={{ fontWeight:700, fontSize:17, color:text, marginBottom:8 }}>SO Tobacco</div>
              <div style={{ fontSize:14, maxWidth:260, margin:'0 auto', lineHeight:1.6 }}>Скоро — аналитика кальянных продаж и остатки склада из Syrve</div>
            </div>
          )}
        </div>
      </div>

      {/* BOTTOM NAV */}
      <div style={{ position:'fixed', bottom:0, left:0, right:0, zIndex:300, height:80, background:nbg, backdropFilter:'saturate(180%) blur(20px)', borderTop:`1px solid ${border}`, display:'flex', alignItems:'flex-start', paddingTop:10, paddingBottom:'env(safe-area-inset-bottom,10px)' }}>
        {TABS.map(t=>(
          <button key={t.id} onClick={()=>setTab(t.id as any)} style={{ flex:1, display:'flex', flexDirection:'column' as const, alignItems:'center', gap:3, cursor:'pointer', color:tab===t.id?'#007aff':t4, border:'none', background:'none', fontFamily:'inherit', padding:0, fontSize:10, fontWeight:600, transition:'color .18s' }}>
            <span style={{ transform:tab===t.id?'scale(1.1)':'scale(1)', transition:'transform .18s', display:'flex' }}>{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>

      {/* MONTH PICKER */}
      {showMonthPicker && (
        <div style={{ position:'fixed', inset:0, zIndex:500, background:'rgba(0,0,0,.4)', backdropFilter:'blur(4px)', display:'flex', alignItems:'flex-end', justifyContent:'center' }} onClick={()=>setShowMonthPicker(false)}>
          <div style={{ background:surface, borderRadius:'22px 22px 0 0', width:'100%', maxWidth:480, paddingBottom:32 }} onClick={(e:any)=>e.stopPropagation()}>
            <div style={{ width:36, height:4, background:s2, borderRadius:2, margin:'12px auto 0' }} />
            <div style={{ fontSize:17, fontWeight:700, textAlign:'center' as const, padding:'13px 20px 0', color:text }}>Выбор месяца</div>
            <div style={{ padding:'10px 0 6px' }}>
              {Array.from({length:12},(_,i)=>{
                const d = new Date(); d.setMonth(d.getMonth()-i)
                const isActive = d.getMonth()===currentDate.getMonth() && d.getFullYear()===currentDate.getFullYear()
                return (
                  <div key={i} onClick={()=>{ setCurrentDate(d); setShowMonthPicker(false); loadAll(restaurantId, d) }} style={{ padding:'15px 20px', fontSize:16, cursor:'pointer', borderBottom:`1px solid ${b2}`, display:'flex', alignItems:'center', justifyContent:'space-between', color:isActive?'#007aff':text, fontWeight:isActive?700:400 }}>
                    {MRU[d.getMonth()]} {d.getFullYear()}
                    {isActive&&<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><circle cx="9" cy="9" r="9" fill="#007aff"/><path d="m5 9 2.5 2.5L13 6" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"/></svg>}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* AI MODAL */}
      {showAI && (
        <div style={{ position:'fixed', inset:0, zIndex:500, background:'rgba(0,0,0,.4)', backdropFilter:'blur(4px)', display:'flex', alignItems:'flex-end', justifyContent:'center' }} onClick={()=>setShowAI(false)}>
          <div style={{ background:surface, borderRadius:'22px 22px 0 0', width:'100%', maxWidth:480, height:'80vh', display:'flex', flexDirection:'column' as const }} onClick={(e:any)=>e.stopPropagation()}>
            <div style={{ width:36, height:4, background:s2, borderRadius:2, margin:'12px auto 0' }} />
            <div style={{ fontSize:17, fontWeight:700, textAlign:'center' as const, padding:'13px 20px 0', color:text }}>🤖 AI Ассистент</div>
            {!geminiKey ? (
              <div style={{ padding:24, textAlign:'center' as const, color:t3, flex:1, display:'flex', flexDirection:'column' as const, alignItems:'center', justifyContent:'center' }}>
                <div style={{ fontSize:'2.5rem', marginBottom:12 }}>🔑</div>
                <div style={{ marginBottom:8, fontSize:15, color:text }}>Добавьте Gemini API ключ</div>
                <div style={{ fontSize:13, color:t3 }}>Dashboard → Настройки → Gemini API Key</div>
                <div style={{ fontSize:12, color:t4, marginTop:6 }}>Бесплатно на aistudio.google.com</div>
              </div>
            ) : (
              <>
                <div style={{ flex:1, overflowY:'auto' as const, padding:'12px 16px', display:'flex', flexDirection:'column' as const, gap:10 }}>
                  {chatMsgs.length===0&&(
                    <div style={{ textAlign:'center' as const, color:t4, padding:'20px 0' }}>
                      <div style={{ fontSize:'1.5rem', marginBottom:8 }}>💬</div>
                      <div style={{ fontSize:14 }}>Спросите о вашем бизнесе</div>
                      <div style={{ fontSize:12, color:t4, marginTop:4 }}>«Где больше расходов?» · «Как дела в этом месяце?»</div>
                    </div>
                  )}
                  {chatMsgs.map((m,i)=>(
                    <div key={i} style={{ display:'flex', justifyContent:m.role==='user'?'flex-end':'flex-start' }}>
                      <div style={{ maxWidth:'80%', padding:'10px 14px', borderRadius:m.role==='user'?'16px 16px 4px 16px':'16px 16px 16px 4px', background:m.role==='user'?'#007aff':s2, color:m.role==='user'?'#fff':text, fontSize:14, lineHeight:1.5 }}>{m.text}</div>
                    </div>
                  ))}
                  {chatLoading&&<div style={{ display:'flex', justifyContent:'flex-start' }}><div style={{ padding:'10px 14px', borderRadius:'16px 16px 16px 4px', background:s2, color:t3, fontSize:14 }}>Думаю...</div></div>}
                </div>
                <div style={{ padding:'10px 16px 20px', display:'flex', gap:8 }}>
                  <input value={chatInput} onChange={e=>setChatInput(e.target.value)} onKeyDown={e=>e.key==='Enter'&&sendMessage()} placeholder="Спросите о бизнесе..." style={{ flex:1, padding:'11px 14px', borderRadius:12, border:`1px solid ${border}`, fontSize:14, color:text, background:surface, fontFamily:'inherit', outline:'none' }} />
                  <button onClick={sendMessage} disabled={chatLoading} style={{ padding:'11px 18px', borderRadius:12, background:'#007aff', color:'#fff', border:'none', fontFamily:'inherit', fontSize:14, fontWeight:600, cursor:'pointer' }}>→</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
