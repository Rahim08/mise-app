'use client'
// Брони (CRM-бронирование столов) + Гости (агрегация по броням, вкладка в этой же
// странице — не отдельный биллинг-модуль). Порт логики из native/Mise/Mise/BookingsView.swift
// и GuestsView.swift на web-owner-дашборд. Права: создать/видеть — любой сотрудник (на iOS);
// на owner-дашборде caller.owner всегда true в /api/db, так что здесь редактирование не гейтится
// по автору — только по тарифу (entitlements 'bookings' — сайдбар гейтит сам вход на страницу).
import { useEffect, useMemo, useRef, useState } from 'react'
import { db } from '@/lib/db'
import { useI18n } from '@/lib/i18n'
import { fmtDate } from '@/lib/format'
import {
  Card, Btn, Badge, Field, SectionTitle, Segmented, SplitView, EmptyState, Spinner, Container,
  Table, StatTile, type TableColumn, type Tone,
} from '@/components/ui'
import { useDash } from '@/components/dash/context'
import { notify as pushNotify } from '@/lib/notifyClient'

type Booking = {
  id: string; booking_date: string; booking_time?: string | null
  guest_name?: string | null; guests_count?: number | null; phone?: string | null
  table_label?: string | null; note?: string | null; status?: string | null
  created_by_name?: string | null; created_at?: string
}

// 3 бакета максимум (см. BkBucket в BookingsView.swift) — сырые значения в БД не трогаем,
// "confirmed"/легаси "late" схлопываются в waiting("new"), "no_show" схлопывается в cancelled.
const STATUS: Record<'new' | 'arrived' | 'cancelled', { label: string; tone: Tone }> = {
  new:       { label: 'bk.stWaiting',   tone: 'accent' },
  arrived:   { label: 'bk.stArrived',   tone: 'violet' },
  cancelled: { label: 'bk.stCancelled', tone: 'neutral' },
}
const bkBucket = (s?: string | null): 'new' | 'arrived' | 'cancelled' =>
  s === 'arrived' ? 'arrived' : (s === 'cancelled' || s === 'no_show') ? 'cancelled' : 'new'
const statusOf = (s?: string | null) => STATUS[bkBucket(s)]

// Тот же ключ гостя, что в iOS GuestsView.swift: цифры телефона, иначе lowercase-имя.
// Последние 9 цифр (не весь номер) — иначе один и тот же гость, введённый один раз как
// «079…» (местный формат) и второй раз как «+4179…» (международный), давал два разных
// ключа и его история/визиты рассыпались на два профиля.
function guestKey(b: Booking): string | null {
  const digits = (b.phone || '').replace(/\D/g, '')
  if (digits) return digits.slice(-9)
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
  const [tab, setTab] = useState<'bookings' | 'guests' | 'reviews'>('bookings')

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
    // Раньше ошибка сети/сервера тут не проверялась вообще — форма закрывалась, будто всё
    // сохранилось, а данные молча терялись (юзер узнавал об этом только по расхождению
    // при следующей загрузке). Теперь форма остаётся открытой, юзер видит ошибку и не теряет ввод.
    const { error } = selectedId === 'new'
      ? await db.from('bookings').insert(values)
      : selectedId
        ? await db.from('bookings').update({ ...values, updated_at: new Date().toISOString() }).eq('id', selectedId)
        : { error: null }
    setSaving(false)
    if (error) { alert(tr('dash.notSaved') + error.message); return }
    // Пуш другим менеджерам о новой брони — на iOS это уже было (BookingsView.save), на
    // веб-дашборде отсутствовало вообще (владелец создаёт бронь, а другие менеджеры о ней
    // не узнают, кроме как открыв Брони руками).
    if (selectedId === 'new') {
      const segs: { key?: string; value: string }[] = []
      if (values.guest_name) segs.push({ value: values.guest_name })
      if (values.guests_count) segs.push({ value: String(values.guests_count) })
      if (values.booking_time) segs.push({ value: values.booking_time })
      if (values.table_label) segs.push({ key: 'notify.bookingTable', value: values.table_label })
      if (values.booking_date !== dateKey(new Date())) segs.push({ value: values.booking_date })
      pushNotify({
        type: 'booking', title: tr('bk.newBooking'), titleKey: 'notify.bookingTitle',
        body: segs.map(s => s.value).join(' · ') || tr('bk.newBooking'),
        bodySegments: segs.length ? segs : undefined,
        audience: { managers: true },
        data: { module: 'bookings', booking_date: values.booking_date },
      })
    }
    setSelectedId(null)
    allBookingsDirty.current = true
    await Promise.all([loadDay(selectedDate), loadMonth(visibleMonth)])
  }

  const removeBooking = async () => {
    if (!selectedId || selectedId === 'new') return
    const { error } = await db.from('bookings').delete().eq('id', selectedId)
    if (error) { alert(tr('dash.notSaved') + error.message); return }
    setSelectedId(null); setDeleteConfirm(false)
    allBookingsDirty.current = true
    await Promise.all([loadDay(selectedDate), loadMonth(visibleMonth)])
  }

  const monthLabel = visibleMonth.toLocaleDateString(locale, { month: 'long', year: 'numeric' })
  const weekdayLabels = useMemo(() => {
    // Понедельник как первый день — те же 7 дат января 2024, начиная с пн.
    return Array.from({ length: 7 }, (_, i) => new Date(2024, 0, 1 + i).toLocaleDateString(locale, { weekday: 'short' }))
  }, [locale])

  // ── ГОСТИ ──
  type Guest = { id: string; name: string; phone: string; visits: number; lastVisit: string; bookings: Booking[] }
  type GuestProfile = { note: string; last_name: string; email: string; birthday: string }
  const blankProfile: GuestProfile = { note: '', last_name: '', email: '', birthday: '' }
  const [allBookings, setAllBookings] = useState<Booking[] | null>(null)
  // Раньше грузилось один раз за жизнь страницы (гейт allBookings !== null) и никогда не
  // инвалидировалось после create/edit/delete на вкладке «Брони» — на вкладке «Гости» висела
  // устаревшая история/счётчик визитов до полной перезагрузки страницы. iOS-версия это уже
  // чинит сбросом флага при save/delete — здесь его не было вообще.
  const allBookingsDirty = useRef(false)
  const [guestNotes, setGuestNotes] = useState<Record<string, GuestProfile>>({})
  const [selectedGuestKey, setSelectedGuestKey] = useState<string | null>(null)
  const [profileDraft, setProfileDraft] = useState<GuestProfile>(blankProfile)
  const [noteSaving, setNoteSaving] = useState(false)

  useEffect(() => {
    if (tab !== 'guests' || (allBookings !== null && !allBookingsDirty.current) || !restaurantId) return
    ;(async () => {
      const yearAgo = new Date(); yearAgo.setMonth(yearAgo.getMonth() - 12)
      const [{ data: bks }, { data: notes }] = await Promise.all([
        db.from('bookings').select('*').eq('restaurant_id', restaurantId).gte('booking_date', dateKey(yearAgo)).order('booking_date', { ascending: false }),
        db.from('guest_notes').select('guest_key, note, last_name, email, birthday').eq('restaurant_id', restaurantId),
      ])
      allBookingsDirty.current = false
      setAllBookings(bks || [])
      const nm: Record<string, GuestProfile> = {}
      ;(notes || []).forEach((n: any) => {
        nm[n.guest_key] = { note: n.note || '', last_name: n.last_name || '', email: n.email || '', birthday: n.birthday || '' }
      })
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
  useEffect(() => {
    setProfileDraft(selectedGuestKey ? (guestNotes[selectedGuestKey] || blankProfile) : blankProfile)
  }, [selectedGuestKey, guestNotes])

  const saveGuestNote = async () => {
    if (!selectedGuestKey) return
    setNoteSaving(true)
    const { error } = await db.from('guest_notes').upsert(
      {
        restaurant_id: restaurantId, guest_key: selectedGuestKey, note: profileDraft.note,
        last_name: profileDraft.last_name || null, email: profileDraft.email || null,
        birthday: profileDraft.birthday || null, updated_at: new Date().toISOString(),
      },
      { onConflict: 'restaurant_id,guest_key' },
    )
    setNoteSaving(false)
    if (error) { alert(tr('dash.notSaved') + error.message); return }
    setGuestNotes(n => ({ ...n, [selectedGuestKey]: profileDraft }))
  }

  // ── ОТЗЫВЫ (Google Maps, через Places API) ──
  type GReview = {
    id: string; author_name?: string | null; rating?: number | null
    review_text?: string | null; relative_time?: string | null; review_time?: string | null
  }
  type GSnapshot = { captured_at: string; rating?: number | null; ratings_total?: number | null }
  const [placeConfigured, setPlaceConfigured] = useState<boolean | null>(null)
  const [gReviews, setGReviews] = useState<GReview[] | null>(null)
  const [gSnapshots, setGSnapshots] = useState<GSnapshot[] | null>(null)

  useEffect(() => {
    if (tab !== 'reviews' || placeConfigured !== null || !restaurantId) return
    ;(async () => {
      const { data: settings } = await db.from('restaurant_settings').select('google_place_id').limit(1)
      const row = Array.isArray(settings) ? settings[0] : settings
      const configured = !!row?.google_place_id
      setPlaceConfigured(configured)
      if (!configured) return
      const [{ data: reviews }, { data: snaps }] = await Promise.all([
        db.from('google_reviews').select('*').eq('restaurant_id', restaurantId).order('review_time', { ascending: false }),
        db.from('google_rating_snapshots').select('captured_at, rating, ratings_total').eq('restaurant_id', restaurantId).order('captured_at', { ascending: true }).limit(90),
      ])
      setGReviews(reviews || []); setGSnapshots(snaps || [])
    })()
  }, [tab, restaurantId])

  const latestSnapshot = gSnapshots && gSnapshots.length ? gSnapshots[gSnapshots.length - 1] : null
  const ratingTrend = useMemo(() => (gSnapshots || []).map(s => s.rating || 0).filter(v => v > 0), [gSnapshots])
  // SVG-звёзды вместо текстовых глифов (без эмодзи/глифов в продукте).
  const stars = (n: number) => {
    const f = Math.max(0, Math.min(5, Math.round(n)))
    return (
      <span style={{ display: 'inline-flex', gap: 2 }}>
        {[0, 1, 2, 3, 4].map(i => (
          <svg key={i} width="12" height="12" viewBox="0 0 24 24" fill={i < f ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"><path d="M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8-6.2-3.2-6.2 3.2L7 14.2l-5-4.9 6.9-1z" /></svg>
        ))}
      </span>
    )
  }

  const guestColumns: TableColumn<Guest>[] = [
    { key: 'name', label: tr('bk.name'), sortable: true, render: g => <span style={{ fontWeight: 600, color: 'var(--tx)' }}>{g.name}</span> },
    { key: 'phone', label: tr('bk.phone'), render: g => g.phone || <span style={{ color: 'var(--tx3)' }}>—</span> },
    { key: 'visits', label: tr('bk.visits'), align: 'right', sortable: true, sortValue: g => g.visits },
    { key: 'lastVisit', label: tr('bk.lastVisit'), align: 'right', sortable: true, sortValue: g => g.lastVisit, render: g => new Date(g.lastVisit + 'T00:00:00').toLocaleDateString(locale, { day: 'numeric', month: 'short' }) },
  ]

  const statusOptions = [
    { value: 'new', label: tr('bk.stWaiting') },
    { value: 'arrived', label: tr('bk.stArrived') },
    { value: 'cancelled', label: tr('bk.stCancelled') },
  ]
  const formStatusBucket = bkBucket(form.status)

  return (
    <Container size="wide">
      <SectionTitle title={tr('dash.navBookings')} sub={tr('bk.sub')}
        right={<Segmented small value={tab} onChange={v => setTab(v as any)}
          options={[{ value: 'bookings', label: tr('bk.tabBookings') }, { value: 'guests', label: tr('bk.tabGuests') }, { value: 'reviews', label: tr('bk.tabReviews') }]} />} />

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
                <Field label={tr('bk.status')} value={formStatusBucket}
                  onChange={v => setForm({ ...form, status: v === 'cancelled' ? (form.status === 'no_show' ? 'no_show' : 'cancelled') : v })}
                  select options={statusOptions} />
              </div>
              {formStatusBucket === 'cancelled' && (
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '.82rem', color: 'var(--tx2)', margin: '4px 0 0' }}>
                  <input type="checkbox" checked={form.status === 'no_show'}
                    onChange={e => setForm({ ...form, status: e.target.checked ? 'no_show' : 'cancelled' })} />
                  {tr('bk.stNoShow')}
                </label>
              )}
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
      ) : tab === 'guests' ? (
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

                    <Field label={tr('gs.lastName')} value={profileDraft.last_name} onChange={v => setProfileDraft({ ...profileDraft, last_name: v })} />
                    <Field label={tr('gs.email')} value={profileDraft.email} onChange={v => setProfileDraft({ ...profileDraft, email: v })} type="email" />
                    <Field label={tr('gs.birthday')} value={profileDraft.birthday} onChange={v => setProfileDraft({ ...profileDraft, birthday: v })} type="date" />
                    <Field label={tr('bk.guestNote')} value={profileDraft.note} onChange={v => setProfileDraft({ ...profileDraft, note: v })} placeholder={tr('bk.guestNotePh')} />
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
      ) : (
        <div>
          {placeConfigured === null ? <Spinner /> : !placeConfigured ? (
            <EmptyState
              icon={<svg width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0119 9.5C19 14.8 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.4" /></svg>}
              title={tr('bk.rvNotConfigured')} sub={tr('bk.rvNotConfiguredSub')}
              action={<Btn onClick={() => window.location.assign('/dashboard/settings')}>{tr('bk.rvGoSettings')}</Btn>}
            />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
                <StatTile label={tr('bk.rvRating')} value={latestSnapshot?.rating ?? '—'} tone="accent" trend={ratingTrend} />
                <StatTile label={tr('bk.rvTotal')} value={latestSnapshot?.ratings_total ?? '—'} tone="ok" />
              </div>

              {gSnapshots && gSnapshots.length >= 2 && (
                <Card>
                  <div style={{ fontSize: '.72rem', fontWeight: 700, color: 'var(--tx2)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 8 }}>{tr('bk.rvTrend')}</div>
                  <RatingTrendSVG points={gSnapshots.map(s => ({ rating: s.rating || 0 }))} />
                </Card>
              )}

              <div>
                <div style={{ fontSize: '.72rem', fontWeight: 700, color: 'var(--tx2)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 8 }}>{tr('bk.rvList')}</div>
                {gReviews === null ? <Spinner compact /> : gReviews.length === 0 ? (
                  <Card><div style={{ textAlign: 'center', padding: '16px 0', color: 'var(--tx2)', fontSize: '.85rem' }}>{tr('bk.rvNone')}</div></Card>
                ) : (
                  <Card pad={0}>
                    {gReviews.map(r => (
                      <div key={r.id} style={{ padding: '12px 16px', borderBottom: 'var(--hairline)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                          <span style={{ fontWeight: 600, fontSize: '.85rem', color: 'var(--tx)' }}>{r.author_name || tr('bk.rvAnon')}</span>
                          <span style={{ fontSize: '.74rem', color: 'var(--tx3)', flexShrink: 0 }}>{r.relative_time}</span>
                        </div>
                        <div style={{ color: 'var(--accent)', fontSize: '.8rem', margin: '2px 0 4px', letterSpacing: 1 }}>{stars(r.rating || 0)}</div>
                        {r.review_text && <div style={{ fontSize: '.82rem', color: 'var(--tx2)', lineHeight: 1.4 }}>{r.review_text}</div>}
                      </div>
                    ))}
                  </Card>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </Container>
  )
}

// Рейтинг во времени (1-5), собранный своими снэпшотами при каждом sync — простой
// hand-rolled SVG в стиле графиков app/analytics/page.tsx, без завязки на валюту.
function RatingTrendSVG({ points }: { points: { rating: number }[] }) {
  const W = 320, H = 110
  const pad = { top: 10, right: 10, bottom: 6, left: 18 }
  const min = 1, max = 5
  const toX = (i: number) => pad.left + (i / (points.length - 1)) * (W - pad.left - pad.right)
  const toY = (v: number) => pad.top + ((max - v) / (max - min)) * (H - pad.top - pad.bottom)
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${toX(i).toFixed(1)},${toY(p.rating).toFixed(1)}`).join(' ')

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: H }}>
      {[1, 2, 3, 4, 5].map(v => (
        <g key={v}>
          <line x1={pad.left} x2={W - pad.right} y1={toY(v)} y2={toY(v)} stroke="currentColor" strokeOpacity="0.06" />
          <text x={2} y={toY(v) + 3} fontSize="8" fill="currentColor" fillOpacity="0.35">{v}</text>
        </g>
      ))}
      <path d={path} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      {points.map((p, i) => <circle key={i} cx={toX(i)} cy={toY(p.rating)} r="2.5" fill="var(--accent)" />)}
    </svg>
  )
}
