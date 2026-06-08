'use client'
export const dynamic = 'force-dynamic'
import React, { useEffect, useState } from 'react'
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

interface StatProps { label: string; val: string; color?: string; sub?: string; sm?: boolean; surface: string; text: string; t3: string; t4: string; sh: string }
function Stat({ label, val, color, sub, sm, surface, text, t3, t4, sh }: StatProps) {
  return (
    <div style={{ background:surface, borderRadius:14, padding:sm?'12px':'14px 12px', boxShadow:sh }}>
      <div style={{ fontSize:10, color:t3, fontWeight:600, textTransform:'uppercase' as const, letterSpacing:.4, marginBottom:5 }}>{label}</div>
      <div style={{ fontSize:sm?15:22, fontWeight:700, color:color||text }}>{val}</div>
      {sub && <div style={{ fontSize:11, color:t4, marginTop:4 }}>{sub}</div>}
    </div>
  )
}

interface CardProps { children: React.ReactNode; style?: React.CSSProperties; surface: string; sh: string }
function Card({ children, style={}, surface, sh }: CardProps) {
  return (
    <div style={{ background:surface, borderRadius:16, overflow:'hidden', marginBottom:12, boxShadow:sh, ...style }}>{children}</div>
  )
}

interface SecProps { children: React.ReactNode; t3: string }
function Sec({ children, t3 }: SecProps) {
  return (
    <div style={{ fontSize:12, fontWeight:600, color:t3, textTransform:'uppercase' as const, letterSpacing:.5, padding:'16px 4px 8px' }}>{children}</div>
  )
}

interface ProgProps { name: string; val: number; max: number; color: string; currency: string; text: string; b2: string; s2: string }
function Prog({ name, val, max, color, currency, text, b2, s2 }: ProgProps) {
  return (
    <div style={{ padding:'10px 16px', borderBottom:`1px solid ${b2}` }}>
      <div style={{ display:'flex', justifyContent:'space-between', marginBottom:6 }}>
        <span style={{ fontSize:15, color:text, maxWidth:'65%', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' as const }}>{name}</span>
        <span style={{ fontSize:15, fontWeight:600, color:text }}>{currency}{fv(val)}</span>
      </div>
      <div style={{ height:4, background:s2, borderRadius:2, overflow:'hidden' }}>
        <div style={{ height:'100%', width:`${Math.min(val/max*100,100).toFixed(1)}%`, background:color, borderRadius:2 }} />
      </div>
    </div>
  )
}

interface TableHeaderProps { cols: string[]; isDark: boolean; t4: string }
function TableHeader({ cols, isDark, t4 }: TableHeaderProps) {
  return (
    <div style={{ display:'grid', gridTemplateColumns:`${cols.map(()=>'1fr').join(' ')}`, background:isDark?'rgba(255,255,255,.06)':'rgba(0,0,0,.04)', padding:'7px 14px', gap:4 }}>
      {cols.map(h => <div key={h} style={{ fontSize:10, color:t4, fontWeight:600, textTransform:'uppercase' as const }}>{h}</div>)}
    </div>
  )
}

export default function AnalyticsApp() {
  const [user, setUser] = useState<any>(null)
  const [restaurantId, setRestaurantId] = useState('')
  const [currency, setCurrency] = useState('€')
  const [tab, setTab] = useState<'period'|'kassa'|'sales'|'salary'|'hookah'>('period')
  const [periodMode, setPeriodMode] = useState<'day'|'week'|'month'>('day')
  const [kassaMode, setKassaMode] = useState<'kassa'|'inkass'>('kassa')
  const [currentDate, setCurrentDate] = useState(new Date())
  const [shifts, setShifts] = useState<any[]>([])
  const [prevShifts, setPrevShifts] = useState<any[]>([])
  const [expenses, setExpenses] = useState<any[]>([])
  const [inkassations, setInkassations] = useState<any[]>([])
  const [employees, setEmployees] = useState<any[]>([])
  const [cardAmounts, setCardAmounts] = useState<any[]>([])
  const [absences, setAbsences] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [isDark, setIsDark] = useState<boolean>(false)
  const [mounted, setMounted] = useState(false)
  const [showMonthPicker, setShowMonthPicker] = useState(false)
  const [showAI, setShowAI] = useState(false)
  const [geminiKey, setGeminiKey] = useState('')
  const [chatMsgs, setChatMsgs] = useState<{role:string;text:string}[]>([])
  const [chatInput, setChatInput] = useState('')
  const [chatLoading, setChatLoading] = useState(false)

  useEffect(() => {
    setMounted(true)
    setIsDark(localStorage.getItem('so_ana_dark') === '1')
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
    const prevStart = fmtDate(new Date(date.getFullYear(), date.getMonth()-1, 1))
    const prevEnd = fmtDate(new Date(date.getFullYear(), date.getMonth(), 0))

    const [s1, s2, s3, s4, s5, s6] = await Promise.all([
      supabase.from('shifts').select('*').eq('restaurant_id', rid).gte('date', monthStart).lte('date', monthEnd).order('date'),
      supabase.from('shifts').select('*').eq('restaurant_id', rid).gte('date', prevStart).lte('date', prevEnd).order('date'),
      supabase.from('restaurant_settings').select('currency,gemini_api_key').eq('restaurant_id', rid).maybeSingle(),
      supabase.from('employees').select('*').eq('restaurant_id', rid).eq('is_active', true).order('name'),
      supabase.from('monthly_card_amounts').select('*').eq('restaurant_id', rid).eq('month', fmtDate(date).slice(0,7)),
      supabase.from('shift_absences').select('*').eq('restaurant_id', rid).gte('date', monthStart).lte('date', monthEnd)
    ])

    const shiftList = s1.data || []
    setShifts(shiftList)
    setPrevShifts(s2.data || [])
    if (s3.data) { setCurrency(s3.data.currency || '€'); setGeminiKey(s3.data.gemini_api_key || '') }
    setEmployees(s4.data || [])
    setCardAmounts(s5.data || [])
    setAbsences(s6.data || [])

    if (shiftList.length > 0) {
      const ids = shiftList.map((s:any) => s.id)
      const [e1, e2] = await Promise.all([
        supabase.from('shift_expenses').select('*').in('shift_id', ids),
        supabase.from('inkassations').select('*').eq('restaurant_id', rid).gte('date', monthStart).lte('date', monthEnd).order('date')
      ])
      setExpenses(e1.data || [])
      setInkassations(e2.data || [])
    }
    setLoading(false)
  }

  const toggleDark = () => {
    const d = !isDark; setIsDark(d)
    if (typeof window !== 'undefined') localStorage.setItem('so_ana_dark', d ? '1' : '0')
  }

  const totalIncome = shifts.reduce((s:number, sh:any) => s + (sh.income||0), 0)
  const totalExpense = shifts.reduce((s:number, sh:any) => s + (sh.total_expense||0), 0)
  const totalInkass = inkassations.reduce((s:number, i:any) => s + (i.amount||0), 0)
  const lastShift = shifts[shifts.length-1]
  const prevIncome = prevShifts.reduce((s:number, sh:any) => s + (sh.income||0), 0)
  const prevExpense = prevShifts.reduce((s:number, sh:any) => s + (sh.total_expense||0), 0)
  const pct = (cur:number, prev:number) => prev ? ((cur-prev)/prev*100) : null

  const bg = mounted && isDark ? '#1c1c1e' : '#f2f2f7'
  const surface = mounted && isDark ? '#2c2c2e' : '#fff'
  const text = mounted && isDark ? '#f2f2f7' : '#1c1c1e'
  const t3 = mounted && isDark ? '#aeaeb2' : '#6d6d72'
  const t4 = mounted && isDark ? '#636366' : '#aeaeb2'
  const border = mounted && isDark ? 'rgba(255,255,255,.15)' : 'rgba(60,60,67,.13)'
  const b2 = mounted && isDark ? 'rgba(255,255,255,.08)' : 'rgba(60,60,67,.07)'
  const s2 = mounted && isDark ? 'rgba(255,255,255,.1)' : 'rgba(118,118,128,.12)'
  const sh = mounted && isDark ? '0 1px 3px rgba(0,0,0,.3),0 4px 16px rgba(0,0,0,.2)' : '0 1px 3px rgba(0,0,0,.08),0 4px 16px rgba(0,0,0,.05)'
  const hbg = mounted && isDark ? 'rgba(28,28,30,.96)' : 'rgba(242,242,247,.95)'
  const nbg = mounted && isDark ? 'rgba(28,28,30,.97)' : 'rgba(248,248,252,.97)'

  const sendAI = async () => {
    if (!chatInput.trim() || !geminiKey) return
    const msg = chatInput.trim(); setChatInput('')
    setChatMsgs(p => [...p, { role:'user', text:msg }])
    setChatLoading(true)
    const ctx = `Ты AI-ассистент ресторана. ${MRU[currentDate.getMonth()]} ${currentDate.getFullYear()}: доход ${currency}${fv(totalIncome)}, расходы ${currency}${fv(totalExpense)}, касса ${currency}${fv(lastShift?.closing_balance||0)}. Отвечай кратко на русском.`
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ contents:[{ parts:[{ text:ctx+'\nВопрос: '+msg }] }] })
      })
      const d = await r.json()
      setChatMsgs(p => [...p, { role:'ai', text:d.candidates?.[0]?.content?.parts?.[0]?.text||'Нет ответа' }])
    } catch { setChatMsgs(p => [...p, { role:'ai', text:'Ошибка' }]) }
    setChatLoading(false)
  }

  const renderPeriod = () => {
    const dayStr = fmtDate(currentDate)
    const dayShift = shifts.find((s:any) => s.date === dayStr)
    const dayExps = dayShift ? expenses.filter((e:any) => e.shift_id === dayShift.id && !e.employee_id) : []
    const dayInk = dayShift ? inkassations.find((i:any) => i.shift_id === dayShift.id) : null

    const getWeekShifts = () => {
      const start = new Date(currentDate)
      const day = start.getDay()
      start.setDate(start.getDate() - (day===0?6:day-1))
      const end = new Date(start); end.setDate(start.getDate()+6)
      return shifts.filter((s:any) => s.date >= fmtDate(start) && s.date <= fmtDate(end))
    }

    const getCatMap = (exps: any[]) => {
      const m: Record<string,number> = {}
      exps.filter((e:any)=>!e.employee_id).forEach((e:any) => { m[e.category_name]=(m[e.category_name]||0)+e.amount })
      return Object.entries(m).sort((a,b)=>b[1]-a[1])
    }

    if (periodMode === 'day') {
      if (!dayShift) return <div style={{ padding:'48px 20px', textAlign:'center' as const, color:t4 }}>Нет данных за {dd(dayStr)}</div>
      return (
        <div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:12 }}>
            <Stat label="Расход дня" val={`${currency}${fv(dayShift.total_expense)}`} color="#ff3b30" surface={surface} text={text} t3={t3} t4={t4} sh={sh} />
            <Stat label="Доход" val={`${currency}${fv(dayShift.income)}`} color="#34c759" surface={surface} text={text} t3={t3} t4={t4} sh={sh} />
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:10, marginBottom:12 }}>
            <Stat label="Вход" val={`${currency}${fv(dayShift.opening_balance)}`} color="#007aff" sm surface={surface} text={text} t3={t3} t4={t4} sh={sh} />
            <Stat label="Доход" val={`${currency}${fv(dayShift.income)}`} color="#34c759" sm surface={surface} text={text} t3={t3} t4={t4} sh={sh} />
            <Stat label="Расход" val={`${currency}${fv(dayShift.total_expense)}`} color="#ff3b30" sm surface={surface} text={text} t3={t3} t4={t4} sh={sh} />
            <Stat label="Касса" val={`${currency}${fv(dayShift.closing_balance)}`} color="#007aff" sm surface={surface} text={text} t3={t3} t4={t4} sh={sh} />
          </div>
          {dayExps.length > 0 && <><Sec t3={t3}>Расходы</Sec><Card surface={surface} sh={sh}>{dayExps.map((e:any,i:number)=>(
            <div key={e.id} style={{ display:'flex', justifyContent:'space-between', padding:'12px 16px', borderBottom:i<dayExps.length-1?`1px solid ${b2}`:'none' }}>
              <span style={{ color:text }}>{e.category_name}{e.note?` · ${e.note}`:''}</span>
              <span style={{ color:'#ff3b30', fontWeight:600 }}>−{currency}{fv(e.amount)}</span>
            </div>
          ))}</Card></>}
          {dayInk && <><Sec t3={t3}>Инкассация</Sec><Card surface={surface} sh={sh}>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:'1px', background:b2 }}>
              {[{l:'Приход',v:dayInk.amount>0?`${currency}${fv(dayInk.amount)}`:'—',c:'#34c759'},{l:'Расход',v:dayInk.expense>0?`${currency}${fv(dayInk.expense)}`:'—',c:'#ff3b30'},{l:'Причина',v:dayInk.reason||'—',c:t3},{l:'Итог',v:`${currency}${fv(dayInk.balance)}`,c:'#ff9500'}].map(cell=>(
                <div key={cell.l} style={{ background:surface, padding:'10px 8px' }}>
                  <div style={{ fontSize:9, color:t3, textTransform:'uppercase' as const, marginBottom:4, fontWeight:600 }}>{cell.l}</div>
                  <div style={{ fontSize:13, fontWeight:700, color:cell.c }}>{cell.v}</div>
                </div>
              ))}
            </div>
          </Card></>}
        </div>
      )
    }

    if (periodMode === 'week') {
      const ws = getWeekShifts()
      const wi = ws.reduce((s:number,sh:any)=>s+sh.income,0)
      const we = ws.reduce((s:number,sh:any)=>s+sh.total_expense,0)
      const wExps = expenses.filter((e:any)=>ws.map((s:any)=>s.id).includes(e.shift_id))
      const cats = getCatMap(wExps)
      const maxV = cats[0]?.[1]||1
      const ip = pct(wi, prevIncome/4); const ep = pct(we, prevExpense/4)
      return (
        <div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:12 }}>
            <Stat label="Итог за неделю" val={`${currency}${fv(wi)}`} color="#34c759" sub={ip!==null?`${ip>=0?'↑':'↓'} ${Math.abs(ip).toFixed(1)}% vs пред.`:undefined} surface={surface} text={text} t3={t3} t4={t4} sh={sh} />
            <Stat label="Расходы" val={`${currency}${fv(we)}`} color="#ff3b30" sub={ep!==null?`${ep>=0?'↑':'↓'} ${Math.abs(ep).toFixed(1)}% vs пред.`:undefined} surface={surface} text={text} t3={t3} t4={t4} sh={sh} />
          </div>
          {cats.length>0&&<><Sec t3={t3}>Структура расходов</Sec><Card surface={surface} sh={sh}>{cats.map(([n,v],i)=><Prog key={n} name={n} val={v} max={maxV} color={COLORS[i%COLORS.length]} currency={currency} text={text} b2={b2} s2={s2} />)}</Card></>}
          <Sec t3={t3}>По дням</Sec>
          <Card surface={surface} sh={sh}>
            <TableHeader cols={['Дата','Вход','Доход','Расход','Касса']} isDark={isDark} t4={t4} />
            {ws.map((s:any)=>(
              <div key={s.id} style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', padding:'10px 14px', gap:4, borderBottom:`1px solid ${b2}`, fontSize:13, color:text }}>
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

    const cats = getCatMap(expenses)
    const top5 = cats.slice(0,5)
    const maxV = cats[0]?.[1]||1
    const ip = pct(totalIncome, prevIncome); const ep = pct(totalExpense, prevExpense)
    return (
      <div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:12 }}>
          <Stat label="Итого за месяц" val={`${currency}${fv(totalIncome)}`} color="#34c759" sub={ip!==null?`${ip>=0?'↑':'↓'} ${Math.abs(ip).toFixed(1)}% vs пред.`:undefined} surface={surface} text={text} t3={t3} t4={t4} sh={sh} />
          <Stat label="Расходы" val={`${currency}${fv(totalExpense)}`} color="#ff3b30" sub={ep!==null?`${ep>=0?'↑':'↓'} ${Math.abs(ep).toFixed(1)}% vs пред.`:undefined} surface={surface} text={text} t3={t3} t4={t4} sh={sh} />
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:10, marginBottom:12 }}>
          <Stat label="Смен" val={String(shifts.length)} sm surface={surface} text={text} t3={t3} t4={t4} sh={sh} />
          <Stat label="Инкасс" val={`${currency}${fv(totalInkass)}`} color="#ff9500" sm surface={surface} text={text} t3={t3} t4={t4} sh={sh} />
          <Stat label="Касса" val={`${currency}${fv(lastShift?.closing_balance||0)}`} color="#007aff" sm surface={surface} text={text} t3={t3} t4={t4} sh={sh} />
        </div>
        {top5.length>0&&<><Sec t3={t3}>Топ расходов</Sec><Card surface={surface} sh={sh}>{top5.map(([n,v],i)=><Prog key={n} name={n} val={v} max={maxV} color={COLORS[i%COLORS.length]} currency={currency} text={text} b2={b2} s2={s2} />)}</Card></>}
        {cats.length>0&&<><Sec t3={t3}>Все категории</Sec><Card surface={surface} sh={sh}>{cats.map(([n,v],i)=>(
          <div key={n} style={{ display:'flex', justifyContent:'space-between', padding:'12px 16px', borderBottom:i<cats.length-1?`1px solid ${b2}`:'none' }}>
            <span style={{ color:text }}>{n}</span><span style={{ color:'#ff3b30', fontWeight:600 }}>{currency}{fv(v)}</span>
          </div>
        ))}</Card></>}
      </div>
    )
  }

  const renderKassa = () => {
    if (kassaMode === 'kassa') {
      const filled = shifts.filter((s:any)=>s.income>0||s.total_expense>0)
      return (
        <div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:12 }}>
            <Stat label="Остаток" val={`${currency}${fv(lastShift?.closing_balance||0)}`} color="#007aff" surface={surface} text={text} t3={t3} t4={t4} sh={sh} />
            <Stat label="Доход посл." val={`${currency}${fv(lastShift?.income||0)}`} color="#34c759" sub={lastShift?dd(lastShift.date):undefined} surface={surface} text={text} t3={t3} t4={t4} sh={sh} />
          </div>
          <Sec t3={t3}>По дням</Sec>
          <Card surface={surface} sh={sh}>
            <TableHeader cols={['Дата','Вход','Доход','Расход','Касса']} isDark={isDark} t4={t4} />
            {filled.map((s:any)=>(
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
    const now = new Date()
    const dIM = new Date(now.getFullYear(),now.getMonth()+1,0).getDate()
    const lastInk = inkassations[inkassations.length-1]
    const inkBal = lastInk?.balance||0
    const totalSal = employees.reduce((s:number,e:any)=>s+e.salary,0)
    const salToday = Math.round(totalSal/dIM*now.getDate())
    const diff = inkBal-salToday
    return (
      <div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:12 }}>
          <Stat label="Баланс" val={`${currency}${fv(inkBal)}`} color="#ff9500" surface={surface} text={text} t3={t3} t4={t4} sh={sh} />
          <Stat label="ЗП на сегодня" val={`${currency}${fv(salToday)}`} color={diff>=0?'#34c759':'#ff3b30'} sub={`${diff>=0?'Опережаем':'Отстаём'} ${currency}${fv(Math.abs(diff))}`} surface={surface} text={text} t3={t3} t4={t4} sh={sh} />
        </div>
        <Sec t3={t3}>История</Sec>
        <Card surface={surface} sh={sh}>
          {inkassations.length===0
            ? <div style={{ padding:'32px', textAlign:'center' as const, color:t4 }}>Нет инкассаций</div>
            : <><TableHeader cols={['Дата','Сумма','Расход','Причина','Итог']} isDark={isDark} t4={t4} />
              {inkassations.map((ink:any)=>(
                <div key={ink.id} style={{ display:'grid', gridTemplateColumns:'44px 1fr 1fr 1fr 1fr', padding:'11px 14px', gap:4, borderBottom:`1px solid ${b2}`, fontSize:13, color:text }}>
                  <span style={{ color:t3 }}>{dd(ink.date)}</span>
                  <span style={{ color:'#34c759', fontWeight:600 }}>{ink.amount>0?`${currency}${fv(ink.amount)}`:'—'}</span>
                  <span style={{ color:'#ff3b30' }}>{ink.expense>0?`${currency}${fv(ink.expense)}`:'—'}</span>
                  <span style={{ color:t4, fontSize:11 }}>{ink.reason||'—'}</span>
                  <span style={{ color:'#ff9500', fontWeight:600 }}>{currency}{fv(ink.balance)}</span>
                </div>
              ))}</>}
        </Card>
      </div>
    )
  }

  const renderSalary = () => {
    const totFOT = employees.reduce((s:number,e:any)=>s+e.salary,0)
    const totCard = cardAmounts.reduce((s:number,c:any)=>s+c.card_amount,0)
    const totCash = employees.reduce((s:number,emp:any)=>{
      const abs = absences.filter((a:any)=>a.employee_id===emp.id).length
      const card = cardAmounts.find((c:any)=>c.employee_id===emp.id)?.card_amount||0
      return s+(emp.salary-abs*emp.deduct_per_absence-card)
    },0)
    return (
      <div>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:10, marginBottom:12 }}>
          <Stat label="ФОТ" val={`${currency}${fv(totFOT)}`} color="#007aff" sm surface={surface} text={text} t3={t3} t4={t4} sh={sh} />
          <Stat label="Нал" val={`${currency}${fv(totCash)}`} color="#ff9500" sm surface={surface} text={text} t3={t3} t4={t4} sh={sh} />
          <Stat label="Карта" val={`${currency}${fv(totCard)}`} color="#af52de" sm surface={surface} text={text} t3={t3} t4={t4} sh={sh} />
        </div>
        <Sec t3={t3}>Сотрудники</Sec>
        <Card surface={surface} sh={sh}>
          {employees.map((emp:any,i:number)=>{
            const abs = absences.filter((a:any)=>a.employee_id===emp.id).length
            const deduct = abs*emp.deduct_per_absence
            const card = cardAmounts.find((c:any)=>c.employee_id===emp.id)?.card_amount||0
            const cash = emp.salary-deduct-card
            return (
              <div key={emp.id} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'10px 16px', borderBottom:i<employees.length-1?`1px solid ${b2}`:'none' }}>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:15, color:text, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' as const }}>{emp.name}</div>
                  <div style={{ fontSize:11, color:t3, marginTop:1 }}>ЗП: {currency}{fv(emp.salary)}{deduct>0?` · −${currency}${fv(deduct)}`:''}{abs>0?` · Пропусков: ${abs}`:''}</div>
                  {abs>0&&<div style={{ marginTop:5, height:3, background:s2, borderRadius:2, overflow:'hidden' }}><div style={{ height:'100%', width:`${Math.min(abs/22*100,100).toFixed(1)}%`, background:'#ff3b30', borderRadius:2 }} /></div>}
                </div>
                <div style={{ textAlign:'right' as const, paddingLeft:12 }}>
                  <div style={{ fontSize:17, fontWeight:700, color:'#007aff' }}>{currency}{fv(cash)}</div>
                  {card>0&&<div style={{ fontSize:11, color:t4 }}>карта: {currency}{fv(card)}</div>}
                </div>
              </div>
            )
          })}
        </Card>
      </div>
    )
  }

  if (!mounted || loading) return (
    <div style={{ minHeight:'100vh', background:'#f2f2f7', display:'flex', alignItems:'center', justifyContent:'center' }}>
      <div style={{ width:28, height:28, border:`2.5px solid ${s2}`, borderTopColor:'#007aff', borderRadius:'50%', animation:'spin .7s linear infinite' }} />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )

  const TABS = [
    { id:'period', label:'Период', icon:<svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24" width="26" height="26"><rect x="3" y="4" width="18" height="18" rx="3"/><path d="M16 2v4M8 2v4M3 10h18"/></svg> },
    { id:'kassa', label:'Касса', icon:<svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24" width="26" height="26"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 3H8L2 7h20z"/></svg> },
    { id:'sales', label:'Продажи', icon:<svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24" width="26" height="26"><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 01-8 0"/></svg> },
    { id:'salary', label:'Смены', icon:<svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24" width="26" height="26"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg> },
    { id:'hookah', label:'Кальян', icon:<svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24" width="26" height="26"><path d="M12 2c-1 0-2 1-2 3h4c0-2-1-3-2-3z"/><path d="M10 5c-2 0-3 2-3 4h10c0-2-1-4-3-4h-4z"/><path d="M7 9l-2 4h14l-2-4"/><path d="M5 13c-2 2-2 5 0 6h14c2-1 2-4 0-6"/></svg> },
  ] as const

  return (
    <div style={{ height:'100vh', overflow:'hidden', background:bg, fontFamily:"-apple-system,BlinkMacSystemFont,'SF Pro Text',sans-serif", WebkitFontSmoothing:'antialiased' }}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}} @keyframes fadeUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}`}</style>

      <div style={{ position:'fixed', top:0, left:0, right:0, zIndex:300, height:56, background:hbg, backdropFilter:'saturate(180%) blur(20px)', borderBottom:`1px solid ${border}`, display:'flex', alignItems:'center', justifyContent:'space-between', padding:'0 16px' }}>
        <div style={{ fontWeight:700, fontSize:'1rem', color:text }}>SO Analytics</div>
        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
          <button onClick={toggleDark} style={{ width:36, height:36, borderRadius:'50%', background:s2, border:'none', fontSize:18, cursor:'pointer' }}>{isDark?'☀️':'🌙'}</button>
          <button onClick={()=>setShowMonthPicker(true)} style={{ display:'flex', alignItems:'center', gap:5, background:'rgba(0,122,255,.1)', borderRadius:20, padding:'7px 14px', cursor:'pointer', fontSize:15, fontWeight:600, color:'#007aff', border:'none', fontFamily:'inherit' }}>
            {MRU[currentDate.getMonth()].slice(0,3)} {currentDate.getFullYear()}
            <span style={{ display:'inline-block', width:8, height:8, borderRight:'2px solid #007aff', borderBottom:'2px solid #007aff', transform:'rotate(45deg)', marginTop:-3 }} />
          </button>
          <button onClick={()=>setShowAI(true)} style={{ width:36, height:36, borderRadius:'50%', background:'rgba(0,122,255,.1)', border:'none', fontSize:18, cursor:'pointer' }}>🤖</button>
        </div>
      </div>

      <div style={{ position:'fixed', top:56, left:0, right:0, bottom:80, overflowY:'auto', background:bg }}>
        <div style={{ padding:'16px 16px 28px', maxWidth:860, margin:'0 auto', animation:'fadeUp .22s ease' }}>
          {tab==='period' && (
            <>
              <div style={{ display:'flex', background:s2, borderRadius:10, padding:2, marginBottom:16 }}>
                {(['day','week','month'] as const).map(m=>(
                  <button key={m} onClick={()=>setPeriodMode(m)} style={{ flex:1, padding:7, borderRadius:8, border:'none', fontFamily:'inherit', fontSize:13, fontWeight:periodMode===m?600:500, cursor:'pointer', background:periodMode===m?surface:'transparent', color:periodMode===m?text:t3, boxShadow:periodMode===m?'0 1px 3px rgba(0,0,0,.1)':'none', transition:'all .15s' }}>
                    {m==='day'?'День':m==='week'?'Неделя':'Месяц'}
                  </button>
                ))}
              </div>
              {periodMode!=='month'&&(
                <div style={{ display:'flex', alignItems:'center', gap:12, background:surface, borderRadius:14, padding:'12px 16px', marginBottom:16, boxShadow:sh }}>
                  <button onClick={()=>{const d=new Date(currentDate);d.setDate(d.getDate()-(periodMode==='week'?7:1));setCurrentDate(d)}} style={{ width:40, height:40, borderRadius:'50%', background:s2, border:'none', fontSize:20, color:text, cursor:'pointer', fontFamily:'inherit' }}>‹</button>
                  <div style={{ flex:1, textAlign:'center' as const }}>
                    <div style={{ fontSize:16, fontWeight:700, color:text }}>{periodMode==='day'?`${currentDate.getDate()} ${MRU[currentDate.getMonth()].slice(0,3)}`:`Неделя ${currentDate.getDate()} ${MRU[currentDate.getMonth()].slice(0,3)}`}</div>
                    <div style={{ fontSize:12, color:'#007aff', marginTop:1, fontWeight:500 }}>{periodMode==='day'?DOW[currentDate.getDay()]:'выбрать ↑'}</div>
                  </div>
                  <button onClick={()=>{const d=new Date(currentDate);d.setDate(d.getDate()+(periodMode==='week'?7:1));setCurrentDate(d)}} style={{ width:40, height:40, borderRadius:'50%', background:s2, border:'none', fontSize:20, color:text, cursor:'pointer', fontFamily:'inherit' }}>›</button>
                </div>
              )}
              {renderPeriod()}
            </>
          )}
          {tab==='kassa'&&(
            <>
              <div style={{ display:'flex', background:s2, borderRadius:10, padding:2, marginBottom:16 }}>
                {(['kassa','inkass'] as const).map(m=>(
                  <button key={m} onClick={()=>setKassaMode(m)} style={{ flex:1, padding:7, borderRadius:8, border:'none', fontFamily:'inherit', fontSize:13, fontWeight:kassaMode===m?600:500, cursor:'pointer', background:kassaMode===m?surface:'transparent', color:kassaMode===m?text:t3, boxShadow:kassaMode===m?'0 1px 3px rgba(0,0,0,.1)':'none', transition:'all .15s' }}>
                    {m==='kassa'?'Касса':'Инкасс'}
                  </button>
                ))}
              </div>
              {renderKassa()}
            </>
          )}
          {tab==='sales'&&<div style={{ padding:'60px 20px', textAlign:'center' as const, color:t4 }}><div style={{ fontSize:'3rem', marginBottom:16 }}>🛒</div><div style={{ fontWeight:700, fontSize:17, color:text, marginBottom:8 }}>Продажи</div><div style={{ fontSize:14 }}>Скоро — статистика из Syrve</div></div>}
          {tab==='salary'&&renderSalary()}
          {tab==='hookah'&&<div style={{ padding:'60px 20px', textAlign:'center' as const, color:t4 }}><div style={{ fontSize:'3rem', marginBottom:16 }}>💨</div><div style={{ fontWeight:700, fontSize:17, color:text, marginBottom:8 }}>Кальян</div><div style={{ fontSize:14 }}>Скоро — аналитика из Syrve</div></div>}
        </div>
      </div>

      <div style={{ position:'fixed', bottom:0, left:0, right:0, zIndex:300, height:80, background:nbg, backdropFilter:'saturate(180%) blur(20px)', borderTop:`1px solid ${border}`, display:'flex', alignItems:'flex-start', paddingTop:10 }}>
        {TABS.map(t=>(
          <button key={t.id} onClick={()=>setTab(t.id as any)} style={{ flex:1, display:'flex', flexDirection:'column' as const, alignItems:'center', gap:3, cursor:'pointer', color:tab===t.id?'#007aff':t4, border:'none', background:'none', fontFamily:'inherit', padding:0, fontSize:10, fontWeight:600, transition:'color .18s' }}>
            <span style={{ transform:tab===t.id?'scale(1.1)':'scale(1)', transition:'transform .18s', display:'flex' }}>{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>

      {showMonthPicker&&(
        <div style={{ position:'fixed', inset:0, zIndex:500, background:'rgba(0,0,0,.4)', backdropFilter:'blur(4px)', display:'flex', alignItems:'flex-end', justifyContent:'center' }} onClick={()=>setShowMonthPicker(false)}>
          <div style={{ background:surface, borderRadius:'22px 22px 0 0', width:'100%', maxWidth:480, paddingBottom:32 }} onClick={(e:any)=>e.stopPropagation()}>
            <div style={{ width:36, height:4, background:s2, borderRadius:2, margin:'12px auto 0' }} />
            <div style={{ fontSize:17, fontWeight:700, textAlign:'center' as const, padding:'13px 20px 0', color:text }}>Выбор месяца</div>
            {Array.from({length:12},(_,i)=>{
              const d=new Date(); d.setMonth(d.getMonth()-i)
              const active=d.getMonth()===currentDate.getMonth()&&d.getFullYear()===currentDate.getFullYear()
              return <div key={i} onClick={()=>{setCurrentDate(d);setShowMonthPicker(false);loadAll(restaurantId,d)}} style={{ padding:'15px 20px', fontSize:16, cursor:'pointer', borderBottom:`1px solid ${b2}`, display:'flex', alignItems:'center', justifyContent:'space-between', color:active?'#007aff':text, fontWeight:active?700:400 }}>
                {MRU[d.getMonth()]} {d.getFullYear()}
                {active&&<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><circle cx="9" cy="9" r="9" fill="#007aff"/><path d="m5 9 2.5 2.5L13 6" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"/></svg>}
              </div>
            })}
          </div>
        </div>
      )}

      {showAI&&(
        <div style={{ position:'fixed', inset:0, zIndex:500, background:'rgba(0,0,0,.4)', backdropFilter:'blur(4px)', display:'flex', alignItems:'flex-end', justifyContent:'center' }} onClick={()=>setShowAI(false)}>
          <div style={{ background:surface, borderRadius:'22px 22px 0 0', width:'100%', maxWidth:480, height:'80vh', display:'flex', flexDirection:'column' as const }} onClick={(e:any)=>e.stopPropagation()}>
            <div style={{ width:36, height:4, background:s2, borderRadius:2, margin:'12px auto 0' }} />
            <div style={{ fontSize:17, fontWeight:700, textAlign:'center' as const, padding:'13px 20px 0', color:text }}>🤖 AI Ассистент</div>
            {!geminiKey?<div style={{ flex:1, display:'flex', flexDirection:'column' as const, alignItems:'center', justifyContent:'center', padding:24, color:t3, textAlign:'center' as const }}><div style={{ fontSize:'2.5rem', marginBottom:12 }}>🔑</div><div style={{ color:text, marginBottom:8 }}>Добавьте Gemini API ключ</div><div style={{ fontSize:13 }}>Dashboard → Настройки → Gemini API Key</div><div style={{ fontSize:12, color:t4, marginTop:6 }}>Бесплатно на aistudio.google.com</div></div>:(
              <>
                <div style={{ flex:1, overflowY:'auto' as const, padding:'12px 16px', display:'flex', flexDirection:'column' as const, gap:10 }}>
                  {chatMsgs.length===0&&<div style={{ textAlign:'center' as const, color:t4, padding:'20px 0' }}><div style={{ fontSize:'1.5rem', marginBottom:8 }}>💬</div><div style={{ fontSize:14 }}>Спросите о вашем бизнесе</div></div>}
                  {chatMsgs.map((m,i)=>(
                    <div key={i} style={{ display:'flex', justifyContent:m.role==='user'?'flex-end':'flex-start' }}>
                      <div style={{ maxWidth:'80%', padding:'10px 14px', borderRadius:m.role==='user'?'16px 16px 4px 16px':'16px 16px 16px 4px', background:m.role==='user'?'#007aff':s2, color:m.role==='user'?'#fff':text, fontSize:14, lineHeight:1.5 }}>{m.text}</div>
                    </div>
                  ))}
                  {chatLoading&&<div style={{ display:'flex', justifyContent:'flex-start' }}><div style={{ padding:'10px 14px', borderRadius:'16px 16px 16px 4px', background:s2, color:t3, fontSize:14 }}>Думаю...</div></div>}
                </div>
                <div style={{ padding:'10px 16px 20px', display:'flex', gap:8 }}>
                  <input value={chatInput} onChange={e=>setChatInput(e.target.value)} onKeyDown={e=>e.key==='Enter'&&sendAI()} placeholder="Спросите о бизнесе..." style={{ flex:1, padding:'11px 14px', borderRadius:12, border:`1px solid ${border}`, fontSize:14, color:text, background:surface, fontFamily:'inherit', outline:'none' }} />
                  <button onClick={sendAI} disabled={chatLoading} style={{ padding:'11px 18px', borderRadius:12, background:'#007aff', color:'#fff', border:'none', fontFamily:'inherit', fontSize:14, fontWeight:600, cursor:'pointer' }}>→</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
