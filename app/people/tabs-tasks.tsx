'use client'
import React, { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { db } from '@/lib/db'
import { notify as pushNotify } from '@/lib/notifyClient'
import { renderNotify, renderCategory, renderSegments } from '@/lib/notifyStrings'
import { useTheme } from '@/hooks/useTheme'
import { AuthGate } from '@/components/AuthGate'
import { AppSwitchBrand } from '@/components/AppSwitchBrand'
import { useI18n } from '@/lib/i18n'
import { fmtDate } from '@/lib/format'
import { tCurrent } from '@/lib/i18n'
import { ScheduleTab } from '@/components/people/ScheduleTab'
import { btnB2, inp, lbl, clock, hoursOf, fmtHours, HistoryList } from './shared'
import { mondayOf, addDays, hhmm, timeRange, dayLabel, navBtn, roleLabel, getMe, Sheet, Placeholder, DOW_SHORT, DOW_FULL, MON } from '@/components/people/helpers'


// Вкладка Задачи
// Распил page.tsx (Д2, 2026-07-18): секция вынесена без изменений логики.
// ── TASKS TAB ────────────────────────────────────────────────────────────────────

const PRIO: Record<string, { label: string; color: (t: any) => string }> = {
  low: { label: 'pe.prioLow', color: t => t.text3 },
  medium: { label: 'pe.prioMed', color: t => t.blue },
  high: { label: 'pe.prioHigh', color: t => t.red },
}
const STATUS_ORDER = ['todo', 'in_progress', 'done']
const STATUS_LABEL: Record<string, string> = { todo: 'pe.stTodo', in_progress: 'pe.stInProgress', done: 'pe.stDone' }

// order («Заказать») — раньше был только на iOS, notice («Замечание») — только на вебе:
// один и тот же тип заявки читался по-разному в зависимости от платформы (аудит 2026-08-04).
// Теперь оба набора объединены и одинаковы на обеих платформах.
const REPORT_TYPE: Record<string, { label: string; color: (t: any) => string }> = {
  breakdown: { label: 'pe.rtBreakdown', color: t => t.red },
  notice: { label: 'pe.rtNotice', color: t => t.orange },
  order: { label: 'pe.rtOrder', color: t => t.green },
  suggestion: { label: 'pe.rtSuggestion', color: t => t.blue },
  other: { label: 'pe.rtOther', color: t => t.text3 },
}
const REPORT_STATUS: Record<string, string> = { new: 'pe.rsNew', reviewed: 'pe.rsReviewed', resolved: 'pe.rsResolved' }

export function TasksTab({ isManager, myId, accent, t, toast }: { isManager: boolean; myId: string; accent: string; t: any; toast: (m: string) => void }) {
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
      db.from('staff_tasks').select('*').order('created_at', { ascending: false }).limit(200),
      // Лимиты на растущие таблицы (ревью Д1): свежие 200 достаточно для рабочего списка.
      db.from('staff_reports').select('*').order('created_at', { ascending: false }).limit(200),
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
    const results = await Promise.all(targets.map(tid => db.from('staff_tasks').insert({ ...base, assigned_to: tid })))
    setSaving(false)
    // Раньше ошибка сети/сервера тут не проверялась вообще — форма закрывалась, будто всё
    // создалось. Если провалились ВСЕ адресаты — не закрываем форму, юзер видит ошибку и не
    // теряет ввод. Частичный сбой (часть цеха создалась, часть нет) остаётся мягким случаем —
    // низкая вероятность/impact, список просто покажет то, что реально создалось.
    if (results.every(r => r.error)) { toast(tr('dash.notSaved') + results[0].error?.message); return }
    const notifyIds = targets.filter(tid => tid !== myId)
    if (notifyIds.length) pushNotify({ type: 'task', title: 'New task', body: form.title.trim(), titleKey: 'notify.newTaskTitle', audience: { staff_ids: notifyIds } })
    setShowForm(false); setForm({ title: '', description: '', assigned_to: '', priority: 'medium', due_date: '' })
    toast(targets.length > 1 ? tr('pe.taskCreatedFor', { n: targets.length }) : tr('pe.taskCreated')); await load()
  }
  const setStatus = async (task: any, status: string) => {
    const prevStatus = task.status
    setTasks(ts => ts.map(x => x.id === task.id ? { ...x, status } : x))
    const { error } = await db.from('staff_tasks').update({ status, completed_at: status === 'done' ? new Date().toISOString() : null }).eq('id', task.id)
    if (error) { setTasks(ts => ts.map(x => x.id === task.id ? { ...x, status: prevStatus } : x)); toast(tr('dash.notSaved') + error.message) }
  }
  const removeTask = async (id: string) => {
    const removed = tasks.find(x => x.id === id)
    setTasks(ts => ts.filter(x => x.id !== id))
    const { error } = await db.from('staff_tasks').delete().eq('id', id)
    if (error && removed) { setTasks(ts => [...ts, removed]); toast(tr('dash.notSaved') + error.message) }
  }
  const canDelete = (task: any) => isManager || task.created_by === myId

  const createReport = async () => {
    if (!rform.title.trim()) { toast(tr('pe.describeProblem')); return }
    setSaving(true)
    const { error } = await db.from('staff_reports').insert({ type: rform.type, title: rform.title.trim(), description: rform.description.trim() || null, author_id: myId === 'owner' ? null : myId, status: 'new' })
    setSaving(false)
    if (error) { toast(tr('dash.notSaved') + error.message); return }
    setShowForm(false); setRform({ type: 'breakdown', title: '', description: '' })
    toast(tr('pe.reportSent')); await load()
  }
  const setReportStatus = async (r: any, status: string) => {
    const prevStatus = r.status
    setReports(rs => rs.map(x => x.id === r.id ? { ...x, status } : x))
    const { error } = await db.from('staff_reports').update({ status, resolved_at: status === 'resolved' ? new Date().toISOString() : null }).eq('id', r.id)
    if (error) { setReports(rs => rs.map(x => x.id === r.id ? { ...x, status: prevStatus } : x)); toast(tr('dash.notSaved') + error.message) }
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
                        {task.due_date && (
                          // Просрочка — красным и жирным (corrective action, ревью Б5).
                          <span style={{ fontSize: 11, color: task.status !== 'done' && task.due_date < fmtDate(new Date()) ? t.red : t.orange, fontWeight: task.status !== 'done' && task.due_date < fmtDate(new Date()) ? 700 : 400 }}>· {tr('pe.dueBy')} {dayLabel(task.due_date)}</span>
                        )}
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

