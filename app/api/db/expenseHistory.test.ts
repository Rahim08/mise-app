import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const mocks = vi.hoisted(() => ({ caller: { rid: 'tenant-one', owner: false, apps: ['manager'] as string[] }, rpc: vi.fn() }))
vi.mock('@/lib/apiAuth', () => ({ resolveCaller: vi.fn(async () => mocks.caller), isOfficial: vi.fn() }))
vi.mock('@/lib/rateLimit', () => ({ checkRateLimit: vi.fn(async () => true), rateLimitKey: vi.fn(() => 'key') }))
vi.mock('@/lib/financialAudit', () => ({ AUDITED_TABLES: new Set(), auditWrite: vi.fn(), auditRpc: vi.fn() }))
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ rpc: mocks.rpc, from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { subscription_status: 'active' } }) }) }) }) }) }))
import { POST } from './route'
const request = (args: unknown) => new NextRequest('http://localhost/api/db', { method: 'POST', body: JSON.stringify({ op: 'rpc', fn: 'shift_expense_name_suggestions', args }) })
describe('expense suggestion authorization', () => {
  beforeEach(() => { mocks.caller = { rid: 'tenant-one', owner: false, apps: ['manager'] }; mocks.rpc.mockReset().mockResolvedValue({ data: [{ name: 'Perfume' }], error: null }) })
  it('forces authenticated tenant and passes only normalized prefix', async () => {
    const response = await POST(request({ p_restaurant_id: 'another-tenant', p_prefix: '  P  ', unused: 'x' }))
    expect(response.status).toBe(200)
    expect(mocks.rpc).toHaveBeenCalledWith('shift_expense_name_suggestions', { p_restaurant_id: 'tenant-one', p_prefix: 'P' })
    expect(await response.json()).toEqual({ data: [{ name: 'Perfume' }] })
  })
  it('denies modules without expense access', async () => {
    mocks.caller.apps = ['people']
    expect((await POST(request({ p_prefix: 'P' }))).status).toBe(403)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it.each([42, 'x'.repeat(121), { value: 'x' }])('rejects invalid prefix %j', async prefix => {
    expect((await POST(request({ p_prefix: prefix }))).status).toBe(400)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
})
