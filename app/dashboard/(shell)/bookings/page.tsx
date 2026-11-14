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
import { bookingGuestKey, isBookingVisit, loadBookingHistory } from '@/lib/bookingGuest'
import {
  Card, Btn, Badge, Field, Segmented, EmptyState, Spinner, Container,
  Table, StatTile, type TableColumn, type Tone,
} from '@/components/ui'
import { useDash } from '@/components/dash/context'
import { notify as pushNotify } from '@/lib/notifyClient'
import './bookings.css'

type Booking = {
  id: string; guest_key?: string | null; booking_date: string; booking_time?: string | null
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
  const { restaurant } = useDash()
  return <BookingWorkspace key={restaurant?.id || ''} restaurantId={restaurant?.id || ''} />
}

function BookingWorkspace({ restaurantId }: { restaurantId: string }) {
  const { t: tr, locale } = useI18n()
  const [tab, setTab] = useState<'bookings' | 'guests' | 'reviews'>('bookings')

  // ── БРОНИ ──
  const [visibleMonth, setVisibleMonth] = useState(() => new Date())
  const [selectedDate, setSelectedDate] = useState(() => new Date())
  const monthRequest = useRef(0)
  const dayRequest = useRef(0)
  const bookingDetailRef = useRef<HTMLElement | null>(null)
  const [monthDays, setMonthDays] = useState<Set<string>>(new Set())
  const [dayBookings, setDayBookings] = useState<Booking[]>([])
  const [loadingDay, setLoadingDay] = useState(true)
  const [bookingFilter, setBookingFilter] = useState<'all' | 'new' | 'arrived' | 'cancelled'>('all')
  const [selectedId, setSelectedId] = useState<string | 'new' | null>(null)
  const [form, setForm] = useState(blank)
  const [saving, setSaving] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(false)

  const dateKey = (d: Date) => fmtDate(d)
  const tenantRequest = useRef(0)
  const editorRequest = useRef(0)
  const saveBusy = useRef(false)
  const [dayError, setDayError] = useState('')
  const [monthError, setMonthError] = useState('')
  const [saveError, setSaveError] = useState('')
  const [draftId, setDraftId] = useState<string | null>(null)
  const [draftDate, setDraftDate] = useState('')
  const [draftGuestKey, setDraftGuestKey] = useState<string | null>(null)

  const loadMonth = async (month: Date) => {
    const request = ++monthRequest.current
    const tenant = tenantRequest.current
    setMonthError(''); setMonthDays(new Set())
    const first = new Date(month.getFullYear(), month.getMonth(), 1)
    const last = new Date(month.getFullYear(), month.getMonth() + 1, 0)
    const { data, error } = await db.from('bookings').select('booking_date').eq('restaurant_id', restaurantId)
      .gte('booking_date', dateKey(first)).lte('booking_date', dateKey(last))
    if (request !== monthRequest.current || tenant !== tenantRequest.current) return
    if (error) { setMonthError(tr('bk.loadError')); return }
    setMonthDays(new Set((data || []).map((row: Booking) => row.booking_date)))
  }

  const loadDay = async (date: Date) => {
    const request = ++dayRequest.current
    const tenant = tenantRequest.current
    setLoadingDay(true); setDayError(''); setDayBookings([])
    const { data, error } = await db.from('bookings').select('*').eq('restaurant_id', restaurantId)
      .eq('booking_date', dateKey(date)).order('booking_time', { ascending: true })
    if (request !== dayRequest.current || tenant !== tenantRequest.current) return
    if (error) setDayError(tr('bk.loadError'))
    else setDayBookings(data || [])
    setLoadingDay(false)
  }

  useEffect(() => {
    if (selectedId && window.innerWidth <= 1300) bookingDetailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [selectedId])


  const changeMonth = (dir: number) => {
    if (saveBusy.current) return
    const month = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + dir, 1)
    setVisibleMonth(month); void loadMonth(month)
  }
  const selectDay = (date: Date) => {
    if (saveBusy.current) return
    ++editorRequest.current
    setSelectedDate(date); setSelectedId(null); setSaveError(''); setBookingFilter('all'); void loadDay(date)
  }
  const goToday = () => {
    if (saveBusy.current) return
    const today = new Date()
    setVisibleMonth(today); void loadMonth(today); selectDay(today)
  }
  const cancelEditor = () => {
    if (saveBusy.current) return
    ++editorRequest.current; setSelectedId(null); setSaveError(''); setDeleteConfirm(false)
  }
  const startNew = (guest?: { id: string; phone: string; bookings: Booking[] }) => {
    if (saveBusy.current || loadingDay || dayError) return
    ++editorRequest.current
    setForm({ ...blank, guest_name: guest?.bookings.find(booking => booking.guest_name?.trim())?.guest_name?.trim() || '', phone: guest?.phone || '' })
    setDraftId(crypto.randomUUID()); setDraftDate(dateKey(selectedDate))
    setDraftGuestKey(guest?.id.startsWith('g:') ? guest.id : null)
    setSelectedId('new'); setDeleteConfirm(false); setSaveError('')
  }
  const startEdit = (booking: Booking) => {
    if (saveBusy.current || loadingDay || dayError || booking.booking_date !== dateKey(selectedDate)) return
    ++editorRequest.current
    setForm({
      guest_name: booking.guest_name || '', phone: booking.phone || '', guests_count: booking.guests_count ? String(booking.guests_count) : '',
      booking_time: booking.booking_time?.slice(0, 5) || '', table_label: booking.table_label || '', note: booking.note || '', status: booking.status || 'new',
    })
    setDraftId(booking.id); setDraftDate(booking.booking_date); setDraftGuestKey(booking.guest_key || null)
    setSelectedId(booking.id); setDeleteConfirm(false); setSaveError('')
  }

  const validateBooking = () => {
    if (form.guests_count && (!/^[1-9]\d*$/.test(form.guests_count) || Number(form.guests_count) > 2147483647)) return tr('bk.invalidGuests')
    if (form.booking_time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(form.booking_time)) return tr('bk.invalidTime')
    if (form.guest_name.length > 200 || form.phone.length > 80 || form.table_label.length > 80 || form.note.length > 4000) return tr('bk.invalidText')
    if (!['new', 'confirmed', 'arrived', 'cancelled', 'no_show', 'late'].includes(form.status)) return tr('bk.saveError')
    return ''
  }
  const save = async () => {
    if (saveBusy.current || !selectedId || !draftId || loadingDay || dayError) return
    const validation = validateBooking()
    if (validation) { setSaveError(validation); return }
    saveBusy.current = true
    const tenant = tenantRequest.current
    try { await saveInner() } finally { if (tenant === tenantRequest.current) saveBusy.current = false }
  }
  const saveInner = async () => {
    const context = { tenant: tenantRequest.current, editor: editorRequest.current, day: dayRequest.current, month: monthRequest.current,
      id: draftId, isNew: selectedId === 'new', date: draftDate, guestKey: draftGuestKey }
    if (!context.id || !context.date) return
    setSaving(true); setSaveError('')
    const values = {
      restaurant_id: restaurantId, booking_date: context.date,
      guest_name: form.guest_name.trim() || null, phone: form.phone.trim() || null,
      guests_count: form.guests_count ? Number(form.guests_count) : null,
      booking_time: form.booking_time || null, table_label: form.table_label.trim() || null,
      note: form.note.trim() || null, status: form.status || 'new',
      ...(context.guestKey ? { guest_key: context.guestKey } : {}),
    }
    try {
      const { data, error } = context.isNew
        ? await db.from('bookings').insert({ ...values, id: context.id }).select('id')
        : await db.from('bookings').update({ ...values, updated_at: new Date().toISOString() }).eq('id', context.id).select('id')
      if (context.tenant !== tenantRequest.current || context.editor !== editorRequest.current) return
      if (error || !data || (Array.isArray(data) && data.length === 0)) { setSaveError(tr('bk.saveError')); return }
      if (context.isNew) {
        void pushNotify({ type: 'booking', title: tr('bk.newBooking'), titleKey: 'notify.bookingTitle', body: tr('bk.newBooking'),
          audience: { managers: true }, data: { module: 'bookings', booking_id: context.id, booking_date: context.date } })
      }
      ++guestRequest.current; allBookingsDirty.current = true
      setSelectedId(null); setDeleteConfirm(false)
      const refresh: Promise<void>[] = []
      if (context.day === dayRequest.current) refresh.push(loadDay(selectedDate))
      if (context.month === monthRequest.current) refresh.push(loadMonth(visibleMonth))
      await Promise.all(refresh)
    } catch {
      if (context.tenant === tenantRequest.current && context.editor === editorRequest.current) setSaveError(tr('bk.saveError'))
    } finally {
      if (context.tenant === tenantRequest.current) setSaving(false)
    }
  }

  const removeBooking = async () => {
    if (saveBusy.current || !selectedId || selectedId === 'new' || !draftId) return
    saveBusy.current = true; setSaving(true); setSaveError('')
    const context = { id: draftId, tenant: tenantRequest.current, editor: editorRequest.current, day: dayRequest.current, month: monthRequest.current }
    try {
      const { data, error } = await db.from('bookings').delete().eq('id', context.id).select('id')
      if (context.tenant !== tenantRequest.current || context.editor !== editorRequest.current) return
      if (error || !data || (Array.isArray(data) && data.length === 0)) { setSaveError(tr('bk.saveError')); return }
      ++guestRequest.current; allBookingsDirty.current = true
      setSelectedId(null); setDeleteConfirm(false)
      await Promise.all([
        ...(context.day === dayRequest.current ? [loadDay(selectedDate)] : []),
        ...(context.month === monthRequest.current ? [loadMonth(visibleMonth)] : []),
      ])
    } catch {
      if (context.tenant === tenantRequest.current && context.editor === editorRequest.current) setSaveError(tr('bk.saveError'))
    } finally {
      if (context.tenant === tenantRequest.current) { saveBusy.current = false; setSaving(false) }
    }
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
  const allBookingsDirty = useRef(true)
  const guestRequest = useRef(0)
  const profileSaveBusy = useRef(false)
  const profileRequest = useRef(0)
  const activeGuestRef = useRef<string | null>(null)
  const [profileError, setProfileError] = useState('')
  const [guestNotes, setGuestNotes] = useState<Record<string, GuestProfile>>({})
  const [guestDrafts, setGuestDrafts] = useState<Record<string, GuestProfile>>({})
  const [selectedGuestKey, setSelectedGuestKey] = useState<string | null>(null)
  const [notesLoaded, setNotesLoaded] = useState(false)
  const [guestsLoading, setGuestsLoading] = useState(false)
  const [guestError, setGuestError] = useState('')
  const [noteSavingKey, setNoteSavingKey] = useState<string | null>(null)
  const noteSaving = noteSavingKey !== null
  const profileDraft = selectedGuestKey ? (guestDrafts[selectedGuestKey] || guestNotes[selectedGuestKey] || blankProfile) : blankProfile
  const setProfileDraft = (value: GuestProfile) => {
    if (!selectedGuestKey || !notesLoaded) return
    setGuestDrafts(drafts => ({ ...drafts, [selectedGuestKey]: value }))
  }

  const loadGuestProfile = async (key: string) => {
    const request = ++profileRequest.current
    const tenant = tenantRequest.current
    setNotesLoaded(false); setProfileError('')
    try {
      const { data, error } = await db.from('guest_notes').select('guest_key, note, last_name, email, birthday')
        .eq('restaurant_id', restaurantId).eq('guest_key', key).limit(1)
      if (request !== profileRequest.current || tenant !== tenantRequest.current || activeGuestRef.current !== key) return
      if (error) { setProfileError(tr('bk.loadGuestsError')); return }
      const row = data?.[0]
      setGuestNotes(notes => ({ ...notes, [key]: { note: row?.note || '', last_name: row?.last_name || '', email: row?.email || '', birthday: row?.birthday || '' } }))
      setNotesLoaded(true)
    } catch {
      if (request === profileRequest.current && tenant === tenantRequest.current && activeGuestRef.current === key) setProfileError(tr('bk.loadGuestsError'))
    }
  }
  const selectGuest = (key: string) => {
    activeGuestRef.current = key; setSelectedGuestKey(key); void loadGuestProfile(key)
  }

  const loadGuests = async () => {
    const request = ++guestRequest.current
    const tenant = tenantRequest.current
    setGuestsLoading(true); setGuestError(''); setNotesLoaded(false)
    try {
      const [bookings, notesResult] = await Promise.all([
        loadBookingHistory<Booking>(args => db.rpc<Booking[]>('booking_history_page', args)),
        db.from('guest_notes').select('guest_key, note, last_name, email, birthday').eq('restaurant_id', restaurantId),
      ])
      if (request !== guestRequest.current || tenant !== tenantRequest.current) return
      if (notesResult.error) throw new Error('profile_read_failed')
      const notes: Record<string, GuestProfile> = {}
      for (const row of notesResult.data || []) {
        notes[row.guest_key] = { note: row.note || '', last_name: row.last_name || '', email: row.email || '', birthday: row.birthday || '' }
      }
      setAllBookings(bookings); setGuestNotes(notes)
      if (activeGuestRef.current) void loadGuestProfile(activeGuestRef.current)
      allBookingsDirty.current = false
    } catch {
      if (request === guestRequest.current && tenant === tenantRequest.current) setGuestError(tr('bk.loadGuestsError'))
    } finally {
      if (request === guestRequest.current && tenant === tenantRequest.current) setGuestsLoading(false)
    }
  }
  useEffect(() => {
    const timer = setTimeout(() => {
      if (tab === 'guests' && restaurantId && (allBookings === null || allBookingsDirty.current)) void loadGuests()
    }, 0)
    return () => { clearTimeout(timer); ++guestRequest.current }
  }, [tab, restaurantId])

  const guests: Guest[] = useMemo(() => {
    const today = dateKey(new Date())
    const map = new Map<string, Guest>()
    for (const booking of allBookings || []) {
      const key = bookingGuestKey(booking)
      const visit = isBookingVisit(booking, today)
      const existing = map.get(key)
      if (existing) {
        existing.bookings.push(booking)
        if (visit) { existing.visits++; if (booking.booking_date > existing.lastVisit) existing.lastVisit = booking.booking_date }
      } else {
        map.set(key, { id: key, name: booking.guest_name || tr('bk.namePh'), phone: booking.phone || '',
          visits: visit ? 1 : 0, lastVisit: visit ? booking.booking_date : '', bookings: [booking] })
      }
    }
    return [...map.values()].sort((a, b) => b.lastVisit.localeCompare(a.lastVisit))
  }, [allBookings, tr])
  const selectedGuest = guests.find(guest => guest.id === selectedGuestKey) || null

  const saveGuestNote = async () => {
    if (!selectedGuestKey || !notesLoaded || profileSaveBusy.current || guestsLoading) return
    const key = selectedGuestKey
    const tenant = tenantRequest.current
    const draft = { ...profileDraft }
    const validBirthday = !draft.birthday || (/^\d{4}-\d{2}-\d{2}$/.test(draft.birthday) && !Number.isNaN(Date.parse(draft.birthday)) && new Date(draft.birthday).toISOString().slice(0, 10) === draft.birthday)
    if (draft.note.length > 4000 || draft.last_name.length > 200 || draft.email.length > 254
      || (draft.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.email)) || !validBirthday) {
      setGuestError(tr('bk.invalidProfile')); return
    }
    profileSaveBusy.current = true; setNoteSavingKey(key); setGuestError('')
    try {
      const { error } = await db.rpc('booking_guest_update', { p_guest_key: key,
        p_profile: { note: draft.note, last_name: draft.last_name.trim() || null, email: draft.email.trim() || null, birthday: draft.birthday || null } })
      if (tenant !== tenantRequest.current) return
      if (error) { setGuestError(tr('bk.saveError')); return }
      setGuestNotes(notes => ({ ...notes, [key]: draft }))
      setGuestDrafts(drafts => {
        if (JSON.stringify(drafts[key]) !== JSON.stringify(draft)) return drafts
        const next = { ...drafts }; delete next[key]; return next
      })
    } catch {
      if (tenant === tenantRequest.current) setGuestError(tr('bk.saveError'))
    } finally {
      if (tenant === tenantRequest.current) { profileSaveBusy.current = false; setNoteSavingKey(null) }
    }
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

  const reviewsRequest = useRef(0)
  const [reviewsError, setReviewsError] = useState('')
  const [reviewsLoading, setReviewsLoading] = useState(false)
  const loadReviews = async () => {
    const request = ++reviewsRequest.current
    const tenant = tenantRequest.current
    setReviewsError(''); setReviewsLoading(true)
    try {
      const { data: settings, error: settingsError } = await db.from('restaurant_settings').select('google_place_id').limit(1)
      if (request !== reviewsRequest.current || tenant !== tenantRequest.current) return
      if (settingsError) throw new Error('settings_read_failed')
      const row = Array.isArray(settings) ? settings[0] : settings
      const configured = !!row?.google_place_id
      setPlaceConfigured(configured)
      if (!configured) { setGReviews([]); setGSnapshots([]); return }
      const [{ data: reviews, error: reviewError }, { data: snapshots, error: snapshotError }] = await Promise.all([
        db.from('google_reviews').select('*').eq('restaurant_id', restaurantId).order('review_time', { ascending: false }),
        db.from('google_rating_snapshots').select('captured_at, rating, ratings_total').eq('restaurant_id', restaurantId).order('captured_at', { ascending: false }).limit(90),
      ])
      if (request !== reviewsRequest.current || tenant !== tenantRequest.current) return
      if (reviewError || snapshotError) throw new Error('review_read_failed')
      setGReviews(reviews || []); setGSnapshots([...(snapshots || [])].reverse())
    } catch {
      if (request === reviewsRequest.current && tenant === tenantRequest.current) setReviewsError(tr('bk.loadReviewsError'))
    } finally {
      if (request === reviewsRequest.current && tenant === tenantRequest.current) setReviewsLoading(false)
    }
  }
  useEffect(() => {
    const timer = setTimeout(() => {
      if (tab === 'reviews' && restaurantId && (placeConfigured === null || gReviews === null || gSnapshots === null)) void loadReviews()
    }, 0)
    return () => { clearTimeout(timer); ++reviewsRequest.current }
  }, [tab, restaurantId])

  useEffect(() => {
    ++tenantRequest.current
    const timer = setTimeout(() => { if (restaurantId) { void loadMonth(visibleMonth); void loadDay(selectedDate) } }, 0)
    return () => {
      clearTimeout(timer); ++tenantRequest.current; ++dayRequest.current; ++monthRequest.current
      ++guestRequest.current; ++reviewsRequest.current; ++editorRequest.current; ++profileRequest.current
    }
  }, [restaurantId])

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
    { key: 'lastVisit', label: tr('bk.lastVisit'), align: 'right', sortable: true, sortValue: g => g.lastVisit, render: g => g.lastVisit ? new Date(g.lastVisit + 'T00:00:00').toLocaleDateString(locale, { day: 'numeric', month: 'short' }) : '—' },
  ]

  const statusOptions = [
    { value: 'new', label: tr('bk.stWaiting') },
    { value: 'arrived', label: tr('bk.stArrived') },
    { value: 'cancelled', label: tr('bk.stCancelled') },
  ]
  const formStatusBucket = bkBucket(form.status)
  const bookingCounts = {
    all: dayBookings.length,
    new: dayBookings.filter(b => bkBucket(b.status) === 'new').length,
    arrived: dayBookings.filter(b => bkBucket(b.status) === 'arrived').length,
    cancelled: dayBookings.filter(b => bkBucket(b.status) === 'cancelled').length,
  }
  const visibleDayBookings = bookingFilter === 'all' ? dayBookings : dayBookings.filter(b => bkBucket(b.status) === bookingFilter)

  return (
    <Container size="wide">
      <div className="bookings-header">
        <div>
          <h1>{tr('dash.navBookings')}</h1>
          <p>{tr('bk.sub')}</p>
        </div>
        <Segmented small value={tab} onChange={v => { if (!saveBusy.current) setTab(v as 'bookings' | 'guests' | 'reviews') }}
          options={[{ value: 'bookings', label: tr('bk.tabBookings') }, { value: 'guests', label: tr('bk.tabGuests') }, { value: 'reviews', label: tr('bk.tabReviews') }]} />
      </div>

      {tab === 'bookings' ? (
        <>
          <div className="bookings-day-head">
            <div>
              <div className="bookings-day-title">{selectedDate.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' })}</div>
              <div className="bookings-day-sub">{tr('bk.tabBookings')} · {bookingCounts.all}</div>
            </div>
            <Btn onClick={() => startNew()} disabled={saving || loadingDay || !!dayError}>{tr('bk.newBooking')}</Btn>
          </div>
          <div className="bookings-summary">
            {([
              { id: 'all', label: tr('bk.tabBookings'), count: bookingCounts.all },
              { id: 'new', label: tr('bk.stWaiting'), count: bookingCounts.new },
              { id: 'arrived', label: tr('bk.stArrived'), count: bookingCounts.arrived },
            ] as const).map(item => (
              <Card key={item.id} style={{ minWidth: 0 }}>
                <div className="bookings-summary-label">{item.label}</div>
                <div className="bookings-summary-value">{loadingDay ? '—' : item.count}</div>
              </Card>
            ))}
          </div>
          <div className={`bookings-workspace${selectedId ? ' bookings-workspace--detail' : ''}`}>
            <aside className="bookings-calendar">
              {/* Календарь */}
              <Card pad={14}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <button disabled={saving} onClick={() => changeMonth(-1)} aria-label={tr('bk.prevMonth')} className="ui-press" style={{ width: 36, height: 36, borderRadius: 8, background: 'var(--fill)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--tx2)' }}>
                    <svg width="8" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" viewBox="0 0 8 14"><path d="M7 1L1 7l6 6" /></svg>
                  </button>
                  <div style={{ fontSize: '.85rem', fontWeight: 700, color: 'var(--tx)', textTransform: 'capitalize' }}>{monthLabel}</div>
                  <button disabled={saving} onClick={() => changeMonth(1)} aria-label={tr('bk.nextMonth')} className="ui-press" style={{ width: 36, height: 36, borderRadius: 8, background: 'var(--fill)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--tx2)' }}>
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
                      <button key={i} disabled={saving} onClick={() => selectDay(d)} aria-label={d.toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' })} aria-pressed={isSelected} className="ui-press" style={{
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
                {monthError && <div className="bookings-error" role="alert">{monthError}<Btn small variant="gray" onClick={() => loadMonth(visibleMonth)}>{tr('bk.retry')}</Btn></div>}
              </Card>
              <Btn variant="gray" onClick={goToday} disabled={saving} full>{tr('dash.shiftsToday')}</Btn>
            </aside>

            <section className="bookings-list" aria-label={tr('bk.tabBookings')}>
              <div className="bookings-list-head">
                <h2>{tr('bk.tabBookings')}</h2>
                <span>{bookingCounts.all}</span>
              </div>
              <div className="bookings-filters" role="group" aria-label={tr('bk.status')}>
                {([
                  { id: 'all', label: tr('bk.all'), count: bookingCounts.all },
                  { id: 'new', label: tr('bk.stWaiting'), count: bookingCounts.new },
                  { id: 'arrived', label: tr('bk.stArrived'), count: bookingCounts.arrived },
                  { id: 'cancelled', label: tr('bk.stCancelled'), count: bookingCounts.cancelled },
                ] as const).map(item => (
                  <button key={item.id} type="button" aria-pressed={bookingFilter === item.id}
                    onClick={() => setBookingFilter(item.id)} className="bookings-filter">
                    {item.label} <span>{item.count}</span>
                  </button>
                ))}
              </div>
              {loadingDay ? <Spinner compact /> : dayError ? (
                <div className="bookings-error" role="alert">{dayError}<Btn small variant="gray" onClick={() => loadDay(selectedDate)}>{tr('bk.retry')}</Btn></div>
              ) : visibleDayBookings.length === 0 ? (
                <div className="bookings-list-empty">{dayBookings.length === 0 ? tr('bk.noneDay') : tr('bk.noneFilter')}</div>
              ) : (
                <div className="bookings-rows">
                  {visibleDayBookings.map(b => {
                    const st = statusOf(b.status)
                    const on = selectedId === b.id
                    return (
                      <button key={b.id} disabled={saving} onClick={() => startEdit(b)} className={`ui-press bookings-row${on ? ' bookings-row--selected' : ''}`}>
                        <span className="bookings-row-time">{b.booking_time || '—'}</span>
                        <div className="bookings-row-body">
                          <div className="bookings-row-name">{b.guest_name || tr('bk.namePh')}</div>
                          <div className="bookings-row-meta">
                            {[b.guests_count ? `${tr('bk.guestsCount')}: ${b.guests_count}` : null, b.table_label ? `${tr('bk.table')} ${b.table_label}` : null].filter(Boolean).join(' · ')}
                          </div>
                        </div>
                        <Badge tone={st.tone}>{tr(st.label)}</Badge>
                      </button>
                    )
                  })}
                </div>
              )}
            </section>

            {selectedId && <aside className="bookings-detail" ref={bookingDetailRef}>
            <Card>
              <div style={{ fontWeight: 700, fontSize: '.95rem', color: 'var(--tx)', marginBottom: 14 }}>
                {selectedId === 'new' ? tr('bk.newBooking') : tr('bk.status')}
              </div>
              {saveError && <div className="bookings-error" role="alert">{saveError}</div>}
              <fieldset disabled={saving} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
              <div className="bookings-form-grid">
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

              </fieldset>
              <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                <Btn onClick={save} disabled={saving}>{saving ? tr('dash.saving') : tr('dash.save')}</Btn>
                <Btn variant="gray" onClick={cancelEditor} disabled={saving}>{tr('dash.cancel')}</Btn>
                {selectedId !== 'new' && !deleteConfirm && (
                  <Btn variant="danger" onClick={() => setDeleteConfirm(true)} disabled={saving}>{tr('dash.remove')}</Btn>
                )}
              </div>
              {deleteConfirm && (
                <div style={{ marginTop: 12, paddingTop: 12, borderTop: 'var(--hairline)', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: '.82rem', color: 'var(--danger)', fontWeight: 600 }}>{tr('bk.deleteConfirm')}</span>
                  <Btn small variant="danger" onClick={removeBooking} disabled={saving}>{tr('bk.yesDelete')}</Btn>
                  <Btn small variant="ghost" onClick={() => setDeleteConfirm(false)} disabled={saving}>{tr('dash.cancel')}</Btn>
                </div>
              )}
            </Card>
            </aside>}
          </div>
        </>
      ) : tab === 'guests' ? (
        <div>
          {guestError && <div className="bookings-error" role="alert">{guestError}{!notesLoaded && <Btn small variant="gray" onClick={loadGuests}>{tr('bk.retry')}</Btn>}</div>}
          {guestsLoading && allBookings === null ? <Spinner /> : allBookings === null ? null : (
            <div className="ui-split">
              <div style={{ flex: 1, minWidth: 0 }}>
                {guests.length === 0 ? (
                  <Card><div style={{ textAlign: 'center', padding: '20px 0', color: 'var(--tx2)', fontSize: '.88rem' }}>{tr('bk.noGuests')}</div></Card>
                ) : (
                  <Table columns={guestColumns} rows={guests} searchable searchPlaceholder={tr('bk.name')}
                    searchText={g => `${g.name} ${g.phone}`} keyboardRows onRowClick={guest => selectGuest(guest.id)} selectedId={selectedGuestKey} />
                )}
                <div style={{ fontSize: '.76rem', color: 'var(--tx3)', marginTop: 10 }}>{tr('bk.guestsSub')}</div>
              </div>
              <div className="ui-split-master" style={{ width: 320, flexShrink: 0 }}>
                {selectedGuest ? (
                  <Card>
                    <div style={{ fontWeight: 700, fontSize: '.95rem', color: 'var(--tx)' }}>{selectedGuest.name}</div>
                    {selectedGuest.phone && <div style={{ fontSize: '.8rem', color: 'var(--tx2)', marginTop: 2 }}>{selectedGuest.phone}</div>}

                    <Btn small variant="gray" onClick={() => { setTab('bookings'); startNew(selectedGuest) }} disabled={saving || loadingDay || !!dayError}>{tr('bk.newBooking')}</Btn>
                    {profileError && <div className="bookings-error" role="alert">{profileError}<Btn small variant="gray" onClick={() => loadGuestProfile(selectedGuest.id)}>{tr('bk.retry')}</Btn></div>}
                    {!notesLoaded && !profileError && !guestError && <Spinner compact />}
                    <fieldset aria-busy={!notesLoaded} disabled={!notesLoaded || guestsLoading || noteSavingKey === selectedGuestKey} style={{ border: 0, padding: 0, margin: '12px 0 0', minWidth: 0 }}>
                    <Field label={tr('gs.lastName')} value={profileDraft.last_name} onChange={v => setProfileDraft({ ...profileDraft, last_name: v })} />
                    <Field label={tr('gs.email')} value={profileDraft.email} onChange={v => setProfileDraft({ ...profileDraft, email: v })} type="email" />
                    <Field label={tr('gs.birthday')} value={profileDraft.birthday} onChange={v => setProfileDraft({ ...profileDraft, birthday: v })} type="date" />
                    <Field label={tr('bk.guestNote')} value={profileDraft.note} onChange={v => setProfileDraft({ ...profileDraft, note: v })} placeholder={tr('bk.guestNotePh')} />
                    <Btn small onClick={saveGuestNote} disabled={!notesLoaded || guestsLoading || noteSaving}>{noteSavingKey === selectedGuestKey ? tr('dash.saving') : tr('dash.save')}</Btn>
                    </fieldset>

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
          {reviewsError ? <div className="bookings-error" role="alert">{reviewsError}<Btn small variant="gray" onClick={loadReviews}>{tr('bk.retry')}</Btn></div>
            : reviewsLoading || placeConfigured === null ? <Spinner /> : !placeConfigured ? (
            <EmptyState
              icon={<svg width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0119 9.5C19 14.8 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.4" /></svg>}
              title={tr('bk.rvNotConfigured')} sub={tr('bk.rvNotConfiguredSub')}
              action={<Btn onClick={() => window.location.assign('/dashboard/settings#reviews')}>{tr('bk.rvGoSettings')}</Btn>}
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
