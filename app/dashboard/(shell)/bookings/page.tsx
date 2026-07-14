'use client'
// Брони (CRM-бронирование столов) + Гости (агрегация по броням, вкладка в этой же
// странице — не отдельный биллинг-модуль). Порт логики из native/Mise/Mise/BookingsView.swift
// и GuestsView.swift на web-owner-дашборд. Права: создать/видеть — любой сотрудник (на iOS);
// на owner-дашборде caller.owner всегда true в /api/db, так что здесь редактирование не гейтится
// по автору — только по тарифу (entitlements 'bookings' — сайдбар гейтит сам вход на страницу).
import { useEffect, useMemo, useState } from 'react'
import { db } from '@/lib/db'
import { useI18n } from '@/lib/i18n'
import { fmtDate } from '@/lib/format'
import {
  Card, Btn, Badge, Field, SectionTitle, Segmented, SplitView, EmptyState, Spinner, Container,
  Table, type TableColumn, type Tone,
} from '@/components/ui'
import { useDash } from '@/components/dash/context'

type Booking = {
  id: string; booking_date: string; booking_time?: string | null
  guest_name?: string | null; guests_count?: number | null; phone?: string | null
  table_label?: string | null; note?: string | null; status?: string | null
  created_by_name?: string | null; created_at?: string
}

const STATUS: Record<string, { label: string; tone: Tone }> = {
  new:       { label: 'bk.stNew',       tone: 'accent' },
  confirmed: { label: 'bk.stConfirmed', tone: 'ok' },
  arrived:   { label: 'bk.stArrived',   tone: 'violet' },
  late:      { label: 'bk.stLate',      tone: 'warn' },
  cancelled: { label: 'bk.stCancelled', tone: 'neutral' },
  no_show:   { label: 'bk.stNoShow',    tone: 'danger' },
}
const statusOf = (s?: string | null) => STATUS[s || 'new'] || STATUS.new

// Тот же ключ гостя, что в iOS GuestsView.swift: цифры телефона, иначе lowercase-имя.
function guestKey(b: Booking): string | null {
  const digits = (b.phone || '').replace(/\D/g, '')
  if (digits) return digits
  const name = (b.guest_name || '').trim().toLowerCase()
  return name || null
}
// «Визит» — любая бронь кроме отменённой/неявки (как pastVisitCount на iOS).
const isVisit = (b: Booking) => b.status !== 'cancelled' && b.status !== 'no_show'

function monthGrid(month: Date): (Date | null)[] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1)
  const startOffset = (first.getDay() + 6) % 7 // неделя с понедельника
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()
  const cells: (Date | null)[] = Array(startOffset).fill(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(month.getFullYear(), month.getMonth(), d))
  while (cells.length % 7 !== 0) cells.push(null)
  return cells
}

const blank = { guest_name: '', phone: '', guests_count: '', booking_time: '', table_label: '', note: '', status: 'new' }

export default function BookingsPage() {
  const { t: tr, locale } = useI18n()
  const { restaurant } = useDash()
  const restaurantId = restaurant?.id || ''
  const [tab, setTab] = useState<'bookings' | 'guests'>('bookings')

  // ── БРОНИ ──
  const [visibleMonth, setVisibleMonth] = useState(() => new Date())
  const [selectedDate, setSelectedDate] = useState(() => new Date())
  const [monthDays, setMonthDays] = useState<Set<string>>(new Set())
  const [dayBookings, setDayBookings] = useState<Booking[]>([])
  const [loadingDay, setLoadingDay] = useState(true)
  const [selectedId, setSelectedId] = useState<string | 'new' | null>(null)
  const [form, setForm] = useState(blank)
  const [saving, setSaving] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(false)

  const dateKey = (d: Date) => fmtDate(d)

  const loadMonth = async (month: Date) => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1)
    const last = new Date(month.getFullYear(), month.getMonth() + 1, 0)
    const { data } = await db.from('bookings').select('booking_date').eq('restaurant_id', restaurantId)
      .gte('booking_date', dateKey(first)).lte('booking_date', dateKey(last))
    setMonthDays(new Set((data || []).map((r: any) => r.booking_date)))
  }

  const loadDay = async (date: Date) => {
    setLoadingDay(true)
    const { data } = await db.from('bookings').select('*').eq('restaurant_id', restaurantId)
      .eq('booking_date', dateKey(date)).order('booking_time', { ascending: true })
    setDayBookings(data || [])
    setLoadingDay(false)
  }

  useEffect(() => { if (restaurantId) { loadMonth(visibleMonth); loadDay(selectedDate) } }, [restaurantId])

  const changeMonth = (dir: number) => {
    const m = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + dir, 1)
    setVisibleMonth(m); loadMonth(m)
  }
  const selectDay = (d: Date) => {
    setSelectedDate(d); setSelectedId(null); loadDay(d)
  }

  const startNew = () => { setForm(blank); setSelectedId('new'); setDeleteConfirm(false) }
  const startEdit = (b: Booking) => {
    setForm({
      guest_name: b.guest_name || '', phone: b.phone || '', guests_count: b.guests_count ? String(b.guests_count) : '',
      booking_time: b.booking_time || '', table_label: b.table_label || '', note: b.note || '', status: b.status || 'new',
    })
    setSelectedId(b.id); setDeleteConfirm(false)
  }

  const save = async () => {
    setSaving(true)
    const values = {
      restaurant_id: restaurantId, booking_date: dateKey(selectedDate),
      guest_name: form.guest_name || null, phone: form.phone || null,
      guests_count: form.guests_count ? +form.guests_count : null,
      booking_time: form.booking_time || null, table_label: form.table_label || null,
      note: form.note || null, status: form.status || 'new', // status NOT NULL DEFAULT 'new' в БД — не отправлять null
    }
    if (selectedId === 'new') {
      await db.from('bookings').insert(values)
    } else if (selectedId) {
      await db.from('bookings').update({ ...values, updated_at: new Date().toISOString() }).eq('id', selectedId)
    }
    setSaving(false); setSelectedId(null)
    await Promise.all([loadDay(selectedDate), loadMonth(visibleMonth)])
  }

  const removeBooking = async () => {
    if (!selectedId || selectedId === 'new') return
    await db.from('bookings').delete().eq('id', selectedId)
    setSelectedId(null); setDeleteConfirm(false)
    await Promise.all([loadDay(selectedDate), loadMonth(visibleMonth)])
  }

  const monthLabel = visibleMonth.toLocaleDateString(locale, { month: 'long', year: 'numeric' })
  const weekdayLabels = useMemo(() => {
    // Понедельник как первый день — те же 7 дат января 2024, начиная с пн.
    return Array.from({ length: 7 }, (_, i) => new Date(2024, 0, 1 + i).toLocaleDateString(locale, { weekday: 'short' }))
  }, [locale])

  // ── ГОСТИ ──
  type Guest = { id: string; name: string; phone: string; visits: number; lastVisit: string; bookings: Booking[] }
  const [allBookings, setAllBookings] = useState<Booking[] | null>(null)
  const [guestNotes, setGuestNotes] = useState<Record<string, string>>({})
  const [selectedGuestKey, setSelectedGuestKey] = useState<string | null>(null)
  const [noteDraft, setNoteDraft] = useState('')
  const [noteSaving, setNoteSaving] = useState(false)

  useEffect(() => {
    if (tab !== 'guests' || allBookings !== null || !restaurantId) return
    ;(async () => {
      const yearAgo = new Date(); yearAgo.setMonth(yearAgo.getMonth() - 12)
      const [{ data: bks }, { data: notes }] = await Promise.all([
        db.from('bookings').select('*').eq('restaurant_id', restaurantId).gte('booking_date', dateKey(yearAgo)).order('booking_date', { ascending: false }),
        db.from('guest_notes').select('guest_key, note').eq('restaurant_id', restaurantId),
      ])
      setAllBookings(bks || [])
      const nm: Record<string, string> = {}
      ;(notes || []).forEach((n: any) => { nm[n.guest_key] = n.note })
      setGuestNotes(nm)
    })()
  }, [tab, restaurantId])

  const guests: Guest[] = useMemo(() => {
    if (!allBookings) return []
    const map = new Map<string, Guest>()
    for (const b of allBookings) {
      const key = guestKey(b)
      if (!key) continue
      const existing = map.get(key)
      if (existing) {
        existing.bookings.push(b)
        if (isVisit(b)) existing.visits++
        if (b.booking_date > existing.lastVisit) existing.lastVisit = b.booking_date
      } else {
        map.set(key, {
          id: key, name: b.guest_name || tr('bk.namePh'), phone: b.phone || '',
          visits: isVisit(b) ? 1 : 0, lastVisit: b.booking_date, bookings: [b],
        })
      }
    }
    return [...map.values()].sort((a, b) => b.lastVisit.localeCompare(a.lastVisit))
  }, [allBookings, tr])

  const selectedGuest = guests.find(g => g.id === selectedGuestKey) || null
  useEffect(() => { setNoteDraft(selectedGuestKey ? (guestNotes[selectedGuestKey] || '') : '') }, [selectedGuestKey, guestNotes])

  const saveGuestNote = async () => {
    if (!selectedGuestKey) return
    setNoteSaving(true)
    await db.from('guest_notes').upsert(
      { restaurant_id: restaurantId, guest_key: selectedGuestKey, note: noteDraft, updated_at: new Date().toISOString() },
      { onConflict: 'restaurant_id,guest_key' },
    )
    setGuestNotes(n => ({ ...n, [selectedGuestKey]: noteDraft }))
    setNoteSaving(false)
  }

  const guestColumns: TableColumn<Guest>[] = [
    { key: 'name', label: tr('bk.name'), sortable: true, render: g => <span style={{ fontWeight: 600, color: 'var(--tx)' }}>{g.name}</span> },
    { key: 'phone', label: tr('bk.phone'), render: g => g.phone || <span style={{ color: 'var(--tx3)' }}>—</span> },
    { key: 'visits', label: tr('bk.visits'), align: 'right', sortable: true, sortValue: g => g.visits },
    { key: 'lastVisit', label: tr('bk.lastVisit'), align: 'right', sortable: true, sortValue: g => g.lastVisit, render: g => new Date(g.lastVisit + 'T00:00:00').toLocaleDateString(locale, { day: 'numeric', month: 'short' }) },
  ]

  const statusOptions = [
    { value: 'new', label: tr('bk.stNew') },
    { value: 'confirmed', label: tr('bk.stConfirmed') },
    { value: 'arrived', label: tr('bk.stArrived') },
    { value: 'late', label: tr('bk.stLate') },
    { value: 'cancelled', label: tr('bk.stCancelled') },
    { value: 'no_show', label: tr('bk.stNoShow') },
  ]

  return (
    <Container size="wide">
      <SectionTitle title={tr('dash.navBookings')} sub={tr('bk.sub')}
        right={<Segmented small value={tab} onChange={v => setTab(v as any)}
          options={[{ value: 'bookings', label: tr('bk.tabBookings') }, { value: 'guests', label: tr('bk.tabGuests') }]} />} />

      {tab === 'bookings' ? (
        <SplitView
          masterWidth={340}
          master={
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {/* Календарь */}
              <Card pad={14}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <button onClick={() => changeMonth(-1)} className="ui-press" style={{ width: 28, height: 28, borderRadius: 8, background: 'var(--fill)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--tx2)' }}>
                    <svg width="8" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" viewBox="0 0 8 14"><path d="M7 1L1 7l6 6" /></svg>
                  </button>
                  <div style={{ fontSize: '.85rem', fontWeight: 700, color: 'var(--tx)', textTransform: 'capitalize' }}>{monthLabel}</div>
                  <button onClick={() => changeMonth(1)} className="ui-press" style={{ width: 28, height: 28, borderRadius: 8, background: 'var(--fill)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--tx2)' }}>
                    <svg width="8" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" viewBox="0 0 8 14"><path d="M1 1l6 6-6 6" /></svg>
                  </button>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 2, marginBottom: 4 }}>
                  {weekdayLabels.map(w => <div key={w} style={{ textAlign: 'center', fontSize: '.62rem', fontWeight: 600, color: 'var(--tx3)', textTransform: 'uppercase' }}>{w}</div>)}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 2 }}>
                  {monthGrid(visibleMonth).map((d, i) => {
                    if (!d) return <div key={i} />
                    const key = dateKey(d)
                    const has = monthDays.has(key)
                    const isSelected = key === dateKey(selectedDate)
                    const isToday = key === dateKey(new Date())
                    return (
                      <button key={i} onClick={() => selectDay(d)} className="ui-press" style={{
                        aspectRatio: '1', borderRadius: 8, border: isToday && !isSelected ? '1px solid var(--accent)' : 'none',
                        background: isSelected ? 'var(--accent)' : 'transparent', color: isSelected ? '#fff' : 'var(--tx)',
                        fontSize: '.78rem', fontWeight: isSelected ? 700 : 500, cursor: 'pointer', fontFamily: 'inherit',
                        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, position: 'relative',
                      }}>
                        {d.getDate()}
                        {has && <span style={{ width: 4, height: 4, borderRadius: '50%', background: isSelected ? '#fff' : 'var(--accent)', position: 'absolute', bottom: 4 }} />}
                      </button>
                    )
                  })}
                </div>
              </Card>

              {/* Список дня */}
              <Btn onClick={startNew} full>{tr('bk.newBooking')}</Btn>
              {loadingDay ? <Spinner compact /> : dayBookings.length === 0 ? (
                <Card><div style={{ textAlign: 'center', padding: '16px 0', color: 'var(--tx2)', fontSize: '.85rem' }}>{tr('bk.noneDay')}</div></Card>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {dayBookings.map(b => {
                    const st = statusOf(b.status)
                    const on = selectedId === b.id
                    return (
                      <button key={b.id} onClick={() => startEdit(b)} className="ui-press" style={{
                        display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 12,
                        border: on ? '1.5px solid var(--accent)' : 'var(--hairline)', background: on ? 'var(--accent-soft)' : 'var(--surface)',
                        cursor: 'pointer', textAlign: 'left', width: '100%', fontFamily: 'inherit',
                      }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: '.85rem', fontWeight: 600, color: 'var(--tx)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {b.booking_time ? `${b.booking_time} · ` : ''}{b.guest_name || tr('bk.namePh')}
                          </div>
                          <div style={{ fontSize: '.74rem', color: 'var(--tx3)', marginTop: 1 }}>
                            {[b.guests_count ? `${b.guests_count}` : null, b.table_label ? `${tr('bk.table')} ${b.table_label}` : null].filter(Boolean).join(' · ')}
                          </div>
                        </div>
                        <Badge tone={st.tone}>{tr(st.label)}</Badge>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          }
          detail={selectedId ? (
            <Card>
              <div style={{ fontWeight: 700, fontSize: '.95rem', color: 'var(--tx)', marginBottom: 14 }}>
                {selectedId === 'new' ? tr('bk.newBooking') : tr('bk.status')}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
                <Field label={tr('bk.name')} value={form.guest_name} onChange={v => setForm({ ...form, guest_name: v })} placeholder={tr('bk.namePh')} />
                <Field label={tr('bk.phone')} value={form.phone} onChange={v => setForm({ ...form, phone: v })} type="tel" />
                <Field label={tr('bk.time')} value={form.booking_time} onChange={v => setForm({ ...form, booking_time: v })} type="time" />
                <Field label={tr('bk.guestsCount')} value={form.guests_count} onChange={v => setForm({ ...form, guests_count: v })} type="number" min={1} />
                <Field label={tr('bk.table')} value={form.table_label} onChange={v => setForm({ ...form, table_label: v })} />
                <Field label={tr('bk.status')} value={form.status} onChange={v => setForm({ ...form, status: v })} select options={statusOptions} />
              </div>
              <Field label={tr('bk.note')} value={form.note} onChange={v => setForm({ ...form, note: v })} />

              <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                <Btn onClick={save} disabled={saving}>{saving ? tr('dash.saving') : tr('dash.save')}</Btn>
                <Btn variant="gray" onClick={() => setSelectedId(null)}>{tr('dash.cancel')}</Btn>
                {selectedId !== 'new' && !deleteConfirm && (
                  <Btn variant="danger" onClick={() => setDeleteConfirm(true)}>{tr('dash.remove')}</Btn>
                )}
              </div>
              {deleteConfirm && (
                <div style={{ marginTop: 12, paddingTop: 12, borderTop: 'var(--hairline)', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: '.82rem', color: 'var(--danger)', fontWeight: 600 }}>{tr('bk.deleteConfirm')}</span>
                  <Btn small variant="danger" onClick={removeBooking}>{tr('bk.yesDelete')}</Btn>
                  <Btn small variant="ghost" onClick={() => setDeleteConfirm(false)}>{tr('dash.cancel')}</Btn>
                </div>
              )}
            </Card>
          ) : (
            <EmptyState
              icon={<svg width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M3 9h18M8 2v4M16 2v4" /></svg>}
              title={tr('bk.selectPrompt')} sub={tr('bk.selectPromptSub')}
            />
          )}
        />
      ) : (
        <div>
          {allBookings === null ? <Spinner /> : (
            <div className="ui-split">
              <div style={{ flex: 1, minWidth: 0 }}>
                {guests.length === 0 ? (
                  <Card><div style={{ textAlign: 'center', padding: '20px 0', color: 'var(--tx2)', fontSize: '.88rem' }}>{tr('bk.noGuests')}</div></Card>
                ) : (
                  <Table columns={guestColumns} rows={guests} searchable searchPlaceholder={tr('bk.name')}
                    searchText={g => `${g.name} ${g.phone}`} onRowClick={g => setSelectedGuestKey(g.id)} selectedId={selectedGuestKey} />
                )}
                <div style={{ fontSize: '.76rem', color: 'var(--tx3)', marginTop: 10 }}>{tr('bk.guestsSub')}</div>
              </div>
              <div className="ui-split-master" style={{ width: 320, flexShrink: 0 }}>
                {selectedGuest ? (
                  <Card>
                    <div style={{ fontWeight: 700, fontSize: '.95rem', color: 'var(--tx)' }}>{selectedGuest.name}</div>
                    {selectedGuest.phone && <div style={{ fontSize: '.8rem', color: 'var(--tx2)', marginTop: 2 }}>{selectedGuest.phone}</div>}

                    <Field label={tr('bk.guestNote')} value={noteDraft} onChange={setNoteDraft} placeholder={tr('bk.guestNotePh')} />
                    <Btn small onClick={saveGuestNote} disabled={noteSaving}>{noteSaving ? tr('dash.saving') : tr('dash.save')}</Btn>

                    <div style={{ fontSize: '.72rem', fontWeight: 700, color: 'var(--tx2)', textTransform: 'uppercase', letterSpacing: '.04em', margin: '16px 0 8px' }}>{tr('bk.guestHistory')}</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {selectedGuest.bookings.map(b => {
                        const st = statusOf(b.status)
                        return (
                          <div key={b.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '6px 0', borderBottom: 'var(--hairline)' }}>
                            <span style={{ fontSize: '.78rem', color: 'var(--tx)' }}>{new Date(b.booking_date + 'T00:00:00').toLocaleDateString(locale, { day: 'numeric', month: 'short' })}{b.booking_time ? ` · ${b.booking_time}` : ''}</span>
                            <Badge tone={st.tone}>{tr(st.label)}</Badge>
                          </div>
                        )
                      })}
                    </div>
                  </Card>
                ) : (
                  <EmptyState title={tr('bk.selectGuest')} />
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </Container>
  )
}
