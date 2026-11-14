import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, clearPendingDbReads } from './db'

function deferred() {
  let resolve!: (value: Response) => void
  const promise = new Promise<Response>(r => { resolve = r })
  return { promise, resolve }
}
const response = (data: unknown) => new Response(JSON.stringify({ data }), { status: 200 })

describe('DB concurrent reads', () => {
  beforeEach(() => {
    clearPendingDbReads()
    vi.stubGlobal('window', {})
    vi.stubGlobal('document', { cookie: 'mise_restaurant_id=one; mise_pin_until=123' })
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => { vi.unstubAllGlobals() })

  it('shares identical pending reads, but fetches again after completion', async () => {
    const gate = deferred()
    vi.mocked(fetch).mockReturnValueOnce(gate.promise).mockResolvedValue(response([{ id: 1 }]))
    const a = Promise.resolve(db.from('shifts').select('id').eq('date', '2026-11-12'))
    const b = Promise.resolve(db.from('shifts').select('id').eq('date', '2026-11-12'))
    await Promise.resolve()
    const callsWhilePending = vi.mocked(fetch).mock.calls.length
    gate.resolve(response([{ id: 1 }]))
    expect(await a).toEqual(await b)
    expect(callsWhilePending).toBe(1)
    await db.from('shifts').select('id').eq('date', '2026-11-12')
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('does not share different filters or credential contexts', async () => {
    vi.mocked(fetch).mockImplementation(async () => response([]))
    const a = Promise.resolve(db.from('shifts').eq('date', 'one'))
    const b = Promise.resolve(db.from('shifts').eq('date', 'two'))
    await Promise.resolve()
    document.cookie = 'mise_restaurant_id=two'
    const c = Promise.resolve(db.from('shifts').eq('date', 'one'))
    await Promise.all([a, b, c])
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it('never merges writes and separates reads across a mutation', async () => {
    const gate = deferred()
    vi.mocked(fetch).mockReturnValueOnce(gate.promise).mockImplementation(async () => response([]))
    const before = Promise.resolve(db.from('shifts').select('id'))
    await Promise.resolve()
    await db.from('shifts').update({ income: 10 }).eq('id', 's')
    await db.from('shifts').update({ income: 10 }).eq('id', 's')
    await db.from('shifts').select('id')
    expect(fetch).toHaveBeenCalledTimes(4)
    gate.resolve(response([]))
    await before
  })

  it('separates reads that start during a write from reads after it completes', async () => {
    const write = deferred()
    const read = deferred()
    vi.mocked(fetch).mockReturnValueOnce(write.promise).mockReturnValueOnce(read.promise)
      .mockImplementation(async () => response(['fresh']))
    const mutation = Promise.resolve(db.from('shifts').update({ income: 20 }))
    await Promise.resolve()
    const during = Promise.resolve(db.from('shifts').select('id'))
    await Promise.resolve()
    write.resolve(response([]))
    await mutation
    const after = await db.from('shifts').select('id')
    read.resolve(response(['old']))
    await during
    expect(after.data).toEqual(['fresh'])
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it('separates pending reads when the session is reset', async () => {
    const read = deferred()
    vi.mocked(fetch).mockReturnValueOnce(read.promise).mockImplementation(async () => response(['new user']))
    const old = Promise.resolve(db.from('shifts').select('id'))
    await Promise.resolve()
    clearPendingDbReads()
    const next = await db.from('shifts').select('id')
    read.resolve(response(['old user']))
    await old
    expect(next.data).toEqual(['new user'])
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('never shares a server-side read between requests', async () => {
    vi.stubGlobal('window', undefined)
    vi.mocked(fetch).mockImplementation(async () => response([]))
    await Promise.all([db.from('shifts').select('id'), db.from('shifts').select('id')])
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('does not retain failed reads', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 }))
      .mockResolvedValueOnce(response([1]))
    expect((await db.from('shifts').select('id')).error?.message).toBe('Forbidden')
    expect((await db.from('shifts').select('id')).data).toEqual([1])
    expect(fetch).toHaveBeenCalledTimes(2)
  })
})
