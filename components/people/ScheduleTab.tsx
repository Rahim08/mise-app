'use client'
import { useEffect, useState } from 'react'
import { db } from '@/lib/db'
import { useI18n } from '@/lib/i18n'
import { fmtDate } from '@/lib/format'
import { mondayOf, addDays, hhmm, timeRange, dayLabel, navBtn, roleLabel, Sheet, DOW_SHORT, DOW_FULL, MON } from './helpers'

export function ScheduleTab({ restaurantId, accent, t, toast }: { restaurantId: string; accent: string; t: any; toast: (m: string) => void }) {
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
    const { error } = await db.from('staff_schedules').upsert(
      { staff_id: edit.staff.id, date: edit.date, shift_start: start || null, shift_end: end || null, note: note || null, published: false },
      { onConflict: 'restaurant_id,staff_id,date' }
    )
    setSaving(false)
    if (error) { toast(tr('dash.notSaved') + error.message); return }
    setEdit(null); toast(tr('pe.shiftAssigned')); await load()
  }
  const clearShift = async () => {
    if (!edit) return
    setSaving(true)
    const { error } = await db.from('staff_schedules').delete().eq('staff_id', edit.staff.id).eq('date', edit.date)
    setSaving(false)
    if (error) { toast(tr('dash.notSaved') + error.message); return }
    setEdit(null); toast(tr('pe.shiftRemoved')); await load()
  }
  const publishWeek = async () => {
    const { error } = await db.from('staff_schedules').update({ published: true }).gte('date', weekStartStr).lte('date', weekEndStr)
    if (error) { toast(tr('dash.notSaved') + error.message); return }
    toast(tr('pe.weekPublished')); await load()
  }

  const unpublishedCount = schedules.filter(s => !s.published).length

  const shiftPresets: [string, string][] = (() => {
    const used = schedules.filter(s => s.shift_start && s.shift_end).map(s => [hhmm(s.shift_start), hhmm(s.shift_end)] as [string, string])
    const defaults: [string, string][] = [['10:00', '22:00'], ['12:00', '00:00'], ['09:00', '18:00'], ['18:00', '02:00']]
    const seen = new Set<string>(); const out: [string, string][] = []
    for (const [s, e] of [...used, ...defaults]) { const k = `${s}-${e}`; if (s && e && !seen.has(k)) { seen.add(k); out.push([s, e]) } }
    return out.slice(0, 6)
  })()

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, background: t.surface, borderRadius: 16, padding: '12px 14px', marginBottom: 12, boxShadow: t.sh }}>
        <button onClick={() => setWeekStart(addDays(weekStart, -7))} style={navBtn(t)}><svg width="9" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" viewBox="0 0 10 18"><path d="M8 1L1 9l7 8" /></svg></button>
        <div style={{ flex: 1, textAlign: 'center', fontSize: 15, fontWeight: 700, color: t.text }}>
          {weekDays[0].getDate()} {MON()[weekDays[0].getMonth()]} — {weekDays[6].getDate()} {MON()[weekDays[6].getMonth()]}
        </div>
        <button onClick={() => setWeekStart(addDays(weekStart, 7))} style={navBtn(t)}><svg width="9" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" viewBox="0 0 10 18"><path d="M2 1l7 8-7 8" /></svg></button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 6, marginBottom: 16 }}>
        {weekDays.map((d, i) => {
          const ds = fmtDate(d); const active = ds === selected; const today = ds === fmtDate(new Date())
          return (
            <button key={ds} onClick={() => setSelected(ds)} style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, padding: '8px 0', borderRadius: 12, border: 'none', cursor: 'pointer', fontFamily: 'inherit',
              background: active ? accent : t.surface, boxShadow: active ? `0 4px 12px ${accent}44` : t.sh,
            }}>
              <span style={{ fontSize: 10, fontWeight: 600, color: active ? 'rgba(255,255,255,.7)' : t.text3 }}>{DOW_SHORT()[i]}</span>
              <span style={{ fontSize: 16, fontWeight: 700, color: active ? '#fff' : (today ? accent : t.text) }}>{d.getDate()}</span>
              <span style={{ width: 4, height: 4, borderRadius: '50%', background: dayHasShifts(ds) ? (active ? '#fff' : accent) : 'transparent' }} />
            </button>
          )
        })}
      </div>

      <div style={{ fontSize: 12, fontWeight: 600, color: t.text3, textTransform: 'uppercase', letterSpacing: 0.5, padding: '4px 4px 8px' }}>
        {DOW_FULL()[new Date(selected + 'T00:00:00').getDay()]}, {dayLabel(selected)}
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
            <div style={{ fontSize: 13, color: t.text3, textAlign: 'center', marginBottom: 16 }}>{DOW_FULL()[new Date(edit.date + 'T00:00:00').getDay()]}, {dayLabel(edit.date)}</div>

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
