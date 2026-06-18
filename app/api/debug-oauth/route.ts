import { NextResponse } from 'next/server'
import { createHash, randomBytes } from 'crypto'

function makePKCE() {
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  return { verifier, challenge }
}

export async function GET() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const redirectTo = 'https://www.misesuite.com/auth/callback'
  const results: Record<string, unknown> = {}

  for (const provider of ['google', 'apple']) {
    const { challenge } = makePKCE()
    const url = `${supabaseUrl}/auth/v1/authorize?provider=${provider}&redirect_to=${encodeURIComponent(redirectTo)}&code_challenge=${challenge}&code_challenge_method=s256`
    try {
      const resp = await fetch(url, { redirect: 'manual' })
      const location = resp.headers.get('location') ?? ''
      let body = ''
      try { body = await resp.text() } catch {}
      results[provider] = {
        http_status: resp.status,
        redirects_to: location || '(нет location header)',
        goes_to_provider: location.includes('accounts.google.com') || location.includes('appleid.apple.com'),
        error_in_redirect: location.includes('error') ? location : null,
        body_preview: body.slice(0, 300) || null,
      }
    } catch (e: any) {
      results[provider] = { fetch_error: e.message }
    }
  }

  return NextResponse.json(results, { status: 200 })
}
