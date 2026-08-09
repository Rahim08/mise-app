'use client'
// Команда: HR (employees) + доступы (staff). Перенесено из TeamTab старого dashboard/page.tsx.
import { useEffect, useState } from 'react'
import { db } from '@/lib/db'
import { QRCodeSVG as QRCode } from 'qrcode.react'
import { track } from '@/lib/analytics'
import { useI18n } from '@/lib/i18n'
import { entitlements } from '@/lib/plans'
import { Card, Btn, Field, Spinner, SectionTitle, inputStyle, Container, Table, type TableColumn } from '@/components/ui'
import { useDash } from '@/components/dash/context'
import { APPS, ROLE_OPTS, roleLabel } from '@/components/dash/shared'

export default function TeamPage() {
  const { t: tr } = useI18n()
  const { restaurant } = useDash()
  const restaurantId = restaurant?.id || ''
  // «Места» = тариф + купленные extra_seats; staff_limit — ручной override супер-админа.
  // Считает entitlements() (lib/plans.ts) — та же логика, что на сервере в /api/db.
  const maxStaff = entitlements(restaurant).seats

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
  const roleOptions = ROLE_OPTS.map(o => ({ value: o.value, label: tr(o.label) }))

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
  useEffect(() => { setOwnerPin(restaurant?.owner_pin || '') }, [restaurant?.owner_pin])

  // Ни ответ /api/auth/pin/hash, ни ошибка update раньше не проверялись: при сбое хеширования
  // в БД уходил owner_pin: undefined (values {}), UI писал «Сохранено», а владелец не мог войти.
  const saveOwnerPin = async () => {
    if (ownerPinVal.length !== 4 || !/^\d+$/.test(ownerPinVal)) { alert(tr('dash.pin4digits')); return }
    setOwnerSaving(true)
    let hash: string | undefined
    try {
      const hashRes = await fetch('/api/auth/pin/hash', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: ownerPinVal }) })
      if (hashRes.ok) hash = (await hashRes.json()).hash
    } catch {}
    if (!hash) { alert(tr('dash.saveFailed')); setOwnerSaving(false); return }
    const { error } = await db.from('restaurants').update({ owner_pin: hash }).eq('id', restaurantId)
    if (error) { alert(tr('dash.notSaved') + error.message); setOwnerSaving(false); return }
    setOwnerPin(ownerPinVal); setOwnerPinEdit(false); setOwnerPinVal('')
    setOwnerSaving(false); setOwnerSaved(true); setTimeout(() => setOwnerSaved(false), 2000)
  }

  const toggleApp = (appId: string) => {
    setForm(f => ({ ...f, apps: f.apps.includes(appId) ? f.apps.filter(a => a !== appId) : [...f.apps, appId] }))
  }
  // Матч по employee_id (FK, надёжно переживает переименование); имя — только
  // запасной вариант для строк staff, ещё не прошедших бэкофилл
  // (docs/migrations/attendance-automation.sql).
  const staffFor = (emp: { id: string; name: string }) =>
    staff.find(s => s.employee_id === emp.id) ?? staff.find(s => !s.employee_id && s.name === emp.name)

  // One save handles both HR (employees) and access (staff).
  const save = async () => {
    if (!form.name.trim()) { alert(tr('dash.enterName')); return }
    setSaving(true)
    const name = form.name.trim()
    const empPayload = { restaurant_id: restaurantId, name, salary: +form.salary || 0, deduct_per_absence: +form.deduct || 0, card_amount: +form.card || 0, is_active: true }
    let empId = editingEmpId
    if (editingEmpId) {
      const { error } = await db.from('employees').update(empPayload).eq('id', editingEmpId)
      if (error) { alert(tr('dash.notSaved') + error.message); setSaving(false); return }
    } else {
      const { data: newEmp, error } = await db.from('employees').insert(empPayload).select().single()
      // Раньше ошибка insert не проверялась: empId оставался null, а staff всё равно
      // создавался — доступ и PIN выданы «призраку», которого нет в HR-списке (аудит 2026-08-05).
      if (error || !newEmp?.id) { alert(tr('dash.notSaved') + (error?.message || '')); setSaving(false); return }
      empId = newEmp.id
    }

    const existing = empId ? staffFor({ id: empId, name }) : undefined
    if (form.apps.length) {
      if (!existing && (form.pin.length !== 4 || !/^\d+$/.test(form.pin))) { alert(tr('dash.setPinForAccess')); setSaving(false); return }
      let pinHash: string | undefined
      if (form.pin) { const r = await fetch('/api/auth/pin/hash', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: form.pin }) }); pinHash = (await r.json()).hash }
      const sp: any = { restaurant_id: restaurantId, name, apps: form.apps, role: form.role, is_active: true, employee_id: empId }
      if (pinHash) sp.pin_hash = pinHash
      const { error } = existing ? await db.from('staff').update(sp).eq('id', existing.id) : await db.from('staff').insert(sp)
      if (error) {
        // Тарифный лимит (checkStaffPlanLimit в /api/db) — раньше проваливался молча,
        // выглядело как "PIN не сохраняется" без объяснения причины.
        alert(error.message || tr('dash.saveFailed'))
        setSaving(false); return
      }
      if (!existing) track('team_member_invited', { apps_count: form.apps.length })
    } else if (existing) {
      await db.from('staff').update({ is_active: false }).eq('id', existing.id) // access revoked
    }
    setForm(blank); setShowForm(false); setEditingEmpId(null); setSaving(false); load()
  }

  const removePerson = async (emp: any) => {
    await db.from('employees').update({ is_active: false }).eq('id', emp.id)
    const s = staffFor(emp); if (s) await db.from('staff').update({ is_active: false }).eq('id', s.id)
    load()
  }
  const resetDevice = async (id: string) => { await db.from('staff').update({ device_id: null }).eq('id', id); load() }

  const startEdit = (emp: any) => {
    const s = staffFor(emp)
    setForm({ name: emp.name, role: s?.role || 'waiter', salary: String(emp.salary || ''), deduct: String(emp.deduct_per_absence || ''), card: String(emp.card_amount || ''), pin: '', apps: s?.apps || [] })
    setShowForm(false); setEditingEmpId(emp.id)
  }

  // Общее тело формы — используется и в карточке «новый сотрудник» (над таблицей),
  // и в раскрывающейся панели под строкой при редактировании (не наверху страницы).
  const renderFormBody = (isNew: boolean) => (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div style={{ gridColumn: '1/-1' }}>
          <Field label={tr('dash.name')} value={form.name} onChange={(v: string) => setForm({ ...form, name: v })} placeholder={tr('dash.namePh')} />
        </div>
        <Field label={tr('dash.role')} value={form.role} onChange={(v: string) => setForm({ ...form, role: v })} select options={roleOptions} />
        <Field label={tr('dash.salary')} value={form.salary} onChange={(v: string) => setForm({ ...form, salary: v })} placeholder="1000" type="number" />
        <Field label={tr('dash.deductPerAbsence')} value={form.deduct} onChange={(v: string) => setForm({ ...form, deduct: v })} placeholder="50" type="number" />
        <Field label={tr('dash.toCard')} value={form.card} onChange={(v: string) => setForm({ ...form, card: v })} placeholder="0" type="number" />
      </div>

      <div style={{ borderTop: 'var(--hairline)', margin: '8px 0 14px', paddingTop: 14 }}>
        <div style={{ fontSize: '.72rem', fontWeight: 600, color: 'var(--tx2)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '.04em' }}>{tr('dash.appAccess')}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
          {/* 'menu' сотрудникам не выдаётся: шлюз /api/db не знает такой AppId (доступ бы
              не работал), а /dashboard/menu — owner-роут. Решение пользователя 2026-07-17. */}
          {APPS.filter(app => app.id !== 'menu').map(app => (
            <label key={app.id} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', padding: '9px 12px', borderRadius: 10, background: form.apps.includes(app.id) ? app.color + '10' : 'var(--fill2)', border: `1px solid ${form.apps.includes(app.id) ? app.color : 'transparent'}`, transition: 'all var(--dur-fast) var(--ease)' }}>
              <input type="checkbox" checked={form.apps.includes(app.id)} onChange={() => toggleApp(app.id)} style={{ width: 16, height: 16, accentColor: app.color }} />
              <div>
                <div style={{ fontSize: '.88rem', fontWeight: 600, color: 'var(--tx)' }}>{app.name}</div>
                <div style={{ fontSize: '.72rem', color: 'var(--tx2)' }}>{tr(app.hint)}</div>
              </div>
            </label>
          ))}
        </div>
        {form.apps.length > 0 && (
          <Field
            label={(!isNew && staffFor({ id: editingEmpId || '', name: form.name.trim() })) ? tr('dash.newPinOptional') : tr('dash.pinForLogin')}
            value={form.pin} onChange={(v: string) => setForm({ ...form, pin: v.replace(/\D/g, '').slice(0, 4) })}
            placeholder="1234" type="password"
          />
        )}
        <div style={{ fontSize: '.72rem', color: 'var(--tx3)' }}>{tr('dash.noAppsNote')}</div>
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <Btn onClick={save} disabled={saving}>{saving ? tr('dash.saving') : isNew ? tr('dash.add') : tr('dash.save')}</Btn>
        <Btn variant="gray" onClick={() => { setShowForm(false); setEditingEmpId(null) }}>{tr('dash.cancel')}</Btn>
      </div>
    </>
  )

  const appColor = (id: string) => APPS.find(a => a.id === id)?.color || 'var(--accent)'
  const appName = (id: string) => APPS.find(a => a.id === id)?.name || id
  const totalSalary = employees.reduce((s, e) => s + (e.salary || 0), 0)
  const withAccess = staff.length
  const atLimit = withAccess >= maxStaff

  const empColumns: TableColumn<any>[] = [
    {
      key: 'name', label: tr('dash.name'), sortable: true,
      render: emp => {
        const s = staffFor(emp)
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 600, color: 'var(--tx)' }}>{emp.name}</span>
            <span style={{ fontSize: '.68rem', fontWeight: 600, padding: '2px 7px', borderRadius: 980, background: 'var(--violet-soft)', color: 'var(--violet)' }}>{tr(roleLabel(s?.role))}</span>
            {s
              ? <span style={{ fontSize: '.68rem', fontWeight: 600, padding: '2px 7px', borderRadius: 980, background: s.device_id ? 'var(--ok-soft)' : 'var(--fill)', color: s.device_id ? 'var(--ok)' : 'var(--tx3)' }}>{s.device_id ? tr('dash.bound') : tr('dash.notBound')}</span>
              : <span style={{ fontSize: '.68rem', fontWeight: 600, padding: '2px 7px', borderRadius: 980, background: 'var(--fill)', color: 'var(--tx3)' }}>{tr('dash.noAccess')}</span>}
          </div>
        )
      },
    },
    { key: 'salary', label: tr('dash.salaryShort'), align: 'right', sortable: true, sortValue: e => e.salary || 0, render: e => `€${e.salary || 0}` },
    { key: 'deduct_per_absence', label: tr('dash.deductShort'), align: 'right', sortable: true, sortValue: e => e.deduct_per_absence || 0, render: e => `€${e.deduct_per_absence || 0}` },
    { key: 'card_amount', label: tr('dash.cardShort'), align: 'right', sortable: true, sortValue: e => e.card_amount || 0, render: e => e.card_amount > 0 ? `€${e.card_amount}` : '—' },
    {
      key: 'apps', label: tr('dash.appAccess'),
      render: emp => {
        const s = staffFor(emp)
        if (!s?.apps?.length) return <span style={{ color: 'var(--tx3)' }}>—</span>
        return (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            {s.apps.map((appId: string) => (
              <span key={appId} style={{ fontSize: '.68rem', fontWeight: 600, padding: '2px 7px', borderRadius: 980, background: appColor(appId) + '15', color: appColor(appId) }}>{appName(appId)}</span>
            ))}
          </div>
        )
      },
    },
    {
      key: 'actions', label: '', align: 'right',
      render: emp => {
        const s = staffFor(emp)
        return (
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'flex-end' }} onClick={e => e.stopPropagation()}>
            {s?.device_id && <button onClick={() => resetDevice(s.id)} style={{ background: 'none', border: 'none', color: 'var(--warn)', fontSize: '.75rem', fontWeight: 600, cursor: 'pointer', padding: 0, fontFamily: 'inherit' }}>{tr('dash.resetDevice')}</button>}
            <Btn small variant="ghost" onClick={() => editingEmpId === emp.id ? setEditingEmpId(null) : startEdit(emp)}>{tr('dash.edit')}</Btn>
            <Btn small variant="danger" onClick={() => removePerson(emp)}>
              <svg width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" viewBox="0 0 12 12"><path d="M2 2l8 8M10 2l-8 8" /></svg>
            </Btn>
          </div>
        )
      },
    },
  ]

  return (
    <Container size="wide">
      <SectionTitle title={tr('dash.navTeam')} sub={tr('dash.teamSub')} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginBottom: 16 }}>
        {[{ l: tr('dash.inTeam'), v: String(employees.length), c: 'var(--tx)' }, { l: tr('dash.withAccess'), v: `${withAccess}/${maxStaff}`, c: 'var(--accent)' }, { l: tr('dash.payrollMo'), v: `${restaurant?.currency || '€'}${totalSalary.toLocaleString()}`, c: 'var(--violet)' }].map(it => (
          <Card key={it.l} style={{ padding: '14px 16px', textAlign: 'center' }}>
            <div style={{ fontSize: '.68rem', color: 'var(--tx2)', fontWeight: 600, textTransform: 'uppercase', marginBottom: 4, letterSpacing: '.04em' }}>{it.l}</div>
            <div style={{ fontSize: '1.3rem', fontWeight: 700, color: it.c, fontVariantNumeric: 'tabular-nums' }}>{it.v}</div>
          </Card>
        ))}
      </div>

      {atLimit && (
        <div style={{ background: 'var(--warn-soft)', border: '1px solid rgba(255,149,0,.25)', borderRadius: 12, padding: '10px 14px', marginBottom: 14, fontSize: '.83rem', color: 'var(--warn)', fontWeight: 500 }}>
          {tr('dash.accessLimit', { n: maxStaff })}
        </div>
      )}

      {/* ─ QR БЛОК ─ */}
      <Card style={{ marginBottom: 14, background: 'linear-gradient(135deg, #007aff08 0%, #5856d608 100%)', border: '1px solid rgba(0,122,255,.15)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: '.95rem', color: 'var(--tx)', marginBottom: 4 }}>{tr('dash.venueQr')}</div>
            <div style={{ fontSize: '.8rem', color: 'var(--tx2)', lineHeight: 1.5 }}>
              {tr('dash.qrSub')}
            </div>
          </div>
          <Btn onClick={() => setShowQR(!showQR)}>{showQR ? tr('dash.hide') : tr('dash.showQr')}</Btn>
        </div>

        {showQR && (
          <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid rgba(0,122,255,.1)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
            <div style={{ background: 'var(--surface)', borderRadius: 16, padding: 16, boxShadow: 'var(--sh-card)' }}>
              <QRCode value={qrUrl} size={160} />
            </div>
            <div style={{ fontSize: '.75rem', color: 'var(--tx3)', textAlign: 'center', maxWidth: 260, lineHeight: 1.5 }}>
              {qrUrl}
            </div>
            <Btn small variant="gray" onClick={() => {
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
            }}>
              {tr('dash.copyLink')}
            </Btn>
          </div>
        )}
      </Card>

      {/* ─ ВЛАДЕЛЕЦ PIN ─ */}
      <Card style={{ marginBottom: 14, border: '1px solid rgba(175,82,222,.2)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <div style={{ fontWeight: 700, fontSize: '.95rem', color: 'var(--tx)' }}>{tr('dash.owner')}</div>
              <div style={{ fontSize: '.7rem', fontWeight: 700, padding: '2px 8px', borderRadius: 980, background: 'var(--violet-soft)', color: 'var(--violet)' }}>{tr('dash.fullAccess')}</div>
            </div>
            <div style={{ fontSize: '.8rem', color: 'var(--tx2)' }}>
              {ownerPin ? tr('dash.pinSet') : tr('dash.pinNotSet')}
            </div>
          </div>
          <button onClick={() => { setOwnerPinEdit(!ownerPinEdit); setOwnerPinVal('') }} className="ui-press" style={{ background: 'none', border: '1px solid rgba(175,82,222,.3)', borderRadius: 980, padding: '7px 14px', fontSize: '.78rem', fontWeight: 600, color: 'var(--violet)', cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 }}>
            {ownerPinEdit ? tr('dash.cancel') : ownerPin ? tr('dash.changePin') : tr('dash.setPin')}
          </button>
        </div>

        {ownerPinEdit && (
          <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid rgba(175,82,222,.1)', display: 'flex', gap: 10, alignItems: 'flex-end' }}>
            <div style={{ flex: 1 }}>
              <label style={{ display: 'block', fontSize: '.72rem', fontWeight: 600, color: 'var(--tx2)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '.04em' }}>{tr('dash.newPin4')}</label>
              <input
                type="password" inputMode="numeric" maxLength={4}
                value={ownerPinVal} onChange={e => setOwnerPinVal(e.target.value.replace(/\D/g,'').slice(0,4))}
                placeholder="••••" className="ui-input"
                style={{ ...inputStyle, letterSpacing: '.2em', fontSize: '1.2rem', textAlign: 'center' }}
              />
            </div>
            <Btn onClick={saveOwnerPin} disabled={ownerSaving}>
              {ownerSaving ? '...' : ownerSaved ? tr('dash.savedCheck') : tr('dash.save')}
            </Btn>
          </div>
        )}
      </Card>

      {/* ─ КНОПКА ДОБАВИТЬ — над списком, не в начале страницы ─ */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
        <Btn onClick={() => { setEditingEmpId(null); setForm(blank); setShowForm(f => !f) }}>
          {showForm ? tr('dash.cancel') : tr('dash.addBtn')}
        </Btn>
      </div>

      {/* ─ ФОРМА НОВОГО СОТРУДНИКА — тоже над списком ─ */}
      {showForm && (
        <Card style={{ marginBottom: 14, border: '1px solid var(--accent)' }}>
          <div style={{ fontWeight: 700, fontSize: '.95rem', marginBottom: 14 }}>{tr('dash.newEmployee')}</div>
          {renderFormBody(true)}
        </Card>
      )}

      {/* ─ СПИСОК — правка сотрудника раскрывается прямо под его строкой ─ */}
      {loading ? (
        <Spinner />
      ) : employees.length === 0 ? (
        <Card><div style={{ textAlign: 'center', padding: '28px 0', color: 'var(--tx2)', fontSize: '.88rem' }}>{tr('dash.addFirstEmployee')}</div></Card>
      ) : (
        <Table columns={empColumns} rows={employees} searchable searchPlaceholder={tr('dash.name')} searchText={e => e.name}
          expandedId={editingEmpId} renderExpanded={() => <div style={{ padding: 16 }}>{renderFormBody(false)}</div>} />
      )}
    </Container>
  )
}
