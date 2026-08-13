'use client'
import React, { useEffect, useState } from 'react'
import { db } from '@/lib/db'
import { useI18n } from '@/lib/i18n'
import { fmtDate } from '@/lib/format'
import { normItem, normState, effResult } from '@/app/people/audits'
import type { DisStat, ChecklistFailDay } from '@/app/people/tabs-shifts'
import { btnB2, clock, inp } from '@/app/people/shared'
import { addDays, dayLabel, roleLabel, DOW_SHORT, MON } from '@/components/people/helpers'

// Manager → Дисциплина (реструктура 2026-08-13/14). Перенесено из
// app/people/tabs-shifts.tsx DisciplineTab без изменений в логике опозданий/грейса/heatmap/
// checklist-fail-attribution — только источник (Manager, не People→Смены→Явка) и место.
// Порог опоздания (грейс) теперь редактируется любым, кто попал в Manager (раньше —
// me.is_owner онли; Manager-модуль и так admin-only, разница непринципиальна).

export function ManagerDisciplineTab({ accent, t }: { accent: string; t: any }) {
  const { t: tr } = useI18n()
  const [period, setPeriod] = useState<'thisMonth' | 'lastMonth' | '30d' | '90d' | 'custom'>('thisMonth')
  const [cFrom, setCFrom] = useState(fmtDate(addDays(new Date(), -29)))
  const [cTo, setCTo] = useState(fmtDate(new Date()))
  const [records, setRecords] = useState<any[]>([])
  const [staff, setStaff] = useState<any[]>([])
  const [grace, setGrace] = useState(5)
  const [loading, setLoading] = useState(true)
  const [sel, setSel] = useState<string | null>(null)
  const [failMap, setFailMap] = useState<Record<string, ChecklistFailDay[]>>({})

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
    const [{ data: recs }, { data: dir }, { data: st }, { data: lists }, { data: comps }] = await Promise.all([
      db.from('attendance_records').select('*').gte('date', from).lte('date', to).order('date', { ascending: false }).limit(3000),
      db.from('staff_directory').select('*').eq('is_active', true).order('name'),
      db.from('restaurant_settings').select('late_grace_min').limit(1),
      db.from('shift_checklists').select('id, role, items').eq('kind', 'shift'),
      db.from('shift_checklist_completions').select('checklist_id, date, items_state').gte('date', from).lte('date', to).limit(3000),
    ])
    setRecords(recs || []); setStaff(dir || [])
    const s = Array.isArray(st) ? st[0] : st
    setGrace(s?.late_grace_min ?? 5)

    const listById = new Map((lists || []).map((l: any) => [l.id, l]))
    const attendByDate: Record<string, string[]> = {}
    ;(recs || []).forEach((r: any) => { (attendByDate[r.date] ||= []).push(r.staff_id) })
    const roleOf: Record<string, string | null> = {}
    ;(dir || []).forEach((s2: any) => { roleOf[s2.id] = s2.role ?? null })
    const fm: Record<string, ChecklistFailDay[]> = {}
    ;(comps || []).forEach((c: any) => {
      const list: any = listById.get(c.checklist_id)
      if (!list) return
      const items = (Array.isArray(list.items) ? list.items : []).map((x: any, i: number) => normItem(x, i))
      const state = (Array.isArray(c.items_state) ? c.items_state : []).map(normState)
      const failedLabels = items.filter((_: any, i: number) => effResult(state[i]) === 'fail').map((it: any) => it.label)
      if (failedLabels.length === 0) return
      const attendees = attendByDate[c.date] || []
      const blamed = list.role == null ? attendees : attendees.filter(sid => roleOf[sid] === list.role)
      blamed.forEach(sid => { (fm[sid] ||= []).push({ date: c.date, role: list.role ?? null, items: failedLabels }) })
    })
    setFailMap(fm)
    setLoading(false)
  }
  useEffect(() => { load() }, [from, to])

  const statFor = (sid: string): DisStat => {
    const recs = records.filter(r => r.staff_id === sid)
    const evaluable = recs.filter(r => r.late_minutes != null)
    const lateR = evaluable.filter(r => (r.late_minutes || 0) > grace)
    const totalMin = lateR.reduce((s, r) => s + (r.late_minutes || 0), 0)
    const maxMin = lateR.reduce((m, r) => Math.max(m, r.late_minutes || 0), 0)
    const failDays = failMap[sid] || []
    return {
      recs, shifts: recs.length, evaluable: evaluable.length, onTime: evaluable.length - lateR.length,
      late: lateR.length, extra: recs.length - evaluable.length, totalMin,
      avgMin: lateR.length ? Math.round(totalMin / lateR.length) : 0, maxMin,
      punct: evaluable.length ? Math.round((evaluable.length - lateR.length) / evaluable.length * 100) : null,
      checklistFails: failDays.reduce((s, d) => s + d.items.length, 0), checklistFailDays: failDays,
    }
  }

  const saveGrace = async (v: number) => {
    const prev = grace
    setGrace(v)
    const { error } = await db.from('restaurant_settings').update({ late_grace_min: v })
    if (error) setGrace(prev)
  }

  const punctColor = (p: number | null) => p == null ? t.text3 : p >= 95 ? t.green : p >= 80 ? t.orange : t.red

  if (loading) return <div style={{ textAlign: 'center', padding: 40, color: t.text3 }}>{tr('pe.loading')}</div>

  if (sel) {
    const s = staff.find(x => x.id === sel)
    const st = statFor(sel)
    const byDate: Record<string, any> = {}; st.recs.forEach(r => { byDate[r.date] = r })
    const dayColor = (key: string) => {
      const r = byDate[key]; if (!r) return null
      if (r.late_minutes == null) return t.text3
      return (r.late_minutes > grace) ? t.orange : t.green
    }
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
        `${tr('pe.checklistErrors')}: ${st.checklistFails}`,
      ]
      try { await navigator.clipboard.writeText(lines.join('\n')); } catch {}
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
            { l: tr('pe.checklistErrors'), v: String(st.checklistFails), c: st.checklistFails ? t.red : t.green },
          ].map(it => (
            <div key={it.l} style={{ background: t.surface, borderRadius: 14, padding: '12px 8px', boxShadow: t.sh, textAlign: 'center' }}>
              <div style={{ fontSize: 16, fontWeight: 800, color: it.c }}>{it.v}</div>
              <div style={{ fontSize: 9.5, color: t.text3, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.3, marginTop: 3 }}>{it.l}</div>
            </div>
          ))}
        </div>

        {months.map(({ y, m }) => {
          const days = new Date(y, m + 1, 0).getDate()
          const firstDow = (new Date(y, m, 1).getDay() + 6) % 7
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

        {st.checklistFailDays.length > 0 && (
          <>
            <div style={{ fontSize: 12, fontWeight: 600, color: t.text3, textTransform: 'uppercase', letterSpacing: 0.5, padding: '4px 4px 8px' }}>{tr('pe.checklistErrors')}</div>
            <div style={{ background: t.surface, borderRadius: 16, overflow: 'hidden', boxShadow: t.sh, marginBottom: 14 }}>
              {st.checklistFailDays.map((d, i) => (
                <div key={i} style={{ padding: '11px 16px', borderBottom: i < st.checklistFailDays.length - 1 ? `0.5px solid ${t.sep2}` : 'none' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 14, color: t.text }}>{dayLabel(d.date)} · {d.role ? tr(roleLabel(d.role)) : tr('pe.general')}</span>
                    <span style={{ fontSize: 11, fontWeight: 700, color: t.red, background: `${t.red}1a`, padding: '3px 9px', borderRadius: 8 }}>{d.items.length}</span>
                  </div>
                  <div style={{ fontSize: 12, color: t.text3, marginTop: 3 }}>{d.items.join(', ')}</div>
                </div>
              ))}
            </div>
          </>
        )}

        <button onClick={copySummary} style={{ ...btnB2(t), width: '100%' }}>{tr('pe.disCopy')}</button>
      </div>
    )
  }

  const ranked = staff.map(s => ({ s, st: statFor(s.id) }))
    .sort((a, b) => (b.st.late - a.st.late) || (b.st.totalMin - a.st.totalMin) || a.s.name.localeCompare(b.s.name))

  return (
    <div>
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

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: t.surface, borderRadius: 12, padding: '10px 14px', boxShadow: t.sh, marginBottom: 14 }}>
        <span style={{ fontSize: 13, color: t.text2 }}>{tr('pe.disGrace')}</span>
        <div style={{ display: 'flex', gap: 4 }}>
          {[0, 5, 10, 15].map(v => (
            <button key={v} onClick={() => saveGrace(v)} style={{ width: 34, height: 30, borderRadius: 8, border: 'none', fontFamily: 'inherit', fontSize: 13, fontWeight: grace === v ? 700 : 500, cursor: 'pointer', background: grace === v ? accent : t.fill, color: grace === v ? '#fff' : t.text }}>{v}</button>
          ))}
        </div>
      </div>

      {records.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '50px 20px', color: t.text3 }}>
          <div style={{ fontWeight: 600, fontSize: 16, color: t.text2 }}>{tr('pe.disEmpty')}</div>
          <div style={{ fontSize: 13, marginTop: 4 }}>{tr('pe.disEmptyHint')}</div>
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
              {st.checklistFails > 0 && <span style={{ fontSize: 11, fontWeight: 700, color: t.red, background: `${t.red}1a`, padding: '3px 9px', borderRadius: 8, marginRight: 8 }}>{st.checklistFails} {tr('pe.checklistErrorsShort')}</span>}
              {st.punct != null && <span style={{ fontSize: 14, fontWeight: 800, color: punctColor(st.punct), marginRight: 8 }}>{st.punct}%</span>}
              <svg width="16" height="16" fill="none" stroke={t.text3} strokeWidth="2" viewBox="0 0 24 24"><path d="M9 18l6-6-6-6" /></svg>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
