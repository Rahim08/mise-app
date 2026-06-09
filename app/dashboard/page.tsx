'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

type Employee = { id: string; name: string; salary: number; deduct_per_absence: number; card_amount: number; is_active: boolean }
type Category = { id: string; name: string }
type Restaurant = { id: string; name: string; currency: string; subscription_status: string; subscription_plan: string; subscription_ends_at: string; stripe_customer_id?: string; subscription_id?: string }
type StaffMember = { id: string; name: string; pin_hash: string; apps: string[]; device_id: string | null; is_active: boolean }

const APPS = [
  { id: 'manager',   name: 'Mise Manager',   desc: 'Смены · Расходы · Инкассации · Явка', color: '#007aff', hint: 'Для менеджеров',  path: '/manager',   plans: ['starter','business','pro'] },
  { id: 'analytics', name: 'Mise Analytics', desc: 'Финансы · Зарплаты · Инкассации · AI', color: '#34c759', hint: 'Для владельца',   path: '/analytics', plans: ['starter','business','pro'] },
  { id: 'stash',     name: 'Mise Stash',     desc: 'Склад · Приход · Расход · Инвентаризация', color: '#ff9500', hint: 'Для кальянщика', path: '/tobacco',   plans: ['business','pro'] },
]

const PLANS = [
  {
    id: 'starter', name: 'Starter', price: 14,
    features: ['Mise Manager', 'Mise Analytics', 'До 2 сотрудников'],
    color: '#007aff',
  },
  {
    id: 'business', name: 'Business', price: 24,
    features: ['Все 3 приложения', 'До 5 сотрудников', 'История 12 мес.'],
    color: '#34c759',
    popular: true,
  },
  {
    id: 'pro', name: 'Pro', price: 39,
    features: ['Все приложения', 'До 10 сотрудников', 'AI-аналитика', 'Интеграция Syrve', 'QR-меню'],
    color: '#af52de',
  },
]

const TABS = [
  { id: 'apps',       label: 'Приложения' },
  { id: 'employees',  label: 'Сотрудники' },
  { id: 'categories', label: 'Категории' },
  { id: 'team',       label: 'Доступы' },
  { id: 'settings',   label: 'Настройки' },
  { id: 'billing',    label: 'Подписка' },
]

// ── UI PRIMITIVES ──────────────────────────────────────

function Card({ children, style = {} }: { children: any; style?: any }) {
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
      ...s[variant],
      padding: small ? '6px 14px' : '10px 20px',
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
      {label && <label style={{ display: 'block', fontSize: '.72rem', fontWeight: 600, color: '#6d6d72', marginBottom: 4, textTransform: 'uppercase' as const, letterSpacing: '.04em' }}>{label}</label>}
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

const inputStyle = { width: '100%', padding: '9px 12px', borderRadius: 10, border: '1px solid rgba(60,60,67,.2)', fontSize: '.88rem', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' as const, color: '#1c1c1e', background: '#fff' }

function SectionTitle({ title, sub }: { title: string; sub?: string }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#1c1c1e', marginBottom: 2 }}>{title}</div>
      {sub && <div style={{ color: '#6d6d72', fontSize: '.83rem' }}>{sub}</div>}
    </div>
  )
}

// ── APPS TAB ──────────────────────────────────────────

function AppsTab({ restaurant }: { restaurant: Restaurant | null }) {
  const plan = restaurant?.subscription_plan || ''
  const status = restaurant?.subscription_status || ''
  const isActive = status === 'active' || status === 'trialing'

  return (
    <div>
      <SectionTitle title="Приложения" sub={`Заведение: ${restaurant?.name || '—'}`} />

      {status === 'trialing' && (
        <div style={{ background: 'rgba(0,122,255,.08)', border: '1px solid rgba(0,122,255,.2)', borderRadius: 12, padding: '12px 16px', marginBottom: 16, fontSize: '.85rem', color: '#007aff', fontWeight: 500 }}>
          Пробный период активен — 7 дней бесплатно
        </div>
      )}

      {!isActive && (
        <div style={{ background: 'rgba(255,59,48,.08)', border: '1px solid rgba(255,59,48,.2)', borderRadius: 12, padding: '12px 16px', marginBottom: 16, fontSize: '.85rem', color: '#ff3b30', fontWeight: 500 }}>
          Подписка неактивна. Перейдите во вкладку «Подписка» для оплаты.
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 14, marginBottom: 16 }}>
        {APPS.map(app => {
          const locked = isActive && !app.plans.includes(plan)
          return (
            <Card key={app.id} style={{ borderTop: `3px solid ${locked ? '#c7c7cc' : app.color}`, display: 'flex', flexDirection: 'column' as const, opacity: locked ? .6 : 1 }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'inline-block', background: (locked ? '#c7c7cc' : app.color) + '18', color: locked ? '#c7c7cc' : app.color, fontSize: '.7rem', fontWeight: 700, padding: '3px 10px', borderRadius: 980, marginBottom: 12, letterSpacing: '.02em' }}>{app.hint}</div>
                <div style={{ fontWeight: 700, fontSize: '1rem', marginBottom: 3, color: '#1c1c1e' }}>{app.name}</div>
                <div style={{ color: '#6d6d72', fontSize: '.8rem', marginBottom: 14, lineHeight: 1.5 }}>{app.desc}</div>
              </div>
              <button onClick={() => !locked && isActive && (window.location.href = app.path)}
                style={{ background: locked || !isActive ? '#f2f2f7' : app.color, color: locked || !isActive ? '#aeaeb2' : '#fff', border: 'none', borderRadius: 10, padding: '9px 0', fontFamily: 'inherit', fontSize: '.85rem', fontWeight: 600, cursor: locked || !isActive ? 'not-allowed' : 'pointer', width: '100%' }}>
                {locked ? 'Недоступно в тарифе' : !isActive ? 'Нет подписки' : 'Открыть'}
              </button>
            </Card>
          )
        })}
      </div>

      <Card style={{ background: '#f9f9f9', boxShadow: 'none', border: '1px solid rgba(0,0,0,.06)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' as const, gap: 10 }}>
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

// ── EMPLOYEES TAB ─────────────────────────────────────

function EmployeesTab({ restaurantId }: { restaurantId: string }) {
  const [employees, setEmployees] = useState<any[]>([])
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
    const payload = { restaurant_id: restaurantId, name: form.name, salary: +form.salary || 0, deduct_per_absence: +form.deduct_per_absence || 0, card_amount: +form.card_amount || 0, is_active: true }
    if (editingId) await supabase.from('employees').update(payload).eq('id', editingId)
    else await supabase.from('employees').insert(payload)
    setForm({ name: '', salary: '', deduct_per_absence: '', card_amount: '' })
    setShowForm(false); setEditingId(null); load()
  }

  const remove = async (id: string) => {
    await supabase.from('employees').update({ is_active: false }).eq('id', id); load()
  }

  const startEdit = (emp: Employee) => {
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

      {/* Статистика НАВЕРХУ */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginBottom: 16 }}>
        {[
          { l: 'Сотрудников', v: String(employees.length), c: '#1c1c1e' },
          { l: 'ФОТ в месяц', v: `€${total.toLocaleString()}`, c: '#007aff' },
          { l: 'На карту', v: `€${totalCard.toLocaleString()}`, c: '#af52de' },
        ].map(item => (
          <Card key={item.l} style={{ padding: '14px 16px', textAlign: 'center' as const }}>
            <div style={{ fontSize: '.68rem', color: '#6d6d72', fontWeight: 600, textTransform: 'uppercase' as const, marginBottom: 4, letterSpacing: '.04em' }}>{item.l}</div>
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
          <div style={{ color: '#6d6d72', textAlign: 'center' as const, padding: 32 }}>Загрузка...</div>
        ) : employees.length === 0 ? (
          <div style={{ textAlign: 'center' as const, padding: '28px 0', color: '#6d6d72', fontSize: '.88rem' }}>Добавьте первого сотрудника</div>
        ) : employees.map((emp, i) => (
          <div key={emp.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0', borderBottom: i < employees.length - 1 ? '1px solid rgba(60,60,67,.08)' : 'none', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: '.92rem', marginBottom: 2, color: '#1c1c1e' }}>{emp.name}</div>
              <div style={{ fontSize: '.75rem', color: '#6d6d72', display: 'flex', gap: 10, flexWrap: 'wrap' as const }}>
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

// ── CATEGORIES TAB ────────────────────────────────────

function CategoriesTab({ restaurantId }: { restaurantId: string }) {
  const [cats, setCats] = useState<Category[]>([])
  const [newName, setNewName] = useState('')
  const [loading, setLoading] = useState(true)

  const load = async () => {
    setLoading(true)
    const { data } = await supabase.from('expense_categories').select('*').eq('restaurant_id', restaurantId).order('name')
    setCats(data || []); setLoading(false)
  }

  useEffect(() => { if (restaurantId) load() }, [restaurantId])

  const add = async () => {
    if (!newName.trim()) return
    await supabase.from('expense_categories').insert({ restaurant_id: restaurantId, name: newName.trim() })
    setNewName(''); load()
  }

  const remove = async (id: string) => {
    await supabase.from('expense_categories').delete().eq('id', id); load()
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
        <div style={{ fontWeight: 600, fontSize: '.88rem', color: '#6d6d72', marginBottom: 12 }}>
          Категорий: {cats.length}
        </div>
        {loading ? <div style={{ color: '#6d6d72', fontSize: '.88rem' }}>Загрузка...</div>
          : cats.length === 0
            ? <div style={{ textAlign: 'center' as const, padding: '20px 0', color: '#6d6d72', fontSize: '.88rem' }}>Нет категорий</div>
            : <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: 8 }}>
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

// ── TEAM TAB ──────────────────────────────────────────

function TeamTab({ restaurantId }: { restaurantId: string }) {
  const [staff, setStaff] = useState<StaffMember[]>([])
  const [employees, setEmployees] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ name: '', pin: '', apps: [] as string[] })
  const [saving, setSaving] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    const [{ data: staffData }, { data: empData }] = await Promise.all([
      supabase.from('staff').select('*').eq('restaurant_id', restaurantId).eq('is_active', true).order('name'),
      supabase.from('employees').select('*').eq('restaurant_id', restaurantId).eq('is_active', true).order('name'),
    ])
    setStaff(staffData || [])
    setEmployees(empData || [])
    setLoading(false)
  }

  useEffect(() => { if (restaurantId) load() }, [restaurantId])

  const toggleApp = (appId: string) => {
    setForm(f => ({ ...f, apps: f.apps.includes(appId) ? f.apps.filter(a => a !== appId) : [...f.apps, appId] }))
  }

  const save = async () => {
    if (!form.name.trim()) return
    if (!editingId && (form.pin.length !== 4 || !/^\d+$/.test(form.pin))) { alert('PIN должен быть 4 цифры'); return }
    if (!form.apps.length) { alert('Выберите хотя бы одно приложение'); return }
    setSaving(true)
    const payload: any = { restaurant_id: restaurantId, name: form.name, apps: form.apps, is_active: true }
    if (form.pin) payload.pin_hash = form.pin
    if (editingId) await supabase.from('staff').update(payload).eq('id', editingId)
    else await supabase.from('staff').insert(payload)
    setForm({ name: '', pin: '', apps: [] }); setShowForm(false); setEditingId(null)
    setSaving(false); load()
  }

  const remove = async (id: string) => {
    await supabase.from('staff').update({ is_active: false }).eq('id', id); load()
  }

  const resetDevice = async (id: string) => {
    await supabase.from('staff').update({ device_id: null }).eq('id', id); load()
  }

  const startEdit = (s: StaffMember) => {
    setForm({ name: s.name, pin: '', apps: s.apps || [] })
    setEditingId(s.id); setShowForm(true)
  }

  const appColor = (id: string) => APPS.find(a => a.id === id)?.color || '#007aff'
  const appName = (id: string) => APPS.find(a => a.id === id)?.name || id

  // Имена из employees которых нет в staff
  const usedNames = staff.map(s => s.name)
  const availableEmployees = employees.filter(e => !usedNames.includes(e.name))

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <SectionTitle title="Доступы команды" sub="Сотрудники входят по PIN-коду" />
        <Btn onClick={() => { setShowForm(!showForm); setEditingId(null); setForm({ name: '', pin: '', apps: [] }) }}>
          {showForm ? 'Отмена' : '+ Добавить'}
        </Btn>
      </div>

      {showForm && (
        <Card style={{ marginBottom: 14, border: '1px solid #007aff' }}>
          <div style={{ fontWeight: 700, fontSize: '.95rem', marginBottom: 14 }}>{editingId ? 'Редактировать доступ' : 'Новый доступ'}</div>

          {/* Имя из списка сотрудников */}
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', fontSize: '.72rem', fontWeight: 600, color: '#6d6d72', marginBottom: 4, textTransform: 'uppercase' as const, letterSpacing: '.04em' }}>Сотрудник</label>
            {editingId ? (
              <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} style={inputStyle} />
            ) : (
              <select value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} style={inputStyle}>
                <option value="">Выберите сотрудника...</option>
                {availableEmployees.map(e => (
                  <option key={e.id} value={e.name}>{e.name}</option>
                ))}
                {availableEmployees.length === 0 && <option disabled>Все сотрудники уже добавлены</option>}
              </select>
            )}
          </div>

          <Field
            label={editingId ? 'Новый PIN (необязательно)' : 'PIN-код (4 цифры)'}
            value={form.pin}
            onChange={(v: string) => setForm({ ...form, pin: v.slice(0, 4) })}
            placeholder="1234"
            type="number"
          />

          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: '.72rem', fontWeight: 600, color: '#6d6d72', marginBottom: 8, textTransform: 'uppercase' as const, letterSpacing: '.04em' }}>Доступ к приложениям</div>
            <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 6 }}>
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
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <Btn onClick={save} disabled={saving}>{saving ? 'Сохранение...' : editingId ? 'Сохранить' : 'Создать доступ'}</Btn>
            <Btn variant="gray" onClick={() => { setShowForm(false); setEditingId(null) }}>Отмена</Btn>
          </div>
        </Card>
      )}

      {loading ? (
        <div style={{ color: '#6d6d72', textAlign: 'center' as const, padding: 32 }}>Загрузка...</div>
      ) : staff.length === 0 ? (
        <Card><div style={{ textAlign: 'center' as const, padding: '28px 0', color: '#6d6d72', fontSize: '.88rem' }}>Нет сотрудников с доступом</div></Card>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 10 }}>
          {staff.map(s => (
            <Card key={s.id} style={{ padding: 16 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <div style={{ fontWeight: 700, fontSize: '.95rem', color: '#1c1c1e' }}>{s.name}</div>
                    <div style={{ fontSize: '.7rem', fontWeight: 600, padding: '2px 8px', borderRadius: 980, background: s.device_id ? '#34c75915' : '#f2f2f7', color: s.device_id ? '#34c759' : '#aeaeb2' }}>
                      {s.device_id ? 'Привязано' : 'Не привязано'}
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: 6, marginBottom: s.device_id ? 8 : 0 }}>
                    {(s.apps || []).map(appId => (
                      <span key={appId} style={{ fontSize: '.7rem', fontWeight: 600, padding: '2px 8px', borderRadius: 980, background: appColor(appId) + '15', color: appColor(appId) }}>{appName(appId)}</span>
                    ))}
                  </div>
                  {s.device_id && (
                    <button onClick={() => resetDevice(s.id)} style={{ background: 'none', border: 'none', color: '#ff9500', fontSize: '.78rem', fontWeight: 600, cursor: 'pointer', padding: 0, fontFamily: 'inherit' }}>
                      Сбросить устройство
                    </button>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  <Btn small variant="ghost" onClick={() => startEdit(s)}>Изменить</Btn>
                  <Btn small variant="danger" onClick={() => remove(s.id)}>✕</Btn>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <div style={{ marginTop: 14, padding: '12px 14px', background: 'rgba(0,122,255,.06)', borderRadius: 12, fontSize: '.82rem', color: '#6d6d72', lineHeight: 1.6 }}>
        Сотрудник при первом входе сканирует QR заведения → вводит PIN → устройство привязывается → следующие входы через Face ID или PIN.
      </div>
    </div>
  )
}

// ── SETTINGS TAB ──────────────────────────────────────

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
    setSaving(false); setSaved(true); setTimeout(() => setSaved(false), 2000); onUpdate()
  }

  return (
    <div>
      <SectionTitle title="Настройки" sub="Основные параметры заведения" />

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
        <div style={{ marginTop: 4 }}>
          <Btn onClick={save}>{saving ? 'Сохранение...' : saved ? '✓ Сохранено' : 'Сохранить'}</Btn>
        </div>
      </Card>

      <Card style={{ border: '1px solid rgba(255,59,48,.15)' }}>
        <div style={{ fontWeight: 600, fontSize: '.9rem', marginBottom: 4, color: '#1c1c1e' }}>Опасная зона</div>
        <div style={{ fontSize: '.82rem', color: '#6d6d72', marginBottom: 14 }}>Удаление аккаунта необратимо.</div>
        <Btn variant="danger">Удалить аккаунт</Btn>
      </Card>
    </div>
  )
}

// ── BILLING TAB ──────────────────────────────────────

function BillingTab({ restaurant, user }: { restaurant: Restaurant | null; user: any }) {
  const [loading, setLoading] = useState(false)
  const [cancelConfirm, setCancelConfirm] = useState(false)

  const currentPlan = PLANS.find(p => p.id === restaurant?.subscription_plan)
  const status = restaurant?.subscription_status
  const endsAt = restaurant?.subscription_ends_at ? new Date(restaurant.subscription_ends_at) : null

  const statusLabel: Record<string, { label: string; color: string; bg: string }> = {
    trialing:  { label: 'Пробный период', color: '#007aff', bg: 'rgba(0,122,255,.1)' },
    active:    { label: 'Активна',        color: '#34c759', bg: 'rgba(52,199,89,.1)' },
    past_due:  { label: 'Просрочена',     color: '#ff9500', bg: 'rgba(255,149,0,.1)' },
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
      window.open(url, "_self")
    } finally {
      setLoading(false)
    }
  }

  const cancel = async () => {
    if (!restaurant) return
    setLoading(true)
    await fetch('/api/stripe/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ restaurantId: restaurant.id }),
    })
    setCancelConfirm(false)
    setLoading(false)
    alert('Подписка будет отменена в конце периода')
  }

  const isActive = status === 'active' || status === 'trialing'

  return (
    <div>
      <SectionTitle title="Подписка" sub="Управление тарифом и оплатой" />

      {/* Текущий статус */}
      {currentPlan && (
        <Card style={{ marginBottom: 16, border: `1px solid ${currentPlan.color}25` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap' as const, gap: 12 }}>
            <div>
              <div style={{ display: 'inline-block', background: badge.bg, color: badge.color, fontSize: '.72rem', fontWeight: 700, padding: '3px 10px', borderRadius: 980, marginBottom: 10 }}>{badge.label}</div>
              <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#1c1c1e', marginBottom: 2 }}>{currentPlan.name}</div>
              {endsAt && (
                <div style={{ fontSize: '.8rem', color: '#6d6d72' }}>
                  {isActive ? 'Следующий платёж' : 'Доступ до'}: {endsAt.toLocaleDateString('ru-RU')}
                </div>
              )}
            </div>
            <div style={{ textAlign: 'right' as const }}>
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
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' as const }}>
                  <span style={{ fontSize: '.82rem', color: '#6d6d72' }}>Подтвердить отмену?</span>
                  <Btn small variant="danger" onClick={cancel} disabled={loading}>Да, отменить</Btn>
                  <Btn small variant="gray" onClick={() => setCancelConfirm(false)}>Нет</Btn>
                </div>
              )}
            </div>
          )}
        </Card>
      )}

      {/* Тарифы */}
      <div style={{ fontWeight: 600, fontSize: '.88rem', color: '#6d6d72', marginBottom: 12, textTransform: 'uppercase' as const, letterSpacing: '.04em' }}>
        {currentPlan ? 'Сменить тариф' : 'Выберите тариф'}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 12, marginBottom: 16 }}>
        {PLANS.map(plan => {
          const isCurrent = restaurant?.subscription_plan === plan.id
          return (
            <Card key={plan.id} style={{ border: `2px solid ${isCurrent ? plan.color : plan.popular ? plan.color + '40' : 'rgba(60,60,67,.1)'}`, position: 'relative' as const, padding: 16 }}>
              {plan.popular && !isCurrent && (
                <div style={{ position: 'absolute' as const, top: -10, left: '50%', transform: 'translateX(-50%)', background: plan.color, color: '#fff', fontSize: '.65rem', fontWeight: 700, padding: '3px 10px', borderRadius: 980, whiteSpace: 'nowrap' as const }}>
                  ПОПУЛЯРНЫЙ
                </div>
              )}
              {isCurrent && (
                <div style={{ position: 'absolute' as const, top: -10, left: '50%', transform: 'translateX(-50%)', background: plan.color, color: '#fff', fontSize: '.65rem', fontWeight: 700, padding: '3px 10px', borderRadius: 980, whiteSpace: 'nowrap' as const }}>
                  ТЕКУЩИЙ
                </div>
              )}
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontWeight: 700, fontSize: '1.05rem', color: '#1c1c1e', marginBottom: 2 }}>{plan.name}</div>
                <div style={{ fontSize: '1.5rem', fontWeight: 700, color: plan.color }}>€{plan.price}<span style={{ fontSize: '.75rem', color: '#6d6d72', fontWeight: 400 }}>/мес</span></div>
              </div>
              <div style={{ marginBottom: 14 }}>
                {plan.features.map(f => (
                  <div key={f} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '.8rem', color: '#3c3c43', marginBottom: 4 }}>
                    <span style={{ color: plan.color, fontWeight: 700, fontSize: '.85rem' }}>✓</span> {f}
                  </div>
                ))}
              </div>
              <button
                onClick={() => !isCurrent && subscribe(plan.id)}
                disabled={isCurrent || loading}
                style={{ width: '100%', padding: '9px 0', borderRadius: 10, border: 'none', background: isCurrent ? '#f2f2f7' : plan.color, color: isCurrent ? '#aeaeb2' : '#fff', fontFamily: 'inherit', fontSize: '.85rem', fontWeight: 600, cursor: isCurrent ? 'default' : 'pointer', transition: 'opacity .15s' }}
              >
                {isCurrent ? 'Активен' : loading ? '...' : 'Выбрать'}
              </button>
            </Card>
          )
        })}
      </div>

      <div style={{ textAlign: 'center' as const, fontSize: '.75rem', color: '#aeaeb2' }}>
        Платежи защищены через Stripe · 7 дней бесплатно при первой оплате
      </div>
    </div>
  )
}

// ── MAIN ─────────────────────────────────────────────

export default function Dashboard() {
  const [user, setUser] = useState<any>(null)
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null)
  const [tab, setTab] = useState('apps')

  const loadRestaurant = async (userId: string) => {
    const { data } = await supabase.from('restaurants').select('*').eq('owner_id', userId).single()
    setRestaurant(data)
  }

  useEffect(() => {
    // Читаем tab из URL
    const params = new URLSearchParams(window.location.search)
    const t = params.get('tab')
    if (t) setTab(t)

    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) { window.location.href = '/auth/login'; return }
      setUser(data.user)
      await loadRestaurant(data.user.id)
    })
  }, [])

  if (!user) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: '-apple-system,sans-serif', color: '#6d6d72', fontSize: '.9rem' }}>
      Загрузка...
    </div>
  )

  return (
    <div style={{ minHeight: '100vh', background: '#f2f2f7', fontFamily: '-apple-system,BlinkMacSystemFont,sans-serif', WebkitFontSmoothing: 'antialiased' as const }}>
      <nav style={{ background: 'rgba(255,255,255,.92)', backdropFilter: 'blur(20px)', borderBottom: '1px solid rgba(60,60,67,.12)', padding: '0 20px', height: 50, display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky' as const, top: 0, zIndex: 100 }}>
        <div style={{ fontWeight: 700, fontSize: '1.05rem', color: '#1c1c1e', letterSpacing: '-.01em' }}>Mise</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <span style={{ fontSize: '.78rem', color: '#6d6d72' }}>{user.email}</span>
          <button onClick={async () => { await supabase.auth.signOut(); window.location.href = '/auth/login' }}
            style={{ background: 'none', border: 'none', color: '#ff3b30', cursor: 'pointer', fontSize: '.78rem', fontFamily: 'inherit', fontWeight: 600 }}>
            Выйти
          </button>
        </div>
      </nav>

      <div style={{ maxWidth: 920, margin: '0 auto', padding: '24px 16px' }}>
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#1c1c1e', marginBottom: 2 }}>{restaurant?.name || 'Мой ресторан'}</div>
          <div style={{ color: '#6d6d72', fontSize: '.8rem' }}>Личный кабинет · {user.email}</div>
        </div>

        {/* Табы */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 20, overflowX: 'auto' as const, paddingBottom: 2 }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              padding: '7px 15px', borderRadius: 10, border: 'none', fontFamily: 'inherit',
              fontSize: '.8rem', fontWeight: tab === t.id ? 700 : 500,
              cursor: 'pointer', whiteSpace: 'nowrap' as const,
              background: tab === t.id ? '#1c1c1e' : '#fff',
              color: tab === t.id ? '#fff' : '#3c3c43',
              boxShadow: tab === t.id ? 'none' : '0 1px 3px rgba(0,0,0,.06)',
              transition: 'all .15s',
            }}>
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'apps'       && <AppsTab restaurant={restaurant} />}
        {tab === 'employees'  && restaurant && <EmployeesTab restaurantId={restaurant.id} />}
        {tab === 'categories' && restaurant && <CategoriesTab restaurantId={restaurant.id} />}
        {tab === 'team'       && restaurant && <TeamTab restaurantId={restaurant.id} />}
        {tab === 'settings'   && <SettingsTab restaurant={restaurant} onUpdate={() => user && loadRestaurant(user.id)} />}
        {tab === 'billing'    && <BillingTab restaurant={restaurant} user={user} />}
      </div>
    </div>
  )
}
