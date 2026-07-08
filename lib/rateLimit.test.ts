import { describe, it, expect, vi, beforeEach } from 'vitest'

const rpcMock = vi.fn()
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ rpc: rpcMock }),
}))

const mod = () => import('./rateLimit')

describe('rateLimit', () => {
  beforeEach(() => {
    rpcMock.mockReset()
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key'
  })

  it('allows the request when the RPC returns true', async () => {
    rpcMock.mockResolvedValue({ data: true, error: null })
    const { checkRateLimit } = await mod()
    expect(await checkRateLimit('k', 5, 60_000)).toBe(true)
    expect(rpcMock).toHaveBeenCalledWith('rate_limit_hit', { p_key: 'k', p_max: 5, p_window_ms: 60_000 })
  })

  it('blocks the request when the RPC returns false', async () => {
    rpcMock.mockResolvedValue({ data: false, error: null })
    const { checkRateLimit } = await mod()
    expect(await checkRateLimit('k', 5, 60_000)).toBe(false)
  })

  it('fails open when the RPC errors', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'boom' } })
    const { checkRateLimit } = await mod()
    expect(await checkRateLimit('k', 5, 60_000)).toBe(true)
  })

  it('builds a prefixed key from the client IP', async () => {
    const { rateLimitKey } = await mod()
    const req = new Request('https://x', { headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' } })
    expect(rateLimitKey(req, 'ai')).toBe('ai:1.2.3.4')
  })
})
