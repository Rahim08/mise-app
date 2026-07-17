'use client'
export const dynamic = 'force-dynamic'
import React, { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { db } from '@/lib/db'
import { notify as pushNotify } from '@/lib/notifyClient'
import { renderNotify, renderCategory } from '@/lib/notifyStrings'
import { useTheme } from '@/hooks/useTheme'
import { AuthGate } from '@/components/AuthGate'
import { AppSwitchBrand } from '@/components/AppSwitchBrand'
import { useI18n } from '@/lib/i18n'
import { fmtDate } from '@/lib/format'
import { tCurrent } from '@/lib/i18n'
import { ScheduleTab } from '@/components/people/ScheduleTab'
import { mondayOf, addDays, hhmm, timeRange, dayLabel, navBtn, roleLabel, getMe, Sheet, Placeholder, DOW_SHORT, DOW_FULL, MON } from '@/components/people/helpers'

// ── MY SHIFTS TAB (staff) ────────────────────────────────────────────────────────

function MyShiftsTab({ myId, accent, t }: { myId: string; accent: string; t: any }) {
  const { t: tr } = useI18n()
  const [shifts, setShifts] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const today = fmtDate(new Date())
    db.from('staff_schedules').select('*').eq('staff_id', myId).eq('published', true).gte('date', today).order('date')
      .then(({ data }: any) => { setShifts(data || []); setLoading(false) })
  }, [myId])

  if (loading) return <div style={{ textAlign: 'center', padding: 40, color: t.text3 }}>{tr('pe.loading')}</div>
  if (shifts.length === 0) return (
    <div style={{ textAlign: 'center', padding: '60px 20px', color: t.text3 }}>
      <div style={{ width: 72, height: 72, borderRadius: 20, background: `${accent}14`, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
        <svg width="34" height="34" fill="none" stroke={accent} strokeWidth="1.6" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="3" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>
      </div>
      <div style={{ fontWeight: 600, fontSize: 16, color: t.text2 }}>{tr('pe.noShiftsYet')}</div>
      <div style={{ fontSize: 13, marginTop: 4 }}>{tr('pe.managerWillPublish')}</div>
    </div>
  )

  const today = fmtDate(new Date()); const tomorrow = fmtDate(addDays(new Date(), 1))
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {shifts.map(s => {
        const when = s.date === today ? tr('pe.today') : s.date === tomorrow ? tr('pe.tomorrow') : null
        return (
          <div key={s.id} style={{ background: t.surface, borderRadius: 16, padding: '16px', boxShadow: t.sh, display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ width: 52, textAlign: 'center', flexShrink: 0 }}>
              <div style={{ fontSize: 22, fontWeight: 800, color: t.text, lineHeight: 1 }}>{new Date(s.date + 'T00:00:00').getDate()}</div>
              <div style={{ fontSize: 11, color: t.text3, marginTop: 2 }}>{MON()[new Date(s.date + 'T00:00:00').getMonth()]}</div>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 16, fontWeight: 700, color: t.text }}>{timeRange(s.shift_start, s.shift_end) || tr('pe.shiftWord')}</span>
                {when && <span style={{ fontSize: 10, fontWeight: 700, color: accent, background: `${accent}1a`, padding: '2px 8px', borderRadius: 8 }}>{when.toUpperCase()}</span>}
              </div>
              <div style={{ fontSize: 12, color: t.text3, marginTop: 3 }}>{DOW_FULL()[new Date(s.date + 'T00:00:00').getDay()]}{s.note ? ` · ${s.note}` : ''}</div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── TASKS TAB ────────────────────────────────────────────────────────────────────

const PRIO: Record<string, { label: string; color: (t: any) => string }> = {
  low: { label: 'pe.prioLow', color: t => t.text3 },
  medium: { label: 'pe.prioMed', color: t => t.blue },
  high: { label: 'pe.prioHigh', color: t => t.red },
}
const STATUS_ORDER = ['todo', 'in_progress', 'done']
const STATUS_LABEL: Record<string, string> = { todo: 'pe.stTodo', in_progress: 'pe.stInProgress', done: 'pe.stDone' }

const REPORT_TYPE: Record<string, { label: string; color: (t: any) => string }> = {
  breakdown: { label: 'pe.rtBreakdown', color: t => t.red },
  notice: { label: 'pe.rtNotice', color: t => t.orange },
  suggestion: { label: 'pe.rtSuggestion', color: t => t.blue },
  other: { label: 'pe.rtOther', color: t => t.text3 },
}
const REPORT_STATUS: Record<string, string> = { new: 'pe.rsNew', reviewed: 'pe.rsReviewed', resolved: 'pe.rsResolved' }

function TasksTab({ isManager, myId, accent, t, toast }: { isManager: boolean; myId: string; accent: string; t: any; toast: (m: string) => void }) {
  const { t: tr } = useI18n()
  const [view, setView] = useState<'tasks' | 'reports'>('tasks')
  const [tasks, setTasks] = useState<any[]>([])
  const [reports, setReports] = useState<any[]>([])
  const [staff, setStaff] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ title: '', description: '', assigned_to: '', priority: 'medium', due_date: '' })
  const [rform, setRform] = useState({ type: 'breakdown', title: '', description: '' })
  const [saving, setSaving] = useState(false)

  const load = async () => {
    setLoading(true)
    const [{ data: tk }, { data: rp }, { data: dir }] = await Promise.all([
      db.from('staff_tasks').select('*').order('created_at', { ascending: false }),
      db.from('staff_reports').select('*').order('created_at', { ascending: false }),
      db.from('staff_directory').select('*').eq('is_active', true).order('name'),
    ])
    setTasks(tk || []); setReports(rp || []); setStaff(dir || []); setLoading(false)
  }
  useEffect(() => { load() }, [])
  const staffName = (id: string) => staff.find(s => s.id === id)?.name || '—'
  const roles = Array.from(new Set(staff.map(s => s.role).filter(Boolean)))

  // Everyone sees tasks assigned to them OR created by them; managers see all.
  const visibleTasks = isManager ? tasks : tasks.filter(x => x.assigned_to === myId || x.created_by === myId)

  const createTask = async () => {
    if (!form.title.trim() || !form.assigned_to) { toast(tr('pe.taskNeedTitleAssignee')); return }
    setSaving(true)
    // Назначение на роль (assigned_to = "role:<role>") → отдельная задача каждому сотруднику цеха.
    let targets: string[]
    if (form.assigned_to.startsWith('role:')) {
      const role = form.assigned_to.slice(5)
      targets = staff.filter(s => s.role === role).map(s => s.id)
      if (targets.length === 0) { toast(tr('pe.noActiveStaffRole')); setSaving(false); return }
    } else {
      targets = [form.assigned_to]
    }
    const base = {
      title: form.title.trim(), description: form.description.trim() || null,
      created_by: myId === 'owner' ? null : myId,
      priority: form.priority, due_date: form.due_date || null, status: 'todo',
    }
    await Promise.all(targets.map(tid => db.from('staff_tasks').insert({ ...base, assigned_to: tid })))
    const notifyIds = targets.filter(tid => tid !== myId)
    if (notifyIds.length) pushNotify({ type: 'task', title: 'New task', body: form.title.trim(), titleKey: 'notify.newTaskTitle', audience: { staff_ids: notifyIds } })
    setSaving(false); setShowForm(false); setForm({ title: '', description: '', assigned_to: '', priority: 'medium', due_date: '' })
    toast(targets.length > 1 ? tr('pe.taskCreatedFor', { n: targets.length }) : tr('pe.taskCreated')); await load()
  }
  const setStatus = async (task: any, status: string) => {
    setTasks(ts => ts.map(x => x.id === task.id ? { ...x, status } : x))
    await db.from('staff_tasks').update({ status, completed_at: status === 'done' ? new Date().toISOString() : null }).eq('id', task.id)
  }
  const removeTask = async (id: string) => {
    setTasks(ts => ts.filter(x => x.id !== id))
    await db.from('staff_tasks').delete().eq('id', id)
  }
  const canDelete = (task: any) => isManager || task.created_by === myId

  const createReport = async () => {
    if (!rform.title.trim()) { toast(tr('pe.describeProblem')); return }
    setSaving(true)
    await db.from('staff_reports').insert({ type: rform.type, title: rform.title.trim(), description: rform.description.trim() || null, author_id: myId === 'owner' ? null : myId, status: 'new' })
    setSaving(false); setShowForm(false); setRform({ type: 'breakdown', title: '', description: '' })
    toast(tr('pe.reportSent')); await load()
  }
  const setReportStatus = async (r: any, status: string) => {
    setReports(rs => rs.map(x => x.id === r.id ? { ...x, status } : x))
    await db.from('staff_reports').update({ status, resolved_at: status === 'resolved' ? new Date().toISOString() : null }).eq('id', r.id)
  }

  if (loading) return <div style={{ textAlign: 'center', padding: 40, color: t.text3 }}>{tr('pe.loading')}</div>

  return (
    <div>
      <div style={{ display: 'flex', background: t.fill, borderRadius: 12, padding: 3, marginBottom: 16, gap: 2 }}>
        {([['tasks', tr('pe.tasks')], ['reports', tr('pe.reports')]] as const).map(([id, label]) => (
          <button key={id} onClick={() => setView(id)} style={{ flex: 1, padding: '8px 0', borderRadius: 10, border: 'none', fontFamily: 'inherit', fontSize: 13, fontWeight: view === id ? 700 : 500, cursor: 'pointer', background: view === id ? t.surface : 'transparent', color: view === id ? accent : t.text3, boxShadow: view === id ? t.sh2 : 'none' }}>{label}</button>
        ))}
      </div>

      <button onClick={() => setShowForm(true)} style={{ width: '100%', padding: '14px', borderRadius: 14, background: accent, color: '#fff', border: 'none', fontFamily: 'inherit', fontSize: 15, fontWeight: 700, cursor: 'pointer', marginBottom: 16, boxShadow: `0 4px 16px ${accent}44` }}>
        {view === 'tasks' ? tr('pe.newTask') : tr('pe.reportProblem')}
      </button>

      {view === 'tasks' ? (
        visibleTasks.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '50px 20px', color: t.text3 }}>
            <div style={{ fontWeight: 600, fontSize: 16, color: t.text2 }}>{tr('pe.noTasks')}</div>
            <div style={{ fontSize: 13, marginTop: 4 }}>{tr('pe.assignTaskHint')}</div>
          </div>
        ) : STATUS_ORDER.map(st => {
          const group = visibleTasks.filter(x => x.status === st)
          if (group.length === 0) return null
          return (
            <div key={st} style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: t.text3, textTransform: 'uppercase', letterSpacing: 0.5, padding: '4px 4px 8px' }}>{tr(STATUS_LABEL[st])} · {group.length}</div>
              <div style={{ background: t.surface, borderRadius: 16, overflow: 'hidden', boxShadow: t.sh }}>
                {group.map((task, i) => (
                  <div key={task.id} style={{ padding: '14px 16px', borderBottom: i < group.length - 1 ? `0.5px solid ${t.sep2}` : 'none', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                    <button onClick={() => setStatus(task, task.status === 'done' ? 'todo' : 'done')} style={{ marginTop: 1, width: 22, height: 22, borderRadius: '50%', border: `2px solid ${task.status === 'done' ? accent : t.sep}`, background: task.status === 'done' ? accent : 'transparent', cursor: 'pointer', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}>
                      {task.status === 'done' && <svg width="11" height="11" fill="none" stroke="#fff" strokeWidth="3" viewBox="0 0 24 24"><path d="M5 13l4 4L19 7" /></svg>}
                    </button>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 15, color: t.text, fontWeight: 500, textDecoration: task.status === 'done' ? 'line-through' : 'none', opacity: task.status === 'done' ? 0.55 : 1 }}>{task.title}</div>
                      {task.description && <div style={{ fontSize: 13, color: t.text3, marginTop: 2 }}>{task.description}</div>}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: PRIO[task.priority]?.color(t) }}>{tr(PRIO[task.priority]?.label)}</span>
                        <span style={{ fontSize: 11, color: t.text3 }}>· {staffName(task.assigned_to)}</span>
                        {task.due_date && <span style={{ fontSize: 11, color: t.orange }}>· {tr('pe.dueBy')} {dayLabel(task.due_date)}</span>}
                        {task.status !== 'done' && <button onClick={() => setStatus(task, task.status === 'todo' ? 'in_progress' : 'todo')} style={{ fontSize: 11, fontWeight: 600, color: accent, background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>{task.status === 'todo' ? tr('pe.takeInWork') : tr('pe.return')}</button>}
                      </div>
                    </div>
                    {canDelete(task) && (
                      <button onClick={() => removeTask(task.id)} style={{ background: 'none', border: 'none', color: t.text4, cursor: 'pointer', padding: 2, flexShrink: 0 }}>
                        <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" /></svg>
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )
        })
      ) : (
        reports.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '50px 20px', color: t.text3 }}>
            <div style={{ fontWeight: 600, fontSize: 16, color: t.text2 }}>{tr('pe.noReports')}</div>
            <div style={{ fontSize: 13, marginTop: 4 }}>{tr('pe.reportHint')}</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {reports.map(r => {
              const rt = REPORT_TYPE[r.type] || REPORT_TYPE.other
              return (
                <div key={r.id} style={{ background: t.surface, borderRadius: 16, padding: '14px 16px', boxShadow: t.sh }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: rt.color(t), background: `${rt.color(t)}1a`, padding: '3px 9px', borderRadius: 8 }}>{tr(rt.label)}</span>
                    <span style={{ fontSize: 11, fontWeight: 600, color: r.status === 'resolved' ? t.green : r.status === 'reviewed' ? t.blue : t.orange }}>{tr(REPORT_STATUS[r.status])}</span>
                  </div>
                  <div style={{ fontSize: 15, fontWeight: 600, color: t.text }}>{r.title}</div>
                  {r.description && <div style={{ fontSize: 13, color: t.text3, marginTop: 2 }}>{r.description}</div>}
                  <div style={{ fontSize: 11, color: t.text4, marginTop: 6 }}>{staffName(r.author_id)} · {new Date(r.created_at).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })}</div>
                  {isManager && r.status !== 'resolved' && (
                    <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                      {r.status === 'new' && <button onClick={() => setReportStatus(r, 'reviewed')} style={btnB2(t)}>{tr('pe.markReviewed')}</button>}
                      <button onClick={() => setReportStatus(r, 'resolved')} style={{ ...btnB2(t), color: '#fff', background: accent }}>{tr('pe.markResolved')}</button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )
      )}

      {showForm && view === 'tasks' && (
        <Sheet onClose={() => setShowForm(false)} t={t}>
          <div style={{ padding: '14px 20px 32px' }}>
            <div style={{ fontSize: 18, fontWeight: 700, textAlign: 'center', color: t.text, marginBottom: 18 }}>{tr('pe.newTaskTitle')}</div>
            <input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder={tr('pe.taskTitlePh')} autoFocus style={inp(t)} />
            <input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder={tr('pe.descPh')} style={inp(t)} />
            <label style={lbl(t)}>{tr('pe.assignee')}</label>
            <select value={form.assigned_to} onChange={e => setForm({ ...form, assigned_to: e.target.value })} style={inp(t)}>
              <option value="">{tr('pe.selectStaff')}</option>
              {isManager && roles.length > 0 && (
                <optgroup label={tr('pe.wholeRole')}>
                  {roles.map(r => <option key={'role:' + r} value={'role:' + r}>{tr('pe.allColon')} {tr(roleLabel(r))}</option>)}
                </optgroup>
              )}
              <optgroup label={tr('pe.staffGroup')}>
                {staff.map(s => <option key={s.id} value={s.id}>{s.name}{s.id === myId ? ` ${tr('pe.meSuffix')}` : ''}</option>)}
              </optgroup>
            </select>
            <div style={{ display: 'flex', gap: 10 }}>
              <div style={{ flex: 1 }}>
                <label style={lbl(t)}>{tr('pe.priority')}</label>
                <select value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value })} style={inp(t)}>
                  <option value="low">{tr('pe.prioLow')}</option><option value="medium">{tr('pe.prioMed')}</option><option value="high">{tr('pe.prioHigh')}</option>
                </select>
              </div>
              <div style={{ flex: 1 }}>
                <label style={lbl(t)}>{tr('pe.dueDate')}</label>
                <input type="date" value={form.due_date} onChange={e => setForm({ ...form, due_date: e.target.value })} style={inp(t)} />
              </div>
            </div>
            <button onClick={createTask} disabled={saving} style={{ width: '100%', padding: '15px', borderRadius: 14, background: accent, color: '#fff', border: 'none', fontFamily: 'inherit', fontSize: 15, fontWeight: 700, cursor: 'pointer', marginTop: 8, boxShadow: `0 4px 16px ${accent}44` }}>
              {saving ? '...' : tr('pe.createTask')}
            </button>
          </div>
        </Sheet>
      )}

      {showForm && view === 'reports' && (
        <Sheet onClose={() => setShowForm(false)} t={t}>
          <div style={{ padding: '14px 20px 32px' }}>
            <div style={{ fontSize: 18, fontWeight: 700, textAlign: 'center', color: t.text, marginBottom: 18 }}>{tr('pe.reportProblemTitle')}</div>
            <label style={lbl(t)}>{tr('pe.type')}</label>
            <select value={rform.type} onChange={e => setRform({ ...rform, type: e.target.value })} style={inp(t)}>
              {Object.entries(REPORT_TYPE).map(([k, v]) => <option key={k} value={k}>{tr(v.label)}</option>)}
            </select>
            <input value={rform.title} onChange={e => setRform({ ...rform, title: e.target.value })} placeholder={tr('pe.reportTitlePh')} autoFocus style={inp(t)} />
            <input value={rform.description} onChange={e => setRform({ ...rform, description: e.target.value })} placeholder={tr('pe.reportDescPh')} style={inp(t)} />
            <button onClick={createReport} disabled={saving} style={{ width: '100%', padding: '15px', borderRadius: 14, background: accent, color: '#fff', border: 'none', fontFamily: 'inherit', fontSize: 15, fontWeight: 700, cursor: 'pointer', marginTop: 8, boxShadow: `0 4px 16px ${accent}44` }}>
              {saving ? '...' : tr('pe.send')}
            </button>
          </div>
        </Sheet>
      )}
    </div>
  )
}

function btnB2(t: any): React.CSSProperties {
  return { padding: '8px 14px', borderRadius: 10, border: 'none', background: t.fill, color: t.text, fontFamily: 'inherit', fontSize: 13, fontWeight: 600, cursor: 'pointer' }
}

function inp(t: any): React.CSSProperties {
  return { width: '100%', padding: '12px 14px', borderRadius: 12, border: `1px solid ${t.sep2}`, fontSize: 16, color: t.text, background: t.surface, fontFamily: 'inherit', outline: 'none', marginBottom: 12 }
}
function lbl(t: any): React.CSSProperties {
  return { display: 'block', fontSize: 11, fontWeight: 600, color: t.text3, textTransform: 'uppercase', letterSpacing: .4, marginBottom: 6 }
}

// ── SWAPS TAB ────────────────────────────────────────────────────────────────────

const SWAP_STATUS: Record<string, { label: string; color: (t: any) => string }> = {
  pending_peer: { label: 'pe.swPendingPeer', color: t => t.orange },
  peer_accepted: { label: 'pe.swPeerAccepted', color: t => t.blue },
  approved: { label: 'pe.swApproved', color: t => t.green },
  peer_declined: { label: 'pe.swPeerDeclined', color: t => t.red },
  rejected: { label: 'pe.swRejected', color: t => t.red },
  cancelled: { label: 'pe.swCancelled', color: t => t.text3 },
}

function SwapsTab({ me, isManager, accent, t, toast }: { me: any; isManager: boolean; accent: string; t: any; toast: (m: string) => void }) {
  const { t: tr } = useI18n()
  const myId = me.id || ''
  const [requests, setRequests] = useState<any[]>([])
  const [staff, setStaff] = useState<any[]>([])
  const [schedules, setSchedules] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [seg, setSeg] = useState<'incoming' | 'outgoing'>('incoming')
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ schedule_id: '', target_id: '', note: '' })
  const [saving, setSaving] = useState(false)

  const load = async () => {
    setLoading(true)
    const today = fmtDate(new Date())
    const from = fmtDate(addDays(new Date(), -14)); const to = fmtDate(addDays(new Date(), 60))
    const [{ data: rq }, { data: st }, { data: sc }] = await Promise.all([
      db.from('shift_swap_requests').select('*').order('created_at', { ascending: false }),
      db.from('staff_directory').select('*').eq('is_active', true).order('name'),
      db.from('staff_schedules').select('*').gte('date', from).lte('date', to),
    ])
    setRequests(rq || []); setStaff(st || []); setSchedules(sc || []); setLoading(false)
  }
  useEffect(() => { load() }, [])

  const name = (id: string) => staff.find(s => s.id === id)?.name || '—'
  const sched = (id: string) => schedules.find(s => s.id === id)
  const myUpcoming = schedules.filter(s => s.staff_id === myId && s.published && s.date >= fmtDate(new Date())).sort((a, b) => a.date.localeCompare(b.date))

  const notify = (staffId: string, type: string, title: string, body: string, keys?: { titleKey?: string; bodyKey?: string; bodyParams?: Record<string, string | number> }) =>
    pushNotify({ type, title, body, titleKey: keys?.titleKey, bodyKey: keys?.bodyKey, bodyParams: keys?.bodyParams, audience: { staff_ids: [staffId] } })
  const now = () => new Date().toISOString()

  const create = async () => {
    if (!form.schedule_id || !form.target_id) { toast(tr('pe.selectShiftColleague')); return }
    setSaving(true)
    const sc = sched(form.schedule_id)
    await db.from('shift_swap_requests').insert({
      schedule_id: form.schedule_id, requester_id: myId, target_id: form.target_id,
      status: 'pending_peer', note: form.note || null,
    })
    await notify(form.target_id, 'swap_request', tr('pe.swapRequestTitle'), tr('pe.swapRequestBody', { name: me.name || tr('pe.colleague'), date: sc ? dayLabel(sc.date) : '' }),
      { titleKey: 'notify.swapRequestTitle', bodyKey: 'notify.swapRequestBody', bodyParams: { name: me.name || tr('pe.colleague'), date: sc ? dayLabel(sc.date) : '' } })
    setSaving(false); setShowForm(false); setForm({ schedule_id: '', target_id: '', note: '' })
    toast(tr('pe.reportSent')); await load()
  }

  const setStatus = async (r: any, patch: any) => {
    await db.from('shift_swap_requests').update(patch).eq('id', r.id)
    await load()
  }
  const peerAccept = async (r: any) => {
    await db.from('shift_swap_requests').update({ status: 'peer_accepted', peer_responded_at: now() }).eq('id', r.id)
    pushNotify({ type: 'swap_request', title: tr('pe.swapPendingTitle'), body: tr('pe.swapPendingBody'), titleKey: 'notify.swapPendingTitle', bodyKey: 'notify.swapPendingBody', audience: { managers: true } })
    await load()
  }
  const peerDecline = async (r: any) => {
    await db.from('shift_swap_requests').update({ status: 'peer_declined', peer_responded_at: now() }).eq('id', r.id)
    await notify(r.requester_id, 'swap_result', tr('pe.swapDeclinedTitle'), tr('pe.swapDeclinedByPeerBody'),
      { titleKey: 'notify.swapDeclinedTitle', bodyKey: 'notify.swapDeclinedByPeerBody' })
    await load()
  }
  const managerReject = async (r: any) => {
    await db.from('shift_swap_requests').update({ status: 'rejected', manager_id: me.is_owner ? null : myId, manager_responded_at: now() }).eq('id', r.id)
    await notify(r.requester_id, 'swap_result', tr('pe.swapDeclinedTitle'), tr('pe.swapDeclinedByManagerBody'),
      { titleKey: 'notify.swapDeclinedTitle', bodyKey: 'notify.swapDeclinedByManagerBody' })
    await load()
  }
  const approve = async (r: any) => {
    // Reassign the shift to the target, then mark approved.
    await db.from('staff_schedules').update({ staff_id: r.target_id }).eq('id', r.schedule_id)
    await db.from('shift_swap_requests').update({ status: 'approved', manager_id: me.is_owner ? null : myId, manager_responded_at: now() }).eq('id', r.id)
    await notify(r.requester_id, 'swap_result', tr('pe.swapApprovedTitle'), tr('pe.swapApprovedBody'),
      { titleKey: 'notify.swapApprovedTitle', bodyKey: 'notify.swapApprovedBody' })
    toast(tr('pe.swapApprovedToast')); await load()
  }

  if (loading) return <div style={{ textAlign: 'center', padding: 40, color: t.text3 }}>{tr('pe.loading')}</div>

  const incoming = requests.filter(r => r.target_id === myId)
  const outgoing = requests.filter(r => r.requester_id === myId)
  const managerQueue = requests.filter(r => r.status === 'peer_accepted')
  const list = isManager ? (seg === 'incoming' ? managerQueue : requests) : (seg === 'incoming' ? incoming : outgoing)

  const card = (r: any) => {
    const sc = sched(r.schedule_id)
    const stt = SWAP_STATUS[r.status]
    const iAmTarget = r.target_id === myId
    const iAmRequester = r.requester_id === myId
    return (
      <div key={r.id} style={{ background: t.surface, borderRadius: 16, padding: '14px 16px', boxShadow: t.sh, marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: t.text }}>{sc ? `${dayLabel(sc.date)} · ${timeRange(sc.shift_start, sc.shift_end) || tr('pe.shiftWord')}` : tr('pe.shiftWord')}</div>
          <span style={{ fontSize: 11, fontWeight: 700, color: stt?.color(t), background: `${stt?.color(t)}1a`, padding: '3px 9px', borderRadius: 8 }}>{tr(stt?.label)}</span>
        </div>
        <div style={{ fontSize: 13, color: t.text3, marginBottom: r.note ? 4 : 0 }}>
          {name(r.requester_id)} → {name(r.target_id)}
        </div>
        {r.note && <div style={{ fontSize: 13, color: t.text2, marginBottom: 4 }}>«{r.note}»</div>}

        {/* Actions */}
        {r.status === 'pending_peer' && iAmTarget && (
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button onClick={() => peerAccept(r)} style={btnA(accent)}>{tr('pe.accept')}</button>
            <button onClick={() => peerDecline(r)} style={btnB(t)}>{tr('pe.decline')}</button>
          </div>
        )}
        {r.status === 'pending_peer' && iAmRequester && (
          <button onClick={() => setStatus(r, { status: 'cancelled' })} style={{ ...btnB(t), marginTop: 10, width: '100%' }}>{tr('pe.cancelRequest')}</button>
        )}
        {r.status === 'peer_accepted' && isManager && (
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button onClick={() => approve(r)} style={btnA(accent)}>{tr('pe.approve')}</button>
            <button onClick={() => managerReject(r)} style={btnB(t)}>{tr('pe.decline')}</button>
          </div>
        )}
      </div>
    )
  }

  return (
    <div>
      {!isManager && (
        <button onClick={() => setShowForm(true)} disabled={myUpcoming.length === 0} style={{ width: '100%', padding: '14px', borderRadius: 14, background: myUpcoming.length ? accent : t.fill, color: myUpcoming.length ? '#fff' : t.text3, border: 'none', fontFamily: 'inherit', fontSize: 15, fontWeight: 700, cursor: myUpcoming.length ? 'pointer' : 'default', marginBottom: 16, boxShadow: myUpcoming.length ? `0 4px 16px ${accent}44` : 'none' }}>
          {myUpcoming.length ? tr('pe.proposeSwap') : tr('pe.noShiftsToSwap')}
        </button>
      )}

      <div style={{ display: 'flex', background: t.fill, borderRadius: 12, padding: 3, marginBottom: 16, gap: 2 }}>
        {(isManager ? [['incoming', tr('pe.forApproval')], ['outgoing', tr('pe.all')]] : [['incoming', tr('pe.incoming')], ['outgoing', tr('pe.outgoing')]]).map(([id, label]) => (
          <button key={id} onClick={() => setSeg(id as any)} style={{ flex: 1, padding: '8px 0', borderRadius: 10, border: 'none', fontFamily: 'inherit', fontSize: 13, fontWeight: seg === id ? 700 : 500, cursor: 'pointer', background: seg === id ? t.surface : 'transparent', color: seg === id ? accent : t.text3, boxShadow: seg === id ? t.sh2 : 'none' }}>{label}</button>
        ))}
      </div>

      {list.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '50px 20px', color: t.text3 }}>
          <div style={{ fontWeight: 600, fontSize: 16, color: t.text2 }}>{tr('pe.empty')}</div>
          <div style={{ fontSize: 13, marginTop: 4 }}>{isManager ? tr('pe.noApprovalReqs') : tr('pe.noSwapReqs')}</div>
        </div>
      ) : list.map(card)}

      {showForm && (
        <Sheet onClose={() => setShowForm(false)} t={t}>
          <div style={{ padding: '14px 20px 32px' }}>
            <div style={{ fontSize: 18, fontWeight: 700, textAlign: 'center', color: t.text, marginBottom: 18 }}>{tr('pe.proposeSwapTitle')}</div>
            <label style={lbl(t)}>{tr('pe.myShift')}</label>
            <select value={form.schedule_id} onChange={e => setForm({ ...form, schedule_id: e.target.value })} style={inp(t)}>
              <option value="">{tr('pe.selectShift')}</option>
              {myUpcoming.map(s => <option key={s.id} value={s.id}>{dayLabel(s.date)} · {timeRange(s.shift_start, s.shift_end) || tr('pe.shiftWord')}</option>)}
            </select>
            <label style={lbl(t)}>{tr('pe.toWhom')}</label>
            <select value={form.target_id} onChange={e => setForm({ ...form, target_id: e.target.value })} style={inp(t)}>
              <option value="">{tr('pe.selectColleague')}</option>
              {staff.filter(s => s.id !== myId).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <input value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} placeholder={tr('pe.msgPh')} style={inp(t)} />
            <button onClick={create} disabled={saving} style={{ width: '100%', padding: '15px', borderRadius: 14, background: accent, color: '#fff', border: 'none', fontFamily: 'inherit', fontSize: 15, fontWeight: 700, cursor: 'pointer', marginTop: 8, boxShadow: `0 4px 16px ${accent}44` }}>
              {saving ? '...' : tr('pe.sendRequest')}
            </button>
          </div>
        </Sheet>
      )}
    </div>
  )
}

function btnA(accent: string): React.CSSProperties {
  return { flex: 1, padding: '11px', borderRadius: 12, border: 'none', background: accent, color: '#fff', fontFamily: 'inherit', fontSize: 14, fontWeight: 700, cursor: 'pointer' }
}
function btnB(t: any): React.CSSProperties {
  return { flex: 1, padding: '11px', borderRadius: 12, border: 'none', background: t.fill, color: t.text, fontFamily: 'inherit', fontSize: 14, fontWeight: 600, cursor: 'pointer' }
}

// ── ATTENDANCE TAB ───────────────────────────────────────────────────────────────

function hoursOf(r: any) {
  if (!r.check_in_at || !r.check_out_at) return 0
  return Math.max(0, (new Date(r.check_out_at).getTime() - new Date(r.check_in_at).getTime()) / 3600000)
}
function fmtHours(h: number, tr: (k: string) => string) {
  const H = Math.floor(h); const M = Math.round((h - H) * 60)
  return M ? `${H} ${tr('pe.hUnit')} ${M} ${tr('pe.mUnit')}` : `${H} ${tr('pe.hUnit')}`
}

function distMeters(la1: number, lo1: number, la2: number, lo2: number) {
  const R = 6371000, toR = Math.PI / 180
  const dLa = (la2 - la1) * toR, dLo = (lo2 - lo1) * toR
  const a = Math.sin(dLa / 2) ** 2 + Math.cos(la1 * toR) * Math.cos(la2 * toR) * Math.sin(dLo / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}
function clock(iso: string | null) { return iso ? new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '' }

function AttendanceTab({ me, isManager, accent, t, toast, onOpenDiscipline }: { me: any; isManager: boolean; accent: string; t: any; toast: (m: string) => void; onOpenDiscipline?: () => void }) {
  const { t: tr } = useI18n()
  const myId = me.id || ''
  const today = fmtDate(new Date())
  const [settings, setSettings] = useState<any>(null)
  const [history, setHistory] = useState<any[]>([])
  const [todayAll, setTodayAll] = useState<any[]>([])
  const [staff, setStaff] = useState<any[]>([])
  const [mySched, setMySched] = useState<any>(null)
  const [dist, setDist] = useState<number | null>(null)
  const [geoErr, setGeoErr] = useState('')
  const [loading, setLoading] = useState(true)
  const [pos, setPos] = useState<{ lat: number; lng: number } | null>(null)

  const load = async () => {
    const [{ data: rs }, { data: hist }, { data: sc }] = await Promise.all([
      db.from('restaurant_settings').select('*').limit(1),
      isManager
        ? db.from('attendance_records').select('*').gte('date', fmtDate(new Date(new Date().getFullYear(), new Date().getMonth(), 1))).order('date', { ascending: false }).limit(500)
        : db.from('attendance_records').select('*').eq('staff_id', myId).order('date', { ascending: false }).limit(62),
      db.from('staff_schedules').select('*').eq('staff_id', myId).eq('date', today).limit(1),
    ])
    const st = Array.isArray(rs) ? rs[0] : rs
    setSettings(st || null); setHistory(hist || []); setMySched((Array.isArray(sc) ? sc[0] : sc) || null)
    if (isManager) {
      const { data: dir } = await db.from('staff_directory').select('*').eq('is_active', true).order('name')
      setStaff(dir || []); setTodayAll((hist || []).filter((r: any) => r.date === today))
    }
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const todayRec = history.find(r => r.staff_id === myId && r.date === today)

  // Geolocation — следим за дистанцией пока экран открыт (foreground). Сам приход — по кнопке «Я пришёл».
  useEffect(() => {
    if (isManager || loading) return
    if (!settings?.attendance_enabled || settings?.latitude == null || settings?.longitude == null) return
    if (!navigator.geolocation) { setGeoErr(tr('pe.geoUnavailable')); return }
    const watchId = navigator.geolocation.watchPosition(
      p => {
        const d = distMeters(p.coords.latitude, p.coords.longitude, Number(settings.latitude), Number(settings.longitude))
        setPos({ lat: p.coords.latitude, lng: p.coords.longitude }); setDist(d); setGeoErr('')
      },
      () => setGeoErr(tr('pe.geoNoAccess')),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 5000 }
    )
    return () => navigator.geolocation.clearWatch(watchId)
  }, [loading, settings, isManager])

  // Явный приход: доступен только в радиусе заведения, фиксирует точное время и опоздание.
  const checkIn = async () => {
    if (!pos || dist == null || todayRec) return
    if (dist > (settings?.geo_radius_m || 150)) { toast(tr('pe.outsideZone')); return }
    let late: number | null = null, status = 'present'
    if (mySched?.shift_start) {
      const [h, m] = mySched.shift_start.split(':').map(Number)
      const start = new Date(); start.setHours(h, m, 0, 0)
      late = Math.max(0, Math.round((Date.now() - start.getTime()) / 60000)); status = late > 5 ? 'late' : 'present'
    }
    await db.from('attendance_records').upsert(
      { staff_id: myId, date: today, check_in_at: new Date().toISOString(), check_in_lat: pos.lat, check_in_lng: pos.lng, check_in_distance_m: Math.round(dist), late_minutes: late, status, source: 'geo' },
      { onConflict: 'restaurant_id,staff_id,date' }
    )
    // Уведомляем владельца/менеджеров о приходе сотрудника на смену.
    const lateTxt = status === 'late' ? ` (+${late} мин)` : ''
    const attName = me.name || 'Сотрудник'
    pushNotify({
      type: 'attendance', title: 'Staff on shift', body: `${attName} checked in${lateTxt}`,
      titleKey: 'notify.attendanceTitle',
      bodyKey: status === 'late' ? 'notify.attendanceBodyLate' : 'notify.attendanceBody',
      bodyParams: status === 'late' ? { name: attName, min: late ?? 0 } : { name: attName },
      audience: { managers: true },
    })
    toast(status === 'late' ? tr('pe.checkedLate', { n: late! }) : tr('pe.checkedIn')); await load()
  }

  const checkOut = async () => {
    if (!pos) return
    await db.from('attendance_records').update({ check_out_at: new Date().toISOString(), check_out_lat: pos.lat, check_out_lng: pos.lng }).eq('staff_id', myId).eq('date', today)
    toast(tr('pe.checkedOut')); await load()
  }

  if (loading) return <div style={{ textAlign: 'center', padding: 40, color: t.text3 }}>{tr('pe.loading')}</div>

  // ── Manager view ──
  if (isManager) {
    const name = (id: string) => staff.find(s => s.id === id)?.name || '—'
    return (
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: t.text3, textTransform: 'uppercase', letterSpacing: 0.5, padding: '4px 4px 8px' }}>{tr('pe.today')}</div>
        <div style={{ background: t.surface, borderRadius: 16, overflow: 'hidden', boxShadow: t.sh, marginBottom: 16 }}>
          {staff.length === 0 ? <div style={{ padding: 24, textAlign: 'center', color: t.text3 }}>{tr('pe.noStaff')}</div> : staff.map((s, i) => {
            const rec = todayAll.find(r => r.staff_id === s.id)
            return (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderBottom: i < staff.length - 1 ? `0.5px solid ${t.sep2}` : 'none' }}>
                <div style={{ fontSize: 15, color: t.text }}>{s.name}</div>
                {rec ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: t.text }}>{clock(rec.check_in_at)}{rec.check_out_at ? `–${clock(rec.check_out_at)}` : ''}</span>
                    {rec.status === 'late' && <span style={{ fontSize: 10, fontWeight: 700, color: t.orange, background: `${t.orange}1a`, padding: '2px 7px', borderRadius: 6 }}>+{rec.late_minutes}м</span>}
                  </div>
                ) : <span style={{ fontSize: 13, color: t.text4 }}>{tr('pe.notArrived')}</span>}
              </div>
            )
          })}
        </div>
        {!settings?.attendance_enabled && <div style={{ background: `${t.orange}14`, borderRadius: 12, padding: '12px 14px', fontSize: 13, color: t.orange }}>{tr('pe.geoOffManager')}</div>}

        {/* Часы и опоздания по каждому сотруднику за текущий месяц */}
        {history.length > 0 && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 4px 8px' }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: t.text3, textTransform: 'uppercase', letterSpacing: 0.5 }}>{tr('pe.monthStats')}</div>
              {onOpenDiscipline && <button onClick={onOpenDiscipline} style={{ border: 'none', background: 'transparent', color: accent, fontFamily: 'inherit', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>{tr('pe.disMore')} ›</button>}
            </div>
            <div style={{ background: t.surface, borderRadius: 16, overflow: 'hidden', boxShadow: t.sh, marginBottom: 16 }}>
              {staff.map((s, i) => {
                const recs = history.filter(r => r.staff_id === s.id)
                if (recs.length === 0) return null
                const hours = recs.reduce((sum, r) => sum + hoursOf(r), 0)
                const lates = recs.filter(r => r.status === 'late')
                return (
                  <div key={s.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: i < staff.length - 1 ? `0.5px solid ${t.sep2}` : 'none' }}>
                    <div>
                      <div style={{ fontSize: 14, color: t.text, fontWeight: 500 }}>{s.name}</div>
                      <div style={{ fontSize: 12, color: t.text3, marginTop: 2 }}>{recs.length} {tr('pe.shiftsWord')} · {fmtHours(hours, tr)}</div>
                    </div>
                    {lates.length > 0
                      ? <span style={{ fontSize: 11, fontWeight: 700, color: t.orange, background: `${t.orange}1a`, padding: '3px 9px', borderRadius: 8 }}>{lates.length} {tr('pe.lateShort')} · {lates.reduce((s2, r) => s2 + (r.late_minutes || 0), 0)} {tr('pe.minShort')}</span>
                      : <span style={{ fontSize: 11, fontWeight: 700, color: t.green, background: `${t.green}1a`, padding: '3px 9px', borderRadius: 8 }}>{tr('pe.noLates')}</span>}
                  </div>
                )
              })}
            </div>
          </>
        )}
        <HistoryList records={history} withName name={(id: string) => name(id)} t={t} accent={accent} />
      </div>
    )
  }

  // ── Staff view ──
  const radius = settings?.geo_radius_m || 150
  const inRange = dist != null && dist <= radius
  const configured = settings?.attendance_enabled && settings?.latitude != null
  return (
    <div>
      {!configured ? (
        <div style={{ textAlign: 'center', padding: '50px 20px', color: t.text3 }}>
          <div style={{ fontWeight: 600, fontSize: 16, color: t.text2 }}>{tr('pe.geoNotConfigured')}</div>
          <div style={{ fontSize: 13, marginTop: 4 }}>{tr('pe.geoManagerSetsAddress')}</div>
        </div>
      ) : (
        <div style={{ background: t.surface, borderRadius: 20, padding: '28px 20px', boxShadow: t.sh, textAlign: 'center', marginBottom: 16 }}>
          <div style={{ width: 96, height: 96, borderRadius: '50%', margin: '0 auto 16px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: todayRec ? `${t.green}18` : inRange ? `${accent}18` : t.fill, border: `2px solid ${todayRec ? t.green : inRange ? accent : t.sep}` }}>
            <svg width="40" height="40" fill="none" stroke={todayRec ? t.green : inRange ? accent : t.text3} strokeWidth="1.8" viewBox="0 0 24 24"><path d="M21 10c0 6-9 12-9 12s-9-6-9-12a9 9 0 0118 0z" /><circle cx="12" cy="10" r="3" /></svg>
          </div>
          {todayRec ? (
            <>
              <div style={{ fontSize: 18, fontWeight: 700, color: t.text }}>{tr('pe.onShift')}</div>
              <div style={{ fontSize: 14, color: t.text3, marginTop: 4 }}>{tr('pe.arrivedAt')} {clock(todayRec.check_in_at)}{todayRec.status === 'late' ? ` · ${tr('pe.lateBy')} ${todayRec.late_minutes} ${tr('pe.minShort')}` : ''}</div>
              {!todayRec.check_out_at
                ? <button onClick={checkOut} style={{ marginTop: 16, padding: '12px 28px', borderRadius: 14, border: 'none', background: t.fill, color: t.text, fontFamily: 'inherit', fontSize: 15, fontWeight: 600, cursor: 'pointer' }}>{tr('pe.checkOut')}</button>
                : <div style={{ marginTop: 12, fontSize: 14, color: t.green, fontWeight: 600 }}>{tr('pe.shiftClosedAt')} {clock(todayRec.check_out_at)}</div>}
            </>
          ) : geoErr ? (
            <div style={{ fontSize: 15, color: t.red, fontWeight: 600 }}>{geoErr}</div>
          ) : dist == null ? (
            <div style={{ fontSize: 15, color: t.text3 }}>{tr('pe.locating')}</div>
          ) : inRange ? (
            <>
              <div style={{ fontSize: 15, color: t.text3, marginBottom: 2 }}>{tr('pe.youreHere')}</div>
              <button onClick={checkIn} style={{ marginTop: 12, padding: '13px 36px', borderRadius: 14, border: 'none', background: accent, color: '#fff', fontFamily: 'inherit', fontSize: 16, fontWeight: 700, cursor: 'pointer', boxShadow: `0 4px 16px ${accent}55` }}>{tr('pe.imHere')}</button>
            </>
          ) : (
            <>
              <div style={{ fontSize: 18, fontWeight: 700, color: t.text }}>{tr('pe.comeCloser')}</div>
              <div style={{ fontSize: 14, color: t.text3, marginTop: 4 }}>{tr('pe.distanceTo', { d: Math.round(dist), r: radius })}</div>
            </>
          )}
        </div>
      )}

      {/* Личная статистика за текущий месяц: смены, отработанные часы, опоздания */}
      {(() => {
        const ym = today.slice(0, 7)
        const recs = history.filter(r => r.date?.startsWith(ym))
        if (recs.length === 0) return null
        const hours = recs.reduce((sum, r) => sum + hoursOf(r), 0)
        const lates = recs.filter(r => r.status === 'late')
        return (
          <>
            <div style={{ fontSize: 12, fontWeight: 600, color: t.text3, textTransform: 'uppercase', letterSpacing: 0.5, padding: '8px 4px 8px' }}>{tr('pe.myMonth')}</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 8 }}>
              {[
                { l: tr('pe.shifts'), v: String(recs.length), c: accent },
                { l: tr('pe.hours'), v: fmtHours(hours, tr), c: t.green },
                { l: tr('pe.lates'), v: lates.length ? `${lates.length} · ${lates.reduce((s2, r) => s2 + (r.late_minutes || 0), 0)}м` : '0', c: lates.length ? t.orange : t.green },
              ].map(it => (
                <div key={it.l} style={{ background: t.surface, borderRadius: 14, padding: '12px 10px', boxShadow: t.sh, textAlign: 'center' }}>
                  <div style={{ fontSize: 15, fontWeight: 800, color: it.c }}>{it.v}</div>
                  <div style={{ fontSize: 10, color: t.text3, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4, marginTop: 3 }}>{it.l}</div>
                </div>
              ))}
            </div>
          </>
        )
      })()}

      <HistoryList records={history} t={t} accent={accent} />
    </div>
  )
}

// ── SALARY TAB ───────────────────────────────────────────────────────────────────
// Сотрудник видит свой расчёт; менеджер — фонд ЗП и разбивку по каждому.
// Источники: employees.salary/deduct_per_absence, shift_absences (даты пропусков),
// monthly_card_amounts (на карту), attendance_records (отработанные часы).
// Связь attendance(staff)↔employees — по имени (как в остальном коде; настоящий FK — в плане автоматизации).
const eur = (n: number) => `€${Math.round(n).toLocaleString('de-DE')}`
const absDate = (d: string) => new Date(d).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })

function SalaryTab({ me, isManager, accent, t }: { me: any; isManager: boolean; accent: string; t: any }) {
  const { t: tr } = useI18n()
  const today = fmtDate(new Date())
  const ym = today.slice(0, 7)
  const monthLabel = new Date().toLocaleDateString(tr('dash.locale'), { month: 'long' })
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState<any[]>([])
  const [open, setOpen] = useState<string | null>(null)

  const load = async () => {
    // Канон расчёта = iOS (PeopleView.loadSalary, решение 2026-07-17):
    // авансы вычитаются, карта строго помесячная (БЕЗ fallback на employees.card_amount),
    // авто-прогулы (source='auto' — черновики крона) деньги не удерживают.
    const monthStart = ym + '-01'
    const monthEnd = fmtDate(new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0))
    const [{ data: emps }, { data: abs }, { data: cards }, { data: att }, { data: dir }, { data: advs }] = await Promise.all([
      db.from('employees').select('id, name, salary, deduct_per_absence').eq('is_active', true).order('name'),
      db.from('shift_absences').select('employee_id, date, source').gte('date', monthStart),
      db.from('monthly_card_amounts').select('employee_id, card_amount').eq('month', ym),
      db.from('attendance_records').select('staff_id, check_in_at, check_out_at, date').gte('date', monthStart),
      db.from('staff_directory').select('id, name').eq('is_active', true),
      db.from('salary_advances').select('*').gte('date', monthStart).lte('date', monthEnd),
    ])
    const staffName: Record<string, string> = {}; (dir || []).forEach((s: any) => { staffName[s.id] = s.name })
    const hoursByName: Record<string, number> = {}
    ;(att || []).forEach((r: any) => { const n = staffName[r.staff_id]; if (n) hoursByName[n] = (hoursByName[n] || 0) + hoursOf(r) })
    const cardByEmp: Record<string, number> = {}; (cards || []).forEach((c: any) => { cardByEmp[c.employee_id] = Number(c.card_amount || 0) })
    const absByEmp: Record<string, string[]> = {}
    ;(abs || []).forEach((a: any) => { if (a.source !== 'auto') (absByEmp[a.employee_id] = absByEmp[a.employee_id] || []).push(a.date) })
    const advByEmp: Record<string, number> = {}
    ;(advs || []).forEach((a: any) => { advByEmp[a.employee_id] = (advByEmp[a.employee_id] || 0) + Number(a.amount || 0) })

    let list = (emps || []).map((e: any) => {
      const salary = Number(e.salary || 0)
      const dates = (absByEmp[e.id] || []).sort()
      const deduct = dates.length * Number(e.deduct_per_absence || 0)
      const card = cardByEmp[e.id] ?? 0
      const advance = advByEmp[e.id] || 0
      const total = Math.max(0, salary - deduct)
      return { id: e.id, name: e.name, salary, dates, absences: dates.length, deduct, card, advance, total, cash: Math.max(0, total - advance - card), hours: hoursByName[e.name] || 0 }
    })
    if (!isManager) list = list.filter((r: any) => r.name === me.name)
    setRows(list); setLoading(false)
  }
  useEffect(() => { load() }, [])

  if (loading) return <div style={{ textAlign: 'center', padding: 40, color: t.text3 }}>{tr('pe.loading')}</div>
  if (rows.length === 0) return (
    <div style={{ textAlign: 'center', padding: '60px 20px', color: t.text3 }}>
      <div style={{ width: 72, height: 72, borderRadius: 20, background: `${accent}14`, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
        <svg width="34" height="34" fill="none" stroke={accent} strokeWidth="1.6" viewBox="0 0 24 24"><rect x="2" y="6" width="20" height="13" rx="2" /><path d="M2 10h20M6 15h4" /></svg>
      </div>
      <div style={{ fontWeight: 600, fontSize: 16, color: t.text2 }}>{tr('pe.noSalaryData')}</div>
      <div style={{ fontSize: 13, marginTop: 4 }}>{tr('pe.salarySetInDash')}</div>
    </div>
  )

  // Детальная разбивка одного сотрудника (используется и у сотрудника, и в раскрытой карточке менеджера).
  const Breakdown = ({ r }: { r: any }) => (
    <div style={{ background: t.surface, borderRadius: 16, overflow: 'hidden', boxShadow: t.sh, marginBottom: 8 }}>
      {[
        { _l: tr('pe.salaryBase'), v: eur(r.salary), c: t.text, hide: false },
        { _l: tr('pe.worked'), v: fmtHours(r.hours, tr), c: t.text2, hide: r.hours <= 0 },
        { _l: tr('pe.absencesN', { n: r.absences }), v: r.dates.map(absDate).join(', '), c: t.text2, small: true, hide: r.absences === 0 },
        { _l: tr('pe.absenceDeduct'), v: `−${eur(r.deduct)}`, c: t.red, hide: r.deduct === 0 },
        { _l: tr('pe.toCard'), v: eur(r.card), c: t.blue, hide: r.card === 0 },
        { _l: tr('pe.advances'), v: `−${eur(r.advance)}`, c: t.orange, hide: !r.advance },
        { _l: tr('pe.inCash'), v: eur(r.cash), c: t.green, hide: false },
      ].filter((x: any) => !x.hide).map((x: any, i, arr) => (
        <div key={x._l} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 16px', borderBottom: i < arr.length - 1 ? `0.5px solid ${t.sep2}` : 'none' }}>
          <span style={{ fontSize: 14, color: t.text2, flexShrink: 0 }}>{x._l}</span>
          <span style={{ fontSize: x.small ? 12 : 15, fontWeight: x.small ? 500 : 700, color: x.c, textAlign: 'right' }}>{x.v}</span>
        </div>
      ))}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 16px', background: `${accent}0d` }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: t.text }}>{tr('pe.totalPayout')}</span>
        <span style={{ fontSize: 18, fontWeight: 800, color: accent }}>{eur(r.total)}</span>
      </div>
    </div>
  )

  // ── Сотрудник: свой расчёт ──
  if (!isManager) {
    const r = rows[0]
    return (
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: t.text3, textTransform: 'uppercase', letterSpacing: 0.5, padding: '4px 4px 8px' }}>{tr('pe.salary')} · {monthLabel}</div>
        <div style={{ background: `linear-gradient(135deg, ${accent}, ${accent}cc)`, borderRadius: 20, padding: '22px 20px', marginBottom: 12, color: '#fff', boxShadow: `0 8px 28px ${accent}3a` }}>
          <div style={{ fontSize: 13, fontWeight: 600, opacity: 0.85 }}>{tr('pe.toPayout')}</div>
          <div style={{ fontSize: 38, fontWeight: 800, letterSpacing: -1, marginTop: 2 }}>{eur(r.total)}</div>
          <div style={{ display: 'flex', gap: 16, marginTop: 10, fontSize: 13, fontWeight: 600, opacity: 0.92 }}>
            {r.card > 0 && <span>{tr('pe.toCard')} {eur(r.card)}</span>}
            <span>{tr('pe.inCash')} {eur(r.cash)}</span>
          </div>
        </div>
        <Breakdown r={r} />
        <div style={{ fontSize: 12, color: t.text4, textAlign: 'center', padding: '4px 16px' }}>{tr('pe.salaryCalcNote', { month: monthLabel })}</div>
      </div>
    )
  }

  // ── Менеджер: фонд ЗП + разбивка по каждому ──
  const fund = rows.reduce((s, r) => s + r.total, 0)
  const cardTotal = rows.reduce((s, r) => s + r.card, 0)
  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 600, color: t.text3, textTransform: 'uppercase', letterSpacing: 0.5, padding: '4px 4px 8px' }}>{tr('pe.salaryFund')} · {monthLabel}</div>
      <div style={{ background: `linear-gradient(135deg, ${accent}, ${accent}cc)`, borderRadius: 20, padding: '20px', marginBottom: 14, color: '#fff', boxShadow: `0 8px 28px ${accent}3a` }}>
        <div style={{ fontSize: 13, fontWeight: 600, opacity: 0.85 }}>{tr('pe.toPayoutTotal')}</div>
        <div style={{ fontSize: 34, fontWeight: 800, letterSpacing: -1, marginTop: 2 }}>{eur(fund)}</div>
        <div style={{ display: 'flex', gap: 16, marginTop: 8, fontSize: 13, fontWeight: 600, opacity: 0.92 }}>
          <span>{tr('pe.staffCountShort', { n: rows.length })}</span>
          {cardTotal > 0 && <span>{tr('pe.toCard')} {eur(cardTotal)}</span>}
          <span>{tr('pe.inCash')} {eur(fund - cardTotal)}</span>
        </div>
      </div>
      {rows.map(r => (
        <div key={r.id} style={{ marginBottom: 8 }}>
          <button onClick={() => setOpen(open === r.id ? null : r.id)} style={{ width: '100%', textAlign: 'left', background: t.surface, borderRadius: 16, padding: '14px 16px', boxShadow: t.sh, border: 'none', cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: t.text }}>{r.name}</div>
              <div style={{ fontSize: 12, color: t.text3, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {tr('pe.salaryBase')} {eur(r.salary)}{r.absences > 0 ? ` · −${r.absences} ${tr('pe.absShort')}` : ''}{r.card > 0 ? ` · ${tr('pe.cardWord')} ${eur(r.card)}` : ''}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
              <span style={{ fontSize: 16, fontWeight: 800, color: accent }}>{eur(r.total)}</span>
              <svg width="14" height="14" fill="none" stroke={t.text3} strokeWidth="2.2" viewBox="0 0 24 24" style={{ transform: open === r.id ? 'rotate(90deg)' : 'none', transition: 'transform .2s' }}><path d="M9 6l6 6-6 6" /></svg>
            </div>
          </button>
          {open === r.id && <div style={{ marginTop: 8, animation: 'fadeUp .18s ease' }}><Breakdown r={r} /></div>}
        </div>
      ))}
    </div>
  )
}

function HistoryList({ records, withName, name, t, accent }: { records: any[]; withName?: boolean; name?: (id: string) => string; t: any; accent: string }) {
  const { t: tr } = useI18n()
  if (records.length === 0) return null
  return (
    <>
      <div style={{ fontSize: 12, fontWeight: 600, color: t.text3, textTransform: 'uppercase', letterSpacing: 0.5, padding: '8px 4px 8px' }}>{tr('pe.history')}</div>
      <div style={{ background: t.surface, borderRadius: 16, overflow: 'hidden', boxShadow: t.sh }}>
        {records.map((r, i) => (
          <div key={r.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: i < records.length - 1 ? `0.5px solid ${t.sep2}` : 'none' }}>
            <div>
              <div style={{ fontSize: 14, color: t.text }}>{dayLabel(r.date)}{withName && name ? ` · ${name(r.staff_id)}` : ''}</div>
              <div style={{ fontSize: 12, color: t.text3, marginTop: 2 }}>{clock(r.check_in_at)}{r.check_out_at ? `–${clock(r.check_out_at)}` : ''}</div>
            </div>
            {r.status === 'late'
              ? <span style={{ fontSize: 11, fontWeight: 700, color: t.orange, background: `${t.orange}1a`, padding: '3px 9px', borderRadius: 8 }}>{tr('pe.lateBadge', { n: r.late_minutes })}</span>
              : <span style={{ fontSize: 11, fontWeight: 700, color: t.green, background: `${t.green}1a`, padding: '3px 9px', borderRadius: 8 }}>{tr('pe.onTime')}</span>}
          </div>
        ))}
      </div>
    </>
  )
}

// ── NOTIFICATIONS TAB ────────────────────────────────────────────────────────────

function NotificationsTab({ myId, accent, t }: { myId: string; accent: string; t: any }) {
  const { t: tr, locale } = useI18n()
  const [items, setItems] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  // Запись хранит title/body как EN-фолбэк + *_key/*_params — перерендериваем на языке
  // ЗРИТЕЛЯ (а не отправителя, каким текст был бы без ключей). См. AUDIT-2026-07-12.md #3.
  const renderTitle = (n: any) => {
    if (!n.title_key) return n.title
    const params = n.title_key === 'notify.purchaseTitle' && n.title_params?.category
      ? { ...n.title_params, category: renderCategory(locale, String(n.title_params.category)) }
      : n.title_params
    return renderNotify(locale, n.title_key, params || undefined)
  }
  const renderBody = (n: any) => n.body_key ? renderNotify(locale, n.body_key, n.body_params || undefined) : n.body

  useEffect(() => {
    db.from('notifications').select('*').eq('staff_id', myId).order('created_at', { ascending: false }).limit(50)
      .then(async ({ data }: any) => {
        setItems(data || []); setLoading(false)
        const unread = (data || []).filter((n: any) => !n.read_at).map((n: any) => n.id)
        if (unread.length) await db.from('notifications').update({ read_at: new Date().toISOString() }).in('id', unread)
      })
  }, [myId])

  if (loading) return <div style={{ textAlign: 'center', padding: 40, color: t.text3 }}>{tr('pe.loading')}</div>
  if (items.length === 0) return (
    <div style={{ textAlign: 'center', padding: '60px 20px', color: t.text3 }}>
      <div style={{ width: 72, height: 72, borderRadius: 20, background: `${accent}14`, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
        <svg width="34" height="34" fill="none" stroke={accent} strokeWidth="1.6" viewBox="0 0 24 24"><path d="M18 8a6 6 0 00-12 0c0 7-3 9-3 9h18s-3-2-3-9" /></svg>
      </div>
      <div style={{ fontWeight: 600, fontSize: 16, color: t.text2 }}>{tr('pe.noNotifs')}</div>
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {items.map(n => (
        <div key={n.id} style={{ background: t.surface, borderRadius: 14, padding: '14px 16px', boxShadow: t.sh, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: n.read_at ? 'transparent' : accent, marginTop: 6, flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: t.text }}>{renderTitle(n)}</div>
            {n.body && <div style={{ fontSize: 13, color: t.text3, marginTop: 2 }}>{renderBody(n)}</div>}
            <div style={{ fontSize: 11, color: t.text4, marginTop: 4 }}>{new Date(n.created_at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</div>
          </div>
        </div>
      ))}
    </div>
  )
}

// ── STOP-LIST TAB ────────────────────────────────────────────────────────────────

function StopListTab({ canEdit, currency, accent, t, toast }: { canEdit: boolean; currency: string; accent: string; t: any; toast: (m: string) => void }) {
  const { t: tr } = useI18n()
  const [cats, setCats] = useState<any[]>([])
  const [items, setItems] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  const load = async () => {
    setLoading(true)
    const [{ data: c }, { data: i }] = await Promise.all([
      db.from('menu_categories').select('*').eq('is_visible', true).order('position'),
      db.from('menu_items').select('*').eq('is_visible', true).order('position'),
    ])
    setCats(c || []); setItems(i || []); setLoading(false)
  }
  useEffect(() => { load() }, [])

  // Стоп ставят кухня и менеджер; остальные видят список (в гостевом меню — автоматически).
  const toggle = async (item: any) => {
    if (!canEdit) return
    const next = !item.is_available
    setItems(its => its.map(x => x.id === item.id ? { ...x, is_available: next } : x))
    await db.from('menu_items').update({ is_available: next }).eq('id', item.id)
    toast(next ? tr('pe.backToMenu') : tr('pe.toStopList'))
  }

  if (loading) return <div style={{ textAlign: 'center', padding: 40, color: t.text3 }}>{tr('pe.loading')}</div>

  const itemsFor = (catId: string) => items.filter(i => i.category_id === catId && (!search || i.name.toLowerCase().includes(search.toLowerCase())))
  const stopCount = items.filter(i => !i.is_available).length

  if (items.length === 0) return (
    <div style={{ textAlign: 'center', padding: '60px 20px', color: t.text3 }}>
      <div style={{ fontWeight: 600, fontSize: 16, color: t.text2 }}>{tr('pe.menuEmpty')}</div>
      <div style={{ fontSize: 13, marginTop: 4 }}>{tr('pe.itemsAddedInDash')}</div>
    </div>
  )

  return (
    <div>
      <div style={{ position: 'relative', marginBottom: 16 }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder={tr('pe.searchItem')}
          style={{ width: '100%', padding: '12px 14px 12px 42px', borderRadius: 14, border: `1px solid ${t.sep2}`, fontSize: 16, color: t.text, background: t.surface, fontFamily: 'inherit', outline: 'none', boxShadow: t.sh }} />
        <svg style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)' }} width="18" height="18" fill="none" stroke={t.text3} strokeWidth="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></svg>
      </div>
      {stopCount > 0 && (
        <div style={{ background: `${t.red}14`, borderRadius: 12, padding: '10px 14px', marginBottom: 14, fontSize: 13, color: t.red, fontWeight: 600 }}>{tr('pe.stopListInfo', { n: stopCount })}</div>
      )}
      {cats.map(cat => {
        const list = itemsFor(cat.id)
        if (list.length === 0) return null
        return (
          <div key={cat.id} style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: t.text3, textTransform: 'uppercase', letterSpacing: 0.6, padding: '4px 4px 8px' }}>{cat.name}</div>
            <div style={{ background: t.surface, borderRadius: 16, overflow: 'hidden', boxShadow: t.sh }}>
              {list.map((item, i) => (
                <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 16px', borderBottom: i < list.length - 1 ? `0.5px solid ${t.sep2}` : 'none', opacity: item.is_available ? 1 : 0.6 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 15, color: t.text, fontWeight: 500 }}>{item.name}</div>
                    {item.price != null && <div style={{ fontSize: 12, color: t.text3, marginTop: 2 }}>{item.price} {currency}</div>}
                  </div>
                  <button onClick={() => toggle(item)} style={{ padding: '7px 14px', borderRadius: 980, border: 'none', cursor: canEdit ? 'pointer' : 'default', fontFamily: 'inherit', fontSize: 13, fontWeight: 700, background: item.is_available ? `${t.green}1a` : t.red, color: item.is_available ? t.green : '#fff' }}>
                    {item.is_available ? tr('pe.available') : tr('pe.stop')}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── ORDERS INBOX (заказы из гостевого меню) ─────────────────────────────────────

const ORDER_STATUS: Record<string, { label: string; next?: string; nextLabel?: string; color: (t: any) => string }> = {
  new: { label: 'pe.osNew', next: 'in_progress', nextLabel: 'pe.osNewNext', color: t => t.orange },
  in_progress: { label: 'pe.osInProgress', next: 'done', nextLabel: 'pe.osInProgressNext', color: t => t.blue },
  done: { label: 'pe.osDone', color: t => t.green },
  cancelled: { label: 'pe.osCancelled', color: t => t.text3 },
}

function OrdersInbox({ currency, accent, t, toast }: { currency: string; accent: string; t: any; toast: (m: string) => void }) {
  const { t: tr } = useI18n()
  const [orders, setOrders] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [seg, setSeg] = useState<'active' | 'done'>('active')

  const load = async () => {
    const from = fmtDate(addDays(new Date(), -2))
    const { data } = await db.from('menu_orders').select('*').gte('created_at', from).order('created_at', { ascending: false }).limit(100)
    setOrders(data || []); setLoading(false)
  }
  useEffect(() => {
    load()
    const iv = setInterval(load, 30000) // новые заказы подтягиваются сами
    return () => clearInterval(iv)
  }, [])

  const setStatus = async (o: any, status: string) => {
    setOrders(os => os.map(x => x.id === o.id ? { ...x, status } : x))
    await db.from('menu_orders').update({ status }).eq('id', o.id)
    toast(tr(ORDER_STATUS[status]?.label || 'pe.updated'))
  }

  if (loading) return <div style={{ textAlign: 'center', padding: 40, color: t.text3 }}>{tr('pe.loading')}</div>

  const active = orders.filter(o => o.status === 'new' || o.status === 'in_progress')
  const finished = orders.filter(o => o.status === 'done' || o.status === 'cancelled')
  const list = seg === 'active' ? active : finished

  return (
    <div>
      <div style={{ display: 'flex', background: t.fill, borderRadius: 12, padding: 3, marginBottom: 16, gap: 2 }}>
        {([['active', `${tr('pe.activeOrders')}${active.length ? ` · ${active.length}` : ''}`], ['done', tr('pe.finishedOrders')]] as const).map(([id, label]) => (
          <button key={id} onClick={() => setSeg(id)} style={{ flex: 1, padding: '8px 0', borderRadius: 10, border: 'none', fontFamily: 'inherit', fontSize: 13, fontWeight: seg === id ? 700 : 500, cursor: 'pointer', background: seg === id ? t.surface : 'transparent', color: seg === id ? accent : t.text3, boxShadow: seg === id ? t.sh2 : 'none' }}>{label}</button>
        ))}
      </div>

      {list.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '50px 20px', color: t.text3 }}>
          <div style={{ fontWeight: 600, fontSize: 16, color: t.text2 }}>{seg === 'active' ? tr('pe.noActiveOrders') : tr('pe.emptyYet')}</div>
          <div style={{ fontSize: 13, marginTop: 4 }}>{tr('pe.ordersAppearHere')}</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {list.map(o => {
            const st = ORDER_STATUS[o.status] || ORDER_STATUS.new
            const isCall = Array.isArray(o.items) && o.items[0]?.call === 'waiter' // вызов официанта (цифровой счёт)
            if (isCall) return (
              <div key={o.id} style={{ background: t.surface, borderRadius: 16, padding: '14px 16px', boxShadow: t.sh, borderLeft: `3px solid ${t.orange}` }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 15, fontWeight: 700, color: t.text }}>{tr('pe.callingWaiter')}</span>
                    {o.table_number && <span style={{ fontSize: 13, fontWeight: 800, color: '#fff', background: t.orange, padding: '3px 10px', borderRadius: 8 }}>{tr('pe.table', { n: o.table_number })}</span>}
                    <span style={{ fontSize: 12, color: t.text3 }}>{new Date(o.created_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                  {(o.status === 'new' || o.status === 'in_progress')
                    ? <button onClick={() => setStatus(o, 'done')} style={{ ...btnB2(t), background: accent, color: '#fff' }}>{tr('pe.coming')}</button>
                    : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={t.green} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>}
                </div>
              </div>
            )
            return (
              <div key={o.id} style={{ background: t.surface, borderRadius: 16, padding: '14px 16px', boxShadow: t.sh }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {o.table_number && <span style={{ fontSize: 13, fontWeight: 800, color: '#fff', background: accent, padding: '3px 10px', borderRadius: 8 }}>{tr('pe.table', { n: o.table_number })}</span>}
                    <span style={{ fontSize: 12, color: t.text3 }}>{new Date(o.created_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 700, color: st.color(t), background: `${st.color(t)}1a`, padding: '3px 9px', borderRadius: 8 }}>{tr(st.label)}</span>
                </div>
                {(Array.isArray(o.items) ? o.items : []).map((it: any, i: number) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, color: t.text, padding: '3px 0' }}>
                    <span>{it.name}{Array.isArray(it.opts) && it.opts.length > 0 ? <span style={{ color: t.text3 }}> · {it.opts.join(', ')}</span> : null} × {it.qty}</span>
                    {it.price != null && <span style={{ color: t.text3 }}>{(it.price * it.qty).toFixed(2)} {currency}</span>}
                  </div>
                ))}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, paddingTop: 8, borderTop: `0.5px solid ${t.sep2}` }}>
                  <span style={{ fontSize: 15, fontWeight: 800, color: t.text }}>{Number(o.total || 0).toFixed(2)} {currency}</span>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {o.status === 'new' && <button onClick={() => setStatus(o, 'cancelled')} style={btnB2(t)}>{tr('pe.cancel')}</button>}
                    {st.next && <button onClick={() => setStatus(o, st.next!)} style={{ ...btnB2(t), background: accent, color: '#fff' }}>{tr(st.nextLabel ?? '')}</button>}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── AUDITS (чек-листы смены + разовые проверки + статистика) ────────────────────
// Данные: shift_checklists (kind='shift' — открытие/закрытие; kind='audit' — разовый прогон,
// сам является и шаблоном, и инстансом) + shift_checklist_completions (прохождение).
// items/items_state читаются в СТАРОМ ([string]/[bool]) И НОВОМ ({label,photo_required}/{done,photo_url})
// форматах — обратная совместимость, миграция данных не требуется (см. normItem/normState).

// Цеха для чек-листов (role=null → общий, виден всем).
const CHECKLIST_ROLES: { val: string | null; label: string }[] = [
  { val: null, label: 'pe.clAll' },
  { val: 'kitchen', label: 'pe.roleKitchen' },
  { val: 'bar', label: 'pe.roleBar' },
  { val: 'hookah', label: 'pe.roleHookah' },
  { val: 'waiter', label: 'pe.clWaiter' },
  { val: 'host', label: 'pe.roleHost' },
  { val: 'cleaner', label: 'pe.roleCleaner' },
]

// Готовые шаблоны под общепит — добавляются кнопкой, не автоматически.
const PRESET_TEMPLATES: { type: 'open' | 'close'; role: string | null; items: string[] }[] = [
  { type: 'open', role: null, items: ['Свет и музыка включены', 'Столы и стулья расставлены', 'Меню в наличии на всех столах', 'Кассовая смена открыта'] },
  { type: 'close', role: null, items: ['Столы протёрты', 'Мусор вынесен', 'Касса закрыта и сверена', 'Свет и техника выключены'] },
  { type: 'open', role: 'bar', items: ['Барная стойка чистая', 'Лёд заготовлен', 'Остатки алкоголя сверены'] },
  { type: 'open', role: 'kitchen', items: ['Холодильники — температура в норме', 'Заготовки на месте', 'Чистота рабочих поверхностей'] },
  { type: 'close', role: 'kitchen', items: ['Продукты убраны в холод', 'Плита и духовка выключены', 'Поверхности продезинфицированы'] },
]

// Дни недели: индекс = JS Date.getUTCDay() (0=вс..6=сб) — так же считает cron
// (runScheduledAudits в app/api/cron/reminders/route.ts). Порядок отображения — Пн..Вс.
const WEEKDAY_LABELS = ['pe.wdSun', 'pe.wdMon', 'pe.wdTue', 'pe.wdWed', 'pe.wdThu', 'pe.wdFri', 'pe.wdSat']
const WEEKDAY_DISPLAY_ORDER = [1, 2, 3, 4, 5, 6, 0]

function recurrenceSummary(audit: any, tr: (k: string, v?: Record<string, string | number>) => string): string | null {
  if (!audit?.recurrence || audit.recurrence === 'none') return null
  if (audit.recurrence === 'daily') return tr('pe.recurrenceDaily')
  if (audit.recurrence === 'weekly') {
    const days: number[] = Array.isArray(audit.recurrence_weekdays) ? audit.recurrence_weekdays : []
    if (!days.length) return tr('pe.recurrenceWeekly')
    return days.slice().sort((a, b) => a - b).map(d => tr(WEEKDAY_LABELS[d])).join(', ')
  }
  if (audit.recurrence === 'monthly') return tr('pe.dayOfMonth', { n: audit.recurrence_day_of_month || 1 })
  return null
}

function normItem(x: any, i: number): { id: string; label: string; photo_required: boolean } {
  if (typeof x === 'string') return { id: String(i), label: x, photo_required: false }
  return { id: x?.id ?? String(i), label: x?.label ?? '', photo_required: !!x?.photo_required }
}
function normState(x: any): { done: boolean; photo_url: string | null } {
  if (typeof x === 'boolean') return { done: x, photo_url: null }
  if (x == null) return { done: false, photo_url: null }
  return { done: !!x.done, photo_url: x.photo_url ?? null }
}

async function uploadAuditPhoto(restaurantId: string, folder: string, file: File): Promise<string | null> {
  const ext = file.name.split('.').pop() || 'jpg'
  const path = `audits/${restaurantId}/${folder}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
  const { error } = await supabase.storage.from('restaurant-assets').upload(path, file, { upsert: true })
  if (error) return null
  const { data: { publicUrl } } = supabase.storage.from('restaurant-assets').getPublicUrl(path)
  return publicUrl
}

// Провал пункта → задача (staff_tasks). Дедуп на уже открытую задачу по тому же пункту за
// 7 дней — паттерн SafetyCulture Actions: не плодить дубли по одной и той же проблеме.
async function reportViolation(opts: {
  restaurantId: string; myId: string; label: string; completionId?: string; assignee: string
  staff: any[]; photoFile: File | null; toast: (m: string) => void; tr: (k: string, v?: Record<string, string | number>) => string
}) {
  const { restaurantId, myId, label, completionId, assignee, staff, photoFile, toast, tr } = opts
  if (!assignee) return
  const cutoff = new Date(Date.now() - 7 * 86400000).toISOString()
  const { data: existing } = await db.from('staff_tasks').select('id,status,created_at')
    .eq('source_item_label', label).neq('status', 'done').gte('created_at', cutoff).limit(1)
  if (existing && existing.length > 0) {
    if (typeof window !== 'undefined' && !window.confirm(tr('pe.linkExistingTask'))) return
    toast(tr('pe.existingTaskNoted')); return
  }
  let photo_url: string | null = null
  if (photoFile) photo_url = await uploadAuditPhoto(restaurantId, 'violations', photoFile)
  let targets: string[]
  if (assignee.startsWith('role:')) targets = staff.filter((s: any) => s.role === assignee.slice(5)).map((s: any) => s.id)
  else targets = [assignee]
  if (targets.length === 0) { toast(tr('pe.noActiveStaffRole')); return }
  const base = {
    title: label, description: null, created_by: myId || null, priority: 'high', status: 'todo',
    source_completion_id: completionId || null, source_item_label: label, photo_url,
  }
  await Promise.all(targets.map(tid => db.from('staff_tasks').insert({ ...base, assigned_to: tid })))
  const notifyIds = targets.filter(tid => tid !== myId)
  if (notifyIds.length) pushNotify({ type: 'task', title: 'Audit violation', body: label, titleKey: 'notify.violationTitle', bodyKey: 'notify.violationBody', bodyParams: { item: label }, audience: { staff_ids: notifyIds } })
  toast(tr('pe.violationTaskCreated'))
}

// Карточка пунктов — общая для «Смены» и разовых «Аудитов».
function ChecklistCard({ title, items, state, canFill, restaurantId, completionId, staff, myId, accent, t, toast, onSetItem, actions }: {
  title: React.ReactNode; items: { id: string; label: string; photo_required: boolean }[]; state: { done: boolean; photo_url: string | null }[]
  canFill: boolean; restaurantId: string; completionId?: string; staff: any[]; myId: string; accent: string; t: any; toast: (m: string) => void
  onSetItem: (idx: number, next: { done: boolean; photo_url: string | null }) => void
  actions?: React.ReactNode
}) {
  const { t: tr } = useI18n()
  const [reporting, setReporting] = useState<number | null>(null)
  const [assignee, setAssignee] = useState('')
  const [reportFile, setReportFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState<number | null>(null)
  const doneCount = items.filter((_, i) => state[i]?.done).length

  const toggle = async (i: number, file?: File) => {
    if (!canFill) { toast(tr('pe.needCheckInFirst')); return }
    const it = items[i]; const cur = state[i] || { done: false, photo_url: null }
    if (!cur.done && it.photo_required && !cur.photo_url) {
      if (!file) return
      setUploading(i)
      const url = await uploadAuditPhoto(restaurantId, completionId || 'pending', file)
      setUploading(null)
      if (!url) return
      onSetItem(i, { done: true, photo_url: url })
      return
    }
    onSetItem(i, { done: !cur.done, photo_url: cur.photo_url })
  }

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 4px 10px', gap: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: t.text3, textTransform: 'uppercase', letterSpacing: 0.5 }}>{title} · {doneCount}/{items.length}</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          {actions}
          {doneCount === items.length && items.length > 0 && <span style={{ fontSize: 11, fontWeight: 700, color: t.green, background: `${t.green}1a`, padding: '3px 9px', borderRadius: 8 }}>{tr('pe.doneCaps')}</span>}
        </span>
      </div>
      <div style={{ background: t.surface, borderRadius: 16, overflow: 'hidden', boxShadow: t.sh }}>
        {items.map((it, i) => {
          const s = state[i] || { done: false, photo_url: null }
          const needsPhoto = it.photo_required && !s.done && !s.photo_url
          return (
            <div key={it.id} style={{ borderBottom: i < items.length - 1 ? `0.5px solid ${t.sep2}` : 'none' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 16px' }}>
                {needsPhoto ? (
                  <label style={{ width: 22, height: 22, borderRadius: '50%', border: `2px solid ${accent}`, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: accent }}>
                    <input type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) toggle(i, f); e.target.value = '' }} />
                    <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" /><circle cx="12" cy="13" r="4" /></svg>
                  </label>
                ) : (
                  <button onClick={() => toggle(i)} disabled={!canFill} style={{ width: 22, height: 22, borderRadius: '50%', border: `2px solid ${s.done ? accent : t.sep}`, background: s.done ? accent : 'transparent', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: canFill ? 'pointer' : 'default', padding: 0 }}>
                    {s.done && <svg width="11" height="11" fill="none" stroke="#fff" strokeWidth="3" viewBox="0 0 24 24"><path d="M5 13l4 4L19 7" /></svg>}
                  </button>
                )}
                <div onClick={() => canFill && !needsPhoto && toggle(i)} style={{ flex: 1, cursor: canFill && !needsPhoto ? 'pointer' : 'default', minWidth: 0 }}>
                  <span style={{ fontSize: 15, color: t.text, textDecoration: s.done ? 'line-through' : 'none', opacity: s.done ? 0.55 : 1 }}>{it.label}</span>
                  {uploading === i && <span style={{ display: 'block', fontSize: 11, color: t.text3 }}>{tr('pe.uploadingPhoto')}</span>}
                  {s.photo_url && <a href={s.photo_url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} style={{ display: 'block', fontSize: 11, color: accent }}>{tr('pe.photoRequired')} <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: 'middle' }}><path d="M20 6L9 17l-5-5" /></svg></a>}
                </div>
                <button onClick={() => { setReporting(reporting === i ? null : i); setAssignee(''); setReportFile(null) }} title={tr('pe.reportViolation')} style={{ background: 'none', border: 'none', color: reporting === i ? t.red : t.text4, cursor: 'pointer', padding: 4, display: 'flex', flexShrink: 0 }}>
                  <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" /><path d="M4 22V15" /></svg>
                </button>
              </div>
              {reporting === i && (
                <div style={{ padding: '0 16px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <select value={assignee} onChange={e => setAssignee(e.target.value)} style={{ ...inp(t), marginBottom: 0 }}>
                    <option value="">{tr('pe.auditTarget')}</option>
                    {CHECKLIST_ROLES.filter(r => r.val).map(r => <option key={r.val} value={`role:${r.val}`}>{tr(r.label)}</option>)}
                    {staff.map((s2: any) => <option key={s2.id} value={s2.id}>{s2.name}</option>)}
                  </select>
                  <label style={{ ...btnB2(t), textAlign: 'center', cursor: 'pointer', display: 'block' }}>
                    {reportFile ? reportFile.name : tr('pe.addPhoto')}
                    <input type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={e => setReportFile(e.target.files?.[0] || null)} />
                  </label>
                  <button onClick={async () => { await reportViolation({ restaurantId, myId, label: it.label, completionId, assignee, staff, photoFile: reportFile, toast, tr }); setReporting(null); setReportFile(null) }} disabled={!assignee} style={{ width: '100%', padding: '10px', borderRadius: 12, border: 'none', background: t.red, color: '#fff', fontFamily: 'inherit', fontSize: 13, fontWeight: 700, cursor: assignee ? 'pointer' : 'default', opacity: assignee ? 1 : 0.5 }}>{tr('pe.reportViolation')}</button>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ShiftChecklistsView({ isManager, myId, myRole, canFill, openShiftId, staff, restaurantId, accent, t, toast }: {
  isManager: boolean; myId: string; myRole?: string; canFill: boolean; openShiftId: string | null; staff: any[]; restaurantId: string; accent: string; t: any; toast: (m: string) => void
}) {
  const { t: tr } = useI18n()
  const today = fmtDate(new Date())
  // Чек-лист открытия/закрытия смены привязан к кассовой смене Manager (shifts.date) —
  // без неё отмечать пункты нельзя, как на iOS (guard let sid = openShiftId).
  const canFillShift = canFill && !!openShiftId
  const [type, setType] = useState<'open' | 'close'>('open')
  const [lists, setLists] = useState<any[]>([])
  const [completions, setCompletions] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<{ id?: string; role: string | null; items: string[] } | null>(null)
  const [saving, setSaving] = useState(false)

  const load = async () => {
    const [{ data: cl }, { data: cm }] = await Promise.all([
      db.from('shift_checklists').select('*').eq('kind', 'shift'),
      db.from('shift_checklist_completions').select('*').eq('date', today),
    ])
    setLists(cl || []); setCompletions(cm || []); setLoading(false)
  }
  useEffect(() => { load() }, [])

  // Сотрудник видит общие (role=null) + по своей роли; менеджер — все цеха.
  const relevant = lists.filter(l => l.type === type && (isManager || !l.role || l.role === myRole))

  const setItem = async (list: any, idx: number, next: { done: boolean; photo_url: string | null }) => {
    if (!openShiftId) { toast(tr('pe.openShiftFirst')); return }
    const items = (Array.isArray(list.items) ? list.items : []).map((x: any, i: number) => normItem(x, i))
    const completion = completions.find(c => c.checklist_id === list.id)
    const curState = (Array.isArray(completion?.items_state) ? completion.items_state : []).map(normState)
    let nextState = items.map((_, i) => i === idx ? next : (curState[i] || { done: false, photo_url: null }))
    let allDone = nextState.every(s => s.done)
    if (completion?.id) {
      // Против lost update: перечитываем свежую строку и мержим ТОЛЬКО свой индекс —
      // параллельные отметки коллег не затираем.
      const { data: freshRows } = await db.from('shift_checklist_completions').select('items_state').eq('id', completion.id)
      const freshState = (Array.isArray(freshRows?.[0]?.items_state) ? freshRows[0].items_state : curState).map(normState)
      nextState = items.map((_, i) => i === idx ? next : (freshState[i] || { done: false, photo_url: null }))
      allDone = nextState.every(s => s.done)
      setCompletions(cs => cs.map(c => c.id === completion.id ? { ...c, items_state: nextState } : c))
      await db.from('shift_checklist_completions').update({ items_state: nextState, status: allDone ? 'done' : 'in_progress', staff_id: myId || null, completed_at: allDone ? new Date().toISOString() : null }).eq('id', completion.id)
    } else {
      const { data } = await db.from('shift_checklist_completions').insert({
        checklist_id: list.id, shift_id: openShiftId, date: today, staff_id: myId || null,
        items_state: nextState, status: allDone ? 'done' : 'in_progress', completed_at: allDone ? new Date().toISOString() : null,
      }).select().single()
      if (data) setCompletions(cs => [...cs, data])
    }
    if (allDone) toast(type === 'open' ? tr('pe.openDone') : tr('pe.closeDone'))
  }

  const saveTemplate = async () => {
    if (!editing) return
    const clean = editing.items.map(s => s.trim()).filter(Boolean)
    if (clean.length === 0) { toast(tr('pe.addAtLeastOneItem')); return }
    setSaving(true)
    if (editing.id) await db.from('shift_checklists').update({ items: clean, role: editing.role }).eq('id', editing.id)
    else await db.from('shift_checklists').insert({ type, items: clean, role: editing.role, kind: 'shift' })
    setSaving(false); setEditing(null); toast(tr('pe.checklistSaved')); await load()
  }
  const removeList = async (id: string) => {
    setLists(ls => ls.filter(l => l.id !== id))
    await db.from('shift_checklists').delete().eq('id', id)
  }
  const addPresets = async () => {
    await Promise.all(PRESET_TEMPLATES.map(p => db.from('shift_checklists').insert({ type: p.type, role: p.role, items: p.items, kind: 'shift' })))
    toast(tr('pe.presetsAdded')); await load()
  }

  if (loading) return <div style={{ textAlign: 'center', padding: 40, color: t.text3 }}>{tr('pe.loading')}</div>

  return (
    <div>
      {!openShiftId && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: `${t.orange}14`, borderRadius: 14, padding: '14px', marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: t.text }}>{tr('mg.emptyTitle')}</div>
            <div style={{ fontSize: 12, color: t.text3, marginTop: 2 }}>{tr('pe.checklistNoShiftHint')}</div>
          </div>
        </div>
      )}
      {canFillShift === false && !!openShiftId && <div style={{ background: `${t.orange}14`, borderRadius: 12, padding: '12px 14px', fontSize: 13, color: t.orange, marginBottom: 14 }}>{tr('pe.needCheckInFirst')}</div>}
      <div style={{ display: 'flex', background: t.fill, borderRadius: 12, padding: 3, marginBottom: 16, gap: 2 }}>
        {([['open', tr('pe.opening')], ['close', tr('pe.closing')]] as const).map(([id, label]) => (
          <button key={id} onClick={() => setType(id)} style={{ flex: 1, padding: '8px 0', borderRadius: 10, border: 'none', fontFamily: 'inherit', fontSize: 13, fontWeight: type === id ? 700 : 500, cursor: 'pointer', background: type === id ? t.surface : 'transparent', color: type === id ? accent : t.text3, boxShadow: type === id ? t.sh2 : 'none' }}>{label}</button>
        ))}
      </div>

      {relevant.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '50px 20px', color: t.text3 }}>
          <div style={{ fontWeight: 600, fontSize: 16, color: t.text2 }}>{tr('pe.checklistNotSet')}</div>
          <div style={{ fontSize: 13, marginTop: 4 }}>{isManager ? tr('pe.checklistManagerHint') : tr('pe.checklistStaffHint')}</div>
        </div>
      ) : relevant.map(list => {
        const items = (Array.isArray(list.items) ? list.items : []).map((x: any, i: number) => normItem(x, i))
        const completion = completions.find(c => c.checklist_id === list.id)
        const state = (Array.isArray(completion?.items_state) ? completion.items_state : []).map(normState)
        return (
          <div key={list.id}>
            {isManager && (
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginBottom: 2 }}>
                <button onClick={() => setEditing({ id: list.id, role: list.role ?? null, items: items.length ? items.map(x => x.label) : [''] })} style={{ background: 'none', border: 'none', color: accent, cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, fontWeight: 600, padding: 0 }}>{tr('pe.edit')}</button>
                <button onClick={() => removeList(list.id)} style={{ background: 'none', border: 'none', color: t.text4, cursor: 'pointer', padding: 0, display: 'flex' }}>
                  <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" /></svg>
                </button>
              </div>
            )}
            <ChecklistCard
              title={list.role ? tr(roleLabel(list.role)) : tr('pe.general')}
              items={items} state={state} canFill={canFillShift}
              restaurantId={restaurantId} completionId={completion?.id} staff={staff} myId={myId}
              accent={accent} t={t} toast={toast}
              onSetItem={(idx, next) => setItem(list, idx, next)}
            />
          </div>
        )
      })}

      {isManager && (
        <>
          <button onClick={() => setEditing({ role: null, items: [''] })} style={{ width: '100%', padding: '13px', borderRadius: 14, border: `1.5px dashed ${t.sep}`, background: 'transparent', color: accent, fontFamily: 'inherit', fontSize: 14, fontWeight: 600, cursor: 'pointer', marginTop: 4 }}>
            {tr('pe.addChecklistForRole')}
          </button>
          <button onClick={addPresets} style={{ width: '100%', padding: '11px', borderRadius: 14, border: 'none', background: 'transparent', color: t.text3, fontFamily: 'inherit', fontSize: 13, cursor: 'pointer', marginTop: 8 }}>
            {tr('pe.presetTemplates')}
          </button>
        </>
      )}

      {editing != null && (
        <Sheet onClose={() => setEditing(null)} t={t}>
          <div style={{ padding: '14px 20px 32px' }}>
            <div style={{ fontSize: 18, fontWeight: 700, textAlign: 'center', color: t.text, marginBottom: 18 }}>{type === 'open' ? tr('pe.checklistOpenTitle') : tr('pe.checklistCloseTitle')}</div>
            <label style={lbl(t)}>{tr('pe.workshop')}</label>
            <select value={editing.role ?? ''} onChange={e => setEditing(ed => ({ ...ed!, role: e.target.value || null }))} style={inp(t)}>
              {CHECKLIST_ROLES.map(r => <option key={r.val ?? 'all'} value={r.val ?? ''}>{tr(r.label)}</option>)}
            </select>
            {editing.items.map((v, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                <input value={v} onChange={e => setEditing(ed => ({ ...ed!, items: ed!.items.map((x, j) => j === i ? e.target.value : x) }))} placeholder={tr('pe.itemN', { n: i + 1 })} style={{ ...inp(t), marginBottom: 0, flex: 1 }} />
                <button onClick={() => setEditing(ed => ({ ...ed!, items: ed!.items.filter((_, j) => j !== i) }))} style={{ width: 44, borderRadius: 12, border: 'none', background: `${t.red}14`, color: t.red, cursor: 'pointer', fontSize: 18, fontFamily: 'inherit' }}>−</button>
              </div>
            ))}
            <button onClick={() => setEditing(ed => ({ ...ed!, items: [...ed!.items, ''] }))} style={{ width: '100%', padding: '11px', borderRadius: 12, border: `1.5px dashed ${t.sep}`, background: 'transparent', color: t.text3, fontFamily: 'inherit', fontSize: 14, cursor: 'pointer', marginBottom: 14 }}>{tr('pe.addItem')}</button>
            <button onClick={saveTemplate} disabled={saving} style={{ width: '100%', padding: '15px', borderRadius: 14, background: accent, color: '#fff', border: 'none', fontFamily: 'inherit', fontSize: 15, fontWeight: 700, cursor: 'pointer', boxShadow: `0 4px 16px ${accent}44` }}>
              {saving ? '...' : tr('pe.save')}
            </button>
          </div>
        </Sheet>
      )}
    </div>
  )
}

function AdHocAuditsView({ isManager, myId, myName, myRole, staff, canFill, restaurantId, accent, t, toast }: {
  isManager: boolean; myId: string; myName: string; myRole?: string; staff: any[]; canFill: boolean; restaurantId: string; accent: string; t: any; toast: (m: string) => void
}) {
  const { t: tr } = useI18n()
  const today = fmtDate(new Date())
  const [audits, setAudits] = useState<any[]>([])
  const [completions, setCompletions] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState<{
    id: string | null; title: string; items: string[]; targetType: 'role' | 'staff' | 'venue'; targetVal: string
    recurrence: 'none' | 'daily' | 'weekly' | 'monthly'; recurrenceWeekdays: number[]; recurrenceDayOfMonth: number
    origItems?: { label: string; photo_required: boolean }[]
  } | null>(null)
  const [saving, setSaving] = useState(false)

  const load = async () => {
    // Только сегодняшние прогоны (как iOS todayAuditRuns): иначе отметка попадала в
    // старый прогон повторяющегося аудита, а история грузилась вся без лимита (A1).
    const [{ data: au }, { data: cm }] = await Promise.all([
      db.from('shift_checklists').select('*').eq('kind', 'audit').order('created_at', { ascending: false }).limit(50),
      db.from('shift_checklist_completions').select('*').eq('date', today),
    ])
    setAudits(au || []); setCompletions(cm || []); setLoading(false)
  }
  useEffect(() => { load() }, [])

  const visible = audits.filter(a =>
    isManager || a.target_scope === 'venue' ||
    (a.target_scope === 'role' && (!a.role || a.role === myRole)) ||
    (a.target_scope === 'staff' && a.assigned_staff_id === myId)
  )

  const setItem = async (audit: any, idx: number, next: { done: boolean; photo_url: string | null }) => {
    const items = (Array.isArray(audit.items) ? audit.items : []).map((x: any, i: number) => normItem(x, i))
    const completion = completions.find(c => c.checklist_id === audit.id && c.date === today)
    const curState = (Array.isArray(completion?.items_state) ? completion.items_state : []).map(normState)
    let nextState = items.map((_, i) => i === idx ? next : (curState[i] || { done: false, photo_url: null }))
    let allDone = nextState.every(s => s.done)
    if (completion?.id) {
      // Против lost update: свежая строка с сервера, мержим ТОЛЬКО свой индекс.
      const { data: freshRows } = await db.from('shift_checklist_completions').select('items_state').eq('id', completion.id)
      const freshState = (Array.isArray(freshRows?.[0]?.items_state) ? freshRows[0].items_state : curState).map(normState)
      nextState = items.map((_, i) => i === idx ? next : (freshState[i] || { done: false, photo_url: null }))
      allDone = nextState.every(s => s.done)
      setCompletions(cs => cs.map(c => c.id === completion.id ? { ...c, items_state: nextState } : c))
      await db.from('shift_checklist_completions').update({ items_state: nextState, status: allDone ? 'done' : 'in_progress', staff_id: myId || null, completed_at: allDone ? new Date().toISOString() : null }).eq('id', completion.id)
    } else {
      const { data } = await db.from('shift_checklist_completions').insert({
        checklist_id: audit.id, date: today, staff_id: myId || null,
        items_state: nextState, status: allDone ? 'done' : 'in_progress', completed_at: allDone ? new Date().toISOString() : null,
      }).select().single()
      if (data) setCompletions(cs => [...cs, data])
    }
    if (allDone) toast(tr('pe.openDone'))
  }

  // Пуш целевой аудитории аудита (запуск сегодняшнего прогона).
  const notifyAudience = (audit: any, title: string) => {
    let targets: string[] = []
    if (audit.target_scope === 'role') targets = staff.filter((s: any) => s.role === audit.role).map((s: any) => s.id)
    else if (audit.target_scope === 'staff') targets = audit.assigned_staff_id ? [audit.assigned_staff_id] : []
    else targets = staff.map((s: any) => s.id)
    const notifyIds = targets.filter(tid => tid !== myId)
    if (notifyIds.length) pushNotify({ type: 'audit', title: 'New audit', body: title, titleKey: 'notify.auditAssignedTitle', bodyKey: 'notify.auditAssignedBody', bodyParams: { name: myName || 'Manager', title }, audience: { staff_ids: notifyIds } })
  }

  /// Повторный запуск существующего шаблона (как iOS startAudit): прогон pending + пуш.
  const startAudit = async (audit: any) => {
    if (completions.some(c => c.checklist_id === audit.id && c.date === today)) return
    await db.from('shift_checklist_completions').insert({ checklist_id: audit.id, date: today, status: 'pending', requested_by: myId || null })
    notifyAudience(audit, audit.title || '')
    toast(tr('pe.auditLaunched')); await load()
  }

  const removeAudit = async (audit: any) => {
    if (!confirm(tr('pe.deleteAuditConfirm'))) return
    await db.from('shift_checklist_completions').delete().eq('checklist_id', audit.id)
    await db.from('shift_checklists').delete().eq('id', audit.id)
    await load()
  }

  const editAudit = (audit: any) => {
    const orig = (Array.isArray(audit.items) ? audit.items : []).map((x: any, i: number) => normItem(x, i))
    setCreating({
      id: audit.id, title: audit.title || '', items: orig.map((it: any) => it.label),
      targetType: audit.target_scope || 'venue',
      targetVal: audit.target_scope === 'role' ? (audit.role || '') : audit.target_scope === 'staff' ? (audit.assigned_staff_id || '') : '',
      recurrence: audit.recurrence || 'none',
      recurrenceWeekdays: audit.recurrence_weekdays || [], recurrenceDayOfMonth: audit.recurrence_day_of_month || 1,
      origItems: orig,
    })
  }

  const launch = async () => {
    if (!creating) return
    const clean = creating.items.map(s => s.trim()).filter(Boolean)
    if (!creating.title.trim() || clean.length === 0) { toast(tr('pe.addAtLeastOneItem')); return }
    if (creating.targetType !== 'venue' && !creating.targetVal) return
    setSaving(true)
    const payload: any = {
      kind: 'audit', title: creating.title.trim(), items: clean, target_scope: creating.targetType,
      recurrence: creating.recurrence,
      recurrence_weekdays: creating.recurrence === 'weekly' ? creating.recurrenceWeekdays : null,
      recurrence_day_of_month: creating.recurrence === 'monthly' ? creating.recurrenceDayOfMonth : null,
      role: null, assigned_staff_id: null,
    }
    if (creating.targetType === 'role') payload.role = creating.targetVal
    if (creating.targetType === 'staff') payload.assigned_staff_id = creating.targetVal
    if (creating.id) {
      // Редактирование шаблона: photo_required сохраняем по индексу (в веб-форме флаг не правится).
      payload.items = clean.map((label, i) => ({ id: String(i), label, photo_required: creating.origItems?.[i]?.photo_required || false }))
      await db.from('shift_checklists').update(payload).eq('id', creating.id)
      setSaving(false); setCreating(null); toast(tr('pe.save')); await load()
      return
    }
    const { data: audit } = await db.from('shift_checklists').insert(payload).select().single()
    if (audit) {
      await db.from('shift_checklist_completions').insert({ checklist_id: audit.id, date: today, status: 'pending', requested_by: myId || null })
      notifyAudience(audit, creating.title.trim())
    }
    setSaving(false); setCreating(null); toast(tr('pe.auditLaunched')); await load()
  }

  if (loading) return <div style={{ textAlign: 'center', padding: 40, color: t.text3 }}>{tr('pe.loading')}</div>

  return (
    <div>
      {!canFill && <div style={{ background: `${t.orange}14`, borderRadius: 12, padding: '12px 14px', fontSize: 13, color: t.orange, marginBottom: 14 }}>{tr('pe.needCheckInFirst')}</div>}
      {isManager && (
        <button onClick={() => setCreating({ id: null, title: '', items: [''], targetType: 'role', targetVal: '', recurrence: 'none', recurrenceWeekdays: [], recurrenceDayOfMonth: 1 })} style={{ width: '100%', padding: '14px', borderRadius: 14, background: accent, color: '#fff', border: 'none', fontFamily: 'inherit', fontSize: 15, fontWeight: 700, cursor: 'pointer', marginBottom: 16, boxShadow: `0 4px 16px ${accent}44` }}>
          {tr('pe.newAudit')}
        </button>
      )}

      {visible.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '50px 20px', color: t.text3 }}>{tr('pe.noAudits')}</div>
      ) : visible.map(audit => {
        const items = (Array.isArray(audit.items) ? audit.items : []).map((x: any, i: number) => normItem(x, i))
        const completion = completions.find(c => c.checklist_id === audit.id && c.date === today)
        const state = (Array.isArray(completion?.items_state) ? completion.items_state : []).map(normState)
        const targetLabel = audit.target_scope === 'role' ? tr(roleLabel(audit.role)) : audit.target_scope === 'staff' ? (staff.find((s: any) => s.id === audit.assigned_staff_id)?.name || '—') : tr('pe.auditTargetVenue')
        const recurLabel = recurrenceSummary(audit, tr)
        return (
          <ChecklistCard
            key={audit.id}
            title={<>{audit.title || '—'} <span style={{ opacity: 0.6, fontWeight: 500 }}>· {targetLabel}{recurLabel ? ` · ${recurLabel}` : ''}</span></>}
            items={items} state={state} canFill={canFill}
            restaurantId={restaurantId} completionId={completion?.id} staff={staff} myId={myId}
            accent={accent} t={t} toast={toast}
            onSetItem={(idx, next) => setItem(audit, idx, next)}
            actions={isManager && (
              <>
                {!completion && (
                  <button onClick={() => startAudit(audit)} title={tr('pe.runAudit')} style={{ background: 'none', border: 'none', color: accent, cursor: 'pointer', padding: 2, display: 'flex' }}>
                    <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" /></svg>
                  </button>
                )}
                <button onClick={() => editAudit(audit)} title={tr('pe.editAudit')} style={{ background: 'none', border: 'none', color: t.text3, cursor: 'pointer', padding: 2, display: 'flex' }}>
                  <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M17 3a2.8 2.8 0 114 4L7.5 20.5 2 22l1.5-5.5L17 3z" /></svg>
                </button>
                <button onClick={() => removeAudit(audit)} title={tr('pe.deleteAuditConfirm')} style={{ background: 'none', border: 'none', color: t.text4, cursor: 'pointer', padding: 2, display: 'flex' }}>
                  <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" viewBox="0 0 24 24"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6" /></svg>
                </button>
              </>
            )}
          />
        )
      })}

      {creating != null && (
        <Sheet onClose={() => setCreating(null)} t={t}>
          <div style={{ padding: '14px 20px 32px' }}>
            <div style={{ fontSize: 18, fontWeight: 700, textAlign: 'center', color: t.text, marginBottom: 18 }}>{tr('pe.newAudit')}</div>
            <input value={creating.title} onChange={e => setCreating(c => ({ ...c!, title: e.target.value }))} placeholder={tr('pe.auditTitlePh')} style={inp(t)} />
            <label style={lbl(t)}>{tr('pe.auditTarget')}</label>
            <select value={creating.targetType} onChange={e => setCreating(c => ({ ...c!, targetType: e.target.value as any, targetVal: '' }))} style={inp(t)}>
              <option value="role">{tr('pe.auditTargetRole')}</option>
              <option value="staff">{tr('pe.auditTargetStaff')}</option>
              <option value="venue">{tr('pe.auditTargetVenue')}</option>
            </select>
            {creating.targetType === 'role' && (
              <select value={creating.targetVal} onChange={e => setCreating(c => ({ ...c!, targetVal: e.target.value }))} style={inp(t)}>
                <option value="">—</option>
                {CHECKLIST_ROLES.filter(r => r.val).map(r => <option key={r.val} value={r.val!}>{tr(r.label)}</option>)}
              </select>
            )}
            {creating.targetType === 'staff' && (
              <select value={creating.targetVal} onChange={e => setCreating(c => ({ ...c!, targetVal: e.target.value }))} style={inp(t)}>
                <option value="">—</option>
                {staff.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            )}
            <label style={lbl(t)}>{tr('pe.recurrenceLabel')}</label>
            <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
              {([['none', tr('pe.recurrenceNone')], ['daily', tr('pe.recurrenceDaily')], ['weekly', tr('pe.recurrenceWeekly')], ['monthly', tr('pe.recurrenceMonthly')]] as const).map(([id, label]) => (
                <button key={id} onClick={() => setCreating(c => ({ ...c!, recurrence: id }))} style={{ flex: 1, padding: '9px 4px', borderRadius: 10, border: 'none', fontFamily: 'inherit', fontSize: 12, fontWeight: creating.recurrence === id ? 700 : 500, cursor: 'pointer', background: creating.recurrence === id ? accent : t.fill, color: creating.recurrence === id ? '#fff' : t.text3 }}>{label}</button>
              ))}
            </div>
            {creating.recurrence === 'weekly' && (
              <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
                {WEEKDAY_DISPLAY_ORDER.map(d => {
                  const on = creating.recurrenceWeekdays.includes(d)
                  return (
                    <button key={d} onClick={() => setCreating(c => ({ ...c!, recurrenceWeekdays: on ? c!.recurrenceWeekdays.filter(x => x !== d) : [...c!.recurrenceWeekdays, d] }))}
                      style={{ flex: 1, padding: '9px 0', borderRadius: 10, border: 'none', fontFamily: 'inherit', fontSize: 12, fontWeight: on ? 700 : 500, cursor: 'pointer', background: on ? accent : t.fill, color: on ? '#fff' : t.text3 }}>
                      {tr(WEEKDAY_LABELS[d])}
                    </button>
                  )
                })}
              </div>
            )}
            {creating.recurrence === 'monthly' && (
              <input type="number" min={1} max={31} value={creating.recurrenceDayOfMonth}
                onChange={e => setCreating(c => ({ ...c!, recurrenceDayOfMonth: Math.min(31, Math.max(1, Number(e.target.value) || 1)) }))}
                placeholder={tr('pe.dayOfMonthLabel')} style={{ ...inp(t), marginBottom: 14 }} />
            )}
            <label style={lbl(t)}>{tr('pe.itemsLabel')}</label>
            {creating.items.map((v, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                <input value={v} onChange={e => setCreating(c => ({ ...c!, items: c!.items.map((x, j) => j === i ? e.target.value : x) }))} placeholder={tr('pe.itemN', { n: i + 1 })} style={{ ...inp(t), marginBottom: 0, flex: 1 }} />
                <button onClick={() => setCreating(c => ({ ...c!, items: c!.items.filter((_, j) => j !== i) }))} style={{ width: 44, borderRadius: 12, border: 'none', background: `${t.red}14`, color: t.red, cursor: 'pointer', fontSize: 18, fontFamily: 'inherit' }}>−</button>
              </div>
            ))}
            <button onClick={() => setCreating(c => ({ ...c!, items: [...c!.items, ''] }))} style={{ width: '100%', padding: '11px', borderRadius: 12, border: `1.5px dashed ${t.sep}`, background: 'transparent', color: t.text3, fontFamily: 'inherit', fontSize: 14, cursor: 'pointer', marginBottom: 14 }}>{tr('pe.addItem')}</button>
            <button onClick={launch} disabled={saving} style={{ width: '100%', padding: '15px', borderRadius: 14, background: accent, color: '#fff', border: 'none', fontFamily: 'inherit', fontSize: 15, fontWeight: 700, cursor: 'pointer', boxShadow: `0 4px 16px ${accent}44` }}>
              {saving ? '...' : tr('pe.launchAudit')}
            </button>
          </div>
        </Sheet>
      )}
    </div>
  )
}

function AuditStatsView({ accent, t }: { accent: string; t: any }) {
  const { t: tr } = useI18n()
  const [loading, setLoading] = useState(true)
  const [lists, setLists] = useState<any[]>([])
  const [completions, setCompletions] = useState<any[]>([])
  const [staff, setStaff] = useState<any[]>([])

  useEffect(() => {
    const since = fmtDate(new Date(Date.now() - 30 * 86400000))
    Promise.all([
      db.from('shift_checklists').select('*'),
      db.from('shift_checklist_completions').select('*').gte('date', since),
      db.from('staff_directory').select('*').eq('is_active', true).order('name'),
    ]).then(([{ data: cl }, { data: cm }, { data: dir }]: any) => {
      setLists(cl || []); setCompletions(cm || []); setStaff(dir || []); setLoading(false)
    })
  }, [])

  if (loading) return <div style={{ textAlign: 'center', padding: 40, color: t.text3 }}>{tr('pe.loading')}</div>
  if (completions.length === 0) return <div style={{ textAlign: 'center', padding: '50px 20px', color: t.text3 }}>{tr('pe.noStatsYet')}</div>

  const listById = new Map(lists.map((l: any) => [l.id, l]))
  let totalItems = 0, doneItems = 0
  const violationsByLabel = new Map<string, number>()
  const byStaff = new Map<string, { total: number; done: number }>()

  // Что считать (ревью A2): status='done' ставится только когда отмечены ВСЕ пункты, поэтому
  // «нарушение» = неотмеченный пункт в прогоне, работа над которым закончена по времени:
  // done-прогоны + начатые (in_progress) за ПРОШЛЫЕ дни. Сегодняшние in_progress ещё
  // заполняются, pending вообще не открывались — они идут отдельной метрикой «не пройдено»,
  // а не в нарушения (иначе пустой прогон = 100% нарушений).
  const todayKey = fmtDate(new Date())
  const finished = completions.filter((c: any) => c.status === 'done' || (c.status === 'in_progress' && c.date < todayKey))
  const unfinished = completions.filter((c: any) => c.status === 'pending' && c.date < todayKey).length

  for (const c of finished) {
    const list = listById.get(c.checklist_id)
    if (!list) continue
    const items = (Array.isArray((list as any).items) ? (list as any).items : []).map((x: any, i: number) => normItem(x, i))
    const state = (Array.isArray(c.items_state) ? c.items_state : []).map(normState)
    items.forEach((it: any, i: number) => {
      totalItems++
      const done = !!state[i]?.done
      if (done) doneItems++
      else violationsByLabel.set(it.label, (violationsByLabel.get(it.label) || 0) + 1)
    })
    if (c.staff_id) {
      const cur = byStaff.get(c.staff_id) || { total: 0, done: 0 }
      cur.total += items.length; cur.done += items.filter((_: any, i: number) => state[i]?.done).length
      byStaff.set(c.staff_id, cur)
    }
  }

  const rate = totalItems > 0 ? Math.round((doneItems / totalItems) * 100) : 0
  const topViolations = Array.from(violationsByLabel.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5)
  const rating = Array.from(byStaff.entries())
    .map(([id, v]) => ({ name: staff.find((s: any) => s.id === id)?.name || '—', pct: v.total > 0 ? Math.round((v.done / v.total) * 100) : 0 }))
    .sort((a, b) => b.pct - a.pct)

  return (
    <div>
      <div style={{ background: t.surface, borderRadius: 20, padding: '24px 20px', boxShadow: t.sh, textAlign: 'center', marginBottom: 16 }}>
        <div style={{ fontSize: 44, fontWeight: 800, color: accent }}>{rate}%</div>
        <div style={{ fontSize: 13, color: t.text3, marginTop: 4 }}>{tr('pe.completionRate')} · {tr('pe.last30Days')}</div>
        {unfinished > 0 && <div style={{ fontSize: 12, fontWeight: 600, color: t.orange, marginTop: 6 }}>{tr('pe.unfinishedRuns', { n: unfinished })}</div>}
      </div>

      {topViolations.length > 0 && (
        <>
          <div style={{ fontSize: 12, fontWeight: 600, color: t.text3, textTransform: 'uppercase', letterSpacing: 0.5, padding: '4px 4px 8px' }}>{tr('pe.topViolations')}</div>
          <div style={{ background: t.surface, borderRadius: 16, overflow: 'hidden', boxShadow: t.sh, marginBottom: 16 }}>
            {topViolations.map(([label, n], i) => (
              <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 16px', borderBottom: i < topViolations.length - 1 ? `0.5px solid ${t.sep2}` : 'none' }}>
                <span style={{ fontSize: 14, color: t.text }}>{label}</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: t.red }}>{n}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {rating.length > 0 && (
        <>
          <div style={{ fontSize: 12, fontWeight: 600, color: t.text3, textTransform: 'uppercase', letterSpacing: 0.5, padding: '4px 4px 8px' }}>{tr('pe.staffRating')}</div>
          <div style={{ background: t.surface, borderRadius: 16, overflow: 'hidden', boxShadow: t.sh }}>
            {rating.map((r, i) => (
              <div key={r.name + i} style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 16px', borderBottom: i < rating.length - 1 ? `0.5px solid ${t.sep2}` : 'none' }}>
                <span style={{ fontSize: 14, color: t.text }}>{r.name}</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: r.pct >= 80 ? t.green : r.pct >= 50 ? t.orange : t.red }}>{r.pct}%</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// Обёртка: сегмент «Смена / Разовые / Статистика» + общий гео-гейт (личная явка сегодня).
function AuditsView({ me, isManager, restaurantId, accent, t, toast }: { me: any; isManager: boolean; restaurantId: string; accent: string; t: any; toast: (m: string) => void }) {
  const { t: tr } = useI18n()
  const myId = me.id || ''
  const myRole = me.role
  const today = fmtDate(new Date())
  const [seg, setSeg] = useState<'shift' | 'oneoff' | 'stats'>('shift')
  const [staff, setStaff] = useState<any[]>([])
  const [geoRequired, setGeoRequired] = useState(false)
  const [checkedInToday, setCheckedInToday] = useState(true)
  const [openShiftId, setOpenShiftId] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    Promise.all([
      db.from('restaurant_settings').select('attendance_enabled').limit(1),
      db.from('staff_directory').select('*').eq('is_active', true).order('name'),
      myId ? db.from('attendance_records').select('id').eq('staff_id', myId).eq('date', today).limit(1) : Promise.resolve({ data: [] as any[] }),
      // Чек-лист открытия/закрытия смены привязан к кассовой смене Manager за сегодня
      // (shifts.date уникален по (restaurant_id, date) — см. CLAUDE.md), как на iOS.
      db.from('shifts').select('id,status').eq('date', today).order('opened_at', { ascending: false }).limit(1),
    ]).then(([rs, dir, att, sh]: any) => {
      const s = Array.isArray(rs.data) ? rs.data[0] : rs.data
      setGeoRequired(!!s?.attendance_enabled)
      setStaff(dir.data || [])
      setCheckedInToday((att.data || []).length > 0)
      setOpenShiftId(sh.data?.[0]?.id || null)
      setReady(true)
    })
  }, [myId])

  // Fail-closed до загрузки данных (гео/явка/смена) — как на iOS (requireGeoCheckIn ждёт
  // loadAttendance перед решением), не оставляем короткое окно кликабельности "вслепую".
  const canFill = ready && (!geoRequired || !myId || checkedInToday)

  const SEGS = [
    { id: 'shift', label: tr('pe.shiftChecklists') },
    { id: 'oneoff', label: tr('pe.oneOffAudits') },
    ...(isManager ? [{ id: 'stats', label: tr('pe.statistics') }] : []),
  ] as const

  return (
    <div>
      <div style={{ display: 'flex', background: t.fill, borderRadius: 12, padding: 3, marginBottom: 16, gap: 2 }}>
        {SEGS.map(s => (
          <button key={s.id} onClick={() => setSeg(s.id as any)} style={{ flex: 1, padding: '8px 0', borderRadius: 10, border: 'none', fontFamily: 'inherit', fontSize: 12.5, fontWeight: seg === s.id ? 700 : 500, cursor: 'pointer', background: seg === s.id ? t.surface : 'transparent', color: seg === s.id ? accent : t.text3, boxShadow: seg === s.id ? t.sh2 : 'none' }}>{s.label}</button>
        ))}
      </div>
      {seg === 'shift' && <ShiftChecklistsView isManager={isManager} myId={myId} myRole={myRole} canFill={canFill} openShiftId={openShiftId} staff={staff} restaurantId={restaurantId} accent={accent} t={t} toast={toast} />}
      {seg === 'oneoff' && <AdHocAuditsView isManager={isManager} myId={myId} myName={me.name || ''} myRole={myRole} staff={staff} canFill={canFill} restaurantId={restaurantId} accent={accent} t={t} toast={toast} />}
      {seg === 'stats' && isManager && <AuditStatsView accent={accent} t={t} />}
    </div>
  )
}

// ── TECH CARDS (технологички) ────────────────────────────────────────────────────

const TC_CAT: Record<string, string> = { dish: 'pe.tcDish', prep: 'pe.tcPrep', stoplist: 'pe.tcOther' }

function TechCardsView({ isManager, accent, t, toast }: { isManager: boolean; accent: string; t: any; toast: (m: string) => void }) {
  const { t: tr } = useI18n()
  const [cards, setCards] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState<string | null>(null)
  const [edit, setEdit] = useState<{ id?: string; name: string; category: string; items: string[] } | null>(null)
  const [saving, setSaving] = useState(false)

  const load = async () => {
    const { data } = await db.from('tech_cards').select('*').eq('is_active', true).order('name')
    setCards(data || []); setLoading(false)
  }
  useEffect(() => { load() }, [])

  const save = async () => {
    if (!edit || !edit.name.trim()) { toast(tr('pe.enterName')); return }
    const clean = edit.items.map(s => s.trim()).filter(Boolean)
    setSaving(true)
    if (edit.id) await db.from('tech_cards').update({ name: edit.name.trim(), category: edit.category, items: clean }).eq('id', edit.id)
    else await db.from('tech_cards').insert({ name: edit.name.trim(), category: edit.category, items: clean })
    setSaving(false); setEdit(null); toast(tr('pe.saved')); await load()
  }
  const remove = async (id: string) => {
    setCards(cs => cs.filter(c => c.id !== id))
    await db.from('tech_cards').update({ is_active: false }).eq('id', id)
  }

  if (loading) return <div style={{ textAlign: 'center', padding: 40, color: t.text3 }}>{tr('pe.loading')}</div>

  return (
    <div>
      {isManager && (
        <button onClick={() => setEdit({ name: '', category: 'dish', items: [''] })} style={{ width: '100%', padding: '14px', borderRadius: 14, background: accent, color: '#fff', border: 'none', fontFamily: 'inherit', fontSize: 15, fontWeight: 700, cursor: 'pointer', marginBottom: 16, boxShadow: `0 4px 16px ${accent}44` }}>
          {tr('pe.newTechCard')}
        </button>
      )}

      {cards.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '50px 20px', color: t.text3 }}>
          <div style={{ fontWeight: 600, fontSize: 16, color: t.text2 }}>{tr('pe.noTechCards')}</div>
          <div style={{ fontSize: 13, marginTop: 4 }}>{isManager ? tr('pe.techCardManagerHint') : tr('pe.techCardStaffHint')}</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {cards.map(c => {
            const items: string[] = Array.isArray(c.items) ? c.items : []
            const opened = open === c.id
            return (
              <div key={c.id} style={{ background: t.surface, borderRadius: 16, boxShadow: t.sh, overflow: 'hidden' }}>
                <button onClick={() => setOpen(opened ? null : c.id)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 15, fontWeight: 600, color: t.text }}>{c.name}</div>
                    <div style={{ fontSize: 12, color: t.text3, marginTop: 2 }}>{TC_CAT[c.category] ? tr(TC_CAT[c.category]) : c.category} · {items.length} {tr('pe.stepsWord')}</div>
                  </div>
                  <svg width="14" height="14" fill="none" stroke={t.text3} strokeWidth="2.5" strokeLinecap="round" viewBox="0 0 24 24" style={{ transform: opened ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }}><path d="M6 9l6 6 6-6" /></svg>
                </button>
                {opened && (
                  <div style={{ padding: '0 16px 14px' }}>
                    {items.map((it, i) => (
                      <div key={i} style={{ display: 'flex', gap: 10, padding: '7px 0', borderTop: i === 0 ? `0.5px solid ${t.sep2}` : 'none', alignItems: 'baseline' }}>
                        <span style={{ fontSize: 12, fontWeight: 800, color: accent, minWidth: 18 }}>{i + 1}</span>
                        <span style={{ fontSize: 14, color: t.text2, lineHeight: 1.45 }}>{it}</span>
                      </div>
                    ))}
                    {isManager && (
                      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                        <button onClick={() => setEdit({ id: c.id, name: c.name, category: c.category, items: items.length ? [...items] : [''] })} style={btnB2(t)}>{tr('pe.edit')}</button>
                        <button onClick={() => remove(c.id)} style={{ ...btnB2(t), color: t.red, background: `${t.red}14` }}>{tr('pe.delete')}</button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {edit && (
        <Sheet onClose={() => setEdit(null)} t={t}>
          <div style={{ padding: '14px 20px 32px' }}>
            <div style={{ fontSize: 18, fontWeight: 700, textAlign: 'center', color: t.text, marginBottom: 18 }}>{edit.id ? tr('pe.editTechCard') : tr('pe.newTechCardTitle')}</div>
            <input value={edit.name} onChange={e => setEdit({ ...edit, name: e.target.value })} placeholder={tr('pe.techNamePh')} autoFocus style={inp(t)} />
            <label style={lbl(t)}>{tr('pe.type')}</label>
            <select value={edit.category} onChange={e => setEdit({ ...edit, category: e.target.value })} style={inp(t)}>
              {Object.entries(TC_CAT).map(([k, v]) => <option key={k} value={k}>{tr(v)}</option>)}
            </select>
            <label style={lbl(t)}>{tr('pe.stepsLabel')}</label>
            {edit.items.map((v, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                <input value={v} onChange={e => setEdit(ed => ({ ...ed!, items: ed!.items.map((x, j) => j === i ? e.target.value : x) }))} placeholder={tr('pe.stepN', { n: i + 1 })} style={{ ...inp(t), marginBottom: 0, flex: 1 }} />
                <button onClick={() => setEdit(ed => ({ ...ed!, items: ed!.items.filter((_, j) => j !== i) }))} style={{ width: 44, borderRadius: 12, border: 'none', background: `${t.red}14`, color: t.red, cursor: 'pointer', fontSize: 18, fontFamily: 'inherit' }}>−</button>
              </div>
            ))}
            <button onClick={() => setEdit(ed => ({ ...ed!, items: [...ed!.items, ''] }))} style={{ width: '100%', padding: '11px', borderRadius: 12, border: `1.5px dashed ${t.sep}`, background: 'transparent', color: t.text3, fontFamily: 'inherit', fontSize: 14, cursor: 'pointer', marginBottom: 14 }}>{tr('pe.addStep')}</button>
            <button onClick={save} disabled={saving} style={{ width: '100%', padding: '15px', borderRadius: 14, background: accent, color: '#fff', border: 'none', fontFamily: 'inherit', fontSize: 15, fontWeight: 700, cursor: 'pointer', boxShadow: `0 4px 16px ${accent}44` }}>
              {saving ? '...' : tr('pe.save')}
            </button>
          </div>
        </Sheet>
      )}
    </div>
  )
}

// ── OPS TAB («Зал»: стоп-лист / заказы / чек-листы / техкарты) ──────────────────

// ── NOTIFICATION SETTINGS (персональные тумблеры) ──────────────────────────────

function Toggle({ on, onToggle, accent, t }: { on: boolean; onToggle: () => void; accent: string; t: any }) {
  return (
    <button onClick={onToggle} style={{ width: 50, height: 30, borderRadius: 15, border: 'none', cursor: 'pointer', background: on ? accent : t.fill, position: 'relative', transition: 'background .2s', flexShrink: 0 }}>
      <span style={{ position: 'absolute', top: 3, left: on ? 23 : 3, width: 24, height: 24, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.3)', transition: 'left .2s' }} />
    </button>
  )
}

function NotificationSettings({ me, isManager, accent, t }: { me: any; isManager: boolean; accent: string; t: any }) {
  const { t: tr } = useI18n()
  const isOwner = !!me.is_owner
  const [prefs, setPrefs] = useState<Record<string, any> | null>(null)
  const [rowId, setRowId] = useState<string | null>(null)

  useEffect(() => {
    const q = isOwner
      ? db.from('notification_prefs').select('*').eq('to_owner', true)
      : db.from('notification_prefs').select('*').eq('staff_id', me.id)
    q.then(({ data }: any) => { const row = (data || [])[0]; setRowId(row?.id || null); setPrefs(row?.prefs || {}) })
  }, [])

  const persist = async (next: Record<string, any>) => {
    setPrefs(next)
    if (rowId) {
      await db.from('notification_prefs').update({ prefs: next, updated_at: new Date().toISOString() }).eq('id', rowId)
    } else {
      const { data } = await db.from('notification_prefs').insert(isOwner ? { to_owner: true, prefs: next } : { staff_id: me.id, prefs: next }).select().single()
      if (data?.id) setRowId(data.id)
    }
  }
  const toggle = (k: string) => persist({ ...(prefs || {}), [k]: !(prefs?.[k] !== false) })
  const setVal = (k: string, v: any) => persist({ ...(prefs || {}), [k]: v })
  const isOn = (k: string) => prefs?.[k] !== false   // нет ключа = включено

  if (!prefs) return <div style={{ textAlign: 'center', padding: 30, color: t.text3 }}>{tr('pe.loading')}</div>

  const Row = ({ k, label }: { k: string; label: string }) => (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 0', borderBottom: `0.5px solid ${t.sep2}` }}>
      <span style={{ fontSize: 15, color: t.text }}>{label}</span>
      <Toggle on={isOn(k)} onToggle={() => toggle(k)} accent={accent} t={t} />
    </div>
  )

  return (
    <div>
      <Row k="shift_reminder" label={tr('pe.nsShiftReminder')} />
      <Row k="task" label={tr('pe.nsTask')} />
      <Row k="swap" label={tr('pe.nsSwap')} />

      {isManager && (
        <>
          <div style={{ fontSize: 11, fontWeight: 700, color: t.text3, textTransform: 'uppercase', letterSpacing: .4, margin: '20px 0 4px' }}>{tr('pe.nsForManagers')}</div>
          <Row k="attendance" label={tr('pe.nsAttendance')} />
          <Row k="cash_open" label={tr('pe.nsCashOpen')} />
          <Row k="cash_close" label={tr('pe.nsCashClose')} />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 0', borderBottom: `0.5px solid ${t.sep2}` }}>
            <span style={{ fontSize: 15, color: t.text }}>{tr('pe.nsShowAmount')}</span>
            <Toggle on={prefs.show_cash_amount === true} onToggle={() => setVal('show_cash_amount', !(prefs.show_cash_amount === true))} accent={accent} t={t} />
          </div>
          <Row k="purchase" label={tr('pe.nsPurchase')} />
          <div style={{ padding: '13px 0' }}>
            <div style={{ fontSize: 15, color: t.text, marginBottom: 10 }}>{tr('pe.nsPurchaseMode')}</div>
            <div style={{ display: 'flex', background: t.fill, borderRadius: 12, padding: 3, gap: 2 }}>
              {([['each', tr('pe.nsEach')], ['daily', tr('pe.nsDaily')]] as const).map(([id, label]) => {
                const cur = prefs.purchase_digest === 'daily' ? 'daily' : 'each'
                return <button key={id} onClick={() => setVal('purchase_digest', id)} style={{ flex: 1, padding: '8px 0', borderRadius: 10, border: 'none', fontFamily: 'inherit', fontSize: 13, fontWeight: cur === id ? 700 : 500, cursor: 'pointer', background: cur === id ? t.surface : 'transparent', color: cur === id ? accent : t.text3, boxShadow: cur === id ? t.sh2 : 'none' }}>{label}</button>
              })}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ── PURCHASE TAB (закуп) ─────────────────────────────────────────────────────────

const PURCHASE_CATS = [
  { id: 'kitchen', label: 'pe.catKitchen' },
  { id: 'bar', label: 'pe.catBar' },
  { id: 'hookah', label: 'pe.catHookah' },
  { id: 'household', label: 'pe.catHousehold' },
  { id: 'general', label: 'pe.catGeneral' },
] as const

function PurchaseTab({ me, isManager, accent, t, toast }: { me: any; isManager: boolean; accent: string; t: any; toast: (m: string) => void }) {
  const { t: tr } = useI18n()
  const [items, setItems] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [seg, setSeg] = useState<'todo' | 'done'>('todo')
  const [showForm, setShowForm] = useState(false)
  const [cat, setCat] = useState<string>('kitchen')
  const [rows, setRows] = useState<{ name: string; qty: string; unit: string }[]>([{ name: '', qty: '', unit: '' }])
  const [saving, setSaving] = useState(false)

  const load = async () => {
    const { data } = await db.from('purchase_items').select('*').order('created_at', { ascending: false }).limit(300)
    setItems(data || []); setLoading(false)
  }
  useEffect(() => { load(); const iv = setInterval(load, 30000); return () => clearInterval(iv) }, [])

  const catLabel = (id: string) => { const c = PURCHASE_CATS.find(x => x.id === id); return c ? tr(c.label) : id }

  const setRow = (i: number, patch: Partial<{ name: string; qty: string; unit: string }>) =>
    setRows(rs => rs.map((r, j) => j === i ? { ...r, ...patch } : r))

  const submit = async () => {
    const valid = rows.map(r => ({ ...r, name: r.name.trim() })).filter(r => r.name)
    if (!valid.length) return
    setSaving(true)
    const payload = valid.map(r => ({
      category: cat,
      name: r.name,
      qty: r.qty.trim() ? (Number(r.qty.replace(',', '.')) || null) : null,
      unit: r.unit.trim() || null,
      status: 'todo',
      created_by: (me.id && me.id !== 'owner') ? me.id : null,
      created_by_name: me.name || (me.is_owner ? tr('role.owner') : ''),
    }))
    const { error } = await db.from('purchase_items').insert(payload)
    setSaving(false)
    if (error) { toast(error.message); return }
    // Push владельцу/менеджерам (с учётом их персональных настроек и режима дайджеста).
    const who = me.name || (me.is_owner ? tr('role.owner') : '')
    const whoPrefix = who ? who + ': ' : ''
    const summary = valid.length === 1
      ? `${whoPrefix}${valid[0].name}`
      : `${whoPrefix}${valid.length} ${tr('pe.pTab').toLowerCase()}`
    pushNotify({
      type: 'purchase', title: `${catLabel(cat)} · ${tr('pe.pTab')}`, body: summary,
      titleKey: 'notify.purchaseTitle', titleParams: { category: cat },
      ...(valid.length > 1 ? { bodyKey: 'notify.purchasePositionsBody', bodyParams: { who: whoPrefix, n: valid.length } } : {}),
      audience: { managers: true }, data: { category: cat },
    })
    setShowForm(false); setRows([{ name: '', qty: '', unit: '' }]); setCat('kitchen')
    load()
  }

  const setStatus = async (it: any, status: string) => {
    const now = new Date().toISOString()
    const bought = status === 'bought'
    setItems(xs => xs.map(x => x.id === it.id ? { ...x, status, bought_at: bought ? now : null } : x))
    await db.from('purchase_items').update({
      status,
      bought_by: bought ? ((me.id && me.id !== 'owner') ? me.id : null) : null,
      bought_at: bought ? now : null,
    }).eq('id', it.id)
  }

  const remove = async (it: any) => {
    setItems(xs => xs.filter(x => x.id !== it.id))
    await db.from('purchase_items').delete().eq('id', it.id)
  }

  const clearDone = async () => {
    const ids = items.filter(x => x.status !== 'todo').map(x => x.id)
    if (!ids.length) return
    setItems(xs => xs.filter(x => x.status === 'todo'))
    await db.from('purchase_items').delete().in('id', ids)
    toast(tr('pe.pClearDone'))
  }

  const buildText = () => {
    const todo = items.filter(x => x.status === 'todo')
    const cats = [...new Set(todo.map(x => x.category))]
    const lines: string[] = []
    cats.forEach(cid => {
      const arr = todo.filter(x => x.category === cid)
      if (!arr.length) return
      lines.push(`${catLabel(cid)}:`)
      arr.forEach(x => {
        const amt = x.qty != null ? ` — ${x.qty}${x.unit ? ' ' + x.unit : ''}` : (x.unit ? ` — ${x.unit}` : '')
        lines.push(`• ${x.name}${amt}`)
      })
      lines.push('')
    })
    return lines.join('\n').trim()
  }
  const copyList = async () => { try { await navigator.clipboard.writeText(buildText()); toast(tr('pe.pCopied')) } catch { toast(buildText()) } }
  const waList = () => { window.open(`https://wa.me/?text=${encodeURIComponent(buildText())}`, '_blank') }

  if (loading) return <div style={{ textAlign: 'center', padding: 40, color: t.text3 }}>{tr('pe.loading')}</div>

  const todo = items.filter(x => x.status === 'todo')
  const done = items.filter(x => x.status !== 'todo')
  const list = seg === 'todo' ? todo : done
  const catsInList = [...new Set(list.map(x => x.category))]

  return (
    <div>
      {/* add button */}
      <button onClick={() => setShowForm(true)} style={{ width: '100%', padding: '13px 0', borderRadius: 14, border: 'none', background: accent, color: '#fff', fontFamily: 'inherit', fontSize: 15, fontWeight: 700, cursor: 'pointer', marginBottom: 14 }}>{tr('pe.pAddItems')}</button>

      {/* segments */}
      <div style={{ display: 'flex', background: t.fill, borderRadius: 12, padding: 3, marginBottom: 16, gap: 2 }}>
        {([['todo', `${tr('pe.pToBuy')}${todo.length ? ` · ${todo.length}` : ''}`], ['done', tr('pe.pDone')]] as const).map(([id, label]) => (
          <button key={id} onClick={() => setSeg(id)} style={{ flex: 1, padding: '8px 0', borderRadius: 10, border: 'none', fontFamily: 'inherit', fontSize: 13, fontWeight: seg === id ? 700 : 500, cursor: 'pointer', background: seg === id ? t.surface : 'transparent', color: seg === id ? accent : t.text3, boxShadow: seg === id ? t.sh2 : 'none' }}>{label}</button>
        ))}
      </div>

      {/* copy / whatsapp (manager, todo view) */}
      {seg === 'todo' && isManager && todo.length > 0 && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          <button onClick={copyList} style={{ ...btnB2(t), flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" /></svg>
            {tr('pe.pCopy')}
          </button>
          <button onClick={waList} style={{ ...btnB2(t), flex: 1, background: '#25D36618', color: '#1faa52', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            <svg width="16" height="16" fill="currentColor" viewBox="0 0 24 24"><path d="M.057 24l1.687-6.163a11.867 11.867 0 01-1.587-5.946C.16 5.335 5.495 0 12.05 0a11.817 11.817 0 018.413 3.488 11.824 11.824 0 013.48 8.414c-.003 6.557-5.338 11.892-11.893 11.892a11.9 11.9 0 01-5.688-1.448L.057 24zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884a9.86 9.86 0 001.59 5.318l-.999 3.648 3.908-1.235zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z" /></svg>
            WhatsApp
          </button>
        </div>
      )}

      {list.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '50px 20px', color: t.text3 }}>
          <div style={{ fontWeight: 600, fontSize: 16, color: t.text2 }}>{seg === 'todo' ? tr('pe.pEmpty') : tr('pe.emptyYet')}</div>
          {seg === 'todo' && <div style={{ fontSize: 13, marginTop: 4 }}>{tr('pe.pEmptyHint')}</div>}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {catsInList.map(cid => (
            <div key={cid}>
              <div style={{ fontSize: 12, fontWeight: 700, color: t.text3, textTransform: 'uppercase', letterSpacing: .4, marginBottom: 8 }}>{catLabel(cid)}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {list.filter(x => x.category === cid).map(it => (
                  <div key={it.id} style={{ background: t.surface, borderRadius: 14, padding: '12px 14px', boxShadow: t.sh, display: 'flex', alignItems: 'center', gap: 12, opacity: it.status === 'todo' ? 1 : 0.6 }}>
                    {seg === 'todo' && isManager && (
                      <button onClick={() => setStatus(it, 'bought')} style={{ width: 26, height: 26, borderRadius: '50%', border: `2px solid ${t.sep}`, background: 'transparent', cursor: 'pointer', flexShrink: 0 }} aria-label={tr('pe.pBought')} />
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 15, fontWeight: 600, color: t.text, textDecoration: it.status === 'bought' ? 'line-through' : 'none' }}>
                        {it.name}{it.qty != null && <span style={{ color: t.text3, fontWeight: 500 }}> · {it.qty}{it.unit ? ` ${it.unit}` : ''}</span>}{it.qty == null && it.unit && <span style={{ color: t.text3, fontWeight: 500 }}> · {it.unit}</span>}
                      </div>
                      <div style={{ fontSize: 11.5, color: t.text3, marginTop: 2 }}>
                        {it.created_by_name ? `${tr('pe.pBy')} ${it.created_by_name}` : ''}{it.status === 'unavailable' ? ` · ${tr('pe.pUnavail')}` : ''}
                      </div>
                    </div>
                    {seg === 'todo' && isManager && (
                      <button onClick={() => setStatus(it, 'unavailable')} style={{ ...btnB2(t), padding: '6px 10px', fontSize: 12 }}>{tr('pe.pUnavail')}</button>
                    )}
                    {(isManager || it.created_by === me.id) && (
                      <button onClick={() => remove(it)} style={{ width: 28, height: 28, borderRadius: 8, border: 'none', background: 'transparent', color: t.text3, cursor: 'pointer', flexShrink: 0 }} aria-label="×">
                        <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12" /></svg>
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
          {seg === 'done' && isManager && done.length > 0 && (
            <button onClick={clearDone} style={{ ...btnB2(t), color: t.red, alignSelf: 'center' }}>{tr('pe.pClearDone')}</button>
          )}
        </div>
      )}

      {/* ADD FORM */}
      {showForm && (
        <Sheet onClose={() => setShowForm(false)} t={t}>
          <div style={{ padding: '14px 16px 32px' }}>
            <div style={{ fontSize: 18, fontWeight: 700, textAlign: 'center', color: t.text, marginBottom: 16 }}>{tr('pe.pNew')}</div>

            {/* category chips */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
              {PURCHASE_CATS.map(c => (
                <button key={c.id} onClick={() => setCat(c.id)} style={{ padding: '8px 14px', borderRadius: 10, border: 'none', fontFamily: 'inherit', fontSize: 13, fontWeight: cat === c.id ? 700 : 500, cursor: 'pointer', background: cat === c.id ? accent : t.fill, color: cat === c.id ? '#fff' : t.text }}>{tr(c.label)}</button>
              ))}
            </div>

            {/* rows */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 12 }}>
              {rows.map((r, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input value={r.name} onChange={e => setRow(i, { name: e.target.value })} placeholder={tr('pe.pNamePh')} style={{ ...inp(t), marginBottom: 0, flex: 1 }} />
                  <input value={r.qty} onChange={e => setRow(i, { qty: e.target.value })} placeholder={tr('pe.pQtyEx')} inputMode="decimal" style={{ ...inp(t), marginBottom: 0, width: 64, padding: '12px 8px', textAlign: 'center' }} />
                  <input value={r.unit} onChange={e => setRow(i, { unit: e.target.value })} placeholder={tr('pe.pUnitEx')} style={{ ...inp(t), marginBottom: 0, width: 64, padding: '12px 8px', textAlign: 'center' }} />
                  {rows.length > 1 && (
                    <button onClick={() => setRows(rs => rs.filter((_, j) => j !== i))} style={{ width: 30, height: 30, borderRadius: 8, border: 'none', background: 'transparent', color: t.text3, cursor: 'pointer', flexShrink: 0 }}>
                      <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12" /></svg>
                    </button>
                  )}
                </div>
              ))}
            </div>

            <button onClick={() => setRows(rs => [...rs, { name: '', qty: '', unit: '' }])} style={{ ...btnB2(t), width: '100%', marginBottom: 16 }}>{tr('pe.pAddRow')}</button>

            <button onClick={submit} disabled={saving || !rows.some(r => r.name.trim())} style={{ width: '100%', padding: '14px 0', borderRadius: 14, border: 'none', background: accent, color: '#fff', fontFamily: 'inherit', fontSize: 16, fontWeight: 700, cursor: 'pointer', opacity: (saving || !rows.some(r => r.name.trim())) ? 0.5 : 1 }}>{tr('pe.pSubmit')}</button>
          </div>
        </Sheet>
      )}
    </div>
  )
}

function OpsTab({ me, isManager, restaurantId, accent, t, toast }: { me: any; isManager: boolean; restaurantId: string; accent: string; t: any; toast: (m: string) => void }) {
  const { t: tr } = useI18n()
  const [view, setView] = useState<'stop' | 'orders' | 'check' | 'tech'>('stop')
  const [currency, setCurrency] = useState('€')
  const [ordersEnabled, setOrdersEnabled] = useState(false)

  useEffect(() => {
    db.from('restaurants').select('currency').limit(1).then(({ data }: any) => {
      const r = Array.isArray(data) ? data[0] : data
      if (r?.currency) setCurrency(r.currency)
    })
    db.from('menu_settings').select('allow_orders').limit(1).then(({ data }: any) => {
      const r = Array.isArray(data) ? data[0] : data
      setOrdersEnabled(!!r?.allow_orders)
    })
  }, [])

  const canStop = isManager || me.role === 'kitchen' // стоп ставят кухня и менеджер
  const canTech = isManager || me.role === 'kitchen' || me.role === 'bar' // техкарты — кухне/бару (не официанту/кальянщику)
  const VIEWS = [
    { id: 'stop', label: tr('pe.vStop') },
    ...(ordersEnabled ? [{ id: 'orders', label: tr('pe.vOrders') }] : []),
    { id: 'check', label: tr('pe.vChecklists') },
    ...(canTech ? [{ id: 'tech', label: tr('pe.vTech') }] : []),
  ] as const

  return (
    <div>
      <div style={{ display: 'flex', background: t.fill, borderRadius: 12, padding: 3, marginBottom: 16, gap: 2 }}>
        {VIEWS.map(v => (
          <button key={v.id} onClick={() => setView(v.id as any)} style={{ flex: 1, padding: '8px 0', borderRadius: 10, border: 'none', fontFamily: 'inherit', fontSize: 12.5, fontWeight: view === v.id ? 700 : 500, cursor: 'pointer', background: view === v.id ? t.surface : 'transparent', color: view === v.id ? accent : t.text3, boxShadow: view === v.id ? t.sh2 : 'none' }}>{v.label}</button>
        ))}
      </div>
      {view === 'stop' && <StopListTab canEdit={canStop} currency={currency} accent={accent} t={t} toast={toast} />}
      {view === 'orders' && ordersEnabled && <OrdersInbox currency={currency} accent={accent} t={t} toast={toast} />}
      {view === 'check' && <AuditsView me={me} isManager={isManager} restaurantId={restaurantId} accent={accent} t={t} toast={toast} />}
      {view === 'tech' && canTech && <TechCardsView isManager={isManager} accent={accent} t={t} toast={toast} />}
    </div>
  )
}

// ── SHIFTS HUB (Смены/Расписание + Явка + Обмены в одной вкладке) ───────────────
// IA: вместо трёх вкладок в баре — один раздел с внутренним сегментом. «Я пришёл»
// (чек-ин) живёт в «Явке», обмены сменами — рядом, расписание/мои смены — основной вид.
// ── DISCIPLINE TAB (история опозданий) ──────────────────────────────────────────

type DisStat = { recs: any[]; shifts: number; evaluable: number; onTime: number; late: number; extra: number; totalMin: number; avgMin: number; maxMin: number; punct: number | null }

function DisciplineTab({ me, accent, t, toast }: { me: any; accent: string; t: any; toast: (m: string) => void }) {
  const { t: tr } = useI18n()
  const [period, setPeriod] = useState<'thisMonth' | 'lastMonth' | '30d' | '90d' | 'custom'>('thisMonth')
  const [cFrom, setCFrom] = useState(fmtDate(addDays(new Date(), -29)))
  const [cTo, setCTo] = useState(fmtDate(new Date()))
  const [records, setRecords] = useState<any[]>([])
  const [staff, setStaff] = useState<any[]>([])
  const [grace, setGrace] = useState(5)
  const [loading, setLoading] = useState(true)
  const [sel, setSel] = useState<string | null>(null)

  const range = (): [string, string] => {
    const now = new Date()
    if (period === 'thisMonth') return [fmtDate(new Date(now.getFullYear(), now.getMonth(), 1)), fmtDate(now)]
    if (period === 'lastMonth') return [fmtDate(new Date(now.getFullYear(), now.getMonth() - 1, 1)), fmtDate(new Date(now.getFullYear(), now.getMonth(), 0))]
    if (period === '30d') return [fmtDate(addDays(now, -29)), fmtDate(now)]
    if (period === '90d') return [fmtDate(addDays(now, -89)), fmtDate(now)]
    return [cFrom, cTo]
  }
  const [from, to] = range()

  const load = async () => {
    setLoading(true)
    const [{ data: recs }, { data: dir }, { data: st }] = await Promise.all([
      db.from('attendance_records').select('*').gte('date', from).lte('date', to).order('date', { ascending: false }).limit(3000),
      db.from('staff_directory').select('*').eq('is_active', true).order('name'),
      db.from('restaurant_settings').select('late_grace_min').limit(1),
    ])
    setRecords(recs || []); setStaff(dir || [])
    const s = Array.isArray(st) ? st[0] : st
    setGrace(s?.late_grace_min ?? 5)
    setLoading(false)
  }
  useEffect(() => { load() }, [from, to])

  const statFor = (sid: string): DisStat => {
    const recs = records.filter(r => r.staff_id === sid)
    const evaluable = recs.filter(r => r.late_minutes != null)
    const lateR = evaluable.filter(r => (r.late_minutes || 0) > grace)
    const totalMin = lateR.reduce((s, r) => s + (r.late_minutes || 0), 0)
    const maxMin = lateR.reduce((m, r) => Math.max(m, r.late_minutes || 0), 0)
    return {
      recs, shifts: recs.length, evaluable: evaluable.length, onTime: evaluable.length - lateR.length,
      late: lateR.length, extra: recs.length - evaluable.length, totalMin,
      avgMin: lateR.length ? Math.round(totalMin / lateR.length) : 0, maxMin,
      punct: evaluable.length ? Math.round((evaluable.length - lateR.length) / evaluable.length * 100) : null,
    }
  }

  const saveGrace = async (v: number) => {
    const prev = grace
    setGrace(v)
    const { error } = await db.from('restaurant_settings').update({ late_grace_min: v })
    if (error) setGrace(prev) // 403/сеть — откат, не делаем вид что сохранилось
  }

  const punctColor = (p: number | null) => p == null ? t.text3 : p >= 95 ? t.green : p >= 80 ? t.orange : t.red

  if (loading) return <div style={{ textAlign: 'center', padding: 40, color: t.text3 }}>{tr('pe.loading')}</div>

  // ── Detail of one employee ──
  if (sel) {
    const s = staff.find(x => x.id === sel)
    const st = statFor(sel)
    const byDate: Record<string, any> = {}; st.recs.forEach(r => { byDate[r.date] = r })
    const dayColor = (key: string) => {
      const r = byDate[key]; if (!r) return null
      if (r.late_minutes == null) return t.text3            // экстра/без графика
      return (r.late_minutes > grace) ? t.orange : t.green
    }
    // месяцы периода для хитмапа
    const months: { y: number; m: number }[] = []
    let cur = new Date(from + 'T00:00:00'); cur = new Date(cur.getFullYear(), cur.getMonth(), 1)
    const end = new Date(to + 'T00:00:00')
    while (cur <= end) { months.push({ y: cur.getFullYear(), m: cur.getMonth() }); cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1) }

    const copySummary = async () => {
      const lines = [
        `${s?.name || ''} · ${from}–${to}`,
        `${tr('pe.punctuality')}: ${st.punct == null ? '—' : st.punct + '%'}`,
        `${tr('pe.shiftsWord')}: ${st.shifts} · ${tr('pe.disOnTime')}: ${st.onTime} · ${tr('pe.disLates')}: ${st.late}`,
        `${tr('pe.disTotal')}: ${st.totalMin}${tr('pe.minShort')} · ${tr('pe.disAvg')}: ${st.avgMin}${tr('pe.minShort')} · ${tr('pe.disMax')}: ${st.maxMin}${tr('pe.minShort')}`,
      ]
      try { await navigator.clipboard.writeText(lines.join('\n')); toast(tr('pe.pCopied')) } catch { toast(lines.join('\n')) }
    }

    const cell = (color: string | null, label: string, dim = false) => (
      <div style={{ aspectRatio: '1', borderRadius: 6, background: color || t.fill, opacity: dim ? 0.25 : (color ? 1 : 0.4), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 600, color: color ? '#fff' : t.text3 }}>{label}</div>
    )

    return (
      <div>
        <button onClick={() => setSel(null)} style={{ ...btnB2(t), marginBottom: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
          <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6" /></svg>{s?.name || ''}
        </button>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 14 }}>
          {[
            { l: tr('pe.punctuality'), v: st.punct == null ? '—' : `${st.punct}%`, c: punctColor(st.punct) },
            { l: tr('pe.disLates'), v: String(st.late), c: st.late ? t.orange : t.green },
            { l: tr('pe.shiftsWord'), v: String(st.shifts), c: accent },
            { l: tr('pe.disTotal'), v: `${st.totalMin}${tr('pe.minShort')}`, c: t.text },
            { l: tr('pe.disAvg'), v: `${st.avgMin}${tr('pe.minShort')}`, c: t.text },
            { l: tr('pe.disMax'), v: `${st.maxMin}${tr('pe.minShort')}`, c: t.text },
          ].map(it => (
            <div key={it.l} style={{ background: t.surface, borderRadius: 14, padding: '12px 8px', boxShadow: t.sh, textAlign: 'center' }}>
              <div style={{ fontSize: 16, fontWeight: 800, color: it.c }}>{it.v}</div>
              <div style={{ fontSize: 9.5, color: t.text3, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.3, marginTop: 3 }}>{it.l}</div>
            </div>
          ))}
        </div>

        {/* Хитмап по месяцам */}
        {months.map(({ y, m }) => {
          const days = new Date(y, m + 1, 0).getDate()
          const firstDow = (new Date(y, m, 1).getDay() + 6) % 7 // Пн=0
          return (
            <div key={`${y}-${m}`} style={{ background: t.surface, borderRadius: 16, padding: 14, boxShadow: t.sh, marginBottom: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: t.text, marginBottom: 10 }}>{MON()[m]} {y}</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 5 }}>
                {DOW_SHORT().map(d => <div key={d} style={{ textAlign: 'center', fontSize: 9, color: t.text3, fontWeight: 600 }}>{d}</div>)}
                {Array.from({ length: firstDow }).map((_, i) => <div key={`e${i}`} />)}
                {Array.from({ length: days }).map((_, i) => {
                  const day = i + 1
                  const key = `${y}-${String(m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
                  const inRange = key >= from && key <= to
                  return <div key={key}>{cell(dayColor(key), String(day), !inRange)}</div>
                })}
              </div>
            </div>
          )
        })}

        {/* Список дней с опозданиями/явками */}
        <div style={{ background: t.surface, borderRadius: 16, overflow: 'hidden', boxShadow: t.sh, marginBottom: 14 }}>
          {st.recs.length === 0 ? <div style={{ padding: 24, textAlign: 'center', color: t.text3 }}>{tr('pe.disEmpty')}</div> : st.recs.map((r, i) => {
            const lateBad = r.late_minutes != null && r.late_minutes > grace
            return (
              <div key={r.id || i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 16px', borderBottom: i < st.recs.length - 1 ? `0.5px solid ${t.sep2}` : 'none' }}>
                <span style={{ fontSize: 14, color: t.text }}>{dayLabel(r.date)} · {clock(r.check_in_at)}</span>
                {r.late_minutes == null
                  ? <span style={{ fontSize: 11, fontWeight: 600, color: t.text3 }}>{tr('pe.disExtra')}</span>
                  : lateBad
                    ? <span style={{ fontSize: 11, fontWeight: 700, color: t.orange, background: `${t.orange}1a`, padding: '3px 9px', borderRadius: 8 }}>+{r.late_minutes}{tr('pe.minShort')}</span>
                    : <span style={{ fontSize: 11, fontWeight: 700, color: t.green }}>{tr('pe.disOnTime')}</span>}
              </div>
            )
          })}
        </div>

        <button onClick={copySummary} style={{ ...btnB2(t), width: '100%' }}>{tr('pe.disCopy')}</button>
      </div>
    )
  }

  // ── Ranking of all staff ──
  const ranked = staff.map(s => ({ s, st: statFor(s.id) }))
    .sort((a, b) => (b.st.late - a.st.late) || (b.st.totalMin - a.st.totalMin) || a.s.name.localeCompare(b.s.name))

  return (
    <div>
      {/* period presets */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
        {([['thisMonth', tr('pe.perThisMonth')], ['lastMonth', tr('pe.perLastMonth')], ['30d', tr('pe.per30')], ['90d', tr('pe.per90')], ['custom', tr('pe.perCustom')]] as const).map(([id, label]) => (
          <button key={id} onClick={() => setPeriod(id)} style={{ padding: '7px 12px', borderRadius: 10, border: 'none', fontFamily: 'inherit', fontSize: 12.5, fontWeight: period === id ? 700 : 500, cursor: 'pointer', background: period === id ? accent : t.fill, color: period === id ? '#fff' : t.text }}>{label}</button>
        ))}
      </div>
      {period === 'custom' && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center' }}>
          <input type="date" value={cFrom} max={cTo} onChange={e => setCFrom(e.target.value)} style={{ ...inp(t), marginBottom: 0, flex: 1 }} />
          <span style={{ color: t.text3 }}>—</span>
          <input type="date" value={cTo} min={cFrom} max={fmtDate(new Date())} onChange={e => setCTo(e.target.value)} style={{ ...inp(t), marginBottom: 0, flex: 1 }} />
        </div>
      )}

      {/* grace setting (owner only) */}
      {me.is_owner && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: t.surface, borderRadius: 12, padding: '10px 14px', boxShadow: t.sh, marginBottom: 14 }}>
          <span style={{ fontSize: 13, color: t.text2 }}>{tr('pe.disGrace')}</span>
          <div style={{ display: 'flex', gap: 4 }}>
            {[0, 5, 10, 15].map(v => (
              <button key={v} onClick={() => saveGrace(v)} style={{ width: 34, height: 30, borderRadius: 8, border: 'none', fontFamily: 'inherit', fontSize: 13, fontWeight: grace === v ? 700 : 500, cursor: 'pointer', background: grace === v ? accent : t.fill, color: grace === v ? '#fff' : t.text }}>{v}</button>
            ))}
          </div>
        </div>
      )}

      {records.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '50px 20px', color: t.text3 }}>
          <div style={{ fontWeight: 600, fontSize: 16, color: t.text2 }}>{tr('pe.disEmpty')}</div>
        </div>
      ) : (
        <div style={{ background: t.surface, borderRadius: 16, overflow: 'hidden', boxShadow: t.sh }}>
          {ranked.map(({ s, st }, i) => (
            <button key={s.id} onClick={() => setSel(s.id)} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 16px', border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: 'inherit', borderBottom: i < ranked.length - 1 ? `0.5px solid ${t.sep2}` : 'none', textAlign: 'left' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 15, color: t.text, fontWeight: 500 }}>{s.name}</div>
                <div style={{ fontSize: 12, color: t.text3, marginTop: 2 }}>
                  {st.shifts === 0 ? tr('pe.disNoData') : `${st.shifts} ${tr('pe.shiftsWord')}${st.late ? ` · ${st.late} ${tr('pe.disLates').toLowerCase()} · ${st.totalMin}${tr('pe.minShort')}` : ''}`}
                </div>
              </div>
              {st.punct != null && <span style={{ fontSize: 14, fontWeight: 800, color: punctColor(st.punct), marginRight: 8 }}>{st.punct}%</span>}
              <svg width="16" height="16" fill="none" stroke={t.text3} strokeWidth="2" viewBox="0 0 24 24"><path d="M9 18l6-6-6-6" /></svg>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function ShiftsHub({ me, isManager, restaurantId, accent, t, toast }: { me: any; isManager: boolean; restaurantId: string; accent: string; t: any; toast: (m: string) => void }) {
  const { t: tr } = useI18n()
  const [view, setView] = useState<'shifts' | 'attendance' | 'discipline' | 'swaps'>('shifts')
  const views: [string, string][] = [
    ['shifts', isManager ? tr('pe.schedule') : tr('pe.myShifts')],
    ['attendance', tr('pe.attendance')],
    ...(isManager ? [['discipline', tr('pe.discipline')] as [string, string]] : []),
    ['swaps', tr('pe.swaps')],
  ]
  return (
    <div>
      <div style={{ display: 'flex', background: t.fill, borderRadius: 12, padding: 3, marginBottom: 16, gap: 2 }}>
        {views.map(([id, label]) => (
          <button key={id} onClick={() => setView(id as any)} style={{ flex: 1, padding: '8px 2px', borderRadius: 10, border: 'none', fontFamily: 'inherit', fontSize: 12.5, fontWeight: view === id ? 700 : 500, cursor: 'pointer', background: view === id ? t.surface : 'transparent', color: view === id ? accent : t.text3, boxShadow: view === id ? t.sh2 : 'none' }}>{label}</button>
        ))}
      </div>
      {view === 'shifts' && (isManager
        ? <ScheduleTab restaurantId={restaurantId} accent={accent} t={t} toast={toast} />
        : <MyShiftsTab myId={me.id || ''} accent={accent} t={t} />)}
      {view === 'attendance' && <AttendanceTab me={me} isManager={isManager} accent={accent} t={t} toast={toast} onOpenDiscipline={() => setView('discipline')} />}
      {view === 'discipline' && <DisciplineTab me={me} accent={accent} t={t} toast={toast} />}
      {view === 'swaps' && <SwapsTab me={me} isManager={isManager} accent={accent} t={t} toast={toast} />}
    </div>
  )
}

// ── MAIN ─────────────────────────────────────────────────────────────────────────

// embedded: рендер внутри дашборд-shell (/dashboard/people) — без фикс-хрома,
// тема дашборда, вошедший всегда owner (staff-выбора mise_me_ у него нет).
export function PeopleApp({ restaurantId, embedded = false }: { restaurantId: string; embedded?: boolean }) {
  const { t: tr } = useI18n()
  const router = useRouter()
  const t = useTheme(embedded ? 'mise_dash_dark' : 'mise_people_dark')
  // Desktop-режим внутри shell: шире мобильных 640px. Staff-приложение не трогаем.
  const contentMaxWidth = embedded ? 1100 : 640
  const accent = t.dark ? '#5e5ce6' : '#5856d6'
  const me = embedded ? { is_owner: true } as ReturnType<typeof getMe> : getMe(restaurantId)
  const isManager = !!me.is_owner || me.role === 'manager' || me.role === 'admin'
  const [tab, setTab] = useState<string>('shifts')
  const [toast, setToast] = useState('')
  const [showNotif, setShowNotif] = useState(false)
  const [showNotifSettings, setShowNotifSettings] = useState(false)
  const [unread, setUnread] = useState(0)
  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(''), 2500) }

  useEffect(() => {
    if (!me.id) return // у владельца нет staff-записи — уведомления адресуются сотрудникам
    db.from('notifications').select('id').eq('staff_id', me.id).is('read_at', null)
      .then(({ data }: any) => setUnread((data || []).length))
  }, [me.id])

  // Бейдж новых заказов на табе «Зал» — официант видит заказ, не открывая вкладку.
  const [newOrders, setNewOrders] = useState(0)
  useEffect(() => {
    const poll = () => db.from('menu_orders').select('id').eq('status', 'new')
      .then(({ data }: any) => setNewOrders((data || []).length))
    poll()
    const iv = setInterval(poll, 30000)
    return () => clearInterval(iv)
  }, [])

  if (!t.mounted) return (
    <div style={{ minHeight: embedded ? 240 : '100vh', background: embedded ? 'transparent' : t.bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: 24, height: 24, border: `2.5px solid ${accent}33`, borderTopColor: accent, borderRadius: '50%', animation: 'spin .7s linear infinite' }} />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )

  // Первый таб зависит от роли; «Зал» (стоп-лист/заказы/чек-листы/техкарты) — у всех.
  // Уведомления переехали в колокольчик хедера.
  const TABS = [
    { id: 'shifts', label: isManager ? tr('pe.schedule') : tr('pe.shiftsTab'), icon: (a: boolean) => <svg fill="none" stroke="currentColor" strokeWidth={a ? 2.2 : 1.8} viewBox="0 0 24 24" width="25" height="25"><rect x="3" y="4" width="18" height="18" rx="3" /><path d="M16 2v4M8 2v4M3 10h18" /></svg> },
    { id: 'tasks', label: tr('pe.tasks'), icon: (a: boolean) => <svg fill="none" stroke="currentColor" strokeWidth={a ? 2.2 : 1.8} viewBox="0 0 24 24" width="25" height="25"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2" /><rect x="9" y="3" width="6" height="4" rx="1" /><path d="M9 13l2 2 4-4" /></svg> },
    { id: 'ops', label: tr('pe.hall'), icon: (a: boolean) => <svg fill="none" stroke="currentColor" strokeWidth={a ? 2.2 : 1.8} viewBox="0 0 24 24" width="25" height="25"><path d="M3 9l1.2-5h15.6L21 9" /><path d="M4 9v11a1 1 0 001 1h14a1 1 0 001-1V9" /><path d="M3 9h18" /><path d="M9 21v-6h6v6" /></svg> },
    { id: 'purchase', label: tr('pe.pTab'), icon: (a: boolean) => <svg fill="none" stroke="currentColor" strokeWidth={a ? 2.2 : 1.8} viewBox="0 0 24 24" width="25" height="25"><circle cx="9" cy="21" r="1.5" /><circle cx="18" cy="21" r="1.5" /><path d="M2 3h2.2l2.2 12.4a1.5 1.5 0 001.5 1.2h9.1a1.5 1.5 0 001.5-1.2L21 7H5.3" /></svg> },
    { id: 'salary', label: tr('pe.salaryTab'), icon: (a: boolean) => <svg fill="none" stroke="currentColor" strokeWidth={a ? 2.2 : 1.8} viewBox="0 0 24 24" width="25" height="25"><rect x="2" y="6" width="20" height="13" rx="2.5" /><path d="M2 10h20" /><circle cx="17.5" cy="14.5" r="1.4" fill="currentColor" stroke="none" /></svg> },
  ]

  return (
    <div style={embedded
      ? { display: 'flex', flexDirection: 'column', fontFamily: "-apple-system,BlinkMacSystemFont,'SF Pro Text',sans-serif", WebkitFontSmoothing: 'antialiased', color: t.text }
      : { height: '100vh', overflow: 'hidden', background: t.bg, fontFamily: "-apple-system,BlinkMacSystemFont,'SF Pro Text',sans-serif", WebkitFontSmoothing: 'antialiased', color: t.text }}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}} @keyframes fadeUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}} @keyframes toastIn{from{opacity:0;transform:translateX(-50%) translateY(10px)}to{opacity:1;transform:translateX(-50%) translateY(0)}} *{box-sizing:border-box} input[type=time]{ -webkit-appearance:none }`}</style>

      {/* HEADER: standalone — фикс-шапка; embedded — строка контролов в потоке */}
      <div style={embedded
        ? { order: 0, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, marginBottom: 12, maxWidth: contentMaxWidth, width: '100%', alignSelf: 'center', boxSizing: 'border-box' as const }
        : { position: 'fixed', top: 0, left: 0, right: 0, zIndex: 300, height: 56, background: t.hbg, backdropFilter: 'saturate(200%) blur(24px)', WebkitBackdropFilter: 'saturate(200%) blur(24px)', borderBottom: `0.5px solid ${t.sep2}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px' }}>
        {!embedded && <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <AppSwitchBrand name="People" accent={accent} color={t.text} muted={t.text3} size={18} />
          <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: 0.4, color: accent, background: `${accent}1a`, padding: '2px 6px', borderRadius: 6, textTransform: 'uppercase' }}>Beta</span>
        </div>}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {me.id && (
            <button onClick={() => setShowNotif(true)} style={{ position: 'relative', width: 36, height: 36, borderRadius: '50%', background: t.fill, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: t.text }}>
              <svg width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M18 8a6 6 0 00-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 01-3.4 0" /></svg>
              {unread > 0 && <span style={{ position: 'absolute', top: 2, right: 2, minWidth: 16, height: 16, borderRadius: 8, background: t.red, color: '#fff', fontSize: 10, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px' }}>{unread > 9 ? '9+' : unread}</span>}
            </button>
          )}
          <button onClick={() => setShowNotifSettings(true)} style={{ width: 36, height: 36, borderRadius: '50%', background: t.fill, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: t.text }} aria-label={tr('pe.nsTitle')}>
            <svg width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" /></svg>
          </button>
          {!embedded && <button onClick={t.toggle} style={{ width: 36, height: 36, borderRadius: '50%', background: t.fill, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: t.text }}>
            {t.dark
              ? <svg width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="5" /><path d="M12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" /></svg>
              : <svg width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M21 12.8A9 9 0 1111.2 3 7 7 0 0021 12.8z" /></svg>}
          </button>}
          {!embedded && <button onClick={() => supabase.auth.signOut().then(() => { localStorage.removeItem('mise_restaurant_id'); router.replace('/auth/login') })} style={{ width: 36, height: 36, borderRadius: '50%', background: `${t.red}18`, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="16" height="16" fill="none" stroke={t.red} strokeWidth="2" viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" /></svg>
          </button>}
        </div>
      </div>

      {/* CONTENT */}
      <div style={embedded
        ? { order: 2 }
        : { position: 'fixed', top: 56, left: 0, right: 0, bottom: 82, overflowY: 'auto', background: t.bg }}>
        <div style={{ padding: embedded ? '0 0 28px' : '16px 16px 28px', maxWidth: contentMaxWidth, margin: '0 auto', animation: 'fadeUp .22s ease' }}>
          {tab === 'shifts' && <ShiftsHub me={me} isManager={isManager} restaurantId={restaurantId} accent={accent} t={t} toast={showToast} />}
          {tab === 'tasks' && <TasksTab isManager={isManager} myId={me.id || ''} accent={accent} t={t} toast={showToast} />}
          {tab === 'ops' && <OpsTab me={me} isManager={isManager} restaurantId={restaurantId} accent={accent} t={t} toast={showToast} />}
          {tab === 'purchase' && <PurchaseTab me={me} isManager={isManager} accent={accent} t={t} toast={showToast} />}
          {tab === 'salary' && <SalaryTab me={me} isManager={isManager} accent={accent} t={t} />}
        </div>
      </div>

      {/* NOTIFICATIONS SHEET */}
      {showNotif && me.id && (
        <Sheet onClose={() => { setShowNotif(false); setUnread(0) }} t={t}>
          <div style={{ padding: '14px 16px 32px' }}>
            <div style={{ fontSize: 18, fontWeight: 700, textAlign: 'center', color: t.text, marginBottom: 16 }}>{tr('pe.notifications')}</div>
            <NotificationsTab myId={me.id} accent={accent} t={t} />
          </div>
        </Sheet>
      )}

      {/* NOTIFICATION SETTINGS SHEET */}
      {showNotifSettings && (
        <Sheet onClose={() => setShowNotifSettings(false)} t={t}>
          <div style={{ padding: '14px 16px 32px' }}>
            <div style={{ fontSize: 18, fontWeight: 700, textAlign: 'center', color: t.text, marginBottom: 16 }}>{tr('pe.nsTitle')}</div>
            <NotificationSettings me={me} isManager={isManager} accent={accent} t={t} />
          </div>
        </Sheet>
      )}

      {/* NAV: standalone — фикс-бар снизу; embedded — сегмент-строка над контентом */}
      <div style={embedded
        ? { order: 1, display: 'flex', gap: 2, background: t.fill, borderRadius: 12, padding: 3, marginBottom: 16, maxWidth: contentMaxWidth, width: '100%', alignSelf: 'center', boxSizing: 'border-box' as const }
        : { position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 300, height: 82, background: t.nbg, backdropFilter: 'saturate(200%) blur(24px)', WebkitBackdropFilter: 'saturate(200%) blur(24px)', borderTop: `0.5px solid ${t.sep2}`, display: 'flex', alignItems: 'flex-start', paddingTop: 10, paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
        {TABS.map(tb => (
          embedded ? (
            <button key={tb.id} onClick={() => setTab(tb.id)} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, padding: '8px 0', borderRadius: 10, border: 'none', fontFamily: 'inherit', fontSize: 13, fontWeight: tab === tb.id ? 700 : 500, cursor: 'pointer', background: tab === tb.id ? t.surface : 'transparent', color: tab === tb.id ? accent : t.text3, boxShadow: tab === tb.id ? t.sh2 : 'none', transition: 'all .18s' }}>
              {tb.label}
              {tb.id === 'ops' && newOrders > 0 && <span style={{ minWidth: 15, height: 15, borderRadius: 8, background: t.red, color: '#fff', fontSize: 9, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 3px' }}>{newOrders > 9 ? '9+' : newOrders}</span>}
            </button>
          ) : (
            <button key={tb.id} onClick={() => setTab(tb.id)} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, cursor: 'pointer', color: tab === tb.id ? accent : t.text3, border: 'none', background: 'none', fontFamily: 'inherit', padding: 0, fontSize: 10, fontWeight: tab === tb.id ? 700 : 500 }}>
              <span style={{ position: 'relative', transform: tab === tb.id ? 'scale(1.08)' : 'scale(1)', transition: 'transform .18s', display: 'flex' }}>
                {tb.icon(tab === tb.id)}
                {tb.id === 'ops' && newOrders > 0 && <span style={{ position: 'absolute', top: -3, right: -7, minWidth: 15, height: 15, borderRadius: 8, background: t.red, color: '#fff', fontSize: 9, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 3px' }}>{newOrders > 9 ? '9+' : newOrders}</span>}
              </span>
              {tb.label}
            </button>
          )
        ))}
      </div>

      {toast && (
        <div style={{ position: 'fixed', bottom: 100, left: '50%', transform: 'translateX(-50%)', background: t.dark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.85)', backdropFilter: 'blur(16px)', color: '#fff', padding: '12px 22px', borderRadius: 22, fontSize: 14, fontWeight: 600, zIndex: 600, whiteSpace: 'nowrap', animation: 'toastIn .25s ease' }}>{toast}</div>
      )}
    </div>
  )
}

// ── ROOT ─────────────────────────────────────────────────────────────────────────

export default function PeoplePage() {
  const [restaurantId, setRestaurantId] = useState<string | null>(null)
  if (!restaurantId) return <AuthGate appId="people" appName="Mise People" onAuth={setRestaurantId} />
  return <PeopleApp restaurantId={restaurantId} />
}
