'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

type Employee = { id: string; name: string; salary: number; deduct_per_absence: number; card_amount: number; is_active: boolean }
type Category = { id: string; name: string }
type Restaurant = { id: string; name: string; currency: string }
type StaffMember = { id: string; name: string; pin_hash: string; apps: string[]; device_id: string | null; is_active: boolean; created_at: string }

const APPS = [
  { id: 'manager', name: 'SO Manager', desc: 'Смены · Доходы · Расходы · Инкассации', color: '#007aff', hint: 'Для менеджеров', path: '/manager' },
  { id: 'analytics', name: 'SO Analytics', desc: 'Финансы · Зарплаты · Инкасс · Кальян', color: '#34c759', hint: 'Для владельца', path: '/analytics' },
  { id: 'stash', name: 'Mise Stash', desc: 'Склад · Приход · Расход · Инвентаризация', color: '#ff9500', hint: 'Для кальянщика', path: '/tobacco' },
]

function Card({ children, style = {} }: { children: any; style?: any }) {
  return <div style={{ background: '#fff', borderRadius: 16, padding: 24, boxShadow: '0 1px 3px rgba(0,0,0,.06),0 4px 16px rgba(0,0,0,.04)', ...style }}>{children}</div>
}

function Btn({ children, onClick, variant = 'primary', small = false, disabled = false }: any) {
  const styles: any = {
    primary: { background: '#007aff', color: '#fff', border: 'none' },
    danger: { background: '#ff3b30', color: '#fff', border: 'none' },
    ghost: { background: 'transparent', color: '#007aff', border: '1px solid rgba(0,122,255,.3)' },
    gray: { background: '#f2f2f7', color: '#1c1c1e', border: 'none' },
  }
  return (
    <button onClick={onClick} disabled={disabled} style={{ ...styles[variant], padding: small ? '6px 14px' : '10px 20px', borderRadius: 980, fontFamily: 'inherit', fontSize: small ? '.78rem' : '.88rem', fontWeight: 600, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? .5 : 1, transition: 'opacity .15s' }}>
      {children}
    </button>
  )
}

function Input({ label, value, onChange, placeholder, type = 'text' }: any) {
  return (
    <div style={{ marginBottom: 14 }}>
      {label && <label style={{ display: 'block', fontSize: '.75rem', fontWeight: 600, color: '#6d6d72', marginBottom: 5, textTransform: 'uppercase' as const, letterSpacing: '.04em' }}>{label}</label>}
      <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        style={{ width: '100%', padding: '10px 13px', borderRadius: 10, border: '1px solid rgba(60,60,67,.2)', fontSize: '.9rem', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' as const, color: '#1c1c1e' }} />
    </div>
  )
}

const TABS = [
  { id: 'apps', label: 'Приложения' },
  { id: 'employees', label: 'Сотрудники' },
  { id: 'categories', label: 'Категории' },
  { id: 'team', label: 'Доступы' },
  { id: 'settings', label: 'Настройки' },
  { id: 'billing', label: 'Подписка' },
]

// ── APPS TAB ──
function AppsTab({ restaurant }: { restaurant: Restaurant | null }) {
  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: '1.4rem', fontWeight: 700, marginBottom: 4 }}>Ваши приложения</div>
        <div style={{ color: '#6d6d72', fontSize: '.88rem' }}>Ресторан: <strong style={{ color: '#1c1c1e' }}>{restaurant?.name || '—'}</strong></div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: 16, marginBottom: 20 }}>
        {APPS.map(app => (
          <Card key={app.id} style={{ borderTop: `3px solid ${app.color}`, display: 'flex', flexDirection: 'column' as const }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'inline-block', background: app.color + '15', color: app.color, fontSize: '.72rem', fontWeight: 700, padding: '3px 10px', borderRadius: 980, marginBottom: 14, letterSpacing: '.02em' }}>{app.hint}</div>
              <div style={{ fontWeight: 700, fontSize: '1.05rem', marginBottom: 4, color: '#1c1c1e' }}>{app.name}</div>
              <div style={{ color: '#6d6d72', fontSize: '.82rem', marginBottom: 16, lineHeight: 1.5 }}>{app.desc}</div>
            </div>
            <button onClick={() => window.location.href = app.path}
              style={{ background: app.color, color: '#fff', border: 'none', borderRadius: 10, padding: '10px 0', fontFamily: 'inherit', fontSize: '.88rem', fontWeight: 600, cursor: 'pointer', width: '100%' }}>
              Открыть
            </button>
          </Card>
        ))}
      </div>
      <Card style={{ background: '#f9f9f9', boxShadow: 'none', border: '1px solid rgba(0,0,0,.06)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' as const, gap: 12 }}>
          <div>
            <div style={{ fontWeight: 600, marginBottom: 3, color: '#1c1c1e' }}>Установить на iPhone</div>
            <div style={{ color: '#6d6d72', fontSize: '.84rem' }}>Safari → «Поделиться» → «На экран Домой»</div>
          </div>
          <div style={{ background: '#34c75915', color: '#34c759', fontSize: '.75rem', fontWeight: 700, padding: '4px 12px', borderRadius: 980 }}>PWA · Без App Store</div>
        </div>
      </Card>
    </div>
  )
}

// ── EMPLOYEES TAB ──
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

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <div style={{ fontSize: '1.4rem', fontWeight: 700, marginBottom: 4 }}>Сотрудники</div>
          <div style={{ color: '#6d6d72', fontSize: '.85rem' }}>Зарплаты и настройки вычетов</div>
        </div>
        <Btn onClick={() => { setShowForm(!showForm); setEditingId(null); setForm({ name: '', salary: '', deduct_per_absence: '', card_amount: '' }) }}>
          {showForm ? 'Отмена' : '+ Добавить'}
        </Btn>
      </div>

      {showForm && (
        <Card style={{ marginBottom: 16, border: '1px solid #007aff' }}>
          <div style={{ fontWeight: 700, fontSize: '1rem', marginBottom: 16 }}>{editingId ? 'Редактировать' : 'Новый сотрудник'}</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div style={{ gridColumn: '1/-1' }}>
              <Input label="Имя" value={form.name} onChange={(v: string) => setForm({ ...form, name: v })} placeholder="Александр Иванов" />
            </div>
            <Input label="Оклад" value={form.salary} onChange={(v: string) => setForm({ ...form, salary: v })} placeholder="1000" type="number" />
            <Input label="Вычет за пропуск" value={form.deduct_per_absence} onChange={(v: string) => setForm({ ...form, deduct_per_absence: v })} placeholder="50" type="number" />
            <div style={{ gridColumn: '1/-1' }}>
              <Input label="На карту (необязательно)" value={form.card_amount} onChange={(v: string) => setForm({ ...form, card_amount: v })} placeholder="0" type="number" />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <Btn onClick={save}>{editingId ? 'Сохранить' : 'Добавить'}</Btn>
            <Btn variant="gray" onClick={() => { setShowForm(false); setEditingId(null) }}>Отмена</Btn>
          </div>
        </Card>
      )}

      {loading ? <div style={{ color: '#6d6d72', textAlign: 'center' as const, padding: 40 }}>Загрузка...</div> : (
        <Card>
          {employees.length === 0
            ? <div style={{ textAlign: 'center' as const, padding: '32px 0', color: '#6d6d72' }}>Сотрудников пока нет. Добавьте первого!</div>
            : employees.map((emp, i) => (
                <div key={emp.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 0', borderBottom: i < employees.length - 1 ? '1px solid rgba(60,60,67,.08)' : 'none', gap: 12 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: '.95rem', marginBottom: 3, color: '#1c1c1e' }}>{emp.name}</div>
                    <div style={{ fontSize: '.78rem', color: '#6d6d72', display: 'flex', gap: 12, flexWrap: 'wrap' as const }}>
                      <span>Оклад: <strong>€{emp.salary}</strong></span>
                      <span>Вычет: <strong>€{emp.deduct_per_absence}</strong></span>
                      {emp.card_amount > 0 && <span>Карта: <strong>€{emp.card_amount}</strong></span>}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <Btn small variant="ghost" onClick={() => startEdit(emp)}>Изменить</Btn>
                    <Btn small variant="danger" onClick={() => remove(emp.id)}>✕</Btn>
                  </div>
                </div>
              ))
          }
        </Card>
      )}

      {employees.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, marginTop: 12 }}>
          {[
            { l: 'Сотрудников', v: String(employees.length), c: '#1c1c1e' },
            { l: 'ФОТ', v: `€${employees.reduce((s,e)=>s+e.salary,0).toLocaleString()}`, c: '#007aff' },
            { l: 'На карту', v: `€${employees.reduce((s,e)=>s+e.card_amount,0).toLocaleString()}`, c: '#af52de' },
          ].map(item => (
            <div key={item.l} style={{ background: '#f9f9f9', borderRadius: 12, padding: '14px', textAlign: 'center' as const }}>
              <div style={{ fontSize: '.72rem', color: '#6d6d72', fontWeight: 600, textTransform: 'uppercase' as const, marginBottom: 4 }}>{item.l}</div>
              <div style={{ fontSize: '1.3rem', fontWeight: 700, color: item.c }}>{item.v}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── CATEGORIES TAB ──
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
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: '1.4rem', fontWeight: 700, marginBottom: 4 }}>Категории расходов</div>
        <div style={{ color: '#6d6d72', fontSize: '.85rem' }}>Менеджер выбирает из этого списка при добавлении расхода</div>
      </div>
      <Card style={{ marginBottom: 16 }}>
        <div style={{ fontWeight: 700, fontSize: '1rem', marginBottom: 14 }}>Добавить категорию</div>
        <div style={{ display: 'flex', gap: 10 }}>
          <input value={newName} onChange={e => setNewName(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()} placeholder="Например: Мойка, DJ, Ремонт..."
            style={{ flex: 1, padding: '10px 13px', borderRadius: 10, border: '1px solid rgba(60,60,67,.2)', fontSize: '.9rem', fontFamily: 'inherit', outline: 'none', color: '#1c1c1e' }} />
          <Btn onClick={add}>Добавить</Btn>
        </div>
      </Card>
      <Card>
        <div style={{ fontWeight: 700, fontSize: '1rem', marginBottom: 14 }}>Текущие категории ({cats.length})</div>
        {loading ? <div style={{ color: '#6d6d72' }}>Загрузка...</div> : cats.length === 0
          ? <div style={{ textAlign: 'center' as const, padding: '24px 0', color: '#6d6d72' }}>Категорий пока нет</div>
          : <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: 8 }}>
              {cats.map(cat => (
                <div key={cat.id} style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#f2f2f7', borderRadius: 980, padding: '7px 14px' }}>
                  <span style={{ fontSize: '.88rem', fontWeight: 500, color: '#1c1c1e' }}>{cat.name}</span>
                  <button onClick={() => remove(cat.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#aeaeb2', fontSize: '.9rem', padding: 0 }}>✕</button>
                </div>
              ))}
            </div>
        }
      </Card>
      <div style={{ marginTop: 14, padding: '12px 16px', background: 'rgba(255,149,0,.08)', borderRadius: 12, fontSize: '.84rem', color: '#6d6d72', lineHeight: 1.6 }}>
        Менеджеры в SO Manager видят только эти категории. Зарплаты сотрудников считаются отдельно автоматически.
      </div>
    </div>
  )
}

// ── TEAM TAB ──
function TeamTab({ restaurantId }: { restaurantId: string }) {
  const [staff, setStaff] = useState<StaffMember[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ name: '', pin: '', apps: [] as string[] })
  const [saving, setSaving] = useState(false)
  const [editingId, setEditingId] = useState<string|null>(null)

  const load = async () => {
    setLoading(true)
    const { data } = await supabase.from('staff').select('*').eq('restaurant_id', restaurantId).eq('is_active', true).order('name')
    setStaff(data || []); setLoading(false)
  }

  useEffect(() => { if (restaurantId) load() }, [restaurantId])

  const toggleApp = (appId: string) => {
    setForm(f => ({ ...f, apps: f.apps.includes(appId) ? f.apps.filter(a=>a!==appId) : [...f.apps, appId] }))
  }

  const save = async () => {
    if (!form.name.trim()) return
    if (!editingId && (form.pin.length !== 4 || !/^\d+$/.test(form.pin))) { alert('PIN должен быть 4 цифры'); return }
    if (!form.apps.length) { alert('Выберите хотя бы одно приложение'); return }
    setSaving(true)
    const payload: any = { restaurant_id: restaurantId, name: form.name, apps: form.apps, is_active: true }
    if (form.pin) payload.pin_hash = form.pin // In production hash this
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

  const appName = (id: string) => APPS.find(a=>a.id===id)?.name || id
  const appColor = (id: string) => APPS.find(a=>a.id===id)?.color || '#007aff'

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <div style={{ fontSize: '1.4rem', fontWeight: 700, marginBottom: 4 }}>Доступы команды</div>
          <div style={{ color: '#6d6d72', fontSize: '.85rem' }}>Сотрудники входят по PIN-коду</div>
        </div>
        <Btn onClick={() => { setShowForm(!showForm); setEditingId(null); setForm({ name:'', pin:'', apps:[] }) }}>
          {showForm ? 'Отмена' : '+ Добавить'}
        </Btn>
      </div>

      {showForm && (
        <Card style={{ marginBottom: 16, border: '1px solid #007aff' }}>
          <div style={{ fontWeight: 700, fontSize: '1rem', marginBottom: 16 }}>{editingId ? 'Редактировать доступ' : 'Новый сотрудник'}</div>
          <Input label="Имя" value={form.name} onChange={(v: string) => setForm({...form, name:v})} placeholder="Имя сотрудника" />
          <Input label={editingId ? 'Новый PIN (оставьте пустым чтобы не менять)' : 'PIN-код (4 цифры)'} value={form.pin} onChange={(v: string) => setForm({...form, pin:v.slice(0,4)})} placeholder="1234" type="number" />
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: '.75rem', fontWeight: 600, color: '#6d6d72', marginBottom: 8, textTransform: 'uppercase' as const, letterSpacing: '.04em' }}>Доступ к приложениям</div>
            <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 8 }}>
              {APPS.map(app => (
                <label key={app.id} style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer', padding: '10px 14px', borderRadius: 10, background: form.apps.includes(app.id) ? app.color+'12' : '#f9f9f9', border: `1px solid ${form.apps.includes(app.id) ? app.color : 'transparent'}`, transition: 'all .15s' }}>
                  <input type="checkbox" checked={form.apps.includes(app.id)} onChange={() => toggleApp(app.id)} style={{ width: 16, height: 16, accentColor: app.color }} />
                  <div>
                    <div style={{ fontSize: '.9rem', fontWeight: 600, color: '#1c1c1e' }}>{app.name}</div>
                    <div style={{ fontSize: '.75rem', color: '#6d6d72' }}>{app.hint}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <Btn onClick={save} disabled={saving}>{saving ? 'Сохранение...' : editingId ? 'Сохранить' : 'Создать доступ'}</Btn>
            <Btn variant="gray" onClick={() => { setShowForm(false); setEditingId(null) }}>Отмена</Btn>
          </div>
        </Card>
      )}

      {loading ? <div style={{ color: '#6d6d72', textAlign: 'center' as const, padding: 40 }}>Загрузка...</div>
        : staff.length === 0
          ? <Card><div style={{ textAlign: 'center' as const, padding: '32px 0', color: '#6d6d72' }}>Нет сотрудников с доступом. Добавьте первого!</div></Card>
          : <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 10 }}>
              {staff.map(s => (
                <Card key={s.id} style={{ padding: 16 }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                        <div style={{ fontWeight: 700, fontSize: '1rem', color: '#1c1c1e' }}>{s.name}</div>
                        <div style={{ fontSize: '.72rem', fontWeight: 600, padding: '2px 8px', borderRadius: 980, background: s.device_id ? '#34c75915' : '#ff3b3015', color: s.device_id ? '#34c759' : '#ff3b30' }}>
                          {s.device_id ? 'Устройство привязано' : 'Не привязано'}
                        </div>
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: 6, marginBottom: 8 }}>
                        {(s.apps||[]).map(appId => (
                          <span key={appId} style={{ fontSize: '.72rem', fontWeight: 600, padding: '2px 8px', borderRadius: 980, background: appColor(appId)+'15', color: appColor(appId) }}>{appName(appId)}</span>
                        ))}
                      </div>
                      {s.device_id && (
                        <button onClick={() => resetDevice(s.id)} style={{ background: 'none', border: 'none', color: '#ff9500', fontSize: '.78rem', fontWeight: 600, cursor: 'pointer', padding: 0, fontFamily: 'inherit' }}>
                          Сбросить устройство
                        </button>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                      <Btn small variant="ghost" onClick={() => startEdit(s)}>Изменить</Btn>
                      <Btn small variant="danger" onClick={() => remove(s.id)}>✕</Btn>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
      }

      <div style={{ marginTop: 16, padding: '14px 16px', background: 'rgba(0,122,255,.06)', borderRadius: 12, fontSize: '.84rem', color: '#6d6d72', lineHeight: 1.6 }}>
        Сотрудник при первом входе вводит PIN → устройство привязывается → следующие входы автоматически через Face ID или PIN.
      </div>
    </div>
  )
}

// ── SETTINGS TAB ──
function SettingsTab({ restaurant, onUpdate }: { restaurant: Restaurant | null; onUpdate: () => void }) {
  const [name, setName] = useState(restaurant?.name || '')
  const [currency, setCurrency] = useState(restaurant?.currency || '€')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => { if (restaurant) { setName(restaurant.name); setCurrency(restaurant.currency || '€') } }, [restaurant])

  const save = async () => {
    if (!restaurant) return
    setSaving(true)
    await supabase.from('restaurants').update({ name, currency }).eq('id', restaurant.id)
    setSaving(false); setSaved(true); setTimeout(() => setSaved(false), 2000); onUpdate()
  }

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: '1.4rem', fontWeight: 700, marginBottom: 4 }}>Настройки</div>
        <div style={{ color: '#6d6d72', fontSize: '.85rem' }}>Основные параметры заведения</div>
      </div>
      <Card style={{ marginBottom: 16 }}>
        <div style={{ fontWeight: 700, fontSize: '1rem', marginBottom: 16 }}>Заведение</div>
        <Input label="Название" value={name} onChange={setName} placeholder="Название вашего ресторана" />
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', fontSize: '.75rem', fontWeight: 600, color: '#6d6d72', marginBottom: 5, textTransform: 'uppercase' as const, letterSpacing: '.04em' }}>Валюта</label>
          <select value={currency} onChange={e => setCurrency(e.target.value)} style={{ width: '100%', padding: '10px 13px', borderRadius: 10, border: '1px solid rgba(60,60,67,.2)', fontSize: '.9rem', fontFamily: 'inherit', outline: 'none', color: '#1c1c1e' }}>
            <option value="€">€ — Евро</option>
            <option value="₸">₸ — Тенге</option>
            <option value="₽">₽ — Рубль</option>
            <option value="$">$ — Доллар</option>
          </select>
        </div>
        <Btn onClick={save}>{saving ? 'Сохранение...' : saved ? '✓ Сохранено' : 'Сохранить'}</Btn>
      </Card>
      <Card style={{ border: '1px solid rgba(255,59,48,.2)' }}>
        <div style={{ fontWeight: 700, fontSize: '1rem', marginBottom: 8, color: '#1c1c1e' }}>Опасная зона</div>
        <div style={{ fontSize: '.84rem', color: '#6d6d72', marginBottom: 16 }}>Эти действия необратимы.</div>
        <Btn variant="danger">Удалить аккаунт</Btn>
      </Card>
    </div>
  )
}

// ── BILLING TAB ──
function BillingTab() {
  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: '1.4rem', fontWeight: 700, marginBottom: 4 }}>Подписка</div>
        <div style={{ color: '#6d6d72', fontSize: '.85rem' }}>Управление тарифом и оплатой</div>
      </div>
      <Card style={{ marginBottom: 16, border: '1px solid rgba(0,122,255,.2)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap' as const, gap: 16 }}>
          <div>
            <div style={{ display: 'inline-block', background: '#34c75915', color: '#34c759', fontSize: '.75rem', fontWeight: 700, padding: '3px 10px', borderRadius: 980, marginBottom: 12 }}>Активна</div>
            <div style={{ fontSize: '1.6rem', fontWeight: 700, marginBottom: 4, color: '#1c1c1e' }}>Бизнес</div>
            <div style={{ color: '#6d6d72', fontSize: '.85rem' }}>Все 3 приложения · До 10 сотрудников</div>
          </div>
          <div style={{ textAlign: 'right' as const }}>
            <div style={{ fontSize: '2rem', fontWeight: 700, color: '#1c1c1e' }}>€24</div>
            <div style={{ color: '#6d6d72', fontSize: '.82rem' }}>в месяц</div>
          </div>
        </div>
        <div style={{ marginTop: 20, display: 'flex', gap: 10 }}>
          <Btn>Управлять подпиской</Btn>
          <Btn variant="ghost">Сменить тариф</Btn>
        </div>
      </Card>
      <Card>
        <div style={{ fontWeight: 700, fontSize: '1rem', marginBottom: 14 }}>Что включено</div>
        {['SO Manager — управление сменами', 'SO Analytics — аналитика для владельца', 'Mise Stash — склад кальяна', 'До 10 сотрудников', 'История 12 месяцев', 'Приоритетная поддержка'].map((f,i,arr) => (
          <div key={f} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: i<arr.length-1?'1px solid rgba(60,60,67,.07)':'none', fontSize: '.88rem', color: '#1c1c1e' }}>
            <span style={{ color: '#34c759', fontWeight: 700, fontSize: '1rem' }}>✓</span> {f}
          </div>
        ))}
      </Card>
      <div style={{ marginTop: 14, textAlign: 'center' as const, fontSize: '.8rem', color: '#aeaeb2' }}>
        Платежи защищены через Stripe · Apple Pay · Visa · Mastercard
      </div>
    </div>
  )
}

// ── MAIN ──
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

  if (!user) return (
    <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', fontFamily:'-apple-system,sans-serif', color:'#6d6d72' }}>
      Загрузка...
    </div>
  )

  return (
    <div style={{ minHeight:'100vh', background:'#f2f2f7', fontFamily:'-apple-system,BlinkMacSystemFont,sans-serif', WebkitFontSmoothing:'antialiased' as const }}>
      <nav style={{ background:'rgba(255,255,255,.92)', backdropFilter:'blur(20px)', borderBottom:'1px solid rgba(60,60,67,.13)', padding:'0 24px', height:52, display:'flex', alignItems:'center', justifyContent:'space-between', position:'sticky' as const, top:0, zIndex:100 }}>
        <div style={{ fontWeight:700, fontSize:'1.1rem', color:'#1c1c1e' }}>Mise</div>
        <div style={{ display:'flex', alignItems:'center', gap:16 }}>
          <span style={{ fontSize:'.82rem', color:'#6d6d72' }}>{user.email}</span>
          <button onClick={async()=>{await supabase.auth.signOut();window.location.href='/auth/login'}}
            style={{ background:'none', border:'none', color:'#ff3b30', cursor:'pointer', fontSize:'.82rem', fontFamily:'inherit', fontWeight:600 }}>Выйти</button>
        </div>
      </nav>

      <div style={{ maxWidth:960, margin:'0 auto', padding:'28px 20px' }}>
        <div style={{ marginBottom:24 }}>
          <div style={{ fontSize:'1.6rem', fontWeight:700, marginBottom:3, color:'#1c1c1e' }}>{restaurant?.name || 'Мой ресторан'}</div>
          <div style={{ color:'#6d6d72', fontSize:'.85rem' }}>Личный кабинет владельца · {user.email}</div>
        </div>

        <div style={{ display:'flex', gap:4, marginBottom:24, overflowX:'auto' as const, paddingBottom:4 }}>
          {TABS.map(t => (
            <button key={t.id} onClick={()=>setTab(t.id)} style={{
              padding:'8px 16px', borderRadius:10, border:'none', fontFamily:'inherit', fontSize:'.82rem', fontWeight:600, cursor:'pointer', whiteSpace:'nowrap' as const,
              background: tab===t.id ? '#1c1c1e' : '#fff',
              color: tab===t.id ? '#fff' : '#1c1c1e',
              boxShadow: tab===t.id ? 'none' : '0 1px 3px rgba(0,0,0,.06),0 2px 8px rgba(0,0,0,.04)',
              transition:'all .15s'
            }}>
              {t.label}
            </button>
          ))}
        </div>

        {tab==='apps' && <AppsTab restaurant={restaurant} />}
        {tab==='employees' && restaurant && <EmployeesTab restaurantId={restaurant.id} />}
        {tab==='categories' && restaurant && <CategoriesTab restaurantId={restaurant.id} />}
        {tab==='team' && restaurant && <TeamTab restaurantId={restaurant.id} />}
        {tab==='settings' && <SettingsTab restaurant={restaurant} onUpdate={()=>user&&loadRestaurant(user.id)} />}
        {tab==='billing' && <BillingTab />}
      </div>
    </div>
  )
}
