'use client'
export const dynamic = 'force-dynamic'
import React, { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { db } from '@/lib/db'
import { useTheme } from '@/hooks/useTheme'
import { AuthGate } from '@/components/AuthGate'
import { AppSwitchBrand } from '@/components/AppSwitchBrand'
import { useI18n } from '@/lib/i18n'

// ── HELPERS ───────────────────────────────────────────────────────────────────

function fmtDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const DOW_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
const DOW_FULL = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота']
const MON = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']

function mondayOf(d: Date) {
  const x = new Date(d); const day = x.getDay()
  x.setDate(x.getDate() - (day === 0 ? 6 : day - 1)); x.setHours(0, 0, 0, 0)
  return x
}
function addDays(d: Date, n: number) { const x = new Date(d); x.setDate(x.getDate() + n); return x }
function hhmm(t: string | null) { return t ? t.slice(0, 5) : '' }
function timeRange(a: string | null, b: string | null) {
  if (!a) return ''
  return `${hhmm(a)}${b ? '–' + hhmm(b) : ''}`
}
function dayLabel(dateStr: string) {
  const d = new Date(dateStr + 'T00:00:00')
  return `${d.getDate()} ${MON[d.getMonth()]}`
}

// ── ROLE HELPER ───────────────────────────────────────────────────────────────

function getMe(rid: string): { id?: string; name?: string; role?: string; is_owner?: boolean } {
  try { return JSON.parse(localStorage.getItem('mise_staff_' + rid) || '{}') } catch { return {} }
}

// ── ASSIGN SHIFT SHEET ──────────────────────────────────────────────────────────

function Sheet({ children, onClose, t }: { children: React.ReactNode; onClose: () => void; t: any }) {
  // Портал в body: шторка выходит из stacking-context контента (position:fixed + overflow
  // + анимация родителя ловили её, и кнопки уезжали под нижний бар). Теперь — поверх всего.
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])
  if (!mounted) return null
  return createPortal(
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }} onClick={onClose}>
      <div style={{ background: t.bg, borderRadius: '24px 24px 0 0', width: '100%', maxWidth: 480, maxHeight: '88dvh', overflowY: 'auto', paddingBottom: 'calc(16px + env(safe-area-inset-bottom, 0px))' }} onClick={e => e.stopPropagation()}>
        <div style={{ width: 40, height: 4, background: t.fill, borderRadius: 2, margin: '14px auto 0' }} />
        {children}
      </div>
    </div>,
    document.body
  )
}

// ── SCHEDULE TAB (manager) ──────────────────────────────────────────────────────

function ScheduleTab({ restaurantId, accent, t, toast }: { restaurantId: string; accent: string; t: any; toast: (m: string) => void }) {
  const { t: tr, locale } = useI18n()
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()))
  const [selected, setSelected] = useState(() => fmtDate(new Date()))
  const [staff, setStaff] = useState<any[]>([])
  const [schedules, setSchedules] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [edit, setEdit] = useState<{ staff: any; date: string } | null>(null)
  const [start, setStart] = useState(''); const [end, setEnd] = useState(''); const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
  const weekStartStr = fmtDate(weekStart); const weekEndStr = fmtDate(addDays(weekStart, 6))

  const load = async () => {
    setLoading(true)
    const [{ data: st }, { data: sc }] = await Promise.all([
      db.from('staff_directory').select('*').eq('is_active', true).order('name'),
      db.from('staff_schedules').select('*').gte('date', weekStartStr).lte('date', weekEndStr),
    ])
    setStaff(st || []); setSchedules(sc || []); setLoading(false)
  }
  useEffect(() => { load() }, [weekStartStr])

  const schedFor = (staffId: string, date: string) => schedules.find(s => s.staff_id === staffId && s.date === date)
  const dayHasShifts = (date: string) => schedules.some(s => s.date === date)

  const openEdit = (s: any, date: string) => {
    const ex = schedFor(s.id, date)
    setStart(hhmm(ex?.shift_start) || '10:00'); setEnd(hhmm(ex?.shift_end) || '22:00'); setNote(ex?.note || '')
    setEdit({ staff: s, date })
  }

  const saveShiftAssign = async () => {
    if (!edit) return
    setSaving(true)
    await db.from('staff_schedules').upsert(
      { staff_id: edit.staff.id, date: edit.date, shift_start: start || null, shift_end: end || null, note: note || null, published: false },
      { onConflict: 'restaurant_id,staff_id,date' }
    )
    setSaving(false); setEdit(null); toast(tr('pe.shiftAssigned')); await load()
  }
  const clearShift = async () => {
    if (!edit) return
    setSaving(true)
    await db.from('staff_schedules').delete().eq('staff_id', edit.staff.id).eq('date', edit.date)
    setSaving(false); setEdit(null); toast(tr('pe.shiftRemoved')); await load()
  }
  const publishWeek = async () => {
    await db.from('staff_schedules').update({ published: true }).gte('date', weekStartStr).lte('date', weekEndStr)
    toast(tr('pe.weekPublished')); await load()
  }

  const unpublishedCount = schedules.filter(s => !s.published).length

  // Быстрый выбор: сначала диапазоны, уже используемые в заведении, затем типовые дефолты.
  const shiftPresets: [string, string][] = (() => {
    const used = schedules.filter(s => s.shift_start && s.shift_end).map(s => [hhmm(s.shift_start), hhmm(s.shift_end)] as [string, string])
    const defaults: [string, string][] = [['10:00', '22:00'], ['12:00', '00:00'], ['09:00', '18:00'], ['18:00', '02:00']]
    const seen = new Set<string>(); const out: [string, string][] = []
    for (const [s, e] of [...used, ...defaults]) { const k = `${s}-${e}`; if (s && e && !seen.has(k)) { seen.add(k); out.push([s, e]) } }
    return out.slice(0, 6)
  })()

  return (
    <div>
      {/* Week nav */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, background: t.surface, borderRadius: 16, padding: '12px 14px', marginBottom: 12, boxShadow: t.sh }}>
        <button onClick={() => setWeekStart(addDays(weekStart, -7))} style={navBtn(t)}><svg width="9" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" viewBox="0 0 10 18"><path d="M8 1L1 9l7 8" /></svg></button>
        <div style={{ flex: 1, textAlign: 'center', fontSize: 15, fontWeight: 700, color: t.text }}>
          {weekDays[0].getDate()} {MON[weekDays[0].getMonth()]} — {weekDays[6].getDate()} {MON[weekDays[6].getMonth()]}
        </div>
        <button onClick={() => setWeekStart(addDays(weekStart, 7))} style={navBtn(t)}><svg width="9" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" viewBox="0 0 10 18"><path d="M2 1l7 8-7 8" /></svg></button>
      </div>

      {/* Day pills */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 6, marginBottom: 16 }}>
        {weekDays.map((d, i) => {
          const ds = fmtDate(d); const active = ds === selected; const today = ds === fmtDate(new Date())
          return (
            <button key={ds} onClick={() => setSelected(ds)} style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, padding: '8px 0', borderRadius: 12, border: 'none', cursor: 'pointer', fontFamily: 'inherit',
              background: active ? accent : t.surface, boxShadow: active ? `0 4px 12px ${accent}44` : t.sh,
            }}>
              <span style={{ fontSize: 10, fontWeight: 600, color: active ? 'rgba(255,255,255,.7)' : t.text3 }}>{DOW_SHORT[i]}</span>
              <span style={{ fontSize: 16, fontWeight: 700, color: active ? '#fff' : (today ? accent : t.text) }}>{d.getDate()}</span>
              <span style={{ width: 4, height: 4, borderRadius: '50%', background: dayHasShifts(ds) ? (active ? '#fff' : accent) : 'transparent' }} />
            </button>
          )
        })}
      </div>

      {/* Staff list for selected day */}
      <div style={{ fontSize: 12, fontWeight: 600, color: t.text3, textTransform: 'uppercase', letterSpacing: 0.5, padding: '4px 4px 8px' }}>
        {DOW_FULL[new Date(selected + 'T00:00:00').getDay()]}, {dayLabel(selected)}
      </div>
      {loading ? (
        <div style={{ textAlign: 'center', padding: 40, color: t.text3 }}>{tr('pe.loading')}</div>
      ) : staff.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px 20px', color: t.text3 }}>{tr('pe.noStaffAddAccess')}</div>
      ) : (
        <div style={{ background: t.surface, borderRadius: 16, overflow: 'hidden', boxShadow: t.sh, marginBottom: 16 }}>
          {staff.map((s, i) => {
            const sc = schedFor(s.id, selected)
            return (
              <button key={s.id} onClick={() => openEdit(s, selected)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: 'inherit', borderBottom: i < staff.length - 1 ? `0.5px solid ${t.sep2}` : 'none', textAlign: 'left' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 15, color: t.text, fontWeight: 500 }}>{s.name}</div>
                  <div style={{ fontSize: 12, color: t.text3, marginTop: 2 }}>{tr(roleLabel(s.role))}</div>
                </div>
                {sc ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: accent }}>{timeRange(sc.shift_start, sc.shift_end) || tr('pe.shiftWord')}</span>
                    {!sc.published && <span style={{ fontSize: 9, fontWeight: 700, color: t.orange, background: `${t.orange}1a`, padding: '2px 6px', borderRadius: 6 }}>{tr('pe.draft')}</span>}
                  </div>
                ) : (
                  <span style={{ fontSize: 13, color: t.text4 }}>{tr('pe.dayOff')}</span>
                )}
              </button>
            )
          })}
        </div>
      )}

      {unpublishedCount > 0 && (
        <button onClick={publishWeek} style={{ width: '100%', padding: '15px', borderRadius: 16, background: accent, color: '#fff', border: 'none', fontFamily: 'inherit', fontSize: 15, fontWeight: 700, cursor: 'pointer', boxShadow: `0 4px 16px ${accent}44` }}>
          {tr('pe.publishWeek')} · {unpublishedCount} {locale === 'ru' ? (unpublishedCount === 1 ? 'смена' : 'смен') : tr('pe.shiftsWord')}
        </button>
      )}

      {edit && (
        <Sheet onClose={() => setEdit(null)} t={t}>
          <div style={{ padding: '14px 20px 32px' }}>
            <div style={{ fontSize: 18, fontWeight: 700, textAlign: 'center', color: t.text, marginBottom: 4 }}>{edit.staff.name}</div>
            <div style={{ fontSize: 13, color: t.text3, textAlign: 'center', marginBottom: 16 }}>{DOW_FULL[new Date(edit.date + 'T00:00:00').getDay()]}, {dayLabel(edit.date)}</div>

            {/* Быстрый выбор смены — типовые диапазоны заведения в один тап */}
            {shiftPresets.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14, justifyContent: 'center' }}>
                {shiftPresets.map(([s, e]) => {
                  const on = start === s && end === e
                  return (
                    <button key={`${s}-${e}`} onClick={() => { setStart(s); setEnd(e) }} style={{
                      padding: '8px 13px', borderRadius: 980, cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: 600,
                      border: `1px solid ${on ? accent : t.sep2}`, background: on ? accent : t.surface, color: on ? '#fff' : t.text2,
                    }}>{s}–{e}</button>
                  )
                })}
              </div>
            )}

            <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
              {[{ l: tr('pe.start'), v: start, set: setStart }, { l: tr('pe.end'), v: end, set: setEnd }].map(f => (
                <div key={f.l} style={{ flex: 1 }}>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: t.text3, textTransform: 'uppercase', letterSpacing: .4, marginBottom: 6 }}>{f.l}</label>
                  <input type="time" value={f.v} onChange={e => f.set(e.target.value)} style={{ width: '100%', padding: '12px 14px', borderRadius: 12, border: `1px solid ${t.sep2}`, fontSize: 16, color: t.text, background: t.surface, fontFamily: 'inherit', outline: 'none' }} />
                </div>
              ))}
            </div>
            <input value={note} onChange={e => setNote(e.target.value)} placeholder={tr('pe.notePh')} style={{ width: '100%', padding: '12px 14px', borderRadius: 12, border: `1px solid ${t.sep2}`, fontSize: 15, color: t.text, background: t.surface, fontFamily: 'inherit', outline: 'none', marginBottom: 16 }} />
            <div style={{ display: 'flex', gap: 10 }}>
              {schedFor(edit.staff.id, edit.date) && (
                <button onClick={clearShift} disabled={saving} style={{ padding: '14px 18px', borderRadius: 14, border: 'none', background: `${t.red}18`, color: t.red, fontFamily: 'inherit', fontSize: 15, fontWeight: 600, cursor: 'pointer' }}>{tr('pe.remove')}</button>
              )}
              <button onClick={saveShiftAssign} disabled={saving} style={{ flex: 1, padding: '14px', borderRadius: 14, border: 'none', background: accent, color: '#fff', fontFamily: 'inherit', fontSize: 15, fontWeight: 700, cursor: 'pointer', boxShadow: `0 4px 16px ${accent}44` }}>
                {saving ? '...' : tr('pe.save')}
              </button>
            </div>
          </div>
        </Sheet>
      )}
    </div>
  )
}

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
              <div style={{ fontSize: 11, color: t.text3, marginTop: 2 }}>{MON[new Date(s.date + 'T00:00:00').getMonth()]}</div>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 16, fontWeight: 700, color: t.text }}>{timeRange(s.shift_start, s.shift_end) || tr('pe.shiftWord')}</span>
                {when && <span style={{ fontSize: 10, fontWeight: 700, color: accent, background: `${accent}1a`, padding: '2px 8px', borderRadius: 8 }}>{when.toUpperCase()}</span>}
              </div>
              <div style={{ fontSize: 12, color: t.text3, marginTop: 3 }}>{DOW_FULL[new Date(s.date + 'T00:00:00').getDay()]}{s.note ? ` · ${s.note}` : ''}</div>
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
    await Promise.all(targets.map(async tid => {
      await db.from('staff_tasks').insert({ ...base, assigned_to: tid })
      if (tid !== myId) await db.from('notifications').insert({ staff_id: tid, type: 'task', title: 'Новая задача', body: form.title.trim() })
    }))
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

  const notify = (staffId: string, type: string, title: string, body: string) =>
    db.from('notifications').insert({ staff_id: staffId, type, title, body })
  const now = () => new Date().toISOString()

  const create = async () => {
    if (!form.schedule_id || !form.target_id) { toast(tr('pe.selectShiftColleague')); return }
    setSaving(true)
    const sc = sched(form.schedule_id)
    await db.from('shift_swap_requests').insert({
      schedule_id: form.schedule_id, requester_id: myId, target_id: form.target_id,
      status: 'pending_peer', note: form.note || null,
    })
    await notify(form.target_id, 'swap_request', 'Запрос на обмен', `${me.name || 'Коллега'} предлагает обмен сменой ${sc ? dayLabel(sc.date) : ''}`)
    setSaving(false); setShowForm(false); setForm({ schedule_id: '', target_id: '', note: '' })
    toast(tr('pe.reportSent')); await load()
  }

  const setStatus = async (r: any, patch: any) => {
    await db.from('shift_swap_requests').update(patch).eq('id', r.id)
    await load()
  }
  const peerDecline = async (r: any) => {
    await db.from('shift_swap_requests').update({ status: 'peer_declined', peer_responded_at: now() }).eq('id', r.id)
    await notify(r.requester_id, 'swap_result', 'Обмен отклонён', 'Коллега отклонил запрос на обмен')
    await load()
  }
  const managerReject = async (r: any) => {
    await db.from('shift_swap_requests').update({ status: 'rejected', manager_id: me.is_owner ? null : myId, manager_responded_at: now() }).eq('id', r.id)
    await notify(r.requester_id, 'swap_result', 'Обмен отклонён', 'Менеджер отклонил обмен')
    await load()
  }
  const approve = async (r: any) => {
    // Reassign the shift to the target, then mark approved.
    await db.from('staff_schedules').update({ staff_id: r.target_id }).eq('id', r.schedule_id)
    await db.from('shift_swap_requests').update({ status: 'approved', manager_id: me.is_owner ? null : myId, manager_responded_at: now() }).eq('id', r.id)
    await notify(r.requester_id, 'swap_result', 'Обмен одобрен', 'Смена переназначена коллеге')
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
            <button onClick={() => setStatus(r, { status: 'peer_accepted', peer_responded_at: now() })} style={btnA(accent)}>{tr('pe.accept')}</button>
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
function fmtHours(h: number) {
  const H = Math.floor(h); const M = Math.round((h - H) * 60)
  return M ? `${H} ч ${M} м` : `${H} ч`
}

function distMeters(la1: number, lo1: number, la2: number, lo2: number) {
  const R = 6371000, toR = Math.PI / 180
  const dLa = (la2 - la1) * toR, dLo = (lo2 - lo1) * toR
  const a = Math.sin(dLa / 2) ** 2 + Math.cos(la1 * toR) * Math.cos(la2 * toR) * Math.sin(dLo / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}
function clock(iso: string | null) { return iso ? new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '' }

function AttendanceTab({ me, isManager, accent, t, toast }: { me: any; isManager: boolean; accent: string; t: any; toast: (m: string) => void }) {
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
            <div style={{ fontSize: 12, fontWeight: 600, color: t.text3, textTransform: 'uppercase', letterSpacing: 0.5, padding: '12px 4px 8px' }}>{tr('pe.monthStats')}</div>
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
                      <div style={{ fontSize: 12, color: t.text3, marginTop: 2 }}>{recs.length} {tr('pe.shiftsWord')} · {fmtHours(hours)}</div>
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
                { l: tr('pe.hours'), v: fmtHours(hours), c: t.green },
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
  const monthLabel = new Date().toLocaleDateString('ru-RU', { month: 'long' })
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState<any[]>([])
  const [open, setOpen] = useState<string | null>(null)

  const load = async () => {
    const monthStart = ym + '-01'
    const [{ data: emps }, { data: abs }, { data: cards }, { data: att }, { data: dir }] = await Promise.all([
      db.from('employees').select('id, name, salary, deduct_per_absence, card_amount').eq('is_active', true).order('name'),
      db.from('shift_absences').select('employee_id, date').gte('date', monthStart),
      db.from('monthly_card_amounts').select('employee_id, card_amount').eq('month', ym),
      db.from('attendance_records').select('staff_id, check_in_at, check_out_at, date').gte('date', monthStart),
      db.from('staff_directory').select('id, name').eq('is_active', true),
    ])
    const staffName: Record<string, string> = {}; (dir || []).forEach((s: any) => { staffName[s.id] = s.name })
    const hoursByName: Record<string, number> = {}
    ;(att || []).forEach((r: any) => { const n = staffName[r.staff_id]; if (n) hoursByName[n] = (hoursByName[n] || 0) + hoursOf(r) })
    // Помесячная сумма на карту перекрывает фиксированную (employees.card_amount).
    const cardByEmp: Record<string, number> = {}; (cards || []).forEach((c: any) => { cardByEmp[c.employee_id] = Number(c.card_amount || 0) })
    const absByEmp: Record<string, string[]> = {}; (abs || []).forEach((a: any) => { (absByEmp[a.employee_id] = absByEmp[a.employee_id] || []).push(a.date) })

    let list = (emps || []).map((e: any) => {
      const salary = Number(e.salary || 0)
      const dates = (absByEmp[e.id] || []).sort()
      const deduct = dates.length * Number(e.deduct_per_absence || 0)
      const card = e.id in cardByEmp ? cardByEmp[e.id] : Number(e.card_amount || 0)
      const total = Math.max(0, salary - deduct)
      return { id: e.id, name: e.name, salary, dates, absences: dates.length, deduct, card, total, cash: Math.max(0, total - card), hours: hoursByName[e.name] || 0 }
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
        { _l: tr('pe.worked'), v: fmtHours(r.hours), c: t.text2, hide: r.hours <= 0 },
        { _l: tr('pe.absencesN', { n: r.absences }), v: r.dates.map(absDate).join(', '), c: t.text2, small: true, hide: r.absences === 0 },
        { _l: tr('pe.absenceDeduct'), v: `−${eur(r.deduct)}`, c: t.red, hide: r.deduct === 0 },
        { _l: tr('pe.toCard'), v: eur(r.card), c: t.blue, hide: r.card === 0 },
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
  const { t: tr } = useI18n()
  const [items, setItems] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

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
            <div style={{ fontSize: 15, fontWeight: 600, color: t.text }}>{n.title}</div>
            {n.body && <div style={{ fontSize: 13, color: t.text3, marginTop: 2 }}>{n.body}</div>}
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
                    : <span style={{ fontSize: 11, fontWeight: 700, color: t.green }}>✓</span>}
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

// ── CHECKLISTS (открытие/закрытие зала) ─────────────────────────────────────────

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

function ChecklistsView({ isManager, myId, myRole, accent, t, toast }: { isManager: boolean; myId: string; myRole?: string; accent: string; t: any; toast: (m: string) => void }) {
  const { t: tr } = useI18n()
  const today = fmtDate(new Date())
  const [type, setType] = useState<'open' | 'close'>('open')
  const [lists, setLists] = useState<any[]>([])         // shift_checklists (шаблоны open/close × цех)
  const [completions, setCompletions] = useState<any[]>([]) // выполнение за сегодня
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<{ id?: string; role: string | null; items: string[] } | null>(null)
  const [saving, setSaving] = useState(false)

  const load = async () => {
    const [{ data: cl }, { data: cm }] = await Promise.all([
      db.from('shift_checklists').select('*'),
      db.from('shift_checklist_completions').select('*').eq('date', today),
    ])
    setLists(cl || []); setCompletions(cm || []); setLoading(false)
  }
  useEffect(() => { load() }, [])

  // Сотрудник видит общие (role=null) + по своей роли; менеджер — все цеха.
  const relevant = lists.filter(l => l.type === type && (isManager || !l.role || l.role === myRole))

  const toggleItem = async (list: any, idx: number) => {
    const items: string[] = Array.isArray(list.items) ? list.items : []
    const completion = completions.find(c => c.checklist_id === list.id)
    const state: boolean[] = Array.isArray(completion?.items_state) ? completion.items_state : []
    const next = items.map((_, i) => (i === idx ? !state[i] : !!state[i]))
    const allDone = next.every(Boolean)
    setCompletions(cs => {
      const ex = cs.find(c => c.checklist_id === list.id)
      if (ex) return cs.map(c => c.checklist_id === list.id ? { ...c, items_state: next } : c)
      return [...cs, { checklist_id: list.id, date: today, items_state: next }]
    })
    if (completion?.id) {
      await db.from('shift_checklist_completions').update({ items_state: next, completed_at: allDone ? new Date().toISOString() : null }).eq('id', completion.id)
    } else {
      await db.from('shift_checklist_completions').insert({ checklist_id: list.id, date: today, staff_id: myId === 'owner' || !myId ? null : myId, items_state: next, completed_at: allDone ? new Date().toISOString() : null })
      await load() // получить id созданной записи
    }
    if (allDone) toast(type === 'open' ? tr('pe.openDone') : tr('pe.closeDone'))
  }

  const saveTemplate = async () => {
    if (!editing) return
    const clean = editing.items.map(s => s.trim()).filter(Boolean)
    if (clean.length === 0) { toast(tr('pe.addAtLeastOneItem')); return }
    setSaving(true)
    if (editing.id) await db.from('shift_checklists').update({ items: clean, role: editing.role }).eq('id', editing.id)
    else await db.from('shift_checklists').insert({ type, items: clean, role: editing.role })
    setSaving(false); setEditing(null); toast(tr('pe.checklistSaved')); await load()
  }
  const removeList = async (id: string) => {
    setLists(ls => ls.filter(l => l.id !== id))
    await db.from('shift_checklists').delete().eq('id', id)
  }

  if (loading) return <div style={{ textAlign: 'center', padding: 40, color: t.text3 }}>{tr('pe.loading')}</div>

  return (
    <div>
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
        const items: string[] = Array.isArray(list.items) ? list.items : []
        const completion = completions.find(c => c.checklist_id === list.id)
        const state: boolean[] = Array.isArray(completion?.items_state) ? completion.items_state : []
        const doneCount = items.filter((_, i) => state[i]).length
        return (
          <div key={list.id} style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 4px 10px', gap: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: list.role ? accent : t.text3, textTransform: 'uppercase', letterSpacing: 0.5 }}>{list.role ? tr(roleLabel(list.role)) : tr('pe.general')} · {doneCount}/{items.length}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {doneCount === items.length && items.length > 0 && <span style={{ fontSize: 11, fontWeight: 700, color: t.green, background: `${t.green}1a`, padding: '3px 9px', borderRadius: 8 }}>{tr('pe.doneCaps')}</span>}
                {isManager && (
                  <>
                    <button onClick={() => setEditing({ id: list.id, role: list.role ?? null, items: items.length ? [...items] : [''] })} style={{ background: 'none', border: 'none', color: accent, cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, fontWeight: 600, padding: 0 }}>{tr('pe.edit')}</button>
                    <button onClick={() => removeList(list.id)} style={{ background: 'none', border: 'none', color: t.text4, cursor: 'pointer', padding: 0, display: 'flex' }}>
                      <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" /></svg>
                    </button>
                  </>
                )}
              </div>
            </div>
            <div style={{ background: t.surface, borderRadius: 16, overflow: 'hidden', boxShadow: t.sh }}>
              {items.map((text, i) => (
                <button key={i} onClick={() => toggleItem(list, i)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '13px 16px', border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', borderBottom: i < items.length - 1 ? `0.5px solid ${t.sep2}` : 'none' }}>
                  <span style={{ width: 22, height: 22, borderRadius: '50%', border: `2px solid ${state[i] ? accent : t.sep}`, background: state[i] ? accent : 'transparent', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {state[i] && <svg width="11" height="11" fill="none" stroke="#fff" strokeWidth="3" viewBox="0 0 24 24"><path d="M5 13l4 4L19 7" /></svg>}
                  </span>
                  <span style={{ fontSize: 15, color: t.text, textDecoration: state[i] ? 'line-through' : 'none', opacity: state[i] ? 0.55 : 1 }}>{text}</span>
                </button>
              ))}
            </div>
          </div>
        )
      })}

      {isManager && (
        <button onClick={() => setEditing({ role: null, items: [''] })} style={{ width: '100%', padding: '13px', borderRadius: 14, border: `1.5px dashed ${t.sep}`, background: 'transparent', color: accent, fontFamily: 'inherit', fontSize: 14, fontWeight: 600, cursor: 'pointer', marginTop: 4 }}>
          {tr('pe.addChecklistForRole')}
        </button>
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

function OpsTab({ me, isManager, accent, t, toast }: { me: any; isManager: boolean; accent: string; t: any; toast: (m: string) => void }) {
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
      {view === 'check' && <ChecklistsView isManager={isManager} myId={me.id || ''} myRole={me.role} accent={accent} t={t} toast={toast} />}
      {view === 'tech' && canTech && <TechCardsView isManager={isManager} accent={accent} t={t} toast={toast} />}
    </div>
  )
}

// ── PLACEHOLDER ──────────────────────────────────────────────────────────────────

function Placeholder({ title, sub, accent, t, icon }: { title: string; sub: string; accent: string; t: any; icon: React.ReactNode }) {
  return (
    <div style={{ textAlign: 'center', padding: '60px 20px', color: t.text3 }}>
      <div style={{ width: 72, height: 72, borderRadius: 20, background: `${accent}14`, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', color: accent }}>{icon}</div>
      <div style={{ fontWeight: 700, fontSize: 18, color: t.text }}>{title}</div>
      <div style={{ fontSize: 14, marginTop: 6, maxWidth: 260, marginInline: 'auto', lineHeight: 1.5 }}>{sub}</div>
    </div>
  )
}

// ── HELPERS (styles) ─────────────────────────────────────────────────────────────

function navBtn(t: any): React.CSSProperties {
  return { width: 36, height: 36, borderRadius: '50%', background: t.fill, border: 'none', color: t.text, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }
}
function roleLabel(role?: string) {
  const m: Record<string, string> = { kitchen: 'pe.roleKitchen', bar: 'pe.roleBar', hookah: 'pe.roleHookah', waiter: 'pe.roleWaiter', manager: 'pe.roleManager', host: 'pe.roleHost', cleaner: 'pe.roleCleaner', admin: 'pe.roleAdmin' }
  return role ? (m[role] || role) : '—'
}

// ── SHIFTS HUB (Смены/Расписание + Явка + Обмены в одной вкладке) ───────────────
// IA: вместо трёх вкладок в баре — один раздел с внутренним сегментом. «Я пришёл»
// (чек-ин) живёт в «Явке», обмены сменами — рядом, расписание/мои смены — основной вид.
function ShiftsHub({ me, isManager, restaurantId, accent, t, toast }: { me: any; isManager: boolean; restaurantId: string; accent: string; t: any; toast: (m: string) => void }) {
  const { t: tr } = useI18n()
  const [view, setView] = useState<'shifts' | 'attendance' | 'swaps'>('shifts')
  const views: [string, string][] = [
    ['shifts', isManager ? tr('pe.schedule') : tr('pe.myShifts')],
    ['attendance', tr('pe.attendance')],
    ['swaps', tr('pe.swaps')],
  ]
  return (
    <div>
      <div style={{ display: 'flex', background: t.fill, borderRadius: 12, padding: 3, marginBottom: 16, gap: 2 }}>
        {views.map(([id, label]) => (
          <button key={id} onClick={() => setView(id as any)} style={{ flex: 1, padding: '8px 0', borderRadius: 10, border: 'none', fontFamily: 'inherit', fontSize: 13, fontWeight: view === id ? 700 : 500, cursor: 'pointer', background: view === id ? t.surface : 'transparent', color: view === id ? accent : t.text3, boxShadow: view === id ? t.sh2 : 'none' }}>{label}</button>
        ))}
      </div>
      {view === 'shifts' && (isManager
        ? <ScheduleTab restaurantId={restaurantId} accent={accent} t={t} toast={toast} />
        : <MyShiftsTab myId={me.id || ''} accent={accent} t={t} />)}
      {view === 'attendance' && <AttendanceTab me={me} isManager={isManager} accent={accent} t={t} toast={toast} />}
      {view === 'swaps' && <SwapsTab me={me} isManager={isManager} accent={accent} t={t} toast={toast} />}
    </div>
  )
}

// ── MAIN ─────────────────────────────────────────────────────────────────────────

function PeopleApp({ restaurantId }: { restaurantId: string }) {
  const { t: tr } = useI18n()
  const router = useRouter()
  const t = useTheme('mise_people_dark')
  const accent = t.dark ? '#5e5ce6' : '#5856d6'
  const me = getMe(restaurantId)
  const isManager = !!me.is_owner || me.role === 'manager'
  const [tab, setTab] = useState<string>('shifts')
  const [toast, setToast] = useState('')
  const [showNotif, setShowNotif] = useState(false)
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
    <div style={{ minHeight: '100vh', background: t.bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
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
    { id: 'salary', label: tr('pe.salaryTab'), icon: (a: boolean) => <svg fill="none" stroke="currentColor" strokeWidth={a ? 2.2 : 1.8} viewBox="0 0 24 24" width="25" height="25"><rect x="2" y="6" width="20" height="13" rx="2.5" /><path d="M2 10h20" /><circle cx="17.5" cy="14.5" r="1.4" fill="currentColor" stroke="none" /></svg> },
  ]

  return (
    <div style={{ height: '100vh', overflow: 'hidden', background: t.bg, fontFamily: "-apple-system,BlinkMacSystemFont,'SF Pro Text',sans-serif", WebkitFontSmoothing: 'antialiased', color: t.text }}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}} @keyframes fadeUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}} @keyframes toastIn{from{opacity:0;transform:translateX(-50%) translateY(10px)}to{opacity:1;transform:translateX(-50%) translateY(0)}} *{box-sizing:border-box} input[type=time]{ -webkit-appearance:none }`}</style>

      {/* HEADER */}
      <div style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 300, height: 56, background: t.hbg, backdropFilter: 'saturate(200%) blur(24px)', WebkitBackdropFilter: 'saturate(200%) blur(24px)', borderBottom: `0.5px solid ${t.sep2}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <AppSwitchBrand name="People" accent={accent} color={t.text} muted={t.text3} size={18} />
          <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: 0.4, color: accent, background: `${accent}1a`, padding: '2px 6px', borderRadius: 6, textTransform: 'uppercase' }}>Beta</span>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {me.id && (
            <button onClick={() => setShowNotif(true)} style={{ position: 'relative', width: 36, height: 36, borderRadius: '50%', background: t.fill, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: t.text }}>
              <svg width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M18 8a6 6 0 00-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 01-3.4 0" /></svg>
              {unread > 0 && <span style={{ position: 'absolute', top: 2, right: 2, minWidth: 16, height: 16, borderRadius: 8, background: t.red, color: '#fff', fontSize: 10, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px' }}>{unread > 9 ? '9+' : unread}</span>}
            </button>
          )}
          <button onClick={t.toggle} style={{ width: 36, height: 36, borderRadius: '50%', background: t.fill, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: t.text }}>
            {t.dark
              ? <svg width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="5" /><path d="M12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" /></svg>
              : <svg width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M21 12.8A9 9 0 1111.2 3 7 7 0 0021 12.8z" /></svg>}
          </button>
          <button onClick={() => supabase.auth.signOut().then(() => { localStorage.removeItem('mise_restaurant_id'); router.replace('/auth/login') })} style={{ width: 36, height: 36, borderRadius: '50%', background: `${t.red}18`, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="16" height="16" fill="none" stroke={t.red} strokeWidth="2" viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" /></svg>
          </button>
        </div>
      </div>

      {/* CONTENT */}
      <div style={{ position: 'fixed', top: 56, left: 0, right: 0, bottom: 82, overflowY: 'auto', background: t.bg }}>
        <div style={{ padding: '16px 16px 28px', maxWidth: 640, margin: '0 auto', animation: 'fadeUp .22s ease' }}>
          {tab === 'shifts' && <ShiftsHub me={me} isManager={isManager} restaurantId={restaurantId} accent={accent} t={t} toast={showToast} />}
          {tab === 'tasks' && <TasksTab isManager={isManager} myId={me.id || ''} accent={accent} t={t} toast={showToast} />}
          {tab === 'ops' && <OpsTab me={me} isManager={isManager} accent={accent} t={t} toast={showToast} />}
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

      {/* BOTTOM NAV */}
      <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 300, height: 82, background: t.nbg, backdropFilter: 'saturate(200%) blur(24px)', WebkitBackdropFilter: 'saturate(200%) blur(24px)', borderTop: `0.5px solid ${t.sep2}`, display: 'flex', alignItems: 'flex-start', paddingTop: 10, paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
        {TABS.map(tb => (
          <button key={tb.id} onClick={() => setTab(tb.id)} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, cursor: 'pointer', color: tab === tb.id ? accent : t.text3, border: 'none', background: 'none', fontFamily: 'inherit', padding: 0, fontSize: 10, fontWeight: tab === tb.id ? 700 : 500 }}>
            <span style={{ position: 'relative', transform: tab === tb.id ? 'scale(1.08)' : 'scale(1)', transition: 'transform .18s', display: 'flex' }}>
              {tb.icon(tab === tb.id)}
              {tb.id === 'ops' && newOrders > 0 && <span style={{ position: 'absolute', top: -3, right: -7, minWidth: 15, height: 15, borderRadius: 8, background: t.red, color: '#fff', fontSize: 9, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 3px' }}>{newOrders > 9 ? '9+' : newOrders}</span>}
            </span>
            {tb.label}
          </button>
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
