// Lightweight health check for uptime monitors (UptimeRobot, BetterStack, Vercel checks).
// Verifies the process is up and the database is reachable. No secrets in the response.
import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

export async function GET() {
  const started = Date.now()
  let db: 'ok' | 'down' = 'down'
  try {
    const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
    // Cheapest possible round-trip: HEAD count on a tiny table.
    const { error } = await admin.from('restaurants').select('id', { count: 'exact', head: true })
    if (!error) db = 'ok'
  } catch { /* db stays down */ }

  const ok = db === 'ok'
  return NextResponse.json(
    { status: ok ? 'ok' : 'degraded', db, ms: Date.now() - started },
    { status: ok ? 200 : 503 },
  )
}
