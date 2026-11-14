import { beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('./apns', () => ({ sendPush: vi.fn(async () => ({ sent: 1, invalid: [] })) }))
import { sendPush } from './apns'
import { dispatchNotification, type NotifyInput } from './notify'

type Row = Record<string, unknown>
function journalGateway() {
  const journal: Row[] = []
  const failures = new Map<string, string>()
  let lostJournalResponse = false
  let legacyId = 0
  let subscriptions: Row[] = []
  const admin = { from(table: string) {
    let op = 'select', values: Row[] = [], ignoreDuplicates = false
    const query = {
      select() { return query }, eq() { return query }, not() { return query }, in() { return query },
      insert(rows: Row[]) { op = 'insert'; values = rows; return query },
      upsert(rows: Row[], options: { onConflict?: string; ignoreDuplicates?: boolean }) {
        expect(options.onConflict).toBe('id'); op = 'upsert'; values = rows; ignoreDuplicates = options.ignoreDuplicates === true; return query
      },
      delete() { op = 'delete'; return query },
      then(resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) {
        const failure = failures.get(table)
        if (failure) { failures.delete(table); return Promise.resolve({ data: null, error: { message: failure } }).then(resolve, reject) }
        if (table === 'staff') return Promise.resolve({ data: [{ id: 'staff-one', apps: ['manager'] }], error: null }).then(resolve, reject)
        if (table === 'notification_prefs') return Promise.resolve({ data: [], error: null }).then(resolve, reject)
        if (table === 'push_subscriptions') return Promise.resolve({ data: subscriptions, error: null }).then(resolve, reject)
        if (table === 'notifications' && op !== 'select') {
          const inserted: Row[] = []
          for (const value of values) {
            const row = { ...value, id: value.id || `legacy-${++legacyId}` }
            const existing = journal.find(entry => entry.id === row.id)
            if (existing && ignoreDuplicates) continue
            if (existing) Object.assign(existing, row)
            else { journal.push(row); inserted.push({ id: row.id }) }
          }
          if (lostJournalResponse) { lostJournalResponse = false; return Promise.resolve({ data: null, error: { message: 'Lost response' } }).then(resolve, reject) }
          return Promise.resolve({ data: inserted, error: null }).then(resolve, reject)
        }
        throw new Error(`Unexpected query ${table}/${op}`)
      },
    }; return query
  } }
  return { admin, journal, failNext(table: string) { failures.set(table, 'Temporary failure') },
    loseNextJournalResponse() { lostJournalResponse = true }, setSubscriptions(rows: Row[]) { subscriptions = rows } }
}
const input: NotifyInput = { type: 'booking', title: 'New booking', body: 'Alex', audience: { managers: true }, eventKey: 'booking:booking-one:created' }
beforeEach(() => { vi.mocked(sendPush).mockReset().mockResolvedValue({ sent: 1, invalid: [] }) })

describe('durable booking notification journal', () => {
  it.each(['staff', 'notification_prefs', 'notifications'])('propagates %s failure so the lease can be retried', async table => {
    const gateway = journalGateway(); gateway.failNext(table)
    await expect(dispatchNotification(gateway.admin, 'venue', input)).rejects.toThrow()
    expect(gateway.journal).toHaveLength(0)
    expect(sendPush).not.toHaveBeenCalled()
    await expect(dispatchNotification(gateway.admin, 'venue', input)).resolves.toMatchObject({ inserted: 2 })
    expect(gateway.journal).toHaveLength(2)
  })
  it('retries a lost journal response without duplicating or resetting existing notifications', async () => {
    const gateway = journalGateway(); gateway.loseNextJournalResponse()
    await expect(dispatchNotification(gateway.admin, 'venue', input)).rejects.toThrow()
    expect(gateway.journal).toHaveLength(2)
    const firstIds = gateway.journal.map(row => row.id)
    gateway.journal[0].read_at = '2026-11-13T10:00:00Z'
    const originalSentAt = gateway.journal[0].sent_at
    await expect(dispatchNotification(gateway.admin, 'venue', input)).resolves.toMatchObject({ inserted: 0 })
    expect(gateway.journal.map(row => row.id)).toEqual(firstIds)
    expect(gateway.journal[0].read_at).toBe('2026-11-13T10:00:00Z')
    expect(gateway.journal[0].sent_at).toBe(originalSentAt)
  })
  it('separates tenants, recipients and events while deduplicating retries', async () => {
    const gateway = journalGateway()
    await dispatchNotification(gateway.admin, 'venue', input)
    await dispatchNotification(gateway.admin, 'venue', input)
    await dispatchNotification(gateway.admin, 'other-venue', input)
    await dispatchNotification(gateway.admin, 'venue', { ...input, eventKey: 'booking:another-booking:created' })
    expect(gateway.journal).toHaveLength(6)
    expect(new Set(gateway.journal.map(row => row.id)).size).toBe(6)
    expect(gateway.journal.every(row => /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(String(row.id)))).toBe(true)
  })
  it('does not resend APNs when a finished dispatch is retried after lease completion fails', async () => {
    const gateway = journalGateway(); gateway.setSubscriptions([{ to_owner: true, device_token: 'fixture-device' }])
    await dispatchNotification(gateway.admin, 'venue', input)
    expect(sendPush).toHaveBeenCalledTimes(1)
    await expect(dispatchNotification(gateway.admin, 'venue', input)).resolves.toEqual({ inserted: 0, push: 0 })
    expect(sendPush).toHaveBeenCalledTimes(1)
    expect(gateway.journal).toHaveLength(2)
  })
  it('keeps a durable journal when APNs fails after it commits', async () => {
    const gateway = journalGateway(); gateway.setSubscriptions([{ to_owner: true, device_token: 'fixture-device' }])
    vi.mocked(sendPush).mockRejectedValue(new Error('APNs unavailable'))
    await expect(dispatchNotification(gateway.admin, 'venue', input)).resolves.toMatchObject({ inserted: 2, push: 0 })
    expect(gateway.journal).toHaveLength(2)
  })
})
