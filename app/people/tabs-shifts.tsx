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
import { ShiftChecklistsView, WalkHistoryView, AuditStatsView, useOpsGate, normItem, normState, effResult } from './audits'
import { btnB2, inp, lbl, clock, hoursOf, fmtHours, HistoryList } from './shared'
import { mondayOf, addDays, hhmm, timeRange, dayLabel, navBtn, roleLabel, getMe, Sheet, Placeholder, DOW_SHORT, DOW_FULL, MON } from '@/components/people/helpers'


// Мои смены, Обмены, Явка, Дисциплина, хаб Смены
// Распил page.tsx (Д2, 2026-07-18): секция вынесена без изменений логики.
// ── MY SHIFTS TAB (staff) ────────────────────────────────────────────────────────

export function MyShiftsTab({ myId, accent, t }: { myId: string; accent: string; t: any }) {
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

// ── SWAPS TAB ────────────────────────────────────────────────────────────────────

const SWAP_STATUS: Record<string, { label: string; color: (t: any) => string }> = {
  pending_peer: { label: 'pe.swPendingPeer', color: t => t.orange },
  peer_accepted: { label: 'pe.swPeerAccepted', color: t => t.blue },
  approved: { label: 'pe.swApproved', color: t => t.green },
  peer_declined: { label: 'pe.swPeerDeclined', color: t => t.red },
  rejected: { label: 'pe.swRejected', color: t => t.red },
  cancelled: { label: 'pe.swCancelled', color: t => t.text3 },
}

export function SwapsTab({ me, isManager, accent, t, toast }: { me: any; isManager: boolean; accent: string; t: any; toast: (m: string) => void }) {
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
      // Лимит на растущую таблицу (ревью Д1).
      db.from('shift_swap_requests').select('*').order('created_at', { ascending: false }).limit(200),
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
    const { error } = await db.from('shift_swap_requests').insert({
      schedule_id: form.schedule_id, requester_id: myId, target_id: form.target_id,
      status: 'pending_peer', note: form.note || null,
    })
    setSaving(false)
    if (error) { toast(tr('dash.notSaved') + error.message); return }
    await notify(form.target_id, 'swap_request', tr('pe.swapRequestTitle'), tr('pe.swapRequestBody', { name: me.name || tr('pe.colleague'), date: sc ? dayLabel(sc.date) : '' }),
      { titleKey: 'notify.swapRequestTitle', bodyKey: 'notify.swapRequestBody', bodyParams: { name: me.name || tr('pe.colleague'), date: sc ? dayLabel(sc.date) : '' } })
    setShowForm(false); setForm({ schedule_id: '', target_id: '', note: '' })
    toast(tr('pe.reportSent')); await load()
  }

  // Ниже — раньше ни одна мутация не проверяла ошибку сети/сервера вообще: сбой проходил
  // молча, кнопка «Принять»/«Отклонить»/«Утвердить» как будто ничего не делала, юзер не
  // понимал почему (аудит 2026-08-04).
  const setStatus = async (r: any, patch: any) => {
    const { error } = await db.from('shift_swap_requests').update(patch).eq('id', r.id)
    if (error) { toast(tr('dash.notSaved') + error.message); return }
    await load()
  }
  const peerAccept = async (r: any) => {
    const { error } = await db.from('shift_swap_requests').update({ status: 'peer_accepted', peer_responded_at: now() }).eq('id', r.id)
    if (error) { toast(tr('dash.notSaved') + error.message); return }
    pushNotify({ type: 'swap_request', title: tr('pe.swapPendingTitle'), body: tr('pe.swapPendingBody'), titleKey: 'notify.swapPendingTitle', bodyKey: 'notify.swapPendingBody', audience: { managers: true } })
    await load()
  }
  const peerDecline = async (r: any) => {
    const { error } = await db.from('shift_swap_requests').update({ status: 'peer_declined', peer_responded_at: now() }).eq('id', r.id)
    if (error) { toast(tr('dash.notSaved') + error.message); return }
    await notify(r.requester_id, 'swap_result', tr('pe.swapDeclinedTitle'), tr('pe.swapDeclinedByPeerBody'),
      { titleKey: 'notify.swapDeclinedTitle', bodyKey: 'notify.swapDeclinedByPeerBody' })
    await load()
  }
  const managerReject = async (r: any) => {
    const { error } = await db.from('shift_swap_requests').update({ status: 'rejected', manager_id: me.is_owner ? null : myId, manager_responded_at: now() }).eq('id', r.id)
    if (error) { toast(tr('dash.notSaved') + error.message); return }
    await notify(r.requester_id, 'swap_result', tr('pe.swapDeclinedTitle'), tr('pe.swapDeclinedByManagerBody'),
      { titleKey: 'notify.swapDeclinedTitle', bodyKey: 'notify.swapDeclinedByManagerBody' })
    await load()
  }
  const approve = async (r: any) => {
    // Reassign the shift to the target, then mark approved.
    const { error: e1 } = await db.from('staff_schedules').update({ staff_id: r.target_id }).eq('id', r.schedule_id)
    if (e1) { toast(tr('dash.notSaved') + e1.message); return }
    const { error: e2 } = await db.from('shift_swap_requests').update({ status: 'approved', manager_id: me.is_owner ? null : myId, manager_responded_at: now() }).eq('id', r.id)
    if (e2) { toast(tr('dash.notSaved') + e2.message); return }
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

export function btnA(accent: string): React.CSSProperties {
  return { flex: 1, padding: '11px', borderRadius: 12, border: 'none', background: accent, color: '#fff', fontFamily: 'inherit', fontSize: 14, fontWeight: 700, cursor: 'pointer' }
}
export function btnB(t: any): React.CSSProperties {
  return { flex: 1, padding: '11px', borderRadius: 12, border: 'none', background: t.fill, color: t.text, fontFamily: 'inherit', fontSize: 14, fontWeight: 600, cursor: 'pointer' }
}

// ── ATTENDANCE TAB ───────────────────────────────────────────────────────────────

export function distMeters(la1: number, lo1: number, la2: number, lo2: number) {
  const R = 6371000, toR = Math.PI / 180
  const dLa = (la2 - la1) * toR, dLo = (lo2 - lo1) * toR
  const a = Math.sin(dLa / 2) ** 2 + Math.cos(la1 * toR) * Math.cos(la2 * toR) * Math.sin(dLo / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

export function AttendanceTab({ me, isManager, accent, t, toast, onOpenDiscipline }: { me: any; isManager: boolean; accent: string; t: any; toast: (m: string) => void; onOpenDiscipline?: () => void }) {
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
  // Хард-гейт по графику (Д4, 2026-07-31): без опубликованной смены на сегодня «Я здесь»
  // не проходит вообще — кнопка и сама не показывается (см. staff-view ниже), это защитная
  // сетка на случай гонки/устаревшего рендера.
  const checkIn = async () => {
    if (!pos || dist == null || todayRec) return
    if (!mySched?.published) return
    if (dist > (settings?.geo_radius_m || 150)) { toast(tr('pe.outsideZone')); return }
    // Порог опоздания — настраиваемый грейс (restaurant_settings.late_grace_min), не
    // хардкод: раньше 5 мин было зашито в статус/бейдж/пуш «опоздал», хотя в статистике
    // Дисциплины (DisciplineTab) грейс уже применялся корректно — несостыковка внутри
    // одной фичи (аудит 2026-08-04).
    const grace = settings?.late_grace_min ?? 5
    let late: number | null = null, status = 'present'
    if (mySched?.shift_start) {
      const [h, m] = mySched.shift_start.split(':').map(Number)
      const start = new Date(); start.setHours(h, m, 0, 0)
      late = Math.max(0, Math.round((Date.now() - start.getTime()) / 60000)); status = late > grace ? 'late' : 'present'
    }
    const { error } = await db.from('attendance_records').upsert(
      { staff_id: myId, date: today, check_in_at: new Date().toISOString(), check_in_lat: pos.lat, check_in_lng: pos.lng, check_in_distance_m: Math.round(dist), late_minutes: late, status, source: 'geo' },
      { onConflict: 'restaurant_id,staff_id,date' }
    )
    // Раньше ошибка сети/сервера тут не проверялась вообще — кнопка просто не переключалась
    // в «на смене», без объяснения почему (юзер не понимал, пришла явка или нет). iOS в этом
    // случае кладёт явку в офлайн-очередь и досылает сама — на вебе такой очереди пока нет
    // (отдельная тема), но хотя бы явно сообщаем о сбое вместо тишины.
    if (error) { toast(tr('dash.notSaved') + error.message); return }
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
    const { error } = await db.from('attendance_records').update({ check_out_at: new Date().toISOString(), check_out_lat: pos.lat, check_out_lng: pos.lng }).eq('staff_id', myId).eq('date', today)
    if (error) { toast(tr('dash.notSaved') + error.message); return }
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
  // Хард-гейт по графику (Д4, 2026-07-31): без опубликованной смены на сегодня — вообще
  // не показываем гео-флоу/кнопку «Я здесь». Не блокирует уже существующую запись
  // (todayRec) — если пришёл раньше, чем сняли/переставили график, карточка не пропадает.
  const scheduledToday = !!mySched?.published
  return (
    <div>
      {!configured ? (
        <div style={{ textAlign: 'center', padding: '50px 20px', color: t.text3 }}>
          <div style={{ fontWeight: 600, fontSize: 16, color: t.text2 }}>{tr('pe.geoNotConfigured')}</div>
          <div style={{ fontSize: 13, marginTop: 4 }}>{tr('pe.geoManagerSetsAddress')}</div>
        </div>
      ) : !todayRec && !scheduledToday ? (
        <div style={{ textAlign: 'center', padding: '50px 20px', color: t.text3 }}>
          <div style={{ fontWeight: 600, fontSize: 16, color: t.text2 }}>{tr('pe.noScheduledShift')}</div>
          <div style={{ fontSize: 13, marginTop: 4 }}>{tr('pe.noScheduledShiftHint')}</div>
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

// ── SHIFTS HUB (Смены/Расписание + Явка + Обмены в одной вкладке) ───────────────
// IA: вместо трёх вкладок в баре — один раздел с внутренним сегментом. «Я пришёл»
// (чек-ин) живёт в «Явке», обмены сменами — рядом, расписание/мои смены — основной вид.
// ── DISCIPLINE TAB (история опозданий) ──────────────────────────────────────────

export type DisStat = { recs: any[]; shifts: number; evaluable: number; onTime: number; late: number; extra: number; totalMin: number; avgMin: number; maxMin: number; punct: number | null; checklistFails: number; checklistFailDays: ChecklistFailDay[] }
export type ChecklistFailDay = { date: string; role: string | null; items: string[] }

export function DisciplineTab({ me, accent, t, toast }: { me: any; accent: string; t: any; toast: (m: string) => void }) {
  const { t: tr } = useI18n()
  const [period, setPeriod] = useState<'thisMonth' | 'lastMonth' | '30d' | '90d' | 'custom'>('thisMonth')
  const [cFrom, setCFrom] = useState(fmtDate(addDays(new Date(), -29)))
  const [cTo, setCTo] = useState(fmtDate(new Date()))
  const [records, setRecords] = useState<any[]>([])
  const [staff, setStaff] = useState<any[]>([])
  const [grace, setGrace] = useState(5)
  const [loading, setLoading] = useState(true)
  const [sel, setSel] = useState<string | null>(null)
  // Ошибки чек-листов (Д4, 2026-07-31): менеджер выставил fail при верификации смены —
  // провал вешается на ВСЕХ, кто был на смене того дня (по цеху чек-листа, или на всех,
  // если чек-лист общий), не на конкретного отметившего галку — attribution по галочке
  // ненадёжна, юзер сознательно от неё отказался.
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

    // Провал = менеджер поставил fail при верификации (result='fail' независимо от галочки
    // сотрудника). Виноваты все, у кого attendance_records за тот день (и тот же цех, если
    // чек-лист цеховой; все, если общий) — не тот, кто именно тапнул чекбокс.
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
        `${tr('pe.checklistErrors')}: ${st.checklistFails}`,
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
            { l: tr('pe.checklistErrors'), v: String(st.checklistFails), c: st.checklistFails ? t.red : t.green },
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

        {/* Дни с проваленными пунктами чек-листа (менеджерская верификация) */}
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

// «Аудит» — Рутина (Смена+Восьмёрка) + Аудиты (статистика+разовые), переехало сюда из «Зала»
// (Д4, 2026-07-31): семантически про жизнь смены, не про физическое пространство. Внутренний
// пикер — тот же паттерн, что был в OpsTab.
// Флаттенинг (Д4, по фидбеку юзера — 3 уровня вложенности «Аудит→Рутина/Аудиты→
// Аудиты/Смена/Восьмёрка» читались как повторяющиеся подпункты, «Аудит» vs «Аудиты» —
// коллизия имён): один ряд пилюль по типу контента (Смена/Восьмёрка/Аудиты) вместо
// пикера-в-пикере, статистика — под кнопку-шторку, а не постоянный третий ряд табов.
// useOpsGate вызывается один раз здесь и прокидывается вниз (было — по разу на подраздел).
// Д6: пилюля «Аудиты» скрыта из навигации по просьбе юзера (термин не понравился, разовые
// проверки пока не нужны) — AdHocAuditsView/fetchHasRelevantAudits остаются в audits.tsx
// нетронутыми, просто не вызываются отсюда. Чтобы вернуть — добавить audits обратно в PILLS,
// импортировать AdHocAuditsView/fetchHasRelevantAudits и восстановить ветку рендера/гейт.
function ShiftAuditHub({ me, isManager, restaurantId, accent, t, toast }: { me: any; isManager: boolean; restaurantId: string; accent: string; t: any; toast: (m: string) => void }) {
  const { t: tr } = useI18n()
  const myId = me.id || ''
  const myRole = me.role
  const { staff, canFill, openShiftId, ready } = useOpsGate(me)
  const [seg, setSeg] = useState<'shift' | 'walk'>('shift')
  const [showStats, setShowStats] = useState(false)

  const PILLS = [
    { id: 'shift', label: tr('pe.shiftChecklists') },
    ...(isManager ? [{ id: 'walk', label: tr('pe.walks') }] : []),
  ] as const

  if (!ready) return <div style={{ textAlign: 'center', padding: 40, color: t.text3 }}>{tr('pe.loading')}</div>

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <div style={{ display: 'flex', flex: 1, background: t.fill, borderRadius: 12, padding: 3, gap: 2 }}>
          {PILLS.map(s => (
            <button key={s.id} onClick={() => setSeg(s.id as any)} style={{ flex: 1, padding: '8px 0', borderRadius: 10, border: 'none', fontFamily: 'inherit', fontSize: 12.5, fontWeight: seg === s.id ? 700 : 500, cursor: 'pointer', background: seg === s.id ? t.surface : 'transparent', color: seg === s.id ? accent : t.text3, boxShadow: seg === s.id ? t.sh2 : 'none' }}>{s.label}</button>
          ))}
        </div>
        {isManager && (
          <button onClick={() => setShowStats(true)} aria-label={tr('pe.statistics')} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 40, background: t.fill, border: 'none', borderRadius: 12, cursor: 'pointer', color: t.text2 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 20V14M12 20V4M18 20V10" /></svg>
          </button>
        )}
      </div>
      {seg === 'shift' && <ShiftChecklistsView isManager={isManager} myId={myId} myRole={myRole} canFill={canFill} openShiftId={openShiftId} staff={staff} restaurantId={restaurantId} accent={accent} t={t} toast={toast} />}
      {seg === 'walk' && isManager && <WalkHistoryView staff={staff} accent={accent} t={t} />}
      {showStats && (
        <Sheet onClose={() => setShowStats(false)} t={t}>
          <div style={{ padding: '14px 20px 32px' }}>
            <div style={{ fontSize: 18, fontWeight: 700, textAlign: 'center', color: t.text, marginBottom: 16 }}>{tr('pe.statistics')}</div>
            <AuditStatsView accent={accent} t={t} initialKind={seg === 'walk' ? 'walk' : 'shift'} />
          </div>
        </Sheet>
      )}
    </div>
  )
}

export function ShiftsHub({ me, isManager, restaurantId, accent, t, toast }: { me: any; isManager: boolean; restaurantId: string; accent: string; t: any; toast: (m: string) => void }) {
  const { t: tr } = useI18n()
  const [view, setView] = useState<'shifts' | 'attendance' | 'audit' | 'discipline' | 'swaps'>('shifts')
  const views: [string, string][] = [
    ['shifts', isManager ? tr('pe.schedule') : tr('pe.myShifts')],
    ['attendance', tr('pe.attendance')],
    ['audit', tr('pe.auditTab')],
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
      {view === 'audit' && <ShiftAuditHub me={me} isManager={isManager} restaurantId={restaurantId} accent={accent} t={t} toast={toast} />}
      {view === 'discipline' && <DisciplineTab me={me} accent={accent} t={t} toast={toast} />}
      {view === 'swaps' && <SwapsTab me={me} isManager={isManager} accent={accent} t={t} toast={toast} />}
    </div>
  )
}

