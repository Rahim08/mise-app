import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const path = 'app/dashboard/(shell)/bookings/page.tsx'
const text = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const expressions = new Map<string, string>()
function visit(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) expressions.set(node.name.text, node.initializer.getText(source))
  ts.forEachChild(node, visit)
}
visit(source)
function actual(name: string, values: Record<string, unknown>) {
  const expression = expressions.get(name)
  if (!expression) throw new Error(`Missing production function ${name}`)
  const body = ts.transpileModule(`return (${expression})`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText
  return new Function(...Object.keys(values), body)(...Object.values(values))
}
const dateKey = (date: Date) => date.toISOString().slice(0, 10)
const tr = (key: string) => key

describe('Booking web regression behavior', () => {
  it('distinguishes a failed day read from an empty day', async () => {
    const state: Record<string, unknown> = {}
    const query = { select() { return this }, eq() { return this }, order() { return Promise.resolve({ data: null, error: { message: 'Offline' } }) } }
    const load = actual('loadDay', { db: { from: () => query }, restaurantId: 'venue', dateKey, tr,
      dayRequest: { current: 0 }, tenantRequest: { current: 0 },
      setLoadingDay: (value: unknown) => { state.loading = value }, setDayBookings: (value: unknown) => { state.rows = value },
      setDayError: (value: unknown) => { state.error = value },
    })
    await load(new Date('2026-11-13'))
    expect(state.error).toBe('bk.loadError')
    expect(state.loading).toBe(false)
  })

  it('blocks guest profile writes when profile loading failed', async () => {
    let writes = 0
    const save = actual('saveGuestNote', { selectedGuestKey: 'g:11111111-1111-4111-8111-111111111111', notesLoaded: false,
      profileDraft: { note: 'New note', last_name: '', email: '', birthday: '' }, restaurantId: 'venue', tr,
      profileSaveBusy: { current: false }, db: { from() { writes++; return { upsert: async () => ({ error: null }) } }, rpc() { writes++; return Promise.resolve({ error: null }) } },
      setNoteSaving: () => {}, setNoteSavingKey: () => {}, setGuestError: () => {}, setGuestNotes: () => {},
    })
    await save()
    expect(writes).toBe(0)
  })
})

const deferred = <T,>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
const form = { guest_name: 'Alex', phone: '+41791234567', guests_count: '2', booking_time: '19:00', table_label: '', note: '', status: 'new' }
const bookingId = '11111111-1111-4111-8111-111111111111'
function saveHarness(response: (values: Record<string, unknown>) => Promise<unknown>, overrides: Record<string, unknown> = {}) {
  const state: Record<string, unknown> = { selected: 'new' }
  const writes: Record<string, unknown>[] = [], refreshDates: string[] = [], notifications: Record<string, unknown>[] = []
  const values: Record<string, unknown> = {
    selectedDate: new Date('2026-11-14'), visibleMonth: new Date('2026-11-01'), selectedId: 'new', draftId: bookingId, draftDate: '2026-11-13',
    draftGuestKey: `g:${bookingId}`, restaurantId: 'venue', form: { ...form }, dateKey, tr, loadingDay: false, dayError: '',
    tenantRequest: { current: 0 }, editorRequest: { current: 0 }, dayRequest: { current: 0 }, monthRequest: { current: 0 }, guestRequest: { current: 0 },
    allBookingsDirty: { current: false }, saveBusy: { current: false },
    setSaving: (value: unknown) => { state.saving = value }, setSaveError: (value: unknown) => { state.error = value },
    setSelectedId: (value: unknown) => { state.selected = value }, setDeleteConfirm: () => {},
    loadDay: async (date: Date) => { refreshDates.push(dateKey(date)) }, loadMonth: async () => {},
    pushNotify: (payload: Record<string, unknown>) => { notifications.push(payload) },
    db: { from() { let payload: Record<string, unknown> = {}; const query = {
      insert(next: Record<string, unknown>) { payload = next; return query },
      update(next: Record<string, unknown>) { payload = next; return query }, eq() { return query },
      select() { writes.push(payload); return response(payload) },
    }; return query } },
    ...overrides,
  }
  state.selected = values.selectedId
  values.validateBooking = actual('validateBooking', values)
  values.saveInner = actual('saveInner', values)
  return { state, values, writes, refreshDates, notifications, save: actual('save', values), saveInner: values.saveInner as () => Promise<void> }
}

describe('Booking mutation context', () => {
  it('keeps the original booking date even when the visible date differs', async () => {
    const harness = saveHarness(async () => ({ data: [{ id: bookingId }], error: null }), { selectedId: bookingId })
    await harness.saveInner()
    expect(harness.writes[0].booking_date).toBe('2026-11-13')
  })
  it('refuses day changes throughout an outstanding mutation', async () => {
    const request = deferred<unknown>()
    const harness = saveHarness(() => request.promise)
    const pending = harness.save()
    let changed = false
    const select = actual('selectDay', { ...harness.values, setSelectedDate: () => { changed = true }, setBookingFilter: () => {} })
    select(new Date('2026-11-15'))
    expect(changed).toBe(false)
    request.resolve({ data: [{ id: bookingId }], error: null }); await pending
  })
  it('never reloads an old day over a newer day request', async () => {
    const request = deferred<unknown>()
    const harness = saveHarness(() => request.promise)
    const pending = harness.save()
    ;(harness.values.dayRequest as { current: number }).current++
    request.resolve({ data: [{ id: bookingId }], error: null }); await pending
    expect(harness.refreshDates).toEqual([])
  })
  it('preserves a failed draft ID for retry and references it in the notification', async () => {
    let attempt = 0
    const harness = saveHarness(async () => ++attempt === 1 ? { data: null, error: { message: 'Lost response' } } : { data: [{ id: bookingId }], error: null })
    await harness.save()
    expect(harness.state.selected).toBe('new')
    expect(harness.state.error).toBe('bk.saveError')
    await harness.save()
    expect(harness.writes.map(value => value.id)).toEqual([bookingId, bookingId])
    expect(harness.state.selected).toBeNull()
    expect(harness.notifications).toHaveLength(1)
    expect(harness.notifications[0].data).toMatchObject({ booking_id: bookingId })
  })
  it.each(['-1', '0', '1.5', '1e3', '2147483648'])('rejects invalid guest count %s without a write', async guests_count => {
    const harness = saveHarness(async () => ({ data: [{ id: bookingId }], error: null }), { form: { ...form, guests_count } })
    await harness.save()
    expect(harness.writes).toEqual([])
    expect(harness.state.error).toBe('bk.invalidGuests')
  })
  it('does not close the editor when an update affects no booking', async () => {
    const harness = saveHarness(async () => ({ data: [], error: null }), { selectedId: bookingId })
    await harness.save()
    expect(harness.state.selected).toBe(bookingId)
    expect(harness.state.error).toBe('bk.saveError')
  })
})

describe('Guest loading and editing context', () => {
  it('keeps existing profiles and disables saving when a refresh cannot read metadata', async () => {
    const state: Record<string, unknown> = { notes: { existing: { note: 'Keep this' } }, bookings: ['existing'] }
    const query = { select() { return this }, eq() { return Promise.resolve({ data: null, error: { message: 'Offline' } }) } }
    const load = actual('loadGuests', {
      guestRequest: { current: 0 }, tenantRequest: { current: 0 }, allBookingsDirty: { current: true }, restaurantId: 'venue', tr,
      loadBookingHistory: async () => [{ id: 'guest' }], db: { from: () => query },
      setGuestsLoading: (value: unknown) => { state.loading = value }, setGuestError: (value: unknown) => { state.error = value },
      setNotesLoaded: (value: unknown) => { state.notesLoaded = value }, setAllBookings: (value: unknown) => { state.bookings = value },
      setGuestNotes: (value: unknown) => { state.notes = value },
    })
    await load()
    expect(state.notesLoaded).toBe(false)
    expect(state.error).toBe('bk.loadGuestsError')
    expect(state.notes).toEqual({ existing: { note: 'Keep this' } })
    expect(state.bookings).toEqual(['existing'])
  })
  it('ignores older guest-history results after a newer refresh', async () => {
    const older = deferred<unknown[]>()
    const state: Record<string, unknown> = {}
    let requests = 0
    const query = { select() { return this }, eq() { return Promise.resolve({ data: [], error: null }) } }
    const load = actual('loadGuests', {
      guestRequest: { current: 0 }, tenantRequest: { current: 0 }, allBookingsDirty: { current: true }, restaurantId: 'venue', tr,
      loadBookingHistory: () => ++requests === 1 ? older.promise : Promise.resolve([{ id: 'new' }]), db: { from: () => query },
      setGuestsLoading: () => {}, setGuestError: () => {}, setNotesLoaded: () => {},
      setAllBookings: (value: unknown) => { state.rows = value }, setGuestNotes: () => {},
    })
    const pending = load(); await load()
    older.resolve([{ id: 'old' }]); await pending
    expect(state.rows).toEqual([{ id: 'new' }])
  })
  it('saving guest A cannot reset unsaved edits to guest B', async () => {
    const request = deferred<{ error: null }>()
    const draftA = { note: 'A updated', last_name: '', email: '', birthday: '' }
    const draftB = { note: 'B unsaved edit', last_name: '', email: '', birthday: '' }
    const state = { drafts: { A: draftA, B: draftB } as Record<string, typeof draftA>, notes: {} as Record<string, typeof draftA> }
    let rpcArgs: unknown
    const save = actual('saveGuestNote', {
      selectedGuestKey: 'A', notesLoaded: true, guestsLoading: false, profileSaveBusy: { current: false }, profileDraft: draftA,
      tenantRequest: { current: 0 }, tr, setGuestError: () => {}, setNoteSavingKey: () => {},
      setGuestNotes: (update: (notes: typeof state.notes) => typeof state.notes) => { state.notes = update(state.notes) },
      setGuestDrafts: (update: (drafts: typeof state.drafts) => typeof state.drafts) => { state.drafts = update(state.drafts) },
      db: { rpc: (name: string, args: unknown) => { expect(name).toBe('booking_guest_update'); rpcArgs = args; return request.promise } },
    })
    const pending = save(); request.resolve({ error: null }); await pending
    expect(state.drafts.B).toEqual(draftB)
    expect(state.drafts.A).toBeUndefined()
    expect(state.notes.A).toEqual(draftA)
    expect(rpcArgs).toMatchObject({ p_guest_key: 'A', p_profile: { note: 'A updated' } })
  })
})

describe('Reviews loading', () => {
  it('selects the newest 90 snapshots and publishes them chronologically', async () => {
    const snapshots = Array.from({ length: 91 }, (_, index) => ({ captured_at: String(index).padStart(3, '0'), rating: index === 90 ? 4.9 : 3, ratings_total: index }))
    let published: typeof snapshots = []
    const values: Record<string, unknown> = {
      reviewsRequest: { current: 0 }, tenantRequest: { current: 0 }, restaurantId: 'venue', tr,
      setReviewsError: () => {}, setReviewsLoading: () => {}, setPlaceConfigured: () => {}, setGReviews: () => {},
      setGSnapshots: (value: typeof snapshots) => { published = value },
      db: { from(table: string) {
        let ascending = true, limit = Infinity
        const query = { select() { return query }, eq() { return query },
          order(_column: string, options: { ascending: boolean }) { ascending = options.ascending; return query },
          limit(value: number) { limit = value; return query },
          then(resolve: (result: unknown) => unknown) {
            const data = table === 'restaurant_settings' ? [{ google_place_id: 'configured' }] : table === 'google_reviews' ? []
              : [...snapshots].sort((a, b) => (ascending ? 1 : -1) * a.captured_at.localeCompare(b.captured_at)).slice(0, limit)
            return Promise.resolve({ data, error: null }).then(resolve)
          },
        }; return query
      } },
    }
    await actual('loadReviews', values)()
    expect(published).toHaveLength(90)
    expect(published[0].captured_at).toBe('001')
    expect(published[89]).toMatchObject({ captured_at: '090', rating: 4.9 })
  })
  it('does not claim reviews are disconnected when settings could not be loaded', async () => {
    const state: Record<string, unknown> = {}
    const query = { select() { return this }, limit() { return Promise.resolve({ data: null, error: { message: 'Offline' } }) } }
    await actual('loadReviews', {
      reviewsRequest: { current: 0 }, tenantRequest: { current: 0 }, restaurantId: 'venue', tr,
      db: { from: () => query }, setReviewsError: (value: unknown) => { state.error = value }, setReviewsLoading: () => {},
      setPlaceConfigured: (value: unknown) => { state.configured = value },
    })()
    expect(state.configured).toBeUndefined()
    expect(state.error).toBe('bk.loadReviewsError')
  })
})

describe('Booking guest identity and metrics', () => {
  it('omits a speculative guest key for a manually entered new reservation', async () => {
    const harness = saveHarness(async () => ({ data: [{ id: bookingId }], error: null }), { draftGuestKey: null })
    await harness.save()
    expect(harness.writes[0]).not.toHaveProperty('guest_key')
    expect(harness.writes[0].id).toBe(bookingId)
  })
  it('preserves an explicitly selected guest key on a new reservation', async () => {
    const harness = saveHarness(async () => ({ data: [{ id: bookingId }], error: null }))
    await harness.save()
    expect(harness.writes[0].guest_key).toBe(`g:${bookingId}`)
  })
})

describe('Exact guest profile loading', () => {
  it('loads the selected profile beyond the first thousand notes using its exact key', async () => {
    const notes = Array.from({ length: 1001 }, (_, index) => ({ guest_key: `guest-${index}`, note: `Saved ${index}`, last_name: `Name ${index}`, email: '', birthday: '' }))
    const key = 'guest-1000'
    let loaded = false
    let published: Record<string, unknown> = {}
    const db = { from() { const filters: Record<string, string> = {}; const query = {
      select() { return query }, eq(field: string, value: string) { filters[field] = value; return query },
      limit(value: number) { return Promise.resolve({ data: notes.filter(note => !filters.guest_key || note.guest_key === filters.guest_key).slice(0, value), error: null }) },
    }; return query } }
    await actual('loadGuestProfile', {
      db, profileRequest: { current: 0 }, tenantRequest: { current: 0 }, activeGuestRef: { current: key }, restaurantId: 'venue', tr,
      setNotesLoaded: (value: boolean) => { loaded = value }, setProfileError: () => {},
      setGuestNotes: (update: (value: Record<string, unknown>) => Record<string, unknown>) => { published = update(published) },
    })(key)
    expect(loaded).toBe(true)
    expect(published[key]).toMatchObject({ note: 'Saved 1000', last_name: 'Name 1000' })
  })
  it('keeps profile editing blocked when an exact lookup fails', async () => {
    const state: Record<string, unknown> = { note: 'Retain existing values' }
    const query = { select() { return this }, eq() { return this }, limit() { return Promise.resolve({ data: null, error: { message: 'Offline' } }) } }
    await actual('loadGuestProfile', {
      db: { from: () => query }, profileRequest: { current: 0 }, tenantRequest: { current: 0 }, activeGuestRef: { current: 'guest' }, restaurantId: 'venue', tr,
      setNotesLoaded: (value: unknown) => { state.loaded = value }, setProfileError: (value: unknown) => { state.error = value },
      setGuestNotes: () => { state.note = 'Incorrectly replaced' },
    })('guest')
    expect(state).toEqual({ note: 'Retain existing values', loaded: false, error: 'bk.loadGuestsError' })
  })
})

describe('New booking from a guest profile', () => {
  it('does not turn a nameless guest display placeholder into a real guest name', () => {
    let fields: Record<string, unknown> = {}
    actual('startNew', { saveBusy: { current: false }, loadingDay: false, dayError: '', editorRequest: { current: 0 },
      selectedDate: new Date('2026-11-13'), dateKey, crypto: { randomUUID: () => bookingId },
      setForm: (value: Record<string, unknown>) => { fields = value }, blank: { ...form, guest_name: '', phone: '' },
      setDraftId: () => {}, setDraftDate: () => {}, setDraftGuestKey: () => {}, setSelectedId: () => {}, setDeleteConfirm: () => {}, setSaveError: () => {},
    })({ id: `g:${bookingId}`, name: 'Name (optional)', phone: '+41791234567', bookings: [{ guest_name: null }] })
    expect(fields.guest_name).toBe('')
    expect(fields.phone).toBe('+41791234567')
  })
})
