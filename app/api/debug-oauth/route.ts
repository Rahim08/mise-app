import { NextResponse } from 'next/server'

export async function GET() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const redirectTo = 'https://www.misesuite.com/auth/callback'
  const results: Record<string, unknown> = {}

  for (const provider of ['google', 'apple']) {
    const url = `${supabaseUrl}/auth/v1/authorize?provider=${provider}&redirect_to=${encodeURIComponent(redirectTo)}&code_challenge=dGVzdF9kaWFnbm9zdGljX2NoYWxsZW5nZQ&code_challenge_method=s256`
    try {
      const resp = await fetch(url, { redirect: 'manual' })
      const location = resp.headers.get('location') ?? ''
      results[provider] = {
        http_status: resp.status,
        redirects_to: location || '(нет location header)',
        is_going_to_provider: location.includes('accounts.google.com') || location.includes('appleid.apple.com'),
        error_in_url: location.includes('#error=') ? decodeURIComponent(location.split('#error=')[1] ?? '') : null,
      }
    } catch (e: any) {
      results[provider] = { fetch_error: e.message }
    }
  }

  return NextResponse.json(results, { status: 200 })
}
