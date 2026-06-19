'use client'
import { useEffect, useState } from 'react'

type Role = 'cashier' | 'waiter' | 'kitchen' | 'manager' | 'owner'
type Device = {
  id: string
  name: string
  role: Role
  last_seen_at: string | null
  is_active: boolean
  created_at: string
}

const ROLES: { value: Role; label: string; desc: string }[] = [
  { value: 'waiter',  label: 'Официант',  desc: 'Принимает заказы, видит зал' },
  { value: 'cashier', label: 'Кассир',    desc: 'Принимает оплату, открывает смену' },
  { value: 'kitchen', label: 'Кухня',     desc: 'Только KDS — видит тикеты' },
  { value: 'manager', label: 'Менеджер',  desc: 'Полный доступ без POS' },
]

const ROLE_COLOR: Record<Role, string> = {
  waiter: '#3b82f6', cashier: '#22c55e', kitchen: '#f97316', manager: '#a855f7', owner: '#eab308',
}

function timeAgo(iso: string | null) {
  if (!iso) return 'Никогда'
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return 'Только что'
  if (mins < 60) return `${mins} мин назад`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}ч назад`
  return `${Math.floor(hrs / 24)}д назад`
}

function isOnline(iso: string | null) {
  if (!iso) return false
  return Date.now() - new Date(iso).getTime() < 5 * 60 * 1000
}

export default function DevicesPage() {
  const [devices, setDevices] = useState<Device[]>([])
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({ name: '', role: 'waiter' as Role, pin: '' })
  const [saving, setSaving] = useState(false)
  const [pinVisible, setPinVisible] = useState(false)
  const [editingPin, setEditingPin] = useState<{ id: string; pin: string } | null>(null)

  useEffect(() => {
    fetch('/api/pos/devices').then(r => r.json()).then(d => setDevices(d.devices ?? []))
  }, [])

  async function addDevice() {
    if (!form.name.trim() || form.pin.length !== 4) return
    setSaving(true)
    const r = await fetch('/api/pos/devices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    const d = await r.json()
    if (d.device) {
      setDevices(prev => [...prev, d.device])
      setForm({ name: '', role: 'waiter', pin: '' })
      setShowAdd(false)
    }
    setSaving(false)
  }

  async function toggleActive(device: Device) {
    const r = await fetch('/api/pos/devices', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: device.id, is_active: !device.is_active }),
    })
    const d = await r.json()
    if (d.device) setDevices(prev => prev.map(x => x.id === device.id ? d.device : x))
  }

  async function changePin() {
    if (!editingPin || editingPin.pin.length !== 4) return
    await fetch('/api/pos/devices', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: editingPin.id, pin: editingPin.pin }),
    })
    setEditingPin(null)
  }

  async function deleteDevice(id: string) {
    if (!confirm('Удалить устройство?')) return
    await fetch(`/api/pos/devices?id=${id}`, { method: 'DELETE' })
    setDevices(prev => prev.filter(x => x.id !== id))
  }

  const online = devices.filter(d => d.is_active && isOnline(d.last_seen_at))

  return (
    <div style={{ padding: 32, maxWidth: 860 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 32 }}>
        <div>
          <h1 style={{ color: '#fff', fontSize: 24, fontWeight: 800, margin: 0 }}>Устройства</h1>
          <p style={{ color: '#555', marginTop: 6, fontSize: 14 }}>
            {online.length} онлайн · {devices.filter(d => d.is_active).length} активных
          </p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          style={{ padding: '10px 20px', background: '#fff', color: '#000', border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 14, cursor: 'pointer' }}
        >
          + Добавить устройство
        </button>
      </div>

      {/* Instructions */}
      <div style={{ background: '#0d0d0d', border: '1px solid #1a1a1a', borderRadius: 14, padding: 20, marginBottom: 28 }}>
        <div style={{ color: '#555', fontSize: 13, lineHeight: 1.7 }}>
          <div style={{ color: '#fff', fontWeight: 600, marginBottom: 8, fontSize: 14 }}>Как подключить iOS-устройство</div>
          1. Запусти сервер: <code style={{ color: '#888', background: '#1a1a1a', padding: '1px 6px', borderRadius: 4 }}>cd pos/server && bun dev</code><br />
          2. Убедись что Mac и iPad/iPhone в одной Wi-Fi сети<br />
          3. Добавь устройство здесь — задай имя и 4-значный PIN<br />
          4. Открой MisePOS на iOS — он найдёт сервер автоматически через Bonjour<br />
          5. Введи PIN — готово
        </div>
      </div>

      {/* Device list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {devices.length === 0 && (
          <div style={{ color: '#333', fontSize: 14, textAlign: 'center', padding: '40px 0' }}>
            Нет устройств. Добавь первое чтобы начать.
          </div>
        )}
        {devices.map(d => (
          <div key={d.id} style={{
            background: '#111', border: `1px solid ${d.is_active ? '#1e1e1e' : '#161616'}`,
            borderRadius: 14, padding: '18px 20px',
            opacity: d.is_active ? 1 : 0.5,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              {/* Status dot */}
              <div style={{
                width: 10, height: 10, borderRadius: '50%',
                background: isOnline(d.last_seen_at) ? '#22c55e' : '#2a2a2a',
                flexShrink: 0,
                boxShadow: isOnline(d.last_seen_at) ? '0 0 6px #22c55e80' : 'none',
              }} />

              {/* Name + role */}
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ color: '#fff', fontWeight: 700, fontSize: 15 }}>{d.name}</span>
                  <span style={{
                    fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 6,
                    background: ROLE_COLOR[d.role] + '22',
                    color: ROLE_COLOR[d.role],
                    textTransform: 'uppercase', letterSpacing: '0.04em',
                  }}>
                    {ROLES.find(r => r.value === d.role)?.label ?? d.role}
                  </span>
                </div>
                <div style={{ color: '#444', fontSize: 12, marginTop: 3 }}>
                  Последний раз: {timeAgo(d.last_seen_at)} · ID: {d.id.slice(0, 8)}
                </div>
              </div>

              {/* Actions */}
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {editingPin?.id === d.id ? (
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <input
                      autoFocus
                      maxLength={4}
                      value={editingPin.pin}
                      onChange={e => setEditingPin({ ...editingPin, pin: e.target.value.replace(/\D/g, '') })}
                      placeholder="1234"
                      style={{ width: 60, background: '#1a1a1a', border: '1px solid #333', borderRadius: 6, padding: '5px 8px', color: '#fff', fontSize: 14, textAlign: 'center', outline: 'none' }}
                    />
                    <button onClick={changePin} style={actionBtn('#22c55e')}>OK</button>
                    <button onClick={() => setEditingPin(null)} style={actionBtn('#333')}>×</button>
                  </div>
                ) : (
                  <button onClick={() => setEditingPin({ id: d.id, pin: '' })} style={actionBtn('#333')}>PIN</button>
                )}
                <button onClick={() => toggleActive(d)} style={actionBtn(d.is_active ? '#1a1a1a' : '#333')}>
                  {d.is_active ? 'Откл' : 'Вкл'}
                </button>
                <button onClick={() => deleteDevice(d.id)} style={actionBtn('#ff444422', '#ff4444')}>
                  Удалить
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Add device modal */}
      {showAdd && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div style={{ background: '#111', border: '1px solid #222', borderRadius: 18, padding: 28, width: 380, display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div style={{ color: '#fff', fontWeight: 800, fontSize: 18 }}>Новое устройство</div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={labelStyle}>Название</label>
              <input
                autoFocus
                value={form.name}
                onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                placeholder="Терминал кассы, iPad официант..."
                style={inputStyle}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <label style={labelStyle}>Роль</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {ROLES.map(r => (
                  <button
                    key={r.value}
                    onClick={() => setForm(p => ({ ...p, role: r.value }))}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12,
                      padding: '10px 14px', borderRadius: 10, cursor: 'pointer',
                      background: form.role === r.value ? ROLE_COLOR[r.value] + '18' : '#1a1a1a',
                      border: `1px solid ${form.role === r.value ? ROLE_COLOR[r.value] + '44' : '#2a2a2a'}`,
                      textAlign: 'left',
                    }}
                  >
                    <span style={{ color: form.role === r.value ? ROLE_COLOR[r.value] : '#555', fontSize: 13, fontWeight: 700, minWidth: 72 }}>{r.label}</span>
                    <span style={{ color: '#444', fontSize: 12 }}>{r.desc}</span>
                  </button>
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={labelStyle}>4-значный PIN</label>
              <div style={{ position: 'relative' }}>
                <input
                  type={pinVisible ? 'text' : 'password'}
                  maxLength={4}
                  value={form.pin}
                  onChange={e => setForm(p => ({ ...p, pin: e.target.value.replace(/\D/g, '') }))}
                  placeholder="1234"
                  style={{ ...inputStyle, paddingRight: 40, letterSpacing: '0.3em', fontSize: 18, fontWeight: 700 }}
                />
                <button
                  onClick={() => setPinVisible(v => !v)}
                  style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: 12 }}
                >
                  {pinVisible ? 'скр' : 'пок'}
                </button>
              </div>
              {form.pin.length > 0 && form.pin.length < 4 && (
                <span style={{ color: '#555', fontSize: 12 }}>Нужно 4 цифры</span>
              )}
            </div>

            <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
              <button onClick={() => setShowAdd(false)} style={{ flex: 1, padding: '12px 0', background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 10, color: '#555', fontSize: 14, cursor: 'pointer' }}>
                Отмена
              </button>
              <button
                onClick={addDevice}
                disabled={!form.name.trim() || form.pin.length !== 4 || saving}
                style={{ flex: 1, padding: '12px 0', background: form.name.trim() && form.pin.length === 4 ? '#fff' : '#1a1a1a', border: 'none', borderRadius: 10, color: form.name.trim() && form.pin.length === 4 ? '#000' : '#333', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}
              >
                {saving ? '...' : 'Добавить'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const labelStyle: React.CSSProperties = { color: '#444', fontSize: 11, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase' }
const inputStyle: React.CSSProperties = { background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 8, padding: '10px 12px', color: '#fff', fontSize: 14, outline: 'none', width: '100%', boxSizing: 'border-box' }
function actionBtn(bg: string, color = '#fff'): React.CSSProperties {
  return { padding: '6px 12px', background: bg, border: '1px solid #2a2a2a', borderRadius: 8, color, fontSize: 12, fontWeight: 600, cursor: 'pointer' }
}
