import { describe, it, expect, beforeAll } from 'vitest'

// Set a deterministic secret before importing the module under test.
// (secret() reads env lazily, but set it up front to be safe.)
beforeAll(() => {
  process.env.MISE_TOKEN_SECRET = 'test-secret-key-do-not-use-in-prod'
})

const mod = () => import('./staffToken')

describe('staffToken', () => {
  it('round-trips a valid token', async () => {
    const { issueStaffToken, verifyStaffToken } = await mod()
    const token = issueStaffToken({ rid: 'r1', sid: 's1', owner: false, apps: ['manager', 'analytics'] })
    const payload = verifyStaffToken(token)
    expect(payload).not.toBeNull()
    expect(payload!.rid).toBe('r1')
    expect(payload!.sid).toBe('s1')
    expect(payload!.owner).toBe(false)
    expect(payload!.apps).toEqual(['manager', 'analytics'])
  })

  it('rejects a tampered payload (signature mismatch)', async () => {
    const { issueStaffToken, verifyStaffToken } = await mod()
    const token = issueStaffToken({ rid: 'r1', sid: 's1', owner: false, apps: [] })
    const [body, sig] = token.split('.')
    // Forge a different restaurant id, keep the original signature.
    const forgedBody = Buffer.from(JSON.stringify({ rid: 'EVIL', sid: 's1', owner: true, apps: ['manager'], iat: 0, exp: 9999999999 }))
      .toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    expect(verifyStaffToken(`${forgedBody}.${sig}`)).toBeNull()
    // Original is still valid (sanity).
    expect(verifyStaffToken(`${body}.${sig}`)).not.toBeNull()
  })

  it('rejects a flipped signature', async () => {
    const { issueStaffToken, verifyStaffToken } = await mod()
    const token = issueStaffToken({ rid: 'r1', sid: 's1', owner: false, apps: [] })
    const [body] = token.split('.')
    expect(verifyStaffToken(`${body}.deadbeef`)).toBeNull()
  })

  it('rejects malformed input', async () => {
    const { verifyStaffToken } = await mod()
    expect(verifyStaffToken(undefined)).toBeNull()
    expect(verifyStaffToken(null)).toBeNull()
    expect(verifyStaffToken('')).toBeNull()
    expect(verifyStaffToken('no-dot')).toBeNull()
    expect(verifyStaffToken('a.b.c')).toBeNull()
  })

  it('rejects an expired token', async () => {
    const { verifyStaffToken } = await mod()
    const crypto = await import('crypto')
    const b64url = (s: string) => Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    const expired = { rid: 'r1', sid: 's1', owner: false, apps: [], iat: 0, exp: 1 } // exp in 1970
    const body = b64url(JSON.stringify(expired))
    const sig = b64url(crypto.createHmac('sha256', process.env.MISE_TOKEN_SECRET!).update(body).digest())
    expect(verifyStaffToken(`${body}.${sig}`)).toBeNull()
  })

  it('a token signed with a different secret does not verify', async () => {
    const { verifyStaffToken } = await mod()
    const crypto = await import('crypto')
    const b64url = (s: string) => Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    const payload = { rid: 'r1', sid: 's1', owner: true, apps: ['manager'], iat: 0, exp: 9999999999 }
    const body = b64url(JSON.stringify(payload))
    const sig = b64url(crypto.createHmac('sha256', 'attacker-secret').update(body).digest())
    expect(verifyStaffToken(`${body}.${sig}`)).toBeNull()
  })
})
