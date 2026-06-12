'use client'
import { useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { db } from '@/lib/db'
import { QRCodeSVG as QRCode } from 'qrcode.react'
import { LogoMark } from '@/components/LogoMark'



type Restaurant = {
  id: string; name: string; currency: string
  subscription_status: string; subscription_plan: string
  subscription_ends_at: string; stripe_customer_id?: string
  logo_url?: string; owner_pin?: string
}

const APPS = [
  { id: 'manager',   name: 'Mise Manager',   desc: 'Смены · Расходы · Инкассации · Явка',         color: '#007aff', hint: 'Для менеджеров',  path: '/manager',   plans: ['starter','business','pro'] },
  { id: 'analytics', name: 'Mise Analytics', desc: 'Финансы · Зарплаты · Инкассации · AI',         color: '#34c759', hint: 'Для владельца',   path: '/analytics', plans: ['starter','business','pro'] },
  { id: 'stash',     name: 'Mise Stash',     desc: 'Склад · Приход · Расход · Инвентаризация',     color: '#ff9500', hint: 'Для кальянщика',  path: '/tobacco',   plans: ['business','pro'] },
  { id: 'people',    name: 'Mise People',    desc: 'Смены · Обмены · Явка · Задачи',               color: '#5856d6', hint: 'Для команды',     path: '/people',    plans: ['business','pro'] },
]

const PLANS = [
  { id: 'starter',  name: 'Starter',  price: 14, maxStaff: 2,  color: '#007aff', features: ['Mise Manager', 'Mise Analytics', 'До 2 пользователей'] },
  { id: 'business', name: 'Business', price: 24, maxStaff: 5,  color: '#34c759', popular: true, features: ['Все 3 приложения', 'До 5 пользователей', 'История 12 мес.'] },
  { id: 'pro',      name: 'Pro',      price: 39, maxStaff: 10, color: '#af52de', features: ['Все приложения', 'До 10 пользователей', 'AI-аналитика', 'Интеграция Syrve'] },
]

const ROLE_OPTS = [
  { value: 'waiter', label: 'Официант' }, { value: 'kitchen', label: 'Кухня' }, { value: 'bar', label: 'Бар' },
  { value: 'hookah', label: 'Кальянная' }, { value: 'manager', label: 'Менеджер' }, { value: 'host', label: 'Хостес' },
  { value: 'cleaner', label: 'Уборка' }, { value: 'admin', label: 'Админ' },
]
function roleLabel(role?: string) { return ROLE_OPTS.find(r => r.value === role)?.label || (role || '—') }

const TABS = [
  { id: 'apps',       label: 'Приложения' },
  { id: 'team',       label: 'Команда' },
  { id: 'categories', label: 'Категории' },
  { id: 'settings',   label: 'Настройки' },
  { id: 'billing',    label: 'Подписка' },
]

// SF-Symbols-style line icons for the dashboard tabs (no emoji).
function TabIcon({ id, size = 15 }: { id: string; size?: number }) {
  const p: any = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round', strokeLinejoin: 'round' }
  switch (id) {
    case 'apps':       return <svg {...p}><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>
    case 'employees':  return <svg {...p}><circle cx="9" cy="8" r="3.2"/><path d="M3.5 20c0-3.3 2.5-5.5 5.5-5.5s5.5 2.2 5.5 5.5"/><path d="M16 4.2a3.2 3.2 0 010 6.1M19.5 20c0-2.6-1.3-4.5-3.3-5.2"/></svg>
    case 'categories': return <svg {...p}><path d="M3 7a2 2 0 012-2h4l2 2.5h8A2 2 0 0121 9.5V17a2 2 0 01-2 2H5a2 2 0 01-2-2z"/></svg>
    case 'team':       return <svg {...p}><circle cx="9" cy="8" r="3.2"/><path d="M3.5 20c0-3.3 2.5-5.5 5.5-5.5s5.5 2.2 5.5 5.5"/><path d="M16 4.2a3.2 3.2 0 010 6.1M19.5 20c0-2.6-1.3-4.5-3.3-5.2"/></svg>
    case 'settings':   return <svg {...p}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.6 1.6 0 00-2.7 1.1V21a2 2 0 01-4 0v-.1A1.6 1.6 0 009 19.4a1.6 1.6 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.6 1.6 0 00-1.1-2.7H3a2 2 0 010-4h.1A1.6 1.6 0 004.6 9a1.6 1.6 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1A1.6 1.6 0 009 4.6V3a2 2 0 014 0v.1a1.6 1.6 0 002.7 1.1l.1-.1a2 2 0 112.8 2.8l-.1.1a1.6 1.6 0 00-.3 1.8v.1z"/></svg>
    case 'billing':    return <svg {...p}><rect x="2" y="5" width="20" height="14" rx="2.5"/><path d="M2 10h20"/></svg>
    default:           return null
  }
}

// ── SPLASH SCREEN ─────────────────────────────────────────────────────────────

function SplashScreen({ onDone }: { onDone: () => void }) {
  const [phase, setPhase] = useState<'fill' | 'hold' | 'out'>('fill')
  const [bar1, setBar1] = useState(0)
  const [bar2, setBar2] = useState(0)
  const [bar3, setBar3] = useState(0)

  useEffect(() => {
    // Staggered bar fill
    const t1 = setTimeout(() => setBar1(1), 100)
    const t2 = setTimeout(() => setBar2(1), 300)
    const t3 = setTimeout(() => setBar3(1), 500)
    const t4 = setTimeout(() => setPhase('hold'), 1200)
    const t5 = setTimeout(() => setPhase('out'), 1700)
    const t6 = setTimeout(() => onDone(), 2200)
    return () => [t1,t2,t3,t4,t5,t6].forEach(clearTimeout)
  }, [])

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: '#f2f2f7',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexDirection: 'column', gap: 24,
      transition: phase === 'out' ? 'opacity .45s ease, transform .45s ease' : 'none',
      opacity: phase === 'out' ? 0 : 1,
      transform: phase === 'out' ? 'scale(1.04)' : 'scale(1)',
      pointerEvents: phase === 'out' ? 'none' : 'auto',
    }}>
      {/* Logo mark */}
      <div style={{ position: 'relative' }}>
        <svg width="80" height="80" viewBox="0 0 64 64" fill="none">
          <rect width="64" height="64" rx="18" fill="#007aff"/>
          {/* Bar 1 */}
          <rect x="14" y="20" width="0" height="5" rx="2.5" fill="white"
            style={{ width: bar1 ? 36 : 0, transition: 'width .4s cubic-bezier(.34,1.56,.64,1)' }}/>
          {/* Bar 2 */}
          <rect x="14" y="30" width="0" height="5" rx="2.5" fill="white" opacity=".7"
            style={{ width: bar2 ? 26 : 0, transition: 'width .4s cubic-bezier(.34,1.56,.64,1)' }}/>
          {/* Bar 3 */}
          <rect x="14" y="40" width="0" height="5" rx="2.5" fill="white" opacity=".4"
            style={{ width: bar3 ? 18 : 0, transition: 'width .4s cubic-bezier(.34,1.56,.64,1)' }}/>
        </svg>
      </div>
      <div style={{
        fontSize: '1.8rem', fontWeight: 800, color: '#1c1c1e',
        letterSpacing: '-.04em', fontFamily: '-apple-system,sans-serif',
        opacity: bar3 ? 1 : 0,
        transform: bar3 ? 'translateY(0)' : 'translateY(6px)',
        transition: 'opacity .35s ease, transform .35s ease',
      }}>mise</div>
    </div>
  )
}

// ── UI PRIMITIVES ─────────────────────────────────────────────────────────────

function Card({ children, style = {} }: any) {
  return (
    <div style={{ background: '#fff', borderRadius: 16, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,.06),0 4px 16px rgba(0,0,0,.04)', ...style }}>
      {children}
    </div>
  )
}

function Btn({ children, onClick, variant = 'primary', small = false, disabled = false, full = false }: any) {
  const s: any = {
    primary: { background: '#007aff', color: '#fff', border: 'none' },
    danger:  { background: '#ff3b30', color: '#fff', border: 'none' },
    ghost:   { background: 'transparent', color: '#007aff', border: '1px solid rgba(0,122,255,.3)' },
    gray:    { background: '#f2f2f7', color: '#1c1c1e', border: 'none' },
  }
  return (
    <button onClick={onClick} disabled={disabled} style={{
      ...s[variant], padding: small ? '6px 14px' : '10px 20px',
      borderRadius: 980, fontFamily: 'inherit',
      fontSize: small ? '.78rem' : '.88rem', fontWeight: 600,
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? .5 : 1, transition: 'opacity .15s',
      width: full ? '100%' : undefined,
    }}>
      {children}
    </button>
  )
}

function Field({ label, value, onChange, placeholder, type = 'text', select, options }: any) {
  return (
    <div style={{ marginBottom: 12 }}>
      {label && <label style={{ display: 'block', fontSize: '.72rem', fontWeight: 600, color: '#6d6d72', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '.04em' }}>{label}</label>}
      {select ? (
        <select value={value} onChange={e => onChange(e.target.value)} style={inputStyle}>
          {options.map((o: any) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      ) : (
        <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} style={inputStyle} />
      )}
    </div>
  )
}

const inputStyle: any = {
  width: '100%', padding: '9px 12px', borderRadius: 10,
  border: '1px solid rgba(60,60,67,.2)', fontSize: '.88rem',
  fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
  color: '#1c1c1e', background: '#fff',
}

function SectionTitle({ title, sub }: { title: string; sub?: string }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#1c1c1e', marginBottom: 2 }}>{title}</div>
      {sub && <div style={{ color: '#6d6d72', fontSize: '.83rem' }}>{sub}</div>}
    </div>
  )
}


// ── APPS TAB ──────────────────────────────────────────────────────────────────

function AppsTab({ restaurant }: { restaurant: Restaurant | null }) {
  const router = useRouter()
  const plan = restaurant?.subscription_plan || ''
  const status = restaurant?.subscription_status || ''
  const isActive = status === 'active' || status === 'trialing'

  return (
    <div>
      <SectionTitle title="Приложения" sub={restaurant?.name || '—'} />

      {status === 'trialing' && (
        <div style={{ background: 'rgba(0,122,255,.08)', border: '1px solid rgba(0,122,255,.2)', borderRadius: 12, padding: '12px 16px', marginBottom: 16, fontSize: '.85rem', color: '#007aff', fontWeight: 500 }}>
          Пробный период активен — 7 дней бесплатно
        </div>
      )}
      {!isActive && (
        <div style={{ background: 'rgba(255,59,48,.08)', border: '1px solid rgba(255,59,48,.2)', borderRadius: 12, padding: '12px 16px', marginBottom: 16, fontSize: '.85rem', color: '#ff3b30', fontWeight: 500 }}>
          Подписка неактивна — перейдите во вкладку «Подписка»
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 14, marginBottom: 16 }}>
        {APPS.map(app => {
          const locked = isActive && !app.plans.includes(plan)
          return (
            <Card key={app.id} style={{ borderTop: `3px solid ${locked ? '#c7c7cc' : app.color}`, display: 'flex', flexDirection: 'column', opacity: locked ? .55 : 1 }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'inline-block', background: (locked ? '#c7c7cc' : app.color) + '18', color: locked ? '#aeaeb2' : app.color, fontSize: '.7rem', fontWeight: 700, padding: '3px 10px', borderRadius: 980, marginBottom: 12, letterSpacing: '.02em' }}>{app.hint}</div>
                <div style={{ fontWeight: 700, fontSize: '1rem', marginBottom: 3, color: '#1c1c1e' }}>{app.name}</div>
                <div style={{ color: '#6d6d72', fontSize: '.8rem', marginBottom: 14, lineHeight: 1.5 }}>{app.desc}</div>
              </div>
              <button onClick={() => !locked && isActive && router.push(app.path)} style={{ background: locked || !isActive ? '#f2f2f7' : app.color, color: locked || !isActive ? '#aeaeb2' : '#fff', border: 'none', borderRadius: 10, padding: '9px 0', fontFamily: 'inherit', fontSize: '.85rem', fontWeight: 600, cursor: locked || !isActive ? 'not-allowed' : 'pointer', width: '100%' }}>
                {locked ? 'Недоступно в тарифе' : !isActive ? 'Нет подписки' : 'Открыть →'}
              </button>
            </Card>
          )
        })}
      </div>

      {/* Owner tools — managed from the dashboard, not PIN apps */}
      <div style={{ fontSize: '.72rem', fontWeight: 700, color: '#6d6d72', textTransform: 'uppercase', letterSpacing: '.06em', margin: '4px 2px 10px' }}>Управление</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 14, marginBottom: 16 }}>
        <Card style={{ borderTop: '3px solid #ff2d55', display: 'flex', flexDirection: 'column' }}>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'inline-block', background: '#ff2d5518', color: '#ff2d55', fontSize: '.7rem', fontWeight: 700, padding: '3px 10px', borderRadius: 980, marginBottom: 12, letterSpacing: '.02em' }}>Для гостей</div>
            <div style={{ fontWeight: 700, fontSize: '1rem', marginBottom: 3, color: '#1c1c1e' }}>Mise Menu</div>
            <div style={{ color: '#6d6d72', fontSize: '.8rem', marginBottom: 14, lineHeight: 1.5 }}>QR-меню · Категории · Позиции · Публикация</div>
          </div>
          <button onClick={() => router.push('/dashboard/menu')} style={{ background: '#ff2d55', color: '#fff', border: 'none', borderRadius: 10, padding: '9px 0', fontFamily: 'inherit', fontSize: '.85rem', fontWeight: 600, cursor: 'pointer', width: '100%' }}>
            Открыть редактор →
          </button>
        </Card>
      </div>

      <Card style={{ background: '#f9f9f9', boxShadow: 'none', border: '1px solid rgba(0,0,0,.06)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: '.9rem', marginBottom: 2, color: '#1c1c1e' }}>Установить на iPhone</div>
            <div style={{ color: '#6d6d72', fontSize: '.8rem' }}>Safari → «Поделиться» → «На экран Домой»</div>
          </div>
          <div style={{ background: '#34c75915', color: '#34c759', fontSize: '.72rem', fontWeight: 700, padding: '4px 12px', borderRadius: 980 }}>PWA · Без App Store</div>
        </div>
      </Card>
    </div>
  )
}

// ── EMPLOYEES TAB ─────────────────────────────────────────────────────────────

function EmployeesTab({ restaurantId }: { restaurantId: string }) {
  const [employees, setEmployees] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState({ name: '', salary: '', deduct_per_absence: '', card_amount: '' })

  const load = async () => {
    setLoading(true)
    const { data } = await db.from('employees').select('*').eq('restaurant_id', restaurantId).eq('is_active', true).order('name')
    setEmployees(data || [])
    setLoading(false)
  }

  useEffect(() => { if (restaurantId) load() }, [restaurantId])

  const save = async () => {
    if (!form.name.trim()) return
    const payload = { restaurant_id: restaurantId, name: form.name, salary: +form.salary || 0, deduct_per_absence: +form.deduct_per_absence || 0, card_amount: +form.card_amount || 0, is_active: true }
    if (editingId) await db.from('employees').update(payload).eq('id', editingId)
    else await db.from('employees').insert(payload)
    setForm({ name: '', salary: '', deduct_per_absence: '', card_amount: '' })
    setShowForm(false); setEditingId(null); load()
  }

  const remove = async (id: string) => {
    await db.from('employees').update({ is_active: false }).eq('id', id); load()
  }

  const startEdit = (emp: any) => {
    setForm({ name: emp.name, salary: String(emp.salary), deduct_per_absence: String(emp.deduct_per_absence), card_amount: String(emp.card_amount) })
    setEditingId(emp.id); setShowForm(true)
  }

  const total = employees.reduce((s, e) => s + e.salary, 0)
  const totalCard = employees.reduce((s, e) => s + e.card_amount, 0)

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <SectionTitle title="Сотрудники" sub="Оклады и вычеты" />
        <Btn onClick={() => { setShowForm(!showForm); setEditingId(null); setForm({ name: '', salary: '', deduct_per_absence: '', card_amount: '' }) }}>
          {showForm ? 'Отмена' : '+ Добавить'}
        </Btn>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginBottom: 16 }}>
        {[
          { l: 'Сотрудников', v: String(employees.length), c: '#1c1c1e' },
          { l: 'ФОТ/мес', v: `€${total.toLocaleString()}`, c: '#007aff' },
          { l: 'На карту', v: `€${totalCard.toLocaleString()}`, c: '#af52de' },
        ].map(item => (
          <Card key={item.l} style={{ padding: '14px 16px', textAlign: 'center' }}>
            <div style={{ fontSize: '.68rem', color: '#6d6d72', fontWeight: 600, textTransform: 'uppercase', marginBottom: 4, letterSpacing: '.04em' }}>{item.l}</div>
            <div style={{ fontSize: '1.3rem', fontWeight: 700, color: item.c }}>{item.v}</div>
          </Card>
        ))}
      </div>

      {showForm && (
        <Card style={{ marginBottom: 14, border: '1px solid #007aff' }}>
          <div style={{ fontWeight: 700, fontSize: '.95rem', marginBottom: 14, color: '#1c1c1e' }}>{editingId ? 'Редактировать' : 'Новый сотрудник'}</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div style={{ gridColumn: '1/-1' }}>
              <Field label="Имя" value={form.name} onChange={(v: string) => setForm({ ...form, name: v })} placeholder="Александр Иванов" />
            </div>
            <Field label="Оклад" value={form.salary} onChange={(v: string) => setForm({ ...form, salary: v })} placeholder="1000" type="number" />
            <Field label="Вычет за пропуск" value={form.deduct_per_absence} onChange={(v: string) => setForm({ ...form, deduct_per_absence: v })} placeholder="50" type="number" />
            <div style={{ gridColumn: '1/-1' }}>
              <Field label="На карту (необязательно)" value={form.card_amount} onChange={(v: string) => setForm({ ...form, card_amount: v })} placeholder="0" type="number" />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Btn onClick={save}>{editingId ? 'Сохранить' : 'Добавить'}</Btn>
            <Btn variant="gray" onClick={() => { setShowForm(false); setEditingId(null) }}>Отмена</Btn>
          </div>
        </Card>
      )}

      <Card>
        {loading ? (
          <div style={{ color: '#6d6d72', textAlign: 'center', padding: 32 }}>Загрузка...</div>
        ) : employees.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '28px 0', color: '#6d6d72', fontSize: '.88rem' }}>Добавьте первого сотрудника</div>
        ) : employees.map((emp, i) => (
          <div key={emp.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0', borderBottom: i < employees.length - 1 ? '1px solid rgba(60,60,67,.08)' : 'none', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: '.92rem', marginBottom: 2, color: '#1c1c1e' }}>{emp.name}</div>
              <div style={{ fontSize: '.75rem', color: '#6d6d72', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <span>Оклад: <strong style={{ color: '#1c1c1e' }}>€{emp.salary}</strong></span>
                <span>Вычет: <strong style={{ color: '#1c1c1e' }}>€{emp.deduct_per_absence}</strong></span>
                {emp.card_amount > 0 && <span>Карта: <strong style={{ color: '#af52de' }}>€{emp.card_amount}</strong></span>}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <Btn small variant="ghost" onClick={() => startEdit(emp)}>Изменить</Btn>
              <Btn small variant="danger" onClick={() => remove(emp.id)}>✕</Btn>
            </div>
          </div>
        ))}
      </Card>
    </div>
  )
}

// ── CATEGORIES TAB ────────────────────────────────────────────────────────────

function CategoriesTab({ restaurantId }: { restaurantId: string }) {
  const [cats, setCats] = useState<any[]>([])
  const [newName, setNewName] = useState('')
  const [loading, setLoading] = useState(true)

  const load = async () => {
    setLoading(true)
    const { data } = await db.from('expense_categories').select('*').eq('restaurant_id', restaurantId).order('name')
    setCats(data || []); setLoading(false)
  }

  useEffect(() => { if (restaurantId) load() }, [restaurantId])

  const add = async () => {
    if (!newName.trim()) return
    await db.from('expense_categories').insert({ restaurant_id: restaurantId, name: newName.trim() })
    setNewName(''); load()
  }

  const remove = async (id: string) => {
    // Detach from any saved shift expenses (keeps their category_name) so the FK doesn't block deletion.
    await db.from('shift_expenses').update({ category_id: null }).eq('category_id', id)
    const { error } = await db.from('expense_categories').delete().eq('id', id)
    if (error) { alert('Не удалось удалить категорию: ' + error.message); return }
    load()
  }

  return (
    <div>
      <SectionTitle title="Категории расходов" sub="Менеджер выбирает из этого списка при добавлении расхода" />
      <Card style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', gap: 10 }}>
          <input value={newName} onChange={e => setNewName(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()}
            placeholder="Например: Мойка, DJ, Ремонт..."
            style={{ ...inputStyle, flex: 1 }} />
          <Btn onClick={add}>Добавить</Btn>
        </div>
      </Card>
      <Card>
        <div style={{ fontWeight: 600, fontSize: '.88rem', color: '#6d6d72', marginBottom: 12 }}>Категорий: {cats.length}</div>
        {loading ? <div style={{ color: '#6d6d72', fontSize: '.88rem' }}>Загрузка...</div>
          : cats.length === 0
            ? <div style={{ textAlign: 'center', padding: '20px 0', color: '#6d6d72', fontSize: '.88rem' }}>Нет категорий</div>
            : <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {cats.map(cat => (
                  <div key={cat.id} style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#f2f2f7', borderRadius: 980, padding: '6px 12px' }}>
                    <span style={{ fontSize: '.85rem', fontWeight: 500, color: '#1c1c1e' }}>{cat.name}</span>
                    <button onClick={() => remove(cat.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#aeaeb2', fontSize: '.85rem', padding: 0, lineHeight: 1 }}>✕</button>
                  </div>
                ))}
              </div>
        }
      </Card>
    </div>
  )
}

// ── TEAM TAB ──────────────────────────────────────────────────────────────────

function TeamTab({ restaurant }: { restaurant: Restaurant | null }) {
  const restaurantId = restaurant?.id || ''
  const plan = restaurant?.subscription_plan || 'starter'
  const maxStaff = PLANS.find(p => p.id === plan)?.maxStaff || 2

  const [staff, setStaff] = useState<any[]>([])
  const [employees, setEmployees] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ name: '', role: 'waiter', salary: '', deduct: '', card: '', pin: '', apps: [] as string[] })
  const [saving, setSaving] = useState(false)
  const [editingEmpId, setEditingEmpId] = useState<string | null>(null)
  const [ownerPin, setOwnerPin] = useState(restaurant?.owner_pin || '')
  const [ownerPinEdit, setOwnerPinEdit] = useState(false)
  const [ownerPinVal, setOwnerPinVal] = useState('')
  const [ownerSaving, setOwnerSaving] = useState(false)
  const [ownerSaved, setOwnerSaved] = useState(false)
  const [showQR, setShowQR] = useState(false)

  const blank = { name: '', role: 'waiter', salary: '', deduct: '', card: '', pin: '', apps: [] as string[] }
  const qrUrl = typeof window !== 'undefined' ? `${window.location.origin}/join?restaurant=${restaurantId}` : ''

  const load = async () => {
    setLoading(true)
    const [{ data: staffData }, { data: empData }] = await Promise.all([
      db.from('staff').select('*').eq('restaurant_id', restaurantId).eq('is_active', true).order('name'),
      db.from('employees').select('*').eq('restaurant_id', restaurantId).eq('is_active', true).order('name'),
    ])
    setStaff(staffData || [])
    setEmployees(empData || [])
    setLoading(false)
  }

  useEffect(() => { if (restaurantId) load() }, [restaurantId])

  const saveOwnerPin = async () => {
    if (ownerPinVal.length !== 4 || !/^\d+$/.test(ownerPinVal)) { alert('PIN должен быть 4 цифры'); return }
    setOwnerSaving(true)
    const hashRes = await fetch('/api/auth/pin/hash', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: ownerPinVal }) })
    const { hash } = await hashRes.json()
    await db.from('restaurants').update({ owner_pin: hash }).eq('id', restaurantId)
    setOwnerPin(ownerPinVal); setOwnerPinEdit(false); setOwnerPinVal('')
    setOwnerSaving(false); setOwnerSaved(true); setTimeout(() => setOwnerSaved(false), 2000)
  }

  const toggleApp = (appId: string) => {
    setForm(f => ({ ...f, apps: f.apps.includes(appId) ? f.apps.filter(a => a !== appId) : [...f.apps, appId] }))
  }
  const staffFor = (name: string) => staff.find(s => s.name === name)

  // One save handles both HR (employees) and access (staff).
  const save = async () => {
    if (!form.name.trim()) { alert('Введите имя'); return }
    setSaving(true)
    const name = form.name.trim()
    const empPayload = { restaurant_id: restaurantId, name, salary: +form.salary || 0, deduct_per_absence: +form.deduct || 0, card_amount: +form.card || 0, is_active: true }
    if (editingEmpId) await db.from('employees').update(empPayload).eq('id', editingEmpId)
    else await db.from('employees').insert(empPayload)

    const existing = staffFor(name)
    if (form.apps.length) {
      if (!existing && (form.pin.length !== 4 || !/^\d+$/.test(form.pin))) { alert('Для доступа задайте PIN (4 цифры)'); setSaving(false); return }
      let pinHash: string | undefined
      if (form.pin) { const r = await fetch('/api/auth/pin/hash', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: form.pin }) }); pinHash = (await r.json()).hash }
      const sp: any = { restaurant_id: restaurantId, name, apps: form.apps, role: form.role, is_active: true }
      if (pinHash) sp.pin_hash = pinHash
      if (existing) await db.from('staff').update(sp).eq('id', existing.id)
      else await db.from('staff').insert(sp)
    } else if (existing) {
      await db.from('staff').update({ is_active: false }).eq('id', existing.id) // access revoked
    }
    setForm(blank); setShowForm(false); setEditingEmpId(null); setSaving(false); load()
  }

  const removePerson = async (emp: any) => {
    await db.from('employees').update({ is_active: false }).eq('id', emp.id)
    const s = staffFor(emp.name); if (s) await db.from('staff').update({ is_active: false }).eq('id', s.id)
    load()
  }
  const resetDevice = async (id: string) => { await db.from('staff').update({ device_id: null }).eq('id', id); load() }

  const startEdit = (emp: any) => {
    const s = staffFor(emp.name)
    setForm({ name: emp.name, role: s?.role || 'waiter', salary: String(emp.salary || ''), deduct: String(emp.deduct_per_absence || ''), card: String(emp.card_amount || ''), pin: '', apps: s?.apps || [] })
    setEditingEmpId(emp.id); setShowForm(true)
  }

  const appColor = (id: string) => APPS.find(a => a.id === id)?.color || '#007aff'
  const appName = (id: string) => APPS.find(a => a.id === id)?.name || id
  const totalSalary = employees.reduce((s, e) => s + (e.salary || 0), 0)
  const withAccess = staff.length
  const atLimit = withAccess >= maxStaff

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <SectionTitle title="Команда" sub="Сотрудники, зарплаты и доступы" />
        <Btn onClick={() => { setShowForm(!showForm); setEditingEmpId(null); setForm(blank) }}>
          {showForm ? 'Отмена' : '+ Добавить'}
        </Btn>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginBottom: 16 }}>
        {[{ l: 'В команде', v: String(employees.length), c: '#1c1c1e' }, { l: 'С доступом', v: `${withAccess}/${maxStaff}`, c: '#007aff' }, { l: 'ФОТ/мес', v: `€${totalSalary.toLocaleString()}`, c: '#af52de' }].map(it => (
          <Card key={it.l} style={{ padding: '14px 16px', textAlign: 'center' }}>
            <div style={{ fontSize: '.68rem', color: '#6d6d72', fontWeight: 600, textTransform: 'uppercase', marginBottom: 4, letterSpacing: '.04em' }}>{it.l}</div>
            <div style={{ fontSize: '1.3rem', fontWeight: 700, color: it.c }}>{it.v}</div>
          </Card>
        ))}
      </div>

      {atLimit && (
        <div style={{ background: 'rgba(255,149,0,.08)', border: '1px solid rgba(255,149,0,.25)', borderRadius: 12, padding: '10px 14px', marginBottom: 14, fontSize: '.83rem', color: '#ff9500', fontWeight: 500 }}>
          Лимит доступов тарифа ({maxStaff}). Новым сотрудникам доступ не выдать — обновите подписку.
        </div>
      )}

      {/* ─ QR БЛОК ─ */}
      <Card style={{ marginBottom: 14, background: 'linear-gradient(135deg, #007aff08 0%, #5856d608 100%)', border: '1px solid rgba(0,122,255,.15)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: '.95rem', color: '#1c1c1e', marginBottom: 4 }}>QR-код заведения</div>
            <div style={{ fontSize: '.8rem', color: '#6d6d72', lineHeight: 1.5 }}>
              Сотрудник сканирует при первом входе чтобы привязать устройство к заведению
            </div>
          </div>
          <button onClick={() => setShowQR(!showQR)} style={{ flexShrink: 0, background: '#007aff', border: 'none', borderRadius: 12, padding: '10px 18px', color: '#fff', fontFamily: 'inherit', fontSize: '.85rem', fontWeight: 600, cursor: 'pointer' }}>
            {showQR ? 'Скрыть' : 'Показать QR'}
          </button>
        </div>

        {showQR && (
          <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid rgba(0,122,255,.1)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
            <div style={{ background: '#fff', borderRadius: 16, padding: 16, boxShadow: '0 2px 12px rgba(0,0,0,.08)' }}>
              <QRCode value={qrUrl} size={160} />
            </div>
            <div style={{ fontSize: '.75rem', color: '#aeaeb2', textAlign: 'center', maxWidth: 260, lineHeight: 1.5 }}>
              {qrUrl}
            </div>
            <button onClick={() => {
              if (navigator.clipboard) {
                navigator.clipboard.writeText(qrUrl)
              } else {
                const el = document.createElement('textarea')
                el.value = qrUrl
                document.body.appendChild(el)
                el.select()
                document.execCommand('copy')
                document.body.removeChild(el)
              }
            }} style={{ background: '#f2f2f7', border: 'none', borderRadius: 980, padding: '7px 16px', fontSize: '.78rem', fontWeight: 600, color: '#007aff', cursor: 'pointer', fontFamily: 'inherit' }}>
              Скопировать ссылку
            </button>
          </div>
        )}
      </Card>

      {/* ─ ВЛАДЕЛЕЦ PIN ─ */}
      <Card style={{ marginBottom: 14, border: '1px solid rgba(175,82,222,.2)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <div style={{ fontWeight: 700, fontSize: '.95rem', color: '#1c1c1e' }}>Владелец</div>
              <div style={{ fontSize: '.7rem', fontWeight: 700, padding: '2px 8px', borderRadius: 980, background: '#af52de15', color: '#af52de' }}>Полный доступ</div>
            </div>
            <div style={{ fontSize: '.8rem', color: '#6d6d72' }}>
              {ownerPin ? 'PIN установлен · Доступ ко всем приложениям' : 'PIN не установлен'}
            </div>
          </div>
          <button onClick={() => { setOwnerPinEdit(!ownerPinEdit); setOwnerPinVal('') }} style={{ background: 'none', border: '1px solid rgba(175,82,222,.3)', borderRadius: 980, padding: '7px 14px', fontSize: '.78rem', fontWeight: 600, color: '#af52de', cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 }}>
            {ownerPinEdit ? 'Отмена' : ownerPin ? 'Изменить PIN' : 'Задать PIN'}
          </button>
        </div>

        {ownerPinEdit && (
          <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid rgba(175,82,222,.1)', display: 'flex', gap: 10, alignItems: 'flex-end' }}>
            <div style={{ flex: 1 }}>
              <label style={{ display: 'block', fontSize: '.72rem', fontWeight: 600, color: '#6d6d72', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '.04em' }}>Новый PIN (4 цифры)</label>
              <input
                type="password" inputMode="numeric" maxLength={4}
                value={ownerPinVal} onChange={e => setOwnerPinVal(e.target.value.replace(/\D/g,'').slice(0,4))}
                placeholder="••••"
                style={{ ...inputStyle, letterSpacing: '.2em', fontSize: '1.2rem', textAlign: 'center' }}
              />
            </div>
            <Btn onClick={saveOwnerPin} disabled={ownerSaving}>
              {ownerSaving ? '...' : ownerSaved ? '✓' : 'Сохранить'}
            </Btn>
          </div>
        )}
      </Card>

      {/* ─ ФОРМА ─ */}
      {showForm && (
        <Card style={{ marginBottom: 14, border: '1px solid #007aff' }}>
          <div style={{ fontWeight: 700, fontSize: '.95rem', marginBottom: 14 }}>{editingEmpId ? 'Редактировать сотрудника' : 'Новый сотрудник'}</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div style={{ gridColumn: '1/-1' }}>
              <Field label="Имя" value={form.name} onChange={(v: string) => setForm({ ...form, name: v })} placeholder="Александр Иванов" />
            </div>
            <Field label="Роль" value={form.role} onChange={(v: string) => setForm({ ...form, role: v })} select options={ROLE_OPTS} />
            <Field label="Оклад" value={form.salary} onChange={(v: string) => setForm({ ...form, salary: v })} placeholder="1000" type="number" />
            <Field label="Вычет за пропуск" value={form.deduct} onChange={(v: string) => setForm({ ...form, deduct: v })} placeholder="50" type="number" />
            <Field label="На карту" value={form.card} onChange={(v: string) => setForm({ ...form, card: v })} placeholder="0" type="number" />
          </div>

          <div style={{ borderTop: '1px solid rgba(60,60,67,.1)', margin: '8px 0 14px', paddingTop: 14 }}>
            <div style={{ fontSize: '.72rem', fontWeight: 600, color: '#6d6d72', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '.04em' }}>Доступ к приложениям</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
              {APPS.map(app => (
                <label key={app.id} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', padding: '9px 12px', borderRadius: 10, background: form.apps.includes(app.id) ? app.color + '10' : '#f9f9f9', border: `1px solid ${form.apps.includes(app.id) ? app.color : 'transparent'}`, transition: 'all .15s' }}>
                  <input type="checkbox" checked={form.apps.includes(app.id)} onChange={() => toggleApp(app.id)} style={{ width: 16, height: 16, accentColor: app.color }} />
                  <div>
                    <div style={{ fontSize: '.88rem', fontWeight: 600, color: '#1c1c1e' }}>{app.name}</div>
                    <div style={{ fontSize: '.72rem', color: '#6d6d72' }}>{app.hint}</div>
                  </div>
                </label>
              ))}
            </div>
            {form.apps.length > 0 && (
              <Field
                label={staffFor(form.name.trim()) ? 'Новый PIN (оставьте пустым чтобы не менять)' : 'PIN-код для входа (4 цифры)'}
                value={form.pin} onChange={(v: string) => setForm({ ...form, pin: v.replace(/\D/g, '').slice(0, 4) })}
                placeholder="1234" type="password"
              />
            )}
            <div style={{ fontSize: '.72rem', color: '#aeaeb2' }}>Без выбранных приложений сотрудник учитывается в зарплатах, но не входит в приложения.</div>
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <Btn onClick={save} disabled={saving}>{saving ? 'Сохранение...' : editingEmpId ? 'Сохранить' : 'Добавить'}</Btn>
            <Btn variant="gray" onClick={() => { setShowForm(false); setEditingEmpId(null) }}>Отмена</Btn>
          </div>
        </Card>
      )}

      {/* ─ СПИСОК ─ */}
      {loading ? (
        <div style={{ color: '#6d6d72', textAlign: 'center', padding: 32 }}>Загрузка...</div>
      ) : employees.length === 0 ? (
        <Card><div style={{ textAlign: 'center', padding: '28px 0', color: '#6d6d72', fontSize: '.88rem' }}>Добавьте первого сотрудника</div></Card>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {employees.map(emp => {
            const s = staffFor(emp.name)
            return (
              <Card key={emp.id} style={{ padding: 16 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                      <div style={{ fontWeight: 700, fontSize: '.95rem', color: '#1c1c1e' }}>{emp.name}</div>
                      <div style={{ fontSize: '.7rem', fontWeight: 600, padding: '2px 8px', borderRadius: 980, background: '#5856d615', color: '#5856d6' }}>{roleLabel(s?.role)}</div>
                      {s
                        ? <div style={{ fontSize: '.7rem', fontWeight: 600, padding: '2px 8px', borderRadius: 980, background: s.device_id ? '#34c75915' : '#f2f2f7', color: s.device_id ? '#34c759' : '#aeaeb2' }}>{s.device_id ? '● Привязано' : 'Не привязано'}</div>
                        : <div style={{ fontSize: '.7rem', fontWeight: 600, padding: '2px 8px', borderRadius: 980, background: '#f2f2f7', color: '#aeaeb2' }}>Нет доступа</div>}
                    </div>
                    <div style={{ fontSize: '.75rem', color: '#6d6d72', display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: s ? 8 : 0 }}>
                      <span>Оклад: <strong style={{ color: '#1c1c1e' }}>€{emp.salary}</strong></span>
                      <span>Вычет: <strong style={{ color: '#1c1c1e' }}>€{emp.deduct_per_absence}</strong></span>
                      {emp.card_amount > 0 && <span>Карта: <strong style={{ color: '#af52de' }}>€{emp.card_amount}</strong></span>}
                    </div>
                    {s && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                        {(s.apps || []).map((appId: string) => (
                          <span key={appId} style={{ fontSize: '.7rem', fontWeight: 600, padding: '2px 8px', borderRadius: 980, background: appColor(appId) + '15', color: appColor(appId) }}>{appName(appId)}</span>
                        ))}
                        {s.device_id && <button onClick={() => resetDevice(s.id)} style={{ background: 'none', border: 'none', color: '#ff9500', fontSize: '.75rem', fontWeight: 600, cursor: 'pointer', padding: 0, fontFamily: 'inherit' }}>Сбросить устройство</button>}
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                    <Btn small variant="ghost" onClick={() => startEdit(emp)}>Изменить</Btn>
                    <Btn small variant="danger" onClick={() => removePerson(emp)}>✕</Btn>
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── SETTINGS TAB ──────────────────────────────────────────────────────────────

// ── GEO / ATTENDANCE SETTINGS (mise People) ───────────────────────────────────

function MiniToggle({ value, onChange, color = '#5856d6' }: { value: boolean; onChange: (v: boolean) => void; color?: string }) {
  return (
    <div onClick={() => onChange(!value)} style={{ width: 46, height: 28, borderRadius: 14, background: value ? color : 'rgba(120,120,128,0.32)', cursor: 'pointer', transition: 'background .2s', position: 'relative', flexShrink: 0 }}>
      <div style={{ position: 'absolute', top: 2, left: value ? 20 : 2, width: 24, height: 24, borderRadius: '50%', background: '#fff', boxShadow: '0 2px 5px rgba(0,0,0,.25)', transition: 'left .2s' }} />
    </div>
  )
}

function GeoSettingsCard() {
  const [row, setRow] = useState<any>(null)
  const [f, setF] = useState({ attendance_enabled: false, latitude: '', longitude: '', geo_radius_m: '150', reminder_mode: 'hours_before', reminder_hours: '12', reminder_time: '18:00' })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [locating, setLocating] = useState(false)

  useEffect(() => {
    db.from('restaurant_settings').select('*').limit(1).then(({ data }: any) => {
      const r = Array.isArray(data) ? data[0] : data
      if (r) {
        setRow(r)
        setF({
          attendance_enabled: !!r.attendance_enabled,
          latitude: r.latitude != null ? String(r.latitude) : '',
          longitude: r.longitude != null ? String(r.longitude) : '',
          geo_radius_m: String(r.geo_radius_m ?? 150),
          reminder_mode: r.reminder_mode || 'hours_before',
          reminder_hours: String(r.reminder_hours ?? 12),
          reminder_time: (r.reminder_time || '18:00').slice(0, 5),
        })
      }
    })
  }, [])

  const useMyLocation = () => {
    if (!navigator.geolocation) return
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      p => { setF(s => ({ ...s, latitude: p.coords.latitude.toFixed(6), longitude: p.coords.longitude.toFixed(6) })); setLocating(false) },
      () => { alert('Не удалось получить местоположение'); setLocating(false) },
      { enableHighAccuracy: true, timeout: 10000 }
    )
  }

  const save = async () => {
    setSaving(true)
    const payload: any = {
      attendance_enabled: f.attendance_enabled,
      latitude: f.latitude ? Number(f.latitude) : null,
      longitude: f.longitude ? Number(f.longitude) : null,
      geo_radius_m: parseInt(f.geo_radius_m) || 150,
      reminder_mode: f.reminder_mode,
      reminder_hours: parseInt(f.reminder_hours) || 12,
      reminder_time: f.reminder_time || '18:00',
    }
    if (row?.id) await db.from('restaurant_settings').update(payload).eq('id', row.id)
    else { const { data } = await db.from('restaurant_settings').insert(payload).select().single(); if (data) setRow(data) }
    setSaving(false); setSaved(true); setTimeout(() => setSaved(false), 2000)
  }

  return (
    <Card style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: '.9rem', color: '#1c1c1e' }}>Геолокация и явка</div>
          <div style={{ fontSize: '.78rem', color: '#6d6d72', marginTop: 2 }}>Mise People — авто-отметка прихода по гео</div>
        </div>
        <MiniToggle value={f.attendance_enabled} onChange={v => setF({ ...f, attendance_enabled: v })} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 4 }}>
        <Field label="Широта" value={f.latitude} onChange={(v: string) => setF({ ...f, latitude: v })} placeholder="41.3111" />
        <Field label="Долгота" value={f.longitude} onChange={(v: string) => setF({ ...f, longitude: v })} placeholder="69.2797" />
      </div>
      <button onClick={useMyLocation} style={{ background: '#f2f2f7', border: 'none', borderRadius: 980, padding: '7px 16px', fontSize: '.78rem', fontWeight: 600, color: '#5856d6', cursor: 'pointer', fontFamily: 'inherit', marginBottom: 12 }}>
        {locating ? 'Определяю…' : 'Использовать моё местоположение'}
      </button>
      <Field label="Радиус, метров" value={f.geo_radius_m} onChange={(v: string) => setF({ ...f, geo_radius_m: v })} type="number" placeholder="150" />

      <div style={{ fontWeight: 600, fontSize: '.82rem', color: '#1c1c1e', margin: '8px 0 10px' }}>Напоминание о смене</div>
      <Field label="Режим" value={f.reminder_mode} onChange={(v: string) => setF({ ...f, reminder_mode: v })} select options={[{ value: 'hours_before', label: 'За N часов до смены' }, { value: 'fixed_time', label: 'В фикс. время накануне' }]} />
      {f.reminder_mode === 'hours_before'
        ? <Field label="За сколько часов" value={f.reminder_hours} onChange={(v: string) => setF({ ...f, reminder_hours: v })} type="number" placeholder="12" />
        : <Field label="Время (накануне)" value={f.reminder_time} onChange={(v: string) => setF({ ...f, reminder_time: v })} type="time" />}

      <Btn onClick={save}>{saving ? 'Сохранение...' : saved ? '✓ Сохранено' : 'Сохранить'}</Btn>
    </Card>
  )
}

// Безнал в аналитике: менеджер не видит расходов по карте, поэтому включённый безнал
// раздувает итог. По умолчанию выкл — владелец видит реальные (наличные) показатели.
function AnalyticsSettingsCard() {
  const [row, setRow] = useState<any>(null)
  const [includeCard, setIncludeCard] = useState(false)

  useEffect(() => {
    db.from('restaurant_settings').select('*').limit(1).then(({ data }: any) => {
      const r = Array.isArray(data) ? data[0] : data
      if (r) { setRow(r); setIncludeCard(!!r.include_card_in_analytics) }
    })
  }, [])

  const toggle = async (v: boolean) => {
    setIncludeCard(v)
    if (row?.id) await db.from('restaurant_settings').update({ include_card_in_analytics: v }).eq('id', row.id)
    else { const { data } = await db.from('restaurant_settings').insert({ include_card_in_analytics: v }).select().single(); if (data) setRow(data) }
  }

  return (
    <Card style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: '.9rem', color: '#1c1c1e' }}>Учитывать безнал в аналитике</div>
          <div style={{ fontSize: '.78rem', color: '#6d6d72', marginTop: 2, maxWidth: 380 }}>
            Включает доход по карте в показатели Mise Analytics. Выкл — показатели только по наличным (касса всегда считается от наличных).
          </div>
        </div>
        <MiniToggle value={includeCard} onChange={toggle} color="#34c759" />
      </div>
    </Card>
  )
}

function SettingsTab({ restaurant, onUpdate }: { restaurant: Restaurant | null; onUpdate: () => void }) {
  const router = useRouter()
  const [name, setName] = useState(restaurant?.name || '')
  const [currency, setCurrency] = useState(restaurant?.currency || '€')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [logoFile, setLogoFile] = useState<File | null>(null)
  const [logoPreview, setLogoPreview] = useState(restaurant?.logo_url || '')
  const [logoUploading, setLogoUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    if (restaurant) { setName(restaurant.name); setCurrency(restaurant.currency || '€'); setLogoPreview(restaurant.logo_url || '') }
  }, [restaurant])

  const pickLogo = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setLogoFile(file)
    setLogoPreview(URL.createObjectURL(file))
  }

  const uploadLogo = async () => {
    if (!logoFile || !restaurant) return
    setLogoUploading(true)
    const ext = logoFile.name.split('.').pop()
    const path = `logos/${restaurant.id}.${ext}`
    const { error } = await supabase.storage.from('restaurant-assets').upload(path, logoFile, { upsert: true })
    if (!error) {
      const { data: { publicUrl } } = supabase.storage.from('restaurant-assets').getPublicUrl(path)
      await db.from('restaurants').update({ logo_url: publicUrl }).eq('id', restaurant.id)
      onUpdate()
    }
    setLogoUploading(false)
  }

  const save = async () => {
    if (!restaurant) return
    setSaving(true)
    await db.from('restaurants').update({ name, currency }).eq('id', restaurant.id)
    if (logoFile) await uploadLogo()
    setSaving(false); setSaved(true); setTimeout(() => setSaved(false), 2000); onUpdate()
  }

  const deleteAccount = async () => {
    setDeleting(true)
    try {
      const res = await fetch('/api/account/delete', { method: 'POST' })
      const data = await res.json()
      if (data.error) { alert(data.error); return }
      await supabase.auth.signOut()
      router.replace('/auth/login')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div>
      <SectionTitle title="Настройки" sub="Основные параметры заведения" />

      {/* Логотип */}
      <Card style={{ marginBottom: 14 }}>
        <div style={{ fontWeight: 600, fontSize: '.9rem', marginBottom: 14, color: '#1c1c1e' }}>Логотип заведения</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ width: 72, height: 72, borderRadius: 16, background: '#f2f2f7', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid rgba(60,60,67,.12)', flexShrink: 0 }}>
            {logoPreview ? (
              <img src={logoPreview} alt="logo" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <svg width="30" height="30" fill="none" stroke="#aeaeb2" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M3 3v18M8 3v6a3 3 0 01-3 3M14 21V3c-1.7 0-3 2.7-3 6 0 2.5 1.3 4.2 3 4.5"/></svg>
            )}
          </div>
          <div>
            <div style={{ fontSize: '.85rem', color: '#1c1c1e', fontWeight: 500, marginBottom: 6 }}>
              {logoPreview ? 'Логотип загружен' : 'Логотип не загружен'}
            </div>
            <div style={{ fontSize: '.78rem', color: '#6d6d72', marginBottom: 10 }}>
              Отображается на экране входа для сотрудников
            </div>
            <button onClick={() => fileRef.current?.click()} style={{ background: '#f2f2f7', border: 'none', borderRadius: 980, padding: '7px 16px', fontSize: '.78rem', fontWeight: 600, color: '#007aff', cursor: 'pointer', fontFamily: 'inherit' }}>
              {logoPreview ? 'Заменить' : 'Загрузить фото'}
            </button>
            <input ref={fileRef} type="file" accept="image/*" onChange={pickLogo} style={{ display: 'none' }} />
          </div>
        </div>
      </Card>

      <Card style={{ marginBottom: 14 }}>
        <div style={{ fontWeight: 600, fontSize: '.9rem', marginBottom: 14, color: '#1c1c1e' }}>Заведение</div>
        <Field label="Название" value={name} onChange={setName} placeholder="Название ресторана" />
        <Field
          label="Валюта"
          value={currency}
          onChange={setCurrency}
          select
          options={[
            { value: '€', label: '€ — Евро' },
            { value: '₸', label: '₸ — Тенге' },
            { value: '₽', label: '₽ — Рубль' },
            { value: '$', label: '$ — Доллар' },
          ]}
        />
        <Btn onClick={save}>{saving ? 'Сохранение...' : saved ? '✓ Сохранено' : 'Сохранить'}</Btn>
      </Card>

      <AnalyticsSettingsCard />

      <GeoSettingsCard />

      <Card style={{ border: '1px solid rgba(255,59,48,.15)' }}>
        <div style={{ fontWeight: 600, fontSize: '.9rem', marginBottom: 4, color: '#1c1c1e' }}>Опасная зона</div>
        <div style={{ fontSize: '.82rem', color: '#6d6d72', marginBottom: 14 }}>Удаление аккаунта необратимо. Все данные заведения, сотрудники и подписка будут удалены.</div>
        {!deleteConfirm ? (
          <Btn variant="danger" onClick={() => setDeleteConfirm(true)}>Удалить аккаунт</Btn>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: '.82rem', color: '#ff3b30', fontWeight: 600 }}>Вы уверены? Это действие нельзя отменить.</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <Btn variant="danger" small onClick={deleteAccount} disabled={deleting}>
                {deleting ? 'Удаление...' : 'Да, удалить всё'}
              </Btn>
              <Btn variant="ghost" small onClick={() => setDeleteConfirm(false)}>Отмена</Btn>
            </div>
          </div>
        )}
      </Card>
    </div>
  )
}

// ── BILLING TAB ───────────────────────────────────────────────────────────────

function BillingTab({ restaurant, user, onRefresh }: { restaurant: Restaurant | null; user: any; onRefresh: () => void }) {
  const [loading, setLoading] = useState(false)
  const [cancelConfirm, setCancelConfirm] = useState(false)

  const currentPlan = PLANS.find(p => p.id === restaurant?.subscription_plan)
  const status = restaurant?.subscription_status
  const endsAt = restaurant?.subscription_ends_at ? new Date(restaurant.subscription_ends_at) : null
  const isActive = status === 'active' || status === 'trialing'

  const statusLabel: Record<string, { label: string; color: string; bg: string }> = {
    trialing: { label: 'Пробный период', color: '#007aff', bg: 'rgba(0,122,255,.1)' },
    active:   { label: 'Активна',        color: '#34c759', bg: 'rgba(52,199,89,.1)' },
    past_due: { label: 'Просрочена',     color: '#ff9500', bg: 'rgba(255,149,0,.1)' },
    canceling: { label: 'Отмена в конце периода', color: '#ff9500', bg: 'rgba(255,149,0,.1)' },
    canceled:  { label: 'Отменена',       color: '#ff3b30', bg: 'rgba(255,59,48,.1)' },
    inactive:  { label: 'Неактивна',      color: '#aeaeb2', bg: '#f2f2f7' },
  }
  const badge = statusLabel[status || 'inactive'] || statusLabel['inactive']

  const subscribe = async (planId: string) => {
    if (!restaurant || !user) return
    setLoading(true)
    try {
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: planId, restaurantId: restaurant.id, userId: user.id, email: user.email }),
      })
      const { url, error } = await res.json()
      if (error) { alert(error); return }
      if (url) window.top.location.href = url
    } finally { setLoading(false) }
  }

  const cancel = async () => {
    if (!restaurant) return
    setLoading(true)
    try {
      const res = await fetch('/api/stripe/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ restaurantId: restaurant.id }),
      })
      const data = await res.json()
      if (data.error) { alert(data.error); return }
      setCancelConfirm(false)
      onRefresh()
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <SectionTitle title="Подписка" sub="Управление тарифом и оплатой" />

      {currentPlan && (
        <Card style={{ marginBottom: 16, border: `1px solid ${currentPlan.color}25` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <div style={{ display: 'inline-block', background: badge.bg, color: badge.color, fontSize: '.72rem', fontWeight: 700, padding: '3px 10px', borderRadius: 980, marginBottom: 10 }}>{badge.label}</div>
              <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#1c1c1e', marginBottom: 2 }}>{currentPlan.name}</div>
              {endsAt && (
                <div style={{ fontSize: '.8rem', color: '#6d6d72' }}>
                  {isActive ? 'Следующий платёж' : 'Доступ до'}: {endsAt.toLocaleDateString('ru-RU')}
                </div>
              )}
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '1.8rem', fontWeight: 700, color: '#1c1c1e' }}>€{currentPlan.price}</div>
              <div style={{ color: '#6d6d72', fontSize: '.78rem' }}>в месяц</div>
            </div>
          </div>
          {isActive && (
            <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid rgba(60,60,67,.08)' }}>
              {!cancelConfirm ? (
                <button onClick={() => setCancelConfirm(true)} style={{ background: 'none', border: 'none', color: '#ff3b30', fontSize: '.82rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>
                  Отменить подписку
                </button>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '.82rem', color: '#6d6d72' }}>Подтвердить отмену?</span>
                  <Btn small variant="danger" onClick={cancel} disabled={loading}>Да, отменить</Btn>
                  <Btn small variant="gray" onClick={() => setCancelConfirm(false)}>Нет</Btn>
                </div>
              )}
            </div>
          )}
        </Card>
      )}

      <div style={{ fontWeight: 600, fontSize: '.78rem', color: '#6d6d72', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '.06em' }}>
        {currentPlan ? 'Сменить тариф' : 'Выберите тариф'}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 12, marginBottom: 16 }}>
        {PLANS.map(plan => {
          const isCurrent = restaurant?.subscription_plan === plan.id
          return (
            <Card key={plan.id} style={{ border: `2px solid ${isCurrent ? plan.color : plan.popular ? plan.color + '40' : 'rgba(60,60,67,.1)'}`, position: 'relative', padding: 16 }}>
              {plan.popular && !isCurrent && (
                <div style={{ position: 'absolute', top: -10, left: '50%', transform: 'translateX(-50%)', background: plan.color, color: '#fff', fontSize: '.65rem', fontWeight: 700, padding: '3px 10px', borderRadius: 980, whiteSpace: 'nowrap' }}>ПОПУЛЯРНЫЙ</div>
              )}
              {isCurrent && (
                <div style={{ position: 'absolute', top: -10, left: '50%', transform: 'translateX(-50%)', background: plan.color, color: '#fff', fontSize: '.65rem', fontWeight: 700, padding: '3px 10px', borderRadius: 980, whiteSpace: 'nowrap' }}>ТЕКУЩИЙ</div>
              )}
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontWeight: 700, fontSize: '1.05rem', color: '#1c1c1e', marginBottom: 2 }}>{plan.name}</div>
                <div style={{ fontSize: '1.5rem', fontWeight: 700, color: plan.color }}>€{plan.price}<span style={{ fontSize: '.75rem', color: '#6d6d72', fontWeight: 400 }}>/мес</span></div>
              </div>
              <div style={{ marginBottom: 14 }}>
                {plan.features.map(f => (
                  <div key={f} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '.8rem', color: '#3c3c43', marginBottom: 4 }}>
                    <span style={{ color: plan.color, fontWeight: 700 }}>✓</span> {f}
                  </div>
                ))}
              </div>
              <button onClick={() => !isCurrent && subscribe(plan.id)} disabled={isCurrent || loading}
                style={{ width: '100%', padding: '9px 0', borderRadius: 10, border: 'none', background: isCurrent ? '#f2f2f7' : plan.color, color: isCurrent ? '#aeaeb2' : '#fff', fontFamily: 'inherit', fontSize: '.85rem', fontWeight: 600, cursor: isCurrent ? 'default' : 'pointer' }}>
                {isCurrent ? 'Активен' : loading ? '...' : 'Выбрать'}
              </button>
            </Card>
          )
        })}
      </div>

      <div style={{ textAlign: 'center', fontSize: '.75rem', color: '#aeaeb2' }}>
        Платежи защищены через Stripe · 7 дней бесплатно при первой оплате
      </div>
    </div>
  )
}

// ── MAIN ──────────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const router = useRouter()
  const [showSplash, setShowSplash] = useState(() => {
    if (typeof window === 'undefined') return false
    const shown = sessionStorage.getItem('mise_splash_shown')
    return !shown
  })
  const [user, setUser] = useState<any>(null)
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null)
  const [tab, setTab] = useState('apps')
  const [authChecked, setAuthChecked] = useState(false)

  const loadRestaurant = async (userId: string) => {
    const { data } = await db.from('restaurants').select('*').eq('owner_id', userId).single()
    setRestaurant(data)
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const t = params.get('tab')
    if (t) setTab(t)
    supabase.auth.getSession().then(async ({ data }) => {
      if (!data.session?.user) {
        setAuthChecked(true)
        router.replace('/auth/login')
        return
      }
      setUser(data.session.user)
      await loadRestaurant(data.session.user.id)
      setAuthChecked(true)
    })
  }, [])

  if (!authChecked || !user) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: '-apple-system,sans-serif', color: '#6d6d72', fontSize: '.9rem', background: '#f2f2f7' }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
        <LogoMark size={48} />
        <div style={{ fontSize: '.85rem', color: '#aeaeb2' }}>Загрузка...</div>
      </div>
    </div>
  )

  return (
    <>
      {showSplash && <SplashScreen onDone={() => { sessionStorage.setItem('mise_splash_shown', '1'); setShowSplash(false) }} />}

      <div style={{ minHeight: '100vh', background: '#f2f2f7', fontFamily: '-apple-system,BlinkMacSystemFont,sans-serif', WebkitFontSmoothing: 'antialiased' }}>
        {/* NAV */}
        <nav style={{ background: 'rgba(255,255,255,.92)', backdropFilter: 'blur(20px)', borderBottom: '1px solid rgba(60,60,67,.1)', padding: '0 20px', height: 52, display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 100 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <LogoMark size={28} />
            <span style={{ fontWeight: 800, fontSize: '1.05rem', color: '#1c1c1e', letterSpacing: '-.02em' }}>mise</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: '.75rem', color: '#aeaeb2', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.email}</span>
            <button onClick={async () => { await supabase.auth.signOut(); router.replace('/auth/login') }}
              style={{ background: 'none', border: 'none', color: '#ff3b30', cursor: 'pointer', fontSize: '.78rem', fontFamily: 'inherit', fontWeight: 600 }}>
              Выйти
            </button>
          </div>
        </nav>

        <div style={{ maxWidth: 920, margin: '0 auto', padding: '20px 16px' }}>
          {/* Page header */}
          <div style={{ marginBottom: 18 }}>
            <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#1c1c1e', marginBottom: 2 }}>{restaurant?.name || 'Мой ресторан'}</div>
            <div style={{ color: '#aeaeb2', fontSize: '.78rem' }}>Личный кабинет</div>
          </div>

          {/* Tabs */}
          <div style={{ display: 'flex', gap: 4, marginBottom: 20, overflowX: 'auto', paddingBottom: 2, scrollbarWidth: 'none' }}>
            {TABS.map(t => (
              <button key={t.id} onClick={() => setTab(t.id)} style={{
                display: 'flex', alignItems: 'center', gap: 7,
                padding: '7px 15px', borderRadius: 10, border: 'none', fontFamily: 'inherit',
                fontSize: '.8rem', fontWeight: tab === t.id ? 700 : 500,
                cursor: 'pointer', whiteSpace: 'nowrap',
                background: tab === t.id ? '#1c1c1e' : '#fff',
                color: tab === t.id ? '#fff' : '#3c3c43',
                boxShadow: tab === t.id ? 'none' : '0 1px 3px rgba(0,0,0,.06)',
                transition: 'all .15s',
              }}>
                <TabIcon id={t.id} />
                {t.label}
              </button>
            ))}
          </div>

          {tab === 'apps'       && <AppsTab restaurant={restaurant} />}
          {tab === 'categories' && restaurant && <CategoriesTab restaurantId={restaurant.id} />}
          {tab === 'team'       && <TeamTab restaurant={restaurant} />}
          {tab === 'settings'   && <SettingsTab restaurant={restaurant} onUpdate={() => user && loadRestaurant(user.id)} />}
          {tab === 'billing'    && <BillingTab restaurant={restaurant} user={user} onRefresh={() => user && loadRestaurant(user.id)} />}
        </div>
      </div>
    </>
  )
}
