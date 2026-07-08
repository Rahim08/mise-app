import { NextRequest, NextResponse } from 'next/server'
import { sendWelcomeEmail } from '@/lib/email'
import { checkRateLimit, rateLimitKey } from '@/lib/rateLimit'

export async function POST(req: NextRequest) {
  try {
    if (!await checkRateLimit(rateLimitKey(req, 'welcome'), 5, 60 * 60_000)) {
      return NextResponse.json({ ok: false, error: 'rate_limited' }, { status: 429 })
    }
    const { email, name } = await req.json()
    if (!email) return NextResponse.json({ error: 'no email' }, { status: 400 })
    await sendWelcomeEmail(email, name)
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ ok: false })
  }
}
