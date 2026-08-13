'use client'
import React, { useEffect, useState } from 'react'
import { db } from '@/lib/db'
import { notify as pushNotify } from '@/lib/notifyClient'
import { useI18n } from '@/lib/i18n'
import { PURCHASE_CATS } from '@/app/people/tabs-ops'
import { Sheet, roleLabel } from '@/components/people/helpers'

// Manager → Настройки → Заявки (юзер-фидбок 2026-08-13/14): инбокс заявок сотрудников с
// триажем — конвертация в задачу («В задачу») или в закуп («В закуп», только type='order')
// одним тапом, вместо ручного пересоздания текста. Создание заявки — личное действие
// сотрудника, остаётся в People (app/people/tabs-tasks.tsx, не тронуто). Паритет с iOS
// ManagerReports.swift.

const REPORT_TYPE: Record<string, { label: string; color: (t: any) => string }> = {
  breakdown: { label: 'pe.rtBreakdown', color: t => t.red },
  notice: { label: 'pe.rtNotice', color: t => t.orange },
  order: { label: 'pe.rtOrder', color: t => t.green },
  suggestion: { label: 'pe.rtSuggestion', color: t => t.blue },
  other: { label: 'pe.rtOther', color: t => t.text3 },
}
const REPORT_STATUS: Record<string, string> = { new: 'pe.rsNew', reviewed: 'pe.rsReviewed', resolved: 'pe.rsResolved' }

export function ManagerReportsTab({ restaurantId, accent, t }: { restaurantId: string; accent: string; t: any }) {
  const { t: tr } = useI18n()
  const [reports, setReports] = useState<any[]>([])
  const [staff, setStaff] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState('')
  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(''), 2500) }
  const [convertTask, setConvertTask] = useState<any | null>(null)
  const [convertPurchase, setConvertPurchase] = useState<any | null>(null)

  const load = async () => {
    setLoading(true)
    const [{ data: rp }, { data: dir }] = await Promise.all([
      db.from('staff_reports').select('*').order('created_at', { ascending: false }).limit(200),
      db.from('staff_directory').select('*').eq('is_active', true).order('name'),
    ])
    setReports(rp || []); setStaff(dir || []); setLoading(false)
  }
  useEffect(() => { load() }, [])
  const staffName = (id: string) => staff.find(s => s.id === id)?.name || tr('pe.unknown')
  const roles = Array.from(new Set(staff.map(s => s.role).filter(Boolean))) as string[]

  const setStatus = async (r: any, status: string) => {
    setReports(rs => rs.map(x => x.id === r.id ? { ...x, status } : x))
    await db.from('staff_reports').update({ status, resolved_at: status === 'resolved' ? new Date().toISOString() : null }).eq('id', r.id)
  }
  const removeReport = async (id: string) => {
    setReports(rs => rs.filter(x => x.id !== id))
    await db.from('staff_reports').delete().eq('id', id)
  }

  const doConvertTask = async (r: any, assignee: string, priority: string, due: string) => {
    if (!assignee) { showToast(tr('pe.taskNeedTitleAssignee')); return }
    let targets: string[]
    if (assignee.startsWith('role:')) {
      const role = assignee.slice(5)
      targets = staff.filter(s => s.role === role).map(s => s.id)
      if (targets.length === 0) { showToast(tr('pe.noActiveStaffRole')); return }
    } else {
      targets = [assignee]
    }
    const base = { title: r.title, description: r.description || null, created_by: null, priority, due_date: due || null, status: 'todo' }
    const results = await Promise.all(targets.map(tid => db.from('staff_tasks').insert({ ...base, assigned_to: tid })))
    if (results.every(x => x.error)) { showToast(tr('dash.notSaved') + results[0].error?.message); return }
    // B4 (аудит 2026-08-13): конвертация заявки в задачу раньше не слала пуш исполнителю,
    // в отличие от прямого создания (app/people/tabs-tasks.tsx createTask).
    pushNotify({ type: 'task', title: 'New task', body: r.title, titleKey: 'notify.newTaskTitle', audience: { staff_ids: targets } })
    await setStatus(r, 'resolved')
    setConvertTask(null)
    showToast(tr('pe.reportConverted'))
  }

  const doConvertPurchase = async (r: any, category: string, qty: string, unit: string) => {
    const payload = {
      category, name: r.title,
      qty: qty.trim() ? (Number(qty.replace(',', '.')) || null) : null,
      unit: unit.trim() || null,
      status: 'todo', created_by: null, created_by_name: staffName(r.author_id),
    }
    const { error } = await db.from('purchase_items').insert(payload)
    if (error) { showToast(tr('dash.notSaved') + error.message); return }
    await setStatus(r, 'resolved')
    setConvertPurchase(null)
    showToast(tr('pe.reportConverted'))
  }

  if (loading) return <div style={{ textAlign: 'center', padding: 40, color: t.text3 }}>{tr('pe.loading')}</div>

  return (
    <div>
      {reports.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '50px 20px', color: t.text3 }}>{tr('pe.noReports')}</div>
      ) : reports.map(r => {
        const resolved = (r.status || 'new') === 'resolved'
        const rt = REPORT_TYPE[r.type] || REPORT_TYPE.other
        return (
          <div key={r.id} style={{ background: t.surface, borderRadius: 16, boxShadow: t.sh, padding: 14, marginBottom: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: rt.color(t), textTransform: 'uppercase', letterSpacing: 0.4 }}>{tr(rt.label)}</span>
              <span style={{ fontSize: 11, fontWeight: 700, color: t.text3, background: t.fill, padding: '2px 8px', borderRadius: 20 }}>{tr(REPORT_STATUS[r.status || 'new'])}</span>
            </div>
            <div style={{ fontSize: 15, fontWeight: 600, color: t.text, opacity: resolved ? 0.5 : 1, textDecoration: resolved ? 'line-through' : 'none' }}>{r.title}</div>
            {r.description && <div style={{ fontSize: 13, color: t.text2, marginTop: 4 }}>{r.description}</div>}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 }}>
              <span style={{ fontSize: 12, color: t.text3 }}>{staffName(r.author_id)}</span>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                {!resolved && <>
                  <button onClick={() => setConvertTask(r)} style={{ background: 'none', border: 'none', color: accent, fontFamily: 'inherit', fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: 0 }}>{tr('pe.convertToTask')}</button>
                  {r.type === 'order' && <button onClick={() => setConvertPurchase(r)} style={{ background: 'none', border: 'none', color: t.green, fontFamily: 'inherit', fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: 0 }}>{tr('pe.convertToPurchase')}</button>}
                  {(r.status || 'new') === 'new' && <button onClick={() => setStatus(r, 'reviewed')} style={{ background: 'none', border: 'none', color: t.text3, fontFamily: 'inherit', fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: 0 }}>{tr(REPORT_STATUS.reviewed)}</button>}
                </>}
                <button onClick={() => removeReport(r.id)} style={{ background: 'none', border: 'none', color: t.text4, cursor: 'pointer', padding: 0, display: 'flex' }}>
                  <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" /></svg>
                </button>
              </div>
            </div>
          </div>
        )
      })}

      {convertTask && (
        <ConvertTaskSheet t={t} tr={tr} report={convertTask} roles={roles} staff={staff}
          onCancel={() => setConvertTask(null)}
          onSave={(assignee, priority, due) => doConvertTask(convertTask, assignee, priority, due)} />
      )}
      {convertPurchase && (
        <ConvertPurchaseSheet t={t} tr={tr} report={convertPurchase}
          onCancel={() => setConvertPurchase(null)}
          onSave={(cat, qty, unit) => doConvertPurchase(convertPurchase, cat, qty, unit)} />
      )}
      {toast && (
        <div style={{ position: 'fixed', bottom: 100, left: '50%', transform: 'translateX(-50%)', background: t.dark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.85)', backdropFilter: 'blur(16px)', color: '#fff', padding: '12px 22px', borderRadius: 22, fontSize: 14, fontWeight: 600, zIndex: 600, whiteSpace: 'nowrap' }}>{toast}</div>
      )}
    </div>
  )
}

function ConvertTaskSheet({ t, tr, report, roles, staff, onCancel, onSave }: { t: any; tr: any; report: any; roles: string[]; staff: any[]; onCancel: () => void; onSave: (assignee: string, priority: string, due: string) => void }) {
  const [assignee, setAssignee] = useState('')
  const [priority, setPriority] = useState('medium')
  const [due, setDue] = useState('')
  return (
    <Sheet onClose={onCancel} t={t}>
      <div style={{ padding: '4px 20px 24px' }}>
        <div style={{ fontSize: 17, fontWeight: 700, color: t.text, marginBottom: 14 }}>{tr('pe.convertToTask')} · {report.title}</div>
        <select value={assignee} onChange={e => setAssignee(e.target.value)} style={{ width: '100%', padding: '12px 14px', borderRadius: 12, border: `1px solid ${t.sep2}`, fontSize: 15, color: t.text, background: t.surface, fontFamily: 'inherit', outline: 'none', marginBottom: 12 }}>
          <option value="">—</option>
          {roles.map(r => <option key={'role:' + r} value={'role:' + r}>{tr('pe.allColon')} {tr(roleLabel(r))}</option>)}
          {staff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          {([['low', 'pe.prioLow'], ['medium', 'pe.prioMed'], ['high', 'pe.prioHigh']] as const).map(([p, key]) => (
            <button key={p} onClick={() => setPriority(p)} style={{ flex: 1, padding: '10px 0', borderRadius: 12, border: 'none', fontFamily: 'inherit', fontSize: 14, fontWeight: priority === p ? 700 : 500, cursor: 'pointer', background: priority === p ? t.blue : t.fill, color: priority === p ? '#fff' : t.text3 }}>{tr(key)}</button>
          ))}
        </div>
        <input type="date" value={due} onChange={e => setDue(e.target.value)} style={{ width: '100%', padding: '12px 14px', borderRadius: 12, border: `1px solid ${t.sep2}`, fontSize: 15, color: t.text, background: t.surface, fontFamily: 'inherit', outline: 'none', marginBottom: 12 }} />
        <button onClick={() => onSave(assignee, priority, due)} disabled={!assignee} style={{ width: '100%', padding: '14px', borderRadius: 14, background: t.blue, color: '#fff', border: 'none', fontFamily: 'inherit', fontSize: 15, fontWeight: 700, cursor: assignee ? 'pointer' : 'default', opacity: assignee ? 1 : 0.5 }}>{tr('me.create')}</button>
      </div>
    </Sheet>
  )
}

function ConvertPurchaseSheet({ t, tr, report, onCancel, onSave }: { t: any; tr: any; report: any; onCancel: () => void; onSave: (cat: string, qty: string, unit: string) => void }) {
  const [cat, setCat] = useState('general')
  const [qty, setQty] = useState('')
  const [unit, setUnit] = useState('')
  return (
    <Sheet onClose={onCancel} t={t}>
      <div style={{ padding: '4px 20px 24px' }}>
        <div style={{ fontSize: 17, fontWeight: 700, color: t.text, marginBottom: 14 }}>{tr('pe.convertToPurchase')} · {report.title}</div>
        <select value={cat} onChange={e => setCat(e.target.value)} style={{ width: '100%', padding: '12px 14px', borderRadius: 12, border: `1px solid ${t.sep2}`, fontSize: 15, color: t.text, background: t.surface, fontFamily: 'inherit', outline: 'none', marginBottom: 12 }}>
          {PURCHASE_CATS.map(c => <option key={c.id} value={c.id}>{tr(c.label)}</option>)}
        </select>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <input value={qty} onChange={e => setQty(e.target.value)} placeholder={tr('pe.pQtyEx')} style={{ flex: 1, padding: '12px 14px', borderRadius: 12, border: `1px solid ${t.sep2}`, fontSize: 15, color: t.text, background: t.surface, fontFamily: 'inherit', outline: 'none' }} />
          <input value={unit} onChange={e => setUnit(e.target.value)} placeholder={tr('pe.pUnitEx')} style={{ flex: 1, padding: '12px 14px', borderRadius: 12, border: `1px solid ${t.sep2}`, fontSize: 15, color: t.text, background: t.surface, fontFamily: 'inherit', outline: 'none' }} />
        </div>
        <button onClick={() => onSave(cat, qty, unit)} style={{ width: '100%', padding: '14px', borderRadius: 14, background: t.green, color: '#fff', border: 'none', fontFamily: 'inherit', fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>{tr('me.create')}</button>
      </div>
    </Sheet>
  )
}
