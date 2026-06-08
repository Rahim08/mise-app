'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

type Employee = { id: string; name: string; salary: number; deduct_per_absence: number; card_amount: number; is_active: boolean }
type Category = { id: string; name: string; is_salary: boolean }
type Restaurant = { id: string; name: string; currency: string }

function Badge({ children, color = '#0071e3' }: { children: any; color?: string }) {
  return <span style={{ background: color + '18', color, fontSize: '.7rem', fontWeight: 600, padding: '3px 10px', borderRadius: 980, letterSpacing: '.02em' }}>{children}</span>
}

function Card({ children, style = {} }: { children: any; style?: any }) {
  return <div style={{ background: '#fff', borderRadius: 20, padding: 28, boxShadow: '0 2px 12px rgba(0,0,0,0.06)', ...style }}>{children}</div>
}

function SectionTitle({ children }: { children: any }) {
  return <div style={{ fontWeight: 700, fontSize: '1.05rem', letterSpacing: '-.01em', marginBottom: 20 }}>{children}</div>
}

function Input({ label, value, onChange, placeholder, type = 'text' }: any) {
  return (
    <div style={{ marginBottom: 16 }}>
      {label && <label style={{ display: 'block', fontSize: '.78rem', fontWeight: 600, color: '#6e6e73', marginBottom: 6, textTransform: 'uppercase' as const, letterSpacing: '.04em' }}>{label}</label>}
      <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        style={{ width: '100%', padding: '11px 14px', borderRadius: 12, border: '0.5px solid rgba(0,0,0,0.15)', fontSize: '.9rem', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' as const }} />
    </div>
  )
}

function Btn({ children, onClick, variant = 'primary', small = false }: any) {
  const styles: any = {
    primary: { background: '#0071e3', color: '#fff', border: 'none' },
    danger: { background: '#ff3b30', color: '#fff', border: 'none' },
    ghost: { background: 'transparent', color: '#0071e3', border: '0.5px solid rgba(0,113,227,.3)' },
    gray: { background: '#f5f5f7', color: '#1d1d1f', border: 'none' },
  }
  return (
    <button onClick={onClick} style={{ ...styles[variant], padding: small ? '7px 16px' : '11px 24px', borderRadius: 980, fontFamily: 'inherit', fontSize: small ? '.78rem' : '.88rem', fontWeight: 500, cursor: 'pointer' }}>
      {children}
    </button>
  )
}

const TABS = [
  { id: 'apps', label: '📱 Приложения' },
  { id: 'employees', label: '👥 Сотрудники' },
  { id: 'categories', label: '📂 Категории' },
  { id: 'team', label: '🔑 Доступы' },
  { id: 'settings', label: '⚙️ Настройки' },
  { id: 'billing', label: '💳 Подписка' },
]

function AppsTab({ restaurant }: { restaurant: Restaurant | null }) {
  const apps = [
    { icon: '📋', name: 'SO Manager', desc: 'Смены · Доходы · Расходы · Инкассации', color: '#0071e3', hint: 'Для менеджеров смены' },
    { icon: '📊', name: 'SO Analytics', desc: 'Финансы · Зарплаты · Инкасс · Кальян', color: '#30d158', hint: 'Только для владельца' },
    { icon: '💨', name: 'SO Tobacco', desc: 'Склад · Приход · Расход · Инвентаризация', color: '#ff9f0a', hint: 'Для кальянщика' },
  ]
  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: '1.4rem', fontWeight: 700, letterSpacing: '-.03em', marginBottom: 4 }}>Ваши приложения</div>
        <div style={{ color: '#6e6e73', fontSize: '.88rem' }}>Ресторан: <strong>{restaurant?.name || '—'}</strong></div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: 16, marginBottom: 24 }}>
        {apps.map(app => (
          <Card key={app.name} style={{ cursor: 'pointer', borderTop: `3px solid ${app.color}` }}>
            <div style={{ fontSize: '2.2rem', marginBottom: 12 }}>{app.icon}</div>
            <div style={{ fontWeight: 700, fontSize: '1.05rem', marginBottom: 4 }}>{app.name}</div>
            <div style={{ color: '#6e6e73', fontSize: '.82rem', marginBottom: 12 }}>{app.desc}</div>
            <Badge color={app.color}>{app.hint}</Badge>
            <div style={{ marginTop: 20 }}><Btn small variant="ghost">Открыть →</Btn></div>
          </Card>
        ))}
      </div>
      <Card style={{ background: 'linear-gradient(135deg,#f5f5f7,#fff)', border: '0.5px solid rgba(0,0,0,0.08)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' as const, gap: 16 }}>
          <div>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Как установить на iPhone?</div>
            <div style={{ color: '#6e6e73', fontSize: '.85rem' }}>Safari → «Поделиться» → «На экран Домой»</div>
          </div>
          <Badge color="#30d158">PWA · Без App Store</Badge>
        </div>
      </Card>
    </div>
  )
}

function EmployeesTab({ restaurantId }: { restaurantId: string }) {
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState({ name: '', salary: '', deduct_per_absence: '', card_amount: '' })

  const load = async () => {
    setLoading(true)
    const { data } = await supabase.from('employees').select('*').eq('restaurant_id', restaurantId).eq('is_active', true).order('name')
    setEmployees(data || [])
    setLoading(false)
  }

  useEffect(() => { if (restaurantId) load() }, [restaurantId])

  const save = async () => {
    if (!form.name.trim()) return
    const payload = { restaurant_id: restaurantId, name: form.name, salary: +form.salary || 0, deduct_per_absence: +form.deduct_per_absence || 0, card_amount: +form.card_amount || 0 }
    if (editingId) {
      await supabase.from('employees').update(payload).eq('id', editingId)
    } else {
      await supabase.from('employees').insert(payload)
    }
    setForm({ name: '', salary: '', deduct_per_absence: '', card_amount: '' })
    setShowForm(false); setEditingId(null); load()
  }

  const remove = async (id: string) => {
    await supabase.from('employees').update({ is_active: false }).eq('id', id)
    load()
  }

  const startEdit = (emp: Employee) => {
    setForm({ name: emp.name, salary: String(emp.salary), deduct_per_absence: String(emp.deduct_per_absence), card_amount: String(emp.card_amount) })
    setEditingId(emp.id); setShowForm(true)
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <div style={{ fontSize: '1.4rem', fontWeight: 700, letterSpacing: '-.03em', marginBottom: 4 }}>Сотрудники</div>
          <div style={{ color: '#6e6e73', fontSize: '.85rem' }}>Зарплаты и настройки вычетов</div>
        </div>
        <Btn onClick={() => { setShowForm(!showForm); setEditingId(null); setForm({ name: '', salary: '', deduct_per_absence: '', card_amount: '' }) }}>
          {showForm ? 'Отмена' : '+ Добавить'}
        </Btn>
      </div>

      {showForm && (
        <Card style={{ marginBottom: 20, border: '0.5px solid #0071e3' }}>
          <SectionTitle>{editingId ? 'Редактировать' : 'Новый сотрудник'}</SectionTitle>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div style={{ gridColumn: '1/-1' }}>
              <Input label="Имя и фамилия" value={form.name} onChange={(v: string) => setForm({ ...form, name: v })} placeholder="Александр Иванов" />
            </div>
            <Input label="Оклад (€)" value={form.salary} onChange={(v: string) => setForm({ ...form, salary: v })} placeholder="1000" type="number" />
            <Input label="Вычет за пропуск (€)" value={form.deduct_per_absence} onChange={(v: string) => setForm({ ...form, deduct_per_absence: v })} placeholder="50" type="number" />
            <div style={{ gridColumn: '1/-1' }}>
              <Input label="Сумма на карту (€) — необязательно" value={form.card_amount} onChange={(v: string) => setForm({ ...form, card_amount: v })} placeholder="0" type="number" />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <Btn onClick={save}>{editingId ? 'Сохранить' : 'Добавить'}</Btn>
            <Btn variant="gray" onClick={() => { setShowForm(false); setEditingId(null) }}>Отмена</Btn>
          </div>
        </Card>
      )}

      {loading ? <div style={{ color: '#6e6e73', textAlign: 'center' as const, padding: 40 }}>Загрузка...</div> : (
        <Card>
          {employees.length === 0 ? (
            <div style={{ textAlign: 'center' as const, padding: '32px 0', color: '#6e6e73' }}>
              <div style={{ fontSize: '2rem', marginBottom: 12 }}>👥</div>
              <div>Сотрудников пока нет. Добавьте первого!</div>
            </div>
          ) : employees.map((emp, i) => (
            <div key={emp.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 0', borderBottom: i < employees.length - 1 ? '0.5px solid rgba(0,0,0,0.07)' : 'none', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: '.95rem', marginBottom: 3 }}>{emp.name}</div>
                <div style={{ fontSize: '.78rem', color: '#6e6e73', display: 'flex', gap: 12, flexWrap: 'wrap' as const }}>
                  <span>Оклад: <strong>€{emp.salary}</strong></span>
                  <span>Вычет/пропуск: <strong>€{emp.deduct_per_absence}</strong></span>
                  {emp.card_amount > 0 && <span>На карту: <strong>€{emp.card_amount}</strong></span>}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <Btn small variant="ghost" onClick={() => startEdit(emp)}>Изменить</Btn>
                <Btn small variant="danger" onClick={() => remove(emp.id)}>✕</Btn>
              </div>
            </div>
          ))}
        </Card>
      )}

      {employees.length > 0 && (
        <Card style={{ marginTop: 16, background: '#f5f5f7', border: 'none', boxShadow: 'none' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 16, textAlign: 'center' as const }}>
            <div>
              <div style={{ fontSize: '.75rem', color: '#6e6e73', marginBottom: 4 }}>СОТРУДНИКОВ</div>
              <div style={{ fontSize: '1.4rem', fontWeight: 700 }}>{employees.length}</div>
            </div>
            <div>
              <div style={{ fontSize: '.75rem', color: '#6e6e73', marginBottom: 4 }}>ФОТ</div>
              <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#0071e3' }}>€{employees.reduce((s, e) => s + e.salary, 0).toLocaleString()}</div>
            </div>
            <div>
              <div style={{ fontSize: '.75rem', color: '#6e6e73', marginBottom: 4 }}>НА КАРТУ</div>
              <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#af52de' }}>€{employees.reduce((s, e) => s + e.card_amount, 0).toLocaleString()}</div>
            </div>
          </div>
        </Card>
      )}
    </div>
  )
}

function CategoriesTab({ restaurantId }: { restaurantId: string }) {
  const [cats, setCats] = useState<Category[]>([])
  const [newName, setNewName] = useState('')
  const [loading, setLoading] = useState(true)

  const load = async () => {
    setLoading(true)
    const { data } = await supabase.from('expense_categories').select('*').eq('restaurant_id', restaurantId).order('name')
    setCats(data || [])
    setLoading(false)
  }

  useEffect(() => { if (restaurantId) load() }, [restaurantId])

  const add = async () => {
    if (!newName.trim()) return
    await supabase.from('expense_categories').insert({ restaurant_id: restaurantId, name: newName.trim() })
    setNewName(''); load()
  }

  const remove = async (id: string) => {
    await supabase.from('expense_categories').delete().eq('id', id)
    load()
  }

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: '1.4rem', fontWeight: 700, letterSpacing: '-.03em', marginBottom: 4 }}>Категории расходов</div>
        <div style={{ color: '#6e6e73', fontSize: '.85rem' }}>Менеджер выбирает из этого списка при добавлении расхода</div>
      </div>
      <Card style={{ marginBottom: 16 }}>
        <SectionTitle>Добавить категорию</SectionTitle>
        <div style={{ display: 'flex', gap: 10 }}>
          <input value={newName} onChange={e => setNewName(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()} placeholder="Например: Мойка, DJ, Ремонт..."
            style={{ flex: 1, padding: '11px 14px', borderRadius: 12, border: '0.5px solid rgba(0,0,0,0.15)', fontSize: '.9rem', fontFamily: 'inherit', outline: 'none' }} />
          <Btn onClick={add}>Добавить</Btn>
        </div>
      </Card>
      <Card>
        <SectionTitle>Текущие категории ({cats.length})</SectionTitle>
        {loading ? <div style={{ color: '#6e6e73' }}>Загрузка...</div> : cats.length === 0 ? (
          <div style={{ textAlign: 'center' as const, padding: '24px 0', color: '#6e6e73' }}>
            <div style={{ fontSize: '1.5rem', marginBottom: 8 }}>📂</div>
            <div>Категорий пока нет</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: 8 }}>
            {cats.map(cat => (
              <div key={cat.id} style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#f5f5f7', borderRadius: 980, padding: '7px 14px' }}>
                <span style={{ fontSize: '.88rem', fontWeight: 500 }}>{cat.name}</span>
                <button onClick={() => remove(cat.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#aeaeb2', fontSize: '.9rem', padding: 0 }}>✕</button>
              </div>
            ))}
          </div>
        )}
      </Card>
      <Card style={{ marginTop: 16, background: '#fff8ee', border: '0.5px solid rgba(255,159,10,0.2)', boxShadow: 'none' }}>
        <div style={{ display: 'flex', gap: 12 }}>
          <span style={{ fontSize: '1.1rem' }}>💡</span>
          <div style={{ fontSize: '.85rem', color: '#6e6e73', lineHeight: 1.6 }}>
            Менеджеры в SO Manager видят только эти категории. Зарплаты сотрудников считаются отдельно автоматически — не нужно добавлять их сюда.
          </div>
        </div>
      </Card>
    </div>
  )
}

function TeamTab() {
  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: '1.4rem', fontWeight: 700, letterSpacing: '-.03em', marginBottom: 4 }}>Доступы команды</div>
        <div style={{ color: '#6e6e73', fontSize: '.85rem' }}>Кто имеет доступ к каким приложениям</div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 16, marginBottom: 24 }}>
        {[
          { role: 'Владелец', icon: '👑', color: '#ff9f0a', apps: ['SO Analytics', 'Dashboard'], desc: 'Полный доступ ко всему' },
          { role: 'Менеджер', icon: '📋', color: '#0071e3', apps: ['SO Manager'], desc: 'Только ведение смены' },
          { role: 'Кальянщик', icon: '💨', color: '#30d158', apps: ['SO Tobacco'], desc: 'Только склад табака' },
        ].map(r => (
          <Card key={r.role} style={{ borderTop: `3px solid ${r.color}` }}>
            <div style={{ fontSize: '1.8rem', marginBottom: 10 }}>{r.icon}</div>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>{r.role}</div>
            <div style={{ fontSize: '.82rem', color: '#6e6e73', marginBottom: 14 }}>{r.desc}</div>
            <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 6 }}>
              {r.apps.map(app => <Badge key={app} color={r.color}>{app}</Badge>)}
            </div>
          </Card>
        ))}
      </div>
      <Card>
        <SectionTitle>Пригласить сотрудника</SectionTitle>
        <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap' as const }}>
          <input placeholder="Email сотрудника" style={{ flex: 1, minWidth: 200, padding: '11px 14px', borderRadius: 12, border: '0.5px solid rgba(0,0,0,0.15)', fontSize: '.9rem', fontFamily: 'inherit', outline: 'none' }} />
          <select style={{ padding: '11px 14px', borderRadius: 12, border: '0.5px solid rgba(0,0,0,0.15)', fontSize: '.9rem', fontFamily: 'inherit', outline: 'none' }}>
            <option>Менеджер</option>
            <option>Кальянщик</option>
          </select>
        </div>
        <Btn>Отправить приглашение</Btn>
        <div style={{ marginTop: 12, fontSize: '.8rem', color: '#6e6e73' }}>Сотрудник получит email с ссылкой для входа в нужное приложение</div>
      </Card>
    </div>
  )
}

function SettingsTab({ restaurant, onUpdate }: { restaurant: Restaurant | null; onUpdate: () => void }) {
  const [name, setName] = useState(restaurant?.name || '')
  const [currency, setCurrency] = useState(restaurant?.currency || '€')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (restaurant) { setName(restaurant.name); setCurrency(restaurant.currency || '€') }
  }, [restaurant])

  const save = async () => {
    if (!restaurant) return
    setSaving(true)
    await supabase.from('restaurants').update({ name, currency }).eq('id', restaurant.id)
    setSaving(false); setSaved(true)
    setTimeout(() => setSaved(false), 2000)
    onUpdate()
  }

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: '1.4rem', fontWeight: 700, letterSpacing: '-.03em', marginBottom: 4 }}>Настройки</div>
        <div style={{ color: '#6e6e73', fontSize: '.85rem' }}>Основные параметры вашего заведения</div>
      </div>
      <Card style={{ marginBottom: 16 }}>
        <SectionTitle>Ресторан</SectionTitle>
        <Input label="Название заведения" value={name} onChange={setName} placeholder="Название вашего ресторана" />
        <div style={{ marginBottom: 20 }}>
          <label style={{ display: 'block', fontSize: '.78rem', fontWeight: 600, color: '#6e6e73', marginBottom: 6, textTransform: 'uppercase' as const, letterSpacing: '.04em' }}>Валюта</label>
          <select value={currency} onChange={e => setCurrency(e.target.value)} style={{ width: '100%', padding: '11px 14px', borderRadius: 12, border: '0.5px solid rgba(0,0,0,0.15)', fontSize: '.9rem', fontFamily: 'inherit', outline: 'none' }}>
            <option value="€">€ — Евро</option>
            <option value="₸">₸ — Тенге</option>
            <option value="₽">₽ — Рубль</option>
            <option value="$">$ — Доллар</option>
          </select>
        </div>
        <Btn onClick={save}>{saving ? 'Сохранение...' : saved ? '✓ Сохранено!' : 'Сохранить'}</Btn>
      </Card>
      <Card>
        <SectionTitle>Опасная зона</SectionTitle>
        <div style={{ fontSize: '.85rem', color: '#6e6e73', marginBottom: 16 }}>Эти действия необратимы.</div>
        <Btn variant="danger">Удалить аккаунт</Btn>
      </Card>
    </div>
  )
}

function BillingTab() {
  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: '1.4rem', fontWeight: 700, letterSpacing: '-.03em', marginBottom: 4 }}>Подписка</div>
        <div style={{ color: '#6e6e73', fontSize: '.85rem' }}>Управление тарифом и оплатой</div>
      </div>
      <Card style={{ marginBottom: 16, border: '0.5px solid #0071e3', background: 'linear-gradient(135deg,rgba(0,113,227,0.03),#fff)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap' as const, gap: 16 }}>
          <div>
            <Badge color="#30d158">● Активна</Badge>
            <div style={{ fontSize: '1.8rem', fontWeight: 700, letterSpacing: '-.03em', marginTop: 12, marginBottom: 4 }}>Бизнес</div>
            <div style={{ color: '#6e6e73', fontSize: '.85rem' }}>Все 3 приложения · До 10 сотрудников</div>
          </div>
          <div style={{ textAlign: 'right' as const }}>
            <div style={{ fontSize: '2rem', fontWeight: 700 }}>€24</div>
            <div style={{ color: '#6e6e73', fontSize: '.82rem' }}>в месяц</div>
          </div>
        </div>
        <div style={{ marginTop: 20, display: 'flex', gap: 10 }}>
          <Btn>Управить подпиской</Btn>
          <Btn variant="ghost">Сменить тариф</Btn>
        </div>
      </Card>
      <Card>
        <SectionTitle>Что включено</SectionTitle>
        {['SO Manager — управление сменами', 'SO Analytics — аналитика для владельца', 'SO Tobacco — склад кальяна', 'До 10 сотрудников', 'История 12 месяцев', 'Приоритетная поддержка'].map(f => (
          <div key={f} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderBottom: '0.5px solid rgba(0,0,0,0.05)', fontSize: '.88rem' }}>
            <span style={{ color: '#30d158', fontWeight: 700 }}>✓</span> {f}
          </div>
        ))}
      </Card>
      <Card style={{ marginTop: 16, background: '#f5f5f7', boxShadow: 'none', border: 'none', textAlign: 'center' as const }}>
        <div style={{ fontSize: '.82rem', color: '#6e6e73' }}>🔒 Платежи защищены через Stripe · Apple Pay · Visa · Mastercard</div>
      </Card>
    </div>
  )
}

export default function Dashboard() {
  const [user, setUser] = useState<any>(null)
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null)
  const [tab, setTab] = useState('apps')

  const loadRestaurant = async (userId: string) => {
    const { data } = await supabase.from('restaurants').select('*').eq('owner_id', userId).single()
    setRestaurant(data)
  }

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) { window.location.href = '/auth/login'; return }
      setUser(data.user)
      await loadRestaurant(data.user.id)
    })
  }, [])

  const handleLogout = async () => {
    await supabase.auth.signOut()
    window.location.href = '/auth/login'
  }

  if (!user) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: '-apple-system,sans-serif', color: '#6e6e73' }}>
      Загрузка...
    </div>
  )

  return (
    <div style={{ minHeight: '100vh', background: '#f5f5f7', fontFamily: '-apple-system,BlinkMacSystemFont,sans-serif', WebkitFontSmoothing: 'antialiased' as const }}>
      <nav style={{ background: 'rgba(255,255,255,0.92)', backdropFilter: 'blur(20px)', borderBottom: '0.5px solid rgba(0,0,0,0.1)', padding: '0 24px', height: 52, display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky' as const, top: 0, zIndex: 100 }}>
        <div style={{ fontWeight: 700, fontSize: '1.1rem', letterSpacing: '-.02em' }}>Mise</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ fontSize: '.82rem', color: '#6e6e73', display: 'none' }}>{user.email}</div>
          <button onClick={handleLogout} style={{ background: 'none', border: 'none', color: '#ff3b30', cursor: 'pointer', fontSize: '.82rem', fontFamily: 'inherit' }}>Выйти</button>
        </div>
      </nav>

      <div style={{ maxWidth: 960, margin: '0 auto', padding: '32px 24px' }}>
        <div style={{ marginBottom: 28 }}>
          <div style={{ fontSize: '1.6rem', fontWeight: 700, letterSpacing: '-.03em', marginBottom: 4 }}>{restaurant?.name || 'Мой ресторан'}</div>
          <div style={{ color: '#6e6e73', fontSize: '.85rem' }}>Личный кабинет владельца · {user.email}</div>
        </div>

        <div style={{ display: 'flex', gap: 4, marginBottom: 24, overflowX: 'auto' as const, paddingBottom: 4 }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              padding: '8px 16px', borderRadius: 10, border: 'none', fontFamily: 'inherit', fontSize: '.82rem', fontWeight: 500, cursor: 'pointer', whiteSpace: 'nowrap' as const,
              background: tab === t.id ? '#1d1d1f' : '#fff',
              color: tab === t.id ? '#fff' : '#6e6e73',
              boxShadow: tab === t.id ? 'none' : '0 1px 4px rgba(0,0,0,0.06)',
              transition: 'all .15s'
            }}>
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'apps' && <AppsTab restaurant={restaurant} />}
        {tab === 'employees' && restaurant && <EmployeesTab restaurantId={restaurant.id} />}
        {tab === 'categories' && restaurant && <CategoriesTab restaurantId={restaurant.id} />}
        {tab === 'team' && <TeamTab />}
        {tab === 'settings' && <SettingsTab restaurant={restaurant} onUpdate={() => user && loadRestaurant(user.id)} />}
        {tab === 'billing' && <BillingTab />}
      </div>
    </div>
  )
}
