'use client'

import { useEffect, useState } from 'react'
import { db } from '@/lib/db'
import { fmtDate } from '@/lib/format'
import { useI18n } from '@/lib/i18n'
import { roleLabel, timeRange } from '@/components/people/helpers'

type Staff = { id: string; name: string; role: string }
type Schedule = { staff_id: string; shift_start: string | null; shift_end: string | null; published: boolean }
type Task = { id: string; title: string; assigned_to: string | null; due_date: string | null; status: string }
type HomeData = { staff: Staff[]; schedules: Schedule[]; tasks: Task[]; newReports: number }

export function PeopleWebHome({ onSchedule, onTasks, onAudits, onReports, onTeam }: {
  onSchedule: () => void; onTasks: () => void; onAudits: () => void; onReports: () => void; onTeam: () => void
}) {
  const { t: tr, locale } = useI18n()
  const today = fmtDate(new Date())
  const [data, setData] = useState<HomeData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | 'scheduled' | 'off'>('all')
  const [reload, setReload] = useState(0)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      setError(false)
      const [staffResult, scheduleResult, tasksResult, reportsResult] = await Promise.all([
        db.from('staff_directory').select('id,name,role').eq('is_active', true).order('name'),
        db.from('staff_schedules').select('staff_id,shift_start,shift_end,published').eq('date', today),
        db.from('staff_tasks').select('id,title,assigned_to,due_date,status').neq('status', 'done').order('created_at', { ascending: false }).limit(1000),
        db.from('staff_reports').select('id').eq('status', 'new').limit(1000),
      ])
      if (cancelled) return
      if (staffResult.error || scheduleResult.error || tasksResult.error || reportsResult.error) {
        setError(true)
      } else {
        setData({ staff: staffResult.data || [], schedules: scheduleResult.data || [], tasks: tasksResult.data || [], newReports: (reportsResult.data || []).length })
      }
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [today, reload])

  if (loading) return <div className="people-web-loading" aria-label={tr('pe.loading')} />
  if (error || !data) return <div className="people-web-panel people-web-error">{tr('pe.webLoadError')} <button type="button" onClick={() => setReload(n => n + 1)}>{tr('pe.webRetry')}</button></div>

  const byStaff = new Map(data.schedules.map(schedule => [schedule.staff_id, schedule]))
  const scheduledCount = data.staff.filter(person => byStaff.has(person.id)).length
  const filteredStaff = data.staff.filter(person => {
    const matchesName = `${person.name} ${tr(roleLabel(person.role))}`.toLocaleLowerCase(locale).includes(search.toLocaleLowerCase(locale))
    return matchesName && (filter === 'all' || (filter === 'scheduled' ? byStaff.has(person.id) : !byStaff.has(person.id)))
  }).sort((a, b) => Number(byStaff.has(b.id)) - Number(byStaff.has(a.id)) || a.name.localeCompare(b.name, locale))
  const staffNames = new Map(data.staff.map(person => [person.id, person.name]))
  const topTasks = [...data.tasks].sort((a, b) => (a.due_date || '9999-12-31').localeCompare(b.due_date || '9999-12-31')).slice(0, 4)
  const dateLabel = new Date(`${today}T00:00:00`).toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' })

  return <div className="people-web-home">
    <div className="people-web-metrics">
      {[
        { label: tr('pe.webStaffCount'), value: data.staff.length, tone: 'default' },
        { label: tr('pe.webScheduledToday'), value: scheduledCount, tone: 'default' },
        { label: tr('pe.webOpenTasks'), value: data.tasks.length, tone: 'warning' },
        { label: tr('pe.webNewReports'), value: data.newReports, tone: 'danger' },
      ].map(metric => <div className="people-web-metric" key={metric.label}>
        <div className="people-web-metric-label">{metric.label}</div>
        <div className={`people-web-metric-value people-web-metric-value--${metric.tone}`}>{metric.value}</div>
      </div>)}
    </div>

    <div className="people-web-columns">
      <section className="people-web-panel people-web-team">
        <div className="people-web-panel-head"><div><h2>{tr('pe.webTeamToday')}</h2><p>{dateLabel}</p></div><button type="button" onClick={onSchedule}>{tr('pe.webOpenSchedule')} ›</button></div>
        <label className="people-web-search">
          <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></svg>
          <input value={search} onChange={event => setSearch(event.target.value)} placeholder={tr('pe.webSearchStaff')} aria-label={tr('pe.webSearchStaff')} />
        </label>
        <div className="people-web-filters" role="group" aria-label={tr('pe.webTeamFilter')}>
          {([
            ['all', tr('pe.webAll')], ['scheduled', tr('pe.webScheduled')], ['off', tr('pe.webNotScheduled')],
          ] as const).map(([id, label]) => <button key={id} type="button" className={filter === id ? 'is-active' : undefined} aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}</button>)}
        </div>
        {filteredStaff.length ? <div className="people-web-table-scroll"><table className="people-web-table">
          <thead><tr><th>{tr('pe.webEmployee')}</th><th>{tr('pe.webRole')}</th><th>{tr('pe.schedule')}</th><th>{tr('pe.webStatus')}</th></tr></thead>
          <tbody>{filteredStaff.map(person => {
            const schedule = byStaff.get(person.id)
            return <tr key={person.id}>
              <td className="people-web-name"><span className="people-web-avatar">{person.name.slice(0, 1).toUpperCase()}</span>{person.name}</td>
              <td>{tr(roleLabel(person.role))}</td>
              <td className="people-web-hours">{schedule ? (timeRange(schedule.shift_start, schedule.shift_end) || tr('pe.shiftWord')) : '—'}</td>
              <td>{schedule ? <span className={`people-web-status ${schedule.published ? 'is-scheduled' : 'is-draft'}`}>{schedule.published ? tr('pe.webScheduled') : tr('pe.draft')}</span> : <span className="people-web-status is-off">{tr('pe.dayOff')}</span>}</td>
            </tr>
          })}</tbody>
        </table></div> : <div className="people-web-empty">{search ? tr('pe.webNoMatch') : data.staff.length ? tr('pe.webNoScheduleMatch') : tr('pe.noStaffAddAccess')}</div>}
      </section>

      <aside className="people-web-rail">
        <section className="people-web-panel">
          <div className="people-web-panel-head"><h2>{tr('pe.webOpenTasks')}</h2><button type="button" onClick={onTasks}>{tr('pe.webAllTasks')} ›</button></div>
          {data.tasks.length ? topTasks.map(task => <button className="people-web-task" type="button" key={task.id} onClick={onTasks}>
            <span className="people-web-task-dot" aria-hidden="true" />
            <span><strong>{task.title}</strong><small>{task.assigned_to ? staffNames.get(task.assigned_to) || tr('pe.unknown') : tr('pe.unknown')}{task.due_date ? ` · ${new Date(`${task.due_date}T00:00:00`).toLocaleDateString(locale, { day: 'numeric', month: 'short' })}` : ''}</small></span>
          </button>) : <div className="people-web-empty">{tr('pe.noTasks')}</div>}
        </section>
        <section className="people-web-panel">
          <h2>{tr('pe.webQuickActions')}</h2>
          <div className="people-web-action-list">
            <button type="button" onClick={onTeam}>{tr('pe.webTeamAccess')} <span>›</span></button>
            <button type="button" onClick={onAudits}>{tr('pe.webShiftChecks')} <span>›</span></button>
            <button type="button" onClick={onReports}>{tr('pe.webStaffReports')}{data.newReports > 0 && <b>{data.newReports}</b>} <span>›</span></button>
          </div>
        </section>
      </aside>
    </div>
  </div>
}
